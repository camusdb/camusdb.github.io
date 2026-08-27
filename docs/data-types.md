---
sidebar_position: 2.2
---

# Data types

A CamusDB column has a strong type. You declare that type in `CREATE TABLE`, or
in `ALTER TABLE ... ADD COLUMN`. CamusDB uses the type for the storage, for a
comparison, for an index, for a cast, for a default, and for a JSON value.

## Reference of the types

| SQL type | Stores | Indexable | Notes |
| --- | --- | --- | --- |
| `OID` | A 12-byte ObjectId | Yes | The native type of an identifier. SQL also accepts `OBJECT_ID`. An HTTP table definition names the type `id`. |
| `UUID` | A 128-bit UUID | Yes | The native type of a UUID or a GUID. CamusDB also accepts `GUID`. |
| `INT64` | A 64-bit signed integer | Yes | CamusDB also accepts `INT`, `INTEGER`, and `SMALLINT`. |
| `FLOAT64` | An IEEE-754 double | Yes | CamusDB also accepts `FLOAT`. In a `CAST`, it also accepts `DOUBLE`. |
| `FLOAT32` | An IEEE-754 single | Yes | CamusDB also accepts `REAL`. It stores and compares the value at single precision. |
| `BOOL` | A boolean | Yes | CamusDB also accepts `BOOLEAN`. |
| `STRING` | UTF-16 text | Yes | It uses the default limit on the length of a string. CamusDB also accepts `CHAR`, `VARCHAR`, and `TEXT`. |
| `STRING(N)` | UTF-16 text, with a maximum of `N` characters | Yes | `N` must be a positive integer. `CHAR(N)` and `VARCHAR(N)` use the same bound. |
| `DATE` | A calendar date, without a time | Yes | CamusDB stores it as UTC ticks, truncated to midnight. |
| `DATETIME` | An instant in UTC | Yes | CamusDB also accepts `TIMESTAMP`. |
| `BYTES` | An opaque string of bytes | Yes | CamusDB also accepts `BLOB`. |
| `BYTES(N)` | An opaque string of bytes, with a maximum of `N` bytes | Yes | `N` must be a positive integer. `BLOB(N)` uses the same bound. |
| `ARRAY(T)` | An ordered list of scalar values of type `T` | No | `T` must be a scalar type. You cannot use an array in a primary key, and you cannot use one in an index. |

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

## Aliases of the types

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

In SQL, a column of an ObjectId uses `OID` or `OBJECT_ID`. In an HTTP table
definition, the same type has the name `id`. The SQL identifier `id` is still an
ordinary column name.

Use a `UUID` or a `GUID` column for a UUID identifier. Do not store a UUID in a
`STRING` column. CamusDB stores a native UUID as a compact 128-bit value. It
also uses an index encoding of a fixed width that preserves the order. A native
UUID is therefore more efficient than UUID text, in memory, on disk, and in an
index.

## The length of a string and of a bytes value

`STRING(N)` accepts at most `N` UTF-16 code units. A bare `STRING` column uses
the default maximum length of `2,621,440` characters.

`BYTES(N)` accepts at most `N` bytes. A bare `BYTES` column uses the default
maximum length of `10,485,760` bytes, which is 10 MB.

Both bounds are maximums, not fixed widths. A `BYTES(3072)` column accepts a
shorter value without complaint. Add a `CHECK` constraint when a column must
hold an exact number of bytes. [Vector search](/docs/vector-search) shows that
pattern for an embedding.

CamusDB rejects a value that is too long. It does not truncate that value. An
insert, an update, and a cast that exceeds the bound of the column fails with
`CADB0302 ValueTooLong`. A `NULL` has no length. CamusDB therefore does not
check a `NULL` against these bounds.

```camussql
CREATE TABLE documents (
  id OID PRIMARY KEY NOT NULL,
  title STRING(120) NOT NULL,
  body STRING,
  attachment BYTES
);
```

## Arrays

`ARRAY(T)` stores an ordered list of one type. The type of an element must be
scalar:

```camussql
CREATE TABLE measurements (
  id OID PRIMARY KEY NOT NULL,
  samples ARRAY(FLOAT64),
  labels ARRAY(STRING)
);
```

These rules apply to an array today:

- CamusDB rejects an array inside an array, such as `ARRAY(ARRAY(INT64))`.
- You cannot use an array column in a primary key. You cannot use it in a
  secondary index.
- SQL supports an inline `ARRAY[...]` literal, in an expression and in the
  values of a DML statement.
- CamusDB rejects a literal of an array inside an array, such as
  `ARRAY[ARRAY[1]]`.
- An element of an array may be `NULL`.

```camussql
INSERT INTO measurements (id, samples, labels)
VALUES (GEN_ID(), ARRAY[1.5, 2.0, 2.5], ARRAY['alpha', 'beta']);

UPDATE measurements
SET labels = ARRAY[]
WHERE id = STR_ID('507f1f77bcf86cd799439011');
```

## The literal formats of SQL

| Type | Form of the SQL literal | Example |
| --- | --- | --- |
| `INT64` | An integer | `42` |
| `FLOAT64`, `FLOAT32` | A decimal number | `3.14` |
| `STRING` | A quoted string | `"hello"` or `'hello'` |
| `BOOL` | `true` or `false` | `true` |
| `OID` | A quoted ObjectId string of 24 characters | `"507f1f77bcf86cd799439011"` |
| `UUID` | A quoted UUID string, with hyphens or as 32 hexadecimal digits | `"550e8400-e29b-41d4-a716-446655440000"` |
| `DATE` | A quoted string in the form `yyyy-MM-dd` | `"2026-03-15"` |
| `DATETIME` | A quoted UTC string in the ISO-8601 form | `"2026-03-15T12:00:00Z"` |
| `BYTES` | Hexadecimal bytes, in the form `X'...'` | `X'DEADBEEF'` |
| `ARRAY(T)` | `ARRAY[...]` | `ARRAY[1, 2, 3]` |

A numeric literal uses invariant formatting. The decimal separator is therefore
`.`, whatever the locale of the server is.

CamusDB parses the text of a date and of a datetime as UTC. It returns the text
of a UUID in the canonical form: lowercase, and with hyphens. An invalid input
of a date, a datetime, a UUID, a byte value, or a cast fails with
`InvalidInput`.

### String literals

CamusDB supports two forms of a string literal.

A plain string uses a single quotation mark, or a double one. It does not
process a backslash as an escape. CamusDB stores a backslash as a normal
character. Repeat the active quotation mark to escape it:

```camussql
SELECT 'plain text';
SELECT 'C:\Users\data';
SELECT 'it''s ready';
SELECT "say ""hello""";
```

A plain string is the correct form for most values. That includes the pattern of
a regular expression, and a path on Windows:

```camussql
SELECT name FROM files WHERE path = 'C:\Users\data';
SELECT name FROM users WHERE email ~ '^[^@]+@example\.com$';
```

An escape string uses the prefix `E'...'` or `E"..."`. In that form, a backslash
starts an escape sequence:

| Escape | Meaning |
| --- | --- |
| `\\` | A backslash |
| `\'`, `\"` | A quotation mark |
| `\n`, `\r`, `\t`, `\0`, `\a`, `\b`, `\f`, `\v` | A control character |
| `\NNN` | The character of three octal digits |
| `\xHH` | The character of two hexadecimal digits |
| `\uHHHH`, `\UHHHHHHHH` | A Unicode code point |

```camussql
COMMENT ON TABLE events IS E'first line\nsecond line';
```

Use an escape string when the value needs a control character. Examples are a
new line, a tab, a carriage return, and a NUL. Three inputs fail with
`InvalidInput`: a numeric escape with a wrong form, a Unicode escape outside the
valid range, and a surrogate escape without its pair.

An escape that CamusDB does not know keeps only the escaped character. `E'\d+'`
therefore stores `d+`. Use a plain string when you want a literal backslash.

`SHOW CREATE TABLE` and the other renderers of a schema emit a literal that the
parser accepts again. They prefer the plain form. They use `E'...'` only when
the value holds a control character.

### Bytes literals

Use `X'...'` for a typed literal of bytes:

```camussql
INSERT INTO documents (id, attachment)
VALUES (GEN_ID(), X'DEADBEEF');

SELECT X'4d5a';
SELECT X''; -- empty byte string
```

The count of the hexadecimal digits must be even. CamusDB also accepts
`x'...'`.

`0xFF` stays an integer literal. It is not a literal of bytes. CamusDB can still
coerce string text such as `'0xDEADBEEF'` to `BYTES`, when it knows the target
type. `X'...'` nevertheless carries the type of bytes directly. It is the
preferred literal in SQL.

### Array literals

Use `ARRAY[...]` for an inline value of an array:

```camussql
SELECT ARRAY[1, 2, 3];

INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[1, 2, 3]);
```

CamusDB infers the type of the elements from the first element that is not
`NULL`. Every other element must be compatible with that type. CamusDB coerces
an element to the declared type of the target column, where that is necessary.

```camussql
-- Accepted for ARRAY(FLOAT64): integer elements widen to float64.
INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[1, 2, 3]);

-- Empty arrays adopt the target column's element type.
INSERT INTO measurements (id, samples)
VALUES (GEN_ID(), ARRAY[]);
```

CamusDB rejects a literal of an array inside an array.

## Casts

`CAST(value AS type)` works with a scalar type:

```camussql
SELECT
  CAST("2026-03-15" AS DATE) AS event_day,
  CAST("2026-03-15T12:00:00Z" AS DATETIME) AS happened_at,
  CAST("550e8400-e29b-41d4-a716-446655440000" AS UUID) AS external_id,
  CAST(X'DEADBEEF' AS BYTES) AS payload,
  CAST(score AS FLOAT32) AS compact_score
FROM events;
```

See [Conversion Functions](/docs/functions-conversion) for the equivalent `to_*`
functions.

## Temporal functions

A function for a date or a time returns a typed temporal value. It does not
return a string:

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

A function that accepts a temporal input can use a `DATE` column and a
`DATETIME` column directly. For example, `created_at < NOW()` compares two
`DATETIME` values. `INSERT INTO events (created_at) VALUES (NOW())` stores a
typed datetime value, and it needs no cast.

See [Date/Time Functions](/docs/functions-datetime) for the units, the rules of
the parser, and some examples.

## Reserved keywords of the types

CamusDB reserves these names of a type, and these aliases:

```text
oid object_id int int64 integer smallint string char varchar text bool boolean
float float32 float64 real date datetime timestamp bytes blob uuid guid array
```

CamusDB reserves the exact keyword only. An identifier that merely starts with
the word of a type stays valid. Three examples are `internal`, `dates`, and
`blob_store`.
