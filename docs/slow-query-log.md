---
sidebar_position: 3.72
---

# Slow query log

When a node is slow, you need to find the statements that cause it. The slow
query log records the statements that take longer than a threshold, and you can
read them with SQL:

```camussql
SHOW SLOW QUERIES;
SHOW SLOW QUERIES LIKE '%FROM orders%';
```

The log is off by default, and its size in memory is limited. Use it to
diagnose a slow node.

## Enable it

Configure the node:

```yaml
slow_query_log_enabled: true
slow_query_log_threshold_ms: 1000
slow_query_log_max_entries: 200
slow_query_log_max_sql_length: 4096
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `slow_query_log_enabled` | `false` | Turns the log on or off. |
| `slow_query_log_threshold_ms` | `1000` | Records statements at or above this duration. `0` records all statements. |
| `slow_query_log_max_entries` | `200` | The entries kept before the oldest is overwritten. |
| `slow_query_log_max_sql_length` | `4096` | The characters of SQL text stored for each entry. |

`SHOW VARIABLES LIKE 'slow_query%'` shows the values of the node that you
inspect.

You can turn on the log at runtime, also on a node that started with it off.
`slow_query_log_enabled`, `slow_query_log_threshold_ms`, and
`slow_query_log_max_sql_length` change with `SET CLUSTER SETTING`, at the next
statement. A change to `slow_query_log_max_entries` needs a restart.

For the total cost of repeated statements, also fast ones, use
[statement statistics](/docs/statement-stats). You can turn on the two features
separately.

## What it records

Each entry has the facts that usually explain a slow statement:

- `full_scan`: the plan read a full table, and it didn't use an index.
- `spilled`: an operator, such as a sort or a hash join, wrote to disk.
- `rows_read` and `rows_returned`: a statement that reads many more rows than it
  returns usually needs a better index.
- `outcome` and `error_code`: whether the statement completed, and the code of a
  failure.

The newest rows come first.

| Column | Type | Meaning |
| --- | --- | --- |
| `seq` | `INT64` | The recording order on this node. It continues to increase after the ring wraps. |
| `started_at` | `STRING` | The start time of the statement, in UTC. |
| `duration_ms` | `FLOAT64` | The wall-clock duration. |
| `database` | `STRING` | The database of the statement. |
| `user` | `STRING` | The authenticated user, or `NULL` when authentication is off. |
| `kind` | `STRING` | The statement kind, such as `select` or `create_table`. |
| `rows_returned` | `INT64` | The rows returned, or the rows affected by a write. |
| `rows_read` | `INT64` | The rows read from storage before filters, in all parts of the plan. A nested-loop join counts each read of its right side again. For a [distributed](/docs/distributed-queries) scan, rows are counted when they reach the coordinator. Rows that another node read and didn't send aren't counted. |
| `full_scan` | `BOOL` | Whether a part of the statement read a full table, also the right side of a join. |
| `spilled` | `BOOL` | Whether a blocking operator spilled to disk. |
| `outcome` | `STRING` | `completed`, `abandoned`, or `failed`. |
| `error_code` | `STRING` | The error code of a failed statement. |
| `truncated` | `BOOL` | Whether the stored SQL was shortened. |
| `sql` | `STRING` | The statement text, up to `slow_query_log_max_sql_length`. Password literals are replaced with `'***'`. |

## Read the result

The example uses this data:

<details>
<summary>Sample data for the example on this page</summary>

```camussql
CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  customer_id INT64 NOT NULL,
  status STRING NOT NULL,
  total FLOAT64 NOT NULL
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
INSERT INTO orders (id, customer_id, status, total) VALUES
  (1, 7, 'shipped', 42.50),
  (2, 7, 'pending', 18.00),
  (3, 9, 'shipped', 99.90),
  (4, 12, 'pending', 7.25),
  (5, 9, 'cancelled', 15.00),
  (6, 14, 'shipped', 64.10);
```

</details>

To see entries on a small table, record all statements with a threshold of `0`.
Then execute two lookups:

```camussql
SET CLUSTER SETTING slow_query_log_enabled = true;
SET CLUSTER SETTING slow_query_log_threshold_ms = 0;
SELECT id, total FROM orders WHERE status = 'pending';
SELECT id, total FROM orders WHERE customer_id = 7;
```

The result is wide. In camus-cli, end the statement with
[`\G`](/docs/camus-cli#vertical-output) to print one column on each line:

```camussql
SHOW SLOW QUERIES LIKE '%orders%'\G
```

```text
*************************** 1. row ***************************
          seq: 2
   started_at: 2026-11-18T21:52:37.566Z
  duration_ms: 0.7152
     database: docs_inspect
         user: null
         kind: select
rows_returned: 2
    rows_read: 2
    full_scan: False
      spilled: False
      outcome: completed
   error_code: null
    truncated: False
          sql: SELECT id, total FROM orders WHERE customer_id = 7
*************************** 2. row ***************************
          seq: 1
   started_at: 2026-11-18T21:52:37.547Z
  duration_ms: 1.0149
     database: docs_inspect
         user: null
         kind: select
rows_returned: 2
    rows_read: 6
    full_scan: True
      spilled: False
      outcome: completed
   error_code: null
    truncated: False
          sql: SELECT id, total FROM orders WHERE status = 'pending'
2 rows in set (00:00:00.0256024)
```

The `status` lookup doesn't have an index. It read all six rows to return two,
and it shows `full_scan`. On a large table, this means that the condition needs
an index. The `customer_id` lookup uses `orders_customer_idx`, and it reads the
rows that it returns.

A statement that reads the rows it returns, but shows `spilled`, has a different
problem: memory or an unbounded sort. Add a `LIMIT`, raise the spill threshold,
or inspect the plan with `EXPLAIN`.

When you finish, run `RESET CLUSTER SETTING slow_query_log_threshold_ms;`. The
log then records slow statements only.

`SHOW SLOW QUERIES` itself isn't recorded. This means that a dashboard or a
client that polls the log doesn't fill it.

In `CREATE USER ... IDENTIFIED BY ...` and `ALTER USER ... IDENTIFIED BY ...`,
the password literal is replaced with `'***'` before the entry is stored. A
password that you bind as a parameter isn't in the statement text.

## Dashboard

The [operator dashboard](/docs/operator-dashboard) has a **Slow queries** panel
with the same data. It shows the newest entries, highlights full scans and
spills, and refreshes separately from the rest of the page.

## Permissions and limits

With authentication on, `SHOW SLOW QUERIES` needs a superuser. The rows have the
SQL text of other users, with literals. This means that table grants can't
safely filter the output.

The log has the following limits:

- The entries are in memory, and a restart clears them.
- The result is local to the node. In a cluster, inspect each node.
- The ring has a fixed size. If `seq` increased by more than the ring size
  between two reads, entries were overwritten.
- It isn't an audit log. Statements below the threshold aren't recorded.

## Related pages

- [EXPLAIN](/docs/explain)
- [Query planning](/docs/query-planning)
- [Spill to disk](/docs/spill-to-disk)
- [Engine stats](/docs/engine-stats)
- [Configuration](/docs/configuration)
