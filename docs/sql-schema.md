---
sidebar_position: 2.1
---

# Tables and columns

A table definition lets the database enforce your data rules, such as `CHECK`
constraints and foreign keys. This means that all clients that
write to the table follow the same rules. The statements are similar to
`CREATE TABLE` and `ALTER TABLE` in PostgreSQL or MySQL. One difference helps
when you make a mistake: by default, you can [recover](#drop-a-table) a dropped
table during a retention window.

Table statements apply to the current database. Create or select the database
first.

For migrations that need to commit schema and data changes together, see
[Transactional schema changes](/docs/sql-transactions#transactional-schema-changes).

## Create a table

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  year INT64 DEFAULT (2024),
  active BOOL DEFAULT (true)
);
```

To create a table only if it doesn't exist, add `IF NOT EXISTS`:

```camussql
CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL
);
```

To create a table from the result of a query, use `CREATE TABLE ... AS`:

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

`CREATE TABLE ... AS` adds a generated primary key column, and copies only the
columns of the result. Indexes, constraints, defaults, and comments aren't
copied from the source table. For more information, see
[Copying query results](/docs/insert-select-and-ctas).

An inline constraint in the column list can define a primary key or make a
column unique:

```camussql
CREATE TABLE app_users (
  id STRING PRIMARY KEY NOT NULL,
  email STRING UNIQUE NOT NULL,
  display_name STRING NOT NULL
);
```

Primary key columns are always `NOT NULL`, also when the column definition
doesn't say so.

Use a `CHECK` constraint when a column or a row must satisfy a condition. The
condition is checked before each insert and update:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 NOT NULL CHECK (price > 0),
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (discounted_price IS NULL OR price > discounted_price)
);
```

For more information, see [Check constraints](/docs/check-constraints).

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

You can also add or drop a foreign key later:

```camussql
ALTER TABLE weather
ADD CONSTRAINT weather_city_fk
FOREIGN KEY (city) REFERENCES cities (name);

ALTER TABLE weather DROP CONSTRAINT weather_city_fk;
```

For more information, see [Foreign keys](/docs/foreign-keys).

Declare a composite primary key after the column list:

```camussql
CREATE TABLE readings (
  sensor_id STRING NOT NULL,
  ts INT64 NOT NULL,
  value FLOAT64 NOT NULL
) PRIMARY KEY (sensor_id ASC, ts DESC);
```

You can also declare keys and indexes in the index style in `CREATE TABLE`:

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

`KEY ... INCLUDE (...)` creates a covering secondary index. For more
information, see [Indexes](/docs/sql-indexes#covering-indexes).

## Column types

For the column types and their aliases, such as `INT` for `INT64`, see
[Data types](/docs/data-types).

## Column defaults

Use `DEFAULT (...)` to set a default value. An insert uses the default when
it omits the column or puts `DEFAULT` in its `VALUES` list.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL,
  priority INT64 DEFAULT (0)
);

INSERT INTO events (event_name)
VALUES ('robot-created');

INSERT INTO events (event_name, priority)
VALUES ('robot-updated', DEFAULT);
```

Most defaults are evaluated once, when you run the DDL, and the value is stored
in the schema. This includes literals and deterministic expressions, such as
`upper('new')`.

The following defaults are evaluated again for each inserted row, also in a
multi-row `INSERT`:

- A volatile function with no arguments, such as `gen_id()` or `now()`.
- `nextval('sequence_name')`.

| Default expression | Column type | Use |
| --- | --- | --- |
| `DEFAULT (gen_id())` | `OID` | Generate an ObjectId for each row. |
| `DEFAULT (gen_uuid_v4())` | `UUID` or `GUID` | Generate a random UUID for each row. |
| `DEFAULT (gen_uuid_v7())` | `UUID` or `GUID` | Generate a time-ordered UUID for each row. |
| `DEFAULT (random())` | `FLOAT64` | Generate a random number for each row. |
| `DEFAULT (now())` | `TIMESTAMP` | Record the start time of the transaction. |
| `DEFAULT (clock_timestamp())` | `TIMESTAMP` | Record the time of the insert. |
| `DEFAULT (nextval('sequence_name'))` | `INT64` | Get the next value of a sequence. |

Defaults based on the transaction start time, such as `now()`, give the
same value to all rows in a transaction.
For the list of volatile functions, see [Functions](/docs/functions).

A volatile default must be a call with no arguments and no other expression.
For example, `DEFAULT (random() * 10)` returns an error. Session functions, such
as `current_user()`, can't be defaults. A default must also match the column
type. For example, `DEFAULT (gen_id())` on a `UUID` column returns `CADB0400`.

To reset a stored value, see [Defaults in writes](/docs/sql-writes#defaults).

## Identity columns

Use an identity column when a table needs a readable number for each row:

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

Both identity forms draw from the sequence when an insert omits the column or
uses `DEFAULT`. `SERIAL` and `BIGSERIAL` are short forms of an `INT64` identity
column.

For more information, see [Sequences](/docs/sequences).

## Alter a table

Add or drop a column:

```camussql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots ADD COLUMN notes STRING NULL COMMENT 'Operator notes';
ALTER TABLE robots DROP COLUMN model;
```

Drop or add a primary key:

```camussql
ALTER TABLE robots DROP PRIMARY KEY;
ALTER TABLE robots ADD PRIMARY KEY (id);
```

`ADD PRIMARY KEY` on a table that has a primary key returns `CADB0400`.

## Rename a table

```camussql
ALTER TABLE robots RENAME TO machines;
```

After the rename, the old name is invalid. The rows and indexes don't change.

A rename to an existing name returns `CADB0013` `TableAlreadyExists`. A rename
of a table that doesn't exist returns `CADB0011` `TableDoesntExist`.

## Rename a column

```camussql
ALTER TABLE machines RENAME COLUMN name TO display_name;
```

The rename changes the schema only. The values are available under the new
name, and queries can't use the old name.

A rename of a column that doesn't exist returns `CADB0404` `UnknownColumn`. A
rename to an existing name returns `CADB0403` `DuplicateColumn`.

## Drop a table

```camussql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
DROP TABLE robots FORCE;
```

`DROP TABLE` removes the table from the schema immediately. However, its data
is retained as a recoverable orphan for the configured retention window. The
table isn't listed in `SHOW TABLES`, and you can use the name again.

To see the recoverable tables of the current database, use
`SHOW ORPHAN TABLES`. To recover one under a new name, use `RELINK TO` with its
orphan ID:

```camussql
SHOW ORPHAN TABLES;
CREATE TABLE robots_recovered RELINK TO 'A0';
```

The recovered table has the rows, indexes, constraints, and columns that it had
when it was dropped.

`FORCE` deletes the table permanently and immediately. You can't recover a table
after `DROP TABLE ... FORCE`. For more information, see
[Recover dropped objects](/docs/recover-dropped-objects).

## Identifier case

CamusDB stores names in the case that you use, but name lookups ignore case.
For more information, see [Identifiers and case](/docs/sql#identifiers-and-case).

## Schema comments

Tables, columns, and inline secondary indexes accept a `COMMENT '<text>'`
clause. You can also set or remove a comment later with `COMMENT ON`. For more
information, see [Schema comments](/docs/comment-on).

## Column storage strategies

For `STRING`, `BYTES`, and `ARRAY` columns, `STORAGE` controls whether large
values can be compressed or stored outside the row:

```camussql
CREATE TABLE docs (
  id OID PRIMARY KEY,
  title STRING,
  body STRING STORAGE EXTENDED,
  image BYTES STORAGE EXTERNAL,
  embedding BYTES(3072) STORAGE PLAIN
);
```

The strategies are `EXTENDED` (the default), `MAIN`, `EXTERNAL`, and `PLAIN`. A
fixed-size type, such as `INT64`, can't have a strategy (`CADB0414`).

To change a strategy later, use `ALTER COLUMN ... SET STORAGE`:

```camussql
ALTER TABLE docs ALTER COLUMN image SET STORAGE PLAIN;
```

The change applies to new writes only. To convert the existing rows, run:

```camussql
ALTER TABLE docs REWRITE STORAGE;
```

For how to choose a strategy, see [Large values](/docs/storage-layout).

## Table settings

Use `ALTER TABLE ... SET (...)` to change a table setting:

```camussql
ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = false);

ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = true);
```

`sql_stats_automatic_collection_enabled` controls whether automatic analyze
can refresh the statistics of the table. The default is `true`. With `false`,
the table is excluded from background statistics collection. A manual
`ANALYZE TABLE application_logs` works as usual.

Table settings can also enable row-level TTL:

```camussql
ALTER TABLE sessions
SET (ttl_expiration_expression = 'expires_at', ttl_job_cron = '@hourly');

ALTER TABLE sessions
RESET (ttl);
```

For the TTL parameters, see [Row-level TTL](/docs/row-level-ttl).

Setting names aren't case-sensitive. An unknown setting name returns
`CADB0400`.

## Related pages

- [Databases](/docs/databases)
- [Recover dropped objects](/docs/recover-dropped-objects)
- [Data types](/docs/data-types)
- [Check constraints](/docs/check-constraints)
- [Indexes](/docs/sql-indexes)
- [Inspecting the database](/docs/sql-inspection)
- [Error codes](/docs/error-codes)
