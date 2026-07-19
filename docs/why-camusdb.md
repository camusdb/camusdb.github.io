---
sidebar_position: 2
---

# Why CamusDB?

CamusDB is a NewSQL distributed database. It combines a familiar SQL interface
with a distributed transactional storage layer, so applications can keep a
relational data model while running on a multi-node cluster.

CamusDB is alpha-quality software. The advantages below describe the project
direction and the current cluster architecture; do not use CamusDB for
production workloads yet.

## Why Use CamusDB?

CamusDB is designed around several core advantages:

- Resilient storage across a cluster
- Horizontal scale through partitioned data
- Multi-active availability across cluster nodes
- Atomic distributed transactions with committed reads and conflict detection
- Copy-on-write database branching for development, testing, and issue
  reproduction
- Recoverable root database and table drops for catastrophic mistakes
- Transactional SQL for schema design, writes, reads, indexes, and aggregation

## Resilient Distributed Storage

CamusDB cluster mode uses Raft consensus through
[Kommander](https://kahunakv.github.io/kommander.github.io/). Each partition
has its own leader, and writes are replicated through the partition leader. If a
leader changes, the cluster can elect a new leader for that partition.

This gives CamusDB the foundation for highly available storage without making
applications manually coordinate which node owns a piece of data.

See [Storage](/docs/storage) for how tables, rows, indexes, and schema metadata are
mapped onto the distributed key/value layer.

## Multi-Active Availability

CamusDB is designed so applications do not have to treat one process as the only
active database endpoint. In cluster mode, every node can expose the database
API, while partition ownership and leader routing decide where a write is
committed.

The important distinction is that CamusDB does not accept conflicting writes on
independent replicas. It uses consensus-backed partitions so a committed write
has a single agreed-upon outcome. See [Multi-Active Availability](/docs/multi-active-availability).

## Horizontal Scale

CamusDB can start a cluster with multiple Raft partitions. Data is routed to the
partition that owns the target key range, and each partition can elect and use
its own leader.

For local testing, the included Docker Compose setup starts three nodes with
three partitions. For manual deployments, nodes join with `--mode=cluster`, a
static peer list, and an initial partition count.

## Transactions And Concurrency

CamusDB gives applications serializable transactions by default, atomic writes,
committed reads, and conflict detection without requiring them to manage replica
divergence manually.

Single-partition writes commit through the owning partition. Cross-partition
writes use two-phase commit, so distributed updates can be coordinated across
partition boundaries.

The SQL layer supports explicit transaction statements:

```camussql
BEGIN;
COMMIT;
ROLLBACK;
```

See [Transactions And Isolation](/docs/serializable-transactions) for the
current transaction guarantees and tradeoffs.

## Database Branching

CamusDB can create an isolated point-in-time branch of an existing database:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
```

The branch shares the source database's data snapshot until it diverges. Reads
can fall through to the source snapshot, while writes, deletes, and schema
changes stay private to the branch.

This gives developers production-like data for feature work, migration
rehearsals, and hard-to-reproduce issue debugging without writing to the base
database. See [Database Branching](/docs/database-branching).

## Recoverable Drops

CamusDB's normal `DROP DATABASE` and `DROP TABLE` statements are recoverable for
root databases and tables. The dropped object disappears from the active catalog
immediately and the name is free to reuse, but the data is retained as an orphan
for a configurable retention window.

```camussql
DROP TABLE orders;
SHOW ORPHAN TABLES;
CREATE TABLE orders_recovered RELINK TO "A0";
```

This helps in catastrophic situations where a database, table, migration, or
cleanup script removed the wrong object. Instead of restoring a full backup
before anyone can inspect the data, an operator can relink the retained object
under a safe recovery name.

Use `DROP ... FORCE` only when the object should be deleted immediately and
permanently. See [Recover Dropped Objects](/docs/recover-dropped-objects).

## Familiar SQL

CamusDB keeps the application-facing model simple: define tables, add indexes,
write rows, and query with filters, joins, subqueries, derived tables,
ordering, and aggregates.

Supported SQL includes:

- `CREATE TABLE`, `DROP TABLE`, and `ALTER TABLE`.
- `CREATE INDEX`, primary keys, unique indexes, and multi-column indexes.
- `INSERT`, `UPDATE`, and `DELETE`.
- `SELECT` with `WHERE`, joins, subqueries, derived tables, `GROUP BY`,
  `ORDER BY`, `LIMIT`, and `OFFSET`.
- `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`.

See [Query Features](/docs/query-features) for examples.

## Standalone or Clustered

Use standalone mode for development and quick experiments:

```bash
docker run --rm \
        -p 5095:5095 \
        -p 5096:5096 \
        -v camus-data:/data \
        --name camusdb camusdb/camusdb:latest
```

Use cluster mode when you want to test distributed behavior:

```bash
docker compose -f docker/local.yml up --build
```

The SQL shell can connect to a running node:

```bash
camus-cli
```

## Current Scope

CamusDB is early-stage. The current design already includes cluster mode,
partition routing, leader election, replicated storage, SQL execution, and
distributed transaction coordination. Areas such as operational tooling,
production hardening, and richer multi-region controls are still part of the
project's evolution.
