---
sidebar_position: 3
---

# Transactions And Isolation

Every statement CamusDB runs is inside a transaction. If you do not open one,
the server opens and commits a single-statement transaction around your query.

The baseline guarantees are atomic writes, durable commits, no dirty reads,
write-write conflict detection, serializable execution by default, and atomic
cross-partition writes through two-phase commit.

This page covers the guarantees. For the SQL syntax, see
[Transactions In SQL](/docs/sql-transactions).

## Isolation Levels

There are two, and Serializable is the default:

| Level | Reads | Protects against |
| --- | --- | --- |
| `SERIALIZABLE` | Snapshot, or locking scans in read-write mode | Read skew, phantoms, write skew, lost updates |
| `READ COMMITTED` | Committed MVCC versions, skipping write intents | Dirty reads and write-write conflicts only |

Serializable means the outcome is equivalent to running the committed
transactions one at a time in some order. Read Committed is an explicit opt-out
for workloads that would rather not pay for that.

Set the level as the first statement of a transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

It has to come before any read or write. Earlier statements would already have
missed the locks and snapshot setup the chosen level needs, so CamusDB rejects
retroactive changes rather than pretending they applied.

### What Read Committed Gives Up

At Read Committed, reads return committed versions and skip uncommitted
intents; writes still use locks, intents, and atomic commit; readers block
neither readers nor writers. What you no longer get:

- one snapshot shared by every sub-read in a query
- repeatable reads across a multi-statement transaction
- phantom protection on range scans
- protection from write-skew bugs in read-then-decide application code

## Read-Only And Read-Write Modes

Serializable has two execution modes, and picking the right one matters more
than any other tuning decision here.

A **serializable read-only** transaction pins one snapshot timestamp at `BEGIN`.
Every statement reads from it, later commits stay invisible, repeated reads are
stable, and none of it needs a lock. CamusDB can hold that snapshot across
several requests when the client resumes the same transaction id, so it works
for a multi-query report, not just one statement.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
```

A **serializable read-write** transaction adds locking on top of MVCC. Point
reads can hold shared point locks, scans can hold shared range locks, and writes
take exclusive key-level protection. A key the transaction read cannot be
changed underneath it and still commit. The cost is that conflicting
transactions may have to retry.

Use read-write when correctness depends on a read-then-write invariant. Use
read-only for reports and consistency-sensitive reads that should not block
writers.

## Locking

Two kinds of lock are worth understanding as a user.

**Per-key locks and write intents** are taken by every write, for the keys it
modifies. They are what enforces row write-write conflict detection, unique
index conflict detection, and atomic update of a row together with its index
entries.

**Point and range read locks** are how serializable read-write transactions
protect what they read. A shared point lock covers the exact key read; a
concurrent writer cannot modify it and still commit. If the same transaction
later writes that key, the lock is promoted to write protection. For scans, a
shared range lock covers the scanned span — overlapping scans still run
concurrently, but conflicting writes into the range are held back or retried.

When a transaction reads a very large number of rows, CamusDB escalates the
point locks into one shared whole-table or whole-bucket lock. Bookkeeping stays
bounded; the protected range gets wider.

### Pessimistic vs Optimistic

The default is pessimistic: locks are taken before conflicting work proceeds.
Optimistic locking is an opt-in strategy that skips the exclusive write lock and
validates at commit instead, aborting if a key it wrote was written concurrently
or a row it read changed. The application retries from the beginning.

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

This is a separate axis from isolation, and the combination is what determines
the guarantee:

| Combination | Behavior |
| --- | --- |
| `SERIALIZABLE` + pessimistic | Default. Locks taken up front. |
| `SERIALIZABLE` + optimistic | Hybrid: writes validate at commit, but reads and scans still take shared locks, so phantoms are still excluded. |
| `READ COMMITTED` + optimistic | Fully lock-free. Validates observed rows only; no predicate protection. |

`SET TRANSACTION LOCKING` must also run before any data statement, and can be
combined with `SET TRANSACTION ISOLATION LEVEL` in either order. HTTP and gRPC
clients select the strategy with the `locking` request field; operators change
the server-wide default with `default_transaction_locking`.

## How A Write Commits

For each `INSERT`, `UPDATE`, or `DELETE`, CamusDB:

1. starts a transaction and takes a server-assigned HLC timestamp
2. builds the row and index keys that must change
3. places provisional write intents and acquires the key-level locks
4. commits atomically through [Kahuna](https://kahunakv.github.io/)
5. releases the registered locks at transaction end

If another transaction is already writing a conflicting key, one side fails or
retries. Neither silently clobbers the other.

## Multi-Statement Transactions

Reach for an explicit `BEGIN` when several writes must commit together, when a
read-write sequence has to be all-or-nothing, or when you need a stable
serializable snapshot across several queries.

Aborts are normal here, not exceptional. Be ready to retry on write conflicts,
serialization conflicts, changed read dependencies, transient cross-partition
prepare or commit failures, schema catch-up fencing on a lagging node, and
lifetime expiration.

CamusDB does not replay aborted multi-statement transactions for you — the
client restarts from `BEGIN`. For single-statement autocommit work, the .NET
client ships a retry helper. See
[Retries And Conflicts](/docs/serializable-retries) for the contract.

One failure is not a retry signal: `TransactionMutationLimitExceeded` means the
transaction is too big, so replaying the same batch just fails again. See
[Transaction Limits](/docs/transaction-limits).

## Timestamps And Schema Safety

Every read-write transaction gets a Hybrid Logical Clock timestamp from Kahuna —
clients never assign their own. It identifies the transaction, orders committed
versions, and coordinates distributed commit. The resulting order is logically
consistent, not a real-time wall-clock guarantee. See
[Distributed Transactions And HLC](/docs/distributed-transactions).

CamusDB also pins schema versions for the tables a transaction touches. If a
table changes incompatibly before commit, the transaction is rejected rather
than committing a write that mixes old and new layouts.

## Single Node vs Cluster

The model is the same either way: MVCC reads, locks and intents on writes,
conflicts detected rather than ignored. A cluster adds partition routing,
per-partition leaders, majority-backed replication, two-phase commit across
partitions, and optional key-range routing.

Key-range routing is an opt-in alternative to the default hash routing. Because
contiguous keys are routed together, a scan holding a shared range lock does not
interfere with unrelated ranges. It only becomes meaningful once the cluster has
at least two partitions.

Serializable is not a single-node-only feature — anomaly coverage is exercised
on both a single node and a three-node cluster, including multi-partition
read-write transactions.

## What Is Guaranteed Today

Serializable is fully implemented, acceptance-tested, and the default. Covered
anomalies: read skew, phantoms, write skew, and lost updates. The implementation
uses wait-die deadlock fairness so contending transactions have a deterministic
winner, coordinator-owned range-lock renewal for long transactions, lock
escalation for very large reads, and tightened predicate-lock bounds for bounded
scans, `UPDATE`, and `DELETE`.

The known gap: there is no externally consistent commit-wait guarantee. Ordering
is logically consistent, not tied to real time.

## Related Pages

- [Transactions In SQL](/docs/sql-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Transaction Limits](/docs/transaction-limits)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Cluster Mode](/docs/cluster)
- [Distributed Schema Changes](/docs/distributed-schema)
- [Error Codes](/docs/error-codes)
