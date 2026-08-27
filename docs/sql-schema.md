---
sidebar_position: 2.1
---

# Tables and columns

The DDL of a table runs inside an existing database. Create the database first,
or select it. Then create a table, alter a column, rename a schema object, or
drop a table.

## Create a table

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

Create a table from the result of a query:

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

`CREATE TABLE ... AS SELECT` adds its own generated column for the primary key.
It copies the shape of the result only. It inherits no index, no constraint, no
default, no comment, and no setting from the source table. See
[Copying Query Results](/docs/insert-select-and-ctas) for the rules of CTAS, for
a copy with time travel, and for the limits.

An inline constraint can define a primary key, and it can make a column unique.
Write it in the list of the columns:

```camussql
CREATE TABLE app_users (
  id STRING PRIMARY KEY NOT NULL,
  email STRING UNIQUE NOT NULL,
  display_name STRING NOT NULL
);
```

Use a `CHECK` constraint when a column or a row must satisfy a predicate. The
predicate applies before an insert, and before an update:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 NOT NULL CHECK (price > 0),
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (discounted_price IS NULL OR price > discounted_price)
);
```

See [Check Constraints](/docs/check-constraints) for the names, for `ALTER
TABLE`, for the behavior of a `NULL`, and for the supported expressions.

Declare a composite primary key after the list of the columns:

```camussql
CREATE TABLE readings (
  sensor_id STRING NOT NULL,
  ts INT64 NOT NULL,
  value FLOAT64 NOT NULL
) PRIMARY KEY (sensor_id ASC, ts DESC);
```

CamusDB also accepts an inline constraint in the style of an index, inside
`CREATE TABLE`:

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

An inline `KEY ... INCLUDE (...)` creates a covering secondary index. See
[Indexes](/docs/sql-indexes#covering-indexes). That page describes when an
included column helps a query, because the query then fetches no primary row.

## Comments in a schema

Use an inline `COMMENT '<text>'` clause to document a table, a column, and an
inline secondary index. Write it in the `CREATE TABLE` statement:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

You can also set a comment later, or remove one, with `COMMENT ON`:

```camussql
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

See [Schema Comments](/docs/comment-on) for four subjects:

- A comment on a database.
- The removal of a comment, with `IS NULL`.
- The limits.
- The behavior of the introspection.

## Column defaults

Use `DEFAULT (...)` to define a value. CamusDB applies that value in two cases:
an insert omits the column, and an insert uses the keyword `DEFAULT`.

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

CamusDB stores a constant default in the schema. It evaluates a supported
generator one time for each inserted row. That rule covers each row of an
`INSERT` of several rows.

| Default expression | Column type | Use |
| --- | --- | --- |
| `DEFAULT (gen_id())` | `OID` | Generate an ObjectId at the insert of the row. |
| `DEFAULT (gen_uuid_v4())` | `UUID` or `GUID` | Generate a random UUID at the insert of the row. |
| `DEFAULT (gen_uuid_v7())` | `UUID` or `GUID` | Generate a UUID in time order, at the insert of the row. |

A default that calls a function must be a bare call, with no argument. CamusDB
rejects a default that does not match the type. One example is `DEFAULT
(gen_id())` on a `UUID` column.

## Column types

| SQL type | Notes |
| --- | --- |
| `OID` | A native value of an object id. |
| `UUID` | A native UUID value of 128 bits. CamusDB also accepts `GUID`. |
| `INT64` | A signed integer of 64 bits. CamusDB also accepts `SMALLINT`. |
| `FLOAT64` | A value in floating point, at double precision. CamusDB also accepts `FLOAT`. |
| `FLOAT32` | A value in floating point, at single precision. |
| `BOOL` | A boolean value. |
| `STRING`, `STRING(N)` | Text, with an optional maximum length. CamusDB also accepts `CHAR`, `VARCHAR`, and `TEXT`. |
| `DATE` | A calendar date, without a time. |
| `DATETIME` | An instant in UTC. |
| `BYTES` | An opaque string of bytes. |
| `ARRAY(T)` | An ordered list of scalar values. You cannot index an array. |

These aliases are common:

- `INT`, `INTEGER`, and `SMALLINT` for `INT64`.
- `FLOAT` for `FLOAT64`.
- `REAL` for `FLOAT32`.
- `TIMESTAMP` for `DATETIME`.
- `BLOB` for `BYTES`.
- `CHAR`, `VARCHAR`, and `TEXT` for `STRING`.
- `BOOLEAN` for `BOOL`.
- `OBJECT_ID` for `OID`.
- `GUID` for `UUID`.

See [Data Types](/docs/data-types) for six subjects:

- The limits on a length.
- The formats of a literal.
- The casts.
- The recommendations for the storage.
- The encoding of a value in an API.
- The rules of an array.

## Alter a table

Add a column, or drop one:

```camussql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots ADD COLUMN notes STRING NULL COMMENT 'Operator notes';
ALTER TABLE robots DROP COLUMN model;
```

Add a primary key, or drop one:

```camussql
ALTER TABLE robots ADD PRIMARY KEY (id);
ALTER TABLE robots DROP PRIMARY KEY;
```

## Rename a table

```camussql
ALTER TABLE robots RENAME TO machines;
```

After the rename, the old name of the table is no longer valid. The new name
resolves to the same data of the table. The rows and the indexes survive the
rename, because the identity in the storage is not the display name of the
table.

A rename to a name that exists fails with `TableAlreadyExists`. A rename of a
table that does not exist fails with `TableDoesntExist`.

## Rename a column

```camussql
ALTER TABLE machines RENAME COLUMN name TO display_name;
```

The rename of a column changes the metadata of the stored rows only. The values
of an existing row stay available, under the new name of the column. The result
of a query no longer includes the old name.

A rename of a column that does not exist fails with `UnknownColumn`. A rename to
a name that exists fails with `DuplicateColumn`.

## The case of an identifier

CamusDB keeps the case of the name of a schema object. It keeps the case of the
creation, and of a rename. A lookup of a name nevertheless ignores the case.

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

`SHOW TABLES`, `SHOW COLUMNS`, and `SHOW CREATE TABLE` show the stored names, in
their original case. A reference in SQL can use any case.

CamusDB rejects two names that differ only in their case. A table therefore
cannot hold both `RobotName` and `robotname`. A database cannot hold both
`Robots` and `robots` as two tables.

## Settings of a table

Use `ALTER TABLE ... SET (...)` to update a setting at the level of a table.

```camussql
ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = false);

ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = true);
```

`sql_stats_automatic_collection_enabled` controls one thing: whether automatic
analyze may refresh the statistics of that table. It defaults to `true`. A value
of `false` opts the table out of the collection of the statistics in the
background. A manual `ANALYZE TABLE application_logs` still runs.

A table can also enable a row-level TTL, through the settings of the table:

```camussql
ALTER TABLE sessions
SET (ttl_expiration_expression = 'expires_at', ttl_job_cron = '@hourly');

ALTER TABLE sessions
RESET (ttl);
```

See [Row-Level TTL](/docs/row-level-ttl) for three subjects: the supported
parameters of a TTL, the rules of the column of the expiry, and the behavior of
the sweep.

The name of a setting is not case-sensitive. CamusDB rejects an unknown name of
a setting.

## Drop a table

```camussql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
DROP TABLE robots FORCE;
```

`DROP TABLE` removes the table from the active schema immediately. CamusDB
nevertheless keeps the data of the table as a recoverable orphan, for the
configured window of the retention. `SHOW TABLES` no longer lists the table, and
you can use the name again.

Use `SHOW ORPHAN TABLES` in the current database to inspect the recoverable
tables. Then recover one under a new name:

```camussql
SHOW ORPHAN TABLES;
CREATE TABLE robots_recovered RELINK TO "A0";
```

The recovered table keeps the rows, the indexes, the constraints, and the
definitions of the columns from the time of the drop.

Use `FORCE` only when CamusDB must delete the table physically, immediately, and
permanently:

```camussql
DROP TABLE robots FORCE;
```

A forced drop creates no orphan. You cannot recover the table after it. See
[Recover Dropped Objects](/docs/recover-dropped-objects) for the settings of the
retention, for examples of a recovery, and for the limits.

## Related pages

- [Databases](/docs/databases)
- [Recover Dropped Objects](/docs/recover-dropped-objects)
- [Data Types](/docs/data-types)
- [Check Constraints](/docs/check-constraints)
- [Indexes](/docs/sql-indexes)
- [Inspecting The Database](/docs/sql-inspection)
- [Error Codes](/docs/error-codes)
