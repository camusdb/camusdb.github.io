---
sidebar_position: 3.1
---

# Query planning

SQL states what you want. It does not state how CamusDB gets it. The planner
decides the method. It selects between a scan of a table and a probe of an
index. It selects between a sort in memory and a read in the order of an index.
It selects the algorithm of a join.

This page covers the abilities of the planner. It also covers your help toward a
good choice. For the internal pipeline, see
[Query Planner Internals](/docs/query-planner-internals). To see the choice for
one query, use [EXPLAIN](/docs/explain).

## What the planner can do

CamusDB can plan these shapes today:

- A full scan of a table.
- A point lookup on a unique index, such as an equality on a primary key.
- A scan of a range on a non-unique index, for an equality, an inequality, and a
  `BETWEEN`.
- A scan of a covering secondary index. It can return the projected columns from
  the index, and it fetches no primary row.
- Repeated probes of an index, for an indexed `IN (...)` list of values.
- A residual filter above a scan, when an index covers only part of the
  predicate.
- The omission of a sort, when an index already produces the necessary order.
- A pushdown of a `LIMIT` and an `OFFSET`, when a scan can stop early and stay
  safe.
- An aggregate, both grouped and global.
- A streaming `DISTINCT`, on a compatible indexed projection of `NOT NULL`
  columns.
- An inner join, and a join with a comma.
- A hash join for an equi-join. That includes an equi-join without a usable
  index on the right side.
- A merge join, when CamusDB can read both sides in the order of the join key.
- An indexed nested-loop join, when an index covers the join key of the right
  side.
- A rewrite to a semi-join or an anti-join, for an eligible indexed `IN` or `NOT
  IN` subquery.
- An indexed seek, for an eligible correlated `EXISTS` subquery.
- A derived table, a scalar subquery, an `IN`, a `NOT IN`, and an `EXISTS`.
- An explicit force of an index, with `@{FORCE_INDEX=...}`.
- An opt-in cache of a result, for an eligible repeated read of one table, with
  `{cache=...}`.

CamusDB has a cost-based optimizer with statistics, on top of the planner with
rules. `EXPLAIN` always exposes the estimates of the cost. Some choices use the
cost automatically. Two of those are a broad veto of a scan of a range, and the
selection of the algorithm of a join.

Two broad passes of a search are on by default:

- `cost_based_access_path_enabled` enumerates the viable access paths of each
  table, over an index and over the table. It then selects the cheapest one.
- `cost_based_join_order_enabled` enumerates the left-deep orders of a join,
  with a dynamic program in the style of System R. It then selects the cheapest
  connected plan.

Both flags default to `true`. With the statistics available, one SQL statement
can change its choice in four ways. It can select a different index, a full
scan, a different algorithm of a join, or a different order of a join. The
optimizer found a plan of a lower cost.

CamusDB keeps the matching heuristic choice when you turn either flag off.

## How CamusDB selects a scan

CamusDB tries to turn a predicate into an ordered access of the KV layer, at
every opportunity.

### An equality on a unique index

An equality on a unique index becomes a point lookup:

```camussql
SELECT *
FROM robots
WHERE id = "507f1f77bcf86cd799439011";
```

That is the best shape of a lookup. A unique primary key, and a `UNIQUE` index,
let the planner fetch at most one row directly.

### An equality on a non-unique index

An equality on a non-unique index becomes a bounded scan of a range. It does not
become one lookup:

```camussql
SELECT *
FROM robots
WHERE year = 2024;
```

`year` can be non-unique. CamusDB then scans the range that holds every matching
entry for `2024`.

### A predicate of a range

A predicate of a range can also drive a scan of an index:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND year < 2025;

SELECT *
FROM robots
WHERE year BETWEEN 2020 AND 2024;
```

### A list of values in an IN clause

CamusDB can plan an indexed `IN (...)` predicate as repeated probes of the
index:

```camussql
SELECT *
FROM robots
WHERE id IN ("id1", "id2", "id3");

SELECT *
FROM robots
WHERE year IN (2020, 2022, 2024);
```

That plan helps most when an index covers the target column, and when the list
of the values is small or of a moderate size.

### A residual filter

An index can cover part of a predicate only. CamusDB then scans with the index.
It applies the remaining filter after that:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND name = "R2";
```

An index on `year` narrows the scan. `name = "R2"` stays a residual filter.

A predicate of a pattern is also a residual filter. That set covers `LIKE`,
`ILIKE`, and the operators `~`, `~*`, `!~`, and `!~*`. Such a predicate can
still combine with an indexable predicate on another column:

```camussql
SELECT *
FROM robots
WHERE year >= 2020 AND name ~* "^r";
```

### A covering index

An index with an `INCLUDE (...)` can answer a query without a fetch of the
primary row. Every necessary column must be a key column, or an included
column:

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

The key column `customer_id` drives the lookup. CamusDB stores the included
columns `status` and `total` in the entry of the index. It can return them
directly.

A query can project or filter on a column that is neither a key column nor an
included column. CamusDB can then still use the index. It must nevertheless
fetch the primary row. See [Indexes](/docs/sql-indexes#covering-indexes).

## The behavior of a composite index

A composite index helps most when the predicates of a query follow the order of
the columns of the index, from left to right.

Here is an index on `(kind, year)`:

```camussql
SELECT *
FROM robots
WHERE kind = "service" AND year >= 2020;
```

CamusDB can use the prefix of the equality on `kind`, and the range on `year`.

A query can skip the leftmost column of the index. The planner may then be
unable to use that composite index well:

```camussql
SELECT *
FROM robots
WHERE year >= 2020;
```

## The statistics, and the cost-based optimizer

CamusDB keeps light advisory statistics from a live write. It keeps richer
statistics from an `ANALYZE`. The planner can use them to estimate five things:

- The row count of a table.
- The count of the entries of each index.
- The bounds of the minimum and the maximum of each indexed column.
- The histogram of a column.
- The count of the distinct values, for a column and for a prefix of a composite
  index.

You can read all of them from a SQL prompt, with
[`SHOW STATISTICS FOR <table>`](/docs/show-statistics). That statement also
reports the time of the last analyze of the table, and the amount of the change
since then.

Run `ANALYZE` after a load of the data, and after a material change of it. Use
it when you want better estimates of the selectivity and of the cardinality of a
join:

```camussql
ANALYZE TABLE robots;
```

CamusDB also has a path for an automatic analyze in the engine. It can refresh a
stale statistic of a table in the background. It counts the mutations of the
rows since the last analyze. It can rebuild the statistics after enough rows
change. See [Automatic Analyze](/docs/automatic-analyze) for the threshold of
the staleness, for the limits on the resources, and for the settings.

The cost model uses these estimates to fill `estimated_rows` and
`estimated_cost` in an `EXPLAIN`. It also feeds five decisions:

- The choice between a scan of a range and a full scan of a table.
- The choice between a plan of probes for an indexed `IN (...)` and a wider
  scan.
- The selection of the algorithm of a join, among an indexed nested loop, a hash
  join, and a merge join.
- The selection of an access path by cost, while
  `cost_based_access_path_enabled` is on.
- The enumeration of the order of a join by cost, while
  `cost_based_join_order_enabled` is on.

The optimizer degrades safely. An absent statistic and a stale statistic do not
make a query incorrect. CamusDB falls back to a default. It also falls back to
the planner with rules, when it cannot cost a plan reliably.

### An access path by cost

With `cost_based_access_path_enabled: true`, CamusDB considers every viable
access path of one table. That set holds each usable index, and the baseline of
a full scan. CamusDB estimates the cost of each candidate. It keeps the cheapest
one.

That behavior matters when more than one index could satisfy a predicate. A
planner with rules can prefer the longest prefix of an equality. The planner
with a cost can prefer a different index. It can even prefer a full scan, when
the statistics show a smaller amount of data in total.

### The order of a join by cost

With `cost_based_join_order_enabled: true`, CamusDB can reorder an eligible
inner join by cost. It then depends on neither the order of the declaration nor
a simple heuristic of the selectivity.

The enumerator of the joins searches the connected left-deep orders. It uses
four inputs:

1. The statistics of the tables.
2. The selectivity of the filters.
3. The counts of the distinct values of the join keys.
4. The costs of the algorithms of a join.

It then selects a cheaper tree.

It falls back to the planner with rules for a join outside its current envelope
of the search. Two examples are a very wide join, and a shape that it cannot
reorder safely.

## The order of the rows, and the omission of a sort

An index can already yield the rows in the order that an `ORDER BY` needs.
CamusDB can then omit a separate sort in memory.

```camussql
SELECT *
FROM robots
ORDER BY year;
```

With a compatible index on `year`, CamusDB can scan directly in that order. The
direction of the index must match the direction of the query. An index on
`(year ASC)` can satisfy `ORDER BY year ASC`. An index on `(year DESC)` can
satisfy `ORDER BY year DESC`.

A composite index can also satisfy an order. The list of the `ORDER BY` must
match a prefix of the index, from left to right, and it must match the
direction. For example, `(kind ASC, year DESC)` can satisfy `ORDER BY kind ASC,
year DESC`.

Three cases usually need a real sort:

- An `ORDER BY` on a column without a compatible index.
- An order that does not match the prefix of the index.
- A difference of the direction, such as an `ORDER BY year ASC` when only
  `(year DESC)` is available.

## The pushdown of a LIMIT

The shape of a query can be simple enough. CamusDB can then stop the scan below
it early. It does not read the whole input first.

```camussql
SELECT *
FROM robots
ORDER BY year
LIMIT 10;
```

That behavior works best under three conditions:

- The scan already satisfies the requested order.
- No extra filter must run after the scan.
- No group, no `HAVING`, and no `DISTINCT` prevents an early stop.

## A parallel scan, and a distributed scan

A full scan of a table can use more than one thread, on one node. Set
`max_query_parallelism` above `1`. The scan then streams one time, and the rows
decode in chunks on the thread pool:

```camussql
SET CLUSTER SETTING max_query_parallelism = 4;
```

The consumer takes the chunks in the order of their dispatch. A query therefore
returns the same rows, in the same order, as it returns with the default of `1`.

The setting belongs to one node. It takes effect at the next query. It buys
throughput of the decode on a wide row. It costs one buffer for each worker, and
more concurrent reads of the storage.

In a cluster, an eligible full scan can go further. It can run one fragment for
each partition, on the node that owns the rows. It then applies the filters and
the aggregates before anything crosses the network. That behavior is off by
default. See [Distributed Queries](/docs/distributed-queries).

## Joins

CamusDB supports `JOIN`, `INNER JOIN`, and a join with a comma. For an inner
equi-join, the planner can select among several physical algorithms:

| Plan of a join | When it is useful |
| --- | --- |
| `index-nested-loop-join` | The right side has an index on the join key. The left side is also small enough for a probe of the index at each row. |
| `hash-join` | The join is an equality. A scan and a build of a hash table is cheaper than repeated probes of the right side. The right side can also have no usable index on the join key. |
| `merge-join` | CamusDB can read both sides in the order of the join key, usually through two compatible indexes. It can therefore stream both sides together. |
| `nested-loop-join` | The fallback, for a join that is eligible for none of the indexed, hash, and merge forms. |

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

The right side can have an index on the join key. CamusDB can then use an
indexed nested-loop join. It does not scan the whole right side for each left
row.

For a larger join of an equality, the planner may select a hash join or a merge
join instead. It does that when the estimates show a cheaper shape.

An index that suits a join therefore matters. Here is a join:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

An index on `posts(user_id)` is far more useful than an unrelated index on
`posts(title)`.

A hash join materializes the side that the estimate calls smaller, into a hash
table in memory. It streams the other side as the probes.

The build side can exceed the configured limit of a hash join. CamusDB can then
use [spill to disk](/docs/spill-to-disk). It divides the join, and it keeps the
memory bounded. With the spill disabled, the execution of that query falls back
to the behavior of a nested loop.

A merge join needs join keys of an equality. CamusDB can produce both inputs in
the order of the join key. It then advances both streams together, and it
buffers only the current run of equal keys. That plan helps most in a larger
join, where both tables have a compatible index on the columns of the join.

## The rewrite of an IN and of a NOT IN subquery

For an eligible subquery without a correlation, CamusDB can perform two
rewrites:

- `x IN (SELECT key FROM t)` becomes a semi-join.
- `x NOT IN (SELECT key FROM t)` becomes an anti-join.

Both rewrites need a usable index on the inner side. They also need a simple
enough shape of the subquery. The rewrite avoids a scan of more data than
necessary. It also avoids the materialization of that data.

CamusDB falls back when the inner side does not suit a rewrite. It materializes
the result of the subquery. It then applies the outer predicate normally.

`NOT IN` keeps the null semantics of SQL. An inner value that accepts a `NULL`
can force a more conservative path, such as an anti-join that knows about a
null. It can also force a fallback strategy.

## The plan of a DISTINCT

`SELECT DISTINCT` has two shapes of an execution:

- A streaming distinct. It needs two conditions: every projected column of the
  distinct is `NOT NULL`, and the rows arrive in a compatible order of an index.
- A hash distinct. CamusDB must keep a set of the rows that it saw, in memory.

A streaming distinct is the better path for a repeated read. It can use constant
memory. It can also avoid a separate node of a `sort`, when the `ORDER BY`
matches the order of the index.

A `SELECT DISTINCT *` falls back to a hash distinct. A `SELECT DISTINCT` over a
column without an index, and over a column that accepts a `NULL`, also falls
back.

## A derived table, and a subquery

CamusDB can plan four forms:

- A derived table in a `FROM` clause.
- A scalar subquery.
- An `IN` and a `NOT IN` subquery.
- An `EXISTS` subquery.

Here are two examples:

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

For a subquery without a correlation, CamusDB can evaluate the inner query one
time. It then plans the outer predicate around that result.

For a correlated `EXISTS`, CamusDB can avoid a full scan of the inner table. The
inner table needs an index whose leading key columns a predicate of an equality
fixes. The key of the seek can come from a column of the outer row, from a
literal, or from a parameter.

CamusDB still evaluates the full inner predicate on the rows that the seek
returns. The optimization therefore changes the amount of the work. It does not
change which rows match.

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

The executor falls back to the full inner scan when no suitable index exists.

Under a Serializable transaction, CamusDB protects the range of the indexed
seek. A concurrent insert into that range therefore cannot create a phantom that
the query misses.

## Force an index

You can force a specific index when you know that CamusDB must use it:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Use that hint with care. It is a tool for debugging and for tuning. It does not
replace a good design of a schema. CamusDB honors the hint even when the forced
index makes the query slower.

## A hint for the result cache

For a repeated read of one table, a `SELECT` can opt into the result cache of
the node:

```camussql
SELECT id, total
FROM orders {cache=recent_orders, ttl=30s}
WHERE status = "paid";
```

The result cache stores a fully materialized result in memory, after a
successful read in autocommit mode.

It is separate from the plan cache. The plan cache reuses a decision of the
optimizer. The result cache skips a read of the storage, and it returns the
cached rows.

Four behaviors of the plan matter:

- Only a `SELECT` over one table, in autocommit mode, is eligible for the cache.
- A join bypasses the result cache, even with a hint present.
- An explicit transaction reads the live storage.
- `EXPLAIN` adds an informational row `cache` when a hint of the cache is
  present.

See [Query Result Cache](/docs/query-result-cache) for the syntax, for the
guarantees of the freshness, for the manual eviction, and for the settings.

## What helps the planner

Do these things for a consistently better plan:

- Index the columns of an equality, the columns of a range, and the keys of a
  join.
- Put the most selective column first in a composite index, when your queries
  follow that shape from left to right.
- Index both keys of a join for a large equi-join, when you want a merge join to
  be available.
- Add an index that matches a common prefix of an `ORDER BY`. Match the
  direction of `ASC` and `DESC` as well, when a sorted read matters.
- Add an `INCLUDE` column for a hot lookup that returns a small set of columns
  outside the key.
- Run `ANALYZE TABLE <name>` after a bulk load, and after a major change of the
  distribution of the data. Do that when you need a fresh statistic
  immediately. Automatic analyze refreshes a stale statistic in the background,
  by default.
- Leave `cost_based_access_path_enabled` on. CamusDB then compares every viable
  index by its estimated cost.
- Leave `cost_based_join_order_enabled` on. CamusDB then searches the left-deep
  orders of an inner join by their estimated cost.
- Add a `{cache=...}` only to a repeated read of one table, with many reads, and
  with a result small enough for the memory.
- Add an index on the correlated inner columns of an `EXISTS` predicate.
- Use a qualified name in a join. A predicate is then unambiguous.
- Use `EXPLAIN` to confirm the choice of CamusDB: a scan of a table, a lookup on
  an index, a scan of a range, a scan for a join, or an extra sort.

## The current limits

The planner improves over time. Important limits nevertheless remain:

- The broad search of an access path by cost, and of an order of a join by cost,
  are on by default. Both depend on useful statistics.
- The plan of a join exists. `EXPLAIN (ANALYZE)` does not support a join yet.
- `EXPLAIN (LOGICAL)` currently labels the same physical tree. It renders no
  separate view of a logical plan.
- The use of a descending order from an index is limited.
- The enumeration of the order of a join by cost is left-deep. CamusDB caps it
  for a very wide join. It currently applies to the shapes of an inner join that
  CamusDB can reorder.
- A `NOT IN (...)` list of values stays driven by a filter. It uses no dedicated
  shape of a plan with probes of an index.
- CamusDB does not support `COUNT(DISTINCT ...)`.

These are limits of the plan. They are not limits of the correctness. CamusDB
still returns the correct rows. The difference is the speed of the available
path.

## Inspect a plan

Use `EXPLAIN` to see the choice of the planner:

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [EXPLAIN](/docs/explain) for the format of the output, and for some
examples. See [Query Planner Internals](/docs/query-planner-internals) for the
pipeline of the execution, and for the architecture of the planner.
