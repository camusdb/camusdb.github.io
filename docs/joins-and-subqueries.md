---
sidebar_position: 2.42
---

# Joins and subqueries

This page covers a query that reads from more than one source. Three forms do
that: a join, a subquery in a `WHERE` clause, and a subquery in a `FROM` clause.

Everything on this page composes with the clauses in
[SELECT](/docs/sql-queries). The filter, the group, the sort, and the pagination
behave the same way after CamusDB combines the sources.

## Inner joins

`JOIN` and `INNER JOIN` are equivalent:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

Keep the condition of the join in the `ON` clause. Keep a condition on one table
in the `WHERE` clause:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = "admin" AND p.published = true
ORDER BY u.email, p.title;
```

Give every source an alias. Qualify every reference to a column. With more than
one table in scope, a bare `name` is ambiguous when both sides define it.

A join composes freely with a group:

```camussql
SELECT u.role, COUNT(*) AS cnt
FROM app_users u
JOIN posts p ON p.user_id = u.id
GROUP BY u.role
ORDER BY u.role;
```

### How a join executes

The planner selects one of three strategies:

| Strategy | CamusDB selects it when | Shape of the cost |
| --- | --- | --- |
| An indexed lookup | The right side has an index on the column of the equality. | One probe for each outer row. |
| A hash join | The join is larger, and it has no usable index. | It builds a hash table from the side that the estimate calls smaller. |
| A merge join | Two compatible indexes already give both sides in the order of the join key. | It streams both sides. There is no phase for a build. |

An index on the join column of the right side is the change with the highest
value for a slow join. Without that index, every outer row scans the inner
table.

A hash join can become too large. It can then divide the intermediate rows onto
the disk, instead of a growth of the memory without a bound. That behavior needs
[spill to disk](/docs/spill-to-disk).

In a cluster with [distributed queries](/docs/distributed-queries) enabled,
CamusDB can broadcast a small build side of a hash join. It sends that side to
the nodes that own the partitions of the probe table. Those nodes probe locally.
They return only the rows that matched. The output is the same in both cases.

### A join with a comma

CamusDB supports a join with a comma, for compatibility. It lifts a predicate of
an equality out of the `WHERE` clause, and it treats that predicate as a
condition of the join. A predicate on one source stays a filter:

```camussql
SELECT r.name, u.amount
FROM robots r, user_robots u
WHERE r.id = u.robots_id AND r.enabled = true
ORDER BY u.amount;
```

Prefer an explicit `JOIN ... ON` in new code. It separates the condition of the
join from the filters. Both parts are then easier to read, and easier to change.

## A subquery in a WHERE clause

### A scalar subquery

A scalar subquery returns one column. It takes the place of one value:

```camussql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

Zero rows give a `NULL`. More than one row is an error.

### IN and NOT IN

`IN` and `NOT IN` accept a subquery without a correlation. That subquery must
return exactly one column:

```camussql
SELECT email
FROM app_users
WHERE id IN (
  SELECT user_id
  FROM posts
  WHERE published = true
)
ORDER BY email;
```

The inner query can be indexed and eligible. CamusDB then runs a semi-join for
an `IN`, and an anti-join for a `NOT IN`. It does not materialize the full inner
result first.

`NOT IN` follows the null semantics of SQL. One `NULL` in the inner result makes
every row that does not match evaluate to unknown. CamusDB drops those rows, and
the query commonly returns zero rows. Use `NOT EXISTS` when the inner column
accepts a `NULL`.

CamusDB rejects an `IN` or a `NOT IN` subquery over several columns. It also
rejects a correlated one.

### EXISTS

`EXISTS` works with a correlation, and without one. Only the existence of a row
matters. The inner projection can therefore be a `*`, one column, or several
columns:

```camussql
SELECT email
FROM app_users
WHERE EXISTS (
  SELECT *
  FROM posts
  WHERE posts.user_id = app_users.id
)
ORDER BY email;
```

For a correlated `EXISTS`, CamusDB uses an index on the inner table under one
condition. The inner `WHERE` clause must pin the leading columns of that index
with an equality. The other side of the equality can be a value of the outer
row, a literal, or a parameter:

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

The index only narrows the candidate rows. The full inner predicate still runs
after the seek. Without a suitable index, the result is identical. CamusDB then
scans the inner table one time for each outer row.

## A derived table

A derived table is a `SELECT` in parentheses, inside the `FROM` clause. It needs
an alias:

```camussql
SELECT post_count
FROM (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d
WHERE d.post_count = 2
ORDER BY post_count;
```

A derived table joins like any other source. That is the usual way to filter a
table against an aggregate of each group:

```camussql
SELECT u.email, d.post_count
FROM app_users u
JOIN (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d ON d.user_id = u.id
WHERE d.post_count >= 1
ORDER BY u.email;
```

The columns of a derived table take their names from the inner projection. Give
every computed column an alias, as in `COUNT(*) AS post_count`. Otherwise the
outer query has no usable name to reference.

## Check the plan

The choice of a plan matters most for a query with several sources. `EXPLAIN`
shows the selected strategy of the join. It also shows whether CamusDB used an
index:

```camussql
EXPLAIN SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

See [EXPLAIN](/docs/explain) for the reference of the output. See
[Query Planning](/docs/query-planning) for the rules behind the choice.
