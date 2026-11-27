---
sidebar_position: 3.15
---

# Query activity

When a query is slow, you need to see what is executing, and you can need to
stop it. CamusDB shows the statements and the client connections that are
active now. It also shows the open transactions. It can cancel a running read
query, and roll back an open transaction that blocks other work.

These statements are server-level. They don't need a selected database, and
they don't open a transaction:

```camussql
SHOW QUERIES;
SHOW QUERIES LIKE '%FROM orders%';
SHOW CLUSTER QUERIES;

SHOW CONNECTIONS;
SHOW CLUSTER CONNECTIONS;

SHOW TRANSACTIONS;
SHOW CLUSTER TRANSACTIONS;

CANCEL QUERY 'b71a90e314-45';
KILL TRANSACTION 'b71a90e314-t1764000000000.3';
```

Use `SHOW QUERIES` to find a slow statement and its id. `SHOW CONNECTIONS`
shows the client connections of the node. `SHOW TRANSACTIONS` shows the
explicit transactions that clients keep open, also the ones that wait between
statements. The cluster forms ask each member and merge the rows.

## Running queries

`SHOW QUERIES` returns one row for each statement that is executing on the
node, oldest first. The output includes the `SHOW QUERIES` statement.

The result is wide. In camus-cli, end the statement with
[`\G`](/docs/camus-cli#vertical-output) to print one column on each line:

```camussql
SHOW QUERIES LIKE '%FROM orders%'\G
```

```text
*************************** 1. row ***************************
        query_id: b71a900b3a-672
            node: localhost:0
   connection_id: b71a900b3a-c305
  client_address: ::1
       transport: grpc-stream
       user_name: null
   database_name: 
  transaction_id: null
       isolation: null
            kind: show_queries
           phase: planning
      started_at: 2026-11-18T22:00:14.810Z
      elapsed_ms: 0.1583
   rows_returned: 0
     cancellable: True
cancel_requested: False
             sql: SHOW QUERIES LIKE '%FROM orders%'
           error: null
1 rows in set (00:00:00.0243941)
```

The pattern also matches the text of the `SHOW QUERIES` statement. This means
that its row appears in the result.

The following columns are the most useful:

| Column | Meaning |
| --- | --- |
| `query_id` | The id for `CANCEL QUERY`. It is unique in the cluster. |
| `node` | The internal cluster address of the node that executes the statement. |
| `connection_id` | The connection that carried the statement, if there is one. |
| `client_address` | The IP address of the client. |
| `transport` | `http`, `grpc`, `grpc-stream`, or `embedded`. |
| `user_name` | The authenticated user, or `NULL` when authentication is off. |
| `database_name` | The context database of the statement. |
| `transaction_id` | The handle of the explicit transaction, if the statement is part of one. |
| `isolation` | The isolation level of that transaction, or `NULL` for an autocommit statement. |
| `kind` | The statement kind, such as `select` or `create_table`. |
| `phase` | `planning` before the first row is read, then `executing`. |
| `started_at` | The UTC start time. |
| `elapsed_ms` | How long the statement has executed. |
| `rows_returned` | The rows that the client has read so far. |
| `cancellable` | Whether `CANCEL QUERY` can stop the statement now. |
| `cancel_requested` | Whether a cancel was requested. |
| `sql` | The statement text. Credential literals are masked, and the length is limited. |
| `error` | `NULL` for normal rows. The cluster forms use it when a node didn't answer. |

A statement that returns rows is listed until its cursor ends. If a client reads
slowly, the query is visible, and `rows_returned` grows as the client reads
rows.

## Client connections

`SHOW CONNECTIONS` returns one row for each client TCP or QUIC connection of
the node. It tracks the client ports of the node, including the gRPC port. QUIC
connections exist when `http3_enabled` is on. The internal port that nodes use
to talk to each other isn't tracked.

```camussql
SHOW CONNECTIONS;
```

```text
┌─────────────────┬─────────────┬────────────────┬──────────┬────────┬───────────┬──────────────────────────┬──────────┬─────────┬──────────┬────────────────┬──────────────┬───────┐
│ connection_id   │ node        │ client_address │ protocol │ kind   │ user_name │ opened_at                │ age_ms   │ idle_ms │ requests │ active_queries │ open_streams │ error │
├─────────────────┼─────────────┼────────────────┼──────────┼────────┼───────────┼──────────────────────────┼──────────┼─────────┼──────────┼────────────────┼──────────────┼───────┤
│ b71a900b3a-c209 │ localhost:0 │ ::1            │ HTTP/2   │ client │ null      │ 2026-11-18T21:52:48.230Z │ 100.3253 │ 0       │ 11       │ 1              │ 8            │ null  │
└─────────────────┴─────────────┴────────────────┴──────────┴────────┴───────────┴──────────────────────────┴──────────┴─────────┴──────────┴────────────────┴──────────────┴───────┘
1 rows in set (00:00:00.0036435)
```

The following columns are the most useful:

| Column | Meaning |
| --- | --- |
| `connection_id` | The id in the `connection_id` column of `SHOW QUERIES`. |
| `node` | The node of the connection. |
| `client_address` | The IP address of the client. |
| `protocol` | `HTTP/1.1`, `HTTP/2`, or `HTTP/3`. gRPC uses `HTTP/2`. `HTTP/3` appears on the HTTPS port when `http3_enabled` is on. |
| `kind` | `client`, or `peer` for another node that calls an internal endpoint. |
| `user_name` | The user of the last statement on the connection. |
| `opened_at` | The UTC time when the connection was accepted. |
| `age_ms` | How long the connection has been open. |
| `idle_ms` | The time since the last request. `0` while a statement executes. |
| `requests` | The requests started on the connection. |
| `active_queries` | The statements that are executing on the connection now. |
| `open_streams` | Open `BatchExecute` streams. |
| `error` | `NULL` for normal rows. The cluster forms use it when a node didn't answer. |

HTTP/2 can carry many concurrent calls on one connection. This means that one
gRPC channel usually appears as one connection row.

## Cancel a query

`CANCEL QUERY '<query_id>'` asks CamusDB to stop one running query. You can send
the cancel to any node. The id identifies the node that owns the query, and the
cancel is forwarded to that node. Over the HTTP API, send `CANCEL QUERY` to
`/execute-sql-non-query`.

Read statements can be cancelled. A `SELECT`, a `SHOW`, or an `EXPLAIN ANALYZE`
stops at its next row boundary. After a write or a schema change starts to
change data, it continues to its commit or rollback. It shows
`cancellable = false`.

The client of the cancelled statement receives `CADB0554` (HTTP 409). The rows
that it read before the cancel are real rows.

A cancel takes effect when the statement next checks for cancellation. If the
server already wrote rows into the network buffer, a slow client can receive
those rows before the error.

The following errors are related to cancels:

| Code | Meaning |
| --- | --- |
| `CADB0551` | No visible running query has that id. The query ended, or the id is wrong. A query of another user also gives this error. |
| `CADB0552` | The statement can't be cancelled now. For example, it is a write, or it is in parsing. |
| `CADB0553` | The node that can own the query didn't answer before the timeout. The query can continue to execute. |
| `CADB0554` | The cancelled statement returns this code to its client. |

## Open transactions

`SHOW TRANSACTIONS` returns one row for each open explicit transaction of the
node, oldest first. An explicit transaction is one that a client began with
`BEGIN` and didn't commit or roll back yet. A transaction that is idle between
statements is listed too. The transaction that CamusDB makes for one autocommit
statement isn't listed. `SHOW QUERIES` shows that statement.

The following columns are the most useful:

| Column | Meaning |
| --- | --- |
| `transaction_id` | The id for `KILL TRANSACTION`. It ends in the handle that the `transaction_id` column of `SHOW QUERIES` shows. |
| `node` | The node of the transaction. |
| `database_name` | The database where the transaction began. |
| `user_name` | The user who began it, or `NULL` when authentication is off. |
| `client_address` | The IP address of the client at the begin. |
| `transport` | `http`, `grpc`, `grpc-stream`, or `embedded`. |
| `isolation` | The isolation level of the transaction. |
| `locking` | The locking mode of the transaction. |
| `mode` | The read/write mode of the transaction. |
| `started_at` | The UTC time when the transaction began. |
| `age_ms` | How long the transaction has been open. |
| `idle_ms` | How long it has waited for its client since its last statement. `0` unless `state` is `idle`. |
| `state` | `idle`, `running`, `finalizing` (in a commit or rollback), or `killing` (killed while a statement executes). |
| `query_id` | The `SHOW QUERIES` id of a statement that executes in it now. |
| `last_sql` | The last statement that it executed. Credential literals are masked, and the length is limited. |
| `modified_keys` | The number of keys that it wrote. Each written key is locked until the transaction ends. |
| `holds_ddl_lock` | `true` when its DDL has the DDL lock of the database (transactional DDL). The other DDL statements of that database wait for it. |
| `error` | `NULL` for normal rows. The cluster forms use it when a node didn't answer. |

## Kill a transaction

`KILL TRANSACTION '<transaction_id>'` rolls back one open transaction and
releases its locks. A writer that waited for those locks can continue at once.
You can send the kill to any node. The id identifies the node that owns the
transaction and its process. An id from before a restart can't end a
transaction of the restarted node.

The client of the killed transaction receives `CADB0565` on its next statement
and on its `COMMIT`. Its `ROLLBACK` succeeds. The node logs a warning line for
each kill. The line names the transaction and the user who killed it.

If a statement of the transaction executes, the kill takes effect at once: the
transaction executes no new statement, and it can't commit. The rollback starts
when that statement ends. A read stops at its next row, and a write stops before
its next write, both with `CADB0565`. If the statement doesn't end within half
of `cluster_activity_peer_timeout_ms`, the kill returns `CADB0568`. The row then
shows `state = 'killing'`. Send the same kill again to confirm the rollback.

If a `COMMIT` or `ROLLBACK` of the transaction already started, only one of the
two wins. A kill that lost to a commit returns `CADB0501`, and the message says
that the transaction committed.

The following errors are related to kills:

| Code | Meaning |
| --- | --- |
| `CADB0565` | The killed transaction returns this code to its client. |
| `CADB0566` | No visible open transaction has that id. The transaction ended, or the id is wrong. A transaction of another user also gives this error. |
| `CADB0567` | The node that can own the transaction didn't answer before the timeout. The transaction can be open. |
| `CADB0568` | The kill is in effect, and the rollback waits for a running statement. |
| `CADB0501` | A commit or rollback of the transaction won, or the outcome of its last commit isn't known yet. |

## Find and end a blocking transaction

Writes to a table fail with a conflict or lock error, or a schema change waits,
and `SHOW QUERIES` shows no statement that explains it. Often an idle
transaction has the locks.

1. List the open transactions of the cluster.

   ```camussql
   SHOW CLUSTER TRANSACTIONS;
   ```

2. Find a row of that database with `state = 'idle'` and a large `idle_ms`.
   A blocker has `modified_keys` more than `0`, or `holds_ddl_lock = true`.
   `last_sql` shows what it did. `user_name` and `client_address` show whose
   it is.

3. End it with `KILL TRANSACTION`.

   ```camussql
   KILL TRANSACTION 'b71a90e314-t1764000000000.3';
   ```

4. Retry the blocked write, and tell the owner of the client.

If you don't kill it, the idle reaper rolls the transaction back after
`transaction_idle_timeout_ms` (5 minutes by default).

## Visibility and permissions

When authentication is off, all callers see all the rows, they can cancel any
cancellable query, and they can kill any transaction.

When authentication is on:

- A superuser sees all the rows, can cancel any cancellable query, and can
  kill any transaction.
- A regular user sees their own rows only.
- A regular user can cancel their queries and kill their transactions only.

A cancel of the query of another user returns `CADB0551`, and a kill of the
transaction of another user returns `CADB0566`: the same errors as an unknown
id. This means that ids don't disclose the activity of other users.

## Cluster forms

The `SHOW CLUSTER` forms ask each cluster member for its local rows. If a node doesn't answer before
`cluster_activity_peer_timeout_ms`, it gives one row with `node` and `error`
set, and the other columns are `NULL`. This means that one unreachable node
doesn't make the activity query fail.

A cluster request contacts all the members. A node admits at most
`cluster_activity_max_concurrent_fan_outs` cluster requests at the same time
(default 8). Other requests return `CADB0558` and HTTP 503. This limit protects
the connections between nodes from frequent dashboard polling.

On a standalone node, the cluster forms return the same rows as the local forms.

## Runtime settings

The following runtime settings control the feature. Their scope is the node,
and you can change them with
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings):

| Setting | Default | Purpose |
| --- | --- | --- |
| `query_activity_enabled` | `true` | Lists running statements and allows `CANCEL QUERY`. |
| `query_activity_max_sql_length` | `1024` | The maximum characters of statement text in `SHOW QUERIES`. |
| `cluster_activity_peer_timeout_ms` | `2000` | The wait for other nodes, for the cluster forms and the forwarded cancels. A forwarded kill uses it too, and a kill waits half of it for its rollback. |
| `cluster_activity_max_concurrent_fan_outs` | `8` | The concurrent cluster activity requests that a node admits. `0` or less turns off the limit. |

```camussql
SET CLUSTER SETTING query_activity_max_sql_length = 4096;
SET CLUSTER SETTING cluster_activity_peer_timeout_ms = 5000;
```

When `query_activity_enabled` is off, new statements aren't listed, and
`CANCEL QUERY` can't find them. Statements that are already listed leave the
list when they finish. `SHOW CONNECTIONS` continues to work.

## Limits

- Typed row APIs, such as `/query` and the gRPC `CamusRows` service, aren't
  listed. They don't send SQL text.
- The scans that a [distributed query](/docs/distributed-queries) executes on
  other nodes aren't listed on those nodes. The statement on the coordinating
  node is listed.
- An explicit transaction that is idle between statements isn't in
  `SHOW QUERIES`. It is in `SHOW TRANSACTIONS`.
- A conflict error doesn't name the transaction that has the lock, and
  `SHOW TRANSACTIONS` doesn't list the tables that a transaction locks. Use the
  steps in [Find and end a blocking transaction](#find-and-end-a-blocking-transaction).
- There isn't a `KILL CONNECTION` statement.
