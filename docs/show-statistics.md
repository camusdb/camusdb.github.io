---
sidebar_position: 3.22
description: "See the table statistics that the CamusDB query planner uses: row counts, column bounds, histograms, distinct counts, index entry counts, and how stale they are."
---

# SHOW STATISTICS

`SHOW STATISTICS` shows the table statistics that the query planner uses to
choose a plan: the number of rows, and how the values of each column are
distributed. If these statistics are missing or old, the planner can choose a
slow plan, for example a full scan in place of an index.

Use `SHOW STATISTICS` in the following cases:

- [`EXPLAIN`](/docs/explain) shows a row estimate that is far from the real
  count.
- A query became slow after a large load or a large delete.
- You want to confirm that [automatic analyze](/docs/automatic-analyze)
  refreshed a table.

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;
```

The `TABLE` keyword is optional. The statement needs a selected database, and
it works in `camus-cli`, over the HTTP and gRPC APIs, and as a prepared
statement.

`EXPLAIN` shows an estimate. This statement shows the inputs of that estimate.
It also shows when `ANALYZE` last ran on the table, and how much the data
changed since then.

Table statistics aren't the same as [engine statistics](/docs/engine-stats).
`SHOW ENGINE STATS` shows the runtime metrics of the storage and replication
layers.

## Result columns

The result has one row for each statistics target. The `kind` column says what
a row describes.

| Column | Type | Meaning |
| --- | --- | --- |
| `table` | `STRING` | The table that the statistics belong to. |
| `kind` | `STRING` | `table`, `column`, `key`, or `index`. |
| `target` | `STRING` | `NULL` on the `table` row. On the other rows, the column name, the key columns, or the index name. |
| `estimated_rows` | `INT64` or `NULL` | The estimated row count of the table. On an `index` row, the number of entries in the index. |
| `distinct_count` | `INT64` or `NULL` | The estimated number of distinct values, on a `column` or `key` row. |
| `min_value` | `STRING` or `NULL` | The smallest value seen in the column. |
| `max_value` | `STRING` or `NULL` | The largest value seen in the column. |
| `histogram_buckets` | `INT64` or `NULL` | The number of equi-depth buckets in the histogram of the column. |
| `last_analyzed` | `STRING` or `NULL` | When the table was last analyzed. `NULL` if `ANALYZE` hasn't run. |
| `stale_mutations` | `INT64` or `NULL` | The rows changed since that `ANALYZE`. |

`last_analyzed` and `stale_mutations` describe the table, and they repeat on
each row. Any row tells you how far you can trust the others.

A `NULL` has one of two meanings. Either the value doesn't apply to the row,
such as `distinct_count` on an `index` row, or it wasn't collected yet, such as
`histogram_buckets` before the first `ANALYZE`.

### Row kinds

| `kind` | One row for | Values |
| --- | --- | --- |
| `table` | The table. This row is always present. | `estimated_rows`, `last_analyzed`, `stale_mutations` |
| `column` | Each column with an estimate. | `distinct_count`, `min_value`, `max_value`, `histogram_buckets` |
| `key` | Each key prefix of a composite index, such as `kind,year`. | `distinct_count` |
| `index` | Each index of the table. | `estimated_rows`, the entry count of the index |

A table that wasn't measured yet returns the `table` row, with `NULL` values. A
column appears when it has an estimate.

A `key` row measures how many distinct value combinations a composite index
prefix has. Two columns can be related, such as a city and its postal code. If
the planner multiplied the selectivity of each column, its estimate for
`city = ? AND zip = ?` would be much too low. The `key` row gives the measured
value.

The rows come in groups, in this order: the table row, the columns in schema
order, and then the keys and indexes in name order. This makes it easy to
compare two results.

Columns and indexes that are being built aren't shown, as in
[`SHOW COLUMNS` and `SHOW INDEXES`](/docs/sql-inspection).

## Statistics before and after ANALYZE

Create the tutorial's `robots` table with an index on `year`:

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024)
);
CREATE INDEX robots_year_idx ON robots (year);
```

A new table returns only the `table` row:

```camussql
SHOW STATISTICS FOR robots;
```

```text
┌────────┬───────┬────────┬────────────────┬────────────────┬───────────┬───────────┬───────────────────┬───────────────┬─────────────────┐
│ table  │ kind  │ target │ estimated_rows │ distinct_count │ min_value │ max_value │ histogram_buckets │ last_analyzed │ stale_mutations │
├────────┼───────┼────────┼────────────────┼────────────────┼───────────┼───────────┼───────────────────┼───────────────┼─────────────────┤
│ robots │ table │ null   │ null           │ null           │ null      │ null      │ null              │ null          │ null            │
└────────┴───────┴────────┴────────────────┴────────────────┴───────────┴───────────┴───────────────────┴───────────────┴─────────────────┘
1 rows in set (00:00:00.0222006)
```

Insert the four tutorial rows. The statistics that writes update appear at
once, before `ANALYZE`:

```camussql
INSERT INTO robots (id, name, kind, year) VALUES
  (GEN_ID(), 'R2-D2', 'utility', 1977),
  (GEN_ID(), 'C-3PO', 'protocol', 1977),
  (GEN_ID(), 'T-800', 'android', 1984),
  (GEN_ID(), 'K-2SO', 'security', 2024);
```

```camussql
SHOW STATISTICS FOR robots;
```

```text
┌────────┬────────┬─────────────────┬────────────────┬────────────────┬──────────────────────────┬──────────────────────────┬───────────────────┬───────────────┬─────────────────┐
│ table  │ kind   │ target          │ estimated_rows │ distinct_count │ min_value                │ max_value                │ histogram_buckets │ last_analyzed │ stale_mutations │
├────────┼────────┼─────────────────┼────────────────┼────────────────┼──────────────────────────┼──────────────────────────┼───────────────────┼───────────────┼─────────────────┤
│ robots │ table  │ null            │ 4              │ null           │ null                     │ null                     │ null              │ null          │ 4               │
│ robots │ column │ id              │ null           │ null           │ 6afe1cc33bd8878b74cf9b41 │ 6afe1cc33bd8878b74cf9b44 │ null              │ null          │ 4               │
│ robots │ column │ year            │ null           │ null           │ 1977                     │ 2024                     │ null              │ null          │ 4               │
│ robots │ index  │ robots_year_idx │ 4              │ null           │ null                     │ null                     │ null              │ null          │ 4               │
│ robots │ index  │ ~pk             │ 4              │ null           │ null                     │ null                     │ null              │ null          │ 4               │
└────────┴────────┴─────────────────┴────────────────┴────────────────┴──────────────────────────┴──────────────────────────┴───────────────────┴───────────────┴─────────────────┘
5 rows in set (00:00:00.0042444)
```

There's no `distinct_count` and no histogram yet. The columns `name` and `kind`
aren't indexed, and they don't appear. The planner estimates this table with
default selectivity values.

`ANALYZE` adds the missing values and resets `stale_mutations`:

```camussql
ANALYZE robots;
```

```text
┌────────┬─────────────────┬──────┬─────────┐
│ table  │ status          │ rows │ columns │
├────────┼─────────────────┼──────┼─────────┤
│ robots │ analyzed 4 rows │ 4    │ 4       │
└────────┴─────────────────┴──────┴─────────┘
1 rows in set (00:00:00.0401582)
```

```camussql
SHOW STATISTICS FOR robots;
```

```text
┌────────┬────────┬─────────────────┬────────────────┬────────────────┬──────────────────────────┬──────────────────────────┬───────────────────┬──────────────────────────┬─────────────────┐
│ table  │ kind   │ target          │ estimated_rows │ distinct_count │ min_value                │ max_value                │ histogram_buckets │ last_analyzed            │ stale_mutations │
├────────┼────────┼─────────────────┼────────────────┼────────────────┼──────────────────────────┼──────────────────────────┼───────────────────┼──────────────────────────┼─────────────────┤
│ robots │ table  │ null            │ 4              │ null           │ null                     │ null                     │ null              │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ column │ id              │ null           │ 4              │ 6afe1cc33bd8878b74cf9b41 │ 6afe1cc33bd8878b74cf9b44 │ 4                 │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ column │ name            │ null           │ 4              │ C-3PO                    │ T-800                    │ 4                 │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ column │ kind            │ null           │ 4              │ android                  │ utility                  │ 4                 │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ column │ year            │ null           │ 3              │ 1977                     │ 2024                     │ 4                 │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ index  │ robots_year_idx │ 4              │ null           │ null                     │ null                     │ null              │ 2026-11-18T21:46:48.850Z │ 0               │
│ robots │ index  │ ~pk             │ 4              │ null           │ null                     │ null                     │ null              │ 2026-11-18T21:46:48.850Z │ 0               │
└────────┴────────┴─────────────────┴────────────────┴────────────────┴──────────────────────────┴──────────────────────────┴───────────────────┴──────────────────────────┴─────────────────┘
7 rows in set (00:00:00.0025324)
```

## Statistics from writes and from ANALYZE

The example shows two groups of values.

Writes update the first group: the row count, the entry count of each index,
and the bounds of each indexed column. These values are approximately current
at all times, and they need no maintenance.

`ANALYZE`, manual or [automatic](/docs/automatic-analyze), builds the second
group:

- The histograms and the distinct-value counts of the columns.
- The distinct counts of composite key prefixes.
- The bounds of the columns that aren't indexed, up to `stats_analyze_max_columns`
  columns. These bounds don't change until the next `ANALYZE`.

`ANALYZE` also saves up to `stats_top_values` common values for each column,
and the fraction of `NULL` values. The planner uses them for skewed equalities
and join estimates. `SHOW STATISTICS` doesn't show them. It shows only that a
histogram exists, and its bucket count.

The second group makes range and equality estimates accurate. A `NULL` in
`histogram_buckets` or `distinct_count` means that it's missing.

## Read it with EXPLAIN

When [`EXPLAIN`](/docs/explain) shows an `estimated_rows` value that you doubt,
this statement shows where the number came from:

- An equality, `col = v`, uses the saved frequency when `v` is a common value.
  Other values share the remaining rows over the remaining `distinct_count`. If
  `distinct_count` is `NULL`, a fixed default is used. This can make an index
  look much less useful than it is.
- A range predicate uses the histogram. If `histogram_buckets` is `NULL`, a
  fixed default is used.
- `WHERE a = ? AND b = ?` on a composite index uses the `key` row for `a,b`, if
  it exists.

If the estimates are wrong and the statistics are missing or old, run
`ANALYZE`. If the estimates are wrong, but `last_analyzed` is recent and
`stale_mutations` is low, the cause is probably in the cost model. For more
information, see [Query planning](/docs/query-planning).

## Staleness

`stale_mutations` counts the rows that writes changed since the last `ANALYZE`.

Compare it with the threshold of [automatic analyze](/docs/automatic-analyze).
With the defaults, a table is analyzed again when `stale_mutations` reaches 20%
of `estimated_rows` plus 500. This tells you how soon a table will be analyzed
again. It also explains why a small table isn't analyzed automatically.

## Statistics after TRUNCATE

After a [`TRUNCATE`](/docs/truncate-table), the old statistics aren't used. The
result shows the `table` row with `NULL` values, and the planner treats the
table as not measured. Run `ANALYZE` after you load the table again.

## Value formats

A bound is shown in literal form:

- Dates and timestamps use ISO-8601.
- UUIDs use the canonical form.
- Numbers use no digit separators.

`last_analyzed` is a UTC timestamp in ISO-8601 form, with milliseconds, for
example `2026-08-15T09:33:13.289Z`.

String bounds use ordinal order, the byte order of the indexes. For example,
`'árbol'` sorts after `'zebra'`, as in an index scan.

The following column types have limited statistics:

| Type | Statistics |
| --- | --- |
| `BOOL` | A row if the column is indexed. Its `distinct_count` is `0`, and the bounds and `histogram_buckets` are `NULL`. |
| `UUID` | Bounds and a distinct count. `histogram_buckets` is `NULL`. |
| `BYTES`, `JSONB`, `ARRAY` | The column doesn't appear. |

## Scope and freshness

The values are those of the node that answers. A node that is tracking the
table includes its writes that it hasn't saved to storage yet.

`ANALYZE` on one node doesn't update the statistics that another node has
loaded. This means that two nodes can show different values for the same table
for some time. To confirm the result of an `ANALYZE`, run `SHOW STATISTICS` on
the node that ran it.

Statistics that are missing or can't be read are shown as `NULL`. They don't
make the statement fail.

## Materialized views

A [materialized view](/docs/materialized-views) stores rows. This means that it
has statistics, and you can use it with this statement.

A refresh counts the rows and index entries as it writes them. Right after a
refresh, the view has exact counts, and no distributions. `last_analyzed` is
`NULL`, and `stale_mutations` shows the rows that the refresh wrote. With the
default settings, automatic analyze fills in the rest for a view with at least
624 rows. For a smaller view, run `ANALYZE`.

A [view](/docs/views) doesn't store rows, and it doesn't have statistics. The
statement returns `CADB0523`, with a message that tells you to look at the
tables of the view.

## Permissions

`SHOW STATISTICS` needs `SELECT` on the table. The bounds are real values from
the columns, so the rule is the same as for a `SELECT` on the table.

Note that the statement doesn't need a superuser. The statements that describe
the node, such as `SHOW VARIABLES`, need one.

`STATISTICS` isn't a reserved word. You can use it as a table or column name.

## Related pages

- [Automatic analyze](/docs/automatic-analyze), which refreshes these statistics
  in the background.
- [Query planning](/docs/query-planning), which describes how the planner uses
  them.
- [EXPLAIN](/docs/explain), which shows the estimates.
- [Engine stats](/docs/engine-stats), for the runtime metrics of a node.
