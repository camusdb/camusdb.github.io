---
sidebar_position: 6
---

# The connection model

A client talks to CamusDB through two APIs: REST with JSON over HTTP, and gRPC
over HTTP/2. Neither API gives a connection its own process or its own thread.
A connection is only a socket. The server does work for a request, not for a
connection.

This page compares that model with the model of PostgreSQL and the model of
MySQL. It also states the costs of the CamusDB model, while it has its advantages, 
it comes with costs and isn't entirely free.

![CamusDB connection pool diagram](/img/connection-pool.png)

## The short version

| | PostgreSQL | MySQL | CamusDB |
|---|---|---|---|
| The unit of work on the server | One operating-system process for each connection | One thread for each connection, by default | One asynchronous request on a shared pool of threads |
| The cost of an idle connection | A full process, with its own memory | A full thread, with its stack and its buffers | One open socket |
| Where the state of a transaction lives | Inside the process of the connection | Inside the session of the thread | In a table on the node, under a handle that the client holds |
| The usual answer to many clients | An external pooler, for example PgBouncer | A larger `max_connections`, or a thread pool plugin | Nothing extra: many requests share few connections |
| Concurrent statements on one connection | One at a time | One at a time | Many, through HTTP/2 multiplexing |

## How PostgreSQL handles a connection

PostgreSQL uses one process for each connection. The `postmaster` process
accepts the socket. It then forks a backend process. That backend serves the
connection until the client disconnects.

This design is simple. A crash in one backend does not corrupt the
memory of another backend. But each backend has a real cost:

- Each backend keeps private memory: the catalog caches, the plan caches, and
  the memory for a sort or a hash, up to `work_mem` for each operation.
- The start of a connection costs a fork, the authentication, and a warm-up of
  the caches.
- The operating system schedules each backend as a separate process. Many
  hundreds of active backends cause context switches and contention.
- A connection that is idle inside a transaction keeps its backend. It also
  keeps old row versions alive, because `VACUUM` cannot remove them.

For these reasons, the default `max_connections` is 100. A large application
puts a pooler, such as PgBouncer, in front of the database. A pooler in
transaction mode shares a backend between clients, but it breaks the state of a
session. A `SET`, an advisory lock, a temporary table, or `LISTEN` can then
reach the wrong client.

## How MySQL handles a connection

MySQL uses one thread for each connection, by default. A thread is cheaper than
a process, but the cost still grows with the number of connections:

- Each thread has its own stack, set by `thread_stack`.
- Each session can allocate its own buffers, for example `sort_buffer_size`,
  `join_buffer_size`, and `read_buffer_size`.
- Thousands of threads compete for the CPU. The cost of context switches and of
  contention on locks then grows.

The default `max_connections` is 151. A thread pool exists in MySQL Enterprise,
in Percona Server, and in MariaDB. It decouples the connections from the
threads. But the session still owns its state, so a connection stays tied to
one client.

## How CamusDB handles a request

CamusDB runs on the Kestrel web server of ASP.NET Core. Kestrel uses
asynchronous I/O. A request uses a thread only while it does CPU work. When a
request waits for the disk, for the network, or for a lock, it releases its
thread. Another request then uses that thread.

The result is a small, shared pool of threads that serves many requests. The
number of threads does not follow the number of clients.

### REST

A REST request is a complete unit. It names the database. It carries the SQL
and the parameters. It can also carry the id of a transaction. The server
needs nothing from an earlier request on the same socket.

The client can therefore send each request on any connection from its own HTTP
pool. A connection that waits between two requests costs the server one open
socket. See [HTTP API](/docs/http-api).

### gRPC

A gRPC client opens one HTTP/2 connection, which gRPC calls a channel. HTTP/2
multiplexing lets that one connection carry many calls at the same time. Each
call is a separate stream inside the connection.

The method `CamusSql.BatchExecute` goes further. One bidirectional stream
carries many statements and their responses, in both directions. The responses
can arrive out of order, and the client matches them by `request_id`. A batch
frame can also put a full short transaction into one message. See
[gRPC API](/docs/grpc-api).

`SHOW CONNECTIONS` makes this visible. One gRPC channel usually appears as one
row, while it carries many concurrent statements. See
[Query activity](/docs/query-activity).

## Where the state lives

A model without sessions must keep the state somewhere. CamusDB keeps each kind
of state at a place that the client can name.

| State | Where it lives | How a client refers to it |
|---|---|---|
| An explicit transaction | In memory on the node that started it | `txnIdPT` and `txnIdCounter` in REST, or a `TxnHandle` in gRPC |
| A prepared statement in gRPC | The `BatchExecute` stream | A `statement_id` that belongs to that stream |
| A prepared statement in REST | The node, under the principal that prepared it | An opaque string handle |
| Read-your-writes in a cluster | The client | A causal token, which the client sends with the next request |
| The identity of the user | A bearer token | The `authorization` header or metadata |

A transaction is therefore not part of a connection. A client can start a
transaction with REST, or with the unary gRPC call `StartTransaction`. It can
then commit that transaction on another socket. A failed socket does not end
the transaction. The client opens a new socket and continues with the same
handle.

One exception applies. A transaction that a `START` opens inside a
`BatchExecute` stream belongs to that stream. If the stream ends without a
`COMMIT` or a `ROLLBACK`, CamusDB rolls the transaction back. A client crash
therefore cannot leave that transaction open.

## What this gives an application

### No external pooler

The number of open connections does not control the cost on the server. An
application with a thousand workers can share a few HTTP/2 connections. There
is no PgBouncer to deploy, to monitor, and to configure.

### Short-lived clients

A serverless function, a script, or a test can send one HTTPS request. It does
not need a pool that stays warm. The cost of a new connection is a TCP and TLS
handshake. There is no fork and no new thread on the server.

### Fewer round trips

`BatchExecute` sends many statements without a wait for each response. Frame
contract version 2 can send `START`, the statements, and `COMMIT_IF_OK` in one
message. A short transaction then needs one exchange.

### Standard infrastructure

REST and gRPC are ordinary HTTP. Load balancers, proxies, TLS termination,
service meshes, and tracing tools already understand them. A client needs no
database-specific wire protocol.

### No state that a pooler can break

A pooler for PostgreSQL in transaction mode can mix the session state of two
clients. CamusDB has no hidden session state to mix. A transaction, a prepared
statement, and a causal token each have an explicit handle, and the request
carries that handle.

### An idle client costs little

An idle socket holds no process, no thread, and no buffer for a sort. An open
transaction that a client forgets still holds its locks. CamusDB rolls it back
after `transaction_idle_timeout_ms`, which is 5 minutes by default.

## The costs of this model

The model has trade-offs. Know them before you design a client.

- **A transaction stays on its node.** The node that starts an explicit
  transaction keeps it in memory. Send every statement of that transaction, and
  its `COMMIT` or `ROLLBACK`, to that same node. Another node does not know the
  handle and rejects it. An autocommit statement can go to any node.
- **Each request repeats some context.** A REST request carries the name of the
  database, the token, and the JSON body each time. Parsing costs CPU on every
  request. gRPC with Protobuf and a prepared statement reduce that cost. See
  [Prepared statements](/docs/prepared-statements).
- **A pause can end a transaction.** A pause longer than
  `transaction_idle_timeout_ms` inside a transaction counts as abandonment.
  CamusDB then rolls the transaction back.
- **There is no session state.** CamusDB has no session-level `SET`, no
  temporary tables for a session, and no `LISTEN` or `NOTIFY`.
  `SET TRANSACTION` applies to one transaction only. Put other context in the
  request.
- **A gRPC prepared statement belongs to its stream.** A client that rebuilds
  the stream must prepare the statement again.
- **Many cheap connections still need a limit on work.** The number of
  connections no longer limits the load. Use admission control to put a
  ceiling on concurrent work. See [Transaction priority](/docs/transaction-priority).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `grpc_batch_max_in_flight` | `64` | The number of operations that one `BatchExecute` stream runs at the same time. Past it, the server applies back-pressure. |
| `transaction_idle_timeout_ms` | `300000` | The idle time after which CamusDB rolls back an explicit transaction. |
| `transaction_reaper_interval_ms` | `30000` | How often CamusDB looks for idle transactions. |
| `prepared_statement_idle_timeout_ms` | `600000` | The idle time after which CamusDB drops a REST prepared statement. |
| `kahuna.max_concurrent_sessions` | `0`, no gate | The ceiling on concurrent transactions on one node. It limits work, not connections. |

See [Configuration](/docs/configuration) for the full list.

## Related pages

- [HTTP API](/docs/http-api)
- [gRPC API](/docs/grpc-api)
- [Prepared statements](/docs/prepared-statements)
- [Query activity](/docs/query-activity)
- [Transaction priority](/docs/transaction-priority)
- [Architecture](/docs/architecture)
