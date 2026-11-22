---
sidebar_position: 2.6
---

# Inspecting the database

Use `SHOW` and `DESCRIBE` to see the schema and the state of a database. For
example, you can check a table before a migration, or find the grants of a user.
This page lists the statements and links to the pages with the details.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
```

`SHOW DATABASES` lists the databases. `SHOW DATABASE` shows the current
database and its comment, if it has one.

### Branches

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES` lists all branches below a database, including branches of
branches. Each row shows the branch name, its internal ID, its depth, its
parent, and the fork time.

`SHOW ANCESTORS` returns the chain of parents, with the nearest parent first.
For a database that isn't a branch, the result is empty.

For more information, see [Database branching](/docs/database-branching).

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

`SHOW TABLES FROM <database>` and `SHOW TABLES IN <database>` list the tables of
another database. The current database doesn't change, and the statement also
works when no database is selected.

With authentication enabled, a database that you can't see returns
`DatabaseDoesntExist`. The result shows only the tables on which you have at
least one privilege.

`SHOW CREATE TABLE` returns DDL that you can run to create the same table. The
output includes the comments, the secondary indexes with their `INCLUDE`
columns, and the foreign keys.

## Views

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;

SHOW MATERIALIZED VIEWS;
SHOW CREATE MATERIALIZED VIEW customer_totals;
```

Views and materialized views don't appear in `SHOW TABLES`.

`SHOW VIEWS` lists the views that you can reach. `SHOW MATERIALIZED VIEWS` also
shows whether each view is populated, and the snapshot of its last refresh.

The `SHOW CREATE` forms print a normalized definition. For example, `SELECT *`
is expanded to the column list. You can run the output to create the same
object. For more information, see [Views](/docs/views) and
[Materialized views](/docs/materialized-views).

`SHOW COLUMNS` and `DESCRIBE` work on views and materialized views.
`SHOW INDEXES` works on materialized views.

## Indexes

```camussql
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

The `Include` column lists the extra columns of a covering index. The `Key`
column gives the SQL key list, including any expressions. For more
information, see [Indexes](/docs/sql-indexes).

## Recoverable objects

```camussql
SHOW ORPHAN DATABASES;
SHOW ORPHAN TABLES;
```

These statements list dropped objects that you can recover. To recover one,
pass its `id` to `CREATE DATABASE ... RELINK TO` or `CREATE TABLE ... RELINK TO`.
For more information, see
[Recover dropped objects](/docs/recover-dropped-objects).

## Grants

```camussql
SHOW GRANTS;
SHOW GRANTS FOR myapp;
```

`SHOW GRANTS` lists your grants. The `FOR` form shows the grants of another
user, and it needs a superuser. For more information, see
[Authentication and authorization](/docs/sql-authentication).

## Query plans

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

For the output, see [EXPLAIN](/docs/explain).

## Statistics

```camussql
SHOW STATISTICS FOR robots;
SHOW STATISTICS FOR TABLE robots;

ANALYZE robots;
ANALYZE TABLE robots;
```

`SHOW STATISTICS` shows the estimates that the planner uses for one table:

1. The row count.
2. The minimum and maximum value of each column.
3. The size of each histogram.
4. The estimated number of distinct values.
5. The entry count of each index.
6. How old the statistics are.

The statement needs `SELECT` on the table. For more information, see
[SHOW STATISTICS](/docs/show-statistics).

`ANALYZE` scans the table, and rebuilds the histograms and the distinct-value
counts. You should run it after a bulk load or a large delete, or when the
estimates don't match the data. Statistics are also refreshed in the
background. For more information, see
[Automatic analyze](/docs/automatic-analyze) and
[Query planning](/docs/query-planning).

## Workload statistics

```camussql
SHOW STATEMENT STATS;
SHOW STATEMENT STATS LIKE '%orders%';
SHOW INDEX USAGE;
SHOW INDEX USAGE FROM orders;
```

[Statement statistics](/docs/statement-stats) groups repeated SQL by shape and
shows the total cost of each shape. Its collection is off by default.
[Index usage](/docs/index-usage) counts the reads and writes of each index. Its
collection is on by default.

Both statements need a superuser. The counters are kept in memory, for one node.

## Extensions

```camussql
SHOW EXTENSIONS;
```

This statement needs a superuser. It lists the extension builds that the node
has loaded, and the extensions installed in the current database. The `status`
column shows one of the following values:

| `status` | Meaning |
| --- | --- |
| `available` | The node has loaded the build, but this database doesn't use it. |
| `installed` | The database uses the build, and it's ready. |
| `missing` | The database uses a build that this node doesn't have. |

To check a deployment, compare `version` and `sha256` on each node. For all
columns, see [C# extensions](/docs/csharp-extensions#inspect-loaded-extensions).

## Range placement

```camussql
SHOW RANGES FROM TABLE robots;
SHOW RANGES FROM INDEX robots@robots_year_idx;
SHOW RANGE FROM TABLE robots FOR ROW ('507f1f77bcf86cd799439011');
```

`SHOW RANGES` shows how this node routes the
[key space](/docs/concepts#key-space) of a table or an index. The key space is
the set of storage keys that hold the rows or the index entries. For each
[span](/docs/concepts#ranges-and-spans) of keys, the result shows the
[partition](/docs/concepts#partition) that serves it, and whether the
partition's [leader](/docs/concepts#leader) is on this node.

For more information, see [SHOW RANGES](/docs/show-ranges).

## Raft partitions

Use `SHOW PARTITIONS` to check which nodes lead or host partitions and to spot
replicas that are falling behind.

```camussql
SHOW PARTITIONS;
```

The result has one row per partition, starting with system partition `0`.
Each row describes what the answering node knows. Run the statement on each
node to compare their views during an election or a placement change.

| Columns | What to check |
| --- | --- |
| `partition_id`, `kind`, `state`, `routing`, `hash_start`, `hash_end`, `generation` | The partition's role, routing range, and map generation. |
| `node`, `leader`, `leader_source`, `leader_is_local`, `hosted_locally` | The answering node, its leader hint, and its local role. `leader_source` is `local` for hosted partitions or `gossip` for hints from peer load reports about unhosted partitions. A NULL leader is unknown. |
| `term`, `commit_index` | The local Raft term and commit frontier. Both are NULL for partitions the node doesn't host. Partition `0` also returns a NULL term. |
| `replication_factor`, `voters`, `learners`, `removing`, `awaiting_placement` | Replica roles and placement status. A factor of `0` with an empty `voters` list means full replication. |
| `log_ops_per_sec`, `wal_queue_depth`, `commit_wait_ms` | The leader's write load, from the local leader or the latest peer report. A zero can indicate a missing report. |
| `max_follower_lag`, `stalled_followers` | The leader's view of follower lag and stalled followers. These metrics are NULL on nodes that don't lead the partition. |

Run the statement directly against a node. It operates independently of
database selection and transaction state. When authentication is enabled, it
requires a superuser. To locate the partition that serves a table or index
span, use [SHOW RANGES](/docs/show-ranges).

## Node state

These `SHOW` statements show the state of the server. With authentication
enabled, they need a superuser. However, any user can see their own rows in
`SHOW QUERIES` and `SHOW CONNECTIONS`.

| Statement | Result | Page |
| --- | --- | --- |
| `SHOW VARIABLES` | The effective configuration, with the default, source, mutability, and scope of each value. | [SHOW VARIABLES](/docs/show-variables) |
| `SHOW ENGINE STATS` | Metrics of the storage and replication layers ([Kahuna](/docs/concepts#kahuna) and [Kommander](/docs/concepts#kommander)), for [Raft](/docs/concepts#raft), the [write-ahead log](/docs/concepts#wal), and storage. | [Engine stats](/docs/engine-stats) |
| `SHOW SLOW QUERIES` | Recent statements on this node that went over the slow-query threshold. | [Slow query log](/docs/slow-query-log) |
| `SHOW QUERIES`, `SHOW CONNECTIONS` | The running statements and the client connections. `CANCEL QUERY` stops a running read. | [Query activity](/docs/query-activity) |
| `SHOW CLUSTER SETTINGS` | The settings that are changed for the full cluster. | [Runtime cluster settings](/docs/runtime-cluster-settings) |

Most of these statements take a `LIKE` filter:

```camussql
SHOW VARIABLES LIKE 'query_result_cache_%';
SHOW ENGINE STATS LIKE 'raft.executor%';
SHOW SLOW QUERIES LIKE '%orders%';
SHOW QUERIES LIKE '%FROM orders%';
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

These statements don't need a selected database.

`SHOW VARIABLES` and `SHOW ENGINE STATS` show the values of one node. To compare
the nodes of a cluster, run them on each node. `SHOW CLUSTER SETTINGS` shows the
same result on all nodes.
