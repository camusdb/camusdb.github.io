---
sidebar_position: 6
---

# Transaction internals

This page describes how CamusDB uses Kahuna and Kommander to execute
transactional SQL work. It is the implementation behind the guarantees in
[Transactions And Isolation](/docs/serializable-transactions).

## The layers

CamusDB does not implement the storage, the MVCC, or the replication from the
start.

The data path has three layers:

- CamusDB parses the SQL. It plans the statement, holds the catalog, maps the
  row keys and the index keys, and pins the schema.
- [Kahuna](https://kahunakv.github.io/) gives the transactional KV store, the
  MVCC versions, the locks, the write intents, the coordination of a
  transaction, and the two-phase commit.
- [Kommander](https://kahunakv.github.io/kommander.github.io/) gives the Raft
  replication, and an ordered durable commit across the nodes.

The isolation of CamusDB is therefore mostly a question of one map: how CamusDB
maps a SQL operation onto a Kahuna transaction.

## The model of a KV key

CamusDB encodes a row and an index as a deterministic key:

- A primary row is `{databaseId}:{tableId}:r/{rowId}`.
- A unique index entry is `{databaseId}:{tableId}:i:{indexId}/{value}`.
- A non-unique index entry is
  `{databaseId}:{tableId}:i:{indexId}/{value}{rowId}`.
- The schema metadata is `{databaseId}/meta/...`.

A database id and a table id are stable identities in the storage. You can
rename a SQL object without a rewrite of every row, because the keys of the rows
and of the indexes use the ids.

That layout matters for five mechanisms:

1. The routing to a partition.
2. The placement of a write intent.
3. The scope of a range lock.
4. The maintenance of the rows and the indexes inside one transaction.
5. The validation of the schema version at the commit.

## Transactions that a coordinator owns

A Kahuna transaction handle represents every read-write transaction. The handle
holds two fields:

- `TransactionId` is a Hybrid Logical Clock timestamp. Kahuna allocates it.
- `CoordinatorKey` is a stable routing key. It points at the coordinator session
  on the server.

CamusDB passes the handle through the whole life of the transaction. The Kahuna
coordinator owns the authoritative working set of the transaction. That set
holds the modified keys, the held locks, the read observations where they are
enabled, and the state of the two-phase commit.

Each transactional operation registers its confirmed effect with the
coordinator. It sends three values:

- The transaction id.
- The coordinator key.
- The id of that operation.

A second registration of the same operation is harmless. Kahuna can replay the
cached completion when a retry uses the same operation id. It therefore does not
apply the operation twice.

A retry of a batch can send a different subset of the pending work. CamusDB then
uses a new operation id, because that attempt represents different work.

The operation id also protects the window where an acknowledgement is lost. A
participant can apply a write, and it can then lose the response before the
coordinator records the completion. A retry with the same operation id lets the
participant replay the cached response and the payload of the completion. The
coordinator can therefore fold the effect. The participant does not apply the
write again.

The finalization is also safe to repeat. A commit, a rollback, and the cleanup
of an abandoned session share one slot for the finalize of a session. Two
concurrent callers observe the same attempt. A retryable `MustRetry` result does
not open the session again for a new data operation.

## What folds into the working set

The coordinator folds every successful transactional operation into the working
set that the server owns.

| Operation | State at the coordinator |
| --- | --- |
| A write or a delete | The modified key, plus its implicit point lock |
| An explicit point lock | The descriptor of the held point lock |
| A range lock | The descriptor of the held range lock, with its bounds and its mode |
| A read of the latest committed value, while the fold of the reads is enabled | The existence of the key, and its base revision |
| A registered scan | The read observations of the rows that the scan returned |

The commit and the rollback finalize from that accumulated state on the server.
CamusDB sends no list of modified keys, and no list of locks, at the end of the
transaction. The client builds neither list.

## The life of a transaction

A read-write transaction has this internal shape:

1. CamusDB starts a Kahuna transaction. It receives a transaction handle.
2. The SQL statements read rows, write rows, maintain the indexes, and acquire
   locks.
3. Each successful write, each delete, each relevant lock, and each tracked read
   registers with the coordinator.
4. CamusDB validates the schema pins of the tables that the transaction touched.
   It does so before the commit.
5. CamusDB calls the commit with the transaction handle.
6. Kahuna validates the registered read observations, where that check is
   necessary.
7. Kahuna prepares the registered mutations, with a fresh commit timestamp.
8. Kahuna commits the prepared mutations on every participant. It rolls them
   back if the prepare step fails.
9. The coordinator releases the locks. It then completes the session.

A rollback uses the same handle. The coordinator owns the working set already.
The rollback can therefore undo the registered state of the transaction. It
needs no list of keys from the client.

## Serializable read-only transactions

A serializable read-only transaction uses one pinned HLC snapshot timestamp.
Every statement of that transaction reads the same MVCC view. The transaction
takes no write lock, and it produces no write.

A client can resume such a transaction across requests, with the transaction id.
The server keeps enough state to identify the snapshot. It also keeps enough
state to finalize the empty transaction when the client commits or rolls back.

A read-only snapshot transaction is the preferred path for a report of several
statements. It is also the preferred path for another stable read that needs no
write.

## The fast path with zero identity

Some read paths use a transaction identity of zero, for a cheap committed read.
That path performs a read-committed point read. It starts no full Kahuna
transaction, and it registers no operation with a coordinator.

CamusDB uses the path with zero identity only when no working set on the server
is necessary. A commit and a rollback do nothing for that synthetic shape of a
transaction.

## The modes of a lock

Kahuna supports two strategies for the locks of a transaction. CamusDB defaults
to pessimistic locking.

### Pessimistic locking

A pessimistic transaction acquires a lock before any conflicting work
continues.

Note this behavior:

- A write acquires an exclusive point lock before it modifies a key.
- A write in contention blocks, retries, or aborts. The conflict rules of Kahuna
  decide.
- CamusDB usually resolves a conflict at the moment of the lock acquisition.
- The protection of a serializable scan uses a point lock or a range lock. The
  shape of the read decides which one.

This mode is the default for an ordinary SQL transaction. You can select it
explicitly in three ways: with `SET TRANSACTION LOCKING PESSIMISTIC`, with the
`locking` field of an HTTP or a gRPC request, or with
`default_transaction_locking: pessimistic`.

### Optimistic locking

An optimistic transaction skips an explicit exclusive write lock during the
normal execution. It validates at the commit instead.

Note this behavior:

- A write still registers the modified key and an implicit point lock.
- A read folds its observation, while the validation of the reads is active.
- CamusDB detects a write-write conflict during the prepare step.
- CamusDB detects a read-write conflict through the validation of the registered
  read observations.

The optimistic validation uses the rows that the transaction actually observed.

Read Committed with optimistic locking takes no lock. It gives no protection
against a new row that another transaction inserts, and that an earlier
predicate would have matched.

Serializable with optimistic locking is a hybrid. The writes are optimistic. A
read and a scan nevertheless take the shared point locks or range locks that a
predicate needs, for the protection against a phantom.

Optimistic locking is available in three ways: with `SET TRANSACTION LOCKING
OPTIMISTIC`, with the `locking` field of an HTTP or a gRPC request, and with
`default_transaction_locking: optimistic`. Kahuna pins the mode of the locks
when the coordinator session opens. In an explicit transaction, SQL can
therefore apply the mode only before the first data statement.

## The fold and the validation of a read

The fold of a read is the mechanism behind one check. It lets the coordinator
validate at the commit that the rows of the transaction are still compatible.

CamusDB folds a read only when the transaction needs the validation of its
reads:

- An optimistic transaction folds its reads.
- A transaction that requests the tracked validation of its reads folds its
  reads.
- A read of a pinned historical snapshot does not fold its reads.
- A read with zero identity does not fold its reads.

Five kinds of read must pass the coordinator key while the fold of the reads is
active: a point read, a batch fetch of rows, a table scan, an index scan, and a
merge scan of a branch. Otherwise the coordinator would not know which committed
revisions the transaction depended on.

## Range locks

A serializable read that has the shape of a scan uses a range lock. That lock
protects the predicate.

The coordinator owns a range lock:

- The acquisition registers with the transaction coordinator.
- The coordinator renews a live range lock on the tick of its collection
  interval.
- The final commit or the final rollback releases the locks.
- The lifetime of the transaction, and the timeout of the session, bound an
  abandoned session.

`range_lock_expires_ms` is the initial TTL that CamusDB requests at the
acquisition of a range lock. The validation at startup requires a value at least
twice the effective collection interval of Kahuna. The default value is `150000`
milliseconds. The default collection interval of Kahuna is `60000`
milliseconds.

## Point read locks

A serializable read-write transaction can also protect a point read. Two
examples are a lookup by row id, and a lookup on a unique index.

Note this behavior:

- A shared point lock permits concurrent readers.
- A writer that conflicts with an active read lock waits, retries, or aborts.
- CamusDB can promote the lock to the write protection that a commit needs, when
  the same transaction later writes the key.

## Lock escalation

A serializable read-write transaction can escalate many point locks into one
shared lock over a whole bucket. The point locks must belong to the same table
bucket, or to the same index bucket.

The default threshold is `50`.

That behavior gives four results:

- A smaller read keeps precise point locks.
- A large read avoids unbounded bookkeeping of the locks.
- A later read in the same bucket is covered already.
- The transaction can protect more of the table or of the index than the exact
  rows that it read.

## The durability of a commit decision

A transaction has a policy for the durability of its commit decision:

- `BestEffort` lets the coordinator keep the decision in memory. This policy is
  the default.
- `Durable` makes the coordinator write the decision to durable storage before
  it returns the result. A recovery can therefore finish the participants of the
  transaction after the loss of the coordinator.

The internal path of the begin selects a durable decision, for each transaction.
CamusDB does not expose that choice as a YAML setting at startup today.

For a durable decision, Kahuna anchors the decision to the first confirmed
persistent key that the transaction modified. The anchor decides the placement
of the internal metadata of the decision. It is not a SQL row that a user sees.

The flow of a durable commit has five steps:

1. Prepare each participant that is not the anchor.
2. Prepare the anchor participant, with the frozen set of the participants of
   the transaction.
3. Commit the anchor first. That step installs the durable commit decision.
4. Commit the remaining participants.
5. Persist the progress of the acknowledgements. Mark the decision as complete
   after every participant acknowledges.

A rollback is no longer a valid outcome after CamusDB installs the commit
decision of the anchor. Three events can follow: the coordinator loses its
leadership, the process stops, or the response to the commit is lost. In every
case, the recovery must continue to drive the participants until the committed
decision completes.

A persistent participant records a receipt of completion at its commit. That
receipt lets a recovery separate two states: "this participant committed
already", and "this participant still needs work". The separation holds even
after the original write intent disappears.

The operations of a recovery are safe to repeat. The path of a request and the
actor of the recovery can therefore race. They do not duplicate the committed
effect.

The boundary here is intentional. The durable mode of a decision protects the
transaction after the commit decision exists. It does not make the active
coordinator session durable from `BEGIN`. It also does not make every prepared
participant durable from `BEGIN`.

## MVCC and the HLC

Kahuna stores the committed versions, and the write intents that are in flight.
A reader sees a committed version, and it skips dirty data. A writer coordinates
through the locks and the write intents.

Each read-write transaction starts with an HLC transaction id. At the commit,
Kahuna uses a fresh commit timestamp. That timestamp is at least as new as two
values: the start timestamp of the transaction, and the values that the
transaction modified or depended on.

CamusDB therefore has a logical order of the transactions across the nodes. A
client never assigns a timestamp.

## The lifetime, and an abandoned transaction

A serializable read-write transaction has a cap on its lifetime, in wall-clock
time. The default is `3600000` milliseconds, which is one hour.

CamusDB checks the cap at the acquisition of a range lock, and at the commit. It
raises `TransactionLifetimeExceeded` when the transaction passes the cap. The
application must then retry the whole transaction from `BEGIN`.

CamusDB gives the same value to Kahuna, as the timeout of the coordinator
session. An abandoned session therefore has a bound for its cleanup on the
server. That bound holds even when a client opens a transaction and then
disappears, without a commit and without a rollback.

CamusDB also tracks an explicit client transaction with its own reaper for an
abandoned transaction. The reaper rolls a transaction back after it stays idle
long enough, with no statement from the client. The session timeout of Kahuna
remains the final backstop for the cleanup.

## The settings that touch this area

These are the public settings for a transaction and for the locks:

```yaml
default_isolation_level: serializable
default_transaction_locking: pessimistic
range_lock_expires_ms: 150000
max_serializable_transaction_lifetime_ms: 3600000
lock_escalation_threshold: 50
lock_wait_deadline_ms: 500
key_range_sharding: false
```

Note these details:

- `default_isolation_level` accepts `serializable` and `read_committed`.
- `default_transaction_locking` accepts `pessimistic` and `optimistic`.
- `range_lock_expires_ms` is the initial TTL of a range lock. A value of `0` or
  below disables the expiry. A positive value must be at least twice the
  effective collection interval of Kahuna.
- `max_serializable_transaction_lifetime_ms` bounds the life of a serializable
  read-write transaction. It also supplies the session timeout of Kahuna. A
  value of `0` or below disables the cap of CamusDB on the lifetime.
- `lock_escalation_threshold` decides when many point read locks in one bucket
  become one lock over that bucket.
- `lock_wait_deadline_ms` caps one wait for a lock acquisition, before CamusDB
  reports a conflict.
- `key_range_sharding` opts the row spaces of the tables, and the eligible
  secondary indexes, into the key-range routing of Kahuna.

Two internal defaults also exist:

- The validation of a read is off, except in an optimistic transaction, which
  validates its reads.
- The durability of a decision is best effort.

The begin path of a transaction selects those internal defaults. They are not
YAML settings at startup today.

## Behavior in a cluster

Cluster mode keeps the same SQL model of a transaction. It distributes the
mechanics:

- Each partition has its own Raft leader.
- CamusDB routes a write to the leader of the owning partition.
- A write across several partitions uses two-phase commit, across the leaders of
  the participants.
- HLC timestamps give the order of the transactions across the cluster.
- Optional key-range routing gives a scan more precise bounds for its range
  lock.

Serializable behavior is not a single-node feature. The transaction suite covers
read skew, phantoms, write skew, and lost updates. It covers them on a single
node, and on a cluster.

## Interaction with the schema

A transaction pins the schema version of each table that it touches.

The commit validates two conditions:

1. The identity of the table is still valid.
2. The pinned schema version is still compatible with the transaction.

That check stops a DML statement from a commit against a table definition that a
DDL statement dropped, replaced, or made incompatible.

## A map of the code

A contributor must start in these areas:

- `CamusDB.Core/Transactions/`
- `CamusDB.Core/Storage/Kv/KvTableStore.cs`
- `CamusDB.Core/Commands/Executor/Controllers/Queries/`
- `CamusDB.Core/Commands/Executor/QueryExecutor.cs`
- The transaction code and the storage code of Kahuna, behind `IKahuna`
