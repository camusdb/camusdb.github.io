---
sidebar_position: 3.1
---

# Transaction Limits

CamusDB bounds read-write transactions so one transaction cannot accumulate an
unbounded amount of write state, lock state, or commit payload work.

The two user-visible limits are:

| Limit | Default | Applies to | Failure code |
| --- | --- | --- | --- |
| Serializable read-write lifetime | 1 hour | Serializable read-write transactions | `CADB0505 TransactionLifetimeExceeded` |
| Per-transaction mutation count | 20,000 mutations | User `INSERT`, `UPDATE`, and `DELETE` transactions | `CADB0506 TransactionMutationLimitExceeded` |

Read-only transactions do not create mutations, so the mutation count limit does
not apply to them.

## Mutation Count Limit

Every read-write transaction has a hard cap on the number of KV mutations it can
accumulate before commit. If a statement or explicit transaction would exceed
the cap, CamusDB rejects it before sending the offending writes to storage.

The error is permanent for that transaction shape. Retrying the same work as one
transaction will fail again; split the work into smaller transactions.

## What Counts As A Mutation

CamusDB stores each row as one row blob, and secondary indexes are stored as
separate entries.

One mutation is:

- one row-blob write or delete
- one secondary-index entry write or delete

That means indexes affect the write budget:

| Operation | Mutation count |
| --- | --- |
| Insert one row into a table with `K` indexes | `1 + K` |
| Delete one row from a table with `K` indexes | `1 + K` |
| Update one row and change `M` indexed columns | `1 + 2M` |

The counter is monotonic inside the transaction. Updating the same row twice
counts twice because CamusDB still has to hold and commit the corresponding
write intents.

## Example

A table with two secondary indexes writes one row blob plus two index entries
per inserted row. Inserting one row costs:

```text
1 row blob + 2 index entries = 3 mutations
```

With the default 20,000-mutation cap, a single transaction can insert at most
6,666 such rows before it must be split into another transaction.

## Handling CADB0506

`CADB0506 TransactionMutationLimitExceeded` means the transaction is too large.
It is not a serialization retry signal.

Instead of retrying the same transaction, batch the work:

```camussql
UPDATE orders
SET status = "shipped"
WHERE shipped_at IS NOT NULL
  AND id >= @start_id
  AND id < @end_id;
```

Run the statement repeatedly with advancing ranges or application-managed page
boundaries until the job is complete.

## Lifetime Limit

Serializable read-write transactions also have a maximum lifetime. The default
is one hour.

This prevents a long-lived transaction from holding read locks and write intents
indefinitely. If the transaction outlives the cap, a later operation or `COMMIT`
fails with `CADB0505 TransactionLifetimeExceeded`.

Unlike `CADB0506`, lifetime expiration is a retryable serializable failure: roll
back the transaction and replay it from `BEGIN`.

## Exempt Internal Work

Schema DDL and internal backfill jobs can legitimately touch many rows or index
entries. CamusDB runs those internal transactions with the mutation count limit
disabled.

User DML is always counted.

## Related Pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Serializable Retries](/docs/serializable-retries)
- [Error Codes](/docs/error-codes)
