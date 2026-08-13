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
| `INT64` | 64-bit signed integer | Yes | Also accepted as `INT`, `INTEGER`, or `SMALLINT`. |
| `FLOAT64` | IEEE-754 double | Yes | Also accepted as `FLOAT`. Also accepted as `DOUBLE` in `CAST`. |
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
| `INT`, `INTEGER`, `SMALLINT` | `INT64` |
| `FLOAT` | `FLOAT64` |
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
- SQL supports inline `ARRAY[...]` literals in expressions and DML values.
- Nested array literals such as `ARRAY[ARRAY[1]]` are rejected.
- Array elements may be `NULL`.

```camussql
INSERT INTO measurements (id, samples, labels)
VALUES (GEN_ID(), ARRAY[1.5, 2.0, 2.5], ARRAY['alpha', 'beta']);

UPDATE measurements
SET labels = ARRAY[]
WHERE id = STR_ID('507f1f77bcf86cd799439011');
```

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
| `BYTES` | `X'...'` hexadecimal bytes | `X'DEADBEEF'` |
| `ARRAY(T)` | `ARRAY[...]` | `ARRAY[1, 2, 3]` |

Numeric literals use invariant formatting, so `.` is the decimal separator
regardless of server locale. Date and datetime text is parsed as UTC. UUID
text is returned in canonical lowercase hyphenated form. Invalid date,
datetime, UUID, byte, or cast inputs fail with `InvalidInput`.

### String Literals

CamusDB supports two string literal forms.

Plain strings use single or double quotes and do not process backslash escapes.
A backslash is stored as a normal character. Escape the active quote delimiter
by doubling it:

```camussql
SELECT 'plain text';
SELECT 'C:\Users\data';
SELECT 'it''s ready';
SELECT "say ""hello""";
```

Plain strings are the right form for most values, including regular expression
patterns and Windows paths:

```camussql
SELECT name FROM files WHERE path = 'C:\Users\data';
SELECT name FROM users WHERE email ~ '^[^@]+@example\.com$';
```

Escape strings use the `E'...'` or `E"..."` prefix. In this form, backslash
introduces an escape sequence:

| Escape | Meaning |
| --- | --- |
| `\\` | Backslash |
| `\'`, `\"` | Quote character |
| `\n`, `\r`, `\t`, `\0`, `\a`, `\b`, `\f`, `\v` | Control characters |
| `\NNN` | Character from three octal digits |
| `\xHH` | Character from two hexadecimal digits |
| `\uHHHH`, `\UHHHHHHHH` | Unicode code point |

```camussql
COMMENT ON TABLE events IS E'first line\nsecond line';
```

Use escape strings when the value needs a control character such as a newline,
tab, carriage return, or NUL. Malformed numeric escapes, out-of-range Unicode
escapes, and unpaired surrogate escapes fail with `InvalidInput`.

An unrecognized escape keeps only the escaped character, so `E'\d+'` stores
`d+`. Use a plain string when you want a literal backslash.

`SHOW CREATE TABLE` and other schema renderers emit a re-parseable literal.
They prefer the plain form and use `E'...'` only when the value contains a
control character.

### Bytes Literals

Use `X'...'` for typed bytes literals:

```camussql
INSERT INTO documents (id, attachment)
VALUES (GEN_ID(), X'DEADBEEF');

SELECT X'4d5a';
SELECT X''; -- empty byte string
```

The hex digit count must be even. `x'...'` is also accepted.

`0xFF` remains an integer literal, not a bytes literal. When a target type is
known, CamusDB can still coerce string text such as `'0xDEADBEEF'` to `BYTES`,
but `X'...'` carries the bytes type directly and is the preferred SQL literal.

### Array Literals

Use `ARRAY[...]` for inline array values:

```camussql
SELECT ARRAY[1, 2, 3];

INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[1, 2, 3]);
```

The element type is inferred from the first non-`NULL` element. Other elements
must be compatible with that type, and CamusDB coerces them to the target
column's declared element type when needed.

```camussql
-- Accepted for ARRAY(FLOAT64): integer elements widen to float64.
INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[1, 2, 3]);

-- Empty arrays adopt the target column's element type.
INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[]);
```

Nested array literals are rejected.

## Casts

`CAST(value AS type)` works with scalar types:

```camussql
SELECT
  CAST("2026-03-15" AS DATE) AS event_day,
  CAST("2026-03-15T12:00:00Z" AS DATETIME) AS happened_at,
  CAST("550e8400-e29b-41d4-a716-446655440000" AS UUID) AS external_id,
  CAST(X'DEADBEEF' AS BYTES) AS payload,
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
oid object_id int int64 integer smallint string char varchar text bool boolean
float float32 float64 real date datetime timestamp bytes blob uuid guid array
```

Only the exact keyword is reserved. Identifiers that merely start with a type
word, such as `internal`, `dates`, or `blob_store`, remain valid.
