---
sidebar_position: 4.55
---

# Null Functions

Null functions choose fallback values when an expression evaluates to `NULL`.
They are useful for default display values, aggregate defaults, and nullable
columns in derived expressions.

Unlike most scalar functions, these functions do not automatically return
`NULL` when one argument is `NULL`.

## Functions

| Function | Returns | Description |
| --- | --- | --- |
| `coalesce(value, ...)` | First compatible non-null argument type | Returns the first argument that is not `NULL`. Accepts one or more arguments. Returns `NULL` when every argument is `NULL`. |
| `ifnull(value, fallback)` | First compatible non-null argument type | Two-argument shorthand for `coalesce(value, fallback)`. |
| `nvl(value, fallback)` | First compatible non-null argument type | Alias for `ifnull(value, fallback)`. |

`IFNULL` is the supported two-argument function name in the current CamusDB
source. Use `IFNULL(value, fallback)` when you want "if this value is null, use
that fallback."

## Type Rules

CamusDB infers the result type from the non-null argument types:

- If every argument is `NULL`, the result type is `NULL`.
- Numeric arguments are widened when needed: `FLOAT64` beats `FLOAT32`, which
  beats `INT64`.
- Mixing `STRING` with another non-string type is rejected.
- Compatible non-numeric arguments keep the first non-null type.

For example, `coalesce(score, 3.5)` returns `FLOAT64`; a non-null `INT64`
`score` value is widened to `FLOAT64` so the runtime value matches the inferred
result type.

## Examples

Return a fallback label when `tag` is `NULL`:

```camussql
SELECT name, COALESCE(tag, "untagged") AS tag
FROM items;
```

Use the two-argument shorthand:

```camussql
SELECT name, IFNULL(tag, "untagged") AS tag
FROM items;
```

Use `COALESCE` with more than two choices:

```camussql
SELECT COALESCE(preferred_name, display_name, username, "anonymous") AS label
FROM users;
```

Default an aggregate that would otherwise return `NULL` for an empty input:

```camussql
SELECT COALESCE(SUM(amount), 0) AS total
FROM sales
WHERE category = "missing";
```

Use null handling in `HAVING`:

```camussql
SELECT category, COALESCE(SUM(amount), 0) AS total
FROM sales
GROUP BY category
HAVING COALESCE(SUM(amount), 0) > 10;
```

## Error Cases

Incompatible argument types fail the query. For example:

```camussql
SELECT COALESCE(score, "fallback")
FROM items;
```

If `score` is `INT64`, this mixes numeric and string values and returns
`InvalidInput`.
