---
sidebar_position: 5
---

# Retries and conflicts

A serializable read-write transaction can fail by design. CamusDB aborts a
transaction when it detects a conflict that would break the serial order. It
does not commit a result that violates isolation.

The abort is correctness at work. It is not a defect. CamusDB commits no partial
work. Your application must replay the transaction.

## What causes a retry

A retry follows one of these five conditions:

- Another transaction wrote a key that conflicts.
- A read dependency changed before the commit.
- A concurrent write invalidated the serial order.
- A transient condition stopped the transaction before its write. That condition
  can occur at the start, during the routing, at lock acquisition, or at the
  storage write.
- A read or scan reached a range whose current state could not be served before
  the server-side retry budget expired.
- The transaction passed its lifetime deadline.

## Which errors to retry, and how

Two transaction errors do not always mean the same thing. The recovery action
differs:

| Code | Error | Action |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | Replay from `BEGIN` |
| `CADB0504` | `TransactionMustRetry` | Replay from `BEGIN` |
| `CADB0505` | `TransactionLifetimeExceeded` | Replay from `BEGIN` |
| `CADB0503` | `SchemaCatchingUp` | Retry, usually after the node catches up, or against another node |
| `CADB0509` | `TransactionFinalizeUnresolved` | Send the same finalize again. See below. |
| `CADB0506` | `TransactionMutationLimitExceeded` | Do not retry. Split the workload. |

See [Error Codes](/docs/error-codes) for the full list.

## Replay from BEGIN

For `CADB0502`, `CADB0504`, and `CADB0505`, restart the whole unit of work.
Begin again. Run every read and every write again. Commit again.

Do not resume from the middle of an aborted transaction. After an abort, the
only safe rule is a restart of the whole transaction. For that reason, keep the
body of the transaction self-contained. Keep it free of side effects that you
cannot repeat.

In .NET, `CamusDB.Client` provides
`SerializableRetryHelper.ExecuteAutocommitAsync(...)` for single-statement work.
The helper replays a retryable statement with backoff. An explicit transaction of
several statements remains the responsibility of the application.

## Retry an unresolved finalize

`CADB0509 TransactionFinalizeUnresolved` is different from the other codes.
CamusDB does not know that the transaction aborted, and the transaction may
already have committed. A replay of the business operation therefore risks a
second application of the same work.

Send the same `COMMIT` or `ROLLBACK` again, for the same transaction id:

```camussql
COMMIT;
-- if CADB0509 is returned, send COMMIT again for the same transaction
```

After the finalize starts, CamusDB accepts no further data statement on that
transaction. The server-side session timeout bounds an abandoned transaction
that stays in the finalize state.

CamusDB retries this for you first. Four conditions can make a finalize report
that the outcome is not known yet:

1. A change of leadership during the finalize.
2. A drain that is in progress.
3. A participant that shed a write under load.
4. A transport or unexpected fault after the commit request already left the
   node.

CamusDB retries the finalize on the same handle, with backoff. A wall-clock
budget bounds the retries: `transaction_finalize_retry_budget_ms`, which is 15
seconds by default. You receive `CADB0509` when that budget runs out.

The bound is a duration, not a count of attempts. Each of the four conditions
above resolves on its own schedule. A saturated node makes each attempt slower,
but it does not make the number of attempts larger. A cap on attempts would
therefore shrink the real budget exactly when the node needs it most. Raise the
setting on a node that runs hot. Lower it if you prefer the unresolved answer
sooner, and if you prefer to retry it yourself.

## Keep transactions short

A read-write transaction holds locks. The Kahuna coordinator renews a live range
lock while the transaction is alive. The initial range-lock TTL is therefore not
a limit on the run time. A hard backstop remains, at about one hour by default.
After that time the transaction aborts with `TransactionLifetimeExceeded`.

A short transaction gives less contention, less risk of deadlock, fewer retries,
and no expiry of the lifetime.

Use a serializable read-only transaction when you need a stable view, and not a
read-then-write invariant. A snapshot read does not take the conflict path with
its many locks. That makes a read-only transaction the correct tool for a
report, for a read of several steps, and for inspection of a snapshot across
partitions.

## Related pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Error Codes](/docs/error-codes)
