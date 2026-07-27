---
sidebar_position: 2
---

# SQL

CamusDB uses a compact SQL dialect for database lifecycle, schema changes,
writes, reads, indexes, and transactions.

SQL keywords are case-insensitive.

## Identifiers

CamusDB stores database, table, column, and index names in the exact case used
when they are created. Later references match those names case-insensitively.

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

The table still displays as `Robots`, and the columns still display as `Id` and
`RobotName`, but `robots`, `ROBOTS`, and `Robots` all refer to the same table.
Names are also unique case-insensitively, so `Robots` and `robots` cannot exist
as two different tables in the same database.

Use backticks when an identifier would otherwise conflict with a reserved SQL
keyword, type name, or function name.

```camussql
CREATE TABLE `order` (
  `select` STRING NOT NULL,
  `from` STRING
);

SELECT `select`, `from`
FROM `order`;
```

For example, `CASE` and `END` are reserved keywords. Use backticks for a column
named `end`, such as ``SELECT `end` FROM events``.

Backticks escape identifiers only. String literals use single quotes or double
quotes:

```camussql
SELECT "literal text", 'literal text';
```

## Statement Reference

| Area | Page |
| --- | --- |
| Database lifecycle | [Databases](/docs/databases) |
| Recover dropped databases and tables | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Database branching | [Database Branching](/docs/database-branching) |
| Tables, columns, and schema changes | [Tables And Schema](/docs/sql-schema) |
| Database, table, column, and index comments | [Schema Comments](/docs/comment-on) |
| Check and not-null constraints | [Check Constraints](/docs/check-constraints) |
| Column types and literal formats | [Data Types](/docs/data-types) |
| Indexes, covering indexes, and index DDL | [Indexes](/docs/sql-indexes) |
| Inserts, updates, and deletes | [Writing Data](/docs/sql-writes) |
| SELECT, filters, grouping, and ordering | [Querying Data](/docs/sql-queries) |
| Historical `SELECT` snapshots | [Time-Travel Reads](/docs/time-travel-reads) |
| FROM-less SELECT | [FROM-less SELECT](/docs/sql-fromless-select) |
| Query result caching | [Query Result Cache](/docs/query-result-cache) |
| Planner statistics and automatic analyze | [Automatic Analyze](/docs/automatic-analyze) |
| Transactions | [SQL Transactions](/docs/sql-transactions) |
| SHOW, DESCRIBE, and EXPLAIN | [Schema Inspection](/docs/sql-inspection) |
| Parameter placeholders | [SQL Parameters](/docs/sql-parameters) |
| SQL comments | [SQL Comments](/docs/sql-comments) |

## Common Workflow

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

## Query Features

For joins, subqueries, derived tables, grouped aggregate behavior, table hints,
and planner notes, see [Query Features](/docs/query-features).

For utility `SELECT` statements without a table source, see
[FROM-less SELECT](/docs/sql-fromless-select).

For historical read-only snapshots, see
[Time-Travel Reads](/docs/time-travel-reads).

For plan selection and plan inspection, see [Query Planning](/docs/query-planning)
and [Explaining Queries And Commands](/docs/explain). For opt-in caching of
repeated single-table reads, see [Query Result Cache](/docs/query-result-cache).
