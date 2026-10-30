---
sidebar_position: 3.1
---

# Transaction limits

CamusDB bounds every read-write transaction, so no single transaction can pile
up unbounded write state, lock state, or commit payload.

These limits protect every client of the database. A transaction that stays
open for hours, or that changes millions of rows, holds locks that block other
transactions, and its commit can take a long time. If a job hits a limit, split
the work into smaller transactions.

Three limits are visible to users:

| Limit | Default | Applies to | Failure code |
| --- | --- | --- | --- |
| Serializable read-write lifetime | 1 hour | Serializable read-write transactions | `CADB0505 TransactionLifetimeExceeded` |
| Mutation count per transaction | 20,000 mutations | User `INSERT`, `UPDATE`, and `DELETE` transactions | `CADB0506 TransactionMutationLimitExceeded` |
| Idle time between statements | 5 minutes | Explicit transactions | `CADB0400`, "Unknown transaction", on the next statement |

A read-only transaction creates no mutations, so the mutation limit does not
apply to it.

CamusDB can also cap the number of concurrent coordinator sessions on a node
with `kahuna.max_concurrent_sessions`. A coordinator session is the server-side
record that tracks one transaction until it ends. This gate is disabled by
default; read [Transaction Priority](/docs/transaction-priority) before you
enable it. The gate orders queued starts by priority. It is not a substitute
for short transactions or sensible batch sizes.

## Node request and transaction capacity

`max_open_explicit_transactions` limits the node to 10,000 open explicit
transactions by default. A begin beyond the cap returns `CADB0558`
(`ConcurrencyLimitExceeded`, HTTP 503). Commit, rollback, reaping, and failed
starts release slots. Autocommit does not consume these slots.

This is separate from Kahuna's coordinator-session gate: it bounds tracked
client transactions rather than ordering starts by priority. It is
runtime-mutable; `0` or below disables it. Back off before retrying a refused
begin. See [request resource limits](/docs/configuration#request-resource-limits)
for SQL-size, result-memory, and client-connection caps.

## Idle timeout

An explicit transaction (`BEGIN` ... `COMMIT`) that sends no statement for
`transaction_idle_timeout_ms` (default `300000`, 5 minutes) is treated as
abandoned. A background reaper rolls it back and releases its locks, and the
next statement on that transaction fails. Autocommit statements are not
affected.

A value of `0` or below turns the reaper off. An abandoned serializable
read-write transaction is then still bounded by its lifetime limit.

Today a node reads `transaction_idle_timeout_ms` once at startup, so a change
takes effect after the node restarts.

## Mutation count limit

Every read-write transaction has a hard cap on the number of key/value (KV)
mutations it can accumulate before commit. CamusDB rejects any statement or
explicit transaction that would exceed the cap, before the writes reach
storage.

The error is permanent for that transaction shape: retrying the same work as
one transaction fails again. Split the work into smaller transactions instead.

## What counts as a mutation

CamusDB stores each row as one row blob, and stores each primary-key entry and
secondary index entry separately.

One mutation is either:

- One write or delete of a row blob.
- One write or delete of a primary-key or secondary index entry.

So the number of indexes affects your write budget:

| Operation | Mutation count |
| --- | --- |
| Insert one row into a table with `K` secondary indexes | `2 + K` |
| Delete one row from a table with `K` secondary indexes | `2 + K` |
| Update one row and change `M` indexed columns | `1 + 2M` |

Each out-of-line large value adds one more mutation. A `STRING`, `BYTES`/`BLOB`,
or `ARRAY` value stored outside its row lives under its own key, so inserting
or deleting a row with `L` out-of-line values costs `L` extra mutations. An
update that leaves the large value unchanged costs nothing extra for it,
because the value key is carried over rather than rewritten.

For example, a table with no secondary indexes and four large columns stored
out of line costs six mutations per inserted row: the row, the primary-key
entry, and four large-value keys. The default budget of 20,000 then admits
3,333 rows in one statement instead of 10,000. See
[Large Values](/docs/storage-layout).

The counter only goes up within a transaction. Updating the same row twice
counts twice, because CamusDB must still hold and commit both
[write intents](/docs/concepts#write-intent) (the provisional writes that
become final at commit).

## Example

In a table with two secondary indexes, each inserted row writes one row blob,
one primary-key entry, and two secondary index entries:

```text
1 row blob + 1 primary-key entry + 2 secondary index entries = 4 mutations
```

With the default cap of 20,000 mutations, one transaction can insert at most
5,000 such rows. The next row has to go in another transaction.

`max_mutations_per_transaction` controls the cap (see
[Configuration](/docs/configuration)). Set it to `<= 0` only if you really want
to disable the mutation limit on user DML.

## What to do about CADB0506

`CADB0506 TransactionMutationLimitExceeded` means the transaction is too large.
It is not a serialization retry signal.

Do not retry the same transaction. Split the work into batches instead:

```camussql
UPDATE orders
SET status = 'shipped'
WHERE shipped_at IS NOT NULL
  AND id >= @start_id
  AND id < @end_id;
```

Run the statement once per range, advancing the range each time (or using page
boundaries your application manages), until the job is complete.

To empty a whole table, use [`TRUNCATE`](/docs/truncate-table) instead of
`DELETE`. It replaces the table's [key space](/docs/concepts#key-space) (the
range of storage keys that holds its rows) and counts no mutations, so it
cannot exceed this limit.

## Lifetime limit

A serializable read-write transaction also has a maximum lifetime, one hour by
default.

This limit stops a long transaction from holding read locks and write intents
indefinitely. Once the transaction passes the limit, the next operation or
`COMMIT` fails with `CADB0505 TransactionLifetimeExceeded`.

Unlike `CADB0506`, lifetime expiry is a retryable serializable failure. Roll the
transaction back, then replay it from `BEGIN`.

## Exempt internal work

Schema DDL and internal backfill jobs can legitimately touch many rows or index
entries. CamusDB runs these internal transactions with the mutation limit
disabled.

User DML is always counted.

## Related pages

- [Transactions And Isolation](/docs/serializable-transactions)
- [Retries And Conflicts](/docs/serializable-retries)
- [Error Codes](/docs/error-codes)
