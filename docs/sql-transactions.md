---
sidebar_position: 2.5
---

# SQL Transactions

CamusDB supports explicit transaction statements:

```camussql
BEGIN;
START TRANSACTION;
COMMIT;
ROLLBACK;
```

When a write or query request does not include a transaction id, CamusDB starts
and commits a single-operation transaction automatically.

## Isolation

Serializable is the default isolation level. You can be explicit at the start
of a transaction:

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

See [Transactions And Isolation](/docs/serializable-transactions),
[Transaction Limits](/docs/transaction-limits), and
[Serializable Retries](/docs/serializable-retries) for guarantees, limits, and
retry guidance.
