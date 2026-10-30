---
sidebar_position: 4.2
---

# Math functions

Math functions accept `INT64`, `FLOAT64`, or `NUMERIC` arguments. They return
`NULL` when any argument is `NULL`, unless the table below says otherwise.

| Function | Returns | Description |
| --- | --- | --- |
| `abs(value)` | Same numeric type | The absolute value. |
| `ceil(value)` | Same numeric type | The smallest integer at or above `value`. Alias: `ceiling`. |
| `floor(value)` | Same numeric type | The largest integer at or below `value`. |
| `round(value)` | Same numeric type | Rounds to the nearest integer, with halves rounded away from zero. |
| `round(value, scale)` | `FLOAT64` or `NUMERIC` | Rounds to `scale` decimal places. A negative scale rounds to the left of the decimal point. |
| `trunc(value)` | Same numeric type | Truncates toward zero. |
| `trunc(value, scale)` | `FLOAT64` or `NUMERIC` | Truncates to `scale` decimal places. A negative scale truncates to the left of the decimal point. |
| `sqrt(value)` | `FLOAT64` | The square root. A negative input is invalid. |
| `pow(base, exponent)` | `FLOAT64` | `base` raised to `exponent`. Alias: `power`. |
| `mod(dividend, divisor)` | `INT64`, `FLOAT64`, or `NUMERIC` | The remainder after division. Two `INT64` inputs return `INT64`; `NUMERIC` with `INT64` or `NUMERIC` returns `NUMERIC`; a float input returns `FLOAT64`. |
| `sign(value)` | `INT64` | `-1`, `0`, or `1`, depending on the sign of `value`. |
| `random()` | `FLOAT64` | A volatile value at or above `0.0` and below `1.0`. |

## Examples

```camussql
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

SELECT round(NUMERIC '1.2345', 2), trunc(NUMERIC '1299.99', -2);
-- 1.23, 1200
```

## Errors

`abs` fails on the minimum `INT64` value, because an `INT64` cannot represent
its positive form.

`sqrt` fails for negative values. `mod` fails when the divisor is zero.

The second argument of `round(value, scale)` must be an `INT64` that fits in a
32-bit integer.
