---
sidebar_position: 3.1
---

# Transaction limits

Each read-write transaction has limits on how long it can run and how much it
can write. A transaction that is open for hours, or that changes millions of
rows, has locks that block other transactions, and its commit can take a long
time. The limits protect all clients of the database. If a job reaches a limit,
split the work into smaller transactions.

The following limits apply to transactions:

| Limit | Default | Applies to | Error |
| --- | --- | --- | --- |
| Lifetime | 1 hour | Serializable read-write transactions | `CADB0505 TransactionLifetimeExceeded` |
| Mutations per transaction | 20,000 | User `INSERT`, `UPDATE`, and `DELETE` | `CADB0506 TransactionMutationLimitExceeded` |
| Idle time between statements | 5 minutes | Explicit transactions | `CADB0400` "Unknown transaction", on the next statement |
| Open explicit transactions | 10,000 per node | Explicit transactions | `CADB0558 ConcurrencyLimitExceeded` |

A read-only transaction doesn't create mutations, and the mutation limit
doesn't apply to it.

You can also limit the number of concurrent coordinator sessions on a node with
`kahuna.max_concurrent_sessions`. This limit is off by default. For more
information, see [Transaction priority](/docs/transaction-priority).

## Open explicit transactions

`max_open_explicit_transactions` limits the number of open explicit
transactions on a node (default `10000`). A begin over the limit returns
`CADB0558` `ConcurrencyLimitExceeded`, with HTTP 503. You should wait before
you retry. A commit, a rollback, or an idle timeout frees a slot. Autocommit
statements don't use a slot.

This is a [runtime cluster setting](/docs/runtime-cluster-settings). A value of
`0` or less turns off the limit. For the limits on SQL size, result memory, and
client connections, see
[request resource limits](/docs/settings-reference#request-resource-limits).

## Idle timeout

If an explicit transaction (`BEGIN` ... `COMMIT`) doesn't send a statement for
`transaction_idle_timeout_ms` (default `300000`, 5 minutes), it's treated as
abandoned. A background task rolls it back and releases its locks. The next
statement of that transaction returns `CADB0400` "Unknown transaction".
Autocommit statements aren't affected.

The background task checks for idle transactions at an interval of
`transaction_reaper_interval_ms` (default `30000`). This means that a transaction can stay open for up to one interval
after its idle timeout.

Both settings are runtime settings, and a change applies at the next run of the
task. A value of `0` or less for `transaction_idle_timeout_ms` turns off the
idle rollback. The lifetime limit continues to apply to an abandoned serializable
read-write transaction.

## Mutation limit

Each read-write transaction can collect at most `max_mutations_per_transaction`
key/value mutations before it commits. A statement that would go over the limit
returns `CADB0506`, before any write reaches storage.

A retry of the same work in one transaction will fail again. Split the work into
smaller transactions.

`max_mutations_per_transaction` is a runtime cluster setting (see
[Configuration](/docs/configuration)). You should set it to `0` or less only if
you want to turn off the mutation limit for user DML.

## What counts as a mutation

Each row is stored as one row entry. Each primary key entry and each secondary
index entry is stored separately. One mutation is a write or a delete of one of
these entries.

This means that the number of indexes changes the number of rows that one
transaction can write:

| Operation | Mutations |
| --- | --- |
| Insert one row into a table with `K` secondary indexes | `2 + K` |
| Delete one row from a table with `K` secondary indexes | `2 + K` |
| Update one row and change `M` indexed columns | `1 + 2M` |

For example, each row inserted into a table with two secondary indexes costs 4
mutations:

```text
1 row + 1 primary key entry + 2 secondary index entries = 4 mutations
```

With the default limit of 20,000 mutations, one transaction can insert 5,000 of
these rows.

Each large value stored outside its row adds one mutation when you insert or
delete the row. An update that doesn't change the large value doesn't add a
mutation for it. For more information, see [Large values](/docs/storage-layout).

The count only goes up in a transaction. If you update the same row twice, it
counts twice, because both [write intents](/docs/concepts#write-intent) (the
provisional writes that become final at commit) must be committed.

## What to do about CADB0506

`CADB0506 TransactionMutationLimitExceeded` means that the transaction is too
large. It isn't a signal to retry.

Don't retry the same transaction. Split the work into batches:

```camussql
UPDATE orders
SET status = 'shipped'
WHERE shipped_at IS NOT NULL
  AND id >= @start_id
  AND id < @end_id;
```

Run the statement once for each range, and move the range each time, until the
job is complete.

To empty a table, use [`TRUNCATE`](/docs/truncate-table) in place of `DELETE`.
`TRUNCATE` replaces the [key space](/docs/concepts#key-space) of the table, and
it doesn't count mutations.

## Lifetime limit

A serializable read-write transaction can be open for at most
`max_serializable_transaction_lifetime_ms` (default one hour). This limit stops
a transaction from holding read locks and write intents for a long time.

After the limit, `COMMIT` returns `CADB0505 TransactionLifetimeExceeded`. A
statement that reads a range of rows returns the same error. However, a write to
one row can succeed until the commit.

`CADB0505` is retryable. Roll back the transaction, then run it again from
`BEGIN`.

## Internal work

Schema changes and index backfill can write many rows or index entries. These
internal transactions don't have a mutation limit. User DML is always counted.

`ALTER TABLE ... REWRITE STORAGE` and materialized view refreshes work in
batches, and each batch has the regular mutation limit. Their batch sizes,
`large_value_rewrite_batch_rows` and `materialized_view_refresh_chunk_rows`,
must be at most half of `max_mutations_per_transaction`. If you lower
`max_mutations_per_transaction` below twice a batch size, the node doesn't
start. Lower the batch sizes too.

## Related pages

- [Transactions and isolation](/docs/serializable-transactions)
- [Retries and conflicts](/docs/serializable-retries)
- [Error codes](/docs/error-codes)
