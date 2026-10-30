---
sidebar_position: 4.5
---

# Conversion functions

A conversion function casts a value from one CamusDB scalar type to another. A
`NULL` input returns `NULL`.

You can call a conversion function explicitly, or use standard SQL `CAST`
syntax:

```camussql
SELECT to_string(year) AS year_text
FROM robots;

SELECT CAST(year AS string) AS year_text
FROM robots;
```

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `to_string(value)` | `STRING` | Converts `STRING`, `OID`, `UUID`, `INT64`, `FLOAT64`, `FLOAT32`, `NUMERIC`, `BOOL`, `DATE`, `DATETIME`, or `BYTES` to text. A UUID becomes canonical lowercase text with hyphens. A boolean becomes `true` or `false`. A `DATETIME` becomes ISO-8601 text in UTC, and `BYTES` becomes `\x` followed by lowercase hex. |
| `to_int64(value)` | `INT64` | Converts `INT64`, `FLOAT64`, `NUMERIC`, `BOOL`, or integer text. Floats are truncated toward zero. `NUMERIC` values round half away from zero. A boolean becomes `1` or `0`. |
| `to_float64(value)` | `FLOAT64` | Converts `FLOAT64`, `INT64`, `NUMERIC`, `BOOL`, or numeric text. A boolean becomes `1.0` or `0.0`. |
| `to_float32(value)` | `FLOAT32` | Converts a numeric value or numeric text to single precision. |
| `to_bool(value)` | `BOOL` | Converts a `BOOL`, or the text `true` or `false` in any case. |
| `to_date(value)` | `DATE` | Converts a date or datetime value to a date. Also accepts text in the form `yyyy-MM-dd`. |
| `to_datetime(value)` | `DATETIME` | Converts a date or datetime value to a UTC datetime. Also accepts ISO-8601 text. |
| `to_bytes(value)` | `BYTES` | Converts bytes, or hexadecimal text prefixed with `0x`. You can also write a bytes literal directly as `X'...'`. |
| `to_id(value)` | `OID` | Converts an `OID`, or a 24-character lowercase hexadecimal string, to an object id. |
| `str_id(value)` | `OID` | An alias of `to_id(value)`. |

## CAST targets

`CAST(value AS type)` accepts these targets:

| Target | Result type |
| --- | --- |
| `string`, `char`, `varchar`, `text` | `STRING` |
| `int`, `int64`, `integer`, `smallint` | `INT64` |
| `numeric`, `decimal` | `NUMERIC` |
| `float`, `float64`, `double` | `FLOAT64` |
| `float32`, `real` | `FLOAT32` |
| `bool`, `boolean` | `BOOL` |
| `oid`, `id`, `object_id` | `OID` |
| `uuid`, `guid` | `UUID` |
| `date` | `DATE` |
| `datetime`, `timestamp` | `DATETIME` |
| `bytes`, `blob` | `BYTES` |

## Examples

```camussql
SELECT to_int64('42'), to_float64('42.5'), to_bool('TrUe');
-- 42, 42.5, true

SELECT to_date('2026-03-15'), to_datetime('2026-03-15T12:00:00Z');

SELECT X'DEADBEEF';

SELECT CAST('0xDEADBEEF' AS bytes);

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS uuid);

SELECT CAST('1234567890.123456789' AS numeric);

SELECT CAST(CAST(7 AS string) AS int64);
-- 7

SELECT name
FROM robots
WHERE CAST(year AS string) = '42';

SELECT id
FROM robots
WHERE id = str_id('507f1f77bcf86cd799439011');
```

## Conversion errors

An invalid conversion makes the query fail. Common causes:

- Non-numeric text passed to a function that converts to a number.
- Non-boolean text passed to `to_bool`.
- Malformed date or datetime text.
- Malformed UUID text.
- Malformed hexadecimal byte text.
- A non-finite floating-point value.
- Integer overflow.
- A `NUMERIC` value outside the supported range.
- An object id string that is not 24 lowercase hexadecimal characters.

The error message names the value that caused it and gives a short hint about
the expected format, such as a valid UUID string, a 64-bit integer, or a
number.
