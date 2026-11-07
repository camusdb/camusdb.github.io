---
sidebar_position: 4.55
---

# Null functions

A null function picks a fallback when an expression evaluates to `NULL`, or
turns a value into `NULL`. Use them for display defaults, aggregate defaults,
nullable columns inside derived expressions, and guards against division by
zero. `IF` chooses between two results using a boolean condition.

Most scalar functions return `NULL` when any argument is `NULL`. These functions
do not.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `coalesce(value, ...)` | The common argument type | Returns the first non-`NULL` argument. Accepts one or more arguments. Returns `NULL` when every argument is `NULL`. |
| `ifnull(value, fallback)` | The common argument type | Two-argument shorthand for `coalesce(value, fallback)`. |
| `nvl(value, fallback)` | The common argument type | Alias for `ifnull(value, fallback)`. |
| `nullif(value, other)` | The type of `value` | Returns `NULL` when `value = other` is true, otherwise `value`. |

`IFNULL(value, fallback)` means: if `value` is null, use `fallback`.

## IF

Use `IF(condition, true_result, else_result)` for a conditional value:

```camussql
SELECT IF(quantity > 0, 'in stock', 'sold out') AS availability
FROM inventory;
SELECT IF(true, 1, 1 / 0); -- returns 1; the unused result is not evaluated
```

A true condition selects the second argument; false or NULL selects the third.
The condition must be boolean. Both results must have a common type, just as
in `CASE WHEN ... THEN ... ELSE ... END`.

## NULLIF

`nullif(value, other)` is the inverse of `ifnull`. It is equivalent to
`CASE WHEN value = other THEN NULL ELSE value END`, except that CamusDB
evaluates `value` only once.

- The comparison follows the `=` operator's rules. For example,
  `nullif(2, 2.0)` and `nullif(NUMERIC '2', 2)` return `NULL`.
- When `value` is `NULL`, the result is `NULL`.
- When `other` is `NULL`, the comparison is unknown, not true, so the result
  is `value`.
- The result has the type of `value`. CamusDB does not widen it.
- The function takes exactly two arguments.

## Type rules

`COALESCE`, `IFNULL`, `NVL`, `IF`, and `CASE` use the same
[conditional result rules](/docs/data-types#conditional-result-types). The
result type comes from all inputs, rather than the first non-null value.
Numeric inputs widen where needed, and incompatible types fail with
`CADB0400`, even when a branch is unused.

For example, `COALESCE(score, 3.5)` returns `FLOAT64` when `score` is `INT64`;
a non-null score is converted too. `COALESCE(1, 'fallback')` fails.
`COALESCE(date_column, '2026-01-01')` returns `DATE`, but a string column
needs an explicit cast to combine with a date.

## Evaluation order

COALESCE, IFNULL, and NVL evaluate arguments from left to right and stop at
the first non-NULL value. NULLIF still evaluates both arguments.

```camussql
SELECT COALESCE(1, 1 / 0); -- 1; the fallback does not run
SELECT COALESCE(NULL, 2);  -- 2
```

Short-circuiting does not skip known type errors: `COALESCE(1, upper('a'))`
fails because STRING and INT64 have no common type. Built-in calls with known
argument types also determine the common result: `COALESCE(1, sqrt(4.0))`
returns FLOAT64.

Subqueries, aggregates, and window results can be computed before the row
expression, so an unused fallback does not guard errors in them. For example,
`COALESCE(1, (SELECT id FROM orders))` can still fail if the subquery returns
multiple rows. Guard their inputs or restructure the query instead.

## Examples

Return a fallback label when `tag` is `NULL`:

```camussql
SELECT name, COALESCE(tag, 'untagged') AS tag
FROM items;
```

Use the two-argument short form:

```camussql
SELECT name, IFNULL(tag, 'untagged') AS tag
FROM items;
```

Use `COALESCE` with more than two choices:

```camussql
SELECT COALESCE(preferred_name, display_name, username, 'anonymous') AS label
FROM users;
```

Give an aggregate a default. Without it, an empty input returns `NULL`:

```camussql
SELECT COALESCE(SUM(amount), 0) AS total
FROM sales
WHERE category = 'missing';
```

Prevent division by zero. A row where `cnt` is `0` returns `NULL` instead of
failing the query:

```camussql
SELECT id, total / NULLIF(cnt, 0) AS ratio
FROM counts;
```

Turn an empty string into `NULL`, then apply a fallback:

```camussql
SELECT COALESCE(NULLIF(tag, ''), 'untagged') AS tag
FROM items;
```

Handle nulls in a `HAVING` clause:

```camussql
SELECT category, COALESCE(SUM(amount), 0) AS total
FROM sales
GROUP BY category
HAVING COALESCE(SUM(amount), 0) > 10;
```

## Errors

Incompatible argument types make the query fail. For example:

```camussql
SELECT COALESCE(score, 'fallback')
FROM items;
```

If `score` is an `INT64`, the expression mixes a numeric value with a string,
and CamusDB returns `InvalidInput`.
