---
sidebar_position: 4
---

# Distributed Transactions And HLC

CamusDB uses serializable transactions by default. When a transaction touches
data on more than one partition, the storage layer coordinates that work with
two-phase commit (2PC) so the transaction either commits everywhere or aborts
everywhere.

Under the hood, CamusDB relies on
[Kahuna](https://kahunakv.github.io/) for transactional key/value execution and
[Kommander](https://kahunakv.github.io/kommander.github.io/) for Raft-backed
replication of each partition.

This page explains what that means for application developers and operators,
then shows the internal flow used by CamusDB and Kahuna.

## What Users Get

Distributed transactions in CamusDB are meant to preserve the same guarantees
you expect from local SQL transactions:

- `BEGIN` / `COMMIT` spans multiple statements.
- Writes remain atomic even when rows live on different partitions.
- Serializable isolation prevents invalid committed states.
- A transaction can commit only if its reads and writes still form one valid
  serial order with other committed transactions.

In practice, that means CamusDB can safely execute work like:

- insert into two different tables in one transaction
- update rows whose keys route to different partitions
- combine indexed point writes with range reads in one serializable unit

## Why 2PC Exists

In a distributed database, different keys may be owned by different partition
leaders. A single node cannot safely mark the whole transaction committed
without making sure every touched partition is ready.

CamusDB uses two-phase commit for that coordination:

1. A transaction runs and accumulates its read set, write set, and locks.
2. During commit, each touched partition is asked to prepare the pending
   mutations.
3. If every participant prepares successfully, the transaction commits.
4. If any participant cannot prepare, the transaction aborts and the prepared
   work is rolled back.

The result is atomic cross-partition commit without requiring all data to live
on one leader.

## High-Level 2PC Flow

For a write transaction, the commit path looks like this:

1. CamusDB opens a transaction and receives a transaction timestamp from
   Kahuna.
2. SQL statements read rows, write rows, maintain indexes, and track the keys
   and ranges touched by the transaction.
3. On `COMMIT`, CamusDB sends the transaction metadata to Kahuna: acquired
   locks, modified keys, and transaction identity.
4. Kahuna validates that the transaction can still commit.
5. Kahuna prepares the pending mutations on the affected partitions.
6. If prepare succeeds everywhere, Kahuna commits the prepared mutations.
7. If prepare fails anywhere, Kahuna rolls the prepared mutations back.
8. Locks are released after the transaction finishes.

This is the path exercised by CamusDB's cluster tests for cross-partition
transactions.

## Serializable Conflict Detection

Serializable isolation in CamusDB is not just "commit if no one wrote the same
row." The engine also tracks enough information to reject transactions that
would otherwise produce anomalies.

The current implementation relies on a combination of:

- exclusive key locks for writes
- prefix or range locks for serializable scans
- tracked modified keys for commit-time coordination
- transaction timestamps from HLC
- read dependency validation and write-intent checks in Kahuna's transaction
  coordinator

### Write-Write Conflicts

If two transactions try to update the same key, one of them must wait, abort,
or fail to prepare. Both cannot commit conflicting writes to the same key.

### Phantom Protection

For range-style reads such as scans by table or index prefix, CamusDB acquires
prefix locks so a concurrent transaction cannot insert a new matching row and
silently change the result set behind an open serializable transaction.

This is how CamusDB prevents phantom-style anomalies for scan-based logic.

### Read-Write Conflicts

Kahuna's coordinator also checks whether a transaction read data that is no
longer compatible with the state being committed. In the optimistic path, it
validates read dependencies and checks for concurrent write intents before
final commit.

For applications, the practical rule is simple: a serialization failure is a
retry signal, not a silent correctness bug.

## How HLC Timestamps Fit In

Every distributed transaction needs an ordering that works across nodes. CamusDB
uses Hybrid Logical Clock timestamps, or HLC timestamps, through Kahuna for that
purpose.

An HLC timestamp has two parts:

- `L`: the logical wall-clock component
- `C`: a counter used when physical time alone is not enough to preserve order

CamusDB's local `HLCTimestamp` type represents that timestamp as `HLC(L:C)`.

## Why HLC Instead Of Plain Wall Clock Time

Plain wall-clock time is not enough in a distributed system:

- clocks on different nodes are never perfectly synchronized
- multiple events can happen inside the same clock tick
- a node can receive an event whose timestamp is ahead of its local physical
  time

HLC solves that by combining physical time with a logical counter. That gives
CamusDB a timestamp that stays close to real time while still producing a
stable causal ordering across nodes.

## Transaction Start Timestamp

When CamusDB begins a transaction, Kahuna allocates an HLC transaction ID.

That timestamp becomes the transaction identity used through the rest of the
commit path. It is also the reference point for locks, read tracking, and
write coordination.

## Commit Timestamp

At commit time, Kahuna does not reuse the original start timestamp as-is.
Instead, it computes a commit timestamp that is at least as new as:

- the transaction start timestamp
- the newest timestamp of any value the transaction modified or depended on

In Kahuna's coordinator, this is done by taking the highest observed modified
time and feeding it back into the node's HLC before prepare. The result is a
fresh commit timestamp that preserves ordering even when the transaction spans
multiple nodes or races with concurrent writers.

For users, the important property is this: if transaction B depends on effects
that are newer than transaction A's start time, B's commit timestamp advances
accordingly. CamusDB does not commit it with an older timestamp that would
break serial ordering.

## Internal Commit Flow

Internally, CamusDB and Kahuna follow this shape:

1. `BEGIN` asks Kahuna to start a transaction and returns an HLC transaction
   ID.
2. CamusDB executes SQL work while tracking:
   - acquired locks
   - acquired prefix locks
   - modified keys
   - schema-version pins for touched tables
3. `COMMIT` validates schema pins so the transaction cannot commit against a
   table definition that became incompatible mid-transaction.
4. CamusDB forwards the transaction metadata to Kahuna's transaction
   coordinator.
5. Kahuna validates read dependencies when needed.
6. Kahuna prepares the transaction's mutations with a fresh commit timestamp.
7. Kahuna checks for conflicting write intents on read keys when the execution
   path requires it.
8. Kahuna commits the prepared mutations on all participants, or rolls them
   back if the prepare step failed.
9. CamusDB releases the transaction's key and prefix locks.

## What Counts As A Retryable Failure

Applications should be ready to retry when a transaction fails because:

- another transaction committed a conflicting write
- a read dependency changed before commit
- a concurrent write intent made the serial order invalid
- the transaction could not prepare on every participant

The important point is that these failures are how CamusDB preserves
correctness. They are not partial commits.

## Limits And Scope

This page describes the current CamusDB transaction model as implemented over
Kahuna:

- serializable transactions are the default user-facing model
- cross-partition writes use 2PC
- HLC timestamps provide transaction ordering across nodes
- prefix locking is part of serializable scan protection

CamusDB cluster mode is still alpha-quality, so distributed transaction support
should be treated as development and testing functionality rather than a
production guarantee.

## See Also

- [Serializable Transactions](/docs/serializable-transactions)
- [Architecture](/docs/architecture)
- [Cluster Mode](/docs/cluster)
- [WAL And Recovery](/docs/wal-recovery)
