---
sidebar_position: 3
---

# Serializable Transactions

CamusDB uses serializable transactions by default. Serializable isolation is the
strongest common transaction isolation level: transactions may run concurrently,
but the committed result must be equivalent to running those transactions one at
a time.

This matters for application correctness. Weaker isolation levels can allow
write skew, where two transactions both make a decision based on data that was
true when they read it, but no longer true when both commits are considered
together.

## Scenario

Imagine an on-call schedule with one business rule:

At least one engineer must remain on call for a shift.

Two engineers are on call for the same shift. Both try to go off call at the
same time. Each transaction checks whether another engineer is still on call,
then updates its own row.

With weaker isolation, both transactions can read "yes, someone else is on
call" and both can commit, leaving nobody on call. With serializable isolation,
CamusDB prevents that outcome.

## Schema

Open two `camus-cli` sessions connected to the same CamusDB node or cluster.
In the first session, create the table and seed the shift:

```sql
CREATE TABLE IF NOT EXISTS schedules (
  shift_id STRING NOT NULL,
  engineer_id INT64 NOT NULL,
  on_call BOOL NOT NULL
) PRIMARY KEY (shift_id, engineer_id);

INSERT INTO schedules (shift_id, engineer_id, on_call)
VALUES
  ("night", 1, true),
  ("night", 2, true);
```

Confirm the starting state:

```sql
SELECT COUNT(*) AS engineers_on_call
FROM schedules
WHERE shift_id = "night" AND on_call = true;
```

The result should be `2`.

## Concurrent Transaction A

In the first session:

```sql
BEGIN;

SELECT COUNT(*) AS other_engineers_on_call
FROM schedules
WHERE shift_id = "night"
  AND on_call = true
  AND engineer_id != 1;
```

The result is `1`, so transaction A tries to remove engineer 1 from the shift:

```sql
UPDATE schedules
SET on_call = false
WHERE shift_id = "night" AND engineer_id = 1;
```

Do not commit yet.

## Concurrent Transaction B

In the second session:

```sql
BEGIN;

SELECT COUNT(*) AS other_engineers_on_call
FROM schedules
WHERE shift_id = "night"
  AND on_call = true
  AND engineer_id != 2;
```

Transaction B also sees `1`, so it tries to remove engineer 2 from the shift:

```sql
UPDATE schedules
SET on_call = false
WHERE shift_id = "night" AND engineer_id = 2;
```

## Commit Both Transactions

Commit transaction A:

```sql
COMMIT;
```

Then commit transaction B:

```sql
COMMIT;
```

CamusDB's serializable isolation should prevent both transactions from
successfully committing an invalid final state. One transaction can commit, and
the other should fail or be forced to retry because the world it read is no
longer serializable with the committed write.

## Check The Result

In either session:

```sql
SELECT engineer_id, on_call
FROM schedules
WHERE shift_id = "night"
ORDER BY engineer_id ASC;
```

At least one engineer should still be on call.

## Application Guidance

Applications should treat serialization failures as retryable. When a
transaction fails because another concurrent transaction changed the outcome,
start a new transaction, re-read the current state, and apply the business rule
again.

This retry pattern is the tradeoff for getting stronger correctness guarantees
by default.

For the distributed commit path, timestamp ordering, and how cross-partition
transactions use two-phase commit, see
[Distributed Transactions And HLC](/docs/distributed-transactions).
