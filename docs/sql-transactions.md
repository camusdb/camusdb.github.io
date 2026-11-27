---
sidebar_position: 2.5
---

# Transactions in SQL

A transaction groups statements so that they succeed or fail together. Start it
with `BEGIN` or `START TRANSACTION`, and end it with `COMMIT` or `ROLLBACK`. In
this transfer, both updates commit, or neither does.

```camussql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = @from;
UPDATE accounts SET balance = balance + 100 WHERE id = @to;
COMMIT;
```

A statement outside a transaction commits by itself. This is called autocommit.

The [camus-cli](/docs/camus-cli) shell and the [web console](/docs/web-console)
accept `BEGIN` and `COMMIT` as statements. In application code, use the
transaction methods of your driver, or the
[transaction endpoints](/docs/http-api#explicit-transactions) of the HTTP API.
The SQL endpoints of the HTTP API return `CADB0407` for `BEGIN`.

This page covers the SQL syntax. For the guarantees, see
[Transactions and isolation](/docs/serializable-transactions).

## Isolation

Serializable is the default. To choose the isolation level, run
`SET TRANSACTION ISOLATION LEVEL` as the first statement of the transaction.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

`READ ONLY` and `READ WRITE` are available with `SERIALIZABLE` only. For more
information, see [Read-only transactions](#read-only-transactions).

```camussql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
```

After a read or a write, `SET TRANSACTION` returns `CADB0400`.

With Read Committed, each statement can see the commits of other transactions.
This means that reads aren't repeatable across statements. For more
information, see
[Read Committed snapshots and limits](/docs/serializable-transactions#read-committed-snapshots-and-limits).

For a read-then-write decision, keep [SELECT FOR UPDATE](/docs/sql-queries#for-update)
and the write in one explicit transaction. The locks are released at commit or
rollback. An autocommit locking read can't protect a later request.

## Failed statements

When a statement fails in an explicit transaction, the transaction is aborted.
This includes a cancelled read, and a statement that isn't allowed, such as a
write in a read-only transaction. You can't commit the earlier writes. Roll
back, and start a new transaction. There are no savepoints to undo only the
failed statement.

Over HTTP and gRPC, the transaction is rolled back when the statement fails. A
later statement or `COMMIT` on the same transaction returns `CADB0400`
(`Unknown transaction`). `ROLLBACK` succeeds.

Note that in the current release, a statement that fails to parse doesn't
abort the transaction. For example, after a syntax error (`CADB0406`), the
earlier and later writes of the transaction can commit. Roll back after any
error.

In the SQL of a [trigger or procedure](/docs/csharp-extensions#sql-in-a-trigger-or-procedure),
a failed statement makes the transaction rollback-only. Later statements in it
return `CADB0824` (`TransactionRollbackOnly`).

Fix invalid input before you try again. For a retryable conflict, run the unit
of work again from `BEGIN`, as described in
[Retries and conflicts](/docs/serializable-retries).

## Read-only transactions

A read-only transaction is a good choice for a report or a data export. It
reads one consistent snapshot and takes no locks. It also can't change data by
mistake.

To make a transaction read-only, run `SET TRANSACTION ISOLATION LEVEL
SERIALIZABLE READ ONLY` as its first statement. You can also start it read-only
from the client. Send `"transactionMode": "ReadOnly"` over HTTP, or
`TRANSACTION_MODE_READ_ONLY` over gRPC.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SELECT SUM(balance) FROM accounts;
UPDATE accounts SET balance = 0 WHERE id = @id;
-- CADB0849: cannot execute UPDATE in a read-only transaction
ROLLBACK;
```

In a read-only transaction, these statements return `CADB0849`
(`ReadOnlyTransaction`) before they change anything.

- `INSERT`, including `INSERT ... ON CONFLICT` and `INSERT ... SELECT`
- `UPSERT`
- `UPDATE` and `DELETE`, including `UPDATE ... FROM` and `DELETE ... USING`
- `CREATE TABLE ... AS`
- Schema statements, such as `CREATE TABLE` or `TRUNCATE`
- `COMMENT ON` and `REFRESH MATERIALIZED VIEW`
- `nextval()` and `setval()`

`SELECT ... FOR UPDATE` returns `CADB0400` in a read-only transaction. The same
rules apply to an autocommit statement that asks for a read-only transaction,
and to the SQL of triggers and procedures. A refused statement aborts the
transaction, as described in [Failed statements](#failed-statements).

Note that an autocommit `SELECT` that asks for no mode can call `nextval()`. The
query endpoints read from a read-only snapshot for speed, but the request didn't
ask for a read-only transaction. If the request sends `"transactionMode":
"ReadOnly"`, `nextval()` returns `CADB0849`.

Server-level statements, such as `CREATE DATABASE` or `GRANT`, run outside any
transaction. The access mode doesn't apply to them.

A `SET TRANSACTION ISOLATION LEVEL` statement that names neither `READ ONLY`
nor `READ WRITE` doesn't change the mode. For example, a transaction that you
start read-only from the client doesn't become writable.

The snapshot of a read-only transaction is fixed when `SET TRANSACTION ... READ
ONLY` executes. If you start the transaction read-only from the client, the
snapshot is fixed when the transaction starts. After that,
`SET TRANSACTION ... READ WRITE` returns `CADB0400`. Start a read-write
transaction for the writes.

A Read Committed read-only transaction that you start from the client is
different. In it, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE` as
the first statement makes the transaction Serializable and writable.

## Transactional schema changes

Turn on `transactional_ddl_enabled` to apply a migration and its data changes
in one transaction. Later statements in the transaction can use the new schema
at once. `COMMIT` publishes the new schema with the transaction's row writes.
`ROLLBACK` discards both. Some changes to existing tables start enforcing new
constraints before commit.

```camussql
SET CLUSTER SETTING transactional_ddl_enabled = true;

BEGIN;
CREATE TABLE order_statuses (code STRING PRIMARY KEY, label STRING);
INSERT INTO order_statuses (code, label) VALUES ('pending', 'Pending');
COMMIT;
```

The setting is cluster-wide and defaults to `false`. With `false`, schema
statements that run in an explicit transaction commit separately. Their
changes survive a later `ROLLBACK`.

| Operation | Support with transactional DDL turned on |
| --- | --- |
| Tables | Create or drop a table. Table renames also participate. `CREATE TABLE ... AS SELECT` includes the selected rows in the transaction and is subject to [transaction limits](/docs/transaction-limits). |
| Columns, indexes, and constraints | Add or drop them. You can also rename columns and indexes or set and drop `NOT NULL`. See [Changes that scan existing rows](#changes-that-scan-existing-rows). |
| Storage settings | `ALTER TABLE ... SET` and `RESET`, and `ALTER COLUMN ... SET STORAGE`. |
| Regular views | Create or replace a view. You can drop it or use `ALTER VIEW` to change its name or owner. |
| Materialized views | Drop or rename a materialized view. |
| Sequences | Create or drop a sequence. Both renames and option changes use `ALTER SEQUENCE`. |
| Functions, triggers, and extensions | Create or drop them. You can also replace a function or change its owner, and update an extension. |
| Comments | [Object comments](/docs/comment-on) participate in the transaction. `COMMENT ON DATABASE` commits separately. |

With the setting enabled, run these statements in autocommit mode to avoid
`CADB0538`.

- [`TRUNCATE`](/docs/truncate-table)
- `ALTER TABLE ... REWRITE STORAGE`
- `ALTER SEQUENCE ... RESTART`
- `CREATE MATERIALIZED VIEW`
- `REFRESH MATERIALIZED VIEW`
- `CREATE TABLE ... RELINK`

`TRUNCATE` and `ALTER TABLE ... REWRITE STORAGE` also require autocommit
when the setting is off. The same applies to `ALTER SEQUENCE ... RESTART`.

The same error applies to dropping a materialized view if an interrupted
refresh left storage to clean up. Run the drop in autocommit mode.

Server and database administration statements, such as `CREATE DATABASE` and
`GRANT`, commit separately at either setting.

### Changes that scan existing rows

Schema changes that scan a table created in the same transaction can run
after writes to it. They read the transaction's own rows.

On a previously committed table, run these operations before changing the
table's schema or writing its rows. An index build or column fill also needs
to run before reads that take row locks, such as `SELECT ... FOR UPDATE` or
locking reads at Serializable. Otherwise, the statement returns `CADB0538`.
Adding a nullable column with no default needs no fill.

An online index build or column fill starts during the schema statement.
Concurrent writes maintain the new index or column before it becomes readable.
New `CHECK`, `NOT NULL`, and foreign key constraints apply to concurrent
writes as soon as enforcement begins. `COMMIT` makes the change permanent,
and `ROLLBACK` removes it.

When you add a foreign key to a previously committed table, the referenced
table must already exist. The transaction must add the key before changing the
referenced table's schema or rows. If the foreign key needs a new backing
index, the same row lock restriction applies to the referencing table.

### Sequence counters

`nextval` and `setval` change sequence counters immediately. A rollback
leaves those changes in place. For an existing sequence, an `ALTER SEQUENCE`
that changes how it issues values takes effect on the counter during commit.
Draws before then use the old definition, including draws in the transaction
that altered it.

### Commit and retry behavior

A transaction can change the schema of one database only. A schema change in a
second database returns `CADB0538`.

The first schema change of a transaction takes a DDL lock on the database
until the transaction ends. Other schema changes in that database wait for the
lock, also in autocommit. After 30 seconds, they return `CADB0504`. Writes don't
wait for this lock.

With transactional DDL enabled, autocommit schema statements share the DDL
lock. The first schema change in an explicit transaction can return
`CADB0504` after 30 seconds waiting for an active autocommit schema change.

When the transaction commits, queries that open the changed tables wait for the
new schema. A concurrent write that was planned against the old schema can
return `CADB0502`, and it must retry from `BEGIN`. If another schema change
commits while the transaction is open, its `COMMIT` returns `CADB0502`.

If `COMMIT` returns `CADB0509`, send `COMMIT` again on the same transaction. The
row writes can already be committed while the schema change waits for
confirmation. Don't run the work again. For more information, see
[Retry an unresolved finalize](/docs/serializable-retries#retry-an-unresolved-finalize).

## Locking strategy

Pessimistic locking is the default. It takes locks before it changes data.
Optimistic locking checks for conflicts at commit. To choose the strategy, run
`SET TRANSACTION LOCKING` before any read or write.

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

You can combine it with `SET TRANSACTION ISOLATION LEVEL` in either order.
`SELECT ... FOR UPDATE` needs pessimistic locking. In an optimistic
transaction, it returns `CADB0400`.

The isolation level decides what an optimistic transaction protects. For the
combinations, see
[Locking strategy](/docs/serializable-transactions#pessimistic-and-optimistic-locking).

## Priority

The priority of a transaction decides which waiting transaction starts first
when a node is overloaded. Transactions wait to start only when the admission
gate of the node is on, and the gate is off by default. After a transaction
starts, its priority doesn't change how it runs.

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

There are five levels, from `BACKGROUND` to `CRITICAL`. An unknown level
returns `CADB0400`. `SET TRANSACTION PRIORITY` must also come before any read or
write.

For the levels and the gate settings, see
[Transaction priority](/docs/transaction-priority).

## Related topics

- [Transactions and isolation](/docs/serializable-transactions)
- [Transaction priority](/docs/transaction-priority)
- [Transaction limits](/docs/transaction-limits)
- [Retries and conflicts](/docs/serializable-retries)
