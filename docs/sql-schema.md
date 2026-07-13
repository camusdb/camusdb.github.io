---
sidebar_position: 2.1
---

# Tables And Schema

Table DDL runs inside an existing database. Create or select the database first,
then create tables, alter columns, rename schema objects, or drop tables.

## Create Tables

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  year INT64 DEFAULT (2024),
  active BOOL DEFAULT (true)
);
```

Create a table only when it does not exist:

```camussql
CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL
);
```

Inline constraints can define primary keys and unique columns directly in the
column list:

```camussql
CREATE TABLE app_users (
  id STRING PRIMARY KEY NOT NULL,
  email STRING UNIQUE NOT NULL,
  display_name STRING NOT NULL
);
```

Use `CHECK` constraints when a column or row must satisfy a predicate before it
can be inserted or updated:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 NOT NULL CHECK (price > 0),
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (discounted_price IS NULL OR price > discounted_price)
);
```

See [Check Constraints](/docs/check-constraints) for naming, `ALTER TABLE`,
`NULL` behavior, and supported expressions.

Declare a composite primary key after the column list:

```camussql
CREATE TABLE readings (
  sensor_id STRING NOT NULL,
  ts INT64 NOT NULL,
  value FLOAT64 NOT NULL
) PRIMARY KEY (sensor_id ASC, ts DESC);
```

CamusDB also accepts inline index-style constraints inside `CREATE TABLE`:

```camussql
CREATE TABLE robots (
  id OID NOT NULL DEFAULT (gen_id()),
  code STRING NOT NULL,
  name STRING,
  PRIMARY KEY (id),
  UNIQUE KEY code_uk (code),
  KEY name_idx (name)
);
```

## Column Defaults

Use `DEFAULT (...)` to define a value CamusDB applies when an insert omits the
column or uses the `DEFAULT` keyword.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL,
  priority INT64 DEFAULT (0)
);

INSERT INTO events (event_name)
VALUES ("robot-created");

INSERT INTO events (id, event_name, priority)
VALUES (DEFAULT, "robot-updated", DEFAULT);
```

Constant defaults are stored in the schema. Supported volatile generator
defaults are evaluated once per inserted row, including each row in a multi-row
`INSERT`.

| Default expression | Column type | Use case |
| --- | --- | --- |
| `DEFAULT (gen_id())` | `OID` | Generate an ObjectId when the row is inserted. |
| `DEFAULT (gen_uuid_v4())` | `UUID` / `GUID` | Generate a random UUID when the row is inserted. |
| `DEFAULT (gen_uuid_v7())` | `UUID` / `GUID` | Generate a time-ordered UUID when the row is inserted. |

Function defaults must be bare zero-argument calls. CamusDB rejects mismatched
defaults such as `DEFAULT (gen_id())` on a `UUID` column.

## Column Types

| SQL type | Notes |
| --- | --- |
| `OID` | Native object id values. |
| `UUID` | Native 128-bit UUID values. Also accepted as `GUID`. |
| `INT64` | Signed 64-bit integers. |
| `FLOAT64` | Double-precision floating point values. |
| `FLOAT32` | Single-precision floating point values. |
| `BOOL` | Boolean values. |
| `STRING`, `STRING(N)` | Text values, optionally with a maximum length. Also accepted as `CHAR`, `VARCHAR`, or `TEXT`. |
| `DATE` | Calendar dates without time. |
| `DATETIME` | UTC instants. |
| `BYTES` | Opaque byte strings. |
| `ARRAY(T)` | Ordered lists of scalar values. Arrays are not indexable. |

Common aliases include `INT` / `INTEGER` for `INT64`, `REAL` for `FLOAT32`,
`TIMESTAMP` for `DATETIME`, `BLOB` for `BYTES`, `CHAR` / `VARCHAR` / `TEXT`
for `STRING`, `BOOLEAN` for `BOOL`, `OBJECT_ID` for `OID`, and `GUID` for
`UUID`.

See [Data Types](/docs/data-types) for length limits, literal formats, casts,
storage recommendations, HTTP JSON values, and array rules.

## Alter Tables

Add or drop columns:

```camussql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots DROP COLUMN model;
```

Add or drop a primary key:

```camussql
ALTER TABLE robots ADD PRIMARY KEY (id);
ALTER TABLE robots DROP PRIMARY KEY;
```

## Rename Tables

```camussql
ALTER TABLE robots RENAME TO machines;
```

After the rename, the old table name is no longer valid and the new table name
resolves to the same table data. Row and index data survive the rename because
the storage identity is not the table display name.

Renaming to an existing table name fails with `TableAlreadyExists`. Renaming a
missing table fails with `TableDoesntExist`.

## Rename Columns

```camussql
ALTER TABLE machines RENAME COLUMN name TO display_name;
```

Column rename is metadata-only for stored rows. Existing row values remain
available under the new column name, and query results no longer include the old
column name.

Renaming a missing column fails with `UnknownColumn`. Renaming to an existing
column name fails with `DuplicateColumn`.

## Drop Tables

```camussql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
```

## Related Pages

- [Databases](/docs/databases)
- [Data Types](/docs/data-types)
- [Check Constraints](/docs/check-constraints)
- [Indexes](/docs/sql-indexes)
- [Schema Inspection](/docs/sql-inspection)
- [Error Codes](/docs/error-codes)
