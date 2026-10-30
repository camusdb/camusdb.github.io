---
sidebar_position: 3.22
---

# SHOW STATISTICS

The query planner uses statistics about each table to choose a plan: how many
rows the table has, and how the values in each column are distributed. When
those statistics are missing or old, the planner can choose a slow plan, for
example a full scan instead of an index.

Use `SHOW STATISTICS` when:

- [`EXPLAIN`](/docs/explain) shows a row estimate that is far from the real
  count.
- A query became slow after a large load, a large delete, or fast table growth.
- You want to confirm that [automatic analyze](/docs/automatic-analyze)
  refreshed a table.

## What it reports

`SHOW STATISTICS FOR <table>` prints a table's statistics as the optimizer holds
them:

1. The row count.
2. Each column's bounds.
3. Each histogram's size.
4. The distinct-value estimates.
5. Each index's entry count.
6. How stale all of it is.

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;
```

The `TABLE` keyword is optional. Both forms mean the same thing.

The statement needs a selected database. You can run it from `camus-cli`,
through the HTTP and gRPC SQL endpoints, and as a prepared statement.

These numbers are what the cost model reads. It uses them to choose between an
index and a scan, and to decide which side of a join to build.

[EXPLAIN](/docs/explain) shows the estimate. This statement shows the inputs
behind that estimate. It also shows whether `ANALYZE` has ever run, and how much
the data has changed since it did.

Table statistics are separate from [engine statistics](/docs/engine-stats).
`SHOW ENGINE STATS` reports the process's runtime metrics for the embedded
storage and consensus libraries. This statement reports what the planner
believes about one relation.

## Result columns

The result has one row per statistics target. The `kind` column says what each
row describes.

| Column | Type | Meaning |
| --- | --- | --- |
| `table` | `STRING` | The table the statistics belong to. |
| `kind` | `STRING` | `table`, `column`, `key`, or `index`. |
| `target` | `STRING` | `NULL` on the `table` row. Otherwise the column name, the key's tuple signature, or the index name. |
| `estimated_rows` | `INT64` or `NULL` | The table's estimated row count. On an `index` row, the number of entries in that index. |
| `distinct_count` | `INT64` or `NULL` | The approximate number of distinct values, for a `column` or `key` row. |
| `min_value` | `STRING` or `NULL` | The smallest value CamusDB observed in the column. |
| `max_value` | `STRING` or `NULL` | The largest value CamusDB observed in the column. |
| `histogram_buckets` | `INT64` or `NULL` | The number of equi-depth buckets in the column's histogram. |
| `last_analyzed` | `STRING` or `NULL` | When this table was last analyzed. `NULL` when `ANALYZE` has never run. |
| `stale_mutations` | `INT64` or `NULL` | The row mutations committed since that `ANALYZE`. |

`last_analyzed` and `stale_mutations` describe the whole table, so they repeat
on every row. Any one row tells you how much to trust the others.

A `NULL` means one of two things, and `kind` tells you which. Either the value
does not apply to that row (a `distinct_count` on an `index` row), or CamusDB
never collected it (`histogram_buckets` before the first `ANALYZE`).

### Row kinds

| `kind` | One row for | It carries |
| --- | --- | --- |
| `table` | The table itself. Always present. | `estimated_rows`, `last_analyzed`, `stale_mutations` |
| `column` | Each column with an estimate. | `distinct_count`, `min_value`, `max_value`, `histogram_buckets` |
| `key` | Each key prefix of a composite index. The columns are joined with a comma, as in `city,zip`. | `distinct_count` |
| `index` | Each index on the table. | `estimated_rows`, which is the index's entry count |

CamusDB emits the `table` row even when it has collected nothing, so "this
table has no statistics" shows up as an answer, not as an empty result.

CamusDB omits columns it has observed nothing for, so the columns that do have
estimates are not buried under rows of `NULL` values.

A `key` row corrects the optimizer's independence assumption. Two equality
predicates can cover two correlated columns, such as a city and its postcode.
Multiplying their selectivities gives an estimate far more selective than the
data supports. CamusDB measures the `key` row for that prefix instead of
deriving it, so the planner uses the measurement.

Rows arrive in groups, in this order: the table row, then the columns in schema
order, then the keys and indexes in name order. This makes two runs easy to
compare.

CamusDB skips columns and indexes that are still being built, as
[`SHOW COLUMNS` and `SHOW INDEXES`](/docs/sql-inspection) do.

## A worked example

A table you just created has nothing to report, and says so:

```camussql
SHOW STATISTICS FOR robots;
```

```text
table   kind   target  estimated_rows  distinct_count  min_value  max_value  histogram_buckets  last_analyzed  stale_mutations
robots  table  NULL    NULL            NULL            NULL       NULL       NULL               NULL           0
```

Insert twenty rows without running `ANALYZE`, and the statistics that writes
maintain appear. The row count comes from this node's live counters, so it is
visible immediately, before anything is flushed to storage:

```text
robots  table   NULL      20    NULL  NULL  NULL  NULL  NULL  20
robots  column  year      NULL  NULL  2000  2019  NULL  NULL  20
robots  index   ~pk       20    NULL  NULL  NULL  NULL  NULL  20
robots  index   year_idx  20    NULL  NULL  NULL  NULL  NULL  20
```

Note what is missing: there is no `distinct_count` and no histogram. The planner
costs this table with fallback selectivity values.

`ANALYZE` fills those values in and resets the staleness counter:

```camussql
ANALYZE robots;
SHOW STATISTICS FOR robots;
```

```text
robots  table   NULL      20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22.418Z  0
robots  column  year      NULL  20    2000  2019  8     2026-08-15T09:14:22.418Z  0
robots  index   ~pk       20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22.418Z  0
robots  index   year_idx  20    NULL  NULL  NULL  NULL  2026-08-15T09:14:22.418Z  0
```

## Two kinds of statistics

The example shows the split between them.

CamusDB maintains some values as it writes each row, so they are always
approximately current: the row count, each index's entry count, and the minimum
and maximum of each indexed column. They cost nothing to keep and need no
maintenance statement.

`ANALYZE`, manual or [automatic](/docs/automatic-analyze), builds the rest: the
histograms, each column's distinct-value counts, and the same counts for
composite key prefixes. `ANALYZE` also records the minimum and maximum of the
unindexed columns it collects, up to `stats_analyze_max_columns` columns per
table; those bounds stay as they are until the next `ANALYZE`. Each histogram
can also keep up to `stats_top_values` common values with their observed
counts, and `ANALYZE` records the fraction of each column that is `NULL`. The
planner uses those internal values for skewed equalities, join cardinality, and
the number of index probes. `SHOW STATISTICS` currently shows that the histogram
exists and how many buckets it has; it does not expand its common-value list or
its NULL fraction into separate result columns.

The second group is what makes range and equality estimates accurate. A `NULL`
in `histogram_buckets` or `distinct_count` tells you it is missing.

## Read it together with EXPLAIN

When [EXPLAIN](/docs/explain) reports an `estimated_rows` you doubt, this
statement shows where that number came from.

- CamusDB prices `col = v` from the observed frequency when `v` is one of the
  common values kept with the histogram. Other values share the remaining rows
  across the remaining `distinct_count`. A `distinct_count` of `NULL` means the
  estimate fell back to a fixed constant, which can make an index look far less
  attractive than it is.
- CamusDB prices a range predicate from the histogram. A `histogram_buckets` of
  `NULL` means the same fallback.
- CamusDB prices `WHERE a = ? AND b = ?` over a composite index from the `key`
  row for `a,b`, when that row exists, instead of multiplying two independent
  selectivities.

If the estimates are wrong and the statistics are missing or old, run
`ANALYZE`.

If the estimates are wrong but `last_analyzed` is recent and `stale_mutations`
is low, the input is not the problem; look at the cost model instead. See
[Query Planning](/docs/query-planning) for how the planner uses these values.

## Staleness

`stale_mutations` counts the inserts, updates, and deletes committed since the
last `ANALYZE`.

Its ratio to `estimated_rows` is exactly the threshold that
[automatic analyze](/docs/automatic-analyze) checks. So this statement shows how
close a table is to refreshing on its own, and, for a table that never crosses
the threshold, why.

## A truncated table

[`TRUNCATE`](/docs/truncate-table) keeps the table's identity, but CamusDB
stamps each statistic with the contents generation it describes.

After a truncate, CamusDB ignores the old distribution. `SHOW STATISTICS` and
the planner both treat the new generation as unmeasured. Run `ANALYZE` after you
fill the table again.

## How values are rendered

A bound prints as the literal that produced it. Dates and timestamps use
ISO-8601, UUIDs use the canonical form, and numbers use the invariant culture
with no digit separators.

`last_analyzed` prints as a UTC timestamp in ISO-8601 form with millisecond
precision, for example `2026-08-15T09:33:13.289Z`.

That column answers one question: how old are the statistics? You judge the
answer against a wall clock, so the value renders as a clock reading, not as the
raw [hybrid logical clock](/docs/concepts#hlc) value the engine stores.

String bounds are ordinal, matching the byte order the indexes use. A value such
as `'árbol'` therefore sorts after `'zebra'`, not before it, just as an index
scan orders them.

CamusDB tracks bounds only for ordered types, so a boolean column reports none.

## Scope and freshness

The values are the view of the node that answers.

A node that already tracks the table answers from its live counters, which
include mutations it has not yet flushed to storage. Its answer is fresher than
the persisted state.

A node that does not track the table reads the persisted statistics with a point
read, without starting to track the table. Inspecting a table never makes it
resident.

Each node caches statistics, and an `ANALYZE` on one node does not invalidate
another node's cached copy. Two nodes in a cluster can therefore report
different values for the same table for a while. To confirm that an `ANALYZE`
published its result, run the statement on the node that ran it.

Everything here is advisory. Missing or unreadable statistics render as `NULL`;
they never make the statement fail.

## A materialized view

A [materialized view](/docs/materialized-views) stores its own rows, so it has
its own statistics and is a valid target for this statement.

It reports those statistics right after a refresh, without waiting for
`ANALYZE`. Populating the view counts the rows and index entries as it writes
them, and the refresh hands those counts to the view along with the storage they
describe.

A refresh produces no histograms and no distinct-value counts; only `ANALYZE`
builds those. The refresh also discards the ones for the previous contents,
because they describe rows that no longer exist.

So right after a refresh, a view reports exact counts, no distributions, and a
`last_analyzed` of `NULL`. Its `stale_mutations` shows the rows CamusDB just
wrote, which lets automatic analyze notice the view and fill in the rest.

A plain [view](/docs/views) stores nothing and has no statistics of its own. The
statement says so with `CADB0523` and points you at the tables the view's
definition reads.

## Permissions

`SHOW STATISTICS` needs only `SELECT` on the table. The bounds are real values
from the table's columns, so reading them has the same requirement as selecting
from the table.

Unlike the statements that inspect configuration and the engine, this one does
not require a superuser. `SHOW VARIABLES`, `SHOW ENGINE STATS`, and
`SHOW CLUSTER SETTINGS` describe the node; this statement describes one relation
the caller can already read.

`STATISTICS` is not a reserved word, so you can still use it as a table or
column name.

## Related pages

- [Automatic Analyze](/docs/automatic-analyze) for refreshing these statistics
  in the background.
- [Query Planning](/docs/query-planning) for how the optimizer uses them.
- [EXPLAIN](/docs/explain) for where `estimated_rows` comes from.
- [Engine Stats](/docs/engine-stats) for the equivalent statement for runtime
  metrics.
