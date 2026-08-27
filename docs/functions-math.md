---
sidebar_position: 4.2
---

# Math functions

A math function accepts a numeric argument of type `INT64` or `FLOAT64`. It
returns `NULL` when one argument is `NULL`, unless the table below states
another behavior.

| Function | Returns | Description |
| --- | --- | --- |
| `abs(value)` | `INT64` or `FLOAT64` | The absolute value. It keeps the type of an `INT64` input. |
| `ceil(value)` | `INT64` or `FLOAT64` | The smallest integer at or above `value`. The alias is `ceiling`. |
| `floor(value)` | `INT64` or `FLOAT64` | The largest integer at or below `value`. |
| `round(value)` | `INT64` or `FLOAT64` | It rounds to the nearest integer. It rounds a half away from zero. An `INT64` input stays an `INT64`. |
| `round(value, scale)` | `FLOAT64` | It rounds to `scale` decimal places. A negative scale rounds to the left of the decimal point. |
| `sqrt(value)` | `FLOAT64` | The square root. A negative input is invalid. |
| `pow(base, exponent)` | `FLOAT64` | `base` raised to `exponent`. The alias is `power`. |
| `mod(dividend, divisor)` | `INT64` or `FLOAT64` | The remainder after the division. It returns an `INT64` when both inputs are `INT64` values. Otherwise it returns a `FLOAT64`. |
| `sign(value)` | `INT64` | `-1`, `0`, or `1`. The sign of `value` decides. |
| `random()` | `FLOAT64` | A volatile value. It is at or above `0.0`, and below `1.0`. |

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
```

## The cases of an error

`abs` fails on the minimum value of an `INT64`. An `INT64` cannot represent the
positive form of that value.

`sqrt` fails for a negative value. `mod` fails when the divisor is zero.

The second argument of `round(value, scale)` must be an `INT64`. It must also
fit in the range of a 32-bit integer.
