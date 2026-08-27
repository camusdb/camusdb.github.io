---
sidebar_position: 5
---

# Architecture

CamusDB is a NewSQL distributed database. It accepts a SQL statement. It plans
that statement against a relational schema. It maps the rows and the indexes
into key/value entries. It stores those entries in a distributed transactional
storage layer.

You do not need this page to use CamusDB. The page gives an operator, an
application developer, and a contributor one shared vocabulary for the work
under the surface.

CamusDB is in production use. Cluster mode is nevertheless an alpha feature. The
APIs and the storage formats can change between versions.

One idea organizes the design: a clean split. SQL is the contract with the
application. Four mechanisms happen below that contract: the partitions, the
consensus, the WAL replay, and the persistence. No layer above the KV mapping
knows which node owns a key. No layer below the KV mapping knows what a table
is.

## Overview

A CamusDB process runs as a standalone node, or as one node of a cluster.

In standalone mode, the process hosts one local embedded
[Kahuna](https://kahunakv.github.io/) storage node. That is the simplest setup
for a tutorial, for local development, and for a single-node test.

In cluster mode, several CamusDB processes join through a static configuration
of peers. Each process can expose the database API.

The storage layer divides the keys across Raft partitions. It elects a leader
for each partition. It replicates a write through
[Kommander](https://kahunakv.github.io/kommander.github.io/). A process can
receive a request for data that another partition leader owns. The storage layer
then routes the work to the node that can coordinate it.

At a high level, every SQL request follows this path:

1. The client sends SQL to any available CamusDB node. It uses the HTTP API, the
   gRPC API, or an official client or tool.
2. CamusDB parses the statement. It then validates the statement.
3. The query executor or the write executor checks four things: the catalog
   metadata, the constraints, the indexes, and the state of the transaction.
4. CamusDB encodes the relational rows, the indexes, the schema metadata, the
   locks, and the transaction records as key/value entries.
5. [Kahuna](https://kahunakv.github.io/) coordinates the transactional KV reads
   and writes.
6. In cluster mode,
   [Kommander](https://kahunakv.github.io/kommander.github.io/) replicates the
   partition log entries through Raft consensus.
7. CamusDB materializes a committed entry into persistent KV storage. It can
   also replay that entry from the WAL during a recovery.

## Layers

The architecture of CamusDB has layers. Each layer exposes a smaller contract to
the layer above it.

| Layer | Purpose |
| --- | --- |
| Client interfaces | Accept SQL and row operations from a client and from a tool, through REST with JSON, and through gRPC. |
| Parser and validator | Normalize a statement, validate its syntax, and reject an invalid command input. |
| Catalog | Track the databases, the tables, the columns, the indexes, the constraints, and the schema versions. |
| Query and write execution | Plan a read. Apply the filters, the joins, the groups, and the subqueries. Perform an update, a delete, and an insert. Maintain the indexes. |
| Transaction coordination | Open, commit, and roll a transaction back. Coordinate a write across partitions with two-phase commit. |
| KV mapping | Encode a row, an index, the metadata, a lock, and the transaction state as deterministic key/value entries. |
| Distributed KV storage | Use [Kahuna](https://kahunakv.github.io/) for transactional key/value operations. |
| Consensus and WAL | Use [Kommander](https://kahunakv.github.io/kommander.github.io/) to order the replicated partition log entries, and to recover the committed state. |
| Persistent storage | Store the materialized KV state and the partition WAL data on disk. |

## The SQL and query layer

The SQL layer gives an application a relational model. The layers below it
operate on key/value entries.

The query pipeline supports these features:

- Projections, aliases, scalar expressions, and functions.
- A `WHERE` filter, `HAVING`, an order, `LIMIT`, and `OFFSET`.
- `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`.
- `GROUP BY` over a column or over an expression.
- `JOIN`, `INNER JOIN`, and the comma syntax for a join.
- A derived table.
- A scalar subquery, and an `IN`, `NOT IN`, or `EXISTS` subquery.
- An index scan, and an explicit index hint.

See [SELECT](/docs/sql-queries) and
[Joins And Subqueries](/docs/joins-and-subqueries) for examples that a user
writes. See [Functions](/docs/functions) for the reference of the scalar
functions. See [Query Planning](/docs/query-planning) and
[Query Planner Internals](/docs/query-planner-internals) for the pipeline of the
planner and of the executor.

## Catalog and schema

The catalog stores the descriptors of a database, a table, a column, an index,
and a constraint. A row includes a schema version. CamusDB therefore decodes a
stored value against the schema layout that created it.

You register a database explicitly before you use it. Each database name
resolves to an immutable internal id. A storage key and a standalone data
directory use that id, not the display name. `RENAME DATABASE` updates the
binding in the registry. It moves no row, no index, no schema, and no statistics
data.

CamusDB persists the schema metadata through the same key/value storage layer as
the user data. In cluster mode, it replicates and recovers a schema change
through the distributed storage path. The state of the catalog therefore follows
the same durability model as the rows and the indexes.

CamusDB stages an online schema change. A node that lags can fence itself from
normal table work until it reaches the committed schema head. The schema can
therefore continue to evolve. A stale schema read never becomes normal behavior.

See [Distributed Schema Changes](/docs/distributed-schema) for four subjects:
the DDL model of a cluster, the staged states of an online schema change, the
rules of convergence, and the behavior after a restart.

## The storage layer

CamusDB maps a relational object to a deterministic KV key:

- It stores a table row under a row prefix.
- It stores a unique index entry and a non-unique index entry under an index
  prefix.
- It stores the schema metadata and the system metadata under the metadata keys
  of the database.
- It stores a lock and the transaction state as KV entries. The transactional
  storage layer manages them.

The KV mapping keeps an ordered table scan and an ordered index scan
predictable. The distributed storage layer meanwhile handles the routing, the
partition ownership, the replication, and the recovery.

See [Storage](/docs/storage) for the key layout and for the details of the value
encoding.

## Transactions

CamusDB runs SQL work inside a transaction. It uses Kahuna for MVCC, for the
locks, and for the coordination of a commit.

CamusDB can wrap a single-operation request in a transaction automatically. A
client can also use an explicit transaction handle for work of several
statements.

A transaction can touch keys that more than one partition owns. CamusDB then
uses two-phase commit, through the storage layer. A write across partitions
therefore stays atomic. Each partition also keeps its own rules of consensus.

See [Transactions And Isolation](/docs/serializable-transactions) for the
current guarantees to a user. See
[Distributed Transactions And HLC](/docs/distributed-transactions) for the
commit flow across partitions, and for the model of the timestamps.

## Replication and recovery

In cluster mode, CamusDB assigns each key to a Raft partition. Each partition
elects a leader. That leader orders the writes of its partition.
[Kommander](https://kahunakv.github.io/kommander.github.io/) then replicates
them.

The write-ahead log records a committed partition log entry. Only then is the
entry durable.

At a restart, CamusDB replays the committed log entries into
[Kahuna](https://kahunakv.github.io/). The materialized KV store therefore
catches up with the committed history. A checkpoint bounds the recovery. It
marks older committed state as present in the persistent KV storage already.

See [WAL And Recovery](/docs/wal-recovery) for the recovery path, and for the
behavior after a failure.

## Shape of a deployment

You can deploy CamusDB in two modes:

| Mode | Description |
| --- | --- |
| Standalone | One process, with an embedded local storage node. It is the best choice for development, for a tutorial, and for a test. |
| Cluster | Several processes, with static discovery of the peers, a leader for each partition, replicated WAL entries, and distributed transactional KV storage. |

See [Cluster Mode](/docs/cluster) for the startup commands. See
[Configuration](/docs/configuration) for the active settings.

## Terms

| Term | Meaning |
| --- | --- |
| Node | One CamusDB process that runs. In cluster mode, each node can expose the database API, and each node can take part in the replication. |
| Cluster | A group of nodes that you configured to reach each other, and that share one distributed storage layer. |
| Partition | A shard of the key space that the distributed KV layer owns. It has its own leadership for the consensus, and its own order of the log. |
| Partition leader | The node that coordinates the writes of a partition at present. A client does not need to know which node that is, because the storage layer routes the work to the owner. |
| Consensus | The process of agreement that makes the replicas of a partition commit the same ordered log entries. CamusDB uses [Kommander](https://kahunakv.github.io/kommander.github.io/) for Raft. |
| Replication | The copy of the committed partition log entries across the nodes. The committed state therefore survives a node failure and a restart. |
| Write-ahead log | The durable ordered log of the partition entries. It is the source of the order during a recovery. CamusDB can replay a committed entry after a restart, if it did not materialize that entry into the KV storage yet. |
| Transaction | A set of reads and writes that CamusDB commits or rolls back as one unit. A transaction across several partitions starts a two-phase commit. |
| Catalog | The metadata that describes the databases, the tables, the columns, the indexes, the constraints, and the schema versions. |
| KV mapping | The encoding layer. It turns a row, an index, the schema metadata, a lock, and a transaction record into deterministic key/value entries. |

## What is next

Start with [SQL Overview](/docs/sql) and [SELECT](/docs/sql-queries) for the
model that a user sees. Then read [Storage](/docs/storage),
[WAL And Recovery](/docs/wal-recovery), and [Cluster Mode](/docs/cluster) for
the distributed behavior at the lower level.
