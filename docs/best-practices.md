---
sidebar_position: 1.8
---

# Best practices

These practices help a schema and a workload scale on CamusDB. Some of them
apply to every deployment. Others matter only when
[key-range sharding](/docs/key-range-sharding) is on. Each section tells you
which case applies.

## How CamusDB places data

Read this section first. The other practices follow from it.

- **Hash routing** is the default. All rows of a table, and all of its secondary
  indexes, live on one Raft partition. The choice of a key does not spread one
  table across partitions.
- **Key-range sharding** routes each key space by key order. The rows of a
  table, its large values, and each secondary index are separate key spaces. A
  key space starts as one range. It can then split into ranges that different
  partitions serve.

CamusDB stores a row under an internal row id, and not under the primary key.
The row id is an ObjectId with a timestamp prefix. The primary key is a unique
index that maps each key to its row id. See [Storage](/docs/storage) for the
layout of the keys.

The choice of a primary key therefore controls where the entries of the primary
index go. It does not change the order of the row ids. With key-range
sharding, new rows go to the newest range of the row space, whatever the primary
key is. The practices below spread the writes to the primary index and to the
secondary indexes.

## Primary keys

### Every table needs a primary key

CamusDB rejects a `CREATE TABLE` without a primary key:

```text
CADB0400: A primary key column is mandatory in the table
```

CamusDB adds no hidden key for you. Choose a key that a real query uses, so the
primary index does useful work.

### Avoid keys that always increase

With key-range sharding, a key that always increases sends every insert to the
last range of the primary index. That range becomes a hotspot, and a split does
not help: the new keys still land on the newest range.

These keys increase over time:

- A sequence, an identity column, `SERIAL`, and `BIGSERIAL`.
- A `DATETIME` or `DATE` as the first key column.
- An `OID` from `gen_id()`. An ObjectId starts with a timestamp in seconds.
- A `UUID` from `gen_uuid_v7()`. A version 7 UUID starts with a timestamp in
  milliseconds.

A sequence has a second cost. It is one logical counter, and every insert that
needs a value coordinates through it. See [Sequences](/docs/sequences).

### Use a key with a good spread

Use `gen_uuid_v4()` for a table with a high rate of inserts, when key-range
sharding is on. A version 4 UUID is random, so new keys spread across all ranges
of the primary index:

```camussql
CREATE TABLE players (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  name STRING(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now())
);
```

CamusDB has no bit-reversed sequence. Use `gen_uuid_v4()` instead.

`gen_id()` and `gen_uuid_v7()` remain good choices in two cases:

- The deployment uses hash routing. The whole table is on one partition, so the
  order of the keys does not cause a range hotspot.
- The rate of inserts is low, and new rows are read together. A key in time
  order keeps those rows near each other in the index.

See [UUID functions](/docs/functions-uuid) for the generators.

### Match a composite key to the access pattern

Put a column with a good spread first, and choose a column that every query
filters on. Examples are `tenant_id` and `player_id`. Put the column of the
order second:

```camussql
CREATE TABLE match_events (
  player_id UUID NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now()),
  kind STRING(32) NOT NULL,
  score INT64 NOT NULL
) PRIMARY KEY (player_id, created_at DESC);
```

The entries of one player stay together in the primary index. A query for the
recent events of one player then reads one contiguous span of that index:

```camussql
SELECT created_at, kind, score
FROM match_events
WHERE player_id = @player_id
ORDER BY created_at DESC
LIMIT 20;
```

The inserts of different players go to different parts of the key space, so the
key has no global hotspot. CamusDB reads the primary index first. It then
fetches each row by its row id. A primary key does not support `INCLUDE`.

## Secondary indexes

### The hotspot rule applies to indexes

With key-range sharding, each secondary index has its own ranges. An
index with a time column as its first key column is a hotspot, for the same
reason as a primary key:

```camussql
-- Every insert writes to the last range of this index.
CREATE INDEX match_events_created_idx ON match_events (created_at);
```

CamusDB has no hash-sharded index. Put a column with a good spread, or a column
that you always filter on, in front of the time column:

```camussql
CREATE INDEX match_events_kind_idx ON match_events (kind, created_at);
```

A column with few values, such as `kind`, spreads the writes only across those
values. A column such as `player_id` or `tenant_id` gives a better spread.

### Use a covering index on a hot path of reads

CamusDB declares a covering index with `INCLUDE (...)`. It has no `STORING`
keyword. An included column is stored with each entry of the index, so a covered
query does not fetch the row:

```camussql
CREATE INDEX match_events_kind_idx
ON match_events (kind, created_at)
INCLUDE (score);
```

`EXPLAIN` shows `index-only=true` on the scan when the index covers the query.
The payload of the included columns is limited to 4 KiB for each entry. See
[Indexes](/docs/sql-indexes) for the rules.

### Add an index only for a real query

Each index adds one mutation to each insert and each delete of a row. An update
of an indexed column also writes the index. These mutations count toward the
limit of 20,000 mutations for each transaction. See
[Transaction limits](/docs/transaction-limits).

With key-range sharding, the ranges of an index can be on a different partition
from the row. The write is then a distributed write. Use
[`EXPLAIN`](/docs/explain) and [Query activity](/docs/query-activity) to find
the indexes that queries use. Drop the indexes that no query uses.

## Row and column design

### Keep rows small

A row is the unit of storage and of versions. An update of one column writes a
new version of the whole row.

CamusDB already moves a large `STRING`, `BYTES`, or `ARRAY` value out of the
row. The default strategy is `EXTENDED`. A value at or above
`large_value_threshold_bytes` (2048 bytes by default) goes under its own key. An
update that does not change that column does not rewrite the value. You
therefore do not need a separate table only to hold a large value. See
[Large values](/docs/storage-layout).

A value below the threshold stays in the row. Move that value to a separate
table when it sits beside columns that change often. JSON text in a `STRING`
column is a common example. A profile document of 1 KiB, in the same row as a
counter that changes on every match, is rewritten on every match.

### Avoid a single hot row

A global counter, or one configuration row that every transaction updates, makes
all writers conflict on one key. Serializable transactions then abort with
`CADB0502 TransactionConflict`, and each client must replay its work.

Shard a counter across several rows. Each writer updates one shard, for example
a random shard:

```camussql
CREATE TABLE stat_counters (
  name STRING(64) NOT NULL,
  shard INT64 NOT NULL,
  value INT64 NOT NULL
) PRIMARY KEY (name, shard);

UPDATE stat_counters
SET value = value + 1
WHERE name = 'matches_played' AND shard = @shard;

SELECT SUM(value) AS total
FROM stat_counters
WHERE name = 'matches_played';
```

As an alternative, compute the total from the source rows later. A
[materialized view](/docs/materialized-views) that you refresh on a schedule is
one way to do that.

### Use foreign keys where integrity matters

A [foreign key](/docs/foreign-keys) protects integrity. It also adds work to
each write that changes a constrained column:

- A child write locks each distinct parent key, with a shared lock, until the
  transaction ends. A delete of that parent, or an update of its key, waits for
  the lock or asks the transaction to retry.
- A parent delete, or an update of a parent key, probes the index of the child.
- The child table needs an index on the columns that reference the parent.
  CamusDB creates an owned `~fk_` index when no index fits. That index is one
  more write on each child insert.
- An update that does not change a constrained column does no foreign-key work.

Think about each foreign key on a table with a high rate of writes. A parent row
that many children reference, and that also changes often, is a point of
contention.

## Transactions and contention

### Keep transactions small and short

A small transaction holds fewer locks. It also has fewer conflicts with other
transactions. Try to touch the key range of one entity, such as one player.

A transaction that touches more than one partition commits with two-phase
commit. See [Distributed transactions](/docs/distributed-transactions).

CamusDB bounds each read-write transaction:

| Limit | Default | Error |
| --- | --- | --- |
| Lifetime of a serializable read-write transaction | 1 hour | `CADB0505 TransactionLifetimeExceeded` |
| Mutations in one transaction | 20,000 | `CADB0506 TransactionMutationLimitExceeded` |

### Always retry on the client

A serializable transaction can abort by design. Your application must handle
that abort:

| Code | Action |
| --- | --- |
| `CADB0502`, `CADB0504`, `CADB0505` | Replay the whole transaction from `BEGIN`. |
| `CADB0509` | Send the same `COMMIT` or `ROLLBACK` again. Do not replay the work. |
| `CADB0506` | Do not retry. Split the work into smaller transactions. |

CamusDB retries an autocommit statement on the server, with a bound. An explicit
transaction is the responsibility of the application. Keep the body of the
transaction free of side effects that you cannot repeat.

The drivers have helpers for this:

- .NET: `SerializableRetryHelper`. See [.NET driver](/docs/dotnet-driver).
- TypeScript: `transaction(...)` and `withRetry(...)`. See
  [TypeScript](/docs/typescript-connector).

See [Retries and conflicts](/docs/serializable-retries) for the full rules.

### Use a historical read when the latest data is not necessary

`AS OF SYSTEM TIME` reads a committed snapshot from the past. The read blocks no
writer. Use it for dashboards, reports, and leaderboards that can be a few
seconds old:

```camussql
SELECT player_id, score
FROM leaderboard AS OF SYSTEM TIME '-10s'
ORDER BY score DESC
LIMIT 100;
```

See [Time-travel reads](/docs/time-travel-reads).

## Operations

### Use row-level TTL instead of large batch deletes

A large `DELETE` makes one large transaction. It can reach the mutation limit,
and it holds locks for a long time. Let [row-level TTL](/docs/row-level-ttl)
delete expired rows in small batches in the background:

```camussql
CREATE TABLE sessions (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  player_id UUID NOT NULL,
  expires_at DATETIME NOT NULL
) WITH (ttl_expiration_expression = 'expires_at');
```

Know three facts about TTL:

- An expired row stays readable until the sweep deletes it. Filter with
  `WHERE expires_at > NOW()` when your application needs an exact expiry.
- A table with TTL cannot be the parent of a foreign key. CamusDB rejects that
  combination in both orders.
- Each deleted row costs one mutation for the row, and one more for each index
  entry.

If you must delete rows by hand, delete them in batches. Keep each batch well
below the limit of 20,000 mutations.

## Related

- [Key-range sharding](/docs/key-range-sharding)
- [SHOW RANGES](/docs/show-ranges)
- [Indexes](/docs/sql-indexes)
- [Retries and conflicts](/docs/serializable-retries)
- [Transaction limits](/docs/transaction-limits)
- [Row-level TTL](/docs/row-level-ttl)
