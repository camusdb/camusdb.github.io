---
sidebar_position: 2
---

# SQL

CamusDB uses a compact SQL dialect for schema changes, writes, reads, indexes,
and transactions. SQL keywords are case-insensitive. Identifiers are normalized
to lowercase, including identifiers written with backticks.

## Data Definition

Create a table:

```sql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  year INT64 DEFAULT (2024),
  active BOOL DEFAULT (true)
);
```

Create a table only when it does not exist:

```sql
CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);
```

Declare a composite primary key after the column list:

```sql
CREATE TABLE readings (
  sensor_id STRING NOT NULL,
  ts INT64 NOT NULL,
  value FLOAT64 NOT NULL
) PRIMARY KEY (sensor_id ASC, ts DESC);
```

Drop tables:

```sql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
```

Alter tables:

```sql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots DROP COLUMN model;
ALTER TABLE robots ADD PRIMARY KEY (id);
ALTER TABLE robots DROP PRIMARY KEY;
```

## Indexes

Primary keys and unique columns create indexes. Additional indexes can be added
with either `CREATE INDEX` or `ALTER TABLE`.

```sql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);

ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_name_idx (name);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Inserts

Insert one or more rows:

```sql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), "C-3PO", 1977),
  (GEN_ID(), "T-800", 1984);
```

Use `DEFAULT` to apply a column default:

```sql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "K-2SO", DEFAULT);
```

Object id helpers are available as function calls:

```sql
GEN_ID()
STR_ID("507f1f77bcf86cd799439011")
```

## Queries

Select explicit columns, all columns, aliases, or aggregate expressions:

```sql
SELECT id, name FROM robots;
SELECT * FROM robots;
SELECT SUM(year) AS total_year FROM robots;
```

Supported aggregate functions are:

- `COUNT(*)` and `COUNT(column)`
- `SUM(column)`
- `AVG(column)`
- `MIN(column)`
- `MAX(column)`

Filters support comparison, boolean composition, pattern matching, and null
checks:

```sql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE year IS NULL OR name LIKE "%D2";
```

Supported filter operators include `=`, `!=`, `<`, `>`, `<=`, `>=`, `AND`,
`OR`, `LIKE`, `ILIKE`, `IS NULL`, and `IS NOT NULL`.

Order, limit, and offset results:

```sql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

Force a specific index when reading:

```sql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

## Updates And Deletes

Updates and deletes require `WHERE` clauses in SQL:

```sql
UPDATE robots
SET year = 1982
WHERE name = "T-800";

DELETE FROM robots
WHERE year < 1970;
```

## Transactions

CamusDB supports transaction statements:

```sql
BEGIN;
START TRANSACTION;
COMMIT;
ROLLBACK;
```

The HTTP API also exposes explicit transaction endpoints. When a write or query
request does not include a transaction id, the server starts and commits a
single-operation transaction automatically.

## Schema Inspection

```sql
SHOW TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
SHOW DATABASE;
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

## Parameters

SQL requests can pass parameter placeholders through the HTTP API:

```sql
SELECT id, name FROM robots WHERE id = @id;
UPDATE robots SET name = @name WHERE id = @id;
```

Parameter values are JSON `ColumnValue` objects in the request body.
