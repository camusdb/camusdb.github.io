---
sidebar_position: 1.8
---

# Best practices

These practices help your schema and workload scale on CamusDB. Some apply to
all deployments. Others apply when [key-range sharding](/docs/key-range-sharding)
is on. Each section says which case applies.

## How CamusDB places data

Read this section first. The other practices follow from it.

- **[Hash routing](/docs/concepts#hash-and-key-range-routing)** is the
  default. The rows and the secondary indexes of a table are on one
  [partition](/docs/concepts#partition), a slice of the data that one group of
  nodes replicates. Your choice of key doesn't spread a table across
  partitions.
- **Key-range sharding** routes each [key space](/docs/concepts#key-space) by
  key order. The rows of a table and each of its secondary indexes are separate
  key spaces. Each key space starts as one
  [range](/docs/concepts#ranges-and-spans), and it can split into ranges that
  different partitions serve.

CamusDB stores each row under an internal row id. The primary key is a unique
index that maps each key to its row id. The row id is an ObjectId with a
timestamp prefix. For the key layout, see [Storage](/docs/storage).

This means that your primary key controls where the primary index entries go.
It doesn't control the order of row ids. With key-range sharding, new rows go
to the newest range of the row key space, for any primary key. The practices
below spread the writes across the primary and secondary indexes.

## Primary keys

### Every table needs a primary key

A `CREATE TABLE` without a primary key returns an error:

```text
CADB0400: A primary key column is mandatory in the table
```

CamusDB doesn't add a hidden key. Choose a key that real queries use. Then the
primary index does useful work.

### Avoid keys that always increase

With key-range sharding, a key that always increases sends all the inserts to
the last range of the primary index. That range becomes a hotspot. A split
doesn't help: new keys go to the newest range again.

The following keys increase over time:

- Sequence values, including `SERIAL` and identity columns.
- A `DATETIME` or `DATE` as the first key column.
- An `OID` from `gen_id()`. An ObjectId starts with a timestamp in seconds.
- A `UUID` from `gen_uuid_v7()`. A version 7 UUID starts with a timestamp in
  milliseconds.

A sequence has a second cost. It is one logical counter, and each insert that
needs a value goes through it. See [Sequences](/docs/sequences).

### Use a well-spread key

When key-range sharding is on, use `gen_uuid_v4()` for tables with a high
insert rate. A version 4 UUID is random. This means that new keys spread across
all the ranges of the primary index:

```camussql
CREATE TABLE players (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  name STRING(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now())
);
```

CamusDB doesn't have bit-reversed sequences. Use `gen_uuid_v4()`.

`gen_id()` and `gen_uuid_v7()` are good choices in these cases:

- The deployment uses hash routing. The table is on one partition, and key
  order doesn't cause a range hotspot.
- The insert rate is low, and new rows are read together. A time-ordered key
  puts those rows near each other in the index.

For the generators, see [UUID functions](/docs/functions-uuid).

### Match a composite key to the access pattern

Put first a well-spread column that all queries filter on, such as `tenant_id`
or `player_id`. Put the ordering column second:

```camussql
CREATE TABLE match_events (
  player_id UUID NOT NULL,
  created_at DATETIME NOT NULL DEFAULT (now()),
  kind STRING(32) NOT NULL,
  score INT64 NOT NULL
) PRIMARY KEY (player_id, created_at DESC);
```

The entries of each player are together in the primary index. A query for the
recent events of one player reads one contiguous span of that index:

```camussql
SELECT created_at, kind, score
FROM match_events
WHERE player_id = @player_id
ORDER BY created_at DESC
LIMIT 20;
```

Inserts for different players go to different parts of the key space. This
means that the key doesn't have a global hotspot. The query reads the primary
index, and then it fetches each row by its row id. A primary key doesn't
support `INCLUDE`.

## Secondary indexes

### The hotspot rule applies to indexes

With key-range sharding, each secondary index has separate ranges. An index
whose first key column is a time column becomes a hotspot, for the same reason
as a primary key:

```camussql
-- Each insert writes to the last range of this index.
CREATE INDEX match_events_created_idx ON match_events (created_at);
```

CamusDB doesn't have hash-sharded indexes. Put a well-spread column, or a
column that you always filter on, in front of the time column:

```camussql
CREATE INDEX match_events_kind_idx ON match_events (kind, created_at);
```

A column with few values, such as `kind`, spreads the writes across those values
only. A column such as `player_id` spreads them better.

### Use covering indexes on hot read paths

To declare a covering index, use `INCLUDE (...)`. CamusDB doesn't have the
`STORING` keyword. The included columns are stored with each index entry. This
means that a covered query doesn't fetch the row:

```camussql
CREATE INDEX match_events_kind_idx
ON match_events (kind, created_at)
INCLUDE (score);
```

`EXPLAIN` shows `index-only=true` on the scan when the index covers the query.
The included values of one entry are limited to 4 KiB
(`max_index_include_tuple_bytes`). See [Indexes](/docs/sql-indexes).

### Add indexes for real queries

Each index adds one mutation to each row insert and delete. An update of an
indexed column also writes the index. These mutations count toward the limit
of 20,000 mutations for each transaction. See
[Transaction limits](/docs/transaction-limits).

With key-range sharding, the ranges of an index can be on a different partition
from the row. Then the write is a distributed write. To find the indexes that
your queries use, see [Index usage](/docs/index-usage). You should drop an
index that no query uses.

## Row and column design

### Keep rows small

A row is the unit of storage and versioning. An update of one column writes a
new version of the row.

Large `STRING`, `BYTES`, and `ARRAY` values are moved out of the row. With the
default `EXTENDED` strategy, a value at or above `large_value_threshold_bytes`
(default 2048 bytes) is stored under a separate key. An update that doesn't
change that column doesn't write the value again. This means that you don't
need a separate table for a large value. See [Large values](/docs/storage-layout).

A smaller value is stored in the row. Move such a value to a separate table if
it is next to columns that change often. For example, a 1 KiB JSON profile in
the same row as a match counter is written again at each match.

### Avoid a single hot row

A global counter, or one configuration row that all transactions update, makes
all writers conflict on one key. Serializable transactions then abort with
`CADB0502 TransactionConflict`, and each client must replay its work.

Split the counter across several rows. Each writer updates one shard, for
example a random one:

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

You can also compute the total from the source rows later, for example with a
[materialized view](/docs/materialized-views) that you refresh on a schedule.

### Use foreign keys where integrity matters

A [foreign key](/docs/foreign-keys) protects integrity. However, it adds work to
each write that changes a constrained column:

- A child write takes a shared lock on each distinct parent key until the
  transaction ends. A delete of that parent, or an update of its key, waits for
  the lock or must retry.
- A delete of a parent, or an update of a parent key, reads the index of the
  child table.
- The child table needs an index on the columns that reference the parent. If
  no index fits, CamusDB creates an owned `~fk_` index. This index adds one more
  write to each child insert.
- An update that doesn't change a constrained column doesn't do foreign-key
  work.

Consider each foreign key on a write-heavy table. A parent row that many
children reference, and that also changes often, is a point of contention.

## Transactions and contention

### Keep transactions small and short

A small transaction takes fewer locks, and it conflicts less with other
transactions. If you can, touch the key range of one entity, such as one
player.

A transaction that touches more than one partition commits with two-phase
commit. See [Distributed transactions](/docs/distributed-transactions).

Each read-write transaction has these limits:

| Limit | Default | Error |
| --- | --- | --- |
| Serializable read-write transaction lifetime | 1 hour | `CADB0505 TransactionLifetimeExceeded` |
| Mutations per transaction | 20,000 | `CADB0506 TransactionMutationLimitExceeded` |

### Retry on the client

Serializable transactions can abort by design. Your application must handle
this:

| Code | Action |
| --- | --- |
| `CADB0502`, `CADB0504`, `CADB0505` | Replay the transaction from `BEGIN`. |
| `CADB0509` | Send the same `COMMIT` or `ROLLBACK` again. Don't replay the work. |
| `CADB0506` | Don't retry. Split the work into smaller transactions. |

The server retries a serializable autocommit statement after a conflict, a
limited number of times. For an explicit transaction, your application must
retry. Keep side effects that you can't repeat out of the transaction.

Each driver has a helper for this:

- .NET: `SerializableRetryHelper`. See [.NET driver](/docs/dotnet-driver).
- TypeScript: `transaction(...)` and `withRetry(...)`. See
  [TypeScript](/docs/typescript-connector).
- Python: `camusdb.run_transaction(...)` and `camusdb.aio.run_transaction(...)`.
  See [Python](/docs/python-driver#transactions-and-retries).

For the full rules, see [Retries and conflicts](/docs/serializable-retries).

### Use historical reads when you don't need the latest data

`AS OF SYSTEM TIME` reads a committed snapshot from the past, and it doesn't
block writers. Use it for dashboards and leaderboards that can be a few seconds
old:

```camussql
SELECT player_id, score
FROM leaderboard AS OF SYSTEM TIME '-10s'
ORDER BY score DESC
LIMIT 100;
```

See [Time-travel reads](/docs/time-travel-reads).

## Operations

### Use row-level TTL for expired rows

A large `DELETE` is one large transaction. It can reach the mutation limit, and
it locks rows for a long time. Use [row-level TTL](/docs/row-level-ttl) to
delete expired rows in small background batches:

```camussql
CREATE TABLE sessions (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  player_id UUID NOT NULL,
  expires_at DATETIME NOT NULL
) WITH (ttl_expiration_expression = 'expires_at');
```

Note the following:

- You can read an expired row until the sweep deletes it. If your application
  needs exact expiry, filter with `WHERE expires_at > NOW()`.
- A table with TTL can't be the parent of a foreign key. Both orders return
  `CADB0533`: a foreign key to a TTL table, and TTL on a referenced table.
- Each deleted row costs one mutation for the row, and one more for each index
  entry.

If you must delete rows yourself, delete them in batches well below the limit
of 20,000 mutations.

## Related pages

- [Key-range sharding](/docs/key-range-sharding)
- [SHOW RANGES](/docs/show-ranges)
- [Indexes](/docs/sql-indexes)
- [Retries and conflicts](/docs/serializable-retries)
- [Transaction limits](/docs/transaction-limits)
- [Row-level TTL](/docs/row-level-ttl)
