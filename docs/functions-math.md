---
sidebar_position: 4.2
---

# Math Functions

Math functions accept `INT64` and `FLOAT64` numeric arguments. Unless noted
otherwise, they return `NULL` when any argument is `NULL`.

| Function | Returns | Description |
| --- | --- | --- |
| `abs(value)` | `INT64` or `FLOAT64` | Absolute value. Preserves `INT64` input type. |
| `ceil(value)` | `INT64` or `FLOAT64` | Smallest integer value greater than or equal to `value`. Alias: `ceiling`. |
| `floor(value)` | `INT64` or `FLOAT64` | Largest integer value less than or equal to `value`. |
| `round(value)` | `INT64` or `FLOAT64` | Rounds to the nearest integer, with halves rounded away from zero. `INT64` input stays `INT64`. |
| `round(value, scale)` | `FLOAT64` | Rounds to `scale` decimal places. Negative scale rounds left of the decimal point. |
| `sqrt(value)` | `FLOAT64` | Square root. Negative inputs are invalid. |
| `pow(base, exponent)` | `FLOAT64` | `base` raised to `exponent`. Alias: `power`. |
| `mod(dividend, divisor)` | `INT64` or `FLOAT64` | Remainder after division. Returns `INT64` when both inputs are `INT64`; otherwise `FLOAT64`. |
| `sign(value)` | `INT64` | `-1`, `0`, or `1` depending on the sign of `value`. |
| `random()` | `FLOAT64` | Volatile value greater than or equal to `0.0` and less than `1.0`. |

## Examples

```sql
SELECT abs(year - 2000) AS delta
FROM robots
ORDER BY delta;

SELECT round(score, 2) AS rounded_score
FROM robots;

SELECT year
FROM robots
WHERE abs(year - 2002) <= 1
ORDER BY year;

SELECT pow(2, 3), mod(10, 3), sign(-2.5), random();
-- 8.0, 1, -1, a value in [0.0, 1.0)
```

## Error Cases

`abs` fails on the minimum `INT64` value because its positive value cannot be
represented as `INT64`.

`sqrt` fails for negative values. `mod` fails when the divisor is zero. The
second argument to `round(value, scale)` must be an `INT64` that fits in a
32-bit integer range.

