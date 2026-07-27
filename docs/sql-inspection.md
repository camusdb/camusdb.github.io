---
sidebar_position: 2.6
---

# Schema Inspection

CamusDB supports SQL inspection commands for databases, tables, columns,
indexes, and query plans.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
SHOW ORPHAN DATABASES;
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW DATABASES` lists registered databases. `SHOW DATABASE` reports the current
database context and its database comment, if one is set.

`SHOW BRANCHES FROM <database>` lists every branch below a database, including
branches of branches. It returns the descendant database name, stable internal
id, depth, immediate parent, and fork timestamp.

`SHOW ANCESTORS FROM <database>` walks the other direction: it returns the
queried database's parent chain, starting with the immediate parent. Root
databases return an empty result set.

`SHOW ORPHAN DATABASES` lists dropped root databases that are still recoverable.
Use the returned `id` with `CREATE DATABASE ... RELINK TO`.

## Tables And Columns

```camussql
SHOW TABLES;
SHOW ORPHAN TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
```

`SHOW ORPHAN TABLES` lists dropped tables in the current database that are still
recoverable. Use the returned `id` with `CREATE TABLE ... RELINK TO`.

`SHOW CREATE TABLE` includes table, column, and secondary-index comments, so it
is the preferred inspection command when you need schema descriptions. See
[Schema Comments](/docs/comment-on).

See [Recover Dropped Objects](/docs/recover-dropped-objects) for the recovery
workflow and retention settings.

## Indexes

```camussql
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

`SHOW INDEXES` includes any covering-index payload columns in the `Include`
column. `SHOW CREATE TABLE` renders `INCLUDE (...)` for inline and standalone
covering indexes so the DDL can be replayed.

## Explain

Inspect a plan with `EXPLAIN`:

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [Explaining Queries And Commands](/docs/explain) for output details.

## Analyze

Refresh planner statistics for a table with `ANALYZE`:

```camussql
ANALYZE robots;
ANALYZE TABLE robots;
```

`ANALYZE` rebuilds table statistics used by the cost model, including
histograms and distinct-value counts. See [Query Planning](/docs/query-planning)
and [Automatic Analyze](/docs/automatic-analyze).
