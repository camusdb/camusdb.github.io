---
sidebar_position: 2.6
---

# Time-travel reads

`AS OF SYSTEM TIME` reads the data of a past moment. The query is an ordinary
read-only `SELECT`. CamusDB simply pins it to a historical committed snapshot,
and not to the latest one.

You usually need it after a change, to see the earlier state. Three examples are
the diagnosis of an incident, a check of the data behind a report, and an
analysis of what an accidental write overwrote.

## A quick example

```camussql
SELECT *
FROM leaderboard AS OF SYSTEM TIME '-10s';

SELECT *
FROM accounts AS OF SYSTEM TIME '2026-07-19T20:00:00Z'
WHERE id = 9910;
```

The first query reads `leaderboard` as it was ten seconds ago. The second query
reads `accounts` at an absolute timestamp in UTC.

## Syntax

Write `AS OF SYSTEM TIME` after the source of the `FROM` clause. Write it before
a `WHERE`, a `GROUP BY`, an `ORDER BY`, a `LIMIT`, and an `OFFSET`:

```camussql
SELECT *
FROM accounts AS OF SYSTEM TIME '-10s'
WHERE id = 9910;

SELECT score
FROM leaderboard AS OF SYSTEM TIME '-1m'
WHERE score > 5
ORDER BY score DESC
LIMIT 10;
```

For a query with a join, the clause still applies to the whole statement. Write
it after the joined source of the `FROM` clause:

```camussql
SELECT c.name, o.total
FROM customers c
JOIN orders o ON o.customer_id = c.id
AS OF SYSTEM TIME '-5m'
WHERE o.total > 100;
```

Every table, every join, and every subquery of the statement observes the same
historical snapshot.

## The value of the timestamp

`AS OF SYSTEM TIME` accepts a string, an integer of epoch milliseconds, and a
bound parameter.

| Form | Example | Meaning |
| --- | --- | --- |
| A string with a relative offset | `'-10s'`, `'-500ms'`, `'-2m'`, `'-1h'`, `'-1d'` | It reads that far into the past, from the start of the query. |
| A string with an absolute timestamp | `'2026-07-19 20:00:00+00:00'`, `'2026-07-19T20:00:00Z'` | It reads at that instant in UTC. |
| An integer of epoch milliseconds | `1721420000000` | It reads at that Unix epoch millisecond. |
| A parameter | `@ts` | It uses a bound string, an integer of epoch milliseconds, or a datetime value. |

A string value can use a single quotation mark, or a double one:

```camussql
SELECT * FROM accounts AS OF SYSTEM TIME "-10s";
```

A relative offset supports `ms`, `s`, `m`, `h`, and `d`. It must point into the
past. Use a negative value, such as `'-10s'`.

CamusDB reads a timestamp string without an explicit time zone as UTC.

## The guarantees of the consistency

A read with time travel sees the highest committed revision of each key at the
resolved timestamp, or before it. A write that committed after that timestamp is
invisible to the historical query. It is visible to a normal `SELECT`.

The snapshot is fixed for the whole statement:

- Every side of a join reads at the same timestamp.
- A subquery reads at the same historical timestamp as the outer query.
- The filter, the group, the order, and the pagination all run over the
  historical result.
- The historical read blocks no writer.

You therefore get a consistent view of the database, at one logical point in
time. You restore no backup, and you pause no current traffic.

## Common uses

- Inspect the data just before an accidental update or delete.
- Compare a current report with the same query from minutes or hours earlier.
- Debug the behavior of production. Ask what a query would have returned at the
  time of an incident.
- Audit whether a later write changed a row that matters to the business.
- Rebuild a view at the level of the application, from a known historical point.

For the recovery of a dropped object, use
[Recover Dropped Objects](/docs/recover-dropped-objects). A read with time
travel inspects the historical state of a row. A relink of a dropped database or
a dropped table restores a whole object, while that object is inside the window
of the recovery.

## Copy historical data

`AS OF SYSTEM TIME` can also be the source of an `INSERT INTO ... SELECT`, and
of a `CREATE TABLE ... AS SELECT`:

```camussql
CREATE TABLE orders_before_incident AS
SELECT customer, total
FROM orders AS OF SYSTEM TIME '-2h';

INSERT INTO orders (id, customer, total)
SELECT gen_id(), customer, total
FROM orders AS OF SYSTEM TIME '-2h'
WHERE customer = "acme";
```

The source reads the historical snapshot. The destination writes into the
current state of the database. That form helps you rebuild a row after an
accidental update or delete. You restore no backup.

See [Copying Query Results](/docs/insert-select-and-ctas) for CTAS, for the
transaction, for the locks, and for the warning about zero rows.

## Restrictions

A read with `AS OF SYSTEM TIME` on its own is read-only by design:

- CamusDB supports it for a read-only `SELECT` in autocommit mode.
- CamusDB rejects a historical `SELECT` on its own, inside an explicit
  transaction of several statements.
- An `INSERT INTO ... SELECT` and a `CREATE TABLE ... AS SELECT` may use a
  historical `SELECT` as the source. The writes still target the current state
  of the database.
- CamusDB rejects the clause when the read already moved into a snapshot that
  belongs to a transaction.
- You cannot use the clause directly with an `UPDATE`, a `DELETE`, or an
  `INSERT ... VALUES`.
- The clause accepts a past instant only. CamusDB rejects a future time. It also
  rejects a time at or before the Unix epoch.

The retained history of the storage bounds a historical read. The requested
timestamp can be older than the retained revisions. There is no separate error
for a snapshot that is too old. The query can simply return an empty result,
because no retained revision is visible at that timestamp.

## A truncated table

CamusDB refuses a historical read of a truncated table, for any snapshot before
the start of the current contents. It returns `CADB0537`
`SnapshotPrecedesContentsGeneration`.

[`TRUNCATE`](/docs/truncate-table) replaces the key space that holds the rows of
the table. The live schema can locate the current key space only. A snapshot
before the cut therefore has no place to read the old rows from.

An empty result would be the alternative. That result is the same as a correct
empty answer for a moment when the table was full, so CamusDB reports an error
instead.

Three rules follow:

- A snapshot exactly at the cut is valid. It observes the new contents, which
  are empty.
- CamusDB knows the latest cut only. After several truncates, it therefore
  refuses every snapshot before that cut.
- A table without a truncate is not affected.

Recover the old rows with `RELINK`, and then read the recovered table. See
[TRUNCATE TABLE](/docs/truncate-table#time-travel).

## The model of the storage

CamusDB stores a committed version through the key/value layer of
[Kahuna](https://kahunakv.github.io/), which holds several versions. Each
committed version carries a timestamp of the Hybrid Logical Clock.

A normal read uses the latest available timestamp. `AS OF SYSTEM TIME` supplies
a past timestamp for the read. The statement then runs on a read-only snapshot,
pinned to that timestamp.

For more background on an HLC timestamp and on the snapshot of a transaction,
see [Distributed Transactions And HLC](/docs/distributed-transactions).

## Errors

An invalid request for time travel returns `CADB0409 InvalidAsOfSystemTime`. A
snapshot before the current contents of a truncated table returns `CADB0537
SnapshotPrecedesContentsGeneration`.

These causes are common:

- A duration string with a wrong form, such as `'-10x'`.
- A positive relative offset, such as `'+10s'`.
- An absolute timestamp in the future.
- A value of epoch milliseconds that is zero or negative.
- A parameter value that is absent or incompatible.
- Use of the clause inside an explicit transaction.

See [Error Codes](/docs/error-codes) for guidance on a retry.
