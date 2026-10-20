---
sidebar_position: 3.1
---

# Transaction limits

CamusDB bounds a read-write transaction. One transaction therefore cannot
accumulate an unbounded amount of write state, of lock state, or of work in the
commit payload.

The limits protect every client of the database. A transaction that stays open
for hours, or that changes millions of rows, holds locks that block other
transactions, and its commit can take a long time. If a job reaches a limit,
split the work into smaller transactions.

Three limits are visible to a user:

| Limit | Default | Applies to | Failure code |
| --- | --- | --- | --- |
| Serializable read-write lifetime | 1 hour | Serializable read-write transactions | `CADB0505 TransactionLifetimeExceeded` |
| Mutation count per transaction | 20,000 mutations | User `INSERT`, `UPDATE`, and `DELETE` transactions | `CADB0506 TransactionMutationLimitExceeded` |
| Idle time between statements | 5 minutes | Explicit transactions | `CADB0400`, "Unknown transaction", on the next statement |

A read-only transaction creates no mutation. The limit on the mutation count
therefore does not apply to it.

CamusDB can also place a node-local ceiling on the number of concurrent
coordinator sessions, with `kahuna.max_concurrent_sessions`. A coordinator
session is the server-side record that tracks one transaction until it ends. That gate is
disabled by default. Read [Transaction Priority](/docs/transaction-priority)
before you enable it. The gate orders queued starts by priority. It does not
replace short transactions, and it does not replace a correct batch size.

## Idle timeout

An explicit transaction (`BEGIN` ... `COMMIT`) that sends no statement for
`transaction_idle_timeout_ms` (default `300000`, 5 minutes) is treated as
abandoned. A background reaper rolls it back and releases its locks. The next
statement on that transaction fails. An autocommit statement is not affected.

A value of `0` or below turns the reaper off. An abandoned serializable
read-write transaction is then still bounded by its lifetime limit.

Today a node reads `transaction_idle_timeout_ms` once at startup. A change takes
effect after the node restarts.

## Limit on the mutation count

Every read-write transaction has a hard cap on the number of key/value (KV)
mutations that it can accumulate before the commit. CamusDB rejects a statement or an explicit
transaction that would exceed the cap. The rejection happens before the writes
reach storage.

The error is permanent for that shape of transaction. A retry of the same work
as one transaction fails again. Split the work into smaller transactions
instead.

## What counts as a mutation

CamusDB stores each row as one row blob. It stores each primary-key entry and
secondary index entry separately.

One mutation is one of these two operations:

- One write or delete of a row blob.
- One write or delete of a primary-key or secondary index entry.

The number of indexes therefore affects the write budget:

| Operation | Mutation count |
| --- | --- |
| Insert one row into a table with `K` secondary indexes | `2 + K` |
| Delete one row from a table with `K` secondary indexes | `2 + K` |
| Update one row and change `M` indexed columns | `1 + 2M` |

An out-of-line large value is one more mutation. A `STRING`, `BYTES`/`BLOB`, or
`ARRAY` value stored outside its row lives under its own key. An insert or
delete of a row with `L` out-of-line values therefore costs `L` more mutations.
An update that does not change the large value costs nothing extra for that
value, because the value key is carried rather than rewritten.

For example, a table with no secondary index and four large columns stored out
of line costs six mutations per inserted row: the row, the primary-key entry,
and four large-value keys. The default budget of 20,000 admits 3,333 rows in one
statement instead of 10,000. See [Large Values](/docs/storage-layout).

The counter only increases inside the transaction. Two updates of the same row
count twice, because CamusDB must still hold and commit both
[write intents](/docs/concepts#write-intent), the provisional writes that
become final at commit.

## Example

A table with two secondary indexes writes one row blob, one primary-key entry,
and two secondary index entries for each inserted row. One insert therefore
costs this much:

```text
1 row blob + 1 primary-key entry + 2 secondary index entries = 4 mutations
```

The default cap is 20,000 mutations. One transaction can therefore insert at
most 5,000 such rows. You must put the next row in another transaction.

`max_mutations_per_transaction` controls the cap. See
[Configuration](/docs/configuration). Set it to `<= 0` only when you intend to
disable the mutation limit on user DML.

## What to do about CADB0506

`CADB0506 TransactionMutationLimitExceeded` means that the transaction is too
large. It is not a signal to retry for serialization.

Do not retry the same transaction. Divide the work into batches instead:

```camussql
UPDATE orders
SET status = "shipped"
WHERE shipped_at IS NOT NULL
  AND id >= @start_id
  AND id < @end_id;
```

Run the statement again for each range. Advance the range each time, or use page
boundaries that your application manages. Continue until the job is complete.

To empty a whole table, use [`TRUNCATE`](/docs/truncate-table) instead of a
`DELETE`. That statement replaces the [key space](/docs/concepts#key-space) of
the table, the range of storage keys that holds its rows. It counts no
mutation, so it cannot exceed this limit.

## Limit on the lifetime

A serializable read-write transaction also has a maximum lifetime. The default
is one hour.

The limit stops a long transaction from an indefinite hold on read locks and
write intents. A later operation or `COMMIT` fails with `CADB0505
TransactionLifetimeExceeded` when the transaction passes the limit.

Expiry of the lifetime differs from `CADB0506`. It is a retryable serializable
failure. Roll the transaction back. Then replay it from `BEGIN`.

## Exempt internal work

Schema DDL and an internal backfill job can touch many rows or many index
entries for a valid reason. CamusDB runs such an internal transaction with the
limit on the mutation count disabled.

CamusDB always counts user DML.

## Related pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Error Codes](/docs/error-codes)
