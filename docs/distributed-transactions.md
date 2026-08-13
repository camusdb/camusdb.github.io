---
sidebar_position: 4
---

# Distributed Transactions And HLC

When a transaction touches data on more than one partition, the storage layer
coordinates that work with two-phase commit (2PC) so the transaction either
commits everywhere or aborts everywhere.

Under the hood, CamusDB relies on
[Kahuna](https://kahunakv.github.io/) for transactional key/value execution and
[Kommander](https://kahunakv.github.io/kommander.github.io/) for Raft-backed
replication of each partition.

What follows is the guarantee first, then the flow underneath it.

## What Users Get

Distributed transactions in CamusDB are meant to preserve the same guarantees
you expect from local SQL transactions:

- `BEGIN` / `COMMIT` spans multiple statements.
- Writes remain atomic even when rows live on different partitions.
- Committed writes do not become partially visible across partitions.
- Conflicting writes are surfaced as failures or retries instead of being
  silently merged.
- Serializable transactions can preserve either a stable snapshot or read-write
  locking semantics across partitions, depending on transaction mode.

That includes a lock-free serializable read-only snapshot path that can be
resumed across requests by transaction id.

In practice, that means CamusDB can safely execute work like:

- insert into two different tables in one transaction
- update rows whose keys route to different partitions
- run a consistent serializable read-only report across multiple partitions
- combine indexed point writes with range reads in one serializable read-write
  unit

## Why 2PC Exists

In a distributed database, different keys may be owned by different partition
leaders. A single node cannot safely mark the whole transaction committed
without making sure every touched partition is ready.

CamusDB uses two-phase commit for that coordination:

1. A transaction runs through a Kahuna coordinator session.
2. SQL operations register confirmed writes, locks, and read observations with
   that coordinator session.
3. During commit, each touched partition is asked to prepare the registered
   mutations.
4. If every participant prepares successfully, the transaction commits.
5. If any participant cannot prepare, the transaction aborts and the prepared
   work is rolled back.

The result is atomic cross-partition commit without requiring all data to live
on one leader.

## Durability Across Leader Changes

Committed transactional writes are stored through the same replicated partition
log as ordinary writes. A participant is not treated as durably committed until
its partition has accepted the commit through [Kommander](https://kahunakv.github.io/kommander.github.io/)
and the committed entry can be restored by [Kahuna](https://kahunakv.github.io/).

That matters during failures:

- If a node restarts after a commit is acknowledged, committed partition log
  entries are restored and applied back into the KV store as needed.
- If a partition leader changes, the new leader continues from a Raft-safe log
  state and can continue serving the partition.
- If a transaction has installed a durable commit decision, the partition that
  owns the decision anchor can drive the remaining participant commits even if
  the original live coordinator is gone.
- If a failure happens before a commit decision is durably installed, the
  transaction is not reported as a committed SQL result. The application should
  retry the business operation from `BEGIN` if it still wants the change.

The practical guarantee is that CamusDB does not expose half-committed SQL
transactions. A transaction either becomes committed through the storage layer's
replicated commit path, or it remains retryable/aborted without being surfaced
as a committed result.

## Idempotent Internal Retries

The storage layer can retry individual pieces of a transaction without applying
the same effect twice.

Every registered operation carries a transaction operation id. The coordinator
uses that id to distinguish:

- a duplicate delivery of the same logical operation
- a new operation that should run separately
- a retry of commit or rollback for the same transaction handle

If a write reaches a participant and the acknowledgement back to the coordinator
is lost, a retry with the same operation id replays the recorded completion
instead of writing the row or index entry a second time. Commit and rollback use
the transaction handle and can also be retried when Kahuna returns `MustRetry`.

This idempotency is an internal engine guarantee. Application code should still
treat a failed explicit serializable transaction as a failed unit and replay the
whole transaction from `BEGIN`, because the business logic may have observed
different data on the next attempt.

## High-Level 2PC Flow

For a write transaction, the commit path looks like this:

1. CamusDB opens a transaction and receives a transaction timestamp from
   Kahuna, plus a coordinator handle.
2. SQL statements read rows, write rows, maintain indexes, and acquire locks.
3. Each successful transactional operation registers with the coordinator.
4. On `COMMIT`, CamusDB sends the transaction handle to Kahuna.
5. Kahuna validates that the transaction can still commit.
6. Kahuna prepares the registered mutations on the affected partitions.
7. If prepare succeeds everywhere, Kahuna commits the prepared mutations.
8. If prepare fails anywhere, Kahuna rolls the prepared mutations back.
9. Locks are released after the transaction finishes.

This is the path exercised by CamusDB's cluster tests for cross-partition
transactions.

## Conflict Detection

The current implementation relies on a combination of:

- exclusive key locks for writes
- prefix or range locks for scan protection in the relevant execution modes
- coordinator-registered modified keys for commit-time coordination
- transaction timestamps from HLC
- read dependency validation and write-intent checks in Kahuna's transaction
  coordinator

### Write-Write Conflicts

If two transactions try to update the same key, one of them must wait, abort,
or fail to prepare. Both cannot commit conflicting writes to the same key.

### Phantom Protection

For range-style reads in the key-range-routed execution paths, CamusDB can hold
shared range locks so a concurrent transaction cannot insert, change, or delete
rows inside the protected scan range while that scan is active.

This is how CamusDB prevents phantom-style anomalies for those scan-based
paths, while still allowing concurrent readers to proceed.

For serializable read-write transactions, the same general predicate-protection
idea also applies to the read set they must preserve until commit.

### Read-Write Conflicts

Kahuna's coordinator also checks whether a transaction read data that is no
longer compatible with the state being committed. In the advanced optimistic
locking path, which can be selected with `SET TRANSACTION LOCKING OPTIMISTIC`,
the HTTP/gRPC `locking` field, or `default_transaction_locking`, it validates
read dependencies and checks for concurrent write intents before final commit.

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
   ID plus a coordinator handle.
2. CamusDB executes SQL work while registering confirmed writes, locks, and
   tracked reads with the coordinator.
3. CamusDB also pins schema versions for touched tables.
4. `COMMIT` validates schema pins so the transaction cannot commit against a
   table definition that became incompatible mid-transaction.
5. CamusDB asks Kahuna to commit the transaction handle.
6. Kahuna validates read dependencies when needed.
7. Kahuna prepares the transaction's mutations with a fresh commit timestamp.
8. Kahuna checks for conflicting write intents on read keys when the execution
   path requires it.
9. Kahuna commits the prepared mutations on all participants, or rolls them
   back if the prepare step failed.
10. The coordinator releases registered locks and finalizes the session.

## What Counts As A Retryable Failure

Applications should be ready to retry when a transaction fails because:

- another transaction committed a conflicting write
- a read dependency changed before commit
- a concurrent write intent made the serial order invalid
- the transaction could not prepare on every participant
- a serializable read-write transaction exceeded its lifetime deadline

Those failures mean replay the whole transaction from `BEGIN`.
`TransactionFinalizeUnresolved` is different: the commit or rollback outcome is
not terminal yet, and the same finalize request must be retried on the same
transaction handle instead of rerunning the business operation.

Applications should also pick the right isolation mode for the job:

- use the default Serializable isolation for correctness-sensitive work
- use serializable read-only for consistent multi-statement reads without
  lock-based write blocking
- use Read Committed only as an explicit opt-out when fresh committed reads and
  cheaper concurrency matter more than full serializable behavior

CamusDB does not automatically replay failed explicit serializable
transactions. The client must restart them from the beginning when a retryable
conflict or deadline error occurs.

For single-statement autocommit serializable work, CamusDB includes a helper
that performs bounded replay with backoff. Explicit multi-statement
transactions still need replay from `BEGIN`.

The important point is that these failures are how CamusDB preserves
correctness. They are not partial commits.

## Limits And Scope

This page describes the current CamusDB transaction model as implemented over
Kahuna:

- cross-partition writes use 2PC
- committed writes are durable across node restart and leader change through
  the replicated partition log
- durable commit decisions can be recovered by the decision-anchor partition
  after the live coordinator disappears
- registered transaction operations, commit, and rollback are idempotent across
  engine retries
- HLC timestamps provide transaction ordering across nodes
- lock and intent tracking protect atomic distributed commit
- Serializable is the default isolation level
- Read Committed is available as an explicit opt-out

CamusDB cluster mode is still alpha-quality, so distributed transaction support
should be treated as development and testing functionality rather than a
production guarantee.

## See Also

- [Transactions And Isolation](/docs/serializable-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Architecture](/docs/architecture)
- [Cluster Mode](/docs/cluster)
- [WAL And Recovery](/docs/wal-recovery)
