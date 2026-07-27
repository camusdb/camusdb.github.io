---
sidebar_position: 4.5
---

# Conversion Functions

Conversion functions cast values between CamusDB scalar types. `NULL` input
returns `NULL`.

You can use either explicit conversion functions or SQL `CAST` syntax:

```camussql
SELECT to_string(year) AS year_text
FROM robots;

SELECT CAST(year AS string) AS year_text
FROM robots;
```

## Functions

| Function | Returns | Description |
| --- | --- | --- |
| `to_string(value)` | `STRING` | Converts `STRING`, `OID`, `UUID`, `INT64`, `FLOAT64`, or `BOOL` to text. UUID values use canonical lowercase hyphenated text. Booleans become `true` or `false`. |
| `to_int64(value)` | `INT64` | Converts `INT64`, `FLOAT64`, `BOOL`, or integer text. Floats are truncated toward zero. Booleans become `1` or `0`. |
| `to_float64(value)` | `FLOAT64` | Converts `FLOAT64`, `INT64`, `BOOL`, or numeric text. Booleans become `1.0` or `0.0`. |
| `to_float32(value)` | `FLOAT32` | Converts numeric values or numeric text to single precision. |
| `to_bool(value)` | `BOOL` | Converts `BOOL` or text equal to `true` or `false`, case-insensitively. |
| `to_date(value)` | `DATE` | Converts a date/datetime value or `yyyy-MM-dd` text to a date. |
| `to_datetime(value)` | `DATETIME` | Converts a date/datetime value or ISO-8601 text to a UTC datetime. |
| `to_bytes(value)` | `BYTES` | Converts bytes or `0x`-prefixed hex text to bytes. |
| `to_id(value)` | `OID` | Converts an `OID` or a 24-character lowercase hex string to an object id. |
| `str_id(value)` | `OID` | Alias for `to_id(value)`. |

## CAST Targets

`CAST(value AS type)` accepts the following targets:

| Target | Result Type |
| --- | --- |
| `string`, `char`, `varchar`, `text` | `STRING` |
| `int`, `int64`, `integer`, `smallint` | `INT64` |
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
SELECT to_int64("42"), to_float64("42.5"), to_bool("TrUe");
-- 42, 42.5, true

SELECT to_date("2026-03-15"), to_datetime("2026-03-15T12:00:00Z");

SELECT CAST("0xDEADBEEF" AS bytes);

SELECT CAST("550e8400-e29b-41d4-a716-446655440000" AS uuid);

SELECT CAST(CAST(7 AS string) AS int64);
-- 7

SELECT name
FROM robots
WHERE CAST(year AS string) = "42";

SELECT id
FROM robots
WHERE id = str_id("507f1f77bcf86cd799439011");
```

## Error Cases

Invalid conversions fail the query. Examples include non-numeric text passed to
numeric conversion functions, non-boolean text passed to `to_bool`, malformed
date/datetime text, malformed UUID text, malformed byte hex text, non-finite
floating-point values, integer overflow, and object id strings that are not 24
lowercase hex characters.

Conversion errors include the offending value and a short hint about the
expected format, such as a valid UUID string, a 64-bit integer, or a number.
