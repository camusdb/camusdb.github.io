---
sidebar_position: 5
---

# Serializable Retries

Serializable read-write transactions can fail by design when CamusDB detects a
conflict that would break serial order.

That failure is part of correctness. It means the transaction must be retried,
not that the database committed partial work.

## When Retries Happen

A serializable transaction may need to be replayed when:

- another transaction wrote a conflicting key
- a read dependency changed before commit
- a concurrent write invalidated the serial order
- the commit path hit a transient routing or leader transition condition
- a serializable read-write transaction exceeded its lifetime deadline

## Retryable Errors

The main retryable transaction codes are:

- `CADB0502` `TransactionConflict`
- `CADB0504` `TransactionMustRetry`
- `CADB0505` `TransactionLifetimeExceeded`

`CADB0503` `SchemaCatchingUp` is also commonly retryable, but it usually means
the node should catch up or the client should retry on another node.

See [Error Codes](/docs/error-codes) for the full list.

## Two Retry Patterns

CamusDB has two practical retry patterns.

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

## Long-Running Serializable Read-Write Transactions

Serializable read-write transactions hold locks. CamusDB renews range locks in
the background while the transaction is alive, so they are not limited by the
short range-lock TTL.

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
- avoid external side effects inside the retried section unless they are
  idempotent
- use serializable read-only for reports instead of serializable read-write
- treat retryable failures as part of normal concurrency control

## Related Pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Error Codes](/docs/error-codes)
