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

CamusDB is designed around four core advantages:

- Resilient storage across a cluster.
- Horizontal scale through partitioned data.
- Multi-active availability across cluster nodes.
- Serializable transactions by default.
- SQL for schema design, writes, reads, indexes, and aggregation.

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

## Serializable Transactions

CamusDB uses serializable transactions by default. Even when transactions run
concurrently, CamusDB is designed to preserve the same outcome you would get if
those transactions had run one at a time.

Single-partition writes commit through the owning partition. Cross-partition
writes use two-phase commit, so distributed updates can be coordinated across
partition boundaries.

The SQL layer supports explicit transaction statements:

```sql
BEGIN;
COMMIT;
ROLLBACK;
```

See [Serializable Transactions](/docs/serializable-transactions) for a small
concurrency example.

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

## Standalone Or Clustered

Use standalone mode for development and quick experiments:

```bash
dotnet run --project CamusDB
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
project’s evolution.
