---
sidebar_position: 4.2
---

# Math functions

Math functions let you calculate prices, statistics, and angles directly in SQL.
They accept `INT64`, `FLOAT32`, `FLOAT64`, or `NUMERIC` arguments. They return
`NULL` when any argument is `NULL`, unless the table below says otherwise.

| Function | Returns | Description |
| --- | --- | --- |
| `abs(value)` | Same numeric type | The absolute value. |
| `ceil(value)` | Same numeric type | The smallest integer at or above `value`. Alias: `ceiling`. |
| `floor(value)` | Same numeric type | The largest integer at or below `value`. |
| `round(value)` | Same numeric type | Rounds to the nearest integer, with halves rounded away from zero. |
| `round(value, scale)` | `FLOAT64` or `NUMERIC` | Rounds to `scale` decimal places. A negative scale rounds to the left of the decimal point. |
| `trunc(value)` | Same numeric type | Truncates toward zero. |
| `trunc(value, scale)` | `INT64`, `FLOAT64`, or `NUMERIC` | Truncates to `scale` decimal places. A negative scale truncates to the left of the decimal point. |
| `sqrt(value)` | `FLOAT64` | The square root. A negative input is invalid. |
| `pow(base, exponent)` | `FLOAT64` | `base` raised to `exponent`. Alias: `power`. |
| `ln(value)` | `FLOAT64` | Natural logarithm. |
| `log10(value)`, `log(value)` | `FLOAT64` | Base-10 logarithm. |
| `log(base, value)` | `FLOAT64` | Logarithm with the base first, following PostgreSQL. |
| `exp(value)` | `FLOAT64` | e raised to `value`. |
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

`log(2, 8)` is 3 and `log(1000)` is 3. The argument order differs from
GoogleSQL's two-argument LOG. Logarithms and EXP return FLOAT64 even for
NUMERIC arguments. The [`^` operator](/docs/sql-expression-syntax#power) is
another spelling of POW.

With an INT64 input, `round(value, scale)` returns exact NUMERIC even when
scale is zero: `round(15, -1)` is NUMERIC 20. `round(value)` stays INT64, as
does `trunc(value, scale)` for integer input. Float inputs return FLOAT64;
NUMERIC inputs stay NUMERIC.

## Trigonometry and angles

Use these functions for geometry, bearings, or periodic measurements. All return
`FLOAT64`, including for integer and `NUMERIC` inputs; `FLOAT32` inputs also work.
A `NULL` argument returns `NULL`.

| Function | Meaning |
| --- | --- |
| `sin(x)`, `cos(x)`, `tan(x)`, `cot(x)` | Sine, cosine, tangent, and cotangent of an angle in radians. |
| `asin(x)`, `acos(x)`, `atan(x)` | Inverse functions, returning radians. |
| `atan2(y, x)` | Angle of the vector `(x, y)`, in radians, preserving its quadrant. |
| `sind(x)`, `cosd(x)`, `tand(x)`, `cotd(x)` | Trigonometric functions with degree inputs. |
| `asind(x)`, `acosd(x)`, `atand(x)`, `atan2d(y, x)` | Inverse functions returning degrees. |
| `radians(degrees)`, `degrees(radians)` | Convert between angle units. |
| `pi()` | The value of π as `FLOAT64`. |

```camussql
SELECT sind(30), cosd(90), tand(45), atan2d(1, 1);
-- 0.5, 0, 1, 45

SELECT radians(180), degrees(pi());
-- approximately 3.141592653589793, 180
```

Prefer the degree forms when your data uses degrees: common angles such as
`sind(30)`, `cosd(90)`, and `tand(45)` produce exact results. Radian functions
use the platform math library, so their last digits can vary across platforms.

NaN propagates. Infinite angles passed to sine, cosine, tangent, or cotangent
raise `CADB0400`, as do inverse sine/cosine arguments outside `[-1, 1]`.
Poles such as `cot(0)`, `tand(90)`, and `cotd(0)` return infinity, following
PostgreSQL. Conversions that overflow or underflow a finite value raise
`CADB0421`.

## Errors

`abs` fails on the minimum `INT64` value, because an `INT64` cannot represent
its positive form. It reports `CADB0420`.

`sqrt` fails for negative values. `mod` fails when the divisor is zero.
Logarithms reject zero and negative arguments; a logarithm base of 1 is also
invalid. EXP overflow and underflow to zero fail with CADB0421.

`round(value, scale)` and `trunc(value, scale)` accept an `INT64` scale,
including very large magnitudes. They do not turn a finite value into NaN or
infinity. Finite float overflow and underflow to zero report `CADB0421`;
`pow(0, negative)`, `sqrt(negative)`, and `sign(NaN)` report `CADB0400`.
See [Floating-point values](/docs/data-types#floating-point-values).
