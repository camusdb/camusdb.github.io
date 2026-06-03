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
RocksDB and SQLite. In the current CamusDB source, standalone databases are
opened with a SQLite-backed embedded [Kahuna](https://kahunakv.github.io/)
node, and the included Docker cluster configuration also uses SQLite-backed KV
and WAL paths. The storage wrapper also contains persistent RocksDB/SQLite
construction helpers for deployment and testing scenarios.

For the lower-level backend details, see
[Kahuna's storage overview](https://kahunakv.github.io/docs/storage/overview/).
For the recovery path, see [WAL And Recovery](/docs/wal-recovery).

## Database Open

When a database is opened in standalone mode, CamusDB creates per-database
storage directories:

```text
{data_dir}/{database}/kv
{data_dir}/{database}/wal
```

It then starts an embedded [Kahuna](https://kahunakv.github.io/) node, waits for
the local partition leader, flushes recovered WAL state, and loads schema
metadata from KV storage.

In cluster mode, CamusDB uses a process-level shared
[Kahuna](https://kahunakv.github.io/) node. The cluster node is started during
server startup, then all opened databases share that distributed storage layer.
WAL replay and flush happen at node startup so recovered committed entries are
available before database metadata is used.

## Key Layout

Rows and indexes are stored under table-specific prefixes. The table prefix is
important because it lets the underlying routing layer consistently place table
data on the expected partition.

| Object | Key shape | Value |
| --- | --- | --- |
| Row | `{tableId}:r/{rowId}` | Serialized row bytes. |
| Unique index entry | `{tableId}:i:{indexId}/{encodedKey}` | Row id as UTF-8 text. |
| Non-unique index entry | `{tableId}:i:{indexId}/{encodedKey}{rowId}` | Row id as UTF-8 text. |
| Schema metadata | `{database}/meta/schema` | Serialized table schema map. |
| System metadata | `{database}/meta/system` | Serialized system schema. |

Non-unique index keys append the row id directly after the encoded key. The row
id has a fixed 24-character representation, so CamusDB can split it back out
while preserving sortable index keys.

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
| `STRING` | Length-prefixed UTF-16 string. |
| `BOOL` | Boolean marker byte. |
| `NULL` | Null marker byte. |

## Index Encoding

Index keys must sort the same way SQL values sort. CamusDB uses an
order-preserving encoder for composite index values:

- `NULL` sorts before present values.
- `INT64` flips the sign bit and stores fixed-width hexadecimal text.
- `FLOAT64` applies an order-preserving transform to IEEE-754 bits.
- `BOOL` stores `0` or `1`.
- `STRING` and `OID` values use terminators and escaping so prefixes sort
  correctly.

This lets CamusDB scan index keys in lexicographic KV order and get SQL-order
results for the indexed columns.

## Writes And Locks

Write paths use persistent KV entries and explicit transaction state:

1. Start a transaction.
2. Acquire an exclusive lock for each row, index, or metadata key that will be
   written.
3. Write or delete the affected keys.
4. Track acquired locks and modified keys in the transaction object.
5. Commit or roll back through [Kahuna](https://kahunakv.github.io/)'s
   transaction API.

Cross-partition writes use two-phase commit. CamusDB uses serializable
transactions by default, so applications can rely on a single serial order for
committed transactions.

## Scans

Full table scans read the row bucket prefix:

```text
{tableId}:r
```

Index scans read the index bucket prefix:

```text
{tableId}:i:{indexId}
```

Because row ids and encoded index keys preserve sort order, CamusDB can stream
rows or index entries from KV storage in deterministic order before applying
query filtering, projection, sorting, limits, and aggregation.

## Standalone vs Cluster Mode

Standalone mode creates a local embedded [Kahuna](https://kahunakv.github.io/)
node for each opened database. This is the simplest setup for tutorials and
local development.

Cluster mode creates one process-level shared storage node and wires it to real
inter-node communication and static discovery. Data is partitioned across Raft
partitions, and each partition elects its own leader through
[Kommander](https://kahunakv.github.io/kommander.github.io/).

See [Cluster Mode](/docs/cluster) for startup commands and configuration.
