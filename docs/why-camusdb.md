---
sidebar_position: 2
---

# Why CamusDB?

CamusDB is a NewSQL distributed database. It combines a full relational engine
with a distributed transactional storage layer. An application can therefore
keep a relational model of its data, while it runs on a cluster of several
nodes.

CamusDB is not a thin layer of SQL over a key/value store. It has these parts of
its own:

- A parser of SQL, and a cost-based query planner.
- An executor with a join, an aggregate, and a sort.
- A system of secondary indexes, with the statistics of a table.
- A write-ahead log, and a recovery after a crash.
- A coordinator of a distributed transaction.

CamusDB is in production use. Some features are nevertheless alpha features. The
APIs and the storage formats can change between versions.

## Why you use CamusDB

The design of CamusDB gives these advantages:

- Storage that survives a failure, across a cluster.
- Horizontal scale, through data in partitions.
- Availability from several active nodes of a cluster.
- Atomic distributed transactions, with committed reads and with the detection
  of a conflict.
- Transactional SQL, for the design of a schema, a write, a read, an index, and
  an aggregation.
- A [cost-based query planner](/docs/query-planning), with `EXPLAIN`, collected
  statistics, an automatic analyze, and a cache of the results.
- A [view](/docs/views), a [materialized view](/docs/materialized-views), a
  [prepared statement](/docs/prepared-statements), and a
  [row-level TTL](/docs/row-level-ttl).
- [Vector search](/docs/vector-search) over an embedding, for a workload of
  artificial intelligence.
- A [time travel read](/docs/time-travel-reads), which reads the data at a point
  in the past.
- A branch of a database, with a copy at the first write. Use it for
  development, for a test, and for the reproduction of a problem.
- A recoverable drop of a root database, and of a table, after a catastrophic
  mistake.
- Many interfaces, from a shell of SQL to a server for the Model Context
  Protocol. See [the ways to connect](#the-ways-to-connect).

## Distributed storage that survives a failure

Cluster mode uses the Raft consensus, through
[Kommander](https://kahunakv.github.io/kommander.github.io/). Each partition has
its own leader. CamusDB replicates a write through that leader. The cluster can
elect a new leader for a partition after a change of the leadership.

CamusDB therefore has the foundation of storage with high availability. An
application does not coordinate the owner of a piece of data by hand.

See [Storage](/docs/storage) for the map of a table, a row, an index, and the
schema metadata onto the distributed key/value layer.

## Availability from several active nodes

The design of CamusDB removes one problem for an application. That application
does not treat one process as the only active endpoint of the database.

In cluster mode, every node can expose the API of the database. The ownership of
a partition, and the route to a leader, decide the position of a commit.

One distinction matters. CamusDB does not accept a conflicting write on two
independent replicas. It uses partitions that a consensus supports. A committed
write therefore has one agreed outcome. See [Cluster Mode](/docs/cluster).

## Horizontal scale

CamusDB can start a cluster with several Raft partitions. It routes the data to
the partition that owns the range of the target key. Each partition can elect
its own leader, and it can use that leader.

For a local test, the included setup of Docker Compose starts three nodes, with
three partitions. For a deployment by hand, a node joins with `--mode=cluster`,
a static list of the peers, and an initial count of the partitions.

## Transactions and concurrency

CamusDB gives an application serializable transactions by default. It also gives
atomic writes, committed reads, and the detection of a conflict. The application
does not manage a divergence between two replicas by hand.

A write inside one partition commits through the owner of that partition. A
write across two partitions uses two-phase commit. CamusDB can therefore
coordinate an update across the boundary of a partition.

The SQL layer supports an explicit statement of a transaction:

```camussql
BEGIN;
COMMIT;
ROLLBACK;
```

See [Transactions And Isolation](/docs/serializable-transactions) for the
current guarantees of a transaction, and for the trades.

## A branch of a database

CamusDB can create an isolated branch of an existing database, at a point in
time:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
```

The branch shares the snapshot of the data of the source database, until it
diverges. A read can fall through to the snapshot of the source. A write, a
delete, and a change of the schema all stay private to the branch.

A developer therefore receives data that is like the data of production. Use a
branch for three purposes: the work on a feature, a rehearsal of a migration, and
the debug of a problem that is hard to reproduce. You write nothing to the base
database. See [Database Branching](/docs/database-branching).

## A recoverable drop

The ordinary `DROP DATABASE` and `DROP TABLE` statements are recoverable, for a
root database and for a table.

The dropped object disappears from the active catalog immediately, and you can
use its name again. CamusDB nevertheless keeps the data as an orphan, for a
configurable window of the retention.

```camussql
DROP TABLE orders;
SHOW ORPHAN TABLES;
CREATE TABLE orders_recovered RELINK TO "A0";
```

That behavior helps in a catastrophic situation. A person removed the wrong
object. A migration, and a script of a cleanup, can do the same.

An operator does not restore a full backup first. Nobody waits to inspect the
data. The operator relinks the retained object instead, under a safe name for
the recovery.

Use `DROP ... FORCE` only when CamusDB must delete the object immediately and
permanently. See [Recover Dropped Objects](/docs/recover-dropped-objects).

## Familiar SQL

CamusDB keeps the model simple for an application. You define a table. You add an
index. You write a row. You then query with a filter, a join, a subquery, a
derived table, an order, and an aggregate.

The supported SQL includes these statements:

- `CREATE TABLE`, `DROP TABLE`, and `ALTER TABLE`. A column takes a default, a
  `NOT NULL`, and a `CHECK` constraint.
- `CREATE INDEX`, a primary key, a unique index, and an index over several
  columns. CamusDB also supports a covering index.
- `INSERT`, `UPDATE`, `DELETE`, `INSERT INTO ... SELECT`, and
  `CREATE TABLE AS SELECT`.
- A `SELECT` with a `WHERE`, a join, a subquery, a derived table, a `GROUP BY`,
  a `HAVING`, an `ORDER BY`, a `LIMIT`, and an `OFFSET`.
- A `SELECT` without a `FROM`, and a `CASE` expression.
- `CREATE VIEW` and `CREATE MATERIALIZED VIEW`.
- `BEGIN`, `COMMIT`, and `ROLLBACK`.
- `EXPLAIN`, `SHOW`, `ANALYZE`, and `COMMENT ON`.
- `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`.
- More than 60 built-in functions, for a string, a number, a date, a JSON
  value, a regular expression, a UUID, and an ObjectId.

The type system is rich. It includes an integer, a float of two widths, a
string, and a boolean. It also includes a date, a datetime, a UUID, an ObjectId,
an array, and a value of bytes. See [Data Types](/docs/data-types).

See [SELECT](/docs/sql-queries),
[Joins And Subqueries](/docs/joins-and-subqueries), and
[Functions](/docs/functions) for some examples.

## The query planner

CamusDB does not execute a query in the order of its text. It builds a plan, and
it selects that plan by cost.

The planner collects the statistics of a table, and it can run an analyze on its
own. It then picks an index, an order of a join, and a strategy for an
aggregate. `EXPLAIN` prints the chosen plan, with the cost of each node.

A large sort, a hash join, a `GROUP BY`, and a `DISTINCT` can spill to disk. The
memory of the process therefore does not grow without a bound.

See [Query Planning](/docs/query-planning), [EXPLAIN](/docs/explain), and
[Spill To Disk](/docs/spill-to-disk).

## Vector search and a time travel read

CamusDB stores an embedding in a column of bytes. It compares two embeddings
with a distance function, and the CPU accelerates that function. An application
can therefore run a search of similarity next to its relational data. See
[Vector Search](/docs/vector-search).

CamusDB also reads the data at a point in the past:

```camussql
SELECT * FROM orders AS OF SYSTEM TIME '2026-08-01T00:00:00Z';
```

Use that read for an audit, for a report, and for the comparison of a state
before a change with the state after it. See
[Time Travel Reads](/docs/time-travel-reads).

## The ways to connect

An application reaches CamusDB through several interfaces:

| Interface | Purpose |
| --- | --- |
| [`camus-cli`](/docs/camus-cli) | The interactive shell of SQL. |
| [Web console](/docs/web-console) | A browser client for a query and for the schema. |
| [HTTP API](/docs/http-api) | A JSON API over HTTP. |
| [gRPC API](/docs/grpc-api) | A binary API with a streamed result. |
| [.NET driver](/docs/dotnet-driver) | An ADO.NET provider for a .NET application. |
| [EF Core provider](/docs/ef-core) | An object-relational mapper for .NET. |
| [MCP server](/docs/mcp-server) | A server for the Model Context Protocol, for an agent of artificial intelligence. |

CamusDB also ships [`camus-dump`](/docs/camus-dump) for a backup, and
[`workload`](/docs/workload-utility) for a test of the performance.

## Standalone, or in a cluster

Use standalone mode for development, and for a quick experiment:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

Docker is also available, when you want a node in a container.

Use cluster mode when you want to test the distributed behavior:

```bash
docker compose -f docker/local.yml up --build
```

The shell of SQL can connect to a node that runs:

```bash
camus-cli
```

## Current scope

The engine of CamusDB is complete for a wide class of workload. It already
includes these parts:

- Cluster mode, the route to a partition, the election of a leader, and
  replicated storage.
- A parser of SQL, a cost-based planner, and an executor with a join, an
  aggregate, and a sort.
- Secondary indexes, a covering index, and the statistics of a table.
- The coordination of a distributed transaction, with two-phase commit.
- A write-ahead log, a recovery after a crash, and a spill to disk.
- A view, a materialized view, a prepared statement, a vector search, and a time
  travel read.

Three areas are still part of the evolution of the project: the tools of an
operator, the hardening for production, and richer controls across several
regions.
