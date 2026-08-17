---
sidebar_position: 2.6
---

# Inspecting The Database

`SHOW` and `DESCRIBE` answer "what is actually in here?" for databases, tables,
columns, indexes, and grants.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
```

`SHOW DATABASES` lists registered databases. `SHOW DATABASE` reports the current
database context and its comment, if one is set.

### Branches

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES` lists every branch below a database, including branches of
branches, returning the descendant name, stable internal id, depth, immediate
parent, and fork timestamp. `SHOW ANCESTORS` walks the other direction and
returns the parent chain, nearest first; a root database returns nothing.

See [Database Branching](/docs/database-branching).

## Tables And Columns

```camussql
SHOW TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
```

Reach for `SHOW CREATE TABLE` when you want the whole picture. It is the one
that renders comments on the table, its columns, and its secondary indexes, and
it replays `INCLUDE (...)` for covering indexes, so its output is DDL you can
run elsewhere.

## Views

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;

SHOW MATERIALIZED VIEWS;
SHOW CREATE MATERIALIZED VIEW customer_totals;
```

`SHOW TABLES` lists tables only; neither views nor materialized views have their
own row in it. `SHOW VIEWS` lists only what the caller can reach, and
`SHOW MATERIALIZED VIEWS` also reports whether each one holds data and which
snapshot it holds. Both `SHOW CREATE` forms print the normalized definition
rather than the text you typed, and both re-parse to the same object. See
[Views](/docs/views) and [Materialized Views](/docs/materialized-views).

`SHOW COLUMNS` and `DESCRIBE` work on either kind; `SHOW INDEXES` works on a
materialized view, which is a real relation.

## Indexes

```camussql
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

The `Include` column lists covering-index payload columns. See
[Indexes](/docs/sql-indexes).

## Recoverable Objects

```camussql
SHOW ORPHAN DATABASES;
SHOW ORPHAN TABLES;
```

Both list dropped objects that are still recoverable. Pass the returned `id` to
`CREATE DATABASE ... RELINK TO` or `CREATE TABLE ... RELINK TO` to bring one
back. See [Recover Dropped Objects](/docs/recover-dropped-objects) for the
workflow and retention settings.

## Grants

```camussql
SHOW GRANTS;
SHOW GRANTS FOR myapp;
```

`SHOW GRANTS` lists the current authenticated user's grants. The `FOR` form
targets another user and requires superuser privileges. See
[Authentication And Authorization](/docs/sql-authentication).

## Query Plans

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [EXPLAIN](/docs/explain) for the output reference.

## Statistics

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;

ANALYZE robots;
ANALYZE TABLE robots;
```

`SHOW STATISTICS` prints what the cost model currently believes about one table:
row count, per-column bounds, histogram sizes, distinct-value estimates,
per-index entry counts, and how stale all of it is. It needs only `SELECT` on
the table. See [SHOW STATISTICS](/docs/show-statistics).

`ANALYZE` rebuilds the parts of that picture a scan has to produce, meaning
histograms and distinct-value counts. Run it after a bulk load or a large
delete, when the planner's estimates no longer match the data. CamusDB also
schedules this work itself; see [Automatic Analyze](/docs/automatic-analyze) and
[Query Planning](/docs/query-planning).

## Node-Level State

Three more `SHOW` commands report on the server rather than on your data. All
three require a superuser when authentication is enabled.

| Command | Reports | Page |
| --- | --- | --- |
| `SHOW VARIABLES` | Effective configuration, with each value's default, source layer, mutability, and scope. | [SHOW VARIABLES](/docs/show-variables) |
| `SHOW ENGINE STATS` | Kahuna and Kommander metrics: workload, Raft, WAL, storage. | [Engine Stats](/docs/engine-stats) |
| `SHOW CLUSTER SETTINGS` | The settings the cluster currently overrides fleet-wide. | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |

All three accept a `LIKE` filter:

```camussql
SHOW VARIABLES LIKE "query_result_cache_%";
SHOW ENGINE STATS LIKE 'raft.executor%';
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

None of them require a selected database. `SHOW VARIABLES` and
`SHOW ENGINE STATS` are node-local, so run them against each node when comparing
a cluster; `SHOW CLUSTER SETTINGS` reports the replicated overlay and reads the
same on every node.
