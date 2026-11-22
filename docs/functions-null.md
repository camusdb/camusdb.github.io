---
sidebar_position: 4.55
---

# Null functions

A `NULL` in a result often needs a default, such as a label for a missing tag or
`0` for an empty sum. The null functions return a fallback value when an
expression is `NULL`, or turn a value into `NULL`. `IF` returns one of two
values for a boolean condition.

Most scalar functions return `NULL` when an argument is `NULL`. These functions
don't.

## The functions

| Function | Returns | Result |
| --- | --- | --- |
| `coalesce(value, ...)` | The common type of the arguments | The first argument that isn't `NULL`. Takes one or more arguments. If all the arguments are `NULL`, the result is `NULL`. |
| `ifnull(value, fallback)` | The common type of the arguments | `fallback` if `value` is `NULL`, else `value`. The two-argument form of `coalesce`. |
| `nvl(value, fallback)` | The common type of the arguments | An alias for `ifnull`. |
| `nullif(value, other)` | The type of `value` | `NULL` if `value = other` is true, else `value`. |
| `if(condition, a, b)` | The common type of `a` and `b` | `a` if `condition` is true, else `b`. See [IF](#if). |
| `greatest(value, ...)`, `least(value, ...)` | The common type of the arguments | The largest or smallest argument that isn't `NULL`. See [GREATEST and LEAST](#greatest-and-least). |

For the common type, see [Type rules](#type-rules).

## Examples

Return a label when `tag` is `NULL`:

```camussql
SELECT name, COALESCE(tag, 'untagged') AS tag
FROM items;
```

Use more than two choices:

```camussql
SELECT COALESCE(preferred_name, display_name, username, 'anonymous') AS label
FROM users;
```

Give an aggregate a default. A `SUM` over no rows returns `NULL`:

```camussql
SELECT COALESCE(SUM(amount), 0) AS total
FROM sales
WHERE category = 'missing';
```

Prevent division by zero. A row where `cnt` is `0` returns `NULL`, and the
query doesn't fail:

```camussql
SELECT id, total / NULLIF(cnt, 0) AS ratio
FROM counts;
```

Turn an empty string into `NULL`, then apply a fallback:

```camussql
SELECT COALESCE(NULLIF(tag, ''), 'untagged') AS tag
FROM items;
```

## IF

Use `IF(condition, true_result, else_result)` for a conditional value:

```camussql
SELECT IF(quantity > 0, 'in stock', 'sold out') AS availability
FROM inventory;
SELECT IF(true, 1, 1 / 0); -- returns 1; the unused result is not evaluated
```

A true condition returns the second argument. A false or `NULL` condition
returns the third. The condition must be `BOOL`: `IF(1, 2, 3)` returns
`CADB0400`. The two results need a common type, as the branches of a `CASE`
expression do.

## NULLIF

`nullif(value, other)` is the opposite of `ifnull`. It is the same as
`CASE WHEN value = other THEN NULL ELSE value END`.

- The comparison uses the rules of `=`. For example, `nullif(2, 2.0)` and
  `nullif(NUMERIC '2', 2)` return `NULL`.
- If `value` is `NULL`, the result is `NULL`.
- If `other` is `NULL`, the comparison is unknown. The result is `value`.
- The result has the type of `value`. For example, `nullif(1, 2.5)` returns
  the `INT64` value `1`.
- Both arguments are evaluated.

## GREATEST and LEAST

Use `GREATEST` for a lower bound, or `LEAST` for an upper bound:

```camussql
SELECT GREATEST(0, stock - @sold) AS remaining FROM inventory;
SELECT LEAST(total, @discount_cap) AS capped_discount FROM orders;
SELECT GREATEST(NULL, 2, 1); -- 2
```

`NULL` arguments are ignored. The result is `NULL` if all the arguments are
`NULL`. This is the PostgreSQL behavior. In MySQL, one `NULL` argument makes
the result `NULL`.

The arguments have a common type: `GREATEST(3, 2.5)` returns the `FLOAT64`
value `3.0`. All the arguments are evaluated. Values are compared in SQL sort
order. This means that `NaN` is above infinity, and that string comparison is
case-sensitive: `GREATEST('a', 'B')` returns `'a'`. To compare values across
rows, use `MAX` or `MIN`.

## Type rules

These functions and `CASE` use the same
[conditional result rules](/docs/data-types#conditional-result-types). The
result type comes from the types of all the arguments, also the arguments that
a row doesn't use. Numeric types widen. Types that can't combine return
`CADB0400` before rows are read.

For example:

- `COALESCE(score, 3.5)` returns `FLOAT64` when `score` is `INT64`. A score
  that isn't `NULL` is converted too.
- `COALESCE(1, 'fallback')` returns `CADB0400`. A string doesn't become a
  number.
- `COALESCE(d, DATE '2026-01-01')` returns `DATE`. To combine a date column with
  a `STRING` column, cast the string: `COALESCE(d, CAST(s AS DATE))`.

The error message names the two types:

```text
CamusException (CADB0400): No common type for the results of COALESCE: Integer64 and String; write a CAST to make the types agree
```

## Evaluation order

`COALESCE` and its two-argument forms evaluate the arguments from left to
right. They stop at the first value that isn't `NULL`:

```camussql
SELECT COALESCE(1, 1 / 0); -- 1; the division isn't evaluated
SELECT COALESCE(NULL, 2);  -- 2
```

A type error isn't skipped. `COALESCE(1, upper('a'))` returns `CADB0400`:
`upper` returns `STRING`, and `STRING` and `INT64` don't have a common type. A
built-in call with known argument types gives its result type, also when it
isn't evaluated. For example, `COALESCE(1, sqrt(4.0))` returns `FLOAT64`.

Some values are computed before the row expression. An unused argument can't
prevent their errors:

- An uncorrelated subquery. For example,
  `COALESCE(1, (SELECT id FROM orders))` returns `CADB0400` if the subquery
  returns more than one row.
- An aggregate, such as `SUM(1 / cnt)`.
- A window function.

This also applies to `IF`. A correlated subquery is evaluated for each row,
and an unused argument skips it.
