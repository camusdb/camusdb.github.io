---
sidebar_position: 2.5
---

# Transactions in SQL

Group your statements with `BEGIN`, or with `START TRANSACTION`. Close the group
with `COMMIT` or with `ROLLBACK`:

```camussql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = @from;
UPDATE accounts SET balance = balance + 100 WHERE id = @to;
COMMIT;
```

A statement without a transaction receives one. CamusDB opens a transaction of
one operation around that statement. It then commits the transaction.

This page gives the SQL syntax. For the guarantees behind that syntax, see
[Transactions And Isolation](/docs/serializable-transactions).

Three statements cannot run inside an explicit transaction:
[`TRUNCATE`](/docs/truncate-table), `ALTER TABLE ... REWRITE STORAGE`, and
`ALTER SEQUENCE ... RESTART`. Each one commits work that a later `ROLLBACK`
cannot undo. CamusDB therefore refuses them there, with `CADB0538`
`StatementNotAllowedInTransaction`.

## Isolation

Serializable is the default. You can also state it explicitly, at the start of a
transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
COMMIT;
```

Serializable has a read-only mode and a read-write mode:

```camussql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
```

Read Committed is available as an explicit opt-out:

```camussql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

## The strategy for the locks

Pessimistic locking is the default strategy. It takes the necessary locks before
any conflicting work continues:

```camussql
BEGIN;
SET TRANSACTION LOCKING PESSIMISTIC;
```

Optimistic locking is an opt-in strategy. It skips the explicit exclusive write
locks. It validates the conflicts at the commit:

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

`SET TRANSACTION LOCKING` must run before any data statement of the transaction.
You can combine it with `SET TRANSACTION ISOLATION LEVEL`, in either order. Both
statements must come before any read and before any write.

The isolation level still governs optimistic locking. With `READ COMMITTED`, an
optimistic transaction takes no lock at all. It validates only the rows that it
observed. With `SERIALIZABLE`, a read and a scan still take shared predicate
locks. The transaction therefore keeps its protection against a phantom (a row
that another transaction inserts into a range you already read), while it
validates its write set and its read set at the commit.

## Priority

The priority of a transaction controls the order of the admission, that is,
which waiting transaction a busy node lets start first. It applies when a node
is saturated, and when the concurrency gate (admission gate) of
[Kahuna](/docs/concepts#kahuna), the storage layer, is enabled. It does not
change the isolation, the locks, the order of the commits, or the resources of
the execution after a transaction starts.

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

The accepted values are `BACKGROUND`, `LOW`, `NORMAL`, `HIGH`, and `CRITICAL`.

`SET TRANSACTION PRIORITY` must run before any data statement. It must also run
before the transaction's coordinator session (the session in the storage layer
that tracks the transaction) starts. You can combine it with `SET TRANSACTION
ISOLATION LEVEL` and with `SET TRANSACTION LOCKING`, during the setup of the
transaction.

With the default configuration, CamusDB records the priority. It defers no
transaction. See [Transaction Priority](/docs/transaction-priority) for the
settings of the admission gate, and for operational guidance.

These four pages give the guarantees, the order of the admission, the limits,
and guidance on a retry:

- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Priority](/docs/transaction-priority)
- [Transaction Limits](/docs/transaction-limits)
- [Retries And Conflicts](/docs/serializable-retries)
