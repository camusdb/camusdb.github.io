---
sidebar_position: 3.15
---

# Query activity

When a query is slow, you need to see what is executing, and you can need to
stop it. CamusDB shows the statements and the client connections that are
active now. It can also cancel a running read query.

These statements are server-level. They don't need a selected database, and
they don't open a transaction:

```camussql
SHOW QUERIES;
SHOW QUERIES LIKE '%FROM orders%';
SHOW CLUSTER QUERIES;

SHOW CONNECTIONS;
SHOW CLUSTER CONNECTIONS;

CANCEL QUERY 'b71a90e314-45';
```

Use `SHOW QUERIES` to find a slow statement and its id. `SHOW CONNECTIONS`
shows the client connections of the node. The cluster forms ask each member
and merge the rows.

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

## Visibility and permissions

When authentication is off, all callers see all the rows, and they can cancel
any cancellable query.

When authentication is on:

- A superuser sees all the rows, and can cancel any cancellable query.
- A regular user sees their statements and connections only.
- A regular user can cancel their queries only.

A cancel of the query of another user returns `CADB0551`, the same error as an
unknown id. This means that query ids don't disclose the activity of other
users.

## Cluster forms

`SHOW CLUSTER QUERIES` and `SHOW CLUSTER CONNECTIONS` ask each cluster member
for its local rows. If a node doesn't answer before
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
| `cluster_activity_peer_timeout_ms` | `2000` | The wait for other nodes, for cluster forms and forwarded cancels. |
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
  `SHOW QUERIES`. Its connection is in `SHOW CONNECTIONS`.
- There isn't a `KILL CONNECTION` statement.
