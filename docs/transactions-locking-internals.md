---
sidebar_position: 6
---

# Transaction Internals

This page is for contributors and operators who want to understand how CamusDB
uses Kahuna and Kommander to execute transactional SQL work.

## Layering

CamusDB does not implement storage, MVCC, or replication from scratch.

The data path is split into three layers:

- CamusDB: SQL parsing, planning, catalog, row/index key mapping, schema pins
- [Kahuna](https://kahunakv.github.io/): transactional KV, MVCC versions,
  locks, write intents, transaction coordination, and two-phase commit
- [Kommander](https://kahunakv.github.io/kommander.github.io/): Raft
  replication and ordered durable commit across nodes

The isolation story in CamusDB is mostly about how SQL operations are mapped
onto Kahuna transactions.

## KV Key Model

CamusDB rows and indexes are encoded as deterministic keys:

- primary rows: `{databaseId}:{tableId}:r/{rowId}`
- unique indexes: `{databaseId}:{tableId}:i:{indexId}/{value}`
- non-unique indexes: `{databaseId}:{tableId}:i:{indexId}/{value}{rowId}`
- schema metadata: `{databaseId}/meta/...`

Database ids and table ids are stable storage identities. SQL names can be
renamed without rewriting every row because rows and indexes are keyed by ids.

That layout matters for:

- partition routing
- write-intent placement
- range-lock scope
- row and index maintenance inside one transaction
- schema-version validation at commit

## Coordinator-Owned Transactions

Every read-write transaction is represented by a Kahuna transaction handle.
The handle contains:

- `TransactionId`: a Hybrid Logical Clock timestamp allocated by Kahuna
- `CoordinatorKey`: a stable routing key for the server-side coordinator
  session

CamusDB passes the handle through the transaction lifetime. The Kahuna
coordinator owns the authoritative working set for the transaction: modified
keys, held locks, read observations when enabled, and two-phase commit state.

Each transactional operation registers its confirmed effect with the
coordinator by sending:

- the transaction id
- the coordinator key
- a per-operation id

Registration is idempotent. If the same operation is retried with the same
operation id, Kahuna can replay the cached completion instead of applying the
operation twice. If a batch retry sends a different pending subset, CamusDB uses
a fresh operation id because that attempt represents different work.

The operation id also protects the acknowledgement-loss window. A participant
can apply a write and lose the response before the coordinator records
completion. Retrying the same operation id lets the participant replay the
cached response and completion payload, so the coordinator can fold the effect
without the participant applying it again.

Finalization is idempotent as well. Commit, rollback, and abandoned-session
cleanup share one finalize slot for the session. Concurrent callers observe the
same attempt, and a retryable `MustRetry` result does not reopen the session to
new data operations.

## What Folds Into The Working Set

The coordinator folds successful transactional operations into the server-owned
working set.

| Operation | Coordinator state |
| --- | --- |
| write or delete | modified key plus its implicit point lock |
| explicit point lock | held point-lock descriptor |
| range lock | held range-lock descriptor with bounds and mode |
| latest committed read with read folding enabled | key existence and base revision |
| registered scan | read observations for rows returned by the scan |

Commit and rollback finalize from that accumulated server state. CamusDB does
not send a client-built list of modified keys or locks at the end of the
transaction.

## Transaction Lifecycle

A read-write transaction follows this internal shape:

1. CamusDB starts a Kahuna transaction and receives a transaction handle.
2. SQL statements read rows, write rows, maintain indexes, and acquire locks.
3. Each successful write, delete, relevant lock, and tracked read registers
   with the coordinator.
4. CamusDB validates schema pins for touched tables before commit.
5. CamusDB calls commit with the transaction handle.
6. Kahuna validates the registered read observations when required.
7. Kahuna prepares the registered mutations with a fresh commit timestamp.
8. Kahuna commits the prepared mutations on all participants, or rolls them
   back if prepare fails.
9. The coordinator releases locks and completes the session.

Rollback uses the same handle. Since the coordinator already owns the working
set, rollback can undo the registered transaction state without a client-side
key list.

## Serializable Read-Only Transactions

Serializable read-only transactions use a pinned HLC snapshot timestamp. Every
statement in the transaction reads the same MVCC view without taking write
locks or producing writes.

These transactions can be resumed across requests by transaction id. The server
keeps enough transaction state to identify the snapshot and finalize the empty
transaction when the client commits or rolls back.

Read-only snapshot transactions are the preferred path for multi-statement
reports and other stable reads that do not need to write.

## Zero-Identity Fast Path

Some read paths use a zero transaction identity for cheap committed reads. This
path performs read-committed point reads without starting a full Kahuna
transaction and without registering operations with a coordinator.

The zero-identity path is used only when no server-owned working set is needed.
Commit and rollback are no-ops for that synthetic transaction shape.

## Locking Modes

Kahuna supports two transaction locking strategies. CamusDB defaults to
pessimistic locking.

### Pessimistic Locking

Pessimistic transactions acquire locks before conflicting work proceeds.

Important behavior:

- writes acquire exclusive point locks before modifying keys
- contending writes block, retry, or abort according to Kahuna's conflict rules
- conflicts are usually resolved when acquiring the lock
- serializable scan protection uses point or range locks depending on the read
  shape

This is the default for ordinary SQL transactions. It can be selected
explicitly with `SET TRANSACTION LOCKING PESSIMISTIC`, the HTTP `locking`
request field, or `default_transaction_locking: pessimistic`.

### Optimistic Locking

Optimistic transactions skip explicit exclusive write locks during normal
execution and validate at commit.

Important behavior:

- writes still register modified keys and implicit point locks
- reads fold observations when read validation is active
- write-write conflicts are detected during prepare
- read-write conflicts are detected by validating registered read observations

Optimistic validation is based on rows the transaction actually observed.
`Read Committed + Optimistic` is lock-free and does not protect against a newly
inserted row that would have matched an earlier predicate. `Serializable +
Optimistic` is a hybrid: writes are optimistic, but reads and scans still take
the shared point or range predicate locks required for phantom protection.

Optimistic locking is available through `SET TRANSACTION LOCKING OPTIMISTIC`,
the HTTP `locking` request field, and `default_transaction_locking:
optimistic`. Because Kahuna pins the locking mode when the coordinator session
opens, SQL can apply it only before the first data statement of an explicit
transaction.

## Read Folding And Validation

Read folding is the mechanism that lets the coordinator validate that rows read
by a transaction are still compatible at commit.

CamusDB folds reads only when the transaction needs read validation:

- optimistic transactions fold reads
- transactions that explicitly request tracked read validation fold reads
- pinned historical snapshot reads do not fold reads
- zero-identity reads do not fold reads

Point reads, batch row fetches, table scans, index scans, and branch merge scans
all need to pass the coordinator key when read folding is active. Otherwise the
coordinator would not know which committed revisions the transaction depended
on.

## Range Locks

Serializable scan-style reads use range locks for predicate protection.

Range locks are coordinator-owned:

- acquisition registers with the transaction coordinator
- the coordinator renews live range locks on its collection-interval tick
- final commit or rollback releases the locks
- an abandoned session is bounded by the transaction lifetime/session timeout

`range_lock_expires_ms` is the initial TTL requested when the range lock is
acquired. Startup validation requires it to be at least twice the effective
Kahuna collection interval. The default is `150000` milliseconds, while the
default Kahuna collection interval is `60000` milliseconds.

## Point Read Locks

Serializable read-write transactions can also protect point reads such as
row-id lookups and unique-index lookups.

Important behavior:

- shared point locks allow concurrent readers
- a writer that conflicts with an active read lock waits, retries, or aborts
- if the same transaction later writes the key, the lock can be upgraded to the
  write protection needed for commit

## Lock Escalation

Serializable read-write transactions can escalate many point locks in the same
table or index bucket into one shared whole-bucket lock.

The default threshold is `50`.

That means:

- smaller reads keep precise point locks
- large reads avoid unbounded lock bookkeeping
- later reads in the same bucket are already covered
- the transaction may protect more of the table or index than the exact rows it
  read

## Commit-Decision Durability

Transactions have a commit-decision durability policy.

- `BestEffort`: the coordinator can keep the decision in memory. This is the
  default.
- `Durable`: the coordinator writes the decision to durable storage before
  returning the result, so recovery can finish the transaction's participants
  after coordinator loss.

Durable decisions are selected per transaction by the internal begin path. They
are not currently exposed as a YAML startup setting.

For a durable decision, Kahuna anchors the decision to the first confirmed
persistent modified key in the transaction. The anchor is used for placement of
internal decision metadata; it is not a user-visible SQL row.

The durable commit flow is:

1. Prepare non-anchor participants.
2. Prepare the anchor participant with the transaction's frozen participant
   set.
3. Commit the anchor first, installing the durable commit decision.
4. Commit the remaining participants.
5. Persist acknowledgement progress and mark the decision completed after every
   participant is acknowledged.

Once the anchor commit decision is installed, rollback is no longer a valid
outcome for that transaction. If the coordinator loses leadership, the process
stops, or the commit response is lost, recovery must continue driving
participants until the committed decision is completed.

Persistent participants record completion receipts when committed. Those
receipts let recovery distinguish "this participant already committed" from
"this participant still needs work", even after the original write intent is
gone. Recovery operations are idempotent, so the request path and recovery actor
can race without duplicating the committed effect.

The boundary is deliberate: durable decision mode protects the transaction
after the commit decision exists. It does not make the active coordinator
session or every prepared participant independently durable from `BEGIN`.

## MVCC And HLC

Kahuna stores committed versions and in-flight write intents. Readers see
committed versions and skip dirty data. Writers coordinate through locks and
write intents.

Each read-write transaction starts with an HLC transaction id. At commit, Kahuna
uses a fresh commit timestamp that is at least as new as the transaction start
timestamp and the values the transaction modified or depended on.

This gives CamusDB a logical transaction order across nodes without requiring
clients to assign timestamps.

## Lifetime And Abandoned Transactions

Serializable read-write transactions have a wall-clock lifetime cap. The
default is `3600000` milliseconds, or one hour.

The lifetime cap is checked during range-lock acquisition and commit. If the
transaction exceeds the cap, CamusDB raises `TransactionLifetimeExceeded` and
the application should retry the whole transaction from `BEGIN`.

The same value is supplied to Kahuna as the coordinator session timeout. That
gives abandoned sessions a server-side cleanup bound even when a client opens a
transaction and disappears without calling commit or rollback.

Explicit HTTP transactions are also tracked by a CamusDB-side abandoned
transaction reaper. It rolls back transactions that sit idle with no client
statement long enough to be considered abandoned, while Kahuna's session timeout
remains the final cleanup backstop.

## Configuration Touchpoints

The public transaction and locking settings are:

```yaml
default_isolation_level: serializable
default_transaction_locking: pessimistic
range_lock_expires_ms: 150000
max_serializable_transaction_lifetime_ms: 3600000
lock_escalation_threshold: 50
lock_wait_deadline_ms: 500
key_range_sharding: false
```

Important details:

- `default_isolation_level` accepts `serializable` and `read_committed`.
- `default_transaction_locking` accepts `pessimistic` and `optimistic`.
- `range_lock_expires_ms` is an initial range-lock TTL; `<= 0` disables
  expiry. When positive, it must be at least `2x` the effective Kahuna
  collection interval.
- `max_serializable_transaction_lifetime_ms` bounds Serializable read-write
  transaction lifetime and also supplies the Kahuna session timeout; `<= 0`
  disables the CamusDB lifetime cap.
- `lock_escalation_threshold` controls when many point read locks in one bucket
  become a single bucket lock.
- `lock_wait_deadline_ms` caps one lock-acquisition wait before surfacing a
  conflict.
- `key_range_sharding` opts table row spaces and eligible secondary indexes
  into Kahuna key-range routing.

Internal defaults also exist for read validation and commit-decision
durability:

- read validation: none, except optimistic transactions validate reads
- decision durability: best effort

Those internal defaults are selected by the transaction begin path and are not
currently YAML startup settings.

## Cluster Behavior

Cluster mode preserves the same SQL transaction model while distributing the
mechanics:

- each partition has its own Raft leader
- writes are routed to the owning partition leader
- multi-partition writes use two-phase commit across participant leaders
- HLC timestamps provide cluster-wide transaction ordering
- optional key-range routing gives scans more precise range-lock boundaries

Serializable behavior is not a single-node-only feature. The transaction suite
covers read skew, phantoms, write skew, and lost updates on single-node and
cluster topologies.

## Schema Interaction

Transactions pin schema versions for touched tables.

Commit validates:

- the table identity is still valid
- the pinned schema version is still compatible with the transaction

This prevents DML from committing against a dropped, replaced, or incompatible
table definition after DDL changed the schema.

## Code Map

Contributors should start with these areas:

- `CamusDB.Core/Transactions/`
- `CamusDB.Core/Storage/Kv/KvTableStore.cs`
- `CamusDB.Core/Commands/Executor/Controllers/Queries/`
- `CamusDB.Core/Commands/Executor/QueryExecutor.cs`
- Kahuna transaction and storage code behind `IKahuna`
