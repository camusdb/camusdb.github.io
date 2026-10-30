---
sidebar_position: 3.15
---

# Query activity

CamusDB can show the statements and client connections that are active right
now. It can also cancel a running read query.

These statements are server-level. They do not need a selected database and they
do not open a transaction:

```camussql
SHOW QUERIES;
SHOW QUERIES LIKE '%FROM orders%';
SHOW CLUSTER QUERIES;

SHOW CONNECTIONS;
SHOW CLUSTER CONNECTIONS;

CANCEL QUERY 'b71a90e314-45';
```

`SHOW QUERIES` is useful when a query is slow, a client is reading rows slowly,
or you need the id of a statement to cancel. `SHOW CONNECTIONS` shows the
client-facing connections held by the node. The cluster forms ask every
member and merge the rows.

## Running queries

`SHOW QUERIES` returns one row for each statement that is running on the node,
oldest first. The `SHOW QUERIES` statement itself appears in the output.

Important columns:

| Column | Meaning |
| --- | --- |
| `query_id` | The id accepted by `CANCEL QUERY`. It is unique across the cluster. |
| `node` | The internal cluster address of the node running the statement. |
| `connection_id` | The connection that carried the statement, when there is one. |
| `client_address` | The client's IP address. |
| `transport` | `http`, `grpc`, `grpc-stream`, or `embedded`. |
| `user_name` | The authenticated user, or `NULL` when authentication is off. |
| `database_name` | The context database of the statement. |
| `transaction_id` | The explicit transaction handle, when the statement runs inside one. |
| `kind` | The parsed statement kind, such as `select`, `update`, or `create_table`. |
| `phase` | `planning` before the first row is read, then `executing`. |
| `started_at` | The UTC start time. |
| `elapsed_ms` | How long the statement has run. |
| `rows_returned` | Rows the client has read so far. |
| `cancellable` | Whether `CANCEL QUERY` can stop it now. |
| `cancel_requested` | Whether a cancel has already been requested. |
| `sql` | The statement text, with credential literals masked and length-limited. |
| `error` | `NULL` for normal rows. Cluster forms use it when a node could not answer. |

A row-returning statement stays listed until its cursor ends. If a client reads
slowly, the query remains visible and `rows_returned` continues to grow as the
client consumes rows.

## Client connections

`SHOW CONNECTIONS` returns one row for each client-facing TCP or QUIC connection
accepted by the node. It tracks HTTP, HTTPS, and the gRPC client port. QUIC
connections exist only when `http3_enabled` is on. It does not track the
internal port that nodes use to talk to each other.

Important columns:

| Column | Meaning |
| --- | --- |
| `connection_id` | The id referenced by `SHOW QUERIES.connection_id`. |
| `node` | The node that holds the connection. |
| `client_address` | The client's IP address. |
| `protocol` | `HTTP/1.1`, `HTTP/2`, or `HTTP/3`. gRPC uses `HTTP/2`. `HTTP/3` appears only on the HTTPS port when `http3_enabled` is on. |
| `kind` | `client`, or `peer` for another node calling an internal endpoint. |
| `user_name` | The user of the last statement on the connection. |
| `opened_at` | The UTC time when the connection was accepted. |
| `age_ms` | How long the connection has been open. |
| `idle_ms` | Time since the last request; `0` while a statement runs. |
| `requests` | Requests started on the connection. |
| `active_queries` | Statements currently running on the connection. |
| `open_streams` | Open `BatchExecute` streams. |
| `error` | `NULL` for normal rows. Cluster forms use it when a node could not answer. |

HTTP/2 can carry many concurrent calls on one connection, so one gRPC channel
usually appears as one connection row.

## Cancel a query

`CANCEL QUERY '<query_id>'` asks CamusDB to stop one running query. You can send
the cancel to any node; the id contains enough information for CamusDB to forward
the request to the node that owns it.

Only read statements are cancellable. A `SELECT`, `SHOW`, or `EXPLAIN ANALYZE`
stops at its next row boundary. A write or schema change runs to commit or
rollback once it has started mutating state, so it shows `cancellable = false`.

The client of the cancelled statement receives `CADB0554`. Rows it already read
before the cancel are real rows.

Cancel-related errors:

| Code | Meaning |
| --- | --- |
| `CADB0551` | No visible running query has that id. It may have ended, the id may be wrong, or it may belong to another user. |
| `CADB0552` | The statement cannot be cancelled now, usually because it is a write, a schema change, or still parsing. |
| `CADB0553` | The node that may own the query did not answer before the timeout. The query may still be running. |
| `CADB0554` | The cancelled statement reports this code to its own client. |

A cancel takes effect when the statement next checks for cancellation. If the
server has already written rows into the network buffer, a slow client can still
receive those buffered rows before it receives the cancellation error.

## Visibility and permissions

When authentication is off, every caller sees every row and can cancel any
cancellable query.

When authentication is on:

- A superuser sees every row and can cancel any cancellable query.
- A regular user sees only their own statements and connections.
- A regular user can cancel only their own queries.

A cancel attempt against another user's query returns the same error as an
unknown query id, so query ids do not reveal other users' activity.

## Cluster forms

`SHOW CLUSTER QUERIES` and `SHOW CLUSTER CONNECTIONS` ask every cluster member
for its local rows. A node that does not answer before
`cluster_activity_peer_timeout_ms` contributes one row with `node` and `error`
set, while the other columns are `NULL`.

This keeps the result useful during an outage: one unreachable node does not
make the whole activity query fail.

One cluster request contacts all members. At most
`cluster_activity_max_concurrent_fan_outs` requests run simultaneously on a node
(default 8); excess requests fail with `CADB0558` and HTTP 503. This protects
peer connections and thread-pool work from excessive dashboard polling.

On a standalone node, the cluster forms return the same rows as the local forms.

## Runtime settings

These runtime cluster settings control the feature:

| Setting | Default | Purpose |
| --- | --- | --- |
| `query_activity_enabled` | `true` | Lists running statements and allows `CANCEL QUERY`. |
| `query_activity_max_sql_length` | `1024` | Maximum statement-text characters shown in `SHOW QUERIES`. |
| `cluster_activity_peer_timeout_ms` | `2000` | Peer wait for cluster forms and forwarded cancels. |
| `cluster_activity_max_concurrent_fan_outs` | `8` | Concurrent cluster activity requests admitted per node. `0` or below disables the cap. |

Change them with [Runtime Cluster Settings](/docs/runtime-cluster-settings):

```camussql
SET CLUSTER SETTING query_activity_max_sql_length = 4096;
SET CLUSTER SETTING cluster_activity_peer_timeout_ms = 5000;
```

Turning `query_activity_enabled` off stops new statements from being listed and
prevents `CANCEL QUERY` from finding them. Existing listed statements leave the
activity list when they finish. `SHOW CONNECTIONS` still works.

## Limits

- Typed row APIs, such as `/query`, `/insert`, `/update`, `/delete`, and the
  gRPC `CamusRows` service, are not listed because they do not send SQL text.
- The scans that a [distributed query](/docs/distributed-queries) runs on other
  nodes are not listed on those nodes. The statement on the coordinating node
  is listed.
- An explicit transaction that is idle between statements does not appear in
  `SHOW QUERIES`; its connection appears in `SHOW CONNECTIONS`.
- There is no `KILL CONNECTION` statement yet.
