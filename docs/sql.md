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
  aggregates, window functions, and `CASE` expressions.
- Writes with `INSERT ... SELECT` and `RETURNING`.
- Serializable transactions, time-travel reads, vector search, row-level TTL,
  users and grants, and a large library of scalar functions.

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

`CASE`, `END`, and `OVER` are reserved, so a column named `end` needs
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
| Create, rename, and drop databases | [Databases](/docs/databases) |
| Branch a database | [Database Branching](/docs/database-branching) |
| Restore a dropped database or table | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Tables, columns, and `ALTER TABLE` | [Tables And Columns](/docs/sql-schema) |
| Column types and literals | [Data Types](/docs/data-types) |
| `CHECK` and `NOT NULL` | [Check Constraints](/docs/check-constraints) |
| Parent-child integrity | [Foreign Keys](/docs/foreign-keys) |
| `CREATE INDEX`, `DROP INDEX`, and covering indexes | [Indexes](/docs/sql-indexes) |
| GIN indexes for JSONB | [JSON Indexes](/docs/json#gin-indexes) |
| Sequences and identity columns | [Sequences](/docs/sequences) |
| Descriptions on schema objects | [Schema Comments](/docs/comment-on) |
| Column compression and out-of-line storage | [Large Values](/docs/storage-layout) |
| A stored query | [Views](/docs/views) |
| A stored query result and `REFRESH MATERIALIZED VIEW` | [Materialized Views](/docs/materialized-views) |

### Read and write

| Task | Page |
| --- | --- |
| `INSERT`, `UPDATE`, `DELETE`; `LIMIT` on updates and deletes | [Insert, Update, Delete](/docs/sql-writes) |
| `RETURNING` from inserts, updates, and deletes | [Return Changed Rows](/docs/sql-writes#returning) |
| `ON CONFLICT`, `UPSERT` | [Skip or Update Conflicting Rows](/docs/sql-writes#on-conflict) |
| `INSERT ... SELECT` and CTAS | [Copying Query Results](/docs/insert-select-and-ctas) |
| `TRUNCATE`, which empties a table | [Emptying A Table](/docs/truncate-table) |
| `SELECT`, filtering, grouping, sorting, and pagination | [SELECT](/docs/sql-queries) |
| `FOR UPDATE`, `NOWAIT`, `SKIP LOCKED` | [Lock Rows Before Updating Them](/docs/sql-queries#for-update) |
| Ranking, running totals, and comparisons between rows | [Window Functions](/docs/sql-queries#window-functions) |
| Joins, subqueries, derived tables | [Joins And Subqueries](/docs/joins-and-subqueries) |
| `UNION`, `INTERSECT`, `EXCEPT`, including `ALL` | [Combine Query Results](/docs/sql-queries#set-operations) |
| A historical snapshot | [Time-Travel Reads](/docs/time-travel-reads) |
| A `SELECT` with no table source | [SELECT Without FROM](/docs/sql-fromless-select) |
| JSONB documents, operators, and updates | [JSON Documents](/docs/json) |
| PostgreSQL-style casts, arrays, and expression forms | [PostgreSQL Expression Syntax](/docs/sql-expression-syntax) |
| Scalar functions | [Functions](/docs/functions) |
| Generate rows with `generate_series` | [Set-Returning Functions](/docs/functions-set-returning) |
| Custom C# functions, row triggers, and `CALL` procedures | [C# Extensions](/docs/csharp-extensions) |
| Vectors and nearest neighbor search | [Vector Search](/docs/vector-search) |
| Row expiry | [Row-Level TTL](/docs/row-level-ttl) |

### Transactions, performance, and inspection

| Task | Page |
| --- | --- |
| `BEGIN`, `COMMIT`, `ROLLBACK`, isolation, and locks | [Transactions In SQL](/docs/sql-transactions) |
| Snapshot behavior and isolation guarantees | [Transactions And Isolation](/docs/serializable-transactions) |
| Retry a transaction after a conflict | [Retries And Conflicts](/docs/serializable-retries) |
| Transaction size and lifetime limits | [Transaction Limits](/docs/transaction-limits) |
| `SET TRANSACTION PRIORITY` | [Transaction Priority](/docs/transaction-priority) |
| How CamusDB selects a plan | [Query Planning](/docs/query-planning) |
| How to read a plan | [EXPLAIN](/docs/explain) |
| The estimates behind a plan | [SHOW STATISTICS](/docs/show-statistics) |
| Refresh optimizer statistics with `ANALYZE` | [Automatic Analyze](/docs/automatic-analyze) |
| Caching repeated reads | [Result Cache](/docs/query-result-cache) |
| Spill large query buffers to temporary files | [Spill To Disk](/docs/spill-to-disk) |
| Scans across the cluster | [Distributed Queries](/docs/distributed-queries) |
| Learn routes for repeated SQL | [SQL Routing Advice](/docs/sql-routing-advice) |
| The range placement of a table or index | [SHOW RANGES](/docs/show-ranges) |
| Active queries, connections, and `CANCEL QUERY` | [Query Activity](/docs/query-activity) |
| Statements that crossed a slow-query threshold | [Slow Query Log](/docs/slow-query-log) |
| Repeated query costs with `SHOW STATEMENT STATS` | [Statement Statistics](/docs/statement-stats) |
| Index reads and writes with `SHOW INDEX USAGE` | [Index Usage](/docs/index-usage) |
| Storage and replication metrics with `SHOW ENGINE STATS` | [Engine Stats](/docs/engine-stats) |
| Effective configuration with `SHOW VARIABLES` | [SHOW VARIABLES](/docs/show-variables) |
| Placeholders and prepared handles | [Parameters And Prepared Statements](/docs/prepared-statements) |
| A deeply nested generated statement | [Statement Nesting Limit](/docs/statement-nesting-limit) |
| List databases, tables, columns, and indexes | [Inspecting The Database](/docs/sql-inspection) |
| Users, passwords, `GRANT`, and `REVOKE` | [Authentication And Authorization](/docs/sql-authentication) |
| `SET`/`RESET CLUSTER SETTING` and `SHOW CLUSTER SETTINGS` | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |
