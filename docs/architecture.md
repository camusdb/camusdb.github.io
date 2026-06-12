---
sidebar_position: 5
---

# Architecture

CamusDB is a NewSQL distributed database. It accepts SQL statements, plans them
against relational schema, maps rows and indexes into key/value entries, and
stores those entries in a distributed transactional storage layer.

You do not need to understand the architecture to use CamusDB. This page gives
operators, application developers, and contributors a shared vocabulary for
what happens under the hood.

CamusDB cluster mode is alpha-quality. Use it for testing and development, not
production workloads.

## Goals

CamusDB is designed around these goals:

- Keep SQL as the user-facing model for schema, queries, writes, indexes, and
  transactions.
- Provide serializable transactions by default, so committed transactions can
  be reasoned about as one valid serial order.
- Run in standalone mode for local development and in cluster mode for
  distributed testing.
- Let multiple nodes accept client traffic while the storage layer routes each
  key to its owning partition.
- Replicate committed storage changes through Raft-backed partitions instead of
  relying on a single primary process.
- Persist committed changes through a write-ahead log so nodes can recover
  after process crashes and restarts.
- Keep relational data and distributed storage concerns separated: SQL remains
  the application contract, while partitioning, consensus, WAL replay, and
  persistence happen below it.

## Overview

A CamusDB process can run as a standalone node or as part of a cluster.

In standalone mode, the process hosts a local embedded
[Kahuna](https://kahunakv.github.io/) storage node. This is the simplest setup
for tutorials, local development, and single-node tests.

In cluster mode, multiple CamusDB processes join through static peer
configuration. Each process can expose the database API. The storage layer
partitions keys across Raft partitions, elects a leader for each partition, and
replicates writes through [Kommander](https://kahunakv.github.io/kommander.github.io/).
If a process receives a request for data owned by another partition leader, the
storage layer routes the work to the node that can coordinate it.

At a high level, every SQL request follows this path:

1. The client sends SQL to any available CamusDB node.
2. CamusDB parses and validates the statement.
3. The query or write executor checks catalog metadata, constraints, indexes,
   and transaction state.
4. Relational rows, indexes, schema metadata, locks, and transaction records are
   encoded as key/value entries.
5. [Kahuna](https://kahunakv.github.io/) coordinates transactional KV reads and
   writes.
6. In cluster mode, [Kommander](https://kahunakv.github.io/kommander.github.io/)
   replicates partition log entries through Raft consensus.
7. Committed entries are materialized into persistent KV storage and can be
   replayed from the WAL during recovery.

## Layers

CamusDB's architecture is organized into layers. Each layer exposes a smaller
contract to the layer above it.

| Layer | Purpose |
| --- | --- |
| SQL interface | Accept SQL statements from clients and tools. |
| Parser and validator | Normalize statements, validate syntax, and reject invalid command inputs. |
| Catalog | Track databases, tables, columns, indexes, constraints, and schema versions. |
| Query and write execution | Plan reads, apply filters, joins, grouping, subqueries, updates, deletes, inserts, and index maintenance. |
| Transaction coordination | Open, commit, and roll back serializable transactions; coordinate cross-partition writes with two-phase commit. |
| KV mapping | Encode rows, indexes, metadata, locks, and transaction state as deterministic key/value entries. |
| Distributed KV storage | Use [Kahuna](https://kahunakv.github.io/) for transactional key/value operations. |
| Consensus and WAL | Use [Kommander](https://kahunakv.github.io/kommander.github.io/) to order replicated partition log entries and recover committed state. |
| Persistent storage | Store materialized KV state and partition WAL data on disk. |

## SQL And Query Layer

The SQL layer gives applications a relational model even though the lower
layers operate on key/value entries.

The query pipeline supports:

- Projections, aliases, scalar expressions, and functions.
- `WHERE` filters, `HAVING`, ordering, `LIMIT`, and `OFFSET`.
- `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`.
- `GROUP BY` over columns or expressions.
- `JOIN`, `INNER JOIN`, and comma join syntax.
- Derived tables.
- Scalar, `IN`, `NOT IN`, and `EXISTS` subqueries.
- Index scans and explicit index hints.

See [Query Features](/docs/query-features) for user-facing examples and
[Functions](/docs/functions) for the scalar function reference.
See [Query Planning](/docs/query-planning) and
[Query Planner Internals](/docs/query-planner-internals) for the planner and
executor pipeline.

## Catalog And Schema

The catalog stores database, table, column, index, and constraint descriptors.
Rows include a schema version so CamusDB can decode stored values against the
schema layout that created them.

Schema metadata is persisted through the same key/value storage layer as user
data. In cluster mode, schema changes are replicated and recovered through the
distributed storage path, so catalog state follows the same durability model as
rows and indexes.

Online schema changes are staged, and lagging nodes can temporarily fence
themselves from normal table work until they catch up to the committed schema
head. This lets schema evolution keep moving without exposing stale schema reads
as normal behavior.

See [Distributed Schema Changes](/docs/distributed-schema) for the cluster DDL
model, staged online schema states, convergence rules, and restart behavior.

## Storage Layer

CamusDB maps relational objects to deterministic KV keys:

- Table rows are stored under row prefixes.
- Unique and non-unique index entries are stored under index prefixes.
- Schema and system metadata are stored under database metadata keys.
- Locks and transaction state are stored as KV entries managed by the
  transactional storage layer.

The KV mapping keeps ordered table and index scans predictable while letting the
distributed storage layer handle routing, partition ownership, replication, and
recovery.

See [Storage](/docs/storage) for the key layout and value encoding details.

## Transactions

CamusDB uses serializable transactions by default. A committed transaction
appears as if it ran in a single serial order with other committed
transactions.

Single-operation requests can be auto-wrapped in a transaction. Clients can
also use explicit transaction handles for multi-statement work.

When a transaction touches keys owned by more than one partition, CamusDB uses
two-phase commit through the storage layer. This keeps cross-partition writes
atomic while preserving the consensus rules of each partition.

See [Serializable Transactions](/docs/serializable-transactions) for examples
and [Distributed Transactions And HLC](/docs/distributed-transactions) for the
cross-partition commit flow and timestamp model.

## Replication And Recovery

In cluster mode, keys are assigned to Raft partitions. Each partition elects a
leader. Writes for that partition are ordered by the leader and replicated
through [Kommander](https://kahunakv.github.io/kommander.github.io/).

The write-ahead log records committed partition log entries before they are
considered durable. On restart, committed log entries are replayed into
[Kahuna](https://kahunakv.github.io/) so the materialized KV store catches up
with the committed history. Checkpoints keep recovery bounded by marking older
committed state as already represented in persistent KV storage.

See [WAL And Recovery](/docs/wal-recovery) for the recovery path and failure
behavior.

## Deployment Shape

CamusDB can be deployed in two modes:

| Mode | Description |
| --- | --- |
| Standalone | One process with an embedded local storage node. Best for development, tutorials, and tests. |
| Cluster | Multiple processes with static peer discovery, partition leaders, replicated WAL entries, and distributed transactional KV storage. |

See [Cluster Mode](/docs/cluster) for startup commands and
[Configuration](/docs/configuration) for active settings.

## Terms

### Cluster

A group of CamusDB nodes configured to communicate with each other and share a
distributed storage layer.

### Node

One running CamusDB process. In cluster mode, each node can expose the database
API and participate in storage replication.

### Partition

A shard of the keyspace owned by the distributed KV layer. Each partition has
its own consensus leadership and log ordering.

### Partition Leader

The node currently responsible for coordinating writes for a partition. Client
requests do not need to know the leader ahead of time; the storage layer routes
work to the owner.

### Consensus

The agreement process used by a partition so replicas commit the same ordered
log entries. CamusDB relies on [Kommander](https://kahunakv.github.io/kommander.github.io/)
for Raft-backed consensus.

### Replication

The process of copying committed partition log entries across nodes so the
cluster can recover committed state after node failures or restarts.

### Write-Ahead Log

The durable ordered log of partition entries. The WAL is the source of recovery
ordering: if a committed entry has not yet been materialized into KV storage,
it can be replayed after restart.

### Transaction

A set of reads and writes committed or rolled back as one unit. CamusDB uses
serializable transactions by default and uses two-phase commit when a
transaction spans multiple partitions.

### Catalog

The metadata that describes databases, tables, columns, indexes, constraints,
and schema versions.

### KV Mapping

The encoding layer that turns relational data into deterministic key/value
entries. This is how SQL rows, indexes, schema metadata, locks, and transaction
records become storage-layer operations.

## What's Next?

Start with [SQL](/docs/sql) and [Query Features](/docs/query-features) for the
user-facing model. Then read [Storage](/docs/storage), [WAL And Recovery](/docs/wal-recovery),
and [Cluster Mode](/docs/cluster) for the lower-level distributed behavior.
