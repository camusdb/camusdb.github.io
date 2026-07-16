---
sidebar_position: 5
---

# Serializable Retries

Serializable read-write transactions can fail by design when CamusDB detects a
conflict that would break serial order.

That failure is part of correctness. It means the transaction must be replayed
from the beginning, not that the database committed partial work.

## When Retries Happen

A serializable transaction may need to be replayed when:

- another transaction wrote a conflicting key
- a read dependency changed before commit
- a concurrent write invalidated the serial order
- transaction start, routing, lock acquisition, or storage write conflict hit a
  pre-write transient condition
- a serializable read-write transaction exceeded its lifetime deadline

## Retryable Errors

The main replay-from-`BEGIN` transaction codes are:

- `CADB0502` `TransactionConflict`
- `CADB0504` `TransactionMustRetry`
- `CADB0505` `TransactionLifetimeExceeded`

`CADB0503` `SchemaCatchingUp` is also commonly retryable, but it usually means
the node should catch up or the client should retry on another node.

`CADB0506` `TransactionMutationLimitExceeded` is not retryable. It means the
transaction is larger than the mutation budget, so the workload must be split
into smaller transactions.

`CADB0509` `TransactionFinalizeUnresolved` is retryable, but not by replaying
from `BEGIN`. It means a `COMMIT` or `ROLLBACK` did not reach a terminal answer
after CamusDB's bounded same-handle retries. Re-issue the same finalize request
against the same transaction id. Do not rerun the business operation, because
the original commit may already have succeeded server-side.

See [Error Codes](/docs/error-codes) for the full list.

## Replay From `BEGIN`

These patterns apply to `CADB0502`, `CADB0504`, and `CADB0505`.

### Autocommit Serializable Statements

For single-statement work in .NET, `CamusDB.Client` includes
`SerializableRetryHelper.ExecuteAutocommitAsync(...)`, which re-executes
retryable serializable work with backoff.

Use this pattern when the whole unit of work is one statement or one
application operation that can be safely replayed as a whole.

### Explicit Multi-Statement Transactions

For explicit transactions, the application must replay the whole transaction
from `BEGIN`.

That means:

1. start the transaction again
2. rerun every read and write in the same logical unit
3. try `COMMIT` again

Do not resume from the middle of a failed serializable read-write transaction.
Once it aborts, the safe rule is to restart the entire unit.

## Retry The Same Finalize

`CADB0509 TransactionFinalizeUnresolved` has a different rule. The transaction
is not known to be aborted, and it may already have committed. The only safe
recovery is to send the same `COMMIT` or `ROLLBACK` again for the same
transaction id:

```camussql
COMMIT;
-- if CADB0509 is returned, send COMMIT again for the same transaction
```

After finalize starts, no more data statements are accepted on that transaction.
An abandoned finalizing transaction is eventually bounded by the server-side
transaction session timeout.

## Long-Running Serializable Read-Write Transactions

Serializable read-write transactions hold locks. Kahuna's transaction
coordinator renews live range locks while the transaction is alive, so the
initial range-lock TTL is not the transaction's maximum runtime.

There is still a hard maximum lifetime as a backstop. The current default is
about one hour. If the transaction stays open beyond that cap, CamusDB aborts
it with `TransactionLifetimeExceeded`.

Short transactions reduce:

- contention
- deadlock risk
- retry frequency
- lifetime-expiration failures

## Serializable Read-Only Is Different

Serializable read-only snapshot transactions do not use the same lock-heavy
conflict path.

They are the right choice for:

- consistent reports
- multi-step reads
- snapshot-style inspection across partitions

When you only need a stable read view, prefer serializable read-only over
serializable read-write.

## Practical Guidance

- wrap serializable read-write operations in a retry loop
- keep the retried unit small and self-contained
- treat `CADB0509` as a same-finalize retry, not a replay signal
- avoid external side effects inside the retried section unless they are
  idempotent
- use serializable read-only for reports instead of serializable read-write
- treat retryable failures as part of normal concurrency control

## Related Pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Error Codes](/docs/error-codes)
