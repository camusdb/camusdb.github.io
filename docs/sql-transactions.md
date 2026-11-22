---
sidebar_position: 2.5
---

# Transactions in SQL

Group statements into a transaction with `BEGIN` or `START TRANSACTION`, and end
it with `COMMIT` or `ROLLBACK`:

```camussql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = @from;
UPDATE accounts SET balance = balance + 100 WHERE id = @to;
COMMIT;
```

A statement outside a transaction gets one automatically: CamusDB wraps it in a
single-operation transaction and commits it.

This page covers the SQL syntax. For the guarantees behind it, see
[Transactions And Isolation](/docs/serializable-transactions).

## Isolation

Serializable is the default. You can also set it explicitly at the start of a
transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
COMMIT;
```

Serializable has read-only and read-write modes. For more information, see
[Read-only transactions](#read-only-transactions).

```camussql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
```

Read Committed is available as an explicit opt-out:

```camussql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

In an explicit pessimistic Read Committed transaction, each ordinary SELECT sees a
single committed snapshot plus the transaction's own writes. The next
statement takes a new snapshot; reads are not repeatable across statements.
Autocommit `SELECT` also uses a pinned statement snapshot under either default
isolation level. Read Committed write statements use a statement snapshot for
their locate/source read phase, followed by latest-value locked reads when
applying changes.
Optimistic and read-validation modes retain latest-value reads with validation.
See [Read Committed snapshots and limits](/docs/serializable-transactions#read-committed-snapshots-and-limits).

For a read-then-write decision, keep [SELECT FOR UPDATE](/docs/sql-queries#for-update)
and the following write in one explicit transaction. Its locks are released
at commit or rollback; an autocommit locking read cannot protect a later request.

## Failed statements

Any failed statement in an explicit transaction aborts the transaction,
including a cancelled read or a statement refused inside a transaction block.
Roll back and start a new transaction; there are no savepoints for recovering
just the failed statement. Earlier writes cannot be committed after the error.

The engine refuses later statements, including reads, with `CADB0824`
(`TransactionRollbackOnly`). `COMMIT` rolls it back and reports the same code.
HTTP and gRPC immediately roll back on statement failure, so reusing their
transaction handle instead returns an unknown-transaction error.

Fix invalid input before restarting. For retryable conflicts, replay the whole
unit of work as described in [Retries and conflicts](/docs/serializable-retries).

## Read-only transactions

A read-only transaction is a good choice for a report or a data export. It
reads one consistent snapshot and takes no locks. It also can't change data by
mistake.

To make a transaction read-only, run `SET TRANSACTION ISOLATION LEVEL
SERIALIZABLE READ ONLY` as its first statement. You can also start it read-only
from the client: send `"transactionMode": "ReadOnly"` over HTTP, or
`TRANSACTION_MODE_READ_ONLY` over gRPC.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SELECT SUM(balance) FROM accounts;
UPDATE accounts SET balance = 0 WHERE id = @id;
-- CADB0849: cannot execute UPDATE in a read-only transaction
ROLLBACK;
```

A statement that changes data or schema returns `CADB0849`
(`ReadOnlyTransaction`) before it changes anything. The following statements
return this error:

- `INSERT`, including `INSERT ... ON CONFLICT` and `INSERT ... SELECT`
- `UPSERT`
- `UPDATE` and `DELETE`, including `UPDATE ... FROM` and `DELETE ... USING`
- `CREATE TABLE ... AS`
- Schema DDL, such as `CREATE TABLE` or `DROP INDEX`
- `COMMENT ON` and `REFRESH MATERIALIZED VIEW`
- `nextval()` and `setval()`

`SELECT ... FOR UPDATE` returns `CADB0400` in a read-only transaction. The same
rules apply to an autocommit statement that asks for a read-only transaction, and
to the SQL of triggers and procedures. A refused statement is a failed statement,
and the transaction is aborted as described in [Failed statements](#failed-statements).

Note that an autocommit `SELECT` that asks for no mode can call `nextval()`. The
query endpoints read from a read-only snapshot for speed, but the request didn't
ask for a read-only transaction. If the request sends `"transactionMode":
"ReadOnly"`, `nextval()` returns `CADB0849`.

Server-level statements, such as `CREATE DATABASE` or `GRANT`, run outside any
transaction. The access mode doesn't apply to them.

The access mode follows these rules:

- If `SET TRANSACTION ISOLATION LEVEL` names neither `READ ONLY` nor
  `READ WRITE`, the mode doesn't change. For example, a read-only transaction
  remains read-only.
- The snapshot of `SET TRANSACTION ... READ ONLY` is fixed when the statement
  executes. A transaction that you start read-only at Serializable fixes its
  snapshot when it starts.
- `SET TRANSACTION ... READ WRITE` returns `CADB0400` in a transaction that has a
  fixed snapshot. Start a read-write transaction for the writes. In a Read
  Committed read-only transaction, `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE
  READ WRITE` as the first statement makes the transaction Serializable and
  writable.

## Transactional schema changes

Enable `transactional_ddl_enabled` to apply a migration and its data changes in
one transaction. Later statements in the transaction can use the new schema
immediately. A successful `COMMIT` makes both changes visible to other sessions.
`ROLLBACK` discards both.

```camussql
SET CLUSTER SETTING transactional_ddl_enabled = true;

BEGIN;
CREATE TABLE order_statuses (code STRING PRIMARY KEY, label STRING);
INSERT INTO order_statuses (code, label) VALUES ('pending', 'Pending');
COMMIT;
```

The setting is cluster-wide and defaults to `false`. By default, schema
statements commit separately and their changes survive a later `ROLLBACK`.

| Operation | Support with transactional DDL enabled |
| --- | --- |
| Tables | `CREATE TABLE` and table rename. Use the deferred form of `DROP TABLE`. |
| Existing columns and indexes | Rename or drop a column or index. You can also drop a primary key. |
| New columns and keys | Create the table in the same transaction. Add columns, indexes and keys before writing rows. An existing table can also take a nullable column added with no default clause. |
| Table settings | Use `ALTER TABLE ... SET` or `RESET`. |
| Comments | `COMMENT ON TABLE`, `COMMENT ON COLUMN`, `COMMENT ON INDEX`. |
| Regular views | `CREATE VIEW`, `CREATE OR REPLACE VIEW`, `DROP VIEW`, `ALTER VIEW ... RENAME TO`. |

Other schema statements return `CADB0538`. The following require a separate
transaction at either setting.

- [`TRUNCATE`](/docs/truncate-table)
- `ALTER TABLE ... REWRITE STORAGE`
- `ALTER SEQUENCE ... RESTART`

Server and database administration statements
such as `CREATE DATABASE` and `GRANT` commit separately at either setting.

A transaction can change the schema of one database. Its first schema change
takes a database-wide DDL lock until the transaction ends. Concurrent DDL that
waits 30 seconds returns `CADB0504`. During publication at commit, queries that
open affected tables wait for the new schema. A concurrent writer that planned
against an older schema can receive `CADB0502` and must retry from `BEGIN`.
If the database schema has changed since the transaction first acquired its
DDL lock, the DDL transaction can also fail at commit with `CADB0502`.

If `COMMIT` returns `CADB0509`, retry `COMMIT` on the same transaction. The row
writes may already have committed while the schema change awaits confirmation.

## Locking strategy

Pessimistic locking is the default. It takes the necessary locks before any
conflicting work continues:

```camussql
BEGIN;
SET TRANSACTION LOCKING PESSIMISTIC;
```

Optimistic locking is opt-in. It skips explicit exclusive write locks and
validates conflicts at commit:

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

`SET TRANSACTION LOCKING` must run before any data statement in the
transaction. You can combine it with `SET TRANSACTION ISOLATION LEVEL` in either
order, but both must come before any read or write.

The isolation level still governs optimistic locking. With `READ COMMITTED`, an
optimistic transaction takes no locks at all and validates only the rows it
observed. With `SERIALIZABLE`, reads and scans still take shared predicate
locks, so the transaction keeps its protection against phantoms (rows that
another transaction inserts into a range you already read) while it validates
its write set and read set at commit.

## Priority

A transaction's priority controls admission order: which waiting transaction a
busy node lets start first. It applies when a node is saturated and the
concurrency gate (admission gate) of [Kahuna](/docs/concepts#kahuna), the
storage layer, is enabled. It does not change isolation, locking, commit order,
or execution resources once a transaction starts.

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

The accepted values are `BACKGROUND`, `LOW`, `NORMAL`, `HIGH`, and `CRITICAL`.

`SET TRANSACTION PRIORITY` must run before any data statement, and before the
transaction's coordinator session (the storage-layer session that tracks the
transaction) starts. You can combine it with `SET TRANSACTION ISOLATION LEVEL`
and `SET TRANSACTION LOCKING` while setting up the transaction.

With the default configuration, CamusDB records the priority but defers no
transactions. See [Transaction Priority](/docs/transaction-priority) for the
admission gate settings and operational guidance.

## Related topics

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Priority](/docs/transaction-priority)
- [Transaction Limits](/docs/transaction-limits)
- [Retries And Conflicts](/docs/serializable-retries)
