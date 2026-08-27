---
sidebar_position: 2.35
---

# TRUNCATE TABLE

`TRUNCATE` empties a base table. It does not read a row, and it does not delete
a row one at a time. It replaces the physical key space that holds the rows and
the index entries of the table.

The work is therefore independent of the number of rows.

```camussql
TRUNCATE TABLE orders;
TRUNCATE orders;             -- the TABLE keyword is optional
```

The table itself survives the statement. It keeps its name, its id, its columns,
its indexes, its constraints, its settings, its comment, its grants, and its
schema version. Only its contents generation moves.

A contents generation is one physical key space that holds the rows of a table.
This page uses that term throughout.

## An example

```camussql
-- Empty a table of any size.
TRUNCATE TABLE orders;

-- CamusDB retains the previous contents for the window of the retention.
SHOW ORPHAN TABLES;
```

```text
id | kind             | former_name | dropped_at | expires_at
A0 | retired contents | orders      | ...        | ...
```

```camussql
-- Bring the previous contents back as a separate table.
CREATE TABLE orders_before_truncate RELINK TO 'A0';
```

## What the statement accepts

Three rules apply to the form of the statement:

- The target is exactly one base table. CamusDB does not support several tables
  in one statement.
- The `TABLE` keyword is optional.
- The statement takes no option.

`RESTART IDENTITY` has no meaning in CamusDB, because CamusDB has no sequence of
a user. `CASCADE` has no target, because a foreign key is not a live feature
yet.

CamusDB refuses `TRUNCATE` on three targets:

| Target | Error | What you use instead |
| --- | --- | --- |
| A materialized view | `CADB0525` `ViewNotUpdatable` | `REFRESH MATERIALIZED VIEW ... WITH NO DATA` |
| A plain view | `CADB0525` `ViewNotUpdatable` | Truncate the table below the view |
| A table that does not exist | `CADB0002` `TableDoesntExist` | Nothing applies |

## Performance

The statement is constant in the count of the rows, and in the count of the
index entries. A table with one row and a table with a billion rows do the same
amount of work on the rows, which is none. CamusDB reads no row, deletes no row,
and touches no index entry.

That property is not the same as a constant time on the clock. The statement
still waits for three things:

1. The exclusive fence over the whole key space of the rows of the table. That
   fence waits for a writer that conflicts.
2. The commit of the replicated schema entry, and the acknowledgement from every
   node.
3. The checkpoint of the metadata. Its cost grows with the indexes of the table,
   and with the layouts of the stored columns.

CamusDB reclaims the retired rows in the background. That work is asynchronous,
and its cost is proportional to the count of the rows. It happens long after the
statement returns.

CamusDB does not use either of the two alternatives:

| Strategy | Work on the data | Atomic | Why CamusDB does not use it |
| --- | --- | --- | --- |
| A swap of the contents generation | None | Yes | CamusDB uses this strategy. |
| A `DELETE` in chunks | Proportional to the rows and the index entries | No | A partial failure leaves the table half empty. |
| A `DELETE` in one transaction | Proportional to the rows and the index entries | Yes | It exceeds the limit on the mutations of one transaction, on any useful table. |

See [Transaction Limits](/docs/transaction-limits) for that limit.

## Privileges

`TRUNCATE` needs both the `DELETE` privilege and the `DROP` privilege on the
target table. The statement removes every row, which is an effect of a `DELETE`.
It also retires a whole key space, which is an effect of a `DROP`. One privilege
alone is therefore not enough.

CamusDB checks the two privileges one at a time. They can come from two separate
grants:

```camussql
GRANT DELETE ON shop.orders TO alice;
GRANT DROP   ON shop.orders TO alice;
```

A superuser satisfies the check. A grant across a database, such as `shop.*`,
also satisfies it. A global grant satisfies it too.

A caller without the two privileges receives `CADB0517`
`InsufficientPrivilege`. See [SQL Authentication](/docs/sql-authentication).

## Transactions

`TRUNCATE` runs in its own internal transaction. CamusDB refuses the statement
inside an explicit transaction, with `CADB0538`
`StatementNotAllowedInTransaction`:

```camussql
BEGIN;
TRUNCATE TABLE orders;   -- CADB0538
ROLLBACK;
```

The reason is honesty, and not caution. `TRUNCATE` commits a replicated schema
entry. A `ROLLBACK` of your own transaction cannot undo that entry. An accepted
statement would therefore promise a rollback that the engine cannot deliver.
Commit first, or roll back first. Then run the truncate.

The truncate happens across the cluster as soon as the schema entry commits. A
failure after that point does not change the outcome. CamusDB logs the failure,
and the statement still reports success. A report of a rollback would tell you
that the table still holds rows that it no longer holds.

## A concurrent reader and a concurrent writer

CamusDB takes an exclusive range lock over the whole key space of the rows of
the table. It takes that lock before it proposes anything. The lock is what
makes the swap atomic against a transaction on the data.

Three cases follow:

- A writer staged a row into the old key space before CamusDB took the lock.
  CamusDB aborts that writer at its commit. The writer never receives a success
  for a row in a key space that nothing reads. This applies to an optimistic
  writer and to a pessimistic one.
- A writer arrives while CamusDB holds the lock. That writer waits, or CamusDB
  asks it to retry. It binds the new key space when it continues.
- A reader bound the old contents before the cut. That reader can finish against
  its own snapshot. A statement that binds after the acknowledgement of the
  truncate sees the new contents, which are empty.

Two concurrent truncates on one table serialize through the schema leader. Each
truncate that succeeds creates its own retired generation. One truncate can lose
the race, and it then reports `CADB0534` `ConcurrentSchemaChange`. That code is
retryable, because CamusDB applied nothing.

See [Serializable Transactions](/docs/serializable-transactions) for the
contract of a conflict that you retry.

## Recovery of the previous contents

A truncate destroys nothing. CamusDB keeps the key space that the table stopped
to read. It keeps that key space as retired contents.

This mechanism is the same one that makes `DROP TABLE` recoverable. See
[Recover Dropped Objects](/docs/recover-dropped-objects).

```camussql
SHOW ORPHAN TABLES;
```

| Column | Meaning |
| --- | --- |
| `id` | The id of the retired key space. `RELINK TO` takes this value. |
| `kind` | `retired contents` for a truncate. `dropped table` for a drop. |
| `former_name` | The table that owned the contents. For retired contents, that table still exists. |
| `dropped_at` | The time of the retirement of the contents. |
| `expires_at` | The time when the background collector can reclaim them. |

A recovery publishes the retained rows as a separate new table:

```camussql
CREATE TABLE orders_before_truncate RELINK TO 'A0';
```

The recovered table receives a fresh id of a relation, and it reads the retired
key space. It must receive a fresh id. On the first truncate of a table, the id
of the still live table names the retired key space. A reuse of that id would
create a second name for one live relation.

The recovery does not touch the original table. That table keeps its id and its
name. It also keeps every row that somebody wrote into it after the truncate.

The background collector purges the retired rows, the index entries, and the
metadata, after the window of the retention. That window is
`orphan_retention_ms`. A recovery is not possible after the purge.

## Time travel

CamusDB refuses a time travel read of a truncated table, for any snapshot before
the start of the current contents:

```camussql
TRUNCATE TABLE orders;
SELECT * FROM orders AS OF SYSTEM TIME '-10s';
```

```text
CADB0537: Cannot read table 'orders' AS OF SYSTEM TIME ...: its contents were
replaced at ..., and the rows it held before that point are no longer reachable
through this table.
```

That refusal is the honest answer. The old rows are still on the disk. They
nevertheless live in a key space that the live table can no longer name. The
read would therefore scan the new generation, which is empty, and it would
answer "no rows". That answer is the same as a correct empty answer for a moment
when the table was full.

Four rules apply:

- A snapshot exactly at the cut is valid. It observes the new contents, which
  are empty.
- A snapshot after the cut behaves normally.
- CamusDB knows the latest cut only. After several truncates, it therefore
  refuses every snapshot before that cut.
- A table without a truncate is not affected.

Recover the old rows with `RELINK`, and then query the recovered table. See
[Time Travel Reads](/docs/time-travel-reads).

## A branch database

In a [branch database](/docs/database-branching), the rows of a table are the
overlay of the branch merged with the rows of its ancestors. Each level uses the
same id of the storage. A truncate therefore has a simple and total meaning.

| Action | Effect |
| --- | --- |
| A truncate in a branch | CamusDB gives the branch a new id of the storage. The view of the branch becomes empty. Its overlay disappears from that branch, and so do the rows that it inherits. |
| A recovery in a branch | CamusDB reconstructs the whole merged view of the branch before the truncate. That view holds the overlay and the inherited rows, under a new name of a table. |
| The reclamation | CamusDB scopes the reclamation to the id of the database of the branch. It never deletes a key of an ancestor. |
| A truncate of the source | A truncate of the source after a fork does not rewrite the copied schema of the descendant. The descendant keeps its forked contents. |

A truncate in a branch deletes nothing at once. The overlay becomes retired
contents, and CamusDB never touches the rows of the ancestor.

## A dependent view

A plain view stores no row. It therefore reads the emptied table at once.

A materialized view keeps the rows of its last refresh. That view is stale after
a truncate.

This behavior matches the treatment of `INSERT`, `UPDATE`, and `DELETE`. No
mutation of a base table invalidates a dependent materialized view. Run a
refresh when you want the view to agree:

```camussql
TRUNCATE TABLE orders;
REFRESH MATERIALIZED VIEW orders_by_day;
```

See [Materialized Views](/docs/materialized-views).

## Statistics

The statistics of the optimizer use the identity of the table, and a truncate
preserves that identity. CamusDB stamps the statistics with the contents
generation that they describe.

After a truncate, CamusDB ignores the previous distribution. It does not believe
it. `SHOW STATISTICS` and the planner both treat the new generation as a
generation without a measurement.

Run `ANALYZE` after you fill the table again. See
[SHOW STATISTICS](/docs/show-statistics).

## Row-level TTL

A run of the row-level TTL becomes inert at once when a truncate lands. TTL is
the time to live of a row.

Every run records the generation of the storage of its plan. The scheduler
checks that generation again, and each span of a worker checks it again. No
worker can therefore delete from the retired generation, which is recoverable.
No worker can delete from the new generation either, because the plan of its
span never described that generation.

CamusDB cleans the records of the stale run in the background. See
[Row-Level TTL](/docs/row-level-ttl).

## Error codes

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0002` | `TableDoesntExist` | The named table does not exist. |
| `CADB0517` | `InsufficientPrivilege` | The caller lacks `DELETE` or `DROP` on the table. |
| `CADB0525` | `ViewNotUpdatable` | The target is a view, or a materialized view. |
| `CADB0534` | `ConcurrentSchemaChange` | Another change of the contents won the race. Retryable. |
| `CADB0537` | `SnapshotPrecedesContentsGeneration` | A time travel read named a point before the start of the current contents. |
| `CADB0538` | `StatementNotAllowedInTransaction` | A caller issued `TRUNCATE` inside an explicit transaction. |

`CADB0537` and `CADB0538` both map to HTTP 400. On gRPC, both map to
`FAILED_PRECONDITION`. See [Error Codes](/docs/error-codes).

## Not supported

CamusDB does not support these five things today:

- `TRUNCATE a, b, c`, which names several tables in one statement.
- `RESTART IDENTITY`, because CamusDB has no sequence of a user.
- `CASCADE`, because a foreign key is not a live feature.
- An automatic refresh of a dependent materialized view. CamusDB does not
  invalidate that view either.
- A read of a snapshot before the current contents generation.
