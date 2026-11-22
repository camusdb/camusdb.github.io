---
sidebar_position: 4.2
---

# Math functions

Math functions let you calculate values such as prices and angles in SQL. They
accept `INT64`, `FLOAT64`, and `NUMERIC` arguments. If an argument is `NULL`,
they return `NULL`.

Note that the math functions don't accept `FLOAT32` values. A `FLOAT32` argument
returns `CADB0400`. Cast the value first, for example
`abs(CAST(reading AS FLOAT64))`.

| Function | Returns | Description |
| --- | --- | --- |
| `abs(value)` | Same numeric type | The absolute value. |
| `ceil(value)` | Same numeric type | The smallest integer at or above `value`. Alias: `ceiling`. |
| `floor(value)` | Same numeric type | The largest integer at or below `value`. |
| `round(value)` | Same numeric type | Rounds to the nearest integer. Halves are rounded away from zero. |
| `round(value, scale)` | `FLOAT64` or `NUMERIC` | Rounds to `scale` decimal places. A negative scale rounds to the left of the decimal point. |
| `trunc(value)` | Same numeric type | Truncates toward zero. |
| `trunc(value, scale)` | Same numeric type | Truncates to `scale` decimal places. A negative scale truncates to the left of the decimal point. |
| `sqrt(value)` | `FLOAT64` | The square root. |
| `pow(base, exponent)` | `FLOAT64` | `base` raised to `exponent`. Alias: `power`. |
| `ln(value)` | `FLOAT64` | The natural logarithm. |
| `log10(value)`, `log(value)` | `FLOAT64` | The base-10 logarithm. |
| `log(base, value)` | `FLOAT64` | The logarithm in `base`. The base is first, as in PostgreSQL. |
| `exp(value)` | `FLOAT64` | e raised to `value`. |
| `mod(dividend, divisor)` | `INT64`, `FLOAT64`, or `NUMERIC` | The remainder after division. See the type rules below. |
| `sign(value)` | `INT64` | The sign of `value`: `-1`, `0`, or `1`. |
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
-- 8, 1, -1, a value in [0.0, 1.0)

SELECT round(NUMERIC '1.2345', 2), trunc(NUMERIC '1299.99', -2);
-- 1.23, 1200
```

`log(2, 8)` is 3, and `log(1000)` is 3. If you port SQL from GoogleSQL, note that
its two-argument `LOG` has the opposite argument order. The
[`^` operator](/docs/sql-expression-syntax#power) is another spelling of `pow`.

The return type depends on the input type:

- A `FLOAT64` input returns `FLOAT64`, and a `NUMERIC` input returns `NUMERIC`.
- With an `INT64` input, `round(value, scale)` returns an exact `NUMERIC`, also
  when the scale is zero. For example, `round(15, -1)` is `NUMERIC` 20.
  `round(value)` and `trunc(value, scale)` return `INT64`.
- `mod` returns `INT64` for two `INT64` inputs. A `NUMERIC` input with an `INT64`
  or `NUMERIC` input returns `NUMERIC`. A `FLOAT64` input returns `FLOAT64`.
- Logarithms and `exp` return `FLOAT64`, also for `NUMERIC` arguments.

## Trigonometry and angles

Use these functions for geometry and periodic measurements. They return
`FLOAT64`, also for `INT64` and `NUMERIC` inputs. A `NULL` argument returns
`NULL`.

| Function | Meaning |
| --- | --- |
| `sin(x)`, `cos(x)` | The sine and cosine of an angle in radians. |
| `tan(x)`, `cot(x)` | The tangent and cotangent of an angle in radians. |
| `asin(x)`, `acos(x)`, `atan(x)` | Inverse functions. They return radians. |
| `atan2(y, x)` | The angle of the vector `(x, y)` in radians, in the correct quadrant. |
| `sind(x)`, `cosd(x)`, `tand(x)`, `cotd(x)` | Trigonometric functions with angles in degrees. |
| `asind(x)`, `acosd(x)`, `atand(x)`, `atan2d(y, x)` | Inverse functions. They return degrees. |
| `radians(degrees)`, `degrees(radians)` | Convert between angle units. |
| `pi()` | The value of π as `FLOAT64`. |

```camussql
SELECT sind(30), cosd(90), tand(45), atan2d(1, 1);
-- 0.5, 0, 1, 45

SELECT radians(180), degrees(pi());
-- 3.141592653589793, 180
```

If your data is in degrees, you should use the degree functions. Common angles,
such as `sind(30)`, give exact results. The radian functions use the math
library of the platform. This means that their last digits can be different on
different platforms.

The following rules apply to special values:

- A `NaN` argument returns `NaN`.
- An infinite angle in a trigonometric function, such as `sin`, returns
  `CADB0400`.
- An argument of `asin` or `acos` outside `[-1, 1]` returns `CADB0400`.
- A pole, such as `cot(0)` or `tand(90)`, returns infinity, as in PostgreSQL.
- A conversion that overflows, or that underflows a finite value to zero,
  returns `CADB0421`.

## Errors

The following inputs return an error:

| Input | Error |
| --- | --- |
| `abs` of the minimum `INT64` value. Its positive form doesn't fit in `INT64`. | `CADB0420` |
| `sqrt` of a negative value | `CADB0400` |
| `mod` with a zero divisor | `CADB0400` |
| A logarithm of zero or of a negative value, or a logarithm base of 1 | `CADB0400` |
| `pow(0, negative)` | `CADB0400` |
| `sign(NaN)` | `CADB0400` |
| `exp`, or another float function, with a result that overflows or underflows to zero | `CADB0421` |

`round(value, scale)` and `trunc(value, scale)` don't turn a finite value into
`NaN` or infinity. For a `NUMERIC` value, the scale can be any `INT64`. For a
`FLOAT64` value, the scale must be between -2147483648 and 2147483647. A scale
outside that range returns `CADB0400`.

For more information, see
[Floating-point values](/docs/data-types#floating-point-values).
