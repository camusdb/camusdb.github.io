---
sidebar_position: 3.73
---

# Statement statistics

Statement statistics help you find queries that consume the most time overall,
even when each execution is too fast for the slow query log. CamusDB groups
similar statements and keeps their execution counts, durations, rows read,
failures, spills, and plan changes. This serves a similar purpose to
PostgreSQL's `pg_stat_statements`.

## Enable collection

Collection is off by default. Configure the node:

```yaml
statement_stats_enabled: true
statement_stats_max_shapes: 2000
```

You can also enable it at runtime:

```camussql
SET CLUSTER SETTING statement_stats_enabled = true;
SHOW STATEMENT STATS;
SHOW STATEMENT STATS LIKE '%orders%';
```

`statement_stats_enabled` is node-scoped and affects the next statement.
Turning it off preserves existing totals. `statement_stats_max_shapes` requires
a restart. Sample SQL length is bounded by `slow_query_log_max_sql_length`.
The inspection statement requires a superuser.

## How statements are grouped

A **shape** identifies a statement with its literal values and placeholders
removed. `WHERE id = 1`, `WHERE id = 2`, and `WHERE id = @id` share one shape.
Constant-only `IN` lists and multi-row `VALUES` lists share a shape regardless
of their length. Identifiers are compared without case.

Each row is keyed by database and a 16-character `shape_id`, stable across
nodes and restarts for the same build. Totals are recorded for `SELECT`,
`INSERT`, `UPDATE`, and `DELETE`, including `RETURNING` and `INSERT ... SELECT`.
DDL, transaction control, and `SHOW` statements are excluded.

An execution is recorded when it finishes, fails, or its cursor is abandoned.
An open cursor has not yet contributed its final counters.

## Read the result

| Columns | Meaning |
| --- | --- |
| `node`, `database`, `shape_id`, `kind` | Node, database, statement fingerprint, and kind (`select`, `insert`, `update`, or `delete`). |
| `sample_sql` | First statement text seen for the shape, with password literals redacted and text truncated to the configured limit. Other literals can remain. |
| `calls`, `errors` | Executions that ended, and executions that failed. |
| `total_ms`, `sum_sq_ms` | Sum of durations and sum of squared durations. |
| `min_ms`, `max_ms` | Shortest and longest execution since the shape was first seen. |
| `mean_ms`, `stddev_ms`, `cv` | Mean, standard deviation, and coefficient of variation (standard deviation divided by mean). |
| `rows_read`, `rows_returned` | Storage rows read and rows returned; for writes, returned means affected rows. Uses the [slow query log's counting rules](/docs/slow-query-log). |
| `full_scans`, `spills` | Executions with a full relation scan or a blocking operator that spilled to disk. |
| `retries` | Failed executions with `CADB0502`, `CADB0504`, or `CADB0505`; counts retryable failures, not successful client retries. |
| `plan_changes`, `last_plan` | Changes from the previous execution's plan and the latest plan hash. `last_plan` is null when no plan was built. |
| `first_seen_at`, `last_seen_at` | UTC timestamps for the shape's first and latest observations. |

Results are ordered by `cv`, highest first. High variation can point to plan
changes or different cache states; inspect the plan and workload to establish
the cause. Plan hashes include node kinds, tables, access paths, and indexes,
without literal values, bounds, or estimates.

For an initial investigation:

- High `total_ms` identifies expensive shapes across the whole observation period.
- High `rows_read` relative to `rows_returned` suggests checking filters and indexes.
- `full_scans`, `spills`, and `plan_changes` direct you to specific plan behavior.

Use [EXPLAIN](/docs/explain) for the plan of one execution, and
[index usage](/docs/index-usage) to check which indexes serve the workload.

## Measure a time window

Totals are cumulative. Take two readings and subtract additive columns to
measure a window. For example, window mean duration is `Δtotal_ms / Δcalls`;
window variance is `Δsum_sq_ms / Δcalls − (Δtotal_ms / Δcalls)²`.
The reported minimum, maximum, and derived statistics describe the whole life
of the shape, so they cannot be subtracted to obtain window values.

The table never evicts existing shapes. When capacity is full, new shapes are
not admitted. Inspect the `camusdb` metrics:

```camussql
SHOW ENGINE STATS LIKE 'statement_stats.%';
```

`statement_stats.shapes` reports the current count and
`statement_stats.dropped` counts refused admissions. A growing dropped count
means the report is incomplete; increase the capacity and restart if needed.

Counters live in memory and reset at restart. They describe one node only;
collect from every node for a cluster view and retain readings externally for
history. The [slow query log](/docs/slow-query-log) complements these totals
with individual executions over a threshold.
