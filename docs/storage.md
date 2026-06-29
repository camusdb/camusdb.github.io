---
sidebar_position: 6
---

# Storage

CamusDB stores relational data on top of a distributed key/value layer provided
by [Kahuna](https://kahunakv.github.io/). Tables, rows, indexes, schema
metadata, locks, and transaction state are mapped to persistent key/value
entries.

The design keeps SQL as the user-facing model while using a storage layout that
can be routed, replicated, locked, and committed by the distributed KV layer.

## Storage Stack

CamusDB's storage path has three layers:

| Layer | Responsibility |
| --- | --- |
| SQL engine | Plans statements, validates schema, applies constraints, and decides which rows or indexes are touched. |
| CamusDB KV mapping | Encodes table rows, index entries, and schema metadata as deterministic key/value entries. |
| [Kahuna](https://kahunakv.github.io/) | Persists keys, coordinates locks and transactions, and relies on Raft-backed partition ownership in cluster mode. |

[Kahuna](https://kahunakv.github.io/) supports embedded storage backends such as
[RocksDB](https://rocksdb.org/) and SQLite. CamusDB uses
[RocksDB](https://rocksdb.org/) as its default persistent storage backend in
standalone mode, and [Kommander](https://kahunakv.github.io/kommander.github.io/)
uses a RocksDB-backed WAL adapter by default for Raft logs. SQLite remains an
optional embedded backend when a deployment wants SQLite files instead of
RocksDB directories; the in-memory backend is for development and tests only.

This means CamusDB is not reinventing low-level storage. It maps SQL rows,
indexes, schema metadata, locks, and transaction state into deterministic
key/value entries, then delegates local persistence to proven embedded storage
engines. RocksDB provides the ordered, durable key/value store; [Kahuna](https://kahunakv.github.io/)
adds transactions, locks, range scans, and distributed KV behavior; and
[Kommander](https://kahunakv.github.io/kommander.github.io/) adds Raft log
replication, leader election, and recovery ordering.

For the lower-level backend details, see
[Kahuna's storage overview](https://kahunakv.github.io/docs/storage/overview/).
For the recovery path, see [WAL And Recovery](/docs/wal-recovery).

## RocksDB Backend

[RocksDB](https://rocksdb.org/) is an embedded ordered key/value database based
on a log-structured merge-tree. Writes go through memory tables and durable
log/SSTable files, and background compaction keeps sorted on-disk files
queryable over time. It is a native C++ storage engine created at Meta, so
CamusDB's high-level SQL, transaction, and distributed coordination logic can be
written in C# while the local storage engine runs close to the hardware.

CamusDB benefits from those RocksDB properties without exposing RocksDB as the
user-facing model:

- Durable local persistence for materialized KV state.
- Ordered key iteration, which CamusDB uses for row-bucket scans and index
  scans.
- Efficient write-heavy storage behavior from the LSM-tree design.
- Mature crash-recovery behavior for the local storage engine.
- A storage engine that can be replaced with SQLite when that tradeoff is more
  appropriate for a deployment.

RocksDB is local storage, not the distributed database by itself. Cluster
replication, quorum commit, partition leadership, transaction coordination, and
WAL replay are provided by [Kahuna](https://kahunakv.github.io/) and
[Kommander](https://kahunakv.github.io/kommander.github.io/). In other words,
RocksDB makes each node's persisted state reliable; the distributed layer makes
commits consistent across the cluster.

The relevant storage settings are:

```yaml
kahuna:
  storage: rocksdb
  wal_storage: rocksdb
  wal_sync_writes: true
```

`storage` controls the materialized KV backend. `wal_storage` controls the Raft
write-ahead-log backend. `wal_sync_writes: true` keeps acknowledged durable WAL
writes on the safer path; disabling it is useful only for benchmarks or tests
where crash durability is not being evaluated.

## Database Create And Open

Databases must be created explicitly before use. `CREATE DATABASE` allocates a
stable opaque database id and stores the name-to-id mapping in CamusDB's
registry. `CREATE DATABASE IF NOT EXISTS` returns the existing database when the
name is already registered.

Both standalone and cluster modes use a single process-level
[Kahuna](https://kahunakv.github.io/) node. Creating a database does not create
a separate storage engine, RocksDB instance, WAL, or per-database directory.
Instead, every database is isolated inside the shared KV space by its database
id.

Opening a database is a metadata operation:

1. CamusDB resolves the requested name through the registry.
2. It loads the database's schema metadata from the shared KV store.
3. It registers schema-replication callbacks so future DDL changes are applied
   after Raft commit.
4. Tables are opened lazily when statements first touch them.

Startup recovery happens at the shared storage-node level. [Kommander](https://kahunakv.github.io/kommander.github.io/)
restores committed WAL entries, [Kahuna](https://kahunakv.github.io/) makes the
materialized KV state available, and then CamusDB opens database metadata from
that recovered state.

Renaming a database updates only the registry entry. The database id is
preserved, so existing table ids, row keys, index keys, statistics keys, and
schema metadata remain in the same keyspaces. Dropping a database unregisters
the name, drains in-flight operations on the descriptor, and purges the
database-id keyspaces from the shared KV store. Raft schema-log history is
append-only and is not rewritten by a drop.

## Key Layout

Rows, indexes, schema metadata, statistics, and registry records are stored as
key/value entries in the shared [Kahuna](https://kahunakv.github.io/) keyspace.
User data keys include the opaque database id first, so two databases can use
the same table names without sharing storage keys.

| Object | Key shape | Value |
| --- | --- | --- |
| Database registry entry | `_system/dbregistry/db:{databaseName}` | Database id, normalized name, and creation time. |
| Database id sequence | `_system/dbregistry/seq` | Monotonic sequence used to allocate database ids. |
| System metadata | `{databaseId}/meta/system` | Internal database metadata. |
| Schema version | `{databaseId}/meta/version` | Current applied schema version. |
| Table schema | `{databaseId}/meta/table:{tableId}` | Serialized schema for one table. |
| Table schema history | `{databaseId}/meta/history:{tableId}:{version}` | Historical table schema version used to decode older rows. |
| DDL coordinator state | `{databaseId}/meta/coordinator:{tableId}~{element}` | State for multi-step schema changes such as index backfill. |
| Table statistics | `{databaseId}:stats:{tableId}` | Persisted planner statistics for the table. |
| Row | `{databaseId}:{tableId}:r/{rowId}` | Serialized row bytes. |
| Unique index entry | `{databaseId}:{tableId}:i:{indexName}/{encodedKey}` | Row id as UTF-8 text. |
| Non-unique index entry | `{databaseId}:{tableId}:i:{indexName}/{encodedKey}{rowId}` | Row id as UTF-8 text. |

The slash placement is intentional. Row keys share the bucket
`{databaseId}:{tableId}:r`, and index keys share the bucket
`{databaseId}:{tableId}:i:{indexName}`. That keeps scans, writes, and range
locks aligned on the same routed keyspace. Metadata keys use the single
`{databaseId}/meta` bucket so database metadata can be loaded and purged as a
coherent group.

Non-unique index keys append the row id directly after the encoded key. The row
id has a fixed 24-character representation, so CamusDB can split it back out
while preserving sortable index keys.

Indexes use the schema-visible index name in the storage keyspace. Internally,
tables and columns also have stable ids, so renaming tables or columns does not
require rewriting existing row or index data.

## Row Values

Each row is stored as a compact binary value. The row payload includes:

- Schema version.
- Row object id.
- One encoded value for each column in schema order.

The schema version lets CamusDB deserialize older row payloads through the
schema history attached to the table. Column values are encoded by type:

| Column type | Stored representation |
| --- | --- |
| `OID` | 12-byte object id. |
| `INT64` | 8-byte signed integer. |
| `FLOAT64` | 8-byte double. |
| `FLOAT32` | 4-byte single-precision value, exposed through the common numeric value path. |
| `STRING` | Length-prefixed UTF-16 string. |
| `BOOL` | Boolean marker byte. |
| `DATE` | UTC ticks truncated to midnight. |
| `DATETIME` | UTC ticks. |
| `BYTES` | Length-prefixed byte payload. |
| `ARRAY(T)` | Element type plus an ordered sequence of encoded element values. |
| `NULL` | Null marker byte. |

## Index Encoding

Index keys must sort the same way SQL values sort. CamusDB uses an
order-preserving encoder for composite index values:

- `NULL` sorts before present values.
- `INT64` flips the sign bit and stores fixed-width hexadecimal text.
- `FLOAT64` and `FLOAT32` apply order-preserving transforms to IEEE-754 bits.
- `BOOL` stores `0` or `1`.
- `DATE` and `DATETIME` sort by their UTC tick values.
- `BYTES` values use an order-preserving byte encoding.
- `STRING` and `OID` values use terminators and escaping so prefixes sort
  correctly.

This lets CamusDB scan index keys in lexicographic KV order and get SQL-order
results for the indexed columns.

All scalar column types are indexable. `ARRAY(T)` columns are stored in rows,
but they cannot be used in primary keys or secondary indexes.

## Writes And Locks

Write paths use persistent KV entries and explicit transaction state:

1. Start a transaction.
2. Acquire an exclusive lock for each row, index, or metadata key that will be
   written.
3. Write or delete the affected keys.
4. Track acquired locks and modified keys in the transaction object.
5. Commit or roll back through [Kahuna](https://kahunakv.github.io/)'s
   transaction API.

Cross-partition writes use two-phase commit. CamusDB uses Serializable
transactions by default, plus committed MVCC reads, conflict detection, and
tracked write intents for atomic commit coordination.

## Scans

Full table scans read the row bucket prefix:

```text
{databaseId}:{tableId}:r
```

Index scans read the index bucket prefix:

```text
{databaseId}:{tableId}:i:{indexName}
```

Because row ids and encoded index keys preserve sort order, CamusDB can stream
rows or index entries from KV storage in deterministic order before applying
query filtering, projection, sorting, limits, and aggregation.

## Standalone vs Cluster Mode

Standalone mode creates one embedded [Kahuna](https://kahunakv.github.io/) node
for the CamusDB process. All databases share that local node and are separated
by database-id key prefixes. This is the simplest setup for tutorials and local
development.

Cluster mode creates one process-level shared storage node and wires it to real
inter-node communication and static discovery. Data is partitioned across Raft
partitions, and each partition elects its own leader through
[Kommander](https://kahunakv.github.io/kommander.github.io/).

See [Cluster Mode](/docs/cluster) for startup commands and configuration.
