---
sidebar_position: 3.1
---

# Query Planning

CamusDB accepts declarative SQL, then chooses a physical execution plan for the
query. That plan decides whether CamusDB should scan a table, probe an index,
use an index range, sort results in memory, aggregate rows, or join sources
with indexed lookups.

For users, the important question is not "how is the planner implemented?" but
"what can CamusDB do for my query, and how do I help it choose a good plan?"

## What The Planner Can Do

Today CamusDB can plan:

- Full table scans.
- Unique-index point lookups such as primary-key equality.
- Non-unique index range scans for equality, inequalities, and `BETWEEN`.
- Repeated index probes for indexed `IN (...)` value lists.
- Residual filters above a scan when an index only covers part of the predicate.
- Sort elision when an index already produces the required ordering.
- `LIMIT` and `OFFSET` pushdown when a scan can stop early safely.
- Grouped and global aggregates.
- Streaming `DISTINCT` on compatible indexed `NOT NULL` projections.
- Inner joins and comma joins.
- Indexed nested-loop joins when the right-side join key is indexed.
- Semi/anti-join rewrites for eligible indexed `IN` and `NOT IN` subqueries.
- Derived tables, scalar subqueries, `IN`, `NOT IN`, and `EXISTS`.
- Explicit index forcing with `@{FORCE_INDEX=...}`.

CamusDB is still heuristic-first. It has a small statistics-backed cost model,
but planning is not yet a fully cost-based optimizer.

## How Scan Choice Works

CamusDB tries to turn predicates into ordered KV access whenever it can.

### Unique equality

Equality on a unique index becomes a point lookup:

```sql
SELECT *
FROM robots
WHERE id = "507f1f77bcf86cd799439011";
```

This is the best-case lookup shape. A unique primary key or `UNIQUE` index lets
the planner fetch at most one row directly.

### Non-unique equality

Equality on a non-unique index becomes a bounded range scan rather than a
single lookup:

```sql
SELECT *
FROM robots
WHERE year = 2024;
```

If `year` is non-unique, CamusDB scans the range containing all matching
entries for `2024`.

### Range predicates

Range predicates can also drive index scans:

```sql
SELECT *
FROM robots
WHERE year >= 2020 AND year < 2025;

SELECT *
FROM robots
WHERE year BETWEEN 2020 AND 2024;
```

### IN value lists

Indexed `IN (...)` predicates can be planned as repeated index probes:

```sql
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

```sql
SELECT *
FROM robots
WHERE year >= 2020 AND name = "R2";
```

An index on `year` helps narrow the scan, and `name = "R2"` remains a residual
filter.

## Composite Index Behavior

Composite indexes are most useful when query predicates follow the indexed
column order from left to right.

For an index on `(kind, year)`:

```sql
SELECT *
FROM robots
WHERE kind = "service" AND year >= 2020;
```

CamusDB can use the equality prefix on `kind` and the range on `year`.

If a query skips the leftmost indexed column, the planner may not be able to
use that composite index effectively:

```sql
SELECT *
FROM robots
WHERE year >= 2020;
```

## Statistics And Cost-Based Scan Choice

CamusDB keeps lightweight advisory statistics from live writes. The planner can
use them to estimate:

- Table row count.
- Per-index entry count.
- Per-column min/max bounds for indexed columns.

These estimates currently help with a narrow but useful decision: when an index
range is so broad that a full table scan is likely cheaper, CamusDB can choose
the full scan instead. Statistics also feed the `estimated_rows` and
`estimated_cost` columns in `EXPLAIN`.

This is not a full cost-based optimizer yet. Index selection, join strategy,
and most operator ordering still come primarily from deterministic rules.

## Ordering And Sort Elision

If an index already yields rows in the order required by `ORDER BY`, CamusDB
can skip a separate in-memory sort.

```sql
SELECT *
FROM robots
ORDER BY year;
```

With a compatible ascending index on `year`, CamusDB can scan directly in order.

Cases that usually require a real sort:

- `ORDER BY` on columns without a compatible index.
- Orderings that do not match the index prefix.
- Descending order when only ascending index order can be used by the current
  planner.

## LIMIT Pushdown

When a query shape is simple enough, CamusDB can stop the underlying scan early
instead of reading the whole input first.

```sql
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

CamusDB supports `JOIN`, `INNER JOIN`, and comma joins.

```sql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

If the right side has an index on the join key, CamusDB can use an indexed
nested-loop join instead of scanning the entire right side for each left row.

This means join-friendly indexing matters. For a join such as:

```sql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

an index on `posts(user_id)` is far more useful than an unrelated index on
`posts(title)`.

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

```sql
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

## Forcing An Index

When you know a specific index should be used, you can force it:

```sql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Use this carefully. It is a debugging and tuning tool, not a substitute for
good schema design. If a forced index makes the query slower, CamusDB will still
honor the hint.

## What Helps The Planner

To get better plans consistently:

- Index columns used in equality predicates, range predicates, and join keys.
- Put the most selective columns first in composite indexes when queries follow
  that left-to-right shape.
- Add indexes that match common `ORDER BY` prefixes when sorted reads matter.
- Use qualified names in joins so predicates are unambiguous.
- Use `EXPLAIN` to verify whether CamusDB chose a table scan, index lookup,
  range scan, join scan, or extra sort.

## Current Limits

The planner is improving, but there are still important limits:

- Planning is mostly heuristic-driven, not fully cost-based.
- Join planning exists, but `EXPLAIN (ANALYZE)` for joins is not supported yet.
- `(LOGICAL)` `EXPLAIN` currently labels the same physical tree rather than
  rendering a separate logical-plan view.
- Descending-order satisfaction from indexes is limited.
- Join cost estimates are not yet strong enough to drive broad join
  reordering decisions.
- `NOT IN (...)` value lists remain filter-driven rather than using a dedicated
  index-probe plan shape.
- `COUNT(DISTINCT ...)` is not supported.

These are planning limits, not correctness limits. CamusDB still aims to return
the right rows; the difference is whether it can pick the fastest available
path.

## Inspecting Plans

Use `EXPLAIN` to see what the planner chose:

```sql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [Explaining Queries And Commands](/docs/explain) for the output format and
examples, and [Query Planner Internals](/docs/query-planner-internals) for the
execution pipeline and planner architecture.
