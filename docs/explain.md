---
sidebar_position: 3.2
---

# EXPLAIN

The output of `EXPLAIN` is diagnostic only. It can change while the query planner
is an alpha feature. The names of the nodes, the names of the columns, and the
formats of the detail on this page are stable inside one minor version. The
changelog names any change that breaks them. Do not build production logic that
parses this output.

## Syntax

```camussql
EXPLAIN SELECT ...
EXPLAIN (PHYSICAL) SELECT ...   -- identical to plain EXPLAIN
EXPLAIN (LOGICAL)  SELECT ...   -- same plan, stage column = "logical"
EXPLAIN (ANALYZE)  SELECT ...   -- executes the query and adds actual counters
```

An `EXPLAIN` without `ANALYZE` builds the physical plan. It opens no cursor on a
table, and it reads no data of a row.

`EXPLAIN (ANALYZE)` executes the full query. It drains the result. It then
reports the true counters of the runtime, beside the columns of the estimates.

CamusDB rejects an option word that it does not know, such as
`EXPLAIN (VERBOSE) ...`. It reports an error. It does not treat the statement as
a plain `EXPLAIN` in silence.

Three limits are worth your attention:

- A join. `EXPLAIN (ANALYZE)` does not support a query with a `JOIN` yet. It
  raises an error. Use a plain `EXPLAIN` to inspect the plan of a join. Full
  instrumentation of a join is planned for a future release.
- A subquery. The plan of a statement with a subquery without a correlation
  executes that inner subquery one time. CamusDB materializes it during the
  plan. An `EXPLAIN` of such a statement therefore reads the storage for the
  inner query. A plain `EXPLAIN` never executes the outer query.
- A `SELECT` without a `FROM` clause. Such a
  [statement](/docs/sql-fromless-select) has no tree of a plan. A plain
  `EXPLAIN` therefore renders a fixed shape: a `constant-source`, then a
  `project`, and then a `limit` where one exists. It renders no costed plan.
  CamusDB rejects `EXPLAIN (ANALYZE)` for it, because there is no access to a
  table to measure. Use the plain form. Unlike a real query, an `EXPLAIN` of
  such a statement does not materialize the subqueries of its projection first.
  They appear only as the names of their output columns.

## The schema of a result row

### A plain EXPLAIN

| Column           | Type      | Description |
|------------------|-----------|-------------|
| `stage`          | `STRING`  | It is `"physical"` for an `EXPLAIN` and for an `EXPLAIN (PHYSICAL)`. It is `"logical"` for an `EXPLAIN (LOGICAL)`. |
| `node`           | `STRING`  | The canonical name of the node. See the table below. |
| `detail`         | `STRING`  | The key facts of that node. See the table below. |
| `estimated_rows` | `INT64`   | The estimate of the cost model, for the output cardinality of the node. It is `NULL` when CamusDB did not cost the plan. |
| `estimated_cost` | `FLOAT64` | The weighted cost of the node, from the cost model. It has no unit, and a lower value is cheaper. It is `NULL` without a cost. |

`estimated_rows` and `estimated_cost` come from the cost model. An estimate uses
the statistics of the table where they are available:

- The row count.
- The minimum and the maximum of each column.
- The equi-depth histograms, after an `ANALYZE`.
- The counts of the distinct values, after an `ANALYZE`.

An estimate falls back to a fixed default without them. The exact numbers
therefore depend on the statistics that CamusDB collected. They differ between
two deployments.

[`SHOW STATISTICS FOR <table>`](/docs/show-statistics) shows the inputs of an
estimate that looks wrong. It also shows whether CamusDB collected them at all.

`estimated_cost` also holds a term for the network, the `NetworkFactor`. That
term applies to a deployment with sharding by key range. It is 0 on one node.

An estimate for one table is accurate. An estimate of a node of a join is
accurate while the flag of the order of a join by cost is on. Otherwise it stays
heuristic.

`(LOGICAL)` and `(PHYSICAL)` currently render the same physical tree. Only the
label of the `stage` differs. See
[the query planner guide](/docs/query-planner-internals#statistics-and-cost) for
the cost model itself.

### An EXPLAIN with ANALYZE

The result holds every column of a plain `EXPLAIN`, plus these:

| Column            | Type       | Description |
|-------------------|------------|-------------|
| `actual_rows`     | `INT64`    | The rows that this operator gave to its parent. |
| `rows_read`       | `INT64`    | The rows that an operator of a scan fetched and decoded from the storage, before a filter. It is `0` for an operator of the pipeline, because such an operator reads from a cursor, and not from the storage. |
| `actual_time_ms`  | `FLOAT64`  | The total wall-clock milliseconds of the whole plan. Only the root node carries it. It is `NULL` on every other node. A time for each node is planned for a future release. |
| `kv_lookups`      | `INT64`    | The point lookups that CamusDB issued to the KV layer, for a lookup on a unique index. |
| `kv_scan_entries` | `INT64`    | The entries of the KV layer that a scan visited, for a scan of a table or of a range of an index. |

On a node of a scan, `actual_rows` is at or below `rows_read`. `rows_read`
counts the rows that CamusDB decoded from the storage, before the evaluation of
a predicate. `actual_rows` counts the rows that passed every filter, and that
the node gave upward.

## The canonical names of the nodes

CamusDB emits one row for each node of the physical plan. The order is
depth-first, and a parent comes before its children.

| Node name                | When it appears | Key fields of the detail |
|--------------------------|-----------------|-------------------|
| `table-scan`             | A full scan of a table, or a scan of a forced index | `table=<name>`. A forced index adds `, forced-index=<name>`. |
| `index-lookup`           | An equality on a unique index | `index=<name>, key=<value>` |
| `index-range-scan`       | A predicate of a range, with `<`, `>`, or `BETWEEN`. Also an equality on a non-unique index. | `index=<name>, from>=<val>, to<<val>` |
| `index-in-list`          | An `x IN (v1, v2, …)` on an indexed column. CamusDB seeks the index one time for each distinct value, and it unions the results. | `index=<name>, values=<n>`, which is the count of the values of the seek |
| `filter`                 | A residual predicate that the selected index does not satisfy | `<expr>` |
| `aggregate`              | A `GROUP BY`, or an aggregate function | `group=[<exprs>], aggs=[<calls>]` |
| `having-filter`          | A `HAVING` clause, after the aggregation | `<expr>` |
| `sort`                   | An `ORDER BY` that the order of the scan does not satisfy | `<col> ASC/DESC, ...` |
| `topk`                   | An `ORDER BY` that a `LIMIT` bounds. It keeps `offset + limit` rows only, and it never spills. See [Vector search](/docs/vector-search). | `k: <n>, <col> ASC/DESC, ...` |
| `limit`                  | A `LIMIT` or an `OFFSET` | `<n>`, or `<n> offset <m>` |
| `project`                | The projection of the columns, after the other stages of the pipeline | (no detail) |
| `distinct`               | A `SELECT DISTINCT` | `streaming: true` for the ordered form, which needs constant memory. Otherwise `hash`. |
| `semi-join`              | An `IN (subquery)` that CamusDB rewrote to a semi-join, over an indexed inner column | `outer=<col>, inner=<table>.<col>, index=<name>` |
| `anti-join`              | A `NOT IN (subquery)` over an indexed inner column of `NOT NULL` | `outer=<col>, inner=<table>.<col>, index=<name>` |
| `null-aware-anti-join`   | A `NOT IN (subquery)` over an indexed inner column that accepts a `NULL`. It follows the semantics of SQL, with three values. | `outer=<col>, inner=<table>.<col>, index=<name>` |
| `nested-loop-join`       | An inner join without a usable index on the right side | `on=<expr>, right=<alias>` |
| `index-nested-loop-join` | An inner join where an index covers the join key of the right side | `on=<expr>, index=<name>, left=<col>, right=<col>` |
| `hash-join`              | An inner equi-join with a hash table in memory. CamusDB selects it over an indexed nested loop when the outer side is large against the inner side. | `on=<left>=<right>, build=<alias>`. A filter that CamusDB pushed down appends to the detail. |
| `merge-join`             | An inner equi-join with a streaming merge of two pointers. CamusDB selects it when both sides have a free order of the join key, from an index. | `on=<left>=<right>`. A filter on the right side appends to the detail. |
| `derived-table-scan`     | A subquery in the `FROM` clause | `alias=<alias>` |
| `constant-source`        | The one synthetic row of a `SELECT` without a `FROM` clause. It touches no table. | `1 row` |

Note these four points:

- An `IN` or a `NOT IN` without a correlation, over an indexed inner column,
  becomes a `semi-join`, an `anti-join`, or a `null-aware-anti-join`. With an
  inner column that has no index, CamusDB materializes the subquery instead. No
  node of a join appears.
- A `distinct` row reports `streaming: true` when two conditions hold. The input
  arrives in the order of an index, and that order covers every column of the
  `DISTINCT`. Those columns must also be `NOT NULL`. Otherwise the row reports
  `hash`.
- The `build=<alias>` of a `hash-join` names the side that CamusDB materialized
  into the hash table in memory. The planner selects the side with the smaller
  estimate as the build side, to keep the memory low.
- A `merge-join` streams both inputs when both arrive in order already. That
  order comes from a scan of a forced index, or from a sort above. The join
  buffers only the current run of equal keys. It therefore needs memory for the
  size of a run, and not for the size of both inputs.

The plan reflects the active configuration of the planner. Two things depend on
the cost-based optimizer: the access path of a table, and the order of the nodes
of a join.

`EXPLAIN` shows the heuristic plan while the planner works from its rules only.
The same query can show a different index, or a different order of a join, when
two things hold: `cost_based_access_path_enabled` or
`cost_based_join_order_enabled` is on, and CamusDB collected the statistics with
an `ANALYZE <table>`. That plan is cheaper.

The output is correct for the configuration that produced it. See
[the query planner guide](/docs/query-planner-internals#statistics-and-cost).

The examples below use the `stage`, the `node`, and the `detail` columns. Those
columns are the stable part of the output. Every row also carries an
`estimated_rows` and an `estimated_cost`, as above. The examples with an
`EXPLAIN ANALYZE` show the full set of the columns.

## The informational rows at the end

`EXPLAIN` can add a few informational rows after the rows of the nodes. Such a
row is not an operator of the plan. Its `estimated_rows` and its
`estimated_cost` are both `NULL`. It reports a fact at the level of the plan.

| Node name   | When it appears | Detail |
|-------------|-----------------|--------|
| `plan-info` | The plan carries an id of its shape, which is metadata of the plan cache. | `shape=<id>, schema-deps=[table@version, ...]` |
| `cache`     | The query carries a hint of the result cache, in the form `{cache=…}` or `@{cache=…}`. | `family=<name>, eligible=<true\|false>[, reason=<why>], ttl=<n>ms\|default, strict=<true\|false>` |

The `cache` row answers one question: will CamusDB cache this result? The answer
is a static property of the plan.

The row does not probe the cache. It also does not report whether a live entry
exists at that moment. Such a report is inherently a race. The authoritative
outcome at runtime is the `cacheStatus` of the response of the query.

`eligible=true` means two things. The shape of the query is cacheable, and the
feature is on.

`eligible=false` names the reason for the hint to have no effect:

- `reason=join` means that the query is a join. CamusDB caches the result of one
  table only. The hint is therefore inert.
- `reason=cache-disabled` means that the result cache is off, from
  `query_result_cache_enabled: false`.

`ttl` and `strict` repeat the options of the hint. `ttl=default` appears when
you gave no `ttl=`.

The eligibility here is the view at the level of the plan. At runtime, the cache
also applies to a read in autocommit mode only. An explicit transaction always
reads the live storage. A query without a `{cache=…}` hint emits no `cache` row.
See the [query result cache](/docs/query-result-cache) for the whole feature.

## Worked examples

### A full scan of a table

```camussql
EXPLAIN SELECT * FROM robots;
```

```
stage     node        detail
physical  table-scan  table=robots
```

The planner selected a full scan of the table. The `WHERE` clause is empty, so
no index is usable.

### An equality on a non-unique index

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2023;
```

The example assumes a non-unique index `year_idx`, on the column `year`.

```
stage     node               detail
physical  index-range-scan   index=year_idx, from>=2023, to<2024
```

For a non-unique index, CamusDB rewrites a predicate of an equality into a scan
of a range.

For a numeric type and for another ordinal type, that range is half-open. It
covers `>= value` and `< successor(value)`, as above.

For a `String` column and for an `Id` column, there is no successor to compute.
CamusDB therefore uses a range that includes both ends, from `value` to `value`.
The detail then reads `from>=value, to<=value`. The engine of the scan appends a
high sentinel internally. It therefore captures every index entry of the form
`encode(value)+rowId`. It then trims the result to the exact matches of the key.

Both forms give the same set of rows. Only the rendering of the bounds differs.

The node `index-lookup` appears for an equality on a unique index only. That
index is a primary key, or a `UNIQUE` constraint. At most one row can match.

### An equality on a primary key

```camussql
EXPLAIN SELECT * FROM robots WHERE id = '507f1f77bcf86cd799439011';
```

```
stage     node          detail
physical  index-lookup  index=~pk, key='507f1f77bcf86cd799439011'
```

`~pk` is unique. The planner therefore issues one point lookup. It does not
issue a scan of a range.

### A scan of a range, with a residual filter

```camussql
EXPLAIN SELECT * FROM robots WHERE year >= 2020 AND name = 'Bishop';
```

```
stage     node               detail
physical  filter             name = 'Bishop'
physical  index-range-scan   index=year_idx, from>=2020
```

The predicate `year >= 2020` drives the scan of the range on the index. CamusDB
cannot push `name = 'Bishop'` into the index. That predicate therefore appears
as a residual `filter`, above the scan.

The `node` column holds the bare name of the node. It holds no space at the
start. The order of the rows carries the depth of the tree, with a parent before
its child. The real result set holds no indentation.

### An aggregate with a GROUP BY

```camussql
EXPLAIN SELECT year, COUNT(*) FROM robots GROUP BY year;
```

```
stage     node        detail
physical  aggregate   group=[year], aggs=[count(*)]
physical  table-scan  table=robots
```

### A SELECT DISTINCT, streaming and hash

```camussql
EXPLAIN SELECT DISTINCT code FROM teams;   -- code is NOT NULL with an index
```

```
stage     node              detail
physical  distinct          streaming: true
physical  index-range-scan  index=code_idx
```

The columns of the `DISTINCT` can form a prefix of the set of an index, and
every one of them can be `NOT NULL`. The scan then emits the rows in the order
of the index. The `distinct` node removes an adjacent duplicate, with constant
memory. Otherwise the `distinct` row shows `hash`, and CamusDB uses a set in a
hash table.

### A hash join, for an equi-join without an index on the join key

```camussql
EXPLAIN SELECT o.name, li.product
        FROM orders o
        JOIN line_items li ON li.order_id = o.id;
-- orders.id is the PK; line_items.order_id has no secondary index
```

```
stage     node        detail
physical  hash-join   on=o.id=order_id, build=li
physical  table-scan  table=orders
physical  table-scan  table=line_items
```

`build=li` means that CamusDB materializes `line_items` into the hash table in
memory. It streams `orders` as the probe side. The planner selected `li` as the
build side, because its estimate held fewer rows than `orders`.

The build side can exceed `HashJoinMaxBuildRows`, whose default is 1,000,000.
The executor then falls back to a nested-loop join, for that query.

### A merge join, with a secondary index on the join key of both sides

```camussql
EXPLAIN SELECT o.name, li.product
        FROM orders o
        JOIN line_items li ON li.order_id = o.ext_key;
-- orders has index orders_ext_key_idx on (ext_key)
-- line_items has index li_order_id_idx on (order_id)
-- both sides estimated > 100 rows → cost model picks merge
```

```
stage     node              detail
physical  merge-join        on=o.ext_key=order_id
physical  table-scan        table=orders, forced-index=orders_ext_key_idx
physical  table-scan        table=line_items, forced-index=li_order_id_idx
```

Both scans use a `forced-index`. Their rows therefore arrive in the order of the
join key. The executor streams both sides together. It buffers only the current
run of equal keys, and it materializes neither side in full. The `MergeJoinNode`
holds `LeftIsOrdered = RightIsOrdered = true`.

### An IN subquery that CamusDB rewrote to a semi-join

```camussql
EXPLAIN SELECT * FROM robots WHERE owner_id IN (SELECT id FROM owners);
```

```
stage     node        detail
physical  semi-join   outer=owner_id, inner=owners.id, index=~pk
physical  table-scan  table=robots
```

An index covers the inner column `owners.id`. CamusDB therefore executes the
`IN` as a semi-join with probes of that index. It does not materialize the
subquery.

A `NOT IN` produces an `anti-join` for an inner column of `NOT NULL`. It
produces a `null-aware-anti-join` for an inner column that accepts a `NULL`.
With an inner column that has no index, no node of a join appears, and CamusDB
materializes the subquery.

### An ORDER BY that an index satisfies

```camussql
EXPLAIN SELECT * FROM robots ORDER BY year;
```

```
stage     node              detail
physical  index-range-scan  index=year_idx
```

No `sort` node appears. The scan of the index already guarantees the requested
order. CamusDB therefore omits the sort.

### The pushdown of a LIMIT

```camussql
EXPLAIN SELECT * FROM robots LIMIT 10;
```

```
stage     node        detail
physical  limit       10
physical  table-scan  table=robots
```

The scan stops after the first 10 rows. It does not scan the whole table.

### EXPLAIN ANALYZE, for a full scan of a table

```camussql
EXPLAIN (ANALYZE) SELECT * FROM robots;
```

```
stage    node        detail        estimated_rows  estimated_cost  actual_rows  rows_read  actual_time_ms  kv_lookups  kv_scan_entries
analyze  table-scan  table=robots  42              42.0            42           42         3.1             0           42
```

The table holds 42 rows, and there is no filter. `actual_rows`, `rows_read`, and
`kv_scan_entries` are therefore all 42. Only the root node carries an
`actual_time_ms`. The root node is the outermost operator.

### EXPLAIN ANALYZE, for a scan of a range on a non-unique index, with a limit

```camussql
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2022 LIMIT 5;
```

The example assumes a non-unique index `year_idx` on `year`. Three robots hold
`year = 2022`.

```
stage    node               detail                                estimated_rows  estimated_cost  actual_rows  rows_read  actual_time_ms  kv_scan_entries  kv_lookups
analyze  limit              5                                     5               6.0             3            0          14.2             0                0
analyze  index-range-scan   index=year_idx, from>=2022, to<2023   ...             ...             3            3          NULL             3                0
```

- The `limit` node emits 3 rows, which is below its cap of 5. Its
  `actual_time_ms` is 14.2 ms. That value is the total time of the plan, on the
  root node only.
- The `index-range-scan` node reports 3 entries in `kv_scan_entries`, which are
  the index entries in the range from 2022 to 2023. It reports 3 in `rows_read`,
  which are the rows that it fetched. It reports 3 in `actual_rows`, because
  every row passed. There is no residual predicate.

The `estimated_*` columns are estimates of the cost model. They vary with the
statistics that CamusDB collected.

## The mode with the properties of a distributed plan

`PlanRenderer.Render(plan, includeDistributedProperties: true)` adds metadata
for a distributed plan to the line of each node:

```
table-scan(table=robots) order=[year ASC] decomposable=true dist=partitioned(id)
```

| Suffix            | Meaning |
|-------------------|---------|
| `order=[...]`     | The order that this node guarantees on its output. One example is a scan of an index that satisfies an `ORDER BY`. The suffix is absent when the order is undefined. |
| `decomposable=true/false` | Whether CamusDB can divide the work of the node into a local computation for each partition, plus a merge on the coordinator. It is always `false` for a node of a sort, and for a node of a limit. An `aggregate` is `true` for a `COUNT`, a `SUM`, a `MIN`, and a `MAX` only. An `AVG` is `false`. |
| `dist=...`        | The distribution of the output rows of this node across the cluster. The value is `gathered` for one node, for a point lookup, and with the sharding off. It is `partitioned(col1,col2)` for a shard by the range of those key columns. It is also `replicated`. CamusDB sets the suffix on a leaf of a scan only. It is absent on a node of the pipeline. With the sharding by key range off, every scan is `gathered`. |

Internal tools and tests use that mode. The SQL statement `EXPLAIN` does not
expose it.

## Notes on the statistics of a filter in EXPLAIN ANALYZE

CamusDB folds a `filter` into the scan during the execution. It evaluates the
predicate inside the loop of the scan. The filter is not a separate stage of the
pipeline. Three results follow:

- A `filter` row of an `EXPLAIN ANALYZE` shows an `actual_rows` equal to the
  count that the scan emitted after the filter. That count is the rows that
  passed the predicate.
- The `kv_lookups` and the `kv_scan_entries` of a filter row are `0`. CamusDB
  attributes every cost of the storage to the node of the scan directly below.
- The `actual_time_ms` is `NULL`. CamusDB does not measure the time of the
  filter separately. That time is part of the wall clock of the scan, and
  CamusDB reports it on the root node only.
