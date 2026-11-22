---
sidebar_position: 3.15
---

# Query result cache

The query result cache stores the result of a `SELECT` in memory. When the same
query is executed again with the same values, CamusDB returns the stored result. It
doesn't execute the query or read storage again.

## When to use the cache

Many applications repeat the same read: a leaderboard, the home page of a store,
a product catalog, a settings lookup, or a dashboard panel that refreshes at short
intervals. The data behind these reads changes much less often than clients
read it, but each read costs a full query execution.

The cache removes that repeated cost. A hit returns from memory, and you get:

- Lower latency for the cached query.
- Less load on storage and on the partition
  [leaders](/docs/concepts#leader) (the nodes that serve each part of the
  data). This leaves more capacity for writes and other queries.
- No separate cache service to operate, and no invalidation code in the
  application. A write on the same node removes the affected entries
  automatically.

The cache isn't a good fit when:

- The values in the query are different in almost each request, and the same
  result is rarely requested twice.
- The data changes with almost each request, and each entry is removed before
  a second read can use it.
- A read must see a write from another node immediately. The cache of one node
  doesn't see a write on another node until the entry expires. `strict` mode
  removes that delay, at a cost on each hit. See [Strict mode](#strict-mode).

## How the cache works

The result cache stores complete `SELECT` results in memory, on each node. A
query opts in with a hint, as in `SELECT * FROM orders {cache=recent_orders}`.
CamusDB can then serve a later identical query from memory, and it doesn't read
storage. That query must have the same shape, the same bound values, and the
same schema.

A committed write on the same node evicts the dependent entries before a later
lookup can see the write. A reader on the same node therefore doesn't see stale
data.

The cache doesn't see a write on another node immediately. A TTL for each entry
limits that staleness, and the optional `strict` mode removes it at each hit.

The cache is on by default, and it applies only to queries with a hint. It is
safe to leave on. Set `query_result_cache_enabled: false` to turn it off.

This page covers what you need to use and tune the cache. For the read path,
the invalidation protocol, and the publish gate, see
[Query result cache internals](/docs/query-result-cache-internals).

## How entries are keyed and invalidated

The rest of this page uses these ideas:

- **Each query names a family.** A `SELECT` opts in with a `{cache=name}` hint,
  and `name` is the family. The entry key has five more parts: the database ID,
  the query shape, each bound value with its type, the schema versions, and the
  cache options. Two queries share an entry if all parts match.
- **The cache is in memory, on each node.** It is an L1 cache, a first-level
  cache in the server process, and each process has one. CamusDB doesn't share
  it across a cluster or replicate it, and it is empty after a restart. A hit on
  node A doesn't tell you anything about node B.
- **Reads record dependencies, and writes invalidate them.** While a cached
  query executes, CamusDB records the [key spaces](/docs/concepts#key-space)
  (the keys that share one prefix, such as the rows of one table) that the query
  scanned, and the rows that it read. When a transaction commits on this node,
  CamusDB matches its modified keys with those dependencies, and it drops each
  entry that overlaps.
- **Same-node writes are exact. Writes on other nodes are limited by the TTL,
  or by strict mode.** After a write commits on this node, CamusDB can't serve a
  stale entry for the key space of the write, also if a query was executing at
  the same time. The cache of this node doesn't see a write on another node
  until the entry's TTL expires. A `strict` entry is the exception: CamusDB
  validates each hit against live storage first. See [Strict mode](#strict-mode).

### Vocabulary

A **family name** is the `name` in `{cache=name}`. It groups a set of entries
with different parameters, and `EVICT CACHE 'name'` targets one family. CamusDB
converts the name to lowercase, and family names aren't case-sensitive.

A **result fingerprint** is the key of an entry. It is a 128-bit hash over the
database ID, the family name, the query shape, the typed bound values, the
schema versions, and the cache options. Two queries that differ in meaning
don't share a fingerprint. Each value includes its type, and the integer `1` and
the string `'1'` don't share an entry. See
[The fingerprint](/docs/query-result-cache-internals#the-fingerprint).

The **dependency set** is what an entry depends on. It has three kinds of
dependency:

- A **range dependency** is a key space bucket that the query scanned: the row
  bucket of a table, or an index bucket. It detects inserted rows.
- A **point dependency** is the full key of a row that the query read. It
  detects updates and deletes of the row.
- A **schema dependency** is the `tableId` and `schemaVersion` that the plan
  and the row decoder used.

A **key space bucket** is the unit of invalidation: the rows of one table, or
one index. CamusDB maps each modified key to its bucket to find the affected
entries.

## Use the cache

### The cache hint

Put `{cache=name}` directly after a table reference, after its optional alias:

```camussql
SELECT id, total FROM orders {cache=recent_orders} WHERE status = 1 ORDER BY total DESC LIMIT 20;
```

Put options in the braces, separated by commas, in any order:

```camussql
SELECT * FROM orders {cache=hot_orders, ttl=30s};        -- TTL for this entry
SELECT * FROM orders {cache=hot_orders, strict};         -- validate each hit against live storage
SELECT * FROM orders {cache=hot_orders, ttl=5m, strict};
```

`ttl=<n>[unit]` sets the TTL of this entry. The units are `ms`, `s`, `m`, and
`h`, and a bare number means milliseconds. The value must be a positive
integer within the range of an `int`. `ttl=0`, an overflow, an unknown unit, a
value that isn't an integer, and an unknown option return `CADB0400`.

`strict` validates the entry against live storage at each hit. Use it when a
reader must not see stale data from another node. See [Strict mode](#strict-mode).

The hint caches the full result of the `SELECT`, wherever it appears in the
statement. A statement can have one hint. A second hint is a syntax error
(`CADB0406`).

`@{cache=name}` is another form of the hint, and it takes the same options. It
matches the index hint syntax, as in `@{FORCE_INDEX=idx}`.

### Evict entries manually

```camussql
EVICT CACHE 'recent_orders';   -- drop all entries of that family in the current database
EVICT CACHE ALL;               -- drop all result cache entries of the current database
```

Both statements apply to the current database only. `EVICT CACHE ALL` doesn't
change the entries of other databases. The family name is a quoted string, and
it isn't case-sensitive.

`EVICT` is a reserved word. `CACHE` and `ALL` aren't, and tables or columns
named `cache` or `all` work as before.

### What is eligible for the cache

A query uses the cache if all of these conditions are true:

- It has a `{cache=…}` hint.
- It is an autocommit read: a read-only transaction with no transaction ID from
  the client. An explicit `BEGIN … READ ONLY` has a fixed snapshot, and it always
  reads live storage.
- It isn't `SELECT ... FOR UPDATE`. Cached rows can't take row locks.
- It reads one table. Joins, views, and combined results from `UNION`,
  `INTERSECT`, or `EXCEPT` bypass the cache.
- It doesn't use a volatile function, such as a clock or random function.
- The cache is on.

Other queries read live storage. A hint on a join, or a hint only in a `WHERE`
subquery, isn't used. The response shows the status `bypass` with the reason,
such as `join` or `inner-hint`.

### Read the cache status

Each response to a query with a hint has cache metadata:

| Field | Meaning |
|-------|---------|
| `cacheStatus` | `hit`, `miss`, `bypass`, `stale-revalidated`, or `evicted-before-publish` |
| `cacheBypassReason` | The reason for a bypass or a failed publish (see below). Null otherwise. |
| `cacheName` | The family name. Present when the query had a hint. |
| `cachedAtHlc` | The [HLC](/docs/concepts#hlc) timestamp (the cluster-wide clock value) at which CamusDB computed the entry. Present on hits only. |
| `ageMs` | The approximate age of the entry, in milliseconds. Present on hits only. |

For queries without a hint, CamusDB omits these fields, and existing clients
aren't affected.

gRPC returns the same five values in a trailing `CacheMetadata` message, after
the last row of an `ExecuteQuery` stream, and on the `QueryComplete` message of
a query in a `BatchExecute`. If the message is missing, the statement had no
hint. Over REST, a missing `cacheStatus` means the same.

The status values mean:

- `hit`: CamusDB returned the stored rows.
- `miss`: CamusDB executed the query and stored a new entry.
- `bypass`: CamusDB executed the query and didn't store an entry, because the query
  wasn't eligible or a write was in progress.
- `evicted-before-publish`: CamusDB executed the query and returned correct
  rows, but it couldn't store the new entry.
- `stale-revalidated`: CamusDB found a strict entry, found that it was stale,
  and executed the query again.

The bypass reasons are:

| Reason | Meaning |
| --- | --- |
| `in-flight-write` | A write to the scanned key space was committing. |
| `cache-disabled` | The cache is off, and the query was otherwise eligible. |
| `oversized-result` | The result passed the row or byte limit for one entry, or the cache is full. |
| `dependency-limit` | The query had too many dependencies to record, or a strict entry lost some of its row dependencies to the limit. |
| `join` | The query joins tables. |
| `derived-source` | The query reads through a view. |
| `inner-hint` | The hint is in a `WHERE` subquery, and the outer `SELECT` has no hint. |
| `in-transaction` | The query is in an explicit transaction or a write transaction. |
| `non-deterministic` | The query has a volatile function. |

## How the cache stays correct

These rules describe what you can observe. The
[internals page](/docs/query-result-cache-internals) explains each mechanism.

- A committed write on this node evicts each entry that depends on the rows or
  key spaces it changed, before the write is visible. A transaction that rolls
  back doesn't evict any entry. A DDL statement evicts each entry that depends
  on the changed table, and a new schema version also changes the fingerprint.
- A query that starts while a write to the same table is committing executes
  and doesn't store an entry. Its status is `bypass` with the reason `in-flight-write`.
- When a write to the same table commits while a query executes, CamusDB
  returns the live rows and doesn't store them. The status is
  `evicted-before-publish` with the reason `in-flight-write`.
- Concurrent misses for the same fingerprint share one execution. The other
  callers wait up to `query_result_cache_singleflight_wait_ms`, then look up the
  cache themselves. A waiter doesn't get rows that skipped its checks.
- A cancelled or failed query doesn't store a partial result.
- When a result passes the row, byte, or dependency limits, CamusDB returns the
  live rows and doesn't store an entry. The status is `evicted-before-publish` with the
  reason `oversized-result` or `dependency-limit`.

### Strict mode

An entry that isn't strict can lag behind a write on another node until its TTL
expires. A `strict` entry removes that lag. At each hit, before it returns the
rows, CamusDB checks the schema versions, each row that the query read, and
each scanned bucket against live storage. A changed, deleted, or inserted row
makes the entry stale. CamusDB then evicts the entry, executes the query, and
returns the status `stale-revalidated`.

Strict mode has these limits:

- **It needs a snapshot timestamp.** Only an autocommit read under the
  serializable default without [key-range sharding](/docs/key-range-sharding),
  or an `AS OF SYSTEM TIME` read, has one. For other reads, a `strict` hint
  returns live rows and doesn't store an entry.
- **It needs all row dependencies.** CamusDB doesn't store a strict entry whose
  row dependencies passed `query_result_cache_max_point_deps`. With missing
  rows, the entry couldn't detect a delete.
- **It can be expensive.** A validation can cost as much as a range scan. If it
  would read more than `query_result_cache_strict_validation_max_keys` keys,
  CamusDB treats the entry as stale and executes the query.

## Configuration

Set these keys in `config.yml`. A change to `query_result_cache_enabled` needs a
restart. You can change the other keys on a running node with
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings). A lower
`query_result_cache_max_entries` or `query_result_cache_max_bytes` evicts
entries at once. A new `query_result_cache_default_ttl_ms` applies to new
entries, and existing entries keep their expiry.

| Key | Default | Meaning |
|-----|---------|---------|
| `query_result_cache_enabled` | `true` | The main switch. When it is off, a hint gives `bypass` with the reason `cache-disabled`, and CamusDB does no cache work. Turn it off to remove the cache memory and the small bookkeeping on each write, if you don't use `{cache=…}`. |
| `query_result_cache_default_ttl_ms` | `5000` | The TTL of an entry whose hint doesn't set `ttl`. |
| `query_result_cache_max_entries` | `1024` | The maximum number of entries. Above that number, CamusDB evicts the least recently used entry. |
| `query_result_cache_max_bytes` | `67108864` | The byte budget for all entries (64 MiB). |
| `query_result_cache_max_entry_bytes` | `1048576` | The byte limit for one entry (1 MiB). CamusDB doesn't store a larger result. |
| `query_result_cache_max_entry_rows` | `10000` | The row limit for one entry. CamusDB doesn't store a larger result. |
| `query_result_cache_max_deps` | `4096` | The limit on total dependencies for one entry. Above it, CamusDB doesn't publish the entry. |
| `query_result_cache_max_point_deps` | `2048` | The limit on point dependencies for one entry. Above it, CamusDB drops point dependencies, and it doesn't publish a strict entry. |
| `query_result_cache_max_ranges` | `256` | The limit on range dependencies for one entry. |
| `query_result_cache_singleflight_wait_ms` | `250` | How long a concurrent miss on the same fingerprint waits for the first caller before it executes the query itself. See [How the cache stays correct](#how-the-cache-stays-correct). |
| `query_result_cache_strict_validation_max_keys` | `10000` | The maximum number of keys that strict validation reads. Above it, the entry is treated as stale. |
| `query_result_cache_sweep_interval_ms` | `10000` | The interval of the background TTL sweep. |

When a limit is reached, the query returns correct live rows. The cache doesn't
store the entry, or it evicts another entry to make room. It doesn't store an
entry that is incomplete or too large.

Add a `{cache=…}` hint to queries that run often, repeat with the same
parameters, and read data that changes much less often than clients read it.

In a cluster, each node has a separate cache. With the default entries, a reader on
one node can lag behind a write on another node, and the TTL limits that lag.
Lower `query_result_cache_default_ttl_ms` to reduce the lag, or use
`{cache=…, strict}` on the queries that must not lag. That option costs one
validation scan per hit.

Set `query_result_cache_max_bytes` and `query_result_cache_max_entries` to the
working set that you want in memory. CamusDB doesn't cache a result that is too
large.

## Limits

- The cache is on each node only. It isn't shared across nodes, writes on other
  nodes don't invalidate it immediately, and it isn't kept after a restart. The
  TTL or strict mode limits staleness across nodes.
- The cache covers reads of one table only. Joins and views bypass it.
- The cache covers autocommit reads only. Explicit transactions, including
  `READ ONLY` transactions, read live storage.
- The key of an entry depends on the query values. A query with a volatile
  function bypasses the cache with the reason `non-deterministic`.
- Writes don't read the cache. `UPDATE ... WHERE` and `DELETE ... WHERE` read
  live storage.
