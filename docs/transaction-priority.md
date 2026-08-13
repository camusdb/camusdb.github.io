---
sidebar_position: 3.05
---

# Transaction Priority

Priority decides queueing order. When a node is at its configured concurrency
ceiling and transactions have to wait to start, the higher-priority ones go
first.

Priority is recorded by default, but it does not delay any transaction unless
the [Kahuna](https://kahunakv.github.io/) admission gate is enabled with
`kahuna.max_concurrent_sessions`. With the default
`max_concurrent_sessions: 0`, every transaction is admitted immediately and
priority is only observable in engine metrics.

## What Priority Does

Priority decides which queued transaction starts next when the local node is at
its configured concurrent-session ceiling.

It does not:

- preempt a transaction that already started
- reduce CPU, I/O, memory, or lock usage for a running transaction
- make a lower-priority lock holder yield to a higher-priority waiter
- change isolation, two-phase commit, durability, or conflict detection
- provide cluster-wide fairness across nodes

Think of priority as admission ordering, not runtime scheduling. If the goal is
to make background work consume less, use rate limits and load backoff instead.

## Priority Levels

| Priority | Use For |
| --- | --- |
| `Background` | Bulk or deferrable work that should yield to ordinary traffic. |
| `Low` | Below-normal work that is still latency-relevant. |
| `Normal` | Default application traffic. |
| `High` | Latency-sensitive work that should start ahead of ordinary traffic. |
| `Critical` | Work that should avoid deferral when reserved admission slots exist. |

Do not mark ordinary application traffic as `Critical`. If everything is
critical, priority stops carrying useful information and any reserved capacity
is consumed by ordinary work.

## SQL Usage

Set priority at the start of an explicit transaction:

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

Accepted values are case-insensitive:

- `BACKGROUND`
- `LOW`
- `NORMAL`
- `HIGH`
- `CRITICAL`

`SET TRANSACTION PRIORITY` must run before the first data statement and before
the coordinator session starts. CamusDB rejects the statement with
`CADB0400 InvalidInput` if the transaction has already executed work or if the
priority no longer has a coordinator admission point to affect.

It can be combined with isolation and locking settings as part of the
transaction setup:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET TRANSACTION LOCKING OPTIMISTIC;
SET TRANSACTION PRIORITY HIGH;
UPDATE orders SET status = "processing" WHERE id = @id;
COMMIT;
```

## HTTP Usage

HTTP SQL requests can set `priority` when they start an autocommit transaction:

```json
{
  "databaseName": "factory",
  "sql": "UPDATE jobs SET status = @status WHERE id = @id",
  "priority": "high",
  "parameters": {
    "status": { "type": 1, "strValue": "running" },
    "id": { "type": 0, "strValue": "6a3dd713d615ae230488d7f2" }
  }
}
```

Explicit transactions can set priority on `/start-transaction`:

```json
{
  "databaseName": "factory",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadWrite",
  "locking": "Pessimistic",
  "priority": "background"
}
```

When a request resumes an existing transaction id, `priority` is ignored because
the transaction was already admitted. Unknown values fail with
`CADB0400 InvalidInput`.

## gRPC Usage

The gRPC API has a `TransactionPriority` enum:

```text
TRANSACTION_PRIORITY_UNSPECIFIED = 0
TRANSACTION_PRIORITY_BACKGROUND  = 1
TRANSACTION_PRIORITY_LOW         = 2
TRANSACTION_PRIORITY_NORMAL      = 3
TRANSACTION_PRIORITY_HIGH        = 4
TRANSACTION_PRIORITY_CRITICAL    = 5
```

`TRANSACTION_PRIORITY_UNSPECIFIED` means "use the server default". It never
means `Background`.

Priority is available on:

- `SqlRequest`
- `StartTxnRequest`
- row-level insert, query, update, and delete requests

As with HTTP, priority applies only when the request starts a transaction. It is
ignored when a request resumes an existing transaction handle.

## Server Default

The server default priority is `normal`:

```yaml
default_transaction_priority: normal
```

Accepted values are:

- `background`
- `low`
- `normal`
- `high`
- `critical`

Precedence is:

1. `SET TRANSACTION PRIORITY`
2. HTTP/gRPC request priority
3. `default_transaction_priority`
4. built-in `Normal`

Changing the default priority only changes the tag applied to transactions that
do not choose one. It still has no admission effect unless
`kahuna.max_concurrent_sessions` is greater than `0`.

## Admission Gate Settings

The admission gate is configured under `kahuna:`:

```yaml
kahuna:
  max_concurrent_sessions: 0
  transaction_priority_reserved_slots: 0
  transaction_priority_aging_threshold: 1000
  transaction_priority_max_queued: 4096
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `kahuna.max_concurrent_sessions` | `0` | Maximum coordinator sessions admitted concurrently on this node. `0` disables the gate. |
| `kahuna.transaction_priority_reserved_slots` | `0` | Slots reserved for `High` and `Critical` transactions when a ceiling is active. |
| `kahuna.transaction_priority_aging_threshold` | `1000` | Milliseconds a queued transaction waits before gaining one effective priority level. `0` disables aging. |
| `kahuna.transaction_priority_max_queued` | `4096` | Maximum transactions that may wait at the gate. `0` means unbounded. |

`max_concurrent_sessions` is a ceiling on concurrent transaction work, not on
client connections. CamusDB opens coordinator sessions for user transactions
and for some internal work such as schema checkpoints, catalog lookups,
statistics publication, and index backfill.

Use this gate carefully. A ceiling below normal healthy concurrency turns a
healthy node into a queueing node. If you enable it, size it at or above
observed healthy concurrency and reserve at least one slot for high-priority
work. A reserved-slot value greater than or equal to the ceiling is rejected at
startup.

Keep `max_concurrent_sessions` at `0` unless you have tested the admission
behavior with your workload and have a clear overload-control goal.

### How Long A Transaction Waits At The Door

A transaction that cannot be admitted queues for the **admission wait budget**,
then fails with the retryable `CADB0504`. Nothing was started, so retrying is
always safe — but the node is shedding load, and the retry should back off.

```yaml
transaction_admission_wait_ms: 0   # 0 = leave the node's own budget in force

kahuna:
  default_admission_wait_ms: 5000  # node-side default when a caller asks for nothing
  max_admission_wait_ms: 30000     # hard clamp on any caller-supplied budget
```

This is deliberately not the transaction lifetime.
`max_serializable_transaction_lifetime_ms` (one hour by default) bounds how long
an *admitted* transaction may live, and doubles as the abandoned-session reaper
window. The budget above bounds how long an *unadmitted* one waits to begin. A
transaction meant to run for an hour is not thereby willing to wait an hour to
start.

Keep the budget short — seconds. Lengthening it does not increase throughput; it
converts a prompt, retryable refusal into a slow one, and every waiting
transaction occupies a queue slot that `transaction_priority_max_queued` would
otherwise give to someone else.

## Aging And Starvation

Aging prevents low-priority work from starving forever. A queued transaction's
effective priority rises one level per
`kahuna.transaction_priority_aging_threshold` milliseconds of waiting.

At the default `1000` milliseconds, a `Background` transaction reaches `High`
after roughly three seconds in the queue. That means `Background` is a soft
yield measured in seconds, not a "run only when idle" class.

Increase the threshold if background work should wait longer. Setting it to
`0` disables aging and allows indefinite starvation of low-priority work.

## Internal Priorities

CamusDB also tags internal maintenance work:

| Work | Priority | Why |
| --- | --- | --- |
| User statements | `Normal` | Default application behavior. |
| Index backfill | `Background` | Bulk, batched, deferrable work. |
| Statistics flush and analyze publish | `Background` | Maintenance where delay affects optimizer freshness, not correctness. |
| Schema checkpoint persist | `High` | A stalled checkpoint can block distributed DDL progress. |
| Database-registry cache-miss lookup | `High` | Runs under already-admitted user work and should avoid priority inversion. |

CamusDB does not tag internal work as `Critical`.

## Observability

Use [`SHOW ENGINE STATS`](/docs/engine-stats) to inspect admission metrics:

```camussql
SHOW ENGINE STATS LIKE 'kahuna.tx_admission%';
```

Admission metrics are tagged by priority. Useful signals include:

- `kahuna.tx_admission.in_flight`
- `kahuna.tx_admission.queued`
- `kahuna.tx_admission.max_queue_depth`
- `kahuna.tx_admission.admitted`
- `kahuna.tx_admission.aged_promotions`
- `kahuna.tx_admission.abandoned_while_waiting`
- `kahuna.tx_admission.rejected_queue_full`

`queued` is the first metric to check. If it is zero, the gate is transparent
and your ceiling is not binding. Sustained non-zero values at `High` or
`Critical` usually mean the ceiling is too low for the offered load or reserved
capacity is too small.

## Related Pages

- [Transactions In SQL](/docs/sql-transactions)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Engine Stats](/docs/engine-stats)
