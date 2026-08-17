---
sidebar_position: 2.6
---

# Time-Travel Reads

`AS OF SYSTEM TIME` reads data as it existed at a point in the past. The query
is an ordinary read-only `SELECT`, simply pinned to a historical committed
snapshot rather than the latest one.

The usual reason to reach for it is that something changed and you need to see
what was there before: diagnosing an incident, checking what a report was built
from, or working out what an accidental write overwrote.

## Quick Example

```camussql
SELECT *
FROM leaderboard AS OF SYSTEM TIME '-10s';

SELECT *
FROM accounts AS OF SYSTEM TIME '2026-07-19T20:00:00Z'
WHERE id = 9910;
```

The first query reads `leaderboard` as it was ten seconds ago. The second query
reads `accounts` at an absolute UTC timestamp.

## Syntax

Place `AS OF SYSTEM TIME` after the `FROM` source and before `WHERE`, `GROUP BY`,
`ORDER BY`, `LIMIT`, or `OFFSET`:

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

For joined queries, the clause is still statement-level. Put it after the joined
`FROM` source:

```camussql
SELECT c.name, o.total
FROM customers c
JOIN orders o ON o.customer_id = c.id
AS OF SYSTEM TIME '-5m'
WHERE o.total > 100;
```

All tables, joins, and subqueries in the statement observe the same historical
snapshot.

## Timestamp Values

`AS OF SYSTEM TIME` accepts strings, epoch-millisecond integers, and bound
parameters.

| Form | Example | Meaning |
| --- | --- | --- |
| Relative offset string | `'-10s'`, `'-500ms'`, `'-2m'`, `'-1h'`, `'-1d'` | Reads that far into the past from the time the query starts. |
| Absolute timestamp string | `'2026-07-19 20:00:00+00:00'`, `'2026-07-19T20:00:00Z'` | Reads at that UTC instant. |
| Epoch milliseconds integer | `1721420000000` | Reads at that Unix epoch millisecond. |
| Parameter | `@ts` | Uses a bound string, integer epoch-millisecond value, or datetime value. |

String values can use single or double quotes:

```camussql
SELECT * FROM accounts AS OF SYSTEM TIME "-10s";
```

Relative offsets support `ms`, `s`, `m`, `h`, and `d`. They must point into the
past, so use a negative value such as `'-10s'`. Timestamp strings without an
explicit timezone are interpreted as UTC.

## Consistency Guarantees

A time-travel read sees the highest committed revision of each key at or before
the resolved timestamp. Writes committed after that timestamp are invisible to
the historical query but visible to a normal `SELECT`.

The snapshot is fixed for the whole statement:

- joins read all sides at the same timestamp
- subqueries read the same historical timestamp as the outer query
- filtering, grouping, ordering, and pagination run over the historical result
- writers are not blocked by the historical read

This gives you a consistent view of the database at one logical point in time,
without restoring a backup or pausing current traffic.

## Common Uses

- Inspect data just before an accidental update or delete.
- Compare a current report with the same query from minutes or hours earlier.
- Debug production behavior by asking what a query would have returned at the
  time of an incident.
- Audit whether a later write changed business-critical rows.
- Rebuild an application-level view from a known historical point.

For catastrophic dropped-object recovery, use
[Recover Dropped Objects](/docs/recover-dropped-objects). Time-travel reads help
inspect historical row state; relinking dropped databases and tables restores
whole dropped objects that are still within the recoverable retention window.

## Copying Historical Data

`AS OF SYSTEM TIME` can also be used as the source of
`INSERT INTO ... SELECT` and `CREATE TABLE ... AS SELECT`:

```camussql
CREATE TABLE orders_before_incident AS
SELECT customer, total
FROM orders AS OF SYSTEM TIME '-2h';

INSERT INTO orders (id, customer, total)
SELECT gen_id(), customer, total
FROM orders AS OF SYSTEM TIME '-2h'
WHERE customer = "acme";
```

The source reads the historical snapshot, while the destination writes to the
current database state. This is useful when you need to rebuild rows after an
accidental update or delete without restoring a backup.

See [Copying Query Results](/docs/insert-select-and-ctas) for CTAS, transaction,
locking, and zero-row warning behavior.

## Restrictions

Standalone `AS OF SYSTEM TIME` reads are intentionally read-only:

- It is supported for autocommit read-only `SELECT` statements.
- Standalone historical `SELECT` is rejected inside explicit multi-statement
  transactions.
- `INSERT INTO ... SELECT` and `CREATE TABLE ... AS SELECT` may use a
  historical `SELECT` source; the writes still target the current database
  state.
- It is rejected if the read has already been promoted into a transaction-bound
  snapshot.
- It cannot be used directly with `UPDATE`, `DELETE`, or `INSERT ... VALUES`.
- It only accepts past instants. Future times and times at or before the Unix
  epoch are rejected.

Historical reads are bounded by retained storage history. If the requested
timestamp is older than the retained revisions, there is no separate "snapshot
too old" error; the query can simply return an empty result because no retained
revision is visible at that timestamp.

## Storage Model

CamusDB stores committed versions through
[Kahuna](https://kahunakv.github.io/)'s multi-version key/value layer. Each
committed version is tagged with a Hybrid Logical Clock timestamp. Normal reads
use the latest available timestamp, while `AS OF SYSTEM TIME` supplies a past
read timestamp and runs the statement on a read-only snapshot pinned to it.

For more background on HLC timestamps and transaction snapshots, see
[Distributed Transactions And HLC](/docs/distributed-transactions).

## Errors

Invalid time-travel requests return `CADB0409` `InvalidAsOfSystemTime`.

Common causes include:

- malformed duration strings such as `'-10x'`
- positive relative offsets such as `'+10s'`
- future absolute timestamps
- zero or negative epoch-millisecond values
- missing or incompatible parameter values
- using the clause inside an explicit transaction

See [Error Codes](/docs/error-codes) for retry guidance.
