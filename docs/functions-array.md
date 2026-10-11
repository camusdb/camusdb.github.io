---
sidebar_position: 4.9
---

# Array functions

Array functions read an `ARRAY(T)` value as a whole. Use them in projections,
filters, defaults, and `CHECK` constraints.

| Function | Returns | Description |
| --- | --- | --- |
| `cardinality(array)` | `INT64` | The number of elements, including `NULL` elements. An empty array returns `0`. |
| `array_length(array, 1)` | `INT64` | The length of the first dimension. An empty array returns `NULL`, as in PostgreSQL. Any dimension other than `1` returns `NULL`. |
| `array_contains(array, value)` | `BOOL` | Whether `value` is an element of the array. |

All three functions return `NULL` for a `NULL` array.

## Length

Use `cardinality` when an empty array must count as `0`:

```camussql
SELECT cardinality(ARRAY['a', 'b', NULL]);
SELECT cardinality(ARRAY[]);
```

Use `array_length(array, 1)` when you want PostgreSQL's dimension behavior. An
empty array has no first dimension, so it returns `NULL`:

```camussql
SELECT array_length(ARRAY['a', 'b'], 1);
SELECT array_length(ARRAY[], 1);
SELECT array_length(ARRAY['a', 'b'], 2);
```

## Membership

`array_contains(array, value)` follows the same three-valued logic as
`value IN (...)`:

- An empty array returns `false`, even when `value` is `NULL`.
- A `NULL` value returns `NULL`.
- No match returns `NULL` when the array holds a `NULL` element, and `false`
  otherwise.
- Numbers compare by value, so `array_contains(ARRAY[1, 2], 2.0)` is `true`.
  A value of another type is a non-match, not an error.

```camussql
SELECT array_contains(ARRAY['paid', 'shipped'], 'paid');
SELECT array_contains(ARRAY['paid', NULL], 'cancelled');
```

You can write the same membership test as `value = ANY(array)`. CamusDB also
supports `value = SOME(array)`, `value <> ALL(array)`, and ordered quantified
comparisons such as `value > ALL(array)`. See
[PostgreSQL Expression Syntax](/docs/sql-expression-syntax#quantified-comparisons).

CamusDB does not support `@>` or `<@` yet.

## Check constraints

Array functions are deterministic, so you can use them in a `CHECK` constraint:

```camussql
CREATE TABLE posts (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  tags ARRAY(STRING)
    CHECK (cardinality(tags) <= 3 AND NOT array_contains(tags, 'banned'))
);
```

A `CHECK` constraint rejects only `false`. It accepts `NULL`, so the example
accepts a `NULL` array. It also accepts an array that holds a `NULL` element and
no `'banned'`, because `NOT array_contains(...)` is then unknown, not false.
