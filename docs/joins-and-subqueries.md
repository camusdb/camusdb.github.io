---
sidebar_position: 2.42
---

# Joins And Subqueries

Queries that read from more than one source: joins, subqueries in `WHERE`,
subqueries in `FROM`.

Everything on this page composes with the clauses in [SELECT](/docs/sql-queries):
filtering, grouping, sorting, and pagination behave the same way once the sources
are combined.

## Inner Joins

`JOIN` and `INNER JOIN` are equivalent:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

Keep the join condition in `ON` and single-table conditions in `WHERE`:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = "admin" AND p.published = true
ORDER BY u.email, p.title;
```

Alias every source and qualify every column reference. With more than one table
in scope, an unqualified `name` is ambiguous whenever both sides define it.

Joins combine freely with grouping:

```camussql
SELECT u.role, COUNT(*) AS cnt
FROM app_users u
JOIN posts p ON p.user_id = u.id
GROUP BY u.role
ORDER BY u.role;
```

### How Joins Execute

The planner picks one of three strategies:

| Strategy | Chosen when | Cost shape |
| --- | --- | --- |
| Indexed lookup | The right side has an index on the equality join column. | One probe per outer row. |
| Hash join | Larger equality joins with no usable index. | Builds a hash table from the estimated smaller side. |
| Merge join | Compatible indexes already supply both sides in join-key order. | Streams both sides, no build phase. |

An index on the right-side join column is the single highest-leverage change for
a slow join. Without one, every outer row scans the inner table.

Oversized hash joins can partition intermediate rows to disk rather than growing
memory without bound, when [spill to disk](/docs/spill-to-disk) is enabled.

In a cluster with [distributed queries](/docs/distributed-queries) enabled, a
small hash-join build side can be broadcast to the nodes that own the probe
table's partitions, which probe locally and return only the rows that matched.
The output is the same either way.

### Comma Joins

Comma joins are supported for compatibility. Equality predicates are lifted out
of `WHERE` and treated as join conditions; single-source predicates stay as
filters:

```camussql
SELECT r.name, u.amount
FROM robots r, user_robots u
WHERE r.id = u.robots_id AND r.enabled = true
ORDER BY u.amount;
```

Prefer explicit `JOIN ... ON` in new code. It separates the join condition from
the filters, which makes both easier to read and to change.

## Subqueries In WHERE

### Scalar Subqueries

A scalar subquery returns one column and stands in for a single value:

```camussql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

Zero rows yields `NULL`. More than one row is an error.

### IN And NOT IN

`IN` and `NOT IN` accept an uncorrelated subquery returning exactly one column:

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

When the inner query is indexed and eligible, this runs as a semi-join
(`IN`) or anti-join (`NOT IN`) rather than materializing the full inner result
first.

`NOT IN` inherits SQL null semantics: if the inner result contains a single
`NULL`, non-matching rows evaluate to unknown and are dropped, commonly
returning zero rows. Use `NOT EXISTS` when the inner column is nullable.

Multi-column and correlated `IN` / `NOT IN` subqueries are rejected.

### EXISTS

`EXISTS` works correlated or uncorrelated, and only row existence matters, so
the inner projection can be `*`, one column, or several:

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

For a correlated `EXISTS`, an index on the inner table is used when the inner
`WHERE` pins the leading index columns with equality predicates, against outer
row values, literals, or parameters:

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

The index only narrows the candidate rows; the full inner predicate still runs
after the seek. Without a qualifying index the result is identical, but the
inner table is scanned once per outer row.

## Derived Tables

A derived table is a parenthesized `SELECT` in `FROM`. It requires an alias:

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

Derived tables join like any other source, which is the usual way to filter a
table against a per-group aggregate:

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

The derived table's columns take their names from the inner projection, so alias
every computed column, as in `COUNT(*) AS post_count`, or the outer query has no
usable name to reference.

## Checking The Plan

Multi-source queries are where plan choice matters most. `EXPLAIN` shows which
join strategy was selected and whether an index was used:

```camussql
EXPLAIN SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

See [EXPLAIN](/docs/explain) for the output reference and
[Query Planning](/docs/query-planning) for the rules behind the choice.
