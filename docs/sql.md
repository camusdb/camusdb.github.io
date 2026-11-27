---
sidebar_position: 2
description: "Use familiar SQL with CamusDB. It accepts common PostgreSQL expression forms, so SQL from ORMs and PostgreSQL tools usually needs few changes."
---

# SQL overview

You use CamusDB with SQL. The queries and tools that you use with other
relational databases work in the same way. Common
[PostgreSQL expression forms](/docs/sql-expression-syntax), such as `::` casts,
work in CamusDB. This means that SQL from an ORM or a PostgreSQL tool usually needs few changes.
Where CamusDB is different, these pages say so.

From application code, run SQL with the [.NET](/docs/dotnet-driver),
[TypeScript](/docs/typescript-connector), or [Python](/docs/python-driver)
driver. The drivers bind the values and handle the transport. For interactive
use, use [camus-cli](/docs/camus-cli) or the [Web Console](/docs/web-console).

The dialect includes the following features:

| Area | Features |
| --- | --- |
| Schema | `CHECK` constraints, foreign keys, sequences, identity columns, views, and materialized views |
| Queries | Inner, left, right, and cross joins, subqueries, recursive CTEs, `LATERAL`, `VALUES` lists, aggregates, and window functions |
| Writes | `INSERT ... SELECT`, `UPDATE ... FROM`, `DELETE ... USING`, `ON CONFLICT`, and `RETURNING` |
| Other | Serializable transactions, time-travel reads, vector search, row-level TTL, and users and grants |

The following example creates a table and reads from it:

```camussql
CREATE DATABASE IF NOT EXISTS app;

CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  year INT64 DEFAULT (2024)
);

CREATE INDEX robots_year_idx ON robots (year DESC);

INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), 'R2-D2', 1977);

SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC;
```

This page covers the rules that apply to all statements, and links each
statement to its page.

## Identifiers and case

Keywords aren't case-sensitive. The names of schema objects, such as tables and
columns, are stored in the case that you use when you create or rename them.
Later lookups ignore case:

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), 'R2-D2');
SELECT ROBOTNAME FROM ROBOTS;
```

`robots` and `ROBOTS` refer to the same table as `Robots`. `SHOW` statements,
such as `SHOW CREATE TABLE`, show the original names. In a query result, a column has the name that you wrote in the
select list, for example `ROBOTNAME`.

Two names that differ only in case are the same name. This means that `Robots`
and `robots` can't be two tables in the same database. A table also can't have
both a `RobotName` and a `robotname` column.

### Backticks

Use backticks for an identifier that is a reserved keyword or a type name:

```camussql
CREATE TABLE `order` (
  id INT64 PRIMARY KEY,
  `select` STRING NOT NULL,
  `date` DATE
);

SELECT `select`, `date`
FROM `order`;
```

Some common column names need backticks, for example `date` and `user`.
Keywords such as `END` and `OVER` are also reserved. A column named `end` needs
``SELECT `end` FROM events``.

## Literals

String literals use single or double quotes. The two forms are the same:

```camussql
SELECT "literal text", 'literal text';
```

Note that this is different from PostgreSQL, where double quotes enclose an
identifier. In CamusDB, `"name"` is a string. Use backticks for identifiers.

For the literal format of each type, see [Data types](/docs/data-types).

## Comments

You can use line comments and block comments. A comment can go anywhere that a
space can go:

```camussql
-- A line comment ends at the end of the line.
SELECT id, name
FROM robots
WHERE year >= 1980; -- only newer robots

/*
  A block comment can span lines.
*/
SELECT id, name
FROM robots /* or be inline */
WHERE year < 1980;
```

Block comments don't nest. The first `*/` ends the comment. A block comment
that isn't closed returns `CADB0406`.

A comment marker in a string literal is text:

```camussql
SELECT 'not -- a comment' AS value;
```

`--` starts a comment in all other places. This means that
`SELECT 10 FROM t --5` is read as `SELECT 10 FROM t`. To subtract a negative
number, write `10 - -5`, with a space.

## Statement map

### Schema

| Task | Page |
| --- | --- |
| Create, rename, and drop databases | [Databases](/docs/databases) |
| Branch a database | [Database branching](/docs/database-branching) |
| Restore a dropped database or table | [Recover dropped objects](/docs/recover-dropped-objects) |
| Tables, columns, and `ALTER TABLE` | [Tables and columns](/docs/sql-schema) |
| Column types and literals | [Data types](/docs/data-types) |
| `CHECK` and `NOT NULL` | [Check constraints](/docs/check-constraints) |
| Parent-child integrity | [Foreign keys](/docs/foreign-keys) |
| `CREATE INDEX`, `DROP INDEX`, and covering indexes | [Indexes](/docs/sql-indexes) |
| GIN indexes for JSONB | [JSON indexes](/docs/json#gin-indexes) |
| Sequences and identity columns | [Sequences](/docs/sequences) |
| Descriptions on schema objects | [Schema comments](/docs/comment-on) |
| Column compression and out-of-line storage | [Large values](/docs/storage-layout) |
| A stored query | [Views](/docs/views) |
| A stored query result and `REFRESH MATERIALIZED VIEW` | [Materialized views](/docs/materialized-views) |

### Read and write

| Task | Page |
| --- | --- |
| `SELECT`, filtering, grouping, sorting, and pagination | [SELECT](/docs/sql-queries) |
| Named intermediate queries with `WITH` | [WITH queries](/docs/sql-queries#with-queries) |
| Joins, subqueries, derived tables | [Joins and subqueries](/docs/joins-and-subqueries) |
| `UNION`, `INTERSECT`, `EXCEPT`, including `ALL` | [Combine query results](/docs/sql-queries#set-operations) |
| Ranking, running totals, and comparisons between rows | [Window functions](/docs/sql-queries#window-functions) |
| `FOR UPDATE`, `NOWAIT`, `SKIP LOCKED` | [Lock rows before updating them](/docs/sql-queries#for-update) |
| A `SELECT` that reads no table | [SELECT without FROM](/docs/sql-fromless-select) |
| A historical snapshot | [Time-travel reads](/docs/time-travel-reads) |
| `INSERT`, `UPDATE`, `DELETE`, joined writes, and `LIMIT` on updates and deletes | [Insert, update, delete](/docs/sql-writes) |
| `RETURNING` from inserts, updates, and deletes | [Return changed rows](/docs/sql-writes#returning) |
| `ON CONFLICT`, `UPSERT` | [Skip or update conflicting rows](/docs/sql-writes#on-conflict) |
| `INSERT ... SELECT` and CTAS | [Copying query results](/docs/insert-select-and-ctas) |
| `TRUNCATE`, which empties a table | [TRUNCATE TABLE](/docs/truncate-table) |
| JSONB documents, operators, and updates | [JSON documents](/docs/json) |
| PostgreSQL-style casts, arrays, and expression forms | [PostgreSQL expression syntax](/docs/sql-expression-syntax) |
| Scalar functions | [Functions](/docs/functions) |
| Generate rows with `generate_series` | [Set-returning functions](/docs/functions-set-returning) |
| Inline C# `CREATE FUNCTION` and `CREATE TRIGGER`, extension DLLs, and `CALL` procedures | [C# extensions](/docs/csharp-extensions) |
| Vectors and nearest neighbor search | [Vector search](/docs/vector-search) |
| Row expiry | [Row-level TTL](/docs/row-level-ttl) |

### Transactions, performance, and inspection

| Task | Page |
| --- | --- |
| `BEGIN`, `COMMIT`, `ROLLBACK`, isolation, and locks | [Transactions in SQL](/docs/sql-transactions) |
| Snapshot behavior and isolation guarantees | [Transactions and isolation](/docs/serializable-transactions) |
| Retry a transaction after a conflict | [Retries and conflicts](/docs/serializable-retries) |
| Transaction size and lifetime limits | [Transaction limits](/docs/transaction-limits) |
| `SET TRANSACTION PRIORITY` | [Transaction priority](/docs/transaction-priority) |
| How a plan is selected | [Query planning](/docs/query-planning) |
| How to read a plan | [EXPLAIN](/docs/explain) |
| The estimates behind a plan | [SHOW STATISTICS](/docs/show-statistics) |
| Refresh optimizer statistics with `ANALYZE` | [Automatic analyze](/docs/automatic-analyze) |
| Caching repeated reads | [Query result cache](/docs/query-result-cache) |
| Spill large query buffers to temporary files | [Spill to disk](/docs/spill-to-disk) |
| Scans across the cluster | [Distributed queries](/docs/distributed-queries) |
| Learn routes for repeated SQL | [SQL routing advice](/docs/sql-routing-advice) |
| Partition leaders, replicas, and load with `SHOW PARTITIONS` | [Raft partitions](/docs/sql-inspection#raft-partitions) |
| The range placement of a table or index | [SHOW RANGES](/docs/show-ranges) |
| Active queries, connections, and `CANCEL QUERY` | [Query activity](/docs/query-activity) |
| Open transactions and `KILL TRANSACTION` | [Query activity](/docs/query-activity#open-transactions) |
| Statements that crossed a slow-query threshold | [Slow query log](/docs/slow-query-log) |
| Repeated query costs with `SHOW STATEMENT STATS` | [Statement statistics](/docs/statement-stats) |
| Index reads and writes with `SHOW INDEX USAGE` | [Index usage](/docs/index-usage) |
| Storage and replication metrics with `SHOW ENGINE STATS` | [Engine stats](/docs/engine-stats) |
| Effective configuration with `SHOW VARIABLES` | [SHOW VARIABLES](/docs/show-variables) |
| Placeholders and prepared handles | [Parameters and prepared statements](/docs/prepared-statements) |
| A deeply nested generated statement | [Statement nesting limit](/docs/statement-nesting-limit) |
| List databases, tables, columns, and indexes | [Inspecting the database](/docs/sql-inspection) |
| Users, passwords, `GRANT`, and `REVOKE` | [Authentication and authorization](/docs/sql-authentication) |
| `SET`/`RESET CLUSTER SETTING` and `SHOW CLUSTER SETTINGS` | [Runtime cluster settings](/docs/runtime-cluster-settings) |
