---
sidebar_position: 3.72
---

# Slow query log

CamusDB can record statements that take longer than a threshold and expose them
as a SQL result set:

```camussql
SHOW SLOW QUERIES;
SHOW SLOW QUERIES LIKE '%FROM orders%';
```

The log is off by default and bounded in memory. Use it as a diagnostic while a
node is slow, not as an audit log.

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
| `slow_query_log_enabled` | `false` | Master switch. |
| `slow_query_log_threshold_ms` | `1000` | Record statements at or above this duration. `0` records every statement. |
| `slow_query_log_max_entries` | `200` | Entries kept before the oldest is overwritten. |
| `slow_query_log_max_sql_length` | `4096` | Characters of SQL text stored per entry. |

`SHOW VARIABLES LIKE 'slow_query%'` shows the effective values on the node you
are inspecting.

## What it records

Each entry includes the facts that usually explain why a statement was slow:

- `full_scan`: the plan read a whole relation instead of seeking through an
  index.
- `spilled`: a sort, grouping, distinct, hash join, or row buffer wrote to disk.
- `rows_read` and `rows_returned`: reading far more rows than returned usually
  means the predicate needs a better index.
- `outcome`: `completed`, `abandoned`, or `failed`.
- `error_code`: the CamusDB error code when the statement failed.

Rows come back newest first.

| Column | Type | Meaning |
| --- | --- | --- |
| `seq` | `INT64` | Recording order on this node. It keeps increasing after the ring wraps. |
| `started_at` | `STRING` | Statement start time in UTC. |
| `duration_ms` | `FLOAT64` | Wall-clock duration. |
| `database` | `STRING` | Database used by the statement. |
| `user` | `STRING` | Authenticated user, or `NULL` when auth is disabled. |
| `kind` | `STRING` | Statement kind, such as `select`, `insert`, or `create_table`. |
| `rows_returned` | `INT64` | Rows returned, or rows affected for a mutation. |
| `rows_read` | `INT64` | Rows fetched from storage before filtering. |
| `full_scan` | `BOOL` | Whether any part of the statement read a whole relation. |
| `spilled` | `BOOL` | Whether a blocking operator spilled to disk. |
| `outcome` | `STRING` | `completed`, `abandoned`, or `failed`. |
| `error_code` | `STRING` | Error code for failed statements. |
| `truncated` | `BOOL` | Whether the stored SQL was shortened. |
| `sql` | `STRING` | Statement text, up to `slow_query_log_max_sql_length`. |

## Read the result

```camussql
SHOW SLOW QUERIES LIKE '%orders%';
```

| seq | duration_ms | kind | rows_returned | rows_read | full_scan | spilled | outcome | sql |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 412 | 4180.2 | select | 12 | 2400000 | true | false | completed | SELECT * FROM orders WHERE region = 'emea' |
| 407 | 2210.7 | select | 500 | 500 | false | true | completed | SELECT * FROM orders ORDER BY total DESC |

The first query read many rows to return a few, so it probably needs an index on
`region`. The second query read only what it returned but spilled, so the issue
is memory or an unbounded sort. Add a `LIMIT`, raise the spill threshold, or
inspect the plan with `EXPLAIN`.

`SHOW SLOW QUERIES` is never recorded in the slow query log. A dashboard or SQL
client that polls the log therefore does not erase the history it is reading.

## Dashboard

The [operator dashboard](/docs/operator-dashboard) has a **Slow queries** panel
over the same data. It shows the newest entries, highlights full scans and
spills, and refreshes independently from the rest of the page.

## Permissions and limits

`SHOW SLOW QUERIES` requires a superuser while authentication is enabled. The
rows include literal SQL text from statements run by other users, so table-level
grants cannot safely narrow the output.

Important limits:

- Entries live in memory only and disappear on restart.
- The result is node-local. Inspect each node separately in a cluster.
- The ring is bounded. If `seq` advanced by more than the ring capacity between
  reads, entries were overwritten.
- It is not an audit log. Statements below the threshold are never recorded.

## Related

- [EXPLAIN](/docs/explain)
- [Query planning](/docs/query-planning)
- [Spill to disk](/docs/spill-to-disk)
- [Engine stats](/docs/engine-stats)
- [Configuration](/docs/configuration)
