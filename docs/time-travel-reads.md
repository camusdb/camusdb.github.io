---
sidebar_position: 2.6
---

# Time-Travel Reads

CamusDB can read data as it existed at a specific point in the past with
`AS OF SYSTEM TIME`. A time-travel read is a normal read-only `SELECT`, but it
is pinned to a historical committed snapshot instead of the latest committed
state.

This is useful when you need to inspect what users saw before a change, compare
current data with a recent snapshot, debug an incident, validate reports, or
recover context after an accidental write.

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

## Restrictions

`AS OF SYSTEM TIME` is intentionally read-only:

- It is supported for autocommit read-only `SELECT` statements.
- It is rejected inside explicit multi-statement transactions.
- It is rejected if the read has already been promoted into a transaction-bound
  snapshot.
- It cannot be used with `UPDATE`, `DELETE`, `INSERT`, or schema changes.
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
