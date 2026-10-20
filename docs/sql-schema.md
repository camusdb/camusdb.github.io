---
sidebar_position: 2.1
---

# Tables and columns

A table definition is where you make the database enforce your data rules:
column types, primary keys, defaults, `CHECK` constraints, and foreign keys.
Every client then gets the same rules, not only the application that wrote them.
The statements look like the `CREATE TABLE` and `ALTER TABLE` you know from
PostgreSQL or MySQL. One difference helps when mistakes happen: by default, a
dropped table stays [recoverable](#drop-a-table) for a retention window.

Table statements run inside an existing database, so create the database first
or select it. Then you can create a table, alter a column, rename a table or a
column, or drop a table.

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
SELECT name, year
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

Columns that belong to a primary key are always `NOT NULL`. CamusDB records that
nullability even when the column definition omits the words `NOT NULL`.

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

Use a `FOREIGN KEY` constraint when a child table must reference a parent key:

```camussql
CREATE TABLE cities (
  name STRING PRIMARY KEY NOT NULL
);

CREATE TABLE weather (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  city STRING REFERENCES cities (name)
);
```

Foreign keys can also be added or dropped later:

```camussql
ALTER TABLE weather
ADD CONSTRAINT weather_city_fk
FOREIGN KEY (city) REFERENCES cities (name);

ALTER TABLE weather DROP CONSTRAINT weather_city_fk;
```

See [Foreign Keys](/docs/foreign-keys) for enforcement, indexes, branches, and
schema changes blocked by a constraint.

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

A table, a column, and an inline secondary index accept an inline
`COMMENT '<text>'` clause, and `COMMENT ON` sets or removes a comment later. See
[Schema Comments](/docs/comment-on) for the syntax, the limits, and where a
comment appears.

## Column storage strategies

For `STRING`, `BYTES`/`BLOB`, and `ARRAY` columns, use `STORAGE` to control
whether large values may be compressed or stored outside the row:

```camussql
CREATE TABLE docs (
  id OID PRIMARY KEY,
  title STRING,
  body STRING STORAGE EXTENDED,
  image BYTES STORAGE EXTERNAL,
  embedding BYTES(3072) STORAGE PLAIN
);
```

The strategies are `EXTENDED`, `MAIN`, `EXTERNAL`, and `PLAIN`. The default is
`EXTENDED`.

Change a strategy later with:

```camussql
ALTER TABLE docs ALTER COLUMN image SET STORAGE PLAIN;
```

Changing the strategy affects future writes only. To convert existing rows, run:

```camussql
ALTER TABLE docs REWRITE STORAGE;
```

See [Large Values](/docs/storage-layout) for the strategy choices, rewrite
behavior, downgrade steps, and transaction-limit impact.

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

Most defaults are evaluated once, when the DDL runs, and CamusDB stores the
value in the schema. That covers literals and deterministic expressions,
including function calls with arguments such as `upper('new')`.

Two kinds of default run again for each inserted row, including each row of a
multi-row `INSERT`:

- A zero-argument volatile function, such as `gen_id()`, `gen_uuid_v7()`,
  `random()`, `now()`, or `clock_timestamp()`.
- `nextval('sequence_name')`.

| Default expression | Column type | Use |
| --- | --- | --- |
| `DEFAULT (gen_id())` | `OID` | Generate an ObjectId at the insert of the row. |
| `DEFAULT (gen_uuid_v4())` | `UUID` or `GUID` | Generate a random UUID at the insert of the row. |
| `DEFAULT (gen_uuid_v7())` | `UUID` or `GUID` | Generate a UUID in time order, at the insert of the row. |
| `DEFAULT (random())` | `FLOAT64` | Generate a random number at the insert of the row. |
| `DEFAULT (now())` | `TIMESTAMP` | Record the transaction start time. |
| `DEFAULT (clock_timestamp())` | `TIMESTAMP` | Record the time of the insert of the row. |
| `DEFAULT (nextval('sequence_name'))` | `INT64` | Draw the next value from a sequence. |

`now()`, `current_timestamp()`, and `current_date()` return the transaction
start time, so every row of a transaction gets the same value. See
[Functions](/docs/functions) for the full list of volatile functions.

A volatile default must be a bare call with no argument. CamusDB rejects
`DEFAULT (random() * 10)` and session functions such as `current_user()`. It
also rejects a default that does not match the column type, such as
`DEFAULT (gen_id())` on a `UUID` column.

## Identity columns

Use an identity column when a table needs a readable numeric counter:

```camussql
CREATE TABLE invoices (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  invoice_no INT64 GENERATED BY DEFAULT AS IDENTITY,
  total FLOAT64 NOT NULL
);

CREATE TABLE tickets (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  ticket_no INT64 GENERATED ALWAYS AS IDENTITY,
  subject STRING NOT NULL
);
```

`GENERATED ALWAYS AS IDENTITY` refuses inserts that supply a value for the
column. `GENERATED BY DEFAULT AS IDENTITY` uses the sequence only when the
column is omitted. CamusDB also accepts `SERIAL` and `BIGSERIAL` as shorthand
for an `INT64` column backed by an owned sequence.

See [Sequences](/docs/sequences) for `CREATE SEQUENCE`, `nextval`, `currval`,
`setval`, ownership rules, and the behavior of cached sequence values.

## Column types

CamusDB columns use types such as `OID`, `UUID`, `INT64`, `NUMERIC`, `FLOAT64`,
`BOOL`, `STRING`, `DATETIME`, `BYTES`, and `ARRAY(T)`, plus familiar aliases such
as `INT`, `TEXT`, and `TIMESTAMP`. See [Data Types](/docs/data-types) for the
full type and alias tables, length limits, literal formats, casts, and array
rules.

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

CamusDB keeps the case you use when you create or rename an object, but name
lookups ignore case. See [Identifiers and case](/docs/sql#identifiers-and-case).

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
