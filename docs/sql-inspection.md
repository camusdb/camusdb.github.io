---
sidebar_position: 2.6
---

# Inspecting the database

`SHOW` and `DESCRIBE` report what the database holds. They cover a database, a
table, a column, an index, and a grant.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
```

`SHOW DATABASES` lists the registered databases. `SHOW DATABASE` reports the
current database, and its comment where you set one.

### Branches

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES` lists every branch below a database. That list includes a branch
of a branch. Each row holds five values: the name of the descendant, its stable
internal id, its depth, its immediate parent, and the time of the fork.

`SHOW ANCESTORS` walks in the other direction. It returns the chain of the
parents, with the nearest one first. A database at the root returns nothing.

See [Database Branching](/docs/database-branching).

## Tables and columns

```camussql
SHOW TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
```

Use `SHOW CREATE TABLE` when you want the whole picture. It is the statement
that renders the comment of the table, of its columns, and of its secondary
indexes. It also replays an `INCLUDE (...)` of a covering index. Its output is
therefore DDL that you can run elsewhere.

## Views

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;

SHOW MATERIALIZED VIEWS;
SHOW CREATE MATERIALIZED VIEW customer_totals;
```

`SHOW TABLES` lists a table only. A view has no row in it, and a materialized
view has no row in it either.

`SHOW VIEWS` lists only the views that the caller can reach.
`SHOW MATERIALIZED VIEWS` also reports two facts about each view: whether it
holds data, and which snapshot it holds.

Both forms of `SHOW CREATE` print the normalized definition. They do not print
the text that you typed. Both outputs parse again into the same object. See
[Views](/docs/views) and [Materialized Views](/docs/materialized-views).

`SHOW COLUMNS` and `DESCRIBE` work on both kinds of view. `SHOW INDEXES` works
on a materialized view, which is a real relation.

## Indexes

```camussql
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

The `Include` column lists the payload columns of a covering index. See
[Indexes](/docs/sql-indexes).

## Recoverable objects

```camussql
SHOW ORPHAN DATABASES;
SHOW ORPHAN TABLES;
```

Both statements list a dropped object that is still recoverable. Pass the `id`
of a row to `CREATE DATABASE ... RELINK TO`, or to `CREATE TABLE ... RELINK TO`.
That statement brings the object back. See
[Recover Dropped Objects](/docs/recover-dropped-objects) for the workflow, and
for the settings of the retention.

## Grants

```camussql
SHOW GRANTS;
SHOW GRANTS FOR myapp;
```

`SHOW GRANTS` lists the grants of the authenticated user. The `FOR` form targets
another user, and it needs the privileges of a superuser. See
[Authentication And Authorization](/docs/sql-authentication).

## The plan of a query

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [EXPLAIN](/docs/explain) for the reference of the output.

## Range placement

```camussql
SHOW RANGES FROM TABLE robots;
SHOW RANGES FROM INDEX robots@robots_year_idx;
SHOW RANGE FROM TABLE robots FOR ROW ("507f1f77bcf86cd799439011");
```

`SHOW RANGES` reports how this node currently routes a table or index key
space. It shows whether the space is hash-routed or key-range-routed, which
partition serves each span, and whether this node believes the leader is local.

See [SHOW RANGES](/docs/show-ranges).

## Statistics

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;

ANALYZE robots;
ANALYZE TABLE robots;
```

`SHOW STATISTICS` prints the current belief of the cost model about one table.
It reports six things:

1. The row count.
2. The bounds of each column.
3. The size of each histogram.
4. The estimates of the distinct values.
5. The count of the entries of each index.
6. The staleness of all of it.

The statement needs `SELECT` on the table only. See
[SHOW STATISTICS](/docs/show-statistics).

`ANALYZE` rebuilds the parts of that picture that need a scan. Those parts are
the histograms and the counts of the distinct values.

Run `ANALYZE` after a bulk load, and after a large delete. Run it when the
estimates of the planner no longer match the data. CamusDB also schedules that
work itself. See [Automatic Analyze](/docs/automatic-analyze) and
[Query Planning](/docs/query-planning).

## The state of a node

Three more `SHOW` statements report on the server, not on your data. All three
need a superuser while authentication is enabled.

| Statement | It reports | Page |
| --- | --- | --- |
| `SHOW VARIABLES` | The effective configuration. Each value carries its default, its source layer, its mutability, and its scope. | [SHOW VARIABLES](/docs/show-variables) |
| `SHOW ENGINE STATS` | The metrics of Kahuna and of Kommander: the workload, Raft, the WAL, and the storage. | [Engine Stats](/docs/engine-stats) |
| `SHOW SLOW QUERIES` | The recent statements that crossed the slow-query threshold on this node. | [Slow Query Log](/docs/slow-query-log) |
| `SHOW CLUSTER SETTINGS` | The settings that the cluster overrides across the fleet. | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |

All three accept a `LIKE` filter:

```camussql
SHOW VARIABLES LIKE "query_result_cache_%";
SHOW ENGINE STATS LIKE 'raft.executor%';
SHOW SLOW QUERIES LIKE '%orders%';
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

None of the three needs a selected database.

`SHOW VARIABLES` and `SHOW ENGINE STATS` are local to one node. Run them against
each node when you compare a cluster. `SHOW CLUSTER SETTINGS` reports the
replicated overlay. It reads the same on every node.
