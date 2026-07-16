---
sidebar_position: 3
---

# Transactions, Locking And Isolation

CamusDB runs all SQL work inside transactions, including single-statement
queries.

Serializable isolation is the default. Read Committed remains available only
when a transaction explicitly opts down.

For application developers, the baseline guarantees are:

- atomic writes
- durable commits
- no dirty reads
- write-write conflict detection
- serializable execution by default
- atomic cross-partition writes through two-phase commit

## Isolation Levels

CamusDB supports two isolation levels:

- `Serializable`, the default
- `Read Committed`, an explicit opt-out for workloads that prefer lower
  isolation overhead

If a transaction does not ask for another level, it runs as Serializable.

## Serializable By Default

Serializable means the result is equivalent to running committed transactions
one at a time in some order.

CamusDB uses two serializable execution modes:

- serializable read-only snapshot transactions
- serializable read-write locking transactions

Both modes work on a single node and across a cluster.

## Serializable Read-Only Transactions

A serializable read-only transaction is pinned to a single consistent snapshot
timestamp when it begins.

That means:

- every statement in the transaction reads from the same snapshot
- committed writes that happen later are not observed
- repeated reads stay stable
- the transaction does not need to take locks to get that consistency

This is the right mode for:

- reports
- multi-statement analytical reads
- consistency-sensitive reads that should not block writes

CamusDB can keep that snapshot open across several requests when the client
resumes the same transaction by transaction id. That makes it suitable for
consistent multi-query reports, not just one SQL statement.

## Serializable Read-Write Transactions

A serializable read-write transaction uses locking in addition to MVCC.

The important user-facing behavior is:

- point reads can hold shared point locks
- scan-style reads can hold shared range locks
- writes acquire exclusive key-level protection
- a key read by the transaction cannot be changed underneath it and still
  commit successfully
- conflicting serializable read-write transactions may have to retry

This is the mode to use when correctness depends on a read-then-write invariant
that should behave as if transactions ran one at a time.

Kahuna's transaction coordinator renews live range locks while the transaction
is alive. CamusDB also keeps a hard maximum lifetime as a backstop. The current
default cap is one hour. If a transaction outlives that cap, a later operation
or commit fails with `TransactionLifetimeExceeded` instead of silently
continuing without protection.

Read-write transactions also have a mutation count limit. The default is 20,000
row/index mutations per transaction. If a transaction would exceed that budget,
CamusDB fails it with `TransactionMutationLimitExceeded`; split the workload
into smaller transactions instead of retrying the same batch.

## How To Select Isolation

Serializable is the default, so most transactions do not need an isolation
statement.

You can still be explicit as the first statement of a transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

For a lock-free serializable snapshot:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
```

To opt down to Read Committed:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

The isolation statement must run before the transaction has already executed
reads or writes. CamusDB rejects retroactive changes because earlier statements
would have missed the locks or snapshot setup required for the chosen isolation
mode.

## Read Committed Opt-Out

Read Committed is still available when a workload intentionally chooses lower
isolation.

At this level:

- reads return committed MVCC versions
- reads skip uncommitted write intents
- writes still use locks, intents, and atomic commit
- readers do not block readers
- readers do not wait on in-flight writers

Read Committed should not be treated as guaranteeing:

- one global snapshot across every sub-read in a query
- fully repeatable reads across a long multi-statement transaction
- phantom protection across arbitrary range scans
- protection from write-skew style logic bugs based only on read-then-decide
  application code

Use Read Committed only when those tradeoffs are acceptable.

## Read-Only Queries

A plain `SELECT` outside an explicit transaction normally runs as a read-only
transaction.

Under the default Serializable behavior, read-only work uses a consistent
snapshot when it needs a transaction-scoped view. In cheaper read paths, CamusDB
still reads committed MVCC versions and skips in-flight write intents, so
readers stay highly concurrent.

There are two details to keep in mind:

- serializable read-only transactions do not need locks for snapshot
  consistency
- serializable read-write scans can take shared locks so the scanned data
  cannot be changed incompatibly before commit

## Writes

`INSERT`, `UPDATE`, and `DELETE` run as read-write transactions.

For each write, CamusDB:

1. starts a transaction and gets a server-assigned HLC timestamp
2. builds the row and index keys that must change
3. places provisional write intents and acquires the needed key-level locks
4. commits the write atomically through Kahuna
5. lets the Kahuna transaction coordinator release the registered locks at
   transaction end

If another transaction is already writing a conflicting key, one side fails or
must retry instead of silently clobbering data.

## Multi-Statement Transactions

CamusDB supports explicit transaction statements:

```camussql
BEGIN;
COMMIT;
ROLLBACK;
```

Use an explicit transaction when:

- several writes must commit together
- a sequence of reads and writes should either all succeed or all fail
- you need a consistent serializable read-only snapshot
- you need a serializable read-write unit that protects a business invariant

Applications should be ready to retry transactions that fail because of:

- write conflicts
- serialization conflicts
- read dependency changes
- transient cross-partition prepare or commit failures
- temporary schema catch-up fencing on a lagging node
- serializable read-write lifetime expiration

`TransactionMutationLimitExceeded` is different: it means the transaction is too
large, not that it lost a serialization race. The fix is to reduce the batch
size.

CamusDB does not automatically replay aborted explicit multi-statement
transactions for you. If a serializable read-write transaction fails on conflict
or deadline, the client must restart it from `BEGIN`.

For single-statement autocommit serializable work, CamusDB includes a retry
helper that replays retryable work with backoff.

See [Serializable Retries](/docs/serializable-retries) for the retry contract.
See [Transaction Limits](/docs/transaction-limits) for mutation and lifetime
limits.

## Locks You Should Care About

CamusDB uses two user-relevant categories of locks.

### Per-Key Locks And Write Intents

Every write transaction uses per-key locking and write intents for the keys it
modifies.

This is what enforces:

- row write-write conflict detection
- unique-index conflict detection
- atomic update of rows and their index entries

### Point And Range Read Locks

Serializable read-write transactions can also protect what they read.

For point reads:

- a shared point lock can be held on the exact key that was read
- a concurrent writer cannot safely modify that key and still commit
- if the same transaction later writes that key, the read protection is
  promoted to the stronger write protection needed for commit

For scan-style reads:

- a shared range lock can be held on the scanned range
- overlapping scans can still proceed concurrently
- conflicting writes into that locked range are held back or retried

If a transaction reads many rows from the same table or index, CamusDB can
escalate many point locks into one shared whole-table or whole-bucket lock. This
keeps lock bookkeeping bounded at the cost of protecting a larger range.

## Pessimistic vs Optimistic Locking

The default serializable read-write path uses pessimistic locking: CamusDB asks
Kahuna to take the needed locks before conflicting work is allowed to proceed.
This is the behavior exposed by normal SQL transactions and the one most
applications should use for read-then-write invariants.

CamusDB also supports optimistic transactions as an advanced, opt-in
concurrency strategy. Optimistic transactions skip the explicit exclusive write
lock and validate at commit instead:

- a conflicting write to the same key aborts one transaction
- a changed row that the transaction read can abort the commit
- the application retries the whole transaction from the beginning

Optimistic validation is based on the rows the transaction actually observed.
The important boundary is the isolation level:

- `Read Committed + Optimistic` is the fully lock-free mode. It validates
  observed rows, but it does not protect predicates from phantoms.
- `Serializable + Optimistic` is a hybrid. Writes are optimistic, but
  Serializable reads and scans still take shared point or range locks, so the
  transaction remains phantom-safe.

Use Serializable when a transaction needs phantom protection for range-based
business rules. Use Read Committed + Optimistic only when observed-row
validation is enough for the workload.

This is separate from the SQL isolation level. `SET TRANSACTION ISOLATION LEVEL`
chooses `Serializable` or `Read Committed`; `SET TRANSACTION LOCKING` chooses
the concurrency strategy.

Use `SET TRANSACTION LOCKING` as the first statement of an explicit
transaction:

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

You can also be explicit about the default behavior:

```camussql
BEGIN;
SET TRANSACTION LOCKING PESSIMISTIC;
```

The locking statement must run before the transaction executes a data statement.
It can be combined with `SET TRANSACTION ISOLATION LEVEL` in either order, as
long as both appear before reads or writes. HTTP clients can also select the
same strategy with the `locking` request field, and operators can change the
server default with `default_transaction_locking`.

## Key-Range Routing And Scan Protection

CamusDB supports two routing models underneath the SQL layer:

- hash routing as the default
- key-range routing as an opt-in mode

Serializable scans take the locks they need for predicate protection. Key-range
routing can improve range-scan concurrency because contiguous keys are routed
together, so a scan over one range does not need to interfere with unrelated
ranges.

When key-range routing is enabled:

- scans can hold shared range locks over the covered key span
- conflicting writes into the scanned range are held back until the scan
  finishes
- disjoint ranges can proceed with less unnecessary interference

Operationally, the key-range locking path only becomes meaningful when the
cluster has at least two partitions.

## HLC Timestamps

Every read-write transaction gets a server-assigned Hybrid Logical Clock
timestamp from Kahuna.

That timestamp is used to:

- identify the transaction
- order committed versions
- coordinate distributed commit across nodes

Clients do not assign these timestamps themselves.

The ordering is logically consistent, but it should not be read as a strict
real-time wall-clock ordering guarantee.

See [Distributed Transactions And HLC](/docs/distributed-transactions) for the
cross-partition timestamp and commit flow.

## Schema Safety During Transactions

CamusDB pins schema versions for the tables a transaction touches.

If a table changes incompatibly before commit, the transaction can be rejected
instead of silently mixing old and new layouts in one write.

This protects DML from committing against an invalid table definition after DDL
changed the schema.

## Single Node vs Cluster

The core transaction model is the same in both cases:

- reads use MVCC
- writes use locks, intents, and atomic commit
- conflicts are detected rather than ignored

Cluster mode adds:

- partition routing
- per-partition leaders
- majority-backed replication
- two-phase commit across partitions when needed
- optional key-range routing for more precise range-scan coordination

Serializable behavior is not a single-node-only feature. The anomaly coverage
is exercised on both a single node and a 3-node cluster, including
multi-partition read-write transactions.

## Current Status

Serializable is fully implemented, acceptance-tested, and the default isolation
level.

The current anomaly coverage includes:

- read skew prevention
- phantom prevention
- write skew prevention
- lost update prevention

The implementation includes:

- wait-die deadlock fairness, so contending transactions have a deterministic
  winner
- coordinator-owned range-lock renewal for long-running serializable read-write
  transactions
- lock escalation for very large reads
- tighter predicate-lock bounds for bounded scans, `UPDATE`, and `DELETE`

CamusDB still does not provide an externally consistent commit-wait guarantee.
Its serializable ordering is logically consistent, not tied to real-time
wall-clock ordering.

## Practical Guidance

For application design, these are the useful rules:

- rely on the default Serializable isolation for correctness-sensitive
  workflows
- use serializable read-only transactions for consistent reports and stable
  multi-statement reads
- wrap serializable read-write workflows in a retry loop
- keep retried transaction bodies idempotent and self-contained
- use Read Committed only when you explicitly accept its weaker guarantees
- treat `TransactionConflict`, `TransactionMustRetry`, and
  `TransactionLifetimeExceeded` as retryable

## Related Pages

- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Serializable Retries](/docs/serializable-retries)
- [Cluster Mode](/docs/cluster)
- [Distributed Schema Changes](/docs/distributed-schema)
- [Error Codes](/docs/error-codes)
