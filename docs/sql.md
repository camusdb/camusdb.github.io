---
sidebar_position: 2
---

# SQL Overview

CamusDB speaks a compact SQL dialect covering database lifecycle, schema
changes, writes, reads, indexes, and transactions. If you know SQL, most of it
will look familiar; this page covers the parts that are specific to CamusDB.

```camussql
CREATE DATABASE IF NOT EXISTS app;

CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  year INT64 DEFAULT (2024)
);

CREATE INDEX robots_year_idx ON robots (year DESC);

INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC;
```

## Identifiers And Case

Keywords are case-insensitive. Database, table, column, and index names are
stored in the case you create them in, and matched case-insensitively
afterwards:

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

Results still display the original `Robots`, `Id`, and `RobotName`, but
`robots`, `ROBOTS`, and `Robots` all address the same table. Names are unique
case-insensitively too, so `Robots` and `robots` cannot coexist as two tables in
one database.

### Backticks

Use backticks when an identifier collides with a reserved keyword, type name, or
function name:

```camussql
CREATE TABLE `order` (
  `select` STRING NOT NULL,
  `from` STRING
);

SELECT `select`, `from`
FROM `order`;
```

`CASE` and `END` are reserved, so a column named `end` needs
``SELECT `end` FROM events``.

## Literals

Backticks quote identifiers only. String literals take single or double quotes,
interchangeably:

```camussql
SELECT "literal text", 'literal text';
```

See [Data Types](/docs/data-types) for the literal format of every type,
including temporal values, arrays, and object ids.

## Comments

Both comment forms are accepted anywhere whitespace is valid: before a
statement, between clauses, or at the end of a line.

```camussql
-- Line comments run to the end of the line.
SELECT id, name
FROM robots
WHERE year >= 1980; -- only newer robots

/*
  Block comments span multiple lines.
*/
SELECT id, name
FROM robots /* or sit inline */
WHERE active = true;
```

Block comments do not nest. The first `*/` closes the comment, and an
unterminated one is a parse error. Comment markers inside string literals are
just text:

```camussql
SELECT "not -- a comment" AS value;
```

One subtlety: `--` always starts a comment, so `SELECT 10 FROM t --5` parses as
`SELECT 10 FROM t`. Write `10 - -5` with a space to subtract a negative number.

## Statement Map

### Schema

| Task | Page |
| --- | --- |
| Databases, create and drop | [Databases](/docs/databases) |
| Branching a database | [Database Branching](/docs/database-branching) |
| Restoring dropped databases and tables | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Tables, columns, and `ALTER` | [Tables And Columns](/docs/sql-schema) |
| Column types and literals | [Data Types](/docs/data-types) |
| `CHECK` and `NOT NULL` | [Check Constraints](/docs/check-constraints) |
| Indexes, including covering indexes | [Indexes](/docs/sql-indexes) |
| Descriptions on schema objects | [Schema Comments](/docs/comment-on) |
| Stored queries | [Views](/docs/views) |
| Stored query results | [Materialized Views](/docs/materialized-views) |

### Reading And Writing

| Task | Page |
| --- | --- |
| `INSERT`, `UPDATE`, `DELETE` | [Insert, Update, Delete](/docs/sql-writes) |
| `INSERT ... SELECT` and CTAS | [Copying Query Results](/docs/insert-select-and-ctas) |
| `SELECT`, filters, grouping, ordering | [SELECT](/docs/sql-queries) |
| Joins, subqueries, derived tables | [Joins And Subqueries](/docs/joins-and-subqueries) |
| Historical snapshots | [Time-Travel Reads](/docs/time-travel-reads) |
| `SELECT` with no table source | [SELECT Without FROM](/docs/sql-fromless-select) |
| Scalar functions | [Functions](/docs/functions) |
| Row expiration | [Row-Level TTL](/docs/row-level-ttl) |

### Transactions, Performance, And Inspection

| Task | Page |
| --- | --- |
| `BEGIN`, `COMMIT`, isolation, locking | [Transactions In SQL](/docs/sql-transactions) |
| How plans are chosen | [Query Planning](/docs/query-planning) |
| Reading a plan | [EXPLAIN](/docs/explain) |
| The estimates behind a plan | [SHOW STATISTICS](/docs/show-statistics) |
| Caching repeated reads | [Result Cache](/docs/query-result-cache) |
| Running a scan across the cluster | [Distributed Queries](/docs/distributed-queries) |
| Placeholders and prepared handles | [Parameters And Prepared Statements](/docs/prepared-statements) |
| `SHOW`, `DESCRIBE`, `ANALYZE` | [Inspecting The Database](/docs/sql-inspection) |
| Grants and roles | [Authentication And Authorization](/docs/sql-authentication) |
| `SET` / `RESET CLUSTER SETTING` | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |
