---
sidebar_position: 3.22
---

# SHOW STATISTICS

`SHOW STATISTICS FOR <table>` prints the statistics of a table, as the optimizer
holds them. It reports six things:

1. The row count.
2. The bounds of each column.
3. The size of each histogram.
4. The estimates of the distinct values.
5. The count of the entries of each index.
6. The staleness of all of it.

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;
```

`TABLE` is an optional word. Both forms mean the same thing.

The statement needs a selected database. It runs from `camus-cli`, from the SQL
endpoint of HTTP, from the SQL endpoint of gRPC, and as a prepared statement.

These numbers are what the cost model reads. It uses them for two decisions:
between an index and a scan, and about the side of a join to build.

[EXPLAIN](/docs/explain) shows the estimate. This statement shows the inputs
that produced that estimate. It also shows whether an `ANALYZE` ever ran, and
how far the data moved since that run.

The statistics of a table are separate from the
[statistics of the engine](/docs/engine-stats). `SHOW ENGINE STATS` reports the
runtime metrics of Kahuna and of Kommander, for the process. This statement
reports the belief of the planner about one relation.

## The columns of the result

There is one row for each target of the statistics. The `kind` column says what
each row describes.

| Column | Type | Meaning |
| --- | --- | --- |
| `table` | `STRING` | The table of the statistics. |
| `kind` | `STRING` | `table`, `column`, `key`, or `index`. |
| `target` | `STRING` | It is `NULL` on the `table` row. Otherwise it holds the name of the column, the signature of the tuple of a key, or the name of the index. |
| `estimated_rows` | `INT64` or `NULL` | The estimated rows of the table. On an `index` row, it is the count of the entries of that index. |
| `distinct_count` | `INT64` or `NULL` | The approximate number of the distinct values, for a `column` row or a `key` row. |
| `min_value` | `STRING` or `NULL` | The smallest value that CamusDB observed in the column. |
| `max_value` | `STRING` or `NULL` | The largest value that CamusDB observed in the column. |
| `histogram_buckets` | `INT64` or `NULL` | The equi-depth buckets of the histogram of the column. |
| `last_analyzed` | `STRING` or `NULL` | The time of the last `ANALYZE` of this table. It is `NULL` when no `ANALYZE` ever ran. |
| `stale_mutations` | `INT64` or `NULL` | The row mutations that committed after that `ANALYZE`. |

`last_analyzed` and `stale_mutations` describe the whole table. They therefore
repeat on every row. Any one row tells you how much to trust the other rows.

A `NULL` means one of two things, and `kind` tells you which one. The value does
not apply to that row, as with a `distinct_count` on an `index` row. Or CamusDB
never collected the value, as with a `histogram_buckets` before the first
`ANALYZE`.

### The kinds of a row

| `kind` | One row for | It carries |
| --- | --- | --- |
| `table` | The table itself. It is always present. | `estimated_rows`, `last_analyzed`, `stale_mutations` |
| `column` | Each column with an estimate. | `distinct_count`, `min_value`, `max_value`, `histogram_buckets` |
| `key` | Each prefix of the key of a composite index. The columns join with a comma, as in `city,zip`. | `distinct_count` |
| `index` | Each index of the table. | `estimated_rows`, which is the count of the entries of that index |

CamusDB emits the `table` row even when it collected nothing. The answer "this
table has no statistics" is therefore visible. It is not an empty result.

CamusDB omits a column that it observed nothing for. The columns with an
estimate therefore stay visible. Rows of only `NULL` values do not bury them.

A `key` row corrects the assumption of independence of the optimizer. Two
predicates of an equality can cover two correlated columns, such as a city and
its postcode. A multiplication of the two gives an estimate far more selective
than the data supports. CamusDB measures the `key` row for that prefix. It does
not derive that row. The planner therefore uses the measurement.

The rows arrive in groups, in this order: the table row, then the columns in the
order of the schema, then the keys and the indexes in the order of their names.
Two runs are therefore easy to compare.

CamusDB skips a column and an index that it still builds.
[`SHOW COLUMNS` and `SHOW INDEXES`](/docs/sql-inspection) skip them in the same
way.

## A worked example

A table that you created a moment ago has nothing to report, and it says so:

```camussql
SHOW STATISTICS FOR robots;
```

```text
table   kind   target  estimated_rows  distinct_count  min_value  max_value  histogram_buckets  last_analyzed  stale_mutations
robots  table  NULL    NULL            NULL            NULL       NULL       NULL               NULL           0
```

Insert twenty rows, and run no `ANALYZE`. The statistics that a write maintains
then appear. The row count comes from the live counters of this node. It is
therefore visible immediately, before any flush to the storage:

```text
robots  table   NULL      20    NULL  NULL  NULL  NULL  NULL  20
robots  column  year      NULL  NULL  2000  2019  NULL  NULL  20
robots  index   ~pk       20    NULL  NULL  NULL  NULL  NULL  20
robots  index   year_idx  20    NULL  NULL  NULL  NULL  NULL  20
```

Note what is absent. There is no `distinct_count`, and there is no histogram.
The planner costs this table with fallback values of the selectivity.

`ANALYZE` fills those values in. It also resets the counter of the staleness:

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

## Two kinds of statistic

The division above is worth your attention.

CamusDB maintains some values as it writes a row. They are therefore always
approximately current. Those values are the row count, the count of the entries
of each index, and the minimum and the maximum of each indexed column. They cost
nothing to keep, and they need no statement of maintenance.

`ANALYZE` builds the rest, either the manual form or the
[automatic](/docs/automatic-analyze) one. Those values are the histograms, the
counts of the distinct values of each column, and the same counts for a prefix
of a composite key.

The second group makes an estimate of a range, and an estimate of an equality,
accurate. Their absence is what a `NULL` in `histogram_buckets` or in
`distinct_count` tells you.

## Read it together with EXPLAIN

[EXPLAIN](/docs/explain) can report an `estimated_rows` that you doubt. This
statement then shows the source of that number.

- CamusDB prices `col = v` at `1 / distinct_count`. A `distinct_count` of `NULL`
  means that the estimate fell back to a fixed constant. An index can then look
  far less attractive than it is.
- CamusDB prices a predicate of a range from the histogram. A
  `histogram_buckets` of `NULL` means the same fallback.
- CamusDB prices `WHERE a = ? AND b = ?` over a composite index from the `key`
  row for `a,b`, where that row exists. It does not multiply two independent
  values of a selectivity.

Run `ANALYZE` when the estimates are wrong, and the statistics are absent or
old.

Look at the cost model instead when the estimates are wrong, `last_analyzed` is
recent, and `stale_mutations` is low. The input is then not the problem. See
[Query Planning](/docs/query-planning) for the use of these values.

## Staleness

`stale_mutations` counts the inserts, the updates, and the deletes that
committed after the last `ANALYZE`.

The ratio of that count to `estimated_rows` is exactly the threshold of
[automatic analyze](/docs/automatic-analyze). This statement therefore shows how
near a table is to a refresh of its own. For a table that never passes the
threshold, it shows the reason.

## A truncated table

[`TRUNCATE`](/docs/truncate-table) keeps the identity of the table. CamusDB
nevertheless stamps a statistic with the contents generation that it describes.

After a truncate, CamusDB ignores the previous distribution. `SHOW STATISTICS`
and the planner both treat the new generation as a generation without a
measurement. Run `ANALYZE` after you fill the table again.

## The rendering of a value

A bound prints as the literal that produced it. A date and a timestamp use
ISO-8601. A UUID uses the canonical form. A number uses the invariant culture,
with no separator of the digits.

`last_analyzed` prints as a timestamp in UTC, in the ISO-8601 form, with a
precision of a millisecond. One example is `2026-08-15T09:33:13.289Z`.

That column answers one question: how old are the statistics? A reader judges
the answer against the time of a clock. The value therefore renders as a reading
of a clock. It does not render as the raw value of the hybrid logical clock that
the engine stores.

A bound of a string is ordinal. It matches the order of the bytes that the
indexes use. A value such as `"árbol"` therefore sorts above `"zebra"`. It does
not sort before it. An index scan gives the same order.

CamusDB tracks a bound for an ordered type only. A boolean column therefore
reports none.

## The scope, and the freshness

The values are the view of the node that answers.

A node that already tracks the table answers from its live counters. Those
counters include a mutation that the node did not flush to the storage yet. The
answer is therefore fresher than the persisted state.

A node that does not track the table reads the persisted statistics with a point
read. It does not start to track the table. An inspection of a table therefore
never makes that table resident.

Each node caches the statistics. An `ANALYZE` on one node does not invalidate
the cached copy of another node. Two nodes of a cluster can therefore report
different values for the same table, for a time. Run the statement on the node
that ran the `ANALYZE`, to confirm that the `ANALYZE` published its result.

Everything here is advisory. Statistics that are absent or unreadable render as
a `NULL`. They are never an error of the statement.

## A materialized view

A [materialized view](/docs/materialized-views) stores its own rows. It
therefore has its own statistics, and it is a valid target of this statement.

It reports those statistics immediately after a refresh. It waits for no
`ANALYZE`. The population counts the rows and the entries of the indexes as it
writes them. The refresh hands those counts to the view, together with the
storage that they describe.

A refresh produces no histogram, and no count of the distinct values. Only an
`ANALYZE` builds those. The refresh also discards the ones of the previous
contents, because they describe rows that no longer exist.

A view immediately after a refresh therefore reports three things: exact counts,
no distributions, and a `last_analyzed` of `NULL`. Its `stale_mutations` shows
the rows that CamusDB just wrote. That value lets automatic analyze notice the
view, and fill the rest in.

A plain [view](/docs/views) stores nothing. It has no statistics of its own. The
statement says so with `CADB0523`. It points you at the tables that the
definition of the view reads.

## Permissions

`SHOW STATISTICS` needs `SELECT` on the table, and nothing more. The bounds are
real values from the columns of the table. A read of them therefore has the same
requirement as a `SELECT` from that table.

This statement has no gate of a superuser. The statements that inspect the
configuration and the engine do. `SHOW VARIABLES`, `SHOW ENGINE STATS`, and
`SHOW CLUSTER SETTINGS` describe the node. This statement describes one relation
that the caller can already read.

`STATISTICS` is not a reserved word. You can still use it as the name of a
table, and as the name of a column.

## Related pages

- [Automatic Analyze](/docs/automatic-analyze) for the refresh of these
  statistics in the background.
- [Query Planning](/docs/query-planning) for the use of them by the optimizer.
- [EXPLAIN](/docs/explain) for the source of `estimated_rows`.
- [Engine Stats](/docs/engine-stats) for the equivalent statement for the
  runtime metrics.
