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

See [Transactions And Isolation](/docs/serializable-transactions),
[Transaction Limits](/docs/transaction-limits), and
[Serializable Retries](/docs/serializable-retries) for guarantees, limits, and
retry guidance.
