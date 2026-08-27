---
sidebar_position: 3.05
---

# Transaction priority

CamusDB can give each transaction a relative importance. When a node is
saturated, the work that matters to you then starts before the work that does
not.

The feature is off by default. It does nothing until you configure a ceiling on
concurrency. CamusDB records the priority from the first release, and you can
observe it. CamusDB defers no transaction until an operator sets
`kahuna.max_concurrent_sessions`. Read [Turn the gate on](#turn-the-gate-on)
before you set it.

## What it does, and what it does not do

Priority decides which queued transaction starts next when the node is at its
configured ceiling. That is the whole feature.

Three consequences are worth a plain statement, because each one surprises
people:

- It orders the starts, not the execution. An admitted transaction competes for
  CPU, for I/O, and for locks like any other transaction. CamusDB preempts
  nothing, throttles nothing, and deschedules nothing. For a long statement,
  priority decides one instant, and nothing after that instant.
- It does not affect a lock conflict. A `Background` transaction that holds an
  exclusive lock blocks a `Critical` transaction as hard as a `Normal` one does.
  Priority does not touch isolation, two-phase commit, or the commit semantics.
- It applies per node. Each node orders only the work that it receives. There is
  no fairness across the cluster.

Priority is the wrong control if your goal is to reduce the resources that
background work consumes. Priority only decides who starts first under
contention. A rate limit is the correct control. See
[What makes background work cheap](#what-makes-background-work-cheap).

## The scale

| Priority | Use for |
|---|---|
| `Background` | Bulk work that you can defer. It yields to everything. |
| `Low` | Below ordinary traffic, but still relevant to latency. |
| `Normal` | The default. Everything that does not state another value. |
| `High` | Latency-critical work that must start before ordinary traffic. |
| `Critical` | Work that CamusDB must not defer. |

Do not tag ordinary application traffic as `Critical`. The order carries no
information if everything is critical. `Critical` can also claim reserved
capacity. Too much use of it therefore destroys the reserve that makes the
setting useful.

## Set a priority

In SQL, the statement must be the first one of the transaction. It must come
before any data statement:

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

The accepted values are `BACKGROUND`, `LOW`, `NORMAL`, `HIGH`, and `CRITICAL`.
Case does not matter. You can combine the statement with `SET TRANSACTION
LOCKING` and `SET TRANSACTION ISOLATION LEVEL`, in any order. All of them must
come before the first data statement.

CamusDB consumes the priority when the coordinator session opens. You therefore
cannot change the priority after the first statement of the transaction. CamusDB
rejects a later `SET TRANSACTION PRIORITY`. It does not ignore it in silence.

Over HTTP, use the `priority` field. It is available on `/start-transaction` and
on the `execute-sql-*` endpoints:

```json
{ "databaseName": "mydb", "priority": "background" }
```

CamusDB rejects an unknown value with `InvalidInput`. It treats `priority` like
`locking` and `isolationLevel`.

Over gRPC, use the `priority` field. It is available on `SqlRequest`, on
`StartTxnRequest`, and on the row-level CRUD requests. An unset field means the
server default. It never means `Background`.

The server default is `default_transaction_priority` in `config.yml`:

```yml
default_transaction_priority: normal   # background | low | normal | high | critical
```

The order of precedence is `SET TRANSACTION PRIORITY`, then the per-request
field, then `default_transaction_priority`, then `Normal`.

## Turn the gate on

Take care with this part. All the settings are under `kahuna:` in `config.yml`:

```yml
kahuna:
  max_concurrent_sessions: 64             # 0 (default) = no gate at all
  transaction_priority_reserved_slots: 2  # slots only High/Critical may use
  transaction_priority_aging_threshold: 1000
  transaction_priority_max_queued: 4096
```

### max_concurrent_sessions is a ceiling on work, not on connections

CamusDB opens a coordinator session for every transaction. That includes its own
catalog writes, its schema checkpoints, and its index backfill. The setting
therefore bounds the total concurrent engine work on the node.

A ceiling below your normal concurrency makes a healthy node into a node that
queues. It adds latency for no benefit. Set the value at or above the
concurrency that you observe when the node is healthy. The purpose of the
setting is to shed and to order surplus load.

The Kahuna admission guide describes this setting for a client that holds one
session per user session. It bounds connections in that case. That advice does
not apply to CamusDB.

### A reserve is almost always necessary

Engine-internal work shares the same ceiling. Set
`transaction_priority_reserved_slots` to 1 or more whenever you set a ceiling.
Without a reserve, a flood of user traffic can put a schema checkpoint or a
registry lookup in the queue behind it.

A reserve of 1 or 2 is usually enough. CamusDB subtracts the reserve from the
slots that ordinary traffic may use. A large reserve therefore throttles your
common case. CamusDB rejects a reserve at or above the ceiling at startup.

### Aging bounds starvation, and erodes separation quickly

The effective priority of a waiter rises one level for each
`transaction_priority_aging_threshold` of wait time. Low-priority work therefore
cannot starve forever.

The default threshold is 1,000 ms. A `Background` transaction therefore reaches
`High` after about three seconds of wait time. `Background` is a soft yield
measured in seconds. It is not a class that runs only when the node is idle.

Raise the threshold to tens of seconds to make background work genuinely
patient. The threshold is one global rate. A higher value therefore also
lengthens the worst-case wait of an ordinary transaction that is genuinely
starved. A value of `0` disables aging, and it permits starvation without limit.

### How long a transaction waits at the door

A transaction that CamusDB cannot admit waits in a queue for the admission wait
budget. It then fails with the retryable code `CADB0504`. CamusDB started
nothing, so a retry is always safe. The node sheds load in this state, so your
retry must use a backoff.

```yml
transaction_admission_wait_ms: 0          # 0 = leave the node's own budget in force

kahuna:
  default_admission_wait_ms: 5000         # node-side default when a caller asks for nothing
  max_admission_wait_ms: 30000            # hard clamp on any caller-supplied budget
```

This budget is not the transaction lifetime, and the difference is intentional.
`max_serializable_transaction_lifetime_ms`, one hour by default, bounds the life
of an admitted transaction. It is also the window of the reaper that removes an
abandoned session. The budget above bounds the wait of a transaction that
CamusDB has not admitted yet.

A transaction that must run for an hour is not therefore willing to wait an hour
to start. A long wait at the door also makes a saturated node hold requests open
instead of a shed of that load.

Keep the budget short, in seconds. A longer budget does not increase throughput.
It only converts a prompt retryable refusal into a slow one. Each transaction in
the queue also occupies a slot that `transaction_priority_max_queued` would
otherwise give to another transaction.

## What makes background work cheap

Priority decides who starts first. It does not reduce what an admitted
transaction consumes. For that purpose CamusDB uses a rate limit and a backoff
that reacts to load. Both work while the gate is off:

- `auto_analyze_max_rows_per_second` caps the row rate of the background
  statistics scan.
- `auto_analyze_load_pause_threshold` pauses or cancels a background analyze
  when the foreground transactions in flight exceed a threshold. CamusDB checks
  the threshold again during the scan, not only at the start.

The auto-analyze scan itself passes through no admission gate. It runs on a
snapshot with zero identity, and it holds no coordinator session. No ceiling
applies to it. Only its short write that publishes the statistics passes through
the gate.

The same is true of any read-committed autocommit `SELECT`. Such a statement
holds no session, and CamusDB never defers it.

## What CamusDB tags internally

| Work | Priority | Reason |
|---|---|---|
| User statements | `Normal` | The default. |
| Index backfill | `Background` | Bulk work, in batches, which CamusDB can defer. It is the best fit for the gate, because it enters admission again for each batch. |
| Statistics flush and analyze publish | `Background` | Maintenance work. A deferred flush costs only the freshness of the optimizer statistics. |
| Schema checkpoint persist | `High` | A stalled checkpoint blocks DDL across the cluster, and a deadline already bounds its commit. |
| Cache-miss lookup in the database registry | `High` | It runs under a user request that CamusDB already admitted. A queue for it would stall work that the gate already let in. |

CamusDB tags nothing as `Critical`.

## Observability

The Kahuna node exposes admission gauges under `kahuna.tx_admission.*`. Each
gauge carries a tag for the priority. The gauges are `in_flight`, `queued`,
`max_queue_depth`, `admitted`, `aged_promotions`, `abandoned_while_waiting`, and
`rejected_queue_full`.

Watch `queued` first. A value of zero means that the gate is transparent, and
that your ceiling does not bind. A value above zero at `High` or `Critical`, over
a long period, means one of two things. The ceiling is too low for the offered
load, or the configuration needs a reserve.
