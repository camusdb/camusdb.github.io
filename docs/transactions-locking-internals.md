---
sidebar_position: 6
---

# Transaction Internals

It is aimed at contributors and operators who want to understand how the SQL
layer uses Kahuna and Kommander to execute reads and writes.

## Layering

CamusDB does not implement storage, MVCC, or replication from scratch.

The data path is split into three layers:

- CamusDB: SQL parsing, planning, catalog, row/index key mapping
- Kahuna: transactional KV, MVCC versions, locks, write intents, two-phase commit
- Kommander: Raft replication and ordered durable commit across nodes

The isolation story in CamusDB is therefore mostly about how CamusDB uses
Kahuna transactions.

## Data Model At The KV Layer

CamusDB rows and indexes are encoded as deterministic keys:

- primary rows: `{tableId}:r/{rowId}`
- unique indexes: `{tableId}:i:{indexId}/{value}`
- non-unique indexes: `{tableId}:i:{indexId}/{value}{rowId}`
- schema metadata: `{db}/meta/...`

That key layout matters for:

- partition routing
- write-intent placement
- range-lock scope
- row and index maintenance inside one transaction

## Isolation Levels

CamusDB now has two isolation levels in the transaction layer:

- `Serializable` as the default
- `Read Committed` as an explicit opt-out

Serializable then splits into two execution styles:

- serializable read-only transactions use a pinned snapshot timestamp
- serializable read-write transactions use read locks plus write locks

That distinction matters because the internal lock behavior is completely
different between those modes.

## Read Path

A standalone autocommit `SELECT` uses a synthetic read-only transaction.

Important internal properties:

- it uses a special read-only transaction identity
- in the zero-snapshot fast path it does not go through full Kahuna
  begin/commit round-trips
- it takes no write locks
- it reads committed MVCC state and skips in-flight intents

This is why ordinary reads are cheap and highly concurrent.

The Read Committed opt-out path is optimized for fresh committed reads, not for
holding a strong global snapshot across arbitrary multi-step query behavior.

Serializable read-only is different: it is pinned to one snapshot timestamp at
begin time, so every statement in the transaction reads the same MVCC view
without taking locks.

That snapshot transaction can also be resumed across requests by transaction
id, which is why the code treats it as a real long-lived transaction state
rather than just a one-shot query option.

When key-range routing is enabled and a scan needs phantom protection, CamusDB
can promote a read-only scan to a real Kahuna transaction identity so the scan
can hold a shared range lock during execution.

## Write Path

A write transaction follows this internal shape:

1. `BEGIN` asks Kahuna to start a transaction
2. Kahuna assigns the transaction an HLC timestamp
3. CamusDB tracks acquired locks, modified keys, and schema pins on
   `KvTransaction`
4. Kahuna prepare places write intents and acquires per-key locks
5. Kahuna commit turns prepared intents into committed versions
6. CamusDB releases held prefix or key-range locks that are not finalized by
   the normal write-intent commit path

This is the important distinction:

- write intents protect modified keys
- read-only range or prefix locks must be tracked and released separately

## Locking Model

### Per-Key Locks

Used by every write transaction.

Purpose:

- serialize conflicting writes to the same key
- coordinate row and index maintenance
- let the transaction fail on conflict instead of overwriting silently

### Range Locks

Used for phantom protection on scan-style operations.

Important implementation constraints:

- serializable read-write scans can take range locks even without key-range
  routing, because they need predicate protection to be correct
- Read Committed keeps the ordinary non-serializable scan-lock path mostly
  dormant
- point reads stay on the zero-snapshot fast path
- promoted read-only scans in key-range mode can hold shared range locks
- range locks matter primarily when key-range sharding is enabled and the
  cluster has multiple partitions
- writes do not need to take a matching range lock themselves; they are held
  back automatically if they try to modify a key inside an actively locked
  range

The important behavior change is that scans do not take exclusive range locks.
Shared scan locks allow overlapping readers to proceed concurrently while still
blocking conflicting writes into the covered range.

### Point Read Locks

Serializable read-write transactions can also take shared locks on keys read
through point lookup paths such as row-id and unique-index reads.

Important consequences:

- two serializable readers can coexist on the same key
- a writer trying to change a key under an active serializable reader is held
  back or forced to retry
- if the same transaction later writes a key it previously read, its shared
  lock can be promoted to the stronger write protection needed for commit

## Transaction Lifetime Guard

Serializable read-write transactions now have an explicit wall-clock lifetime
guard.

Important internal behavior:

- the default deadline is `CamusDBConfig.MaxSerializableTransactionLifetimeMs`
- the current default is `3600000`
- range locks are renewed by a background heartbeat before their TTL expires
- the guard is checked during range-lock acquisition and commit
- an over-deadline serializable read-write transaction throws
  `TransactionLifetimeExceeded`
- the transaction must then be rolled back and retried from the beginning

This guard exists because serializable read-write transactions depend on held
locks staying valid. Heartbeat renewal keeps live range locks fresh; the
lifetime guard bounds runaway transactions.

## Lock Escalation

Serializable read-write transactions can escalate many point locks on the same
table or index bucket into one shared whole-bucket lock.

The default threshold is `CamusDBConfig.LockEscalationThreshold = 50`.

That means:

- smaller reads keep precise point locks
- large reads avoid unbounded lock bookkeeping
- after escalation, later reads in the same bucket are already covered
- the transaction may protect more of the table than the exact rows it read

## MVCC

Kahuna stores multiple committed versions of a key plus possible in-flight
write intents.

The important behavioral summary is:

- readers see committed versions
- readers skip uncommitted intents
- writers do not have to wait for readers
- readers do not expose dirty data

This is the basis for the current non-blocking read path.

## Isolation Level Semantics

The practical default isolation level is now `Serializable`.

What exists already:

- atomic transactions
- durable commits
- no dirty reads
- write-write conflict detection
- Serializable by default
- serializable read-only snapshot transactions
- serializable read-write locking with read protection

The Read Committed opt-out path is weaker and should not be documented as
providing:

- one global snapshot per query
- repeatable reads across arbitrary multi-statement transactions
- full phantom protection in the default hash-routed configuration

What is materially stronger than the older story:

- Serializable is now the inherited default for new transactions
- in serializable read-only mode, transactions can hold a stable snapshot
  without taking locks
- in serializable read-write mode, point reads and scans are protected by
  shared locks held to commit
- in key-range mode, range scans can be coordinated with more precise range
  boundaries because they hold shared range locks and conflicting writes are
  delayed until those scans finish
- range-lock heartbeat renewal supports longer serializable read-write
  transactions
- lock escalation prevents very large reads from accumulating unbounded point
  locks

What is also clearer in the current implementation:

- serializable read-only snapshots are a first-class transaction mode, not just
  a planner special case
- serializable read-write conflicts are expected to fail fast and be retried by
  the client rather than waiting indefinitely
- the acceptance suite now explicitly covers read skew, phantoms, write skew,
  and lost updates on both single-node and clustered topologies
- wait-die conflict ordering gives contending transactions a deterministic
  winner instead of mutual aborts

That distinction is important when reviewing user-facing documentation or
changing transaction behavior.

## Cluster Behavior

Cluster mode preserves the same basic transaction semantics, but distributes the
mechanics:

- each partition has its own Raft leader
- writes are coordinated by the owning partition leader
- multi-partition writes use 2PC across participant leaders
- HLC timestamps provide cluster-wide transaction ordering

Key-range routing changes where locking and ordering happen, but it does not by
itself mean data is physically spread in a fundamentally different logical
model from the SQL layer's point of view.

Operationally, key-range routing requires at least two partitions before the
range-lock path becomes meaningful. In single-partition hash mode, promotion
and range-lock enforcement stay effectively dormant.

## Schema Interaction

Transactions pin schema versions for touched tables.

Commit validates:

- the table identity is still valid
- the pinned schema version is still current enough for the transaction to
  commit safely

This prevents DML from committing against a dropped, replaced, or incompatible
table definition after DDL changed the schema.

## Code Map

Contributors should start with these main areas:

- `CamusDB.Core/Transactions/`
- `CamusDB.Core/Storage/Kv/KvTableStore.cs`
- `CamusDB.Core/Commands/Executor/Controllers/Queries/`
- `CamusDB.Core/Commands/Executor/QueryExecutor.cs`
- Kahuna transaction and storage code behind `IKahuna`
