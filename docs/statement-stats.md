---
sidebar_position: 3.73
---

# Statement statistics

Statement statistics show the queries that use the most time in total. A query
that takes 2 ms can cost more than a slow report if you run it a million times a
day. The [slow query log](/docs/slow-query-log) doesn't show such a query.
Each execution is fast. Similar statements are grouped, and the totals
are kept for each group. The feature is similar to `pg_stat_statements` in
PostgreSQL.

The examples on this page use the following data. Load it before you turn on
collection:

<details>
<summary>Sample data for the examples on this page</summary>

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

## Turn on collection

Collection is off by default. To turn it on for a node, set it in `config.yml`:

```yaml
statement_stats_enabled: true
statement_stats_max_shapes: 2000
```

To turn it on for all nodes of a running cluster, use a
[cluster setting](/docs/runtime-cluster-settings). The change applies to the
next statement:

```camussql
SET CLUSTER SETTING statement_stats_enabled = true;
```

Then read the totals:

```camussql
SHOW STATEMENT STATS;
SHOW STATEMENT STATS LIKE '%orders%';
```

`SHOW STATEMENT STATS` needs a superuser. When you turn off collection, the
existing totals are kept. A change to `statement_stats_max_shapes` needs a
restart.

## How statements are grouped

A **shape** is a statement with its literal values and parameters removed.
For example, `WHERE id = 1` and `WHERE id = @id` have the same shape. An `IN`
list of constants and a `VALUES` list with several rows have one shape for all
lengths. Identifiers aren't case-sensitive in a shape.

For example, these two queries differ only in a literal:

```camussql
SELECT id, total FROM orders WHERE customer_id = 7;
SELECT id, total FROM orders WHERE customer_id = 9;
```

The result is wide. In camus-cli, end the statement with [`\G`](/docs/camus-cli#vertical-output) to print one column per line:

```camussql
SHOW STATEMENT STATS LIKE '%orders%'\G
```

```text
*************************** 1. row ***************************
         node: localhost:0
     database: docs_inspect
     shape_id: cfb51db7d2b1b0af
         kind: select
   sample_sql: SELECT id, total FROM orders WHERE customer_id = 7
        calls: 2
       errors: 0
     total_ms: 5.248
    sum_sq_ms: 23.293000000000003
       min_ms: 0.442
       max_ms: 4.806
      mean_ms: 2.624
    stddev_ms: 2.182
           cv: 0.8315548780487805
    rows_read: 4
rows_returned: 4
   full_scans: 0
       spills: 0
      retries: 0
 plan_changes: 0
    last_plan: 7cd3803e726712ab
first_seen_at: 2026-11-18T21:52:07.715Z
 last_seen_at: 2026-11-18T21:52:07.728Z
1 rows in set (00:00:00.0247123)
```

The two queries have one shape. This means that `calls` is 2, and `sample_sql`
shows the first text.

Each row is identified by the database and a 16-character `shape_id`. For the
same build, the `shape_id` of a statement is the same on all nodes and after a
restart.

Totals are recorded for queries and DML, including `RETURNING` and
`INSERT ... SELECT`. Other statements, such as DDL and `SHOW`, aren't recorded.

An execution is recorded when it ends, also if it fails. A cursor that is
open isn't counted yet.

## Read the result

| Columns | Meaning |
| --- | --- |
| `node`, `database`, `shape_id`, `kind` | The node, the database, the shape, and the statement kind (`select`, `insert`, `update`, or `delete`). |
| `sample_sql` | The first statement text of the shape. Password literals are redacted, and the text is cut to `slow_query_log_max_sql_length` characters. Other literals can stay in the text. |
| `calls`, `errors` | The executions that ended, and the executions that failed. |
| `total_ms`, `sum_sq_ms` | The sum of the durations, and the sum of the squared durations. |
| `min_ms`, `max_ms` | The shortest and the longest execution since the shape first appeared. |
| `mean_ms`, `stddev_ms`, `cv` | The mean, the standard deviation, and the coefficient of variation (the standard deviation divided by the mean). |
| `rows_read`, `rows_returned` | The rows read from storage, and the rows returned. For a write, `rows_returned` is the number of changed rows. The rules are the same as in the [slow query log](/docs/slow-query-log). |
| `full_scans`, `spills` | The executions with a full table scan, and the executions that [spilled to disk](/docs/spill-to-disk). |
| `retries` | The executions that failed with a retryable error (`CADB0502`, `CADB0504`, or `CADB0505`). A successful retry by the client isn't counted. |
| `plan_changes`, `last_plan` | The number of times the plan was different from the plan of the previous execution, and the hash of the latest plan. `last_plan` is `NULL` if no plan was built. |
| `first_seen_at`, `last_seen_at` | The UTC times of the first and the latest execution. |

The rows are sorted by `cv`, highest first. A high variation can come from plan
changes or from different cache states. To find the cause, look at the plan and
the workload. The plan hash covers the structure of the plan, such as the
tables and the indexes. Literal values and estimates don't change it.

To start an investigation, look at the following columns:

- A high `total_ms` shows the shapes that cost the most time in total.
- A high `rows_read` compared with `rows_returned` can mean that a filter or an
  index is missing.
- `full_scans` and `spills` show the shapes whose plans scan or spill.
- `plan_changes` shows the shapes whose plan changed.

For the plan of one execution, use [EXPLAIN](/docs/explain). To see which
indexes the workload uses, use [index usage](/docs/index-usage).

## Measure a time window

The totals grow from the start of collection. To measure a time window, take
two readings and subtract the columns that add up. For example:

- The mean duration in the window is `Δtotal_ms / Δcalls`.
- The variance in the window is `Δsum_sq_ms / Δcalls − (Δtotal_ms / Δcalls)²`.

The other columns, such as `min_ms` and `cv`, describe the full life of the
shape. You can't subtract them.

## Capacity

Existing shapes aren't removed to make room. When the table is full, new shapes
aren't recorded. To check, read the metrics:

```camussql
SHOW ENGINE STATS LIKE 'statement_stats.%';
```

```text
┌─────────────┬─────────┬─────────────────────────┬──────┬─────────┬───────┬───────┬──────┬──────┬──────┐
│ node        │ source  │ metric                  │ tags │ kind    │ count │ total │ min  │ max  │ last │
├─────────────┼─────────┼─────────────────────────┼──────┼─────────┼───────┼───────┼──────┼──────┼──────┤
│ localhost:0 │ camusdb │ statement_stats.dropped │      │ counter │ 0     │ 0     │ null │ null │ null │
│ localhost:0 │ camusdb │ statement_stats.shapes  │      │ gauge   │ 1     │ null  │ null │ null │ 1    │
└─────────────┴─────────┴─────────────────────────┴──────┴─────────┴───────┴───────┴──────┴──────┴──────┘
2 rows in set (00:00:00.0021135)
```

`statement_stats.shapes` is the number of shapes. `statement_stats.dropped`
counts the shapes that weren't recorded. If `dropped` goes up, the result is
incomplete. Increase `statement_stats_max_shapes` and restart the node.

## Limits

- The totals are kept in memory, and a restart resets them.
- The totals describe one node. For a cluster, read them on each node.
- To keep a history, store the readings outside the database.

For single executions over a time threshold, use the
[slow query log](/docs/slow-query-log).
