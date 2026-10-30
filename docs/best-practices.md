---
sidebar_position: 1.8
---

# Best practices

These practices help your schema and workload scale on CamusDB. Some apply to
every deployment; others matter only when
[key-range sharding](/docs/key-range-sharding) is on. Each section tells you
which case applies.

## How CamusDB places data

Read this section first. The other practices follow from it.

- **[Hash routing](/docs/concepts#hash-and-key-range-routing)** is the
  default. All of a table's rows and secondary indexes live on one
  [partition](/docs/concepts#partition), a slice of the data that one group of
  nodes replicates. Your choice of key does not spread a table across
  partitions.
- **Key-range sharding** routes each [key space](/docs/concepts#key-space) by
  key order. A table's rows, its large values, and each secondary index are
  separate key spaces. Each key space starts as one
  [range](/docs/concepts#ranges-and-spans) and can then split into ranges that
  different partitions serve.

CamusDB stores each row under an internal row id, not under the primary key. The
row id is an ObjectId with a timestamp prefix, and the primary key is a unique
index that maps each key to its row id. See [Storage](/docs/storage) for the key
layout.

So your primary key controls where primary index entries go, but not the order
of row ids. With key-range sharding, new rows go to the newest range of the row
space, whatever the primary key is. The practices below spread writes across the
primary and secondary indexes.

## Primary keys

### Every table needs a primary key

CamusDB rejects a `CREATE TABLE` without a primary key:

```text
CADB0400: A primary key column is mandatory in the table
```

CamusDB adds no hidden key for you. Choose a key that real queries use, so the
primary index does useful work.

### Avoid keys that always increase

With key-range sharding, an ever-increasing key sends every insert to the last
range of the primary index. That range becomes a hotspot, and splitting does not
help: new keys still land on the newest range.

These keys increase over time:

- Sequences, identity columns, `SERIAL`, and `BIGSERIAL`.
- A `DATETIME` or `DATE` as the first key column.
- An `OID` from `gen_id()`. An ObjectId starts with a timestamp in seconds.
- A `UUID` from `gen_uuid_v7()`. A version 7 UUID starts with a timestamp in
  milliseconds.

Sequences have a second cost: a sequence is one logical counter, and every
insert that needs a value coordinates through it. See
[Sequences](/docs/sequences).

### Use a well-spread key

When key-range sharding is on, use `gen_uuid_v4()` for tables with a high insert
rate. A version 4 UUID is random, so new keys spread across all ranges of the
primary index:

```camussql
CREATE TABLE players (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  name STRING(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now())
);
```

CamusDB has no bit-reversed sequence. Use `gen_uuid_v4()` instead.

`gen_id()` and `gen_uuid_v7()` remain good choices when:

- The deployment uses hash routing. The whole table is on one partition, so key
  order does not cause a range hotspot.
- The insert rate is low and new rows are read together. A time-ordered key
  keeps those rows near each other in the index.

See [UUID functions](/docs/functions-uuid) for the generators.

### Match a composite key to the access pattern

Put first a well-spread column that every query filters on, such as
`tenant_id` or `player_id`. Put the ordering column second:

```camussql
CREATE TABLE match_events (
  player_id UUID NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now()),
  kind STRING(32) NOT NULL,
  score INT64 NOT NULL
) PRIMARY KEY (player_id, created_at DESC);
```

Each player's entries stay together in the primary index, so a query for one
player's recent events reads one contiguous span of that index:

```camussql
SELECT created_at, kind, score
FROM match_events
WHERE player_id = @player_id
ORDER BY created_at DESC
LIMIT 20;
```

Inserts for different players go to different parts of the key space, so the
key has no global hotspot. CamusDB reads the primary index first, then fetches
each row by its row id. A primary key does not support `INCLUDE`.

## Secondary indexes

### The hotspot rule applies to indexes

With key-range sharding, each secondary index has its own ranges. An index
whose first key column is a time column becomes a hotspot, for the same reason
as a primary key:

```camussql
-- Every insert writes to the last range of this index.
CREATE INDEX match_events_created_idx ON match_events (created_at);
```

CamusDB has no hash-sharded indexes. Put a well-spread column, or one you
always filter on, in front of the time column:

```camussql
CREATE INDEX match_events_kind_idx ON match_events (kind, created_at);
```

A column with few values, such as `kind`, spreads writes only across those
values. A column such as `player_id` or `tenant_id` spreads them better.

### Use covering indexes on hot read paths

CamusDB declares a covering index with `INCLUDE (...)`; there is no `STORING`
keyword. Included columns are stored with each index entry, so a covered query
does not fetch the row:

```camussql
CREATE INDEX match_events_kind_idx
ON match_events (kind, created_at)
INCLUDE (score);
```

`EXPLAIN` shows `index-only=true` on the scan when the index covers the query.
The included-column payload is limited to 4 KiB per entry. See
[Indexes](/docs/sql-indexes) for the rules.

### Add indexes only for real queries

Each index adds one mutation to every row insert and delete, and updating an
indexed column also writes the index. These mutations count toward the
20,000-mutation limit per transaction. See
[Transaction limits](/docs/transaction-limits).

With key-range sharding, an index's ranges can be on a different partition from
the row, which makes the write a distributed write. Use
[`EXPLAIN`](/docs/explain) and [Query activity](/docs/query-activity) to find
which indexes queries use, and drop the ones no query uses.

## Row and column design

### Keep rows small

A row is the unit of storage and versioning, so updating one column writes a
new version of the whole row.

CamusDB already moves large `STRING`, `BYTES`, and `ARRAY` values out of the
row. With the default `EXTENDED` strategy, a value at or above
`large_value_threshold_bytes` (2048 bytes by default) goes under its own key,
and an update that does not change that column does not rewrite the value. So
you do not need a separate table just to hold a large value. See
[Large values](/docs/storage-layout).

Values below the threshold stay in the row. Move such a value to a separate
table when it sits beside columns that change often. JSON text in a `STRING`
column is a common example: a 1 KiB profile document in the same row as a
counter that changes on every match is rewritten on every match.

### Avoid a single hot row

A global counter, or a single configuration row that every transaction
updates, makes all writers conflict on one key. Serializable transactions then
abort with `CADB0502 TransactionConflict`, and each client must replay its work.

Shard the counter across several rows, and have each writer update one shard
(for example, a random one):

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

Alternatively, compute the total from the source rows later, for example with
a [materialized view](/docs/materialized-views) that you refresh on a schedule.

### Use foreign keys where integrity matters

A [foreign key](/docs/foreign-keys) protects integrity, but it also adds work
to every write that changes a constrained column:

- A child write takes a shared lock on each distinct parent key until the
  transaction ends. Deleting that parent, or updating its key, waits for the
  lock or asks the transaction to retry.
- Deleting a parent, or updating a parent key, probes the child's index.
- The child table needs an index on the columns that reference the parent.
  When no index fits, CamusDB creates an owned `~fk_` index, which adds one more
  write to each child insert.
- An update that does not change a constrained column does no foreign-key work.

Think about each foreign key on a write-heavy table. A parent row that many
children reference, and that also changes often, is a point of contention.

## Transactions and contention

### Keep transactions small and short

A small transaction holds fewer locks and conflicts less with other
transactions. Try to touch only one entity's key range, such as one player's.

A transaction that touches more than one partition commits with two-phase
commit. See [Distributed transactions](/docs/distributed-transactions).

CamusDB bounds each read-write transaction:

| Limit | Default | Error |
| --- | --- | --- |
| Serializable read-write transaction lifetime | 1 hour | `CADB0505 TransactionLifetimeExceeded` |
| Mutations per transaction | 20,000 | `CADB0506 TransactionMutationLimitExceeded` |

### Always retry on the client

Serializable transactions can abort by design, and your application must
handle that:

| Code | Action |
| --- | --- |
| `CADB0502`, `CADB0504`, `CADB0505` | Replay the whole transaction from `BEGIN`. |
| `CADB0509` | Send the same `COMMIT` or `ROLLBACK` again. Do not replay the work. |
| `CADB0506` | Do not retry. Split the work into smaller transactions. |

CamusDB retries autocommit statements on the server, up to a bound. Explicit
transactions are the application's responsibility, so keep the transaction body
free of side effects you cannot repeat.

The drivers include helpers for this:

- .NET: `SerializableRetryHelper`. See [.NET driver](/docs/dotnet-driver).
- TypeScript: `transaction(...)` and `withRetry(...)`. See
  [TypeScript](/docs/typescript-connector).
- Python: `camusdb.run_transaction(...)` and `camusdb.aio.run_transaction(...)`.
  See [Python](/docs/python-driver#transactions-and-retries).

See [Retries and conflicts](/docs/serializable-retries) for the full rules.

### Use historical reads when you do not need the latest data

`AS OF SYSTEM TIME` reads a committed snapshot from the past and blocks no
writers. Use it for dashboards, reports, and leaderboards that can be a few
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

A large `DELETE` is one large transaction: it can hit the mutation limit and
holds locks for a long time. Let [row-level TTL](/docs/row-level-ttl) delete
expired rows in small background batches instead:

```camussql
CREATE TABLE sessions (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  player_id UUID NOT NULL,
  expires_at DATETIME NOT NULL
) WITH (ttl_expiration_expression = 'expires_at');
```

Keep in mind:

- An expired row stays readable until the sweep deletes it. Filter with
  `WHERE expires_at > NOW()` when your application needs exact expiry.
- A table with TTL cannot be the parent of a foreign key. CamusDB rejects that
  combination in either order.
- Each deleted row costs one mutation for the row and one more per index entry.

If you must delete rows by hand, do it in batches, each well below the
20,000-mutation limit.

## Related

- [Key-range sharding](/docs/key-range-sharding)
- [SHOW RANGES](/docs/show-ranges)
- [Indexes](/docs/sql-indexes)
- [Retries and conflicts](/docs/serializable-retries)
- [Transaction limits](/docs/transaction-limits)
- [Row-level TTL](/docs/row-level-ttl)
