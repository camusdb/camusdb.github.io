---
sidebar_position: 4.5
---

# Conversion functions

A conversion function casts a value between two scalar types of CamusDB. A
`NULL` input returns a `NULL`.

You can use an explicit function of a conversion. You can also use the `CAST`
syntax of SQL:

```camussql
SELECT to_string(year) AS year_text
FROM robots;

SELECT CAST(year AS string) AS year_text
FROM robots;
```

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `to_string(value)` | `STRING` | It converts a `STRING`, an `OID`, a `UUID`, an `INT64`, a `FLOAT64`, or a `BOOL` to text. A UUID becomes canonical text: lowercase, and with hyphens. A boolean becomes `true` or `false`. |
| `to_int64(value)` | `INT64` | It converts an `INT64`, a `FLOAT64`, a `BOOL`, or the text of an integer. It truncates a float toward zero. A boolean becomes `1` or `0`. |
| `to_float64(value)` | `FLOAT64` | It converts a `FLOAT64`, an `INT64`, a `BOOL`, or numeric text. A boolean becomes `1.0` or `0.0`. |
| `to_float32(value)` | `FLOAT32` | It converts a numeric value, or numeric text, to single precision. |
| `to_bool(value)` | `BOOL` | It converts a `BOOL`. It also converts text equal to `true` or `false`, without regard to the case. |
| `to_date(value)` | `DATE` | It converts a value of a date or a datetime to a date. It also converts text in the form `yyyy-MM-dd`. |
| `to_datetime(value)` | `DATETIME` | It converts a value of a date or a datetime to a datetime in UTC. It also converts text in the ISO-8601 form. |
| `to_bytes(value)` | `BYTES` | It converts bytes. It also converts hexadecimal text with the prefix `0x`. You can write a literal of bytes directly, as `X'...'`. |
| `to_id(value)` | `OID` | It converts an `OID` to an object id. It also converts a hexadecimal string of 24 lowercase characters. |
| `str_id(value)` | `OID` | An alias of `to_id(value)`. |

## The targets of a CAST

`CAST(value AS type)` accepts these targets:

| Target | Type of the result |
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

SELECT X'DEADBEEF';

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

## The cases of an error

An invalid conversion makes the query fail. These examples are common:

- Text that is not numeric, in a function that converts to a number.
- Text that is not a boolean, in `to_bool`.
- Text of a date or a datetime with a wrong form.
- Text of a UUID with a wrong form.
- Hexadecimal text of a byte value with a wrong form.
- A value in floating point that is not finite.
- An overflow of an integer.
- A string of an object id that is not 24 lowercase hexadecimal characters.

An error of a conversion names the value that caused it. It also gives a short
hint about the expected format. Three examples of a hint are a valid string of a
UUID, an integer of 64 bits, and a number.
