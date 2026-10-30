---
sidebar_position: 2.6
---

# Inspecting the database

`SHOW` and `DESCRIBE` report what the database holds: databases, tables,
columns, indexes, and grants.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
```

`SHOW DATABASES` lists the registered databases. `SHOW DATABASE` reports the
current database and its comment, if you set one.

### Branches

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES` lists every branch below a database, including branches of
branches. Each row holds the descendant's name, its stable internal id, its
depth, its immediate parent, and the fork time.

`SHOW ANCESTORS` walks the other way and returns the parent chain, nearest
first. A root database returns nothing.

See [Database Branching](/docs/database-branching).

## Extensions

```camussql
SHOW EXTENSIONS;
```

This superuser-only statement reports builds loaded by the serving node and
extensions installed in the current database. Check `status`: `available`
means loaded but not selected by this database, `installed` means ready to use,
and `missing` means the node cannot run the database's selected build. Compare
`version` and `sha256` across nodes when checking a deployment.

See [C# extensions](/docs/csharp-extensions#inspect-loaded-extensions) for
all result columns and upgrade instructions.

## Tables and columns

```camussql
SHOW TABLES;
SHOW TABLES FROM application;
SHOW TABLES IN application LIKE 'order%';
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
```

`SHOW TABLES FROM <database>` and `SHOW TABLES IN <database>` inspect a named
database without changing the current database. They work even when the session
has no current database. With authentication enabled, an invisible target is
reported as `DatabaseDoesntExist`, and the result includes only tables on which
the caller has at least one privilege.

Use `SHOW CREATE TABLE` when you want the whole picture. It renders the
comments on the table, its columns, and its secondary indexes, replays covering
index `INCLUDE (...)` clauses, and renders public foreign keys. So its output is
DDL you can run elsewhere.

## Workload statistics

```camussql
SHOW STATEMENT STATS;
SHOW STATEMENT STATS LIKE '%orders%';
SHOW INDEX USAGE;
SHOW INDEX USAGE FROM orders;
```

[Statement statistics](/docs/statement-stats) group repeated SQL shapes to
show cumulative cost; collection is off by default.
[Index usage](/docs/index-usage) counts query reads, constraint checks, and
index writes; collection is on by default. Both statements require a
superuser and report node-local, in-memory counters.

## Views

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;

SHOW MATERIALIZED VIEWS;
SHOW CREATE MATERIALIZED VIEW customer_totals;
```

`SHOW TABLES` lists only tables. Views and materialized views do not appear in
it.

`SHOW VIEWS` lists only the views the caller can reach.
`SHOW MATERIALIZED VIEWS` also reports whether each view holds data, and which
snapshot it holds.

Both `SHOW CREATE` forms print the normalized definition, not the text you
typed, and both outputs parse back into the same object. See
[Views](/docs/views) and [Materialized Views](/docs/materialized-views).

`SHOW COLUMNS` and `DESCRIBE` work on both kinds of view. `SHOW INDEXES` works
on materialized views, which are real relations.

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

Both statements list dropped objects that are still recoverable. To bring one
back, pass a row's `id` to `CREATE DATABASE ... RELINK TO` or
`CREATE TABLE ... RELINK TO`. See
[Recover Dropped Objects](/docs/recover-dropped-objects) for the workflow and
the retention settings.

## Grants

```camussql
SHOW GRANTS;
SHOW GRANTS FOR myapp;
```

`SHOW GRANTS` lists the authenticated user's grants. The `FOR` form targets
another user and requires superuser privileges. See
[Authentication And Authorization](/docs/sql-authentication).

## Query plans

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [EXPLAIN](/docs/explain) for the output reference.

## Range placement

```camussql
SHOW RANGES FROM TABLE robots;
SHOW RANGES FROM INDEX robots@robots_year_idx;
SHOW RANGE FROM TABLE robots FOR ROW ('507f1f77bcf86cd799439011');
```

`SHOW RANGES` reports how this node currently routes the
[key space](/docs/concepts#key-space) of a table or index (the storage keys that
hold its rows or entries). It shows whether the space is
[hash-routed or key-range-routed](/docs/concepts#hash-and-key-range-routing),
which [partition](/docs/concepts#partition) serves each
[span](/docs/concepts#ranges-and-spans) (a contiguous range of keys), and whether
this node believes the partition's [leader](/docs/concepts#leader) is local.

See [SHOW RANGES](/docs/show-ranges).

## Statistics

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;

ANALYZE robots;
ANALYZE TABLE robots;
```

`SHOW STATISTICS` prints what the cost model currently believes about one
table:

1. The row count.
2. Each column's bounds.
3. Each histogram's size.
4. Distinct-value estimates.
5. Each index's entry count.
6. How stale all of it is.

The statement needs only `SELECT` on the table. See
[SHOW STATISTICS](/docs/show-statistics).

`ANALYZE` rebuilds the parts of that picture that need a scan: the histograms
and the distinct-value counts.

Run `ANALYZE` after a bulk load or a large delete, or when the planner's
estimates no longer match the data. CamusDB also schedules this work itself.
See [Automatic Analyze](/docs/automatic-analyze) and
[Query Planning](/docs/query-planning).

## Node state

These `SHOW` statements report on the server, not your data. While
authentication is enabled they require a superuser, except for query activity
rows owned by the current user.

| Statement | It reports | Page |
| --- | --- | --- |
| `SHOW VARIABLES` | The effective configuration, with each value's default, source layer, mutability, and scope. | [SHOW VARIABLES](/docs/show-variables) |
| `SHOW ENGINE STATS` | Storage and replication layer metrics ([Kahuna](/docs/concepts#kahuna) and [Kommander](/docs/concepts#kommander)): workload, [Raft](/docs/concepts#raft) replication, the [write-ahead log](/docs/concepts#wal), and storage. | [Engine Stats](/docs/engine-stats) |
| `SHOW SLOW QUERIES` | Recent statements on this node that crossed the slow-query threshold. | [Slow Query Log](/docs/slow-query-log) |
| `SHOW QUERIES`, `SHOW CONNECTIONS` | Currently active statements and client connections, with `CANCEL QUERY` for running reads. | [Query Activity](/docs/query-activity) |
| `SHOW CLUSTER SETTINGS` | Settings overridden cluster-wide across the fleet. | [Runtime Cluster Settings](/docs/runtime-cluster-settings) |

Most of these statements accept a `LIKE` filter:

```camussql
SHOW VARIABLES LIKE 'query_result_cache_%';
SHOW ENGINE STATS LIKE 'raft.executor%';
SHOW SLOW QUERIES LIKE '%orders%';
SHOW QUERIES LIKE '%FROM orders%';
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

None of these statements needs a selected database.

`SHOW VARIABLES` and `SHOW ENGINE STATS` are local to one node, so run them
against each node when you compare a cluster. `SHOW CLUSTER SETTINGS` reports
the cluster-wide overrides that every node shares, so it reads the same on every
node.
