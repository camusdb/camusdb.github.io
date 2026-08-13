---
sidebar_position: 2.4
---

# SELECT

`SELECT` reads rows from a table and shapes them: choose columns, filter, group,
sort, paginate.

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC
LIMIT 25;
```

This page covers reading from a single table. For joins, subqueries, and derived
tables, see [Joins And Subqueries](/docs/joins-and-subqueries). For a `SELECT`
with no table at all, such as `SELECT 1 + 1`, see
[SELECT Without FROM](/docs/sql-fromless-select).

## Clause Order

Clauses must be written in this order, and they are evaluated in roughly the
same order:

```camussql
SELECT   [DISTINCT] projections
FROM     source [AS OF SYSTEM TIME ...] [@{hint}]
WHERE    row_filter
GROUP BY keys
HAVING   group_filter
ORDER BY sort_keys
LIMIT    n OFFSET m
```

The practical consequence: `WHERE` filters input rows before grouping, `HAVING`
filters the grouped rows after. `ORDER BY`, `LIMIT`, and `OFFSET` apply last, to
the projected result, so they can reference output aliases.

## Choosing Columns

```camussql
SELECT * FROM robots;
SELECT id, name FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT upper(trim(name)) AS display_name FROM robots;
```

Any scalar expression can be projected, including function calls and arithmetic.
`AS` names the output column; without it, an expression's output name is derived
from the expression itself. See [Functions](/docs/functions) for the available
scalar functions.

### DISTINCT

`DISTINCT` removes duplicate output rows after projection. Two `NULL` values
count as the same value.

```camussql
SELECT DISTINCT kind FROM robots ORDER BY kind;
SELECT DISTINCT kind, year FROM robots ORDER BY kind, year;
```

Three shapes are not supported today:

| Not supported | Reason |
| --- | --- |
| `COUNT(DISTINCT column)` | Distinct aggregation is not implemented. |
| `SELECT DISTINCT ... GROUP BY ...` | Grouping already produces distinct keys. |
| `SELECT DISTINCT COUNT(*)` | `DISTINCT` cannot wrap an aggregate projection. |

When the distinct columns are covered by a compatible `NOT NULL` index, the
planner streams the distinct values off the index instead of building a hash
table. [`EXPLAIN`](/docs/explain) shows which path was used.

### CASE Expressions

`CASE` picks a value conditionally. The searched form evaluates predicates in
order:

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

The simple form compares one expression against each `WHEN` value:

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

First match wins. A `WHEN` condition that evaluates to `NULL` does not match. If
nothing matches and there is no `ELSE`, the result is `NULL`.

`CASE` is a scalar expression, so it works anywhere one is accepted — including
inside aggregates, which is the usual way to write a conditional total:

```camussql
SELECT SUM(CASE WHEN status = "paid" THEN amount ELSE 0 END) AS paid_total
FROM orders;
```

`CASE` and `END` are reserved keywords. A column named `end` needs backticks:
``SELECT `end` FROM events``.

## Filtering

```camussql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE enabled OR year IS NULL;

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004;
```

| Category | Operators |
| --- | --- |
| Comparison | `=`, `!=`, `<`, `>`, `<=`, `>=`, `BETWEEN ... AND ...` |
| Boolean | `AND`, `OR`, and bare boolean columns such as `WHERE enabled` |
| Pattern matching | `LIKE`, `ILIKE`, `~`, `~*`, `!~`, `!~*` |
| Null checks | `IS NULL`, `IS NOT NULL` |
| Membership | `IN (...)`, `NOT IN (...)`, `IN (SELECT ...)`, `NOT IN (SELECT ...)` |
| Existence | `EXISTS (SELECT ...)` |

`BETWEEN` is inclusive on both ends: `year BETWEEN 2001 AND 2004` matches 2001
through 2004.

### Pattern Matching

`LIKE` and `ILIKE` use `%` and `_` wildcards; `ILIKE` is the case-insensitive
form. When wildcards are not expressive enough, use the regex operators:

| Operator | Matches | Case |
| --- | --- | --- |
| `~` | Regular expression | Sensitive |
| `~*` | Regular expression | Insensitive |
| `!~` | Negated regular expression | Sensitive |
| `!~*` | Negated regular expression | Insensitive |

```camussql
SELECT username
FROM users
WHERE username ~ "^[a-zA-Z][a-zA-Z0-9_]{2,29}$";

SELECT sku
FROM products
WHERE sku !~ "\\s";
```

Patterns are unanchored — they match anywhere in the value unless you write `^`
and `$`. Both operands must be strings; if either is `NULL` the result is
unknown, and the row does not survive a `WHERE`.

The engine is .NET's regular-expression engine with culture-invariant
case-insensitive matching. Character classes, quantifiers, anchors, alternation,
and groups all work. Use `\p{L}` or `[a-zA-Z]` rather than POSIX classes like
`[[:alpha:]]`. A malformed pattern raises `CADB0400 InvalidInput`, and every
match runs under an internal timeout so a pathological pattern fails instead of
hanging.

For extracting or replacing with regular expressions rather than filtering, see
[Regex Functions](/docs/functions-regex).

### IN Value Lists

```camussql
SELECT id, name FROM robots WHERE year IN (2020, 2022, 2024);
SELECT id, name FROM robots WHERE status NOT IN ("deleted", "archived");
SELECT id, name FROM robots WHERE id IN (@id1, @id2, @id3);
```

On an indexed column, the planner turns a value list into repeated index probes
instead of a scan, which pays off for small and moderate lists.

`NOT IN` follows SQL null semantics. If the list contains `NULL`, every
non-matching comparison becomes unknown and the row is filtered out — so
`NOT IN` against a nullable set often returns fewer rows than expected.

`IN` also accepts a subquery; see
[Joins And Subqueries](/docs/joins-and-subqueries).

## Aggregating

| Function | Behavior |
| --- | --- |
| `COUNT(*)` | Counts all rows. |
| `COUNT(column)` | Counts non-null values. |
| `SUM(column)` | Sums numeric values, ignoring nulls. |
| `AVG(column)` | Returns a `FLOAT64` average, ignoring nulls. |
| `MIN(column)` | Smallest non-null value. |
| `MAX(column)` | Largest non-null value. |

Without `GROUP BY`, aggregates collapse the whole table to one row:

```camussql
SELECT COUNT(*), SUM(year), AVG(year), MIN(year), MAX(year)
FROM robots;
```

### GROUP BY

`GROUP BY` accepts columns or expressions:

```camussql
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

Standard projection rules apply: every non-aggregate projection must appear in
`GROUP BY`. `SELECT name, COUNT(*) FROM robots` is an error until you add
`GROUP BY name`.

### HAVING

`HAVING` filters after aggregation and can reference aggregate aliases,
aggregate expressions, or grouped keys:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY role;

SELECT COUNT(*) AS total
FROM robots
HAVING total > 0;
```

`HAVING` requires either a `GROUP BY` or an aggregate projection. To filter
input rows rather than groups, use `WHERE` — it runs first and gives the
aggregate less work to do.

## Sorting And Pagination

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

`ASC` is the default. `LIMIT` and `OFFSET` accept literal integers or
placeholders such as `LIMIT @limit`.

In a grouped query, `ORDER BY` can reference selected aggregate aliases,
aggregate expressions, or grouped expressions:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY cnt DESC, role;
```

When an index already supplies the requested order, the planner skips the sort
entirely. `ORDER BY` with `LIMIT` on an indexed column is therefore much cheaper
than sorting the full table — see [Query Planning](/docs/query-planning).

## Reading A Past Snapshot

`AS OF SYSTEM TIME` reads a consistent historical snapshot. It goes after the
`FROM` source and before `WHERE`:

```camussql
SELECT id, name, year
FROM robots AS OF SYSTEM TIME '-10s'
WHERE year >= 1970
ORDER BY year DESC;
```

It applies to autocommit read-only statements and pins the entire statement,
joins and subqueries included, to one timestamp. See
[Time-Travel Reads](/docs/time-travel-reads) for accepted formats and retention
limits.

## Forcing An Index

When you know which index suits a predicate better than the planner's estimate
does, name it:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Confirm the effect with [`EXPLAIN`](/docs/explain) before leaving a hint in
production code — a hint that outlives the data distribution it was tuned for
does more harm than good.

## Parameters

Placeholders can stand in for values in filters and pagination:

```camussql
SELECT id, name
FROM robots
WHERE id = @id
LIMIT @limit;
```

Values are bound by whichever client submits the statement. See
[Parameters And Prepared Statements](/docs/prepared-statements).
