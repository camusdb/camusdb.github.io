---
sidebar_position: 2
---

# SQL overview

You talk to CamusDB in SQL, so the skills, queries, and tools you already use
with a relational database carry over. CamusDB accepts common
[PostgreSQL expression forms](/docs/sql-expression-syntax), such as `::` casts,
so SQL that an ORM or a PostgreSQL tool generates usually needs few changes.
Where CamusDB differs, these pages say so.

The dialect covers what you expect from a relational database, plus a few
additions:

- Schemas with `CHECK` constraints, foreign keys, sequences, identity columns,
  views, and materialized views.
- Queries with inner, outer, and cross joins, subqueries, derived tables,
  aggregates, and `CASE` expressions.
- Writes with `INSERT ... SELECT` and `RETURNING`.
- Serializable transactions, time-travel reads, vector search, row-level TTL,
  roles and grants, and a large library of scalar functions.

This page covers the parts that belong to CamusDB alone and maps each statement
to its page.

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

## Identifiers and case

Keywords are not case-sensitive. CamusDB stores database, table, column, and
index names in the case you use when you create or rename them, and later
lookups ignore case:

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

The result still shows the original names `Robots`, `Id`, and `RobotName`, and
so do `SHOW TABLES`, `SHOW COLUMNS`, and `SHOW CREATE TABLE`. `robots`,
`ROBOTS`, and `Robots` all refer to the same table.

Names are also unique regardless of case, so `Robots` and `robots` cannot be two
tables in the same database, and one table cannot have both `RobotName` and
`robotname` columns.

### Backticks

Use backticks when an identifier matches a reserved keyword, a type name, or a
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

Backticks quote identifiers only. String literals use single or double
quotation marks, and the two forms are equivalent:

```camussql
SELECT "literal text", 'literal text';
```

See [Data Types](/docs/data-types) for the literal format of every type,
including temporal values, arrays, and object ids.

## Comments

CamusDB accepts both line and block comments. A comment is valid anywhere a
space is: before a statement, between clauses, or at the end of a line.

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

Block comments do not nest: the first `*/` closes the comment. An unterminated
comment is a parser error.

A comment marker inside a string literal is just text:

```camussql
SELECT "not -- a comment" AS value;
```

One point is easy to miss: `--` always starts a comment, so
`SELECT 10 FROM t --5` parses as `SELECT 10 FROM t`. To subtract a negative
number, write `10 - -5`, with a space.

## Statement map

### Schema

| Task | Page |
| --- | --- |
| Create and drop a database | [Databases](/docs/databases) |
| Branch a database | [Database Branching](/docs/database-branching) |
| Restore a dropped database or table | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Tables, columns, and `ALTER` | [Tables And Columns](/docs/sql-schema) |
| Column types and literals | [Data Types](/docs/data-types) |
| PostgreSQL-style expression forms | [PostgreSQL Expression Syntax](/docs/sql-expression-syntax) |
| `CHECK` and `NOT NULL` | [Check Constraints](/docs/check-constraints) |
| Parent-child integrity | [Foreign Keys](/docs/foreign-keys) |
| Indexes and covering indexes | [Indexes](/docs/sql-indexes) |
| Sequences and identity columns | [Sequences](/docs/sequences) |
| Descriptions on schema objects | [Schema Comments](/docs/comment-on) |
| A stored query | [Views](/docs/views) |
| A stored query result | [Materialized Views](/docs/materialized-views) |

### Read and write

| Task | Page |
| --- | --- |
| `INSERT`, `UPDATE`, `DELETE` | [Insert, Update, Delete](/docs/sql-writes) |
| `ON CONFLICT`, `UPSERT` | [Skip or Update Conflicting Rows](/docs/sql-writes#on-conflict) |
| `INSERT ... SELECT` and CTAS | [Copying Query Results](/docs/insert-select-and-ctas) |
| `TRUNCATE`, which empties a table | [Emptying A Table](/docs/truncate-table) |
| `SELECT`, filtering, grouping, ordering | [SELECT](/docs/sql-queries) |
| `FOR UPDATE`, `NOWAIT`, `SKIP LOCKED` | [Lock Rows Before Updating Them](/docs/sql-queries#for-update) |
| Joins, subqueries, derived tables | [Joins And Subqueries](/docs/joins-and-subqueries) |
| `UNION`, `INTERSECT`, `EXCEPT`, including `ALL` | [Combine Query Results](/docs/sql-queries#set-operations) |
| A historical snapshot | [Time-Travel Reads](/docs/time-travel-reads) |
| A `SELECT` with no table source | [SELECT Without FROM](/docs/sql-fromless-select) |
| Scalar functions | [Functions](/docs/functions) |
| Custom C# functions, row triggers, and procedures | [C# Extensions](/docs/csharp-extensions) |
| Vectors and nearest neighbor search | [Vector Search](/docs/vector-search) |
| Row expiry | [Row-Level TTL](/docs/row-level-ttl) |

### Transactions, performance, and inspection

| Task | Page |
| --- | --- |
| `BEGIN`, `COMMIT`, isolation, locks | [Transactions In SQL](/docs/sql-transactions) |
| How CamusDB selects a plan | [Query Planning](/docs/query-planning) |
| How to read a plan | [EXPLAIN](/docs/explain) |
| The estimates behind a plan | [SHOW STATISTICS](/docs/show-statistics) |
| Caching repeated reads | [Result Cache](/docs/query-result-cache) |
| Scans across the cluster | [Distributed Queries](/docs/distributed-queries) |
| The range placement of a table or index | [SHOW RANGES](/docs/show-ranges) |
| Statements that crossed a slow-query threshold | [Slow Query Log](/docs/slow-query-log) |
| Placeholders and prepared handles | [Parameters And Prepared Statements](/docs/prepared-statements) |
| A deeply nested generated statement | [Statement Nesting Limit](/docs/statement-nesting-limit) |
| `SHOW`, `DESCRIBE`, `ANALYZE` | [Inspecting The Database](/docs/sql-inspection) |
| Grants and roles | [Authentication And Authorization](/docs/sql-authentication) |
| `SET` and `RESET CLUSTER SETTING` | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |
