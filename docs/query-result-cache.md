---
sidebar_position: 3.15
---

# Query result cache

The query result cache keeps the result of a `SELECT` in memory. When the same
query runs again with the same values, CamusDB returns the stored result
without executing the query or reading storage again.

## Why use the cache

Many applications run the same read again and again: a leaderboard, a store's
home page, a product catalog, a settings lookup, or a dashboard panel that
refreshes every few seconds. The data behind these reads changes much less
often than clients read it, yet each read still costs a full query execution.

The cache removes that repeated cost. A hit returns from memory, so you get:

- Lower latency for the cached query.
- Less load on storage and on the partition
  [leaders](/docs/concepts#leader) (the nodes that serve each slice of the data),
  which leaves more capacity for writes and other queries.
- No separate cache service to run, and no invalidation code in the
  application. A write on the same node removes the affected entries
  automatically.

The cache is a poor fit when:

- The values in the query differ on almost every request, so the same result
  is rarely asked for twice.
- The data changes on almost every request, so each entry is removed before a
  second read uses it.
- A read must see a write from another node at once. One node's cache does not
  see a write on another node until the entry expires. `strict` mode removes
  that delay, at a cost on each hit. See [Strict mode](#strict-mode).

## How the cache works

The result cache is an opt-in, per-node, in-memory cache of fully materialized
`SELECT` results.

A query opts in with an inline hint, as in
`SELECT * FROM orders {cache=recent_orders}`. CamusDB can then serve an
identical later query from memory, without touching storage. That query needs
the same shape, the same bound values, and the same schema.

The cache is correct before it is fast. A committed write on the same node
evicts every dependent entry before the write becomes visible to a later probe,
so a reader on the same node never sees stale data.

The cache does not see a write on another node immediately. A per-entry TTL
bounds that staleness, and the opt-in `strict` mode removes it at each hit.

The cache is enabled by default, but it does nothing until a query opts in with
a hint, so it is safe to leave on. Set `query_result_cache_enabled: false` to
turn it off completely.

This page covers what you need to use and tune the cache. For the read path,
the invalidation protocol, and the publish gate, see
[Query result cache internals](/docs/query-result-cache-internals).

## The mental model

The rest of this page builds on these ideas:

- Each query names a family. A `SELECT` opts in with a `{cache=name}` hint,
  where `name` is the family. The entry key holds five more parts: the database
  id, the query shape, each bound value with its type, the schema versions, and
  the cache options. Two queries share an entry only when every part matches.
- The cache is per node and lives in memory. It is an L1 cache, a first-level
  cache inside the server process, and each process owns one. CamusDB does not
  share it across a cluster or replicate it, and it does not survive a restart.
  A hit on node A tells you nothing about node B.
- Reads capture dependencies, and writes invalidate against them. While a
  cached query executes, CamusDB records the
  [key spaces](/docs/concepts#key-space) (all the keys that share one prefix,
  such as one table's rows) that the query scanned, for membership, and the
  rows it read, for content. When a transaction commits on this node, CamusDB
  maps its modified keys back onto those dependencies and drops every entry
  that overlaps. A missed dependency would be a correctness bug. A dependency
  that is slightly too wide only costs a false eviction, which is acceptable.
- Same-node writes are exact. Writes on other nodes are bounded by the TTL, or
  by strict mode. After a write commits on this node, CamusDB cannot serve a
  stale entry for the key space the write touched, even if a query was
  executing at the same moment. A write on another node is invisible to this
  node's cache until the entry's TTL expires. Entries with the `strict` option
  are the exception: CamusDB validates each hit against live storage first.
  See [Strict mode](#strict-mode).

### Vocabulary

A family name is the `name` in `{cache=name}`. It is a logical namespace for a
set of parameterized entries, and `EVICT CACHE 'name'` targets one family.
CamusDB lowercases the name when it parses it, so family names are not
case-sensitive.

A result fingerprint is an entry's key. It is a 128-bit hash over the database
id, the family name, the query shape, the typed bound values, the schema
versions, and the cache options. Two logically different queries never share a
fingerprint. Each value carries its type, so the integer `1` and the string
`'1'` never share an entry. See
[The fingerprint](/docs/query-result-cache-internals#the-fingerprint).

The dependency set is what an entry depends on. It holds three kinds of
dependency:

- A range dependency is a key space bucket that the query scanned, for
  membership: a table's row bucket, or an index bucket. It catches inserts and
  phantom rows.
- A point dependency is the full key/value key of a row whose bytes the query
  read. It catches content updates and deletes, which a later range scan could
  miss.
- A schema dependency is a `tableId` and `schemaVersion` pair that the plan and
  the row decoder used.

A key space bucket is the coarse unit of invalidation. A row bucket is
`{dbId}:{tableId}|r`, and an index bucket is `{dbId}:{tableId}|i:{indexId}`.
CamusDB maps each modified key back to its bucket to find the affected entries.
Buckets are coarse by design, which keeps the invalidation index small.

## Use the cache

### The cache hint

Add `{cache=name}` immediately after a table reference, and after its optional
alias:

```camussql
SELECT id, total FROM orders {cache=recent_orders} WHERE status = 1 ORDER BY total DESC LIMIT 20;
```

Put options inside the braces, separated by commas, in any order:

```camussql
SELECT * FROM orders {cache=hot_orders, ttl=30s};        -- per-entry TTL override
SELECT * FROM orders {cache=hot_orders, strict};         -- validate each hit against live storage
SELECT * FROM orders {cache=hot_orders, ttl=5m, strict};
```

`ttl=<n>[unit]` overrides the default TTL for this entry. The units are `ms`,
`s`, `m`, and `h`, and a bare integer means milliseconds. The value must be a
positive integer within the range of an `int`. `ttl=0`, an overflow, an unknown
unit, and a value that is not an integer are all parser errors.

`strict` turns on validation against live storage at every hit. See
[Strict mode](#strict-mode). Use it when a reader must not see staleness from
another node.

The hint applies to the whole `SELECT` result, not only to the table where it
appears.

A statement accepts one hint, and a second hint is a parser error. Unknown
option names and unknown hint keys are also parser errors.

The `@`-prefixed form, `@{cache=name}`, is an accepted alias of `{cache=name}`
and takes the same options. It is convenient because `@{…}` is also the index
hint syntax, as in `@{FORCE_INDEX=idx}`. Both forms produce an identical cache
hint.

### Evict an entry by hand

```camussql
EVICT CACHE 'recent_orders';   -- drop every entry in that family, for the current database
EVICT CACHE ALL;               -- drop every result-cache entry for the current database
```

Both statements are scoped to the current database. `EVICT CACHE ALL` never
touches another database's entries.

The family name is a quoted string. CamusDB matches it case-insensitively by
lowercasing it, the same way the hint stores names.

`EVICT` is a reserved word, but `CACHE` and `ALL` are not, so existing tables
or columns named `cache` or `all` keep working.

### What is eligible for the cache

A query takes the cache path only when all of these conditions hold:

- It carries a `{cache=…}` hint.
- It is an autocommit read: a read-only transaction for which the client
  supplied no transaction id. An explicit `BEGIN … READ ONLY` carries its own
  pinned snapshot, so CamusDB excludes it by design, and it always reads live
  storage.
- It is not `SELECT ... FOR UPDATE`; cached rows cannot acquire row locks.
- It queries a single table. Joins and combined results from `UNION`,
  `INTERSECT`, or `EXCEPT` bypass the cache.
- The cache is enabled.

Every other query reads live storage. A hint on a join, or inside a subquery in
a `WHERE` clause, has no effect: CamusDB ignores the hint rather than honoring
it in part.

### Observe what happened

Every response to a hinted query carries cache metadata, so clients never have
to guess from the response time:

| Field | Meaning |
|-------|---------|
| `cacheStatus` | `hit`, `miss`, `bypass`, `stale-revalidated`, or `evicted-before-publish` |
| `cacheBypassReason` | The reason for a bypass or a failed publish (see below). Null otherwise. |
| `cacheName` | The family name. Present whenever the query was eligible for the cache. |
| `cachedAtHlc` | The [HLC](/docs/concepts#hlc) timestamp (the cluster-wide clock value) at which CamusDB computed a served entry. Present on hits only. |
| `ageMs` | The approximate age of a served entry, in wall-clock milliseconds. Present on hits only. |

CamusDB omits these fields entirely for queries without a hint, so existing
clients are unaffected.

gRPC reports the same five values. They cannot live in the response envelope,
because CamusDB knows the verdict only after it drains the cursor. Instead,
they travel as a trailing `CacheMetadata` message, appended after the last row
on the unary stream of an `ExecuteQuery`, and on the `QueryComplete`
terminator of a query inside a `BatchExecute`. An absent message means the
statement carried no hint, and an absent `cacheStatus` means the same over
REST.

The status values mean:

- `hit`: CamusDB served the stored rows.
- `miss`: CamusDB executed the query live and stored a fresh entry.
- `bypass`: CamusDB executed the query live and stored nothing, because the
  query was ineligible or a write was in flight.
- `evicted-before-publish`: CamusDB executed the query live and returned
  correct rows, but could not store the fresh entry.
- `stale-revalidated`: CamusDB found a strict entry, discovered that it was
  stale, and executed the query live again.

CamusDB currently emits four bypass reasons:

- `in-flight-write`: a write into the scan's key space was committing.
- `cache-disabled`: the feature is off, and the query was otherwise eligible.
- `oversized-result`: the result passed the row or byte cap for one entry, or
  the cache is full.
- `dependency-limit`: there were too many dependencies to record completely,
  or a strict entry lost some of its row dependencies to the cap.

The envelope schema holds other reason strings, but the current code produces
none of them.

## How the cache stays correct

The cache never trades correctness for speed. These rules decide what you can
observe, and the [internals page](/docs/query-result-cache-internals) explains
each mechanism.

- A committed write on this node evicts every entry that depends on the rows or
  key spaces it changed, before the write becomes visible. A transaction that
  rolls back evicts nothing. A DDL statement evicts every entry that depends on
  the changed table, and a changed schema version also changes the fingerprint.
- A query that starts while a write into the same table is committing executes
  live and stores nothing. Its status is `bypass` with the reason
  `in-flight-write`.
- When a write into the same table commits while a query executes, CamusDB
  returns the live rows but does not store them. The status is
  `evicted-before-publish` with the reason `in-flight-write`.
- Concurrent misses for the same fingerprint share one execution. The other
  callers wait up to `query_result_cache_singleflight_wait_ms`, then probe the
  cache themselves. A waiter never receives rows that skipped its own checks.
- A cancelled or failed query never stores a partial result.
- When a result passes the row, byte, or dependency caps, CamusDB returns the
  live rows and stores nothing. The status is `evicted-before-publish` with the
  reason `oversized-result` or `dependency-limit`.

### Strict mode

A non-strict entry can lag a write on another node until its TTL expires. A
`strict` entry removes that lag. At every hit, before serving the rows, CamusDB
checks the schema versions, each row the query read, and each scanned bucket
against live storage. A changed, deleted, or inserted row makes the entry
stale, so CamusDB evicts it, runs the query live, and reports
`stale-revalidated`.

Strict mode has these limits:

- It needs a snapshot timestamp. Only an autocommit read under the serializable
  default without [key-range sharding](/docs/key-range-sharding), or an
  `AS OF SYSTEM TIME` read, has one. For any other read, a `strict` hint returns
  live rows and stores nothing.
- CamusDB does not store a strict entry whose row dependencies passed
  `query_result_cache_max_point_deps`, because without every row it could not
  detect a delete.
- A validation can cost as much as a range scan. When it would read more than
  `query_result_cache_strict_validation_max_keys` keys, it fails closed: CamusDB
  treats the entry as stale and runs the query live.

## Configuration

Set these keys in the same `config.yml` as the rest of the server.
`query_result_cache_enabled` needs a restart. Do not rely on a live change to
`query_result_cache_default_ttl_ms`, `query_result_cache_max_entries`,
`query_result_cache_max_bytes`, or `query_result_cache_sweep_interval_ms`:
today the node keeps its startup values for these four keys until it restarts.

| Key | Default | Meaning |
|-----|---------|---------|
| `query_result_cache_enabled` | `true` | The main switch. While it is off, CamusDB reports a hint as a `bypass` with the reason `cache-disabled`, and does no cache or gate work. Turn it off to remove all cache memory, and the small gate bookkeeping on each write, on a deployment that never uses `{cache=…}`. |
| `query_result_cache_default_ttl_ms` | `5000` | The TTL of an entry whose hint has no `ttl`. |
| `query_result_cache_max_entries` | `1024` | The cap on the number of entries. Past that cap, CamusDB evicts the least recently used entry. |
| `query_result_cache_max_bytes` | `67108864` | The byte budget across all entries (64 MiB). |
| `query_result_cache_max_entry_bytes` | `1048576` | The byte cap for one entry (1 MiB). CamusDB does not store a larger result. |
| `query_result_cache_max_entry_rows` | `10000` | The row cap for one entry. CamusDB does not store a larger result. |
| `query_result_cache_max_deps` | `4096` | The cap on total dependencies for one entry. Past that cap, CamusDB bypasses the publish. |
| `query_result_cache_max_point_deps` | `2048` | The cap on point dependencies for one entry. Past that cap, CamusDB drops point dependencies, and bypasses a strict entry. |
| `query_result_cache_max_ranges` | `256` | The cap on range dependencies for one entry. |
| `query_result_cache_singleflight_wait_ms` | `250` | How long a concurrent miss on the same fingerprint waits for the in-flight owner before it executes on its own. See [How the cache stays correct](#how-the-cache-stays-correct). |
| `query_result_cache_strict_validation_max_keys` | `10000` | The probe key budget for strict validation. Past that budget, the validation fails closed. |
| `query_result_cache_sweep_interval_ms` | `10000` | The interval of the background TTL sweep. |

A cap breach fails safe. The query still returns correct live rows, and the
cache either skips storing the entry or evicts an entry to make room. It
never stores an entry that is incomplete or too large.

As an operator, add a `{cache=…}` hint to queries that run often, repeat often
with the same parameters, and read data that changes much less often than
clients read it.

In a cluster, remember that each node caches on its own. With the default,
non-strict entries, a reader on one node can lag a write on another node, and
the TTL bounds that lag.

Lower `query_result_cache_default_ttl_ms` to tighten that bound, or use
`{cache=…, strict}` on the specific queries that must never lag. That option
costs one validation scan per hit.

Size `query_result_cache_max_bytes` and `query_result_cache_max_entries` to the
working set you want resident. CamusDB simply does not cache a result that is
too large.

## Limits and non-goals

- The cache is per node only. There is no sharing across nodes, no immediate
  invalidation across nodes, and no persistence across restarts. Freshness
  across nodes is bounded by the TTL or validated by strict mode, never
  immediate.
- The cache covers single-table reads only. Joins bypass it, and a hint on a
  join or inside a subquery has no effect.
- The cache covers autocommit reads only. Explicit transactions, including
  `READ ONLY` ones, always read live storage.
- The cache assumes, in spirit, a deterministic read. It keys on values, not on
  the wall clock or session state. Do not hint a query whose result depends on
  a non-deterministic input, because the cache would store one evaluation of
  it.
- Write paths never read the cache. `UPDATE ... WHERE` and `DELETE ... WHERE`
  both evaluate against live storage.

Natural directions for the future:

1. Immediate invalidation across the cluster.
2. Index scan fences, which would narrow the row bucket snapshot.
3. A join cache, which needs a fence on every table in the join.
4. A second tier that is shared or persistent.

None of them changes the correctness contract above.
