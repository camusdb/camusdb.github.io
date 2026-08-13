---
sidebar_position: 5
---

# Retries And Conflicts

A serializable read-write transaction can fail on purpose. When CamusDB detects
a conflict that would break serial order, it aborts the transaction rather than
committing something that violates isolation.

That is correctness working, not a bug. No partial work is committed — the
transaction has to be replayed.

## What Causes A Retry

- another transaction wrote a conflicting key
- a read dependency changed before commit
- a concurrent write invalidated the serial order
- transaction start, routing, lock acquisition, or the storage write hit a
  transient pre-write condition
- the transaction exceeded its lifetime deadline

## Which Errors To Retry, And How

Not every transaction error means the same thing. The recovery action differs:

| Code | Error | Action |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | Replay from `BEGIN` |
| `CADB0504` | `TransactionMustRetry` | Replay from `BEGIN` |
| `CADB0505` | `TransactionLifetimeExceeded` | Replay from `BEGIN` |
| `CADB0503` | `SchemaCatchingUp` | Retry, usually after the node catches up or against another node |
| `CADB0509` | `TransactionFinalizeUnresolved` | Re-send the same finalize — see below |
| `CADB0506` | `TransactionMutationLimitExceeded` | Do not retry; split the workload |

See [Error Codes](/docs/error-codes) for the full list.

## Replaying From BEGIN

For `CADB0502`, `CADB0504`, and `CADB0505`, restart the entire unit of work:
begin again, rerun every read and write, commit again.

Do not resume from the middle of an aborted transaction. Once it aborts, the
only safe rule is to restart the whole thing — which is also why the retried
body should be self-contained and free of non-idempotent side effects.

In .NET, `CamusDB.Client` provides
`SerializableRetryHelper.ExecuteAutocommitAsync(...)` for single-statement work,
which replays retryable statements with backoff. Explicit multi-statement
transactions are the application's job to replay.

## Retrying An Unresolved Finalize

`CADB0509 TransactionFinalizeUnresolved` breaks the pattern. The transaction is
not known to be aborted and may already have committed, so replaying the
business operation risks applying it twice.

Send the same `COMMIT` or `ROLLBACK` again, for the same transaction id:

```camussql
COMMIT;
-- if CADB0509 is returned, send COMMIT again for the same transaction
```

Once finalize starts, no further data statements are accepted on that
transaction. An abandoned finalizing transaction is eventually bounded by the
server-side session timeout.

CamusDB retries this for you first. A finalize that comes back "outcome not known
yet" — a leadership flip mid-finalize, an in-progress drain, a participant write
shed under load — is retried on the same handle with backoff, bounded by a
wall-clock budget: `transaction_finalize_retry_budget_ms`, 15 seconds by default.
`CADB0509` is what you see when that budget runs out.

The bound is a duration rather than a count of attempts because every one of
those conditions resolves on its own schedule. A saturated node makes each
attempt take longer without making it take more attempts, so an attempt cap would
shrink the real budget exactly when the node most needs it. Raise the setting on
nodes that run hot; lower it if you would rather take the unresolved answer
sooner and retry it yourself.

## Keep Transactions Short

Read-write transactions hold locks. Kahuna's coordinator renews live range locks
while the transaction is alive, so the initial range-lock TTL is not a ceiling
on runtime — but there is a hard backstop, about one hour by default, after
which the transaction aborts with `TransactionLifetimeExceeded`.

Shorter transactions mean less contention, less deadlock risk, fewer retries,
and no lifetime expirations.

When you only need a stable view rather than a read-then-write invariant, use a
serializable read-only transaction instead. Snapshot reads do not take the
lock-heavy conflict path at all, which makes them the right tool for reports,
multi-step reads, and snapshot inspection across partitions.

## Related Pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Error Codes](/docs/error-codes)
