---
sidebar_position: 2.1
---

# Tables And Columns

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

Create a table from a query result:

```camussql
CREATE TABLE vintage_robots AS
SELECT name, kind, year
FROM robots
WHERE year < 1990;

CREATE TABLE empty_robot_archive AS
SELECT *
FROM robots
WITH NO DATA;
```

`CREATE TABLE ... AS SELECT` adds its own generated primary key column and
copies only the query result shape. It does not inherit source indexes,
constraints, defaults, comments, or table settings. See
[Copying Query Results](/docs/insert-select-and-ctas) for CTAS rules,
time-travel copy, and limits.

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
  KEY name_idx (name),
  KEY code_lookup_idx (code) INCLUDE (name)
);
```

Inline `KEY ... INCLUDE (...)` creates a covering secondary index. See
[Indexes](/docs/sql-indexes#covering-indexes) for when included columns help a
query avoid fetching the primary row.

## Schema Comments

Use inline `COMMENT '<text>'` clauses to document tables, columns, and inline
secondary indexes when creating a table:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

You can also set or remove comments later with `COMMENT ON`:

```camussql
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

See [Schema Comments](/docs/comment-on) for database comments, removal with
`IS NULL`, limits, and introspection behavior.

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
| `INT64` | Signed 64-bit integers. Also accepted as `SMALLINT`. |
| `FLOAT64` | Double-precision floating point values. Also accepted as `FLOAT`. |
| `FLOAT32` | Single-precision floating point values. |
| `BOOL` | Boolean values. |
| `STRING`, `STRING(N)` | Text values, optionally with a maximum length. Also accepted as `CHAR`, `VARCHAR`, or `TEXT`. |
| `DATE` | Calendar dates without time. |
| `DATETIME` | UTC instants. |
| `BYTES` | Opaque byte strings. |
| `ARRAY(T)` | Ordered lists of scalar values. Arrays are not indexable. |

Common aliases include `INT` / `INTEGER` / `SMALLINT` for `INT64`, `FLOAT` for
`FLOAT64`, `REAL` for `FLOAT32`, `TIMESTAMP` for `DATETIME`, `BLOB` for
`BYTES`, `CHAR` / `VARCHAR` / `TEXT` for `STRING`, `BOOLEAN` for `BOOL`,
`OBJECT_ID` for `OID`, and `GUID` for `UUID`.

See [Data Types](/docs/data-types) for length limits, literal formats, casts,
storage recommendations, API value encoding, and array rules.

## Alter Tables

Add or drop columns:

```camussql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots ADD COLUMN notes STRING NULL COMMENT 'Operator notes';
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

## Identifier Case

Schema object names preserve the case you use when creating or renaming them,
but name lookup is case-insensitive.

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

`SHOW TABLES`, `SHOW COLUMNS`, and `SHOW CREATE TABLE` display the stored names
with their original case. References in SQL can use any case.

Duplicate names that differ only by case are rejected. For example, a table
cannot contain both `RobotName` and `robotname`, and a database cannot contain
both `Robots` and `robots` as separate tables.

## Table Settings

Use `ALTER TABLE ... SET (...)` to update table-level settings.

```camussql
ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = false);

ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = true);
```

`sql_stats_automatic_collection_enabled` controls whether automatic analyze may
refresh statistics for that table. It defaults to `true`. Setting it to `false`
opts the table out of background statistics collection, but manual
`ANALYZE TABLE application_logs` still runs.

Tables can also enable row-level TTL with table settings:

```camussql
ALTER TABLE sessions
SET (ttl_expiration_expression = 'expires_at', ttl_job_cron = '@hourly');

ALTER TABLE sessions
RESET (ttl);
```

See [Row-Level TTL](/docs/row-level-ttl) for supported TTL parameters,
expiration-column rules, and sweep behavior.

Setting names are case-insensitive. Unknown setting names are rejected.

## Drop Tables

```camussql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
DROP TABLE robots FORCE;
```

`DROP TABLE` removes the table from the active schema immediately, but the table
data is retained as a recoverable orphan for the configured retention window.
`SHOW TABLES` no longer lists the table and the name is free to reuse.

Use `SHOW ORPHAN TABLES` in the current database to inspect recoverable dropped
tables, then recover one under a new name:

```camussql
SHOW ORPHAN TABLES;
CREATE TABLE robots_recovered RELINK TO "A0";
```

The recovered table keeps its rows, indexes, constraints, and column definitions
from the time it was dropped.

Use `FORCE` only when the table should be physically deleted immediately and
permanently:

```camussql
DROP TABLE robots FORCE;
```

Forced drops create no orphan and cannot be recovered. See
[Recover Dropped Objects](/docs/recover-dropped-objects) for retention settings,
recovery examples, and limits.

## Related Pages

- [Databases](/docs/databases)
- [Recover Dropped Objects](/docs/recover-dropped-objects)
- [Data Types](/docs/data-types)
- [Check Constraints](/docs/check-constraints)
- [Indexes](/docs/sql-indexes)
- [Inspecting The Database](/docs/sql-inspection)
- [Error Codes](/docs/error-codes)
