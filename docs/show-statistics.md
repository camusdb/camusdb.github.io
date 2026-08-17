---
sidebar_position: 3.22
---

# SHOW STATISTICS

`SHOW STATISTICS FOR <table>` prints the optimizer's table statistics: the row
count, per-column bounds, histogram sizes, distinct-value estimates, per-index
entry counts, and how stale all of it has become.

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;
```

`TABLE` is an optional noise word; both forms mean the same thing. The statement
needs a selected database, and it runs from `camus-cli`, the HTTP SQL endpoint,
the gRPC SQL endpoint, and as a prepared statement.

These are the numbers the cost model reads when it decides between an index and
a scan, or which side of a join to build. [EXPLAIN](/docs/explain) shows the
estimate; this statement shows the inputs that produced it, whether `ANALYZE`
has ever run, and how far the data has moved since it did.

Table statistics are a separate thing from
[engine statistics](/docs/engine-stats). `SHOW ENGINE STATS` reports Kahuna and
Kommander runtime metrics for the process; this statement reports what the
planner believes about one relation.

## Result Columns

One row per statistics target, with the `kind` column saying what each row
describes.

| Column | Type | Meaning |
| --- | --- | --- |
| `table` | `STRING` | The table the statistics belong to. |
| `kind` | `STRING` | `table`, `column`, `key`, or `index`. |
| `target` | `STRING` | `NULL` on the `table` row; otherwise the column name, the key-tuple signature, or the index name. |
| `estimated_rows` | `INT64` or `NULL` | Estimated rows in the table. On an `index` row, that index's entry count. |
| `distinct_count` | `INT64` or `NULL` | Approximate distinct values for a `column` or `key` row. |
| `min_value` | `STRING` or `NULL` | Smallest value observed in the column. |
| `max_value` | `STRING` or `NULL` | Largest value observed in the column. |
| `histogram_buckets` | `INT64` or `NULL` | Equi-depth buckets in the column's histogram. |
| `last_analyzed` | `STRING` or `NULL` | When `ANALYZE` last read this table. `NULL` if it never has. |
| `stale_mutations` | `INT64` or `NULL` | Row mutations committed since that `ANALYZE`. |

`last_analyzed` and `stale_mutations` describe the whole table, so they repeat
on every row. Any single row tells you how much to trust the rest of them.

A `NULL` means one of two things, and `kind` tells you which. Either the value
does not apply to that row, such as `distinct_count` on an `index` row, or it
has never been collected, such as `histogram_buckets` before the first
`ANALYZE`.

### Row Kinds

| `kind` | One row per | Carries |
| --- | --- | --- |
| `table` | The table itself. Always present. | `estimated_rows`, `last_analyzed`, `stale_mutations` |
| `column` | Column holding any estimate. | `distinct_count`, `min_value`, `max_value`, `histogram_buckets` |
| `key` | Composite-index key prefix, columns comma-joined, as in `city,zip`. | `distinct_count` |
| `index` | Index on the table. | `estimated_rows`, meaning that index's entry count |

The `table` row is emitted even when nothing has ever been collected, so "this
table has no statistics" is a visible answer rather than an empty result. A
column that nothing has been observed for is left out entirely, which keeps the
columns that do carry estimates from being buried under all-`NULL` rows.

`key` rows exist to correct the optimizer's independence assumption. Two
equality predicates over correlated columns, such as a city and its postcode,
multiply out to a far more selective estimate than the data supports; the key
row for that prefix is measured rather than derived, so the planner uses it
instead.

Rows arrive grouped in that order: the table row, then columns in schema order,
then keys and indexes ordered by name. Repeated runs are therefore easy to
compare. Columns and indexes that are still being built are skipped, the same
way [`SHOW COLUMNS` and `SHOW INDEXES`](/docs/sql-inspection) skip them.

## A Worked Example

A freshly created table has nothing to report, and says so:

```camussql
SHOW STATISTICS FOR robots;
```

```text
table   kind   target  estimated_rows  distinct_count  min_value  max_value  histogram_buckets  last_analyzed  stale_mutations
robots  table  NULL    NULL            NULL            NULL       NULL       NULL               NULL           0
```

After inserting twenty rows, still without running `ANALYZE`, the
write-maintained statistics appear. The row count comes from this node's live
counters, so it is visible immediately, before anything is flushed to storage:

```text
robots  table   NULL      20    NULL  NULL  NULL  NULL  NULL  20
robots  column  year      NULL  NULL  2000  2019  NULL  NULL  20
robots  index   ~pk       20    NULL  NULL  NULL  NULL  NULL  20
robots  index   year_idx  20    NULL  NULL  NULL  NULL  NULL  20
```

Note what is absent: no `distinct_count`, no histogram. The planner is costing
this table with fallback selectivities. `ANALYZE` fills those in and resets the
staleness counter:

```camussql
ANALYZE robots;
SHOW STATISTICS FOR robots;
```

```text
robots  table   NULL      20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22Z  0
robots  column  year      NULL  20    2000  2019  8     2026-08-15T09:14:22Z  0
robots  index   ~pk       20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22Z  0
robots  index   year_idx  20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22Z  0
```

## Two Kinds Of Statistic

The split visible above is the one worth internalizing.

Some values are maintained incrementally as rows are written, so they are always
roughly current: the row count, per-index entry counts, and per-column min/max
for indexed columns. They cost nothing to keep and need no maintenance
statement.

The rest are built only by `ANALYZE`, manual or
[automatic](/docs/automatic-analyze): histograms, per-column distinct-value
counts, and distinct-value counts for composite key prefixes. These are the ones
that make range and equality estimates accurate, and their absence is what a
`NULL` `histogram_buckets` or `distinct_count` is telling you.

## Reading It Alongside EXPLAIN

When [EXPLAIN](/docs/explain) reports an `estimated_rows` you do not believe,
this statement shows where that number came from.

- `col = v` is priced at `1 / distinct_count`. A `distinct_count` of `NULL`
  means the estimate fell back to a fixed constant, which can make an index look
  far less attractive than it is.
- Range predicates are priced from the histogram. A `histogram_buckets` of
  `NULL` means the same fallback.
- `WHERE a = ? AND b = ?` over a composite index is priced from the `key` row
  for `a,b` when one exists, rather than by multiplying two independent
  selectivities.

If the estimates are off and the statistics are missing or old, run `ANALYZE`.
If they are off while `last_analyzed` is recent and `stale_mutations` is low,
the cost model rather than its input is what to look at. See
[Query Planning](/docs/query-planning) for how these values are consumed.

## Staleness

`stale_mutations` counts inserts, updates, and deletes committed since the last
`ANALYZE`. Its ratio to `estimated_rows` is exactly what
[automatic analyze](/docs/automatic-analyze) thresholds on, so this statement
shows how close a table is to being refreshed on its own, and on a table that
never crosses the threshold, why it never is.

## Value Rendering

Bounds print as the literal that produced them: dates and timestamps in
ISO-8601, UUIDs in canonical form, numbers in invariant culture with no digit
separators.

`last_analyzed` prints as a UTC ISO-8601 timestamp with millisecond precision,
such as `2026-08-15T09:33:13.289Z`. The question it answers is how old the
statistics are, which a reader judges against wall-clock time, so it renders as
a clock reading rather than as the raw hybrid logical clock value the engine
stores.

String bounds are ordinal, matching the byte order the indexes themselves use.
A value such as `"árbol"` therefore sorts above `"zebra"` rather than before it,
exactly as it does in an index scan. Bounds are tracked only for ordered types,
so a boolean column reports none.

## Scope And Freshness

The values are the answering node's view.

A node that is already tracking the table answers from its live counters, which
include mutations it has not flushed to storage yet. That is fresher than what
is persisted. A node that is not tracking the table point-reads the persisted
statistics instead, without starting to track it, so inspecting a table never
makes it resident.

Statistics are cached per node, and an `ANALYZE` on one node does not invalidate
another node's cached copy, so two nodes in a cluster can report different
values for the same table for a while. To confirm that an `ANALYZE` published,
run the statement on the node that ran it.

Everything here is advisory. Statistics that are missing or unreadable render as
`NULL`s; they are never a statement error.

## Materialized Views

A [materialized view](/docs/materialized-views) stores its own rows, so it has
its own statistics and is a valid target. It reports them straight after a
refresh, without waiting for an `ANALYZE`: the population counts rows and index
entries as it writes them, and the refresh hands those counts to the view along
with the storage they describe.

What a refresh does not produce is histograms or distinct-value counts, since
only `ANALYZE` builds those, and it discards the ones the previous contents had,
because they describe rows that no longer exist. A freshly refreshed view
therefore reports exact counts, no distributions, and a `last_analyzed` of
`NULL`. Its `stale_mutations` reflects the rows just written, which is what lets
automatic analyze notice it and fill in the rest.

A plain [view](/docs/views) stores nothing and has no statistics of its own. The
statement says so with `CADB0523` and points you at the tables the view's
definition reads.

## Permissions

`SHOW STATISTICS` requires `SELECT` on the table, and nothing more. The bounds
are real values drawn from the table's columns, so reading them is held to the
same bar as selecting from it.

Unlike the configuration and engine introspection statements, this one is not
superuser-gated. `SHOW VARIABLES`, `SHOW ENGINE STATS`, and
`SHOW CLUSTER SETTINGS` describe the node; this describes one relation the
caller can already read.

`STATISTICS` is not a reserved word. It remains usable as a table and column
name.

## Related Pages

[Automatic Analyze](/docs/automatic-analyze) for how these statistics are
refreshed in the background, [Query Planning](/docs/query-planning) for how the
optimizer consumes them, [EXPLAIN](/docs/explain) for where `estimated_rows`
comes from, and [Engine Stats](/docs/engine-stats) for the runtime-metrics
counterpart.
