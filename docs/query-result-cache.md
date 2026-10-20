---
sidebar_position: 3.15
---

# Query result cache

The query result cache keeps the result of a `SELECT` in memory. When the same
query runs again with the same values, CamusDB returns the stored result. It
does not execute the query again, and it does not read the storage again.

## Why use the cache

Many applications run the same read again and again: a leaderboard, the home
page of a store, a product catalog, a settings lookup, or a dashboard panel that
refreshes every few seconds. The data behind these reads changes much less often
than clients read it. Each read still costs a full query execution.

The cache removes that repeated cost. A hit returns from memory, so you get:

- A lower latency for the cached query.
- Less load on the storage and on the partition
  [leaders](/docs/concepts#leader) (the nodes that serve each slice of the data),
  which leaves more capacity for writes and for other queries.
- No separate cache service to run, and no invalidation code in the
  application. A write on the same node removes the affected entries
  automatically.

The cache is a poor fit in these cases:

- The values in the query are different at almost every request, so the same
  result is rarely asked for twice.
- The data changes at almost every request, so each entry is removed before a
  second read uses it.
- A read must see a write from another node at once. The cache of one node
  does not see a write on another node until the entry expires. The `strict`
  mode removes that delay, at a cost on each hit. See
  [Strict mode](#strict-mode).

## How the cache works

The result cache is an opt-in cache of a fully materialized `SELECT` result. It
belongs to one node, and it lives in memory.

A query joins the cache with an inline hint, as in
`SELECT * FROM orders {cache=recent_orders}`. CamusDB can serve an identical
later query from the memory, with no access to the storage. That query needs the
same shape, the same bound values, and the same schema.

The cache is correct before it is fast. A committed write on the same node
evicts every dependent entry, before that write becomes visible to a later
probe. A reader on the same node therefore never sees stale data.

The cache does not see a write on another node immediately. A per-entry TTL
bounds that staleness. The opt-in `strict` mode removes it at each hit.

The cache is enabled by default, but it does nothing until a query opts in with
a hint, so it is safe to leave on. Set `query_result_cache_enabled: false` to
turn it off completely.

This page covers what you need to use and tune the cache. For the read path,
the invalidation protocol, and the publish gate, see
[Query result cache internals](/docs/query-result-cache-internals).

## The mental model

Four ideas are the whole story. The rest of this page is detail.

- Each query names a family. A `SELECT` joins the cache with a `{cache=name}`
  hint, and the `name` is a family. The key of the entry holds five more parts:
  the id of the database, the shape of the query, each bound value with its
  type, the schema versions, and the options of the cache. Two queries share one
  entry only when every part matches.
- The cache belongs to one node, and it lives in memory. It is an L1 cache, a
  first-level cache inside the server process. Each process owns one cache.
  CamusDB does not share it across a cluster, and it does not replicate it. The
  cache does not survive a restart. A hit on node A tells you nothing about
  node B.
- A read captures a set of dependencies. A write invalidates against that set.
  While a cached query executes, CamusDB records two things: the
  [key spaces](/docs/concepts#key-space) (all the keys that share one prefix,
  such as one table's rows) that the query scanned, for the membership, and the
  rows that it read, for the content. A transaction commits on this node.
  CamusDB then maps its modified keys back onto those dependencies, and it drops
  every entry that overlaps. A dependency that CamusDB misses would be a defect
  of the correctness. A dependency that is a little too wide only costs a false
  eviction, and that cost is acceptable.
- A write on the same node is exact. A write on another node is bounded by the
  TTL, or by the strict mode. After a write commits on this node, CamusDB can
  serve no stale entry for the key space that the write touched, even when a
  query was executing at the same moment. A write on another node is invisible
  to the cache of this node until the TTL of the entry expires. An entry with
  the `strict` option is the exception. CamusDB validates each hit of such an
  entry against the live storage first. See [Strict mode](#strict-mode).

### The vocabulary

The name of a family is the `name` of a `{cache=name}`. It is a logical
namespace for a set of entries with parameters. `EVICT CACHE 'name'` targets one
family. CamusDB lowercases a name at the parse. A family is therefore not
case-sensitive.

The fingerprint of a result is the key of an entry. It is a 128-bit hash over
the database id, the family name, the query shape, the typed bound values, the
schema versions, and the cache options. Two queries that differ logically never
share a fingerprint. Each value carries its type, so the integer `1` and the
string `'1'` never share an entry. See
[The fingerprint](/docs/query-result-cache-internals#the-fingerprint).

The set of the dependencies is what an entry depends on. It has three kinds:

- A range dependency is a bucket of the key space that the query scanned, for
  the membership. It is the row bucket of a table, or a bucket of an index. A
  range dependency catches an insert, and a phantom row.
- A point dependency is the full key/value key of one row whose bytes the query
  read. It catches an update of the content, and a delete. A later scan of a
  range could miss both.
- A schema dependency is a pair of a `tableId` and a `schemaVersion`. The plan
  and the decoder of the rows used that pair.

A bucket of the key space is the coarse unit of an invalidation. A row bucket is
`{dbId}:{tableId}|r`. A bucket of an index is `{dbId}:{tableId}|i:{indexId}`.
CamusDB maps a modified key back to its bucket, to find the affected entries.
A bucket is coarse by design. The index of the invalidation therefore stays
small.

## Use the cache

### The hint

Add a `{cache=name}` immediately after a reference to a table, and after an
optional alias:

```camussql
SELECT id, total FROM orders {cache=recent_orders} WHERE status = 1 ORDER BY total DESC LIMIT 20;
```

The options go inside the braces. Separate them with a comma. The order does not
matter:

```camussql
SELECT * FROM orders {cache=hot_orders, ttl=30s};        -- per-entry TTL override
SELECT * FROM orders {cache=hot_orders, strict};         -- validate each hit against live storage
SELECT * FROM orders {cache=hot_orders, ttl=5m, strict};
```

`ttl=<n>[unit]` overrides the default TTL of this entry. The units are `ms`,
`s`, `m`, and `h`. A bare integer is a value in milliseconds. The value must be
a positive integer, inside the range of an `int`. Four inputs are errors of the
parser: a `ttl=0`, an overflow, an unknown unit, and a value that is not an
integer.

`strict` turns the validation at each hit on. CamusDB then validates against the
live storage. See [Strict mode](#strict-mode). Use the
option when a reader must not see staleness from another node.

The hint applies to the whole result of the `SELECT`. It does not apply to the
table of its position only.

One statement accepts one hint. A second hint is an error of the parser. An
unknown name of an option, and an unknown key of a hint, are also errors of the
parser.

The form with the `@` prefix, `@{cache=name}`, is an accepted alias of
`{cache=name}`. It takes the same options. That form is convenient, because
`@{…}` is also the syntax of a hint of an index, as in `@{FORCE_INDEX=idx}`.
Both forms produce an identical hint of the cache.

### Evict an entry by hand

```camussql
EVICT CACHE 'recent_orders';   -- drop every entry in that family, for the current database
EVICT CACHE ALL;               -- drop every result-cache entry for the current database
```

Both statements have the scope of the current database. `EVICT CACHE ALL` never
touches an entry of another database.

The name of the family is a string in quotation marks. CamusDB matches it
without regard to the case. It lowercases the name, to match the way that the
hint stores a name.

`EVICT` is a reserved word. `CACHE` and `ALL` are not. An existing table or
column with the name `cache` or `all` therefore continues to work.

### What is eligible for the cache

A query takes the path of the cache only when every one of these conditions
holds:

- It carries a `{cache=…}` hint.
- It is a read in autocommit mode. That read is a read-only transaction, and the
  client supplied no id of a transaction. An explicit `BEGIN … READ ONLY`
  carries its own pinned snapshot. CamusDB excludes it by design, and it always
  reads the live storage.
- It is a query over one table. A separate executor serves a join, and a join
  bypasses the cache.
- The feature of the cache is enabled.

Every other query reads the live storage. A join with a hint has no effect. A
hint inside a subquery of a `WHERE` clause also has no effect. CamusDB ignores
the hint. It does not honor the hint in part.

### Observe what happened

Every response to a query with a hint carries the metadata of the cache. A
client therefore never guesses from the time of the response:

| Field | Meaning |
|-------|---------|
| `cacheStatus` | `hit`, `miss`, `bypass`, `stale-revalidated`, or `evicted-before-publish` |
| `cacheBypassReason` | The reason for a bypass, or for a publish that failed. See below. It is null otherwise. |
| `cacheName` | The name of the family. It is present whenever the query was eligible for the cache. |
| `cachedAtHlc` | The [HLC](/docs/concepts#hlc) timestamp (the cluster-wide clock value) at which CamusDB computed a served entry. It is present on a hit only. |
| `ageMs` | The approximate age of a served entry, in wall-clock milliseconds. It is present on a hit only. |

CamusDB omits these fields completely for a query without a hint. An existing
client is therefore unaffected.

gRPC reports the same five values. They cannot live in an envelope of a
response, because CamusDB knows the verdict only after it drains the cursor.
They therefore travel as a trailing message `CacheMetadata`. That message
appends after the last row, on the unary stream of an `ExecuteQuery`. It also
travels on the `QueryComplete` terminator of a query inside a `BatchExecute`. An
absent message means that the statement carried no hint. An absent `cacheStatus`
means the same over REST.

The five values of the status mean this:

- `hit` means that CamusDB served the stored rows.
- `miss` means that CamusDB executed the query live, and stored a fresh entry.
- `bypass` means that CamusDB executed the query live, and stored nothing. The
  query was ineligible, or a write was in flight.
- `evicted-before-publish` means that CamusDB executed the query live, and
  returned correct rows. It could not store the fresh entry.
- `stale-revalidated` means that CamusDB found a strict entry, discovered that
  the entry was stale, and executed the query live again.

CamusDB emits four reasons of a bypass at present:

- `in-flight-write` means that a write was in its commit, into the key space of
  the scan.
- `cache-disabled` means that the feature is off, and that the query was
  eligible otherwise.
- `oversized-result` means that the result passed the cap of the rows or of the
  bytes of one entry. It also means that the cache is full.
- `dependency-limit` means that there were too many dependencies to record
  completely. It also means that a strict entry lost some of its dependencies of
  the rows to the cap.

The schema of the envelope holds other strings of a reason. The current code
produces none of them.

## How the cache stays correct

The cache never trades correctness for speed. These rules decide what you can
observe. The [internals page](/docs/query-result-cache-internals) explains each
mechanism.

- A committed write on this node evicts every entry that depends on the rows or
  the key spaces that it changed, before the write becomes visible. A
  transaction that rolls back evicts nothing. A DDL statement evicts every entry
  that depends on the changed table, and a changed schema version also changes
  the fingerprint.
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

An entry that is not strict can lag a write on another node until its TTL
expires. A `strict` entry removes that lag. CamusDB checks it against the live
storage at every hit, before it serves the rows: the schema versions, each row
that the query read, and each scanned bucket. A changed, deleted, or inserted
row makes the entry stale. CamusDB then evicts it, runs the query live, and
reports `stale-revalidated`.

Strict mode has three limits:

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
`query_result_cache_enabled` needs a restart. Do not rely on a live change of
`query_result_cache_default_ttl_ms`, `query_result_cache_max_entries`,
`query_result_cache_max_bytes`, or `query_result_cache_sweep_interval_ms`:
today the node keeps its startup values for these four keys until it restarts.

| Key | Default | Meaning |
|-----|---------|---------|
| `query_result_cache_enabled` | `true` | The main switch. While it is off, CamusDB reports a hint as a `bypass`, with the reason `cache-disabled`. It does no work of the cache, and no work of the gate. Turn the switch off to remove all the memory of the cache, and the small bookkeeping of the gate at each write, on a deployment that never uses a `{cache=…}`. |
| `query_result_cache_default_ttl_ms` | `5000` | The TTL of an entry whose hint holds no `ttl`. |
| `query_result_cache_max_entries` | `1024` | The cap on the count of the entries. Past that cap, CamusDB evicts the entry that a caller used least recently. |
| `query_result_cache_max_bytes` | `67108864` | The budget of the bytes, across every entry. It is 64 MiB. |
| `query_result_cache_max_entry_bytes` | `1048576` | The cap of the bytes of one entry, which is 1 MiB. CamusDB does not store a larger result. |
| `query_result_cache_max_entry_rows` | `10000` | The cap of the rows of one entry. CamusDB does not store a larger result. |
| `query_result_cache_max_deps` | `4096` | The cap of the total dependencies of one entry. Past that cap, CamusDB bypasses the publish. |
| `query_result_cache_max_point_deps` | `2048` | The cap of the point dependencies of one entry. Past that cap, CamusDB drops a point dependency. It also bypasses a strict entry. |
| `query_result_cache_max_ranges` | `256` | The cap of the range dependencies of one entry. |
| `query_result_cache_singleflight_wait_ms` | `250` | The wait of a concurrent miss of the same fingerprint, for the owner in flight, before it executes on its own. See [How the cache stays correct](#how-the-cache-stays-correct). |
| `query_result_cache_strict_validation_max_keys` | `10000` | The budget of the keys of a probe, for a strict validation. Past that budget, the validation fails closed. |
| `query_result_cache_sweep_interval_ms` | `10000` | The interval of the sweep of the TTL in the background. |

A breach of a cap fails safe. The query still returns correct live rows. The
cache then bypasses the store of the entry, or it evicts an entry to make room.
It never stores an entry that is incomplete or too large.

Here is the guidance for an operator. Add a `{cache=…}` hint to a query with
these three properties: it reads often, it repeats often with the same
parameters, and its data changes much less often than a client reads it.

In a cluster, remember that each node caches on its own. With the default
entries, which are not strict, a reader on one node can lag a write on another
node. The TTL bounds that lag.

Lower `query_result_cache_default_ttl_ms` to make that bound tighter. You can also use
`{cache=…, strict}` on the specific queries that must never lag. That option
costs one scan of a validation at each hit.

Size `query_result_cache_max_bytes` and `query_result_cache_max_entries` to the working set that you want resident.
CamusDB simply does not cache a result that is too large.

## Limits, and the goals outside the design

- The cache belongs to one node only. There is no sharing across nodes,
  no immediate invalidation across nodes, and no persistence across a restart.
  The freshness across two nodes is bounded by a TTL, or validated by the strict
  mode. It is never immediate.
- The cache covers a read of one table only. A join bypasses it. A hint on a
  join has no effect. A hint inside a subquery also has no effect.
- The cache covers a read in autocommit mode only. An explicit transaction
  always reads the live storage. That rule includes a `READ ONLY` transaction.
- The cache assumes a deterministic read, in spirit. It keys on the values. It
  does not key on the wall clock, and it does not key on the state of a session.
  Do not put a hint on a query whose result depends on an input that is not
  deterministic. Such a query would cache one evaluation.
- A path of a write never reads the cache. An `UPDATE ... WHERE` and a
  `DELETE ... WHERE` both evaluate against the live storage.

Four directions are natural for the future:

1. An immediate invalidation across the cluster.
2. A fence of a scan of an index. It would narrow the snapshot of the row
   bucket.
3. A cache for a join. It needs a fence of every table of that join.
4. A second tier, which is shared or persistent.

None of them changes the contract of the correctness above.
