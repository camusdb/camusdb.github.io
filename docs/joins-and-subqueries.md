---
sidebar_position: 2.42
---

# Joins and subqueries

This page covers a query that reads from more than one source. Three forms do
that: a join, a subquery in a `WHERE` clause, and a subquery in a `FROM` clause.

Everything on this page composes with the clauses in
[SELECT](/docs/sql-queries). The filter, the group, the sort, and the pagination
behave the same way after CamusDB combines the sources.

## Join forms

CamusDB supports these joins in the `FROM` clause:

| Form | Syntax | Rows returned |
| --- | --- | --- |
| Inner | `A JOIN B ON p` or `A INNER JOIN B ON p` | Every pair of rows for which `p` is true. |
| Left outer | `A LEFT JOIN B ON p` or `A LEFT OUTER JOIN B ON p` | Every inner-join pair, plus one row for each `A` row with no match, with the `B` columns set to `NULL`. |
| Right outer | `A RIGHT JOIN B ON p` or `A RIGHT OUTER JOIN B ON p` | The same rows as `B LEFT JOIN A ON p`. |
| Cross | `A CROSS JOIN B` | Every pair of rows. No `ON` clause is allowed. |

Joins chain left to right, and a chain can mix forms:

```camussql
SELECT a.id, b.id, c.id
FROM a
JOIN b ON b.a_id = a.id
LEFT JOIN c ON c.b_id = b.id;
```

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

## Outer joins

A left outer join preserves every row from the left side:

```camussql
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

If a left row has one or more matches, CamusDB returns one row for each match.
If it has no match, CamusDB returns one row with every right-side column set to
`NULL`.

The `ON` clause decides whether a right row matches. The `WHERE` clause filters
after CamusDB has produced the joined rows. This distinction matters for outer
joins:

```camussql
-- Users without a post.
SELECT u.email
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.id IS NULL;

-- Users with a published post. The right-side WHERE predicate removes padded rows.
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.published = true;
```

A `NULL` join key does not match another `NULL` join key. The comparison
`NULL = NULL` is unknown, so a row with a `NULL` join key is padded unless
another condition in `ON` matches it.

`RIGHT JOIN` is executed as a left join with the operands swapped. Prefer an
explicit column list when you use `RIGHT JOIN`; `SELECT *` follows the executed
order, so the preserved table's columns come first.

One `RIGHT JOIN` limit is worth knowing: a `RIGHT JOIN` whose left operand is
itself a join is not supported. Rewrite the query with the preserved table on
the left side, often through a derived table.

## Cross joins

`CROSS JOIN` returns the Cartesian product:

```camussql
SELECT r.name, c.currency
FROM robots r
CROSS JOIN currencies c;
```

It is equivalent to the comma form without an equality predicate. When every
source is a cross join, CamusDB can still lift an equality from the `WHERE`
clause and plan it as a join predicate.

### How a join executes

For an inner join or a left outer join with an equality key, the planner selects
one of three strategies:

| Strategy | CamusDB selects it when | Shape of the cost |
| --- | --- | --- |
| An indexed lookup | The right side has an index on the column of the equality, and the outer side is small. | One probe for each outer row. |
| A hash join | The right side has no usable index, or the outer side is large compared with the indexed side. | It builds a hash table from the side that the estimate calls smaller (the build side), then looks up each row of the other side (the probe side) in it. |
| A merge join | Two compatible indexes already give both sides in the order of the join key, and the outer side is large. | It streams both sides. There is no phase for a build. |

An equality join without an index uses a hash join. It does not scan the inner
table once for each outer row. CamusDB plans a nested loop only when the join
has no usable equality key, for example `ON o.total > c.credit_limit`. An equality
between columns of different declared types, or on an array column, is not a
usable key.

An index on the join column of the right side helps most when the outer side is
small, because each outer row becomes one index probe.

A hash join can become too large. It can then divide the intermediate rows onto
the disk, instead of a growth of the memory without a bound. That behavior needs
[spill to disk](/docs/spill-to-disk). With spill to disk off, a hash join whose
build side passes `hash_join_max_build_rows` falls back to a nested loop.

In a cluster with [distributed queries](/docs/distributed-queries) enabled,
CamusDB can broadcast a small build side of a hash join. It sends that side to
the nodes that own the [partitions](/docs/concepts#partition) (the units into
which the cluster divides its data) of the probe table. Those nodes probe
locally. They return only the rows that matched. The output is the same in both
cases.

For a left outer join, the preserved side must remain the probe side. A
broadcast hash join is therefore not used for a left outer join, because a
remote probe can return matches but cannot produce the padded rows for the
preserved side.

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

## Current join limits

CamusDB does not support `FULL JOIN`, `FULL OUTER JOIN`, `NATURAL JOIN`, or
`JOIN ... USING (...)` yet. `FULL JOIN` is rejected as not supported; the other
forms are syntax errors.

A query with an outer join keeps the join order that the statement declares.
The heuristic planner and the cost-based join-order search do not reorder a
tree that contains an outer join.

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
an `IN` (it keeps each outer row that has at least one match), and an anti-join
for a `NOT IN` (it keeps each outer row that has no match). It does not
materialize the full inner result first.

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
