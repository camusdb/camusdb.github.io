---
sidebar_position: 3
---

# Query Features

CamusDB supports a practical SQL query surface for filtering, joining,
aggregating, sorting, paginating, and composing results from subqueries and
derived tables.

The planner can use table scans, unique-index lookups, non-unique index range
scans, indexed join probes, sort elision, and limit pushdown depending on the
query shape and available indexes. See [Query Planning](/docs/query-planning)
for the planning rules and [EXPLAIN](/docs/explain) for plan inspection.

## Select Lists

Queries can project all columns, named columns, qualified columns, expressions,
and aliases:

```sql
SELECT * FROM robots;
SELECT id, name, year FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT COUNT(*) AS total FROM robots;
SELECT upper(trim(name)) AS display_name FROM robots;
```

When a query has more than one source, use qualified column references such as
`u.email` and `p.title` to avoid ambiguity.

## Functions

Scalar functions can be used in projections, aliases, filters, and nested
expressions:

```sql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5
ORDER BY display_name;

SELECT name
FROM robots
WHERE json_valid(payload) = true
  AND json_type(payload) = "object";
```

See [Functions](/docs/functions) for string, math, date/time, JSON,
conversion, and object id functions.

## Filters

`WHERE` supports comparisons, boolean composition, pattern matching, null
checks, and boolean column predicates:

```sql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE enabled OR year IS NULL;

SELECT *
FROM robots
WHERE name LIKE "%D2" OR name IS NOT NULL;

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004
ORDER BY year;
```

Supported filter operators include:

| Category | Syntax |
| --- | --- |
| Comparison | `=`, `!=`, `<`, `>`, `<=`, `>=`, `BETWEEN ... AND ...` |
| Boolean | `AND`, `OR`, bare boolean columns such as `WHERE enabled` |
| Pattern matching | `LIKE`, `ILIKE` |
| Null checks | `IS NULL`, `IS NOT NULL` |
| Subquery membership | `IN (SELECT ...)`, `NOT IN (SELECT ...)` |
| Existence checks | `EXISTS (SELECT ...)` |

`BETWEEN` is inclusive. `year BETWEEN 2001 AND 2004` matches `2001`, `2002`,
`2003`, and `2004`.

## Ordering And Pagination

Results can be ordered by one or more expressions. `LIMIT` and `OFFSET` can use
literal integers or placeholders.

```sql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

For grouped queries, `ORDER BY` can reference selected aggregate aliases,
aggregate expressions, or grouped expressions:

```sql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY cnt, role;

SELECT COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY role;
```

## Aggregates

CamusDB supports global aggregates and grouped aggregates:

```sql
SELECT COUNT(*) FROM robots;
SELECT COUNT(year), SUM(year), AVG(year), MIN(year), MAX(year)
FROM robots;

SELECT enabled, SUM(year) AS total, AVG(year) AS average
FROM robots
GROUP BY enabled
ORDER BY enabled;
```

Supported aggregate functions are:

| Function | Behavior |
| --- | --- |
| `COUNT(*)` | Counts all rows. |
| `COUNT(column)` | Counts non-null values for the column. |
| `SUM(column)` | Sums numeric values and ignores nulls. |
| `AVG(column)` | Returns a `FLOAT64` average for numeric values and ignores nulls. |
| `MIN(column)` | Returns the smallest non-null value. |
| `MAX(column)` | Returns the largest non-null value. |

Grouped queries enforce standard SQL-style projection rules: every
non-aggregate projection must appear in `GROUP BY`. A query such as
`SELECT name, COUNT(*) FROM robots` requires `GROUP BY name`.

## Group By

`GROUP BY` accepts one or more columns or expressions:

```sql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role;

SELECT role, department, COUNT(*) AS cnt
FROM app_users
GROUP BY role, department;

SELECT year + 100 AS display_year
FROM robots
GROUP BY year + 100;
```

`WHERE` runs before grouping. `ORDER BY`, `LIMIT`, and `OFFSET` run after
grouping and projection.

## Having

`HAVING` filters grouped or aggregate results after aggregation. It can
reference aggregate aliases, aggregate expressions, and grouped keys:

```sql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY role;

SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING COUNT(*) > 1
ORDER BY role;

SELECT role
FROM app_users
GROUP BY role
HAVING role = "admin";
```

`HAVING` also works with global aggregate queries:

```sql
SELECT COUNT(*) AS total
FROM robots
HAVING total > 0;
```

Use `WHERE` to filter input rows before grouping. Use `HAVING` to filter the
grouped or aggregate rows after grouping. A `HAVING` clause requires either
`GROUP BY` or an aggregate projection.

## Inner Joins

CamusDB supports `JOIN` and `INNER JOIN`:

```sql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;

SELECT u.role, COUNT(*) AS cnt
FROM app_users u
INNER JOIN posts p ON p.user_id = u.id
GROUP BY u.role
ORDER BY u.role;
```

Join predicates can compare qualified columns from both sides. Additional
single-table filters can stay in `WHERE`:

```sql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = "admin" AND p.published = true
ORDER BY u.email, p.title;
```

When the right side has an index on the equality join column, the planner can
use indexed lookups instead of scanning the whole right side.

## Comma Joins

Comma joins are supported for compatibility. CamusDB extracts equality
predicates from `WHERE` and treats them as inner join predicates:

```sql
SELECT r.name, u.amount
FROM robots r, user_robots u
WHERE r.id = u.robots_id
ORDER BY r.name, u.amount;
```

Single-source predicates remain as filters:

```sql
SELECT r.name, u.amount
FROM robots r, user_robots u
WHERE r.id = u.robots_id AND r.enabled = true
ORDER BY u.amount;
```

Use aliases in comma joins. They keep column references unambiguous and match
the current binder behavior.

## Scalar Subqueries

Scalar subqueries can appear inside expressions, commonly in `WHERE`:

```sql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

A scalar subquery must return one column. If it returns zero rows, CamusDB uses
`NULL`. If it returns more than one row, the query fails.

## IN And NOT IN Subqueries

`IN` and `NOT IN` accept an uncorrelated subquery that returns exactly one
column:

```sql
SELECT email
FROM app_users
WHERE id IN (
  SELECT user_id
  FROM posts
  WHERE published = true
)
ORDER BY email;

SELECT id
FROM robots
WHERE id NOT IN (
  SELECT robots_id
  FROM blocked_robots
)
ORDER BY id;
```

The subquery result is materialized as a value list for the outer predicate.
Multi-column `IN` and `NOT IN` subqueries are rejected. Correlated `IN` and
`NOT IN` subqueries are not supported.

`NOT IN` follows SQL null semantics: if the materialized subquery contains
`NULL`, non-matching rows evaluate to unknown and are filtered out.

## EXISTS Subqueries

`EXISTS` works with correlated and uncorrelated subqueries:

```sql
SELECT email
FROM app_users
WHERE EXISTS (
  SELECT *
  FROM posts
  WHERE posts.user_id = app_users.id
)
ORDER BY email;

SELECT email
FROM app_users
WHERE EXISTS (SELECT user_id, title FROM posts)
ORDER BY email;
```

For `EXISTS`, the subquery projection can be `*`, one column, or multiple
columns because only row existence matters.

## Derived Tables

A derived table is a parenthesized `SELECT` in the `FROM` clause. It must have
an alias:

```sql
SELECT post_count
FROM (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d
WHERE d.post_count = 2
ORDER BY post_count;
```

Derived tables can be joined with base tables or other derived results:

```sql
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

Derived table columns use the projection output names from the inner query.
Aliases such as `COUNT(*) AS post_count` make outer queries easier to read.

## Table Hints

For direct table scans, a query can force a specific index:

```sql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

This is useful when you know which index best matches a predicate. Joins can
also benefit from indexes on right-side equality join columns.

## EXPLAIN

Use `EXPLAIN` to inspect the physical plan CamusDB chose:

```sql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

`EXPLAIN` can show whether CamusDB used a `table-scan`, `index-lookup`,
`index-range-scan`, join node, sort, aggregate, or limit stage.

`EXPLAIN (ANALYZE)` executes the query and adds runtime counters such as
`actual_rows`, `rows_read`, `kv_lookups`, and `kv_scan_entries`. It is
currently limited to non-join queries.

See [EXPLAIN](/docs/explain) for the full output reference.

## Parameters

SQL placeholders can be used in filters and pagination:

```sql
SELECT id, name
FROM robots
WHERE id = @id
LIMIT @limit;
```

Placeholders are bound by the client or shell command that submits the SQL.
