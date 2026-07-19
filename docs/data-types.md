---
sidebar_position: 2.2
---

# Data Types

CamusDB columns are strongly typed. The type is declared in `CREATE TABLE` or
`ALTER TABLE ... ADD COLUMN`, and CamusDB uses it for storage, comparisons,
indexes, casts, defaults, and JSON values.

## Type Reference

| SQL type | Stores | Indexable | Notes |
| --- | --- | --- | --- |
| `OID` | 12-byte ObjectId | Yes | Native identifier type. Also accepted as `OBJECT_ID` in SQL and `id` in HTTP table definitions. |
| `UUID` | 128-bit UUID | Yes | Native UUID/GUID type. Also accepted as `GUID`. |
| `INT64` | 64-bit signed integer | Yes | Also accepted as `INT` or `INTEGER`. |
| `FLOAT64` | IEEE-754 double | Yes | Also accepted as `DOUBLE` in `CAST`. |
| `FLOAT32` | IEEE-754 single | Yes | Also accepted as `REAL`. Values are stored and compared at single precision. |
| `BOOL` | Boolean | Yes | Also accepted as `BOOLEAN`. |
| `STRING` | UTF-16 text | Yes | Uses the default string length limit. Also accepted as `CHAR`, `VARCHAR`, or `TEXT`. |
| `STRING(N)` | UTF-16 text, max `N` characters | Yes | `N` must be a positive integer. `CHAR(N)` and `VARCHAR(N)` use the same bound. |
| `DATE` | Calendar date without time | Yes | Stored as UTC ticks truncated to midnight. |
| `DATETIME` | UTC instant | Yes | Also accepted as `TIMESTAMP`. |
| `BYTES` | Opaque byte string | Yes | Also accepted as `BLOB`. |
| `ARRAY(T)` | Ordered list of scalar `T` values | No | `T` must be a scalar type. Arrays are not supported in primary keys or indexes. |

```camussql
CREATE TABLE events (
  id OID PRIMARY KEY NOT NULL,
  external_id UUID DEFAULT (gen_uuid_v7()),
  name STRING(64) NOT NULL,
  payload BYTES,
  score FLOAT32,
  happened_at DATETIME,
  event_day DATE,
  tags ARRAY(INT64)
);
```

## Type Aliases

| Alias | Canonical type |
| --- | --- |
| `INT`, `INTEGER` | `INT64` |
| `REAL` | `FLOAT32` |
| `TIMESTAMP` | `DATETIME` |
| `BLOB` | `BYTES` |
| `CHAR`, `VARCHAR`, `TEXT` | `STRING` |
| `OBJECT_ID` | `OID` |
| `GUID` | `UUID` |
| `BOOLEAN` | `BOOL` |

In SQL, ObjectId columns use `OID` or `OBJECT_ID`. In HTTP table definitions,
the same type is named `id`. The SQL identifier `id` is still just an ordinary
column name.

Use `UUID` or `GUID` columns for UUID identifiers instead of storing UUIDs in
`STRING` columns. Native UUID values are stored as compact 128-bit values and
use fixed-width order-preserving index encoding, so they are more efficient in
memory, on disk, and in indexes than UUID text.

## String And Bytes Length

`STRING(N)` accepts at most `N` UTF-16 code units. A bare `STRING` column uses
the default maximum length of `2,621,440` characters.

`BYTES` columns use the default maximum length of `10,485,760` bytes, which is
10 MB.

CamusDB rejects over-length values instead of truncating them. Inserts,
updates, or casts that exceed the column bound fail with
`CADB0302 ValueTooLong`. `NULL` values do not have a length and are not checked
against these bounds.

```camussql
CREATE TABLE documents (
  id OID PRIMARY KEY NOT NULL,
  title STRING(120) NOT NULL,
  body STRING,
  attachment BYTES
);
```

## Arrays

`ARRAY(T)` stores an ordered, homogeneous list. The element type must be scalar:

```camussql
CREATE TABLE measurements (
  id OID PRIMARY KEY NOT NULL,
  samples ARRAY(FLOAT64),
  labels ARRAY(STRING)
);
```

Current array rules:

- Nested arrays such as `ARRAY(ARRAY(INT64))` are rejected.
- Array columns cannot be used in a primary key or secondary index.
- SQL does not currently have an inline array literal. Write array values
  through parameters, the HTTP JSON API, or the gRPC `Value` model.
- Array elements may be `NULL`.

## SQL Literal Formats

| Type | SQL literal form | Example |
| --- | --- | --- |
| `INT64` | Integer | `42` |
| `FLOAT64`, `FLOAT32` | Decimal number | `3.14` |
| `STRING` | Quoted string | `"hello"` or `'hello'` |
| `BOOL` | `true` or `false` | `true` |
| `OID` | Quoted 24-character ObjectId string | `"507f1f77bcf86cd799439011"` |
| `UUID` | Quoted UUID string, hyphenated or 32 hexadecimal digits | `"550e8400-e29b-41d4-a716-446655440000"` |
| `DATE` | Quoted `yyyy-MM-dd` string | `"2026-03-15"` |
| `DATETIME` | Quoted ISO-8601 UTC string | `"2026-03-15T12:00:00Z"` |
| `BYTES` | `0x`-prefixed hexadecimal | `0xDEADBEEF` |
| `ARRAY(T)` | No inline SQL literal | Use a parameter, HTTP JSON value, or gRPC `Value`. |

Numeric literals use invariant formatting, so `.` is the decimal separator
regardless of server locale. Date and datetime text is parsed as UTC. UUID
text is returned in canonical lowercase hyphenated form. Invalid date,
datetime, UUID, byte, or cast inputs fail with `InvalidInput`.

## Casts

`CAST(value AS type)` works with scalar types:

```camussql
SELECT
  CAST("2026-03-15" AS DATE) AS event_day,
  CAST("2026-03-15T12:00:00Z" AS DATETIME) AS happened_at,
  CAST("550e8400-e29b-41d4-a716-446655440000" AS UUID) AS external_id,
  CAST("0xDEADBEEF" AS BYTES) AS payload,
  CAST(score AS FLOAT32) AS compact_score
FROM events;
```

See [Conversion Functions](/docs/functions-conversion) for the matching
`to_*` functions.

## Temporal Functions

Date/time functions return typed temporal values, not strings:

| Function | Return type |
| --- | --- |
| `NOW()`, `CURRENT_TIMESTAMP()` | `DATETIME` |
| `CURRENT_DATE()` | `DATE` |
| `DATE_ADD(temporal, amount, unit)` | `DATETIME` |
| `DATE_TRUNC(unit, temporal)` | `DATETIME` |
| `FROM_UNIXTIME(seconds)` | `DATETIME` |
| `DATE_DIFF(start, end, unit)` | `INT64` |
| `DATE_PART(unit, temporal)` | `INT64` |
| `UNIX_TIMESTAMP([temporal])` | `INT64` |

Functions that accept temporal input can use `DATE` and `DATETIME` columns
directly. For example, `created_at < NOW()` compares two `DATETIME` values, and
`INSERT INTO events (created_at) VALUES (NOW())` stores a typed datetime value
without a cast.

See [Date/Time Functions](/docs/functions-datetime) for units, parsing rules,
and examples.

## Reserved Type Keywords

These SQL type names and aliases are reserved:

```text
oid object_id int int64 integer string char varchar text bool boolean
float32 float64 real date datetime timestamp bytes blob uuid guid array
```

Only the exact keyword is reserved. Identifiers that merely start with a type
word, such as `internal`, `dates`, or `blob_store`, remain valid.
