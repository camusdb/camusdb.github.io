---
sidebar_position: 7
---

# WAL And Recovery

CamusDB uses a write-ahead log to make committed storage changes recoverable
after process crashes, node restarts, and leadership changes. The WAL is part
of the distributed storage layer: [Kommander](https://kahunakv.github.io/kommander.github.io/)
stores the ordered Raft log, while [Kahuna](https://kahunakv.github.io/) replays
committed log entries into the persistent key/value store.

This is separate from the SQL model. Users write SQL, but the storage layer
records committed row, index, schema, lock, and transaction mutations as
replicated log entries before those changes are considered durable.

## The Two Durable Paths

CamusDB has two related persistence paths:

| Path | Owned by | Purpose |
| --- | --- | --- |
| Raft WAL | [Kommander](https://kahunakv.github.io/kommander.github.io/) | Stores proposed, committed, rolled-back, and checkpointed Raft log entries per partition. |
| KV persistence | [Kahuna](https://kahunakv.github.io/) | Stores the materialized key/value state produced by committed log entries. |

The distinction matters. The Raft WAL is the source of recovery ordering: it
knows which operations were committed and in what order. KV persistence is the
current durable materialization of those committed operations. If KV persistence
is behind at restart time, committed WAL entries can be replayed.

## Write Path

A CamusDB write follows this shape:

1. The SQL engine decides which row, index, or metadata keys must change.
2. CamusDB writes those keys through [Kahuna](https://kahunakv.github.io/)'s
   transaction API.
3. [Kahuna](https://kahunakv.github.io/) sends the mutation to the partition
   leader.
4. [Kommander](https://kahunakv.github.io/kommander.github.io/) appends the
   mutation to the partition WAL as a Raft log entry.
5. Once the entry is committed, [Kahuna](https://kahunakv.github.io/) queues the
   resulting key/value state for persistent storage.

The WAL write scheduler is partition-aware. It keeps FIFO order within each
partition, batches compatible writes, allows different partitions to flush in
parallel, and applies back-pressure when a partition has too many pending WAL
operations.

## Recovery Path

On startup, each partition restores from its WAL before normal operations are
accepted for that partition.

1. [Kommander](https://kahunakv.github.io/kommander.github.io/) reads persisted
   log entries for the partition.
2. Proposed and rolled-back entries are ignored during restore.
3. Committed entries advance the partition commit index.
4. Each committed data entry is delivered to
   [Kahuna](https://kahunakv.github.io/) through the log-restored callback.
5. [Kahuna](https://kahunakv.github.io/) deserializes the restored mutation and
   queues the resulting key/value write.
6. CamusDB flushes those queued writes before loading schema metadata.

That last step is important for standalone databases. When CamusDB opens a
database, it creates:

```text
{data_dir}/{database}/kv
{data_dir}/{database}/wal
```

It starts the embedded [Kahuna](https://kahunakv.github.io/) node, waits for the
local partition leader, then flushes recovered dirty writes before reading
schema keys from storage. This keeps catalog recovery deterministic: schema,
system metadata, row data, and index data are all read after WAL replay has
settled into the KV backend.

In cluster mode, the same idea applies at process level. CamusDB starts a
shared [Kahuna](https://kahunakv.github.io/) node with a KV path and a WAL path
under the configured `data_dir`, then partitions recover before they serve
normal replicated work.

## Failure Behavior

The WAL improves recovery because it separates "accepted into consensus" from
"later materialized into the KV backend."

| Failure | Recovery result |
| --- | --- |
| Crash before commit | The entry is not replayed as committed, so the change is not made visible as a committed write. |
| Crash after commit but before KV flush | The committed WAL entry is replayed and queued back into KV persistence. |
| Node restart | The node restores committed partition logs, rebuilds materialized KV state as needed, and rejoins leader election or replication. |
| Leader failure | Another eligible replica can lead the partition only from a log state that satisfies Raft's safety rules. |
| Stale or superseded proposal | Proposed or rolled-back log entries are skipped during restore. |

For transactions, CamusDB relies on [Kahuna](https://kahunakv.github.io/)'s
transaction protocol and [Kommander](https://kahunakv.github.io/kommander.github.io/)'s
committed log ordering. A transaction that is not committed is not recovered as
a committed SQL result. A transaction that is committed can be replayed into the
KV store if the process stopped before the background writer finished.

## Checkpoints And Compaction

The WAL does not have to grow forever. [Kommander](https://kahunakv.github.io/kommander.github.io/)
tracks committed checkpoint entries and can compact logs older than the last
checkpoint. [Kahuna](https://kahunakv.github.io/)'s background writer tracks
partitions with dirty durable state and asks the Raft layer to create
checkpoints once the materialized KV state has been flushed.

Recovery then reads logs newer than the last checkpoint. Older committed state
is already represented in the KV backend, while newer committed entries remain
available for replay.

## Why This Matters

Traditional single-node databases often couple durability, availability, and
serving through one primary storage process. CamusDB separates those concerns:

- Raft partitions provide ordered, replicated commit history.
- WAL restore rebuilds committed state after failures.
- KV persistence stores the current materialized state for fast reads.
- Checkpoints let the system keep recovery bounded over time.
- Multi-active CamusDB nodes can accept client traffic while partition leaders
  still serialize writes safely.

For lower-level storage details, see [Storage](/docs/storage) and
[Kahuna's storage overview](https://kahunakv.github.io/docs/storage/overview/).
