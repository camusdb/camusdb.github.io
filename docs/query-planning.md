---
sidebar_position: 3.1
---

# Query Planning

SQL says what you want, not how to get it. The planner decides the how: scan a
table or probe an index, sort in memory or read in index order, which join
algorithm to run.

This page covers what the planner is able to do and how to help it choose well.
For the internal pipeline, see
[Query Planner Internals](/docs/query-planner-internals); to see what it chose
for a specific query, use [EXPLAIN](/docs/explain).

## What The Planner Can Do

Today CamusDB can plan:

- Full table scans.
- Unique-index point lookups such as primary-key equality.
- Non-unique index range scans for equality, inequalities, and `BETWEEN`.
- Covering secondary-index scans that can return projected columns from the
  index without fetching primary rows.
- Repeated index probes for indexed `IN (...)` value lists.
- Residual filters above a scan when an index only covers part of the predicate.
- Sort elision when an index already produces the required ordering.
- `LIMIT` and `OFFSET` pushdown when a scan can stop early safely.
- Grouped and global aggregates.
- Streaming `DISTINCT` on compatible indexed `NOT NULL` projections.
- Inner joins and comma joins.
- Hash joins for equi-joins, including equi-joins without a usable right-side
  index.
- Merge joins when both sides can be read in join-key order.
- Indexed nested-loop joins when the right-side join key is indexed.
- Semi/anti-join rewrites for eligible indexed `IN` and `NOT IN` subqueries.
- Indexed seeks for eligible correlated `EXISTS` subqueries.
- Derived tables, scalar subqueries, `IN`, `NOT IN`, and `EXISTS`.
- Explicit index forcing with `@{FORCE_INDEX=...}`.
- Opt-in result caching for eligible repeated single-table reads with
  `{cache=...}`.

CamusDB has a statistics-backed cost-based optimizer layered on top of the
rule-based planner. Cost estimates are always exposed through `EXPLAIN`, and
some choices, such as broad range-scan vetoes and join algorithm selection, use
costing automatically. The two broad search passes are enabled by default:

- `cost_based_access_path_enabled`: enumerate viable index/table access paths
  for each table and pick the cheapest.
- `cost_based_join_order_enabled`: enumerate left-deep join orders with a
  System-R-style dynamic program and pick the cheapest connected plan.

Both flags default to `true`. With statistics available, the same SQL statement
may choose a different index, full scan, join algorithm, or join order because
the optimizer has found a lower-cost plan. If either flag is turned off,
CamusDB keeps the corresponding heuristic choice.

## How Scan Choice Works

CamusDB tries to turn predicates into ordered KV access whenever it can.

### Unique equality

Equality on a unique index becomes a point lookup:

```camussql
SELECT *
FROM robots
WHERE id = "507f1f77bcf86cd799439011";
```

This is the best-case lookup shape. A unique primary key or `UNIQUE` index lets
the planner fetch at most one row directly.

### Non-unique equality

Equality on a non-unique index becomes a bounded range scan rather than a
single lookup:

```camussql
SELECT *
FROM robots
WHERE year = 2024;
```

If `year` is non-unique, CamusDB scans the range containing all matching
entries for `2024`.

### Range predicates

Range predicates can also drive index scans:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND year < 2025;

SELECT *
FROM robots
WHERE year BETWEEN 2020 AND 2024;
```

### IN value lists

Indexed `IN (...)` predicates can be planned as repeated index probes:

```camussql
SELECT *
FROM robots
WHERE id IN ("id1", "id2", "id3");

SELECT *
FROM robots
WHERE year IN (2020, 2022, 2024);
```

This is especially useful when the target column is indexed and the value list
is small or moderately sized.

### Residual filters

If an index covers only part of the predicate, CamusDB scans with the index and
applies the remaining filter afterward:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND name = "R2";
```

An index on `year` helps narrow the scan, and `name = "R2"` remains a residual
filter.

Pattern predicates such as `LIKE`, `ILIKE`, and regex operators `~`, `~*`,
`!~`, and `!~*` are also residual filters. They can still combine with an
indexable predicate on another column:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND name ~* "^r";
```

### Covering indexes

An index with `INCLUDE (...)` can answer a query without fetching the primary
row when every required column is either a key column or an included column:

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

The key column `customer_id` drives the lookup. The included columns `status`
and `total` are stored in the index entry and can be returned directly.

If the query projects or filters on a column that is neither a key column nor an
included column, CamusDB may still use the index but must fetch the primary row.
See [Indexes](/docs/sql-indexes#covering-indexes).

## Composite Index Behavior

Composite indexes are most useful when query predicates follow the indexed
column order from left to right.

For an index on `(kind, year)`:

```camussql
SELECT *
FROM robots
WHERE kind = "service" AND year >= 2020;
```

CamusDB can use the equality prefix on `kind` and the range on `year`.

If a query skips the leftmost indexed column, the planner may not be able to
use that composite index effectively:

```camussql
SELECT *
FROM robots
WHERE year >= 2020;
```

## Statistics And The Cost-Based Optimizer

CamusDB keeps lightweight advisory statistics from live writes and richer
statistics from `ANALYZE`. The planner can use them to estimate:

- Table row count.
- Per-index entry count.
- Per-column min/max bounds for indexed columns.
- Per-column histograms.
- Distinct-value counts for columns and composite index prefixes.

Run `ANALYZE` after loading or materially changing data when you want to force
better selectivity and join-cardinality estimates:

```camussql
ANALYZE TABLE robots;
```

CamusDB also has an automatic analyze engine path that can refresh stale table
statistics in the background. It tracks row mutations since the last analyze
and can rebuild statistics when enough rows have changed. See
[Automatic Analyze](/docs/automatic-analyze) for the staleness threshold,
resource limits, and configuration settings.

The cost model uses these estimates to populate `estimated_rows` and
`estimated_cost` in `EXPLAIN`. It also feeds:

- Range-scan versus full-table-scan decisions.
- Indexed `IN (...)` probe plans versus wider scans.
- Join algorithm selection among indexed nested-loop, hash join, and merge
  join.
- Cost-based access-path selection when `cost_based_access_path_enabled` is on.
- Cost-based join-order enumeration when `cost_based_join_order_enabled` is on.

The optimizer degrades safely. Missing or stale statistics do not make a query
incorrect; CamusDB falls back to defaults or to the heuristic planner when it
cannot cost a plan reliably.

### Cost-Based Access Paths

With `cost_based_access_path_enabled: true`, CamusDB considers every viable
access path for a single table, including usable indexes and the full-scan
baseline. It estimates the cost of each candidate and keeps the cheapest.

This matters when more than one index could satisfy a predicate. A rule-based
planner may prefer the longest equality prefix, while the cost-based planner
can prefer a different index or even a full scan if statistics show it will
touch less data overall.

### Cost-Based Join Order

With `cost_based_join_order_enabled: true`, CamusDB can reorder eligible inner
joins by cost instead of relying only on declaration order or simple
selectivity heuristics.

The join enumerator searches connected left-deep join orders and uses table
statistics, filter selectivity, join-key distinct counts, and join algorithm
costs to pick a cheaper tree. It falls back to the heuristic planner for joins
outside its current search envelope, such as very wide joins or shapes it
cannot safely reorder.

## Ordering And Sort Elision

If an index already yields rows in the order required by `ORDER BY`, CamusDB
can skip a separate in-memory sort.

```camussql
SELECT *
FROM robots
ORDER BY year;
```

With a compatible index on `year`, CamusDB can scan directly in order. The
index direction must match the query direction: an index on `(year ASC)` can
satisfy `ORDER BY year ASC`, and an index on `(year DESC)` can satisfy
`ORDER BY year DESC`.

Composite indexes can also satisfy ordering when the `ORDER BY` list matches a
left-to-right index prefix, including direction. For example, `(kind ASC, year
DESC)` can satisfy `ORDER BY kind ASC, year DESC`.

Cases that usually require a real sort:

- `ORDER BY` on columns without a compatible index.
- Orderings that do not match the index prefix.
- Direction mismatches, such as `ORDER BY year ASC` when only `(year DESC)` is
  available.

## LIMIT Pushdown

When a query shape is simple enough, CamusDB can stop the underlying scan early
instead of reading the whole input first.

```camussql
SELECT *
FROM robots
ORDER BY year
LIMIT 10;
```

This works best when:

- The scan already satisfies the requested ordering.
- No extra filter must run after the scan.
- No grouping, `HAVING`, or `DISTINCT` prevents early stop.

## Joins

CamusDB supports `JOIN`, `INNER JOIN`, and comma joins. For inner equi-joins,
the planner can choose among several physical join algorithms:

| Join plan | When it is useful |
| --- | --- |
| `index-nested-loop-join` | The right side has an index on the join key and the left side is small enough that per-row index probes are a good fit. |
| `hash-join` | The join is an equality join and scanning/building a hash table is cheaper than repeated right-side probes, or the right side has no usable join-key index. |
| `merge-join` | Both sides can be read in join-key order, usually through compatible indexes, so CamusDB can stream both sides together. |
| `nested-loop-join` | Fallback for joins that are not eligible for indexed, hash, or merge execution. |

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

If the right side has an index on the join key, CamusDB can use an indexed
nested-loop join instead of scanning the entire right side for each left row.
For larger equality joins, the planner may choose a hash join or merge join
instead when estimates indicate that shape is cheaper.

This means join-friendly indexing matters. For a join such as:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

an index on `posts(user_id)` is far more useful than an unrelated index on
`posts(title)`.

Hash joins materialize the estimated smaller side into an in-memory hash table
and stream the other side as probes. If the build side exceeds the configured
hash-join build limit, CamusDB can use [spill to disk](/docs/spill-to-disk)
to partition the join and keep memory bounded. If spill is disabled, execution
falls back to nested-loop behavior for that query.

Merge joins require equality join keys. When both inputs can be produced in
join-key order, CamusDB advances both streams together and buffers only the
current equal-key run. This is especially useful for larger joins where both
tables have compatible indexes on the join columns.

## IN And NOT IN Subquery Rewrites

For eligible uncorrelated subqueries, CamusDB can rewrite:

- `x IN (SELECT key FROM t)` into a semi-join
- `x NOT IN (SELECT key FROM t)` into an anti-join

This works when the inner side has a usable index and the subquery shape is
simple enough. The rewrite avoids scanning or materializing more data than
necessary.

If the inner side is not a good fit, CamusDB falls back to materializing the
subquery result and applying the outer predicate normally.

`NOT IN` keeps SQL null semantics. Nullable inner values may force a more
conservative null-aware anti-join path or a fallback strategy.

## DISTINCT Planning

`SELECT DISTINCT` has two execution shapes:

- Streaming distinct: when the projected distinct columns are all `NOT NULL`
  and arrive in compatible index order.
- Hash distinct: when CamusDB must keep a set of seen rows in memory.

Streaming distinct is the better path for repeated reads because it can use
constant memory and may also avoid a separate `sort` node when `ORDER BY`
matches the index ordering.

Queries such as `SELECT DISTINCT *` or `SELECT DISTINCT` over non-indexed or
nullable columns fall back to hash distinct.

## Derived Tables And Subqueries

CamusDB can plan:

- Derived tables in `FROM`.
- Scalar subqueries.
- `IN` and `NOT IN` subqueries.
- `EXISTS` subqueries.

Examples:

```camussql
SELECT u.email, d.post_count
FROM app_users u
JOIN (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d ON d.user_id = u.id;

SELECT id
FROM robots
WHERE year = (SELECT MAX(year) FROM robots);
```

For uncorrelated subqueries, CamusDB can evaluate the inner subquery once and
then plan the outer predicate around that result.

For correlated `EXISTS`, CamusDB can avoid a full inner-table scan when the
inner table has an index whose leading key columns are fixed by equality
predicates. The seek key can come from outer-row columns, literals, or
parameters. CamusDB still evaluates the full inner predicate on rows returned
by the seek, so the optimization changes how much work is done, not which rows
match.

```camussql
CREATE INDEX posts_user_idx ON posts (user_id);

SELECT email
FROM app_users
WHERE EXISTS (
  SELECT *
  FROM posts
  WHERE posts.user_id = app_users.id
    AND posts.published = true
);
```

If no qualifying index exists, the executor falls back to the full inner scan.
Under Serializable transactions, CamusDB protects the indexed seek range so a
concurrent insert into that range cannot create a missed phantom.

## Forcing An Index

When you know a specific index should be used, you can force it:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Use this carefully. It is a debugging and tuning tool, not a substitute for
good schema design. If a forced index makes the query slower, CamusDB will still
honor the hint.

## Result Cache Hints

For repeated single-table reads, a `SELECT` can opt into the per-node query
result cache:

```camussql
SELECT id, total
FROM orders {cache=recent_orders, ttl=30s}
WHERE status = "paid";
```

The result cache stores fully materialized results in memory after a successful
autocommit read. It is separate from the plan cache: the plan cache can reuse an
optimization decision, while the result cache can skip storage reads and return
cached rows.

Important planning behavior:

- only single-table autocommit `SELECT` statements are cache eligible
- joins bypass result caching even when a hint is present
- explicit transactions read live storage
- `EXPLAIN` appends a `cache` informational row when a cache hint is present

See [Query Result Cache](/docs/query-result-cache) for syntax, freshness
guarantees, manual eviction, and configuration.

## What Helps The Planner

To get better plans consistently:

- Index columns used in equality predicates, range predicates, and join keys.
- Put the most selective columns first in composite indexes when queries follow
  that left-to-right shape.
- For large equi-joins, index both join keys when you want merge join to be
  available.
- Add indexes that match common `ORDER BY` prefixes, including `ASC`/`DESC`
  directions, when sorted reads matter.
- Add `INCLUDE` columns for hot lookup queries that return a small set of
  non-key columns.
- Run `ANALYZE TABLE <name>` after bulk loads or major data distribution
  changes when you need fresh statistics immediately. Automatic analyze keeps
  stale statistics refreshed in the background by default.
- Leave `cost_based_access_path_enabled` enabled when you want CamusDB to
  compare all viable indexes by estimated cost.
- Leave `cost_based_join_order_enabled` enabled when you want CamusDB to search
  left-deep inner-join orders by estimated cost.
- Add `{cache=...}` only to repeated read-heavy single-table queries whose
  result set is small enough to keep in memory.
- Add indexes on the inner correlated columns used by `EXISTS` predicates.
- Use qualified names in joins so predicates are unambiguous.
- Use `EXPLAIN` to verify whether CamusDB chose a table scan, index lookup,
  range scan, join scan, or extra sort.

## Current Limits

The planner is improving, but there are still important limits:

- Broad cost-based access-path and join-order search are enabled by default,
  but depend on useful statistics.
- Join planning exists, but `EXPLAIN (ANALYZE)` for joins is not supported yet.
- `(LOGICAL)` `EXPLAIN` currently labels the same physical tree rather than
  rendering a separate logical-plan view.
- Descending-order satisfaction from indexes is limited.
- Cost-based join-order enumeration is left-deep, capped for very wide joins,
  and currently applies to reorderable inner-join shapes.
- `NOT IN (...)` value lists remain filter-driven rather than using a dedicated
  index-probe plan shape.
- `COUNT(DISTINCT ...)` is not supported.

These are planning limits, not correctness limits. CamusDB still aims to return
the right rows; the difference is whether it can pick the fastest available
path.

## Inspecting Plans

Use `EXPLAIN` to see what the planner chose:

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [EXPLAIN](/docs/explain) for the output format and
examples, and [Query Planner Internals](/docs/query-planner-internals) for the
execution pipeline and planner architecture.
