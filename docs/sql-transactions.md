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

Three statements cannot run inside an explicit transaction:
[`TRUNCATE`](/docs/truncate-table), `ALTER TABLE ... REWRITE STORAGE`, and
`ALTER SEQUENCE ... RESTART`. Each one commits work that a later `ROLLBACK`
cannot undo, so CamusDB refuses them there with `CADB0538`
`StatementNotAllowedInTransaction`.

## Isolation

Serializable is the default. You can also set it explicitly at the start of a
transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
COMMIT;
```

Serializable has read-only and read-write modes:

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

For guarantees, admission order, limits, and retry guidance, see:

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Priority](/docs/transaction-priority)
- [Transaction Limits](/docs/transaction-limits)
- [Retries And Conflicts](/docs/serializable-retries)
