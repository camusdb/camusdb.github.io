---
sidebar_position: 3
---

# Transactions and isolation

Every statement that CamusDB runs is inside a transaction. If you do not open a
transaction, the server opens one around your statement. The server then commits
that transaction for you.

CamusDB gives these guarantees at all times:

- Writes are atomic.
- Commits are durable.
- There are no dirty reads. A dirty read is a read of data that another
  transaction has not committed yet.
- CamusDB detects write-write conflicts.
- Execution is serializable by default.
- A write across more than one partition is atomic, through two-phase commit.

This page describes the guarantees. For the SQL syntax, see
[Transactions In SQL](/docs/sql-transactions).

## Isolation levels

There are two levels. Serializable is the default.

| Level | Reads | Protects against |
| --- | --- | --- |
| `SERIALIZABLE` | Snapshot, or locking scans in read-write mode | Read skew, phantoms, write skew, lost updates |
| `READ COMMITTED` | Committed MVCC versions, skipping write intents | Dirty reads and write-write conflicts only |

Serializable means this: the result is the same as a run of the committed
transactions one at a time, in some order. Read Committed is an explicit
opt-out. Use it for a workload that must not pay the cost of Serializable.

Set the level in the first statement of a transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

The statement must come before any read and before any write. An earlier
statement would already have missed the locks and the snapshot setup that the
level needs. CamusDB therefore rejects a late change of level. It does not
pretend that the change applied.

### What Read Committed gives up

Read Committed keeps these properties:

- A read returns committed versions only. It skips an uncommitted write intent.
- A write still uses locks, write intents, and atomic commit.
- A reader blocks no reader, and it blocks no writer.

Read Committed gives up these properties:

- One snapshot shared by every sub-read of a query.
- Repeatable reads across a transaction of several statements.
- Protection against phantoms on a range scan. A phantom is a row that appears
  in a repeated scan because another transaction inserted it.
- Protection against write skew. Write skew is a fault in application code that
  reads a value, decides, and then writes.

## Read-only and read-write modes

Serializable has two execution modes. Your choice between them matters more than
any other decision on this page.

A serializable read-only transaction fixes one snapshot timestamp at `BEGIN`.
Every statement reads from that snapshot. A later commit stays invisible, and a
repeated read is stable. None of this needs a lock. CamusDB can hold the
snapshot across several requests when the client resumes the same transaction
id. The mode therefore suits a report of several queries, not only one
statement.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
```

A serializable read-write transaction adds locks on top of MVCC. MVCC is
multi-version concurrency control, in which a write creates a new version
instead of an overwrite. A point read can hold a shared point lock. A scan can
hold a shared range lock. A write takes exclusive protection at key level. No
other transaction can change a key that this transaction read and still commit.
The cost is a possible retry for a transaction that conflicts.

Use read-write mode when correctness depends on a read-then-write invariant. Use
read-only mode for a report, and for a read that needs consistency but must not
block a writer.

## Locking

Two kinds of lock matter to you as a user.

Every write takes a per-key lock and places a write intent, for each key that it
modifies. A write intent is a provisional version that becomes final at commit.
These two mechanisms enforce three things:

1. Detection of a write-write conflict on a row.
2. Detection of a conflict on a unique index.
3. An atomic update of a row together with its index entries.

A point read lock and a range read lock protect what a serializable read-write
transaction reads. A shared point lock covers the exact key that the transaction
read. A concurrent writer cannot modify that key and still commit. CamusDB
promotes the lock to write protection if the same transaction later writes the
key. For a scan, a shared range lock covers the scanned span. Two overlapping
scans therefore still run at the same time. A conflicting write into the range
waits, or it retries.

CamusDB escalates the point locks when a transaction reads a very large number
of rows. It replaces them with one shared lock over the whole table, or over the
whole bucket. The bookkeeping stays bounded. The protected range becomes wider.

### Pessimistic and optimistic locking

The default strategy is pessimistic. CamusDB takes a lock before any conflicting
work continues.

Optimistic locking is an opt-in strategy. It skips the exclusive write lock. It
validates at commit instead. It aborts the transaction in two cases: another
transaction wrote a key that this transaction wrote, or a row that this
transaction read changed. The application then retries from the start.

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

The locking strategy is a separate axis from the isolation level. The
combination of the two decides the guarantee:

| Combination | Behavior |
| --- | --- |
| `SERIALIZABLE` + pessimistic | Default. CamusDB takes the locks first. |
| `SERIALIZABLE` + optimistic | Hybrid. A write validates at commit, but a read and a scan still take shared locks, so phantoms remain excluded. |
| `READ COMMITTED` + optimistic | No locks at all. CamusDB validates the observed rows only. There is no protection against a phantom. |

`SET TRANSACTION LOCKING` must also run before any data statement. You can
combine it with `SET TRANSACTION ISOLATION LEVEL` in either order. An HTTP
client and a gRPC client select the strategy with the `locking` request field.
An operator changes the server-wide default with `default_transaction_locking`.

## How a write commits

For each `INSERT`, `UPDATE`, or `DELETE`, CamusDB does these steps:

1. It starts a transaction, and it takes an HLC timestamp from the server.
2. It builds the row keys and the index keys that must change.
3. It places provisional write intents, and it acquires the key-level locks.
4. It commits atomically through [Kahuna](https://kahunakv.github.io/).
5. It releases the registered locks at the end of the transaction.

One side fails or retries when another transaction already writes a conflicting
key. Neither side overwrites the other in silence.

## Transactions of several statements

Use an explicit `BEGIN` in these three cases:

1. Several writes must commit together.
2. A read-write sequence must be all-or-nothing.
3. Several queries need one stable serializable snapshot.

An abort is normal here. It is not an exceptional event. Prepare your
application to retry after these failures:

- A write conflict.
- A serialization conflict.
- A change in a read dependency.
- A transient failure of a cross-partition prepare or commit.
- Schema catch-up fencing on a node that lags.
- Expiry of the transaction lifetime.

CamusDB does not replay an aborted multi-statement transaction for you. The
client restarts from `BEGIN`. For single-statement autocommit work, the .NET
client includes a retry helper. See
[Retries And Conflicts](/docs/serializable-retries) for the contract.

One failure is not a signal to retry. `TransactionMutationLimitExceeded` means
that the transaction is too large. A replay of the same batch fails again. See
[Transaction Limits](/docs/transaction-limits).

## Timestamps and schema safety

Every read-write transaction receives a Hybrid Logical Clock timestamp from
Kahuna. A Hybrid Logical Clock, or HLC, combines physical time with a logical
counter. A client never assigns its own timestamp. The timestamp identifies the
transaction, orders the committed versions, and coordinates the distributed
commit. The resulting order is logically consistent. It is not a real-time
wall-clock guarantee. See
[Distributed Transactions And HLC](/docs/distributed-transactions).

CamusDB also pins the schema version of each table that a transaction touches.
CamusDB rejects the transaction if a table changes incompatibly before the
commit. It does not commit a write that mixes an old layout with a new one.

## Single node and cluster

The model is the same in both cases: MVCC reads, locks and write intents on a
write, and detection of a conflict instead of silence about it. A cluster adds
these mechanisms:

- Routing of a key to its partition.
- One leader per partition.
- Replication backed by a majority.
- Two-phase commit across partitions.
- Optional key-range routing.

Key-range routing is an opt-in alternative to the default hash routing. It
routes contiguous keys together. A scan that holds a shared range lock therefore
does not interfere with an unrelated range. The option becomes meaningful only
when the cluster has two partitions or more.

Serializable is not a single-node feature. CamusDB exercises the anomaly
coverage on a single node and on a three-node cluster. That coverage includes a
read-write transaction across more than one partition.

## What is guaranteed today

Serializable is complete, acceptance-tested, and the default. It covers four
anomalies: read skew, phantoms, write skew, and lost updates.

The implementation includes these mechanisms:

- Wait-die deadlock fairness, so two transactions in contention have a
  determinate winner.
- Renewal of a range lock by the coordinator, for a long transaction.
- Lock escalation for a very large read.
- Tight predicate-lock bounds for a bounded scan, for `UPDATE`, and for
  `DELETE`.

One gap remains. There is no externally consistent commit-wait guarantee. The
order is logically consistent. It is not tied to real time.

## Related pages

- [Transactions In SQL](/docs/sql-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Transaction Limits](/docs/transaction-limits)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Cluster Mode](/docs/cluster)
- [Distributed Schema Changes](/docs/distributed-schema)
- [Error Codes](/docs/error-codes)
