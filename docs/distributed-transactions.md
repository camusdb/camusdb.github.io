---
sidebar_position: 4
---

# Distributed transactions and HLC

A transaction can touch data on more than one partition. The storage layer then
coordinates the work with two-phase commit, or 2PC. The transaction commits on
every partition, or it aborts on every partition.

CamusDB uses two components for this work:

- [Kahuna](https://kahunakv.github.io/) executes transactional key/value work.
- [Kommander](https://kahunakv.github.io/kommander.github.io/) replicates each
  partition with the Raft algorithm.

This page gives the guarantee first. It then describes the flow under the
guarantee.

## What users get

A distributed transaction in CamusDB keeps the same guarantees that you expect
from a local SQL transaction:

- `BEGIN` and `COMMIT` span several statements.
- A write stays atomic even when the rows live on different partitions.
- A committed write never becomes partly visible across the partitions.
- CamusDB reports a conflicting write as a failure or as a retry. It never
  merges the two writes in silence.
- A serializable transaction keeps either a stable snapshot or read-write lock
  semantics across the partitions. The transaction mode decides which one.

That set includes a serializable read-only snapshot path. The path needs no
lock, and a client can resume it across requests with the transaction id.

CamusDB can therefore run work of these four kinds:

1. An insert into two different tables in one transaction.
2. An update of rows whose keys route to different partitions.
3. A consistent serializable read-only report across several partitions.
4. Indexed point writes together with range reads, in one serializable
   read-write unit.

## Why 2PC exists

In a distributed database, two keys can belong to two different partition
leaders. One node cannot safely mark the whole transaction committed. It must
first confirm that every partition that the transaction touched is ready.

CamusDB uses two-phase commit for that purpose:

1. A transaction runs through a Kahuna coordinator session.
2. The SQL operations register their confirmed writes, their locks, and their
   read observations with that coordinator session.
3. At commit, CamusDB asks each partition that the transaction touched to
   prepare the registered mutations.
4. The transaction commits if every participant prepares successfully.
5. The transaction aborts if a participant cannot prepare. CamusDB then rolls
   the prepared work back.

The result is an atomic commit across partitions. All the data does not have to
live on one leader.

## Durability across a leader change

CamusDB stores a committed transactional write through the same replicated
partition log as an ordinary write. A participant is not durably committed until
two conditions hold. Its partition accepted the commit through
[Kommander](https://kahunakv.github.io/kommander.github.io/), and
[Kahuna](https://kahunakv.github.io/) can restore the committed entry.

That matters during a failure:

- A node can restart after CamusDB acknowledged a commit. CamusDB then restores
  the committed partition log entries. It applies them back into the KV store as
  needed.
- A partition leader can change. The new leader continues from a log state that
  Raft made safe. It can continue to serve the partition.
- A transaction can install a durable commit decision. The partition that owns
  the decision anchor can then drive the remaining participant commits. It does
  so even after the original live coordinator disappears.
- A failure can happen before CamusDB installs a durable commit decision.
  CamusDB then does not report the transaction as a committed SQL result. Your
  application must replay the business operation from `BEGIN` if it still wants
  the change.

The practical guarantee is this: CamusDB never exposes a half-committed SQL
transaction. A transaction either commits through the replicated commit path of
the storage layer, or it stays retryable or aborted. CamusDB never reports it as
a committed result in the second case.

## Idempotent internal retries

The storage layer can retry one piece of a transaction. It does not apply the
same effect twice.

Every registered operation carries a transaction operation id. The coordinator
uses that id to distinguish three cases:

- A duplicate delivery of the same logical operation.
- A new operation that must run separately.
- A retry of the commit or of the rollback, for the same transaction handle.

A write can reach a participant while the acknowledgement back to the
coordinator is lost. A retry with the same operation id then replays the
recorded completion. It does not write the row or the index entry a second time.
The commit and the rollback use the transaction handle. CamusDB can retry them
when Kahuna returns `MustRetry`.

This idempotency is an internal guarantee of the engine. Application code must
still treat a failed explicit serializable transaction as a failed unit. Replay
the whole transaction from `BEGIN`. The business logic may observe different data
on the next attempt.

## The 2PC flow

For a write transaction, the commit path has these steps:

1. CamusDB opens a transaction. It receives a transaction timestamp from Kahuna,
   and a coordinator handle.
2. The SQL statements read rows, write rows, maintain the indexes, and acquire
   locks.
3. Each successful transactional operation registers itself with the
   coordinator.
4. At `COMMIT`, CamusDB sends the transaction handle to Kahuna.
5. Kahuna validates that the transaction can still commit.
6. Kahuna prepares the registered mutations on the affected partitions.
7. Kahuna commits the prepared mutations if the prepare step succeeds
   everywhere.
8. Kahuna rolls the prepared mutations back if the prepare step fails anywhere.
9. CamusDB releases the locks after the transaction ends.

The cluster tests of CamusDB exercise this path for a transaction across
partitions.

## Conflict detection

The current implementation uses a combination of five mechanisms:

- Exclusive key locks for a write.
- Prefix locks or range locks, to protect a scan in the relevant execution
  modes.
- Modified keys that the coordinator registers, for coordination at commit time.
- Transaction timestamps from the HLC.
- Validation of the read dependencies, and checks of the write intents, in the
  Kahuna transaction coordinator.

### Write-write conflicts

Two transactions can try to update the same key. One of them must then wait,
abort, or fail to prepare. Both cannot commit a conflicting write to the same
key.

### Phantom protection

CamusDB can hold shared range locks for a range read in a key-range-routed
execution path. A concurrent transaction then cannot insert, change, or delete a
row inside the protected scan range while that scan is active.

This mechanism prevents a phantom anomaly on those scan-based paths. Concurrent
readers can still continue.

The same idea of predicate protection also applies to a serializable read-write
transaction. It protects the read set that the transaction must preserve until
the commit.

### Read-write conflicts

The Kahuna coordinator also checks the read set. It looks for data that the
transaction read and that no longer agrees with the state at commit.

The advanced optimistic locking path validates the read dependencies. It also
checks for a concurrent write intent before the final commit. You can select
that path in three ways: with `SET TRANSACTION LOCKING OPTIMISTIC`, with the
`locking` field over HTTP or gRPC, or with `default_transaction_locking`.

The practical rule for an application is simple. A serialization failure is a
signal to retry. It is not a silent defect in correctness.

## How HLC timestamps fit in

Every distributed transaction needs an order that works across nodes. CamusDB
uses Hybrid Logical Clock timestamps, or HLC timestamps, through Kahuna.

An HLC timestamp has two parts:

- `L` is the logical wall-clock component.
- `C` is a counter. CamusDB uses it when physical time alone cannot preserve the
  order.

The local `HLCTimestamp` type of CamusDB shows that timestamp as `HLC(L:C)`.

## Why HLC instead of plain wall-clock time

Plain wall-clock time is not enough in a distributed system, for three reasons:

1. The clocks on two nodes are never perfectly synchronous.
2. Several events can happen inside one clock tick.
3. A node can receive an event whose timestamp is ahead of its own physical
   time.

An HLC solves this problem. It combines physical time with a logical counter.
The result stays close to real time. It still gives a stable causal order across
the nodes.

## The transaction start timestamp

Kahuna allocates an HLC transaction ID when CamusDB begins a transaction.

That timestamp becomes the identity of the transaction for the rest of the
commit path. It is also the reference point for the locks, for the record of the
reads, and for the coordination of the writes.

## The commit timestamp

At commit time, Kahuna does not reuse the start timestamp without a change. It
computes a commit timestamp that is at least as new as both of these values:

- The start timestamp of the transaction.
- The newest timestamp of any value that the transaction modified or depended
  on.

The Kahuna coordinator takes the highest modified time that it observed. It
feeds that value back into the HLC of the node before the prepare step. The
result is a fresh commit timestamp. That timestamp preserves the order even when
the transaction spans several nodes, and even when it races with a concurrent
writer.

One property matters to a user. Transaction B can depend on effects that are
newer than the start time of transaction A. The commit timestamp of B then
advances by the same amount. CamusDB does not commit B with an older timestamp,
because that timestamp would break the serial order.

## Internal commit flow

Internally, CamusDB and Kahuna follow this shape:

1. `BEGIN` asks Kahuna to start a transaction. It returns an HLC transaction ID
   and a coordinator handle.
2. CamusDB executes the SQL work. It registers the confirmed writes, the locks,
   and the tracked reads with the coordinator.
3. CamusDB also pins the schema version of each table that the work touches.
4. `COMMIT` validates the schema pins. The transaction therefore cannot commit
   against a table definition that became incompatible during the transaction.
5. CamusDB asks Kahuna to commit the transaction handle.
6. Kahuna validates the read dependencies when that check is needed.
7. Kahuna prepares the mutations of the transaction with a fresh commit
   timestamp.
8. Kahuna checks for a conflicting write intent on the read keys, when the
   execution path requires that check.
9. Kahuna commits the prepared mutations on every participant. It rolls them
   back if the prepare step failed.
10. The coordinator releases the registered locks. It then finalizes the
    session.

## What counts as a retryable failure

Prepare your application to retry after these failures:

- Another transaction committed a conflicting write.
- A read dependency changed before the commit.
- A concurrent write intent made the serial order invalid.
- The transaction could not prepare on every participant.
- A read or scan reached a range that could not serve the snapshot before the
  server-side retry budget expired.
- A serializable read-write transaction passed its lifetime deadline.

Each failure above means one action: replay the whole transaction from `BEGIN`.

`TransactionFinalizeUnresolved` is different. The outcome of the commit or of
the rollback is not final yet. This can happen after a leader change, drain,
participant retry, or transport fault once the finalize request has already left
the node. Send the same finalize request again, on the same transaction handle.
Do not run the business operation again.

Also select the correct isolation mode for the job:

- Use the default Serializable isolation for work that is sensitive to
  correctness.
- Use serializable read-only for consistent reads across several statements,
  without a block on writers.
- Use Read Committed only as an explicit opt-out. Choose it when fresh committed
  reads and cheaper concurrency matter more than full serializable behavior.

CamusDB does not replay a failed explicit serializable transaction for you. The
client must restart the transaction from the start after a retryable conflict or
a deadline error.

For single-statement autocommit serializable work, CamusDB includes a helper. It
performs a bounded replay with backoff. An explicit transaction of several
statements still needs a replay from `BEGIN`.

One point matters most. These failures are how CamusDB preserves correctness.
They are not partial commits.

## Limits and scope

This page describes the current transaction model of CamusDB over Kahuna:

- A cross-partition write uses 2PC.
- A committed write survives a node restart and a leader change, through the
  replicated partition log.
- The decision-anchor partition can recover a durable commit decision after the
  live coordinator disappears.
- A registered transaction operation, a commit, and a rollback are idempotent
  across the retries of the engine.
- HLC timestamps give the transaction order across nodes.
- The record of locks and write intents protects the atomic distributed commit.
- Serializable is the default isolation level.
- Read Committed is available as an explicit opt-out.

CamusDB is in production use. Distributed transaction support is nevertheless an
alpha feature. The APIs and the behavior can change between versions.

## See also

- [Transactions And Isolation](/docs/serializable-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Architecture](/docs/architecture)
- [Cluster Mode](/docs/cluster)
- [WAL And Recovery](/docs/wal-recovery)
