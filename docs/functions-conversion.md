---
sidebar_position: 4.5
---

# Conversion functions

Conversion functions change a value from one type to another. For example, you
can read a number that was stored as text, or show a UUID as text in a report.
Each function has the same rules as the matching `CAST`, and `value::type` is
the same as `CAST(value AS type)`. A `NULL` input returns `NULL`.

These three queries return the same text.

```camussql
SELECT to_string(year) AS year_text FROM robots;
SELECT CAST(year AS STRING) AS year_text FROM robots;
SELECT year::STRING AS year_text FROM robots;
```

## The functions

A value that already has the result type is returned unchanged. The table
lists the other input types of each function.

| Function | Returns | Other inputs |
| --- | --- | --- |
| `to_string(value)` | `STRING` | All scalar types. See [Text form of each type](#text-form-of-each-type). |
| `to_int64(value)` | `INT64` | `FLOAT64` / `FLOAT32` / `NUMERIC` / `BOOL` / a `JSONB` number / integer text. A fraction rounds half away from zero, and `true` becomes `1`. |
| `to_float64(value)` | `FLOAT64` | `FLOAT32` / `INT64` / `NUMERIC` / `BOOL` / a `JSONB` number / numeric text. `'Infinity'` and `'NaN'` are also valid text. |
| `to_float32(value)` | `FLOAT32` | `FLOAT64` / `INT64` / `NUMERIC` / numeric text. |
| `to_bool(value)` | `BOOL` | A `JSONB` boolean / the text `true` or `false`, in any case. |
| `to_date(value)` | `DATE` | `DATETIME` / text in the form `yyyy-MM-dd`. A datetime becomes its UTC date. |
| `to_datetime(value)` | `DATETIME` | `DATE` / ISO-8601 text. A date becomes midnight UTC. |
| `to_bytes(value)` | `BYTES` | Hex text that starts with `0x` or `\x`. |
| `to_id(value)` | `OID` | Text with 24 lowercase hex characters. |
| `str_id(value)` | `OID` | The same as `to_id`. |

An input of another type returns `CADB0400`. For example, `to_bool(1)` and
`to_int64` of a `DATE` return an error.

Integer text can't have a fraction. This means that `to_int64('2.5')` returns
`CADB0400`. To round the text, convert it to `NUMERIC` first, as in
`to_int64(CAST('2.5' AS NUMERIC))`.

Datetime text can have up to seven fractional digits, as in
`2026-03-15T12:00:00.123Z`, or an offset, as in `2026-03-15T12:00:00+02:00`.
The result is converted to UTC. Text that doesn't have an offset is read as
UTC. Note that in the current release, text with both fractional seconds and an
offset returns an error. A space in place of the `T` also returns an error. To
read other formats, use `to_timestamp(text, pattern)` or
`to_date(text, pattern)`. For more information, see
[Pattern formatting and parsing](/docs/functions-datetime#pattern-formatting-and-parsing).

Bytes text must have an even number of hex digits. Base64 text isn't accepted.
To write a bytes value in SQL, you can also use a literal such as `X'DEADBEEF'`.

## CAST targets

`CAST(value AS type)` and `value::type` accept these type names.

| Type name | Result type |
| --- | --- |
| `string`, `char`, `varchar`, `text` | `STRING` |
| `int64`, `bigint` | `INT64` |
| `int`, `integer` | `INT64`. A value outside the 32-bit range returns `CADB0420`. |
| `smallint` | `INT64`. A value outside the 16-bit range returns `CADB0420`. |
| `numeric`, `decimal` | `NUMERIC` |
| `float`, `float64`, `double`, `double precision` | `FLOAT64` |
| `float32`, `real` | `FLOAT32` |
| `bool`, `boolean` | `BOOL` |
| `oid`, `id`, `object_id` | `OID` |
| `uuid`, `guid` | `UUID` |
| `date` | `DATE` |
| `datetime`, `timestamp` | `DATETIME` |
| `bytes`, `blob` | `BYTES` |
| `jsonb`, `json` | `JSONB`. Only text converts. To make a document from another value, use `to_jsonb`. |
| `interval` | `INTERVAL`, from text. See [Intervals](/docs/data-types#intervals). |

The narrow integer casts round a float first, and then they check the range.
For the rounding rules, see
[Casting floats to integers](/docs/data-types#casting-floats-to-integers).

PostgreSQL names such as `float8` and `timestamptz` return `CADB0400`. Use the
names in the table.

Casts to sized types such as `VARCHAR(10)` or `BYTES(16)` truncate longer
values. For examples, see [Casting to a length](/docs/data-types#casting-to-a-length).

## Text form of each type

The cast to `STRING` and `concat` use the same text form as `to_string`. Each
text form converts back to the same value with the matching function or cast.

| Type | Text form | Example |
| --- | --- | --- |
| `UUID` | Lowercase, with hyphens | `550e8400-e29b-41d4-a716-446655440000` |
| `DATE` | `yyyy-MM-dd` | `2026-03-15` |
| `DATETIME` | ISO-8601 in UTC, with seven fractional digits | `2026-03-15T12:00:00.0000000Z` |
| `BYTES` | `\x` followed by lowercase hex | `\xdeadbeef` |
| `NUMERIC` | The shortest decimal text | `12.5` |
| `FLOAT64`, `FLOAT32` | The shortest text that reads back as the same value | `0.1`, `1E+20`, `NaN` |
| `BOOL` | `true` or `false` | `true` |
| `INTERVAL` | ISO-8601 duration | `P1DT2H` |
| `JSONB` | JSON text | `{"a": 1}` |

`to_string` of an array returns `CADB0400`.

## Examples

```camussql
SELECT to_int64('42'), to_float64('42.5'), to_bool('TrUe');
-- 42, 42.5, true

SELECT to_int64(2.5), to_int64(-2.5);
-- 3, -3

SELECT to_date('2026-03-15'), to_datetime('2026-03-15T12:00:00Z');
-- 2026-03-15, 2026-03-15T12:00:00Z

SELECT CAST('0xDEADBEEF' AS BYTES), to_string(X'DEADBEEF');
-- the bytes DE AD BE EF, '\xdeadbeef'

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS UUID);

SELECT CAST('1234567890.123456789' AS NUMERIC);

SELECT '42'::INT64 + 1;
-- 43

SELECT id
FROM robots
WHERE id = str_id('507f1f77bcf86cd799439011');
```

## Conversion errors

A conversion that fails makes the statement fail. The message names the value
and the expected form, such as a 64-bit integer or a valid UUID.

| Cause | Error |
| --- | --- |
| Text that isn't a valid value of the target type | `CADB0400` |
| A type that can't convert to the target, such as `INT64` to `DATE` | `CADB0400` |
| An integer outside the target range, or `NaN` or infinity converted to an integer | `CADB0420` |
| A float outside the `FLOAT64` or `FLOAT32` range | `CADB0421` |
| A value outside the `NUMERIC` range | `CADB0417` |
| Text that isn't a valid JSON document | `CADB0418` |

When date text has a character such as an en dash in place of `-`, the message
names the character and its position.

## Related pages

- [Data types](/docs/data-types)
- [String functions](/docs/functions-string)
- [Date and time functions](/docs/functions-datetime)
- [Object ID functions](/docs/functions-object-id)
