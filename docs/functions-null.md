---
sidebar_position: 4.55
---

# Null functions

A null function selects a fallback value when an expression evaluates to `NULL`.
These functions are useful for three purposes: a default value in a display, a
default for an aggregate, and a nullable column inside a derived expression.

Most scalar functions return `NULL` when one argument is `NULL`. These functions
do not.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `coalesce(value, ...)` | The type of the first compatible argument that is not null | It returns the first argument that is not `NULL`. It accepts one argument or more. It returns `NULL` when every argument is `NULL`. |
| `ifnull(value, fallback)` | The type of the first compatible argument that is not null | A short form of `coalesce(value, fallback)`, with two arguments. |
| `nvl(value, fallback)` | The type of the first compatible argument that is not null | An alias of `ifnull(value, fallback)`. |

`IFNULL` is the supported name of the function with two arguments, in the
current source of CamusDB. Use `IFNULL(value, fallback)` for this rule: if this
value is null, use that fallback.

## The rules of the type

CamusDB infers the type of the result from the types of the arguments that are
not null:

- The type of the result is `NULL` when every argument is `NULL`.
- CamusDB widens a numeric argument where that is necessary. `FLOAT64` beats
  `FLOAT32`, and `FLOAT32` beats `INT64`.
- CamusDB rejects a mix of a `STRING` with a type that is not a string.
- Compatible arguments that are not numeric keep the first type that is not
  null.

For example, `coalesce(score, 3.5)` returns a `FLOAT64`. An `INT64` value of
`score` that is not null widens to a `FLOAT64`. The value at runtime therefore
matches the inferred type of the result.

## Examples

Return a label as a fallback when `tag` is `NULL`:

```camussql
SELECT name, COALESCE(tag, "untagged") AS tag
FROM items;
```

Use the short form, with two arguments:

```camussql
SELECT name, IFNULL(tag, "untagged") AS tag
FROM items;
```

Use `COALESCE` with more than two choices:

```camussql
SELECT COALESCE(preferred_name, display_name, username, "anonymous") AS label
FROM users;
```

Give a default to an aggregate. Without that default, an empty input returns a
`NULL`:

```camussql
SELECT COALESCE(SUM(amount), 0) AS total
FROM sales
WHERE category = "missing";
```

Handle a null inside a `HAVING` clause:

```camussql
SELECT category, COALESCE(SUM(amount), 0) AS total
FROM sales
GROUP BY category
HAVING COALESCE(SUM(amount), 0) > 10;
```

## The cases of an error

An incompatible type of an argument makes the query fail. Here is an example:

```camussql
SELECT COALESCE(score, "fallback")
FROM items;
```

`score` can be an `INT64`. The expression then mixes a numeric value with a
string. CamusDB returns `InvalidInput`.
