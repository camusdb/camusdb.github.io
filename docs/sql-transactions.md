---
sidebar_position: 2.5
---

# Transactions In SQL

Group statements with `BEGIN` (or `START TRANSACTION`) and close with `COMMIT`
or `ROLLBACK`:

```camussql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = @from;
UPDATE accounts SET balance = balance + 100 WHERE id = @to;
COMMIT;
```

A statement sent without a transaction gets one anyway: CamusDB opens and
commits a single-operation transaction around it.

This page is the SQL syntax. For the guarantees behind it, see
[Transactions And Isolation](/docs/serializable-transactions).

## Isolation

Serializable is the default. You can state it explicitly at the start of a
transaction:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
COMMIT;
```

Serializable read-only and read-write modes are supported:

```camussql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ WRITE;
```

Read Committed is available as an explicit opt-out:

```camussql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

## Locking Strategy

Pessimistic locking is the default strategy. It takes the needed locks before
conflicting work proceeds:

```camussql
BEGIN;
SET TRANSACTION LOCKING PESSIMISTIC;
```

Optimistic locking is available as an opt-in strategy. It skips explicit
exclusive write locks and validates conflicts at commit:

```camussql
BEGIN;
SET TRANSACTION LOCKING OPTIMISTIC;
```

`SET TRANSACTION LOCKING` must run before any data statement in the transaction.
It can be combined with `SET TRANSACTION ISOLATION LEVEL` in either order, as
long as both statements appear before reads or writes.

Optimistic locking is still governed by the isolation level. With
`READ COMMITTED`, optimistic transactions are fully lock-free but only validate
the rows they observed. With `SERIALIZABLE`, reads and scans still take shared
predicate locks, so the transaction keeps phantom protection while using
commit-time write/read-set validation.

## Priority

Transaction priority controls admission ordering when a node is saturated and
the [Kahuna](https://kahunakv.github.io/) concurrency gate is enabled. It does
not change isolation, locks, commit order, or execution resources after a
transaction has started.

```camussql
BEGIN;
SET TRANSACTION PRIORITY BACKGROUND;
DELETE FROM events WHERE created_at < '2026-01-01';
COMMIT;
```

Accepted values are `BACKGROUND`, `LOW`, `NORMAL`, `HIGH`, and `CRITICAL`.
`SET TRANSACTION PRIORITY` must run before any data statement and before the
coordinator session starts. It can be combined with
`SET TRANSACTION ISOLATION LEVEL` and `SET TRANSACTION LOCKING` during
transaction setup.

With the default configuration, priority is recorded but no transaction is
deferred. See [Transaction Priority](/docs/transaction-priority) for the
admission gate settings and operational guidance.

See [Transactions And Isolation](/docs/serializable-transactions),
[Transaction Priority](/docs/transaction-priority),
[Transaction Limits](/docs/transaction-limits), and
[Retries And Conflicts](/docs/serializable-retries) for guarantees, admission
ordering, limits, and retry guidance.
