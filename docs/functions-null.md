---
sidebar_position: 4.55
---

# Null functions

A null function picks a fallback when an expression evaluates to `NULL`, or
turns a value into `NULL`. Use them for display defaults, aggregate defaults,
nullable columns inside derived expressions, and guards against division by
zero.

Most scalar functions return `NULL` when any argument is `NULL`. These functions
do not.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `coalesce(value, ...)` | The type of the first compatible argument that is not null | Returns the first non-`NULL` argument. Accepts one or more arguments. Returns `NULL` when every argument is `NULL`. |
| `ifnull(value, fallback)` | The type of the first compatible argument that is not null | Two-argument shorthand for `coalesce(value, fallback)`. |
| `nvl(value, fallback)` | The type of the first compatible argument that is not null | Alias for `ifnull(value, fallback)`. |
| `nullif(value, other)` | The type of `value` | Returns `NULL` when `value = other` is true, otherwise `value`. |

`IFNULL` is the currently supported name for the two-argument form.
`IFNULL(value, fallback)` means: if `value` is null, use `fallback`.

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

These rules apply to `coalesce`, `ifnull`, and `nvl`. CamusDB infers the result
type from the non-null arguments' types:

- The result type is `NULL` when every argument is `NULL`.
- CamusDB widens numeric arguments where necessary. `FLOAT64` beats `FLOAT32`,
  and `FLOAT32` beats `INT64`. `NUMERIC` with `INT64` stays `NUMERIC`;
  `NUMERIC` with a float widens to `FLOAT64`.
- CamusDB rejects mixing `STRING` with a non-string type.
- Compatible non-numeric arguments keep the first non-null type.

For example, `coalesce(score, 3.5)` returns `FLOAT64`. A non-null `INT64`
`score` widens to `FLOAT64`, so the runtime value matches the inferred result
type.

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
