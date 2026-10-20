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

A keyword is not case-sensitive. CamusDB stores the name of a database, a table,
a column, and an index in the case you use when you create or rename it. A later
match on that name ignores the case:

```camussql
CREATE TABLE Robots (
  Id OID PRIMARY KEY NOT NULL,
  RobotName STRING NOT NULL
);

INSERT INTO robots (id, robotname) VALUES (GEN_ID(), "R2-D2");
SELECT ROBOTNAME FROM ROBOTS;
```

The result still shows the original names `Robots`, `Id`, and `RobotName`, and
so do `SHOW TABLES`, `SHOW COLUMNS`, and `SHOW CREATE TABLE`. The three spellings
`robots`, `ROBOTS`, and `Robots` all address the same table.

A name is also unique without regard to its case. `Robots` and `robots`
therefore cannot exist as two tables in one database, and one table cannot hold
both `RobotName` and `robotname` as columns.

### Backticks

Use a backtick when an identifier is the same as a reserved keyword, a type
name, or a function name:

```camussql
CREATE TABLE `order` (
  `select` STRING NOT NULL,
  `from` STRING
);

SELECT `select`, `from`
FROM `order`;
```

`CASE` and `END` are reserved. A column with the name `end` therefore needs
``SELECT `end` FROM events``.

## Literals

A backtick quotes an identifier only. A string literal takes a single quotation
mark, or a double one. The two forms are equivalent:

```camussql
SELECT "literal text", 'literal text';
```

See [Data Types](/docs/data-types) for the literal format of every type. That
page includes a temporal value, an array, and an object id.

## Comments

CamusDB accepts both forms of a comment. A comment is valid at any position
where a space is valid: before a statement, between two clauses, or at the end
of a line.

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

A block comment does not nest. The first `*/` closes the comment. A comment
without an end is an error of the parser.

A comment marker inside a string literal is only text:

```camussql
SELECT "not -- a comment" AS value;
```

One point is easy to miss. `--` always starts a comment. `SELECT 10 FROM t --5`
therefore parses as `SELECT 10 FROM t`. Write `10 - -5`, with a space, to
subtract a negative number.

## Map of the statements

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
| Indexes, and a covering index | [Indexes](/docs/sql-indexes) |
| Sequences and identity columns | [Sequences](/docs/sequences) |
| A description on a schema object | [Schema Comments](/docs/comment-on) |
| A stored query | [Views](/docs/views) |
| The stored result of a query | [Materialized Views](/docs/materialized-views) |

### Read and write

| Task | Page |
| --- | --- |
| `INSERT`, `UPDATE`, `DELETE` | [Insert, Update, Delete](/docs/sql-writes) |
| `INSERT ... SELECT` and CTAS | [Copying Query Results](/docs/insert-select-and-ctas) |
| `TRUNCATE`, which empties a table | [Emptying A Table](/docs/truncate-table) |
| `SELECT`, a filter, a group, an order | [SELECT](/docs/sql-queries) |
| A join, a subquery, a derived table | [Joins And Subqueries](/docs/joins-and-subqueries) |
| A historical snapshot | [Time-Travel Reads](/docs/time-travel-reads) |
| A `SELECT` with no table source | [SELECT Without FROM](/docs/sql-fromless-select) |
| A scalar function | [Functions](/docs/functions) |
| Custom C# functions, row triggers, and procedures | [C# Extensions](/docs/csharp-extensions) |
| A vector, and a nearest neighbor search | [Vector Search](/docs/vector-search) |
| The expiry of a row | [Row-Level TTL](/docs/row-level-ttl) |

### Transactions, performance, and inspection

| Task | Page |
| --- | --- |
| `BEGIN`, `COMMIT`, the isolation, the locks | [Transactions In SQL](/docs/sql-transactions) |
| How CamusDB selects a plan | [Query Planning](/docs/query-planning) |
| How you read a plan | [EXPLAIN](/docs/explain) |
| The estimates behind a plan | [SHOW STATISTICS](/docs/show-statistics) |
| A cache for a repeated read | [Result Cache](/docs/query-result-cache) |
| A scan across the cluster | [Distributed Queries](/docs/distributed-queries) |
| The range placement of a table or index | [SHOW RANGES](/docs/show-ranges) |
| Statements that crossed a slow-query threshold | [Slow Query Log](/docs/slow-query-log) |
| A placeholder, and a prepared handle | [Parameters And Prepared Statements](/docs/prepared-statements) |
| A deeply nested generated statement | [Statement Nesting Limit](/docs/statement-nesting-limit) |
| `SHOW`, `DESCRIBE`, `ANALYZE` | [Inspecting The Database](/docs/sql-inspection) |
| A grant and a role | [Authentication And Authorization](/docs/sql-authentication) |
| `SET` and `RESET CLUSTER SETTING` | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |
