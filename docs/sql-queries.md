---
sidebar_position: 2.4
---

# Querying Data

Use `SELECT` for projections, filters, grouping, ordering, and pagination.

For scalar utility queries such as `SELECT 1 + 1`, `SELECT upper("abc")`, or
`SELECT EXISTS (...)` without a table source, see
[FROM-less SELECT](/docs/sql-fromless-select).

## Select Lists

Select explicit columns, all columns, qualified columns, expressions, aliases,
or aggregate expressions:

```camussql
SELECT id, name FROM robots;
SELECT * FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT CASE WHEN year >= 2000 THEN "modern" ELSE "classic" END AS era FROM robots;
SELECT SUM(year) AS total_year FROM robots;
SELECT DISTINCT kind FROM robots ORDER BY kind;
```

Supported aggregate functions are:

- `COUNT(*)` and `COUNT(column)`
- `SUM(column)`
- `AVG(column)`
- `MIN(column)`
- `MAX(column)`

## CASE Expressions

Use `CASE ... END` to choose a value conditionally inside a query.

Searched `CASE` evaluates boolean predicates in order and returns the first
matching branch:

```camussql
SELECT
  name,
  CASE
    WHEN year < 1980 THEN "classic"
    WHEN year >= 1980 THEN "modern"
    ELSE "unknown"
  END AS era
FROM robots;
```

Simple `CASE` compares one expression against each `WHEN` value:

```camussql
SELECT
  status,
  CASE status
    WHEN "A" THEN "active"
    WHEN "B" THEN "blocked"
    ELSE "other"
  END AS status_name
FROM users;
```

`CASE` can be used in projections, `WHERE`, aggregate expressions, derived
tables, and check constraints:

```camussql
SELECT SUM(CASE WHEN status = "paid" THEN amount ELSE 0 END) AS paid_total
FROM orders;

SELECT *
FROM orders
WHERE CASE WHEN status = "paid" THEN true ELSE false END;
```

Evaluation is first-match wins. If no branch matches and there is no `ELSE`,
the result is `NULL`. `WHEN` conditions that evaluate to `NULL` do not match.

## DISTINCT

```camussql
SELECT DISTINCT kind FROM robots ORDER BY kind;
SELECT DISTINCT kind, year FROM robots ORDER BY kind, year;
```

Current limits:

- `COUNT(DISTINCT column)` is not supported.
- `SELECT DISTINCT` cannot be combined with `GROUP BY`.
- `SELECT DISTINCT` cannot wrap aggregate projections such as
  `SELECT DISTINCT COUNT(*) ...`.

## Filters

```camussql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE year IS NULL OR name LIKE "%D2";

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004;

SELECT name
FROM robots
WHERE name ~* "^r";
```

Supported filter operators include `=`, `!=`, `<`, `>`, `<=`, `>=`, `AND`,
`OR`, `LIKE`, `ILIKE`, regex operators `~`, `~*`, `!~`, `!~*`,
`BETWEEN ... AND ...`, `IS NULL`, `IS NOT NULL`, `IN (...)`, `NOT IN (...)`,
`IN (SELECT ...)`, `NOT IN (SELECT ...)`, and `EXISTS (SELECT ...)`.

## Regex Matching

Use regex operators when `LIKE` / `ILIKE` wildcards are not expressive enough.

| Operator | Meaning |
| --- | --- |
| `~` | Matches a regular expression, case-sensitive. |
| `~*` | Matches a regular expression, case-insensitive. |
| `!~` | Does not match a regular expression, case-sensitive. |
| `!~*` | Does not match a regular expression, case-insensitive. |

```camussql
SELECT username
FROM users
WHERE username ~ "^[a-zA-Z][a-zA-Z0-9_]{2,29}$";

SELECT name
FROM robots
WHERE name ~* "^r";

SELECT sku
FROM products
WHERE sku !~ "\\s";
```

Regex matching is unanchored by default: a pattern matches if it appears
anywhere in the string. Use `^` and `$` when you want to match the whole value.

Both operands must be strings. If either operand is `NULL`, the result is
unknown and the row is filtered out in `WHERE`.

CamusDB uses the .NET regular-expression engine with culture-invariant
case-insensitive matching. Common constructs such as character classes,
quantifiers, anchors, alternation, and groups are supported. Use `\p{L}` or
`[a-zA-Z]` for letters instead of POSIX named classes such as `[[:alpha:]]`.

Malformed patterns return `CADB0400 InvalidInput`. Each match is bounded by an
internal timeout so pathological patterns fail instead of running indefinitely.

## Subquery Predicates

```camussql
SELECT email
FROM app_users
WHERE id IN (SELECT user_id FROM posts WHERE published = true);

SELECT id
FROM robots
WHERE id NOT IN (SELECT robots_id FROM blocked_robots);
```

## Grouping

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY cnt, role;
```

Non-aggregate projections must appear in `GROUP BY`. `HAVING` filters grouped
or aggregate results after aggregation and can reference aggregate aliases,
aggregate expressions, or grouped keys.

## Ordering And Pagination

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

## Time-Travel Reads

Use `AS OF SYSTEM TIME` to read a consistent historical snapshot:

```camussql
SELECT id, name, year
FROM robots AS OF SYSTEM TIME '-10s'
WHERE year >= 1970
ORDER BY year DESC;
```

The clause belongs after the `FROM` source and before `WHERE`. It is available
for autocommit read-only `SELECT` statements and pins the whole statement,
including joins and subqueries, to one historical timestamp.

See [Time-Travel Reads](/docs/time-travel-reads) for accepted timestamp formats,
guarantees, and restrictions.

## Table Hints

Force a specific index when reading:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

## Advanced Queries

See [Query Features](/docs/query-features) for joins, comma joins, scalar
subqueries, `IN`/`NOT IN` subqueries, `EXISTS`, derived tables, and planner
notes.
