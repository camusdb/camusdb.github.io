---
sidebar_position: 3.15
---

# Query result cache

This page has three audiences:

- An operator who enables and tunes the cache.
- A developer who wants to know what `{cache=…}` does, and when it is safe.
- An engineer who maintains or extends the layer of the cache.

It covers seven subjects. How a `SELECT` opts into the cache. How CamusDB serves
and publishes a result. How a write and a DDL statement invalidate an entry on
the same node. How a TTL and a strict validation bound the staleness across two
nodes. The settings. The current limits.

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

The cache is enabled by default. It does nothing until a query opts in with a
hint. Set `query_result_cache_enabled: false` to turn it off completely.

## 1. The mental model

Four ideas are the whole story. The rest of this page is detail.

- Each query opts in. CamusDB caches nothing until a `SELECT` carries a
`{cache=name}` hint. The `name` is a family. The key of the entry holds five
  more parts: the id of the database, the shape of the query, each bound value
  with its type, the schema versions, and the options of the cache. Two queries
  share one entry only when every part matches.
- The cache belongs to one node, and it lives in memory. It is an L1 cache. Each
  process owns one cache. CamusDB does not share it across a cluster, and it
  does not replicate it. The cache does not survive a restart. A hit on node A
  tells you nothing about node B.
- A read captures a set of dependencies. A write invalidates against that set.
  While a cached query executes, CamusDB records two things: the key spaces that
  the query scanned, for the membership, and the rows that it read, for the
  content. A transaction commits on this node. CamusDB then maps its modified
  keys back onto those dependencies, and it drops every entry that overlaps. A
  dependency that CamusDB misses would be a defect of the correctness. A
  dependency that is a little too wide only costs a false eviction, and that
  cost is acceptable.
- A write on the same node is exact. A write on another node is bounded by the
  TTL, or by the strict mode. The order of a publish against a commit,
  in [section 6](#6-the-publish-gate), guarantees one property: after a write
  commits on this node, CamusDB can serve no stale entry for the key space that
  the write touched. A write on another node is invisible to the cache of this
  node until the TTL of the entry expires. An entry with the `strict` option is
  the exception. CamusDB validates each hit of such an entry against the live
  storage first. See [section 7](#7-the-ttl-and-the-strict-validation).

### 1.1 The vocabulary

The name of a family is the `name` of a `{cache=name}`. It is a logical
namespace for a set of entries with parameters. `EVICT CACHE 'name'` targets one
family. CamusDB lowercases a name at the parse. A family is therefore not
case-sensitive.

The fingerprint of a result is the key of an entry. It is a hash of 128 bits,
over a canonical encoding of six parts:

1. The id of the database.
2. The name of the family.
3. The shape of the query.
4. The typed bound values.
5. The schema versions.
6. The options of the cache.

Two queries that differ logically never share a fingerprint. See
[section 8](#8-the-fingerprint).

The set of the dependencies is what an entry depends on. It has three kinds:

- A range dependency is a bucket of the key space that the query scanned, for
  the membership. It is the row bucket of a table, or a bucket of an index. A
  range dependency catches an insert, and a phantom row.
- A point dependency is the full KV key of one row whose bytes the query read.
  It catches an update of the content, and a delete. A later scan of a range
  could miss both.
- A schema dependency is a pair of a `tableId` and a `schemaVersion`. The plan
  and the decoder of the rows used that pair.

A bucket of the key space is the coarse unit of an invalidation. A row bucket is
`{dbId}:{tableId}:r`. A bucket of an index is `{dbId}:{tableId}:i:{indexId}`.
CamusDB maps a modified KV key back to its bucket, to find the affected entries.
A bucket is coarse by design. The index of the invalidation therefore stays
small.

The publish gate is the small primitive of the concurrency that makes a commit
and a publish safe together. It holds a generation counter for each key space,
which only increases. It also holds a set of the marks of the writes in flight.
See [section 6](#6-the-publish-gate).

`T_cache` is the HLC snapshot timestamp of the computation of a strict entry.
The strict validation compares the `LastModified` of each dependency against it.

## 2. Use the cache

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
live storage. See [section 7](#7-the-ttl-and-the-strict-validation). Use the
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
| `cachedAtHlc` | The HLC of the computation of a served entry. It is present on a hit only. |
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

## 3. The path of a read

For an eligible query, `QueryExecutor` runs this sequence. See
`QueryWithCache`:

1. It builds the fingerprint. The key of the entry comes from the id of the
   shape of the plan, the bound parameters, the dependencies of the schema, and
   the options of the cache.
2. It probes the cache. It looks the fingerprint up. A live entry, which is an
   entry that did not expire, is a candidate for a hit.
   For a hit without the strict mode, CamusDB checks that the schema
   dependencies of the entry are still current. It then yields the stored rows.
   For a strict hit, CamusDB validates the entry against the live storage. See
   [section 7](#7-the-ttl-and-the-strict-validation). It yields the stored rows
   when the entry is valid. Otherwise it evicts the entry, records the
   revalidation, and continues to a live execution. The final status then
   becomes `stale-revalidated`.
3. It guards a strict entry without a snapshot. A strict entry has a meaning
   only when `T_cache` is a real HLC snapshot. The read in autocommit mode can
   have no pinned snapshot. CamusDB then serves live rows, and it publishes
   nothing.
4. It takes a snapshot of the generation. It records the current counter of the
   generation of the row bucket of the table, before the execution. A write can
   already be in flight for that bucket. CamusDB then serves live rows without a
   publish, with the reason `in-flight-write`. It therefore does not race a
   write that is about to commit.
5. It executes the query, and it collects the dependencies. It runs the real
   plan through the collector of the dependencies. See
   [section 4](#4-the-capture-of-a-dependency). It materializes the rows as they
   stream to the client.
6. It publishes the entry. After the stream drains completely, CamusDB tries to
   store the entry. It stores the entry through the publish gate only. That gate
   checks the generation again. It rejects the store when a write committed into
   the bucket during the execution. See
   [section 6](#6-the-publish-gate). The caps of the rows, of the bytes, and of
   the dependencies also gate the store at that point.

An enumeration that a caller cancels, and one that faults, never publishes. The
runner marks the drain complete after the last row only. CamusDB skips the
publish otherwise. That rule is the invariant of no partial publish.

Between step 3 and step 4, several requests for the same fingerprint collapse
onto one execution. This is the single-flight behavior. The first caller becomes
the owner, and it runs the sequence above. The other callers wait.

The slot of that wait carries a signal of the completion only. It never carries
a row. The owner reports its publish. Each waiter then runs step 2 for itself.
It serves the entry only when its own probe still finds that entry, and
validates it. It executes live otherwise.

That indirection has a purpose. A write can commit, and it can evict the entry,
between the publish of the owner and the moment when a waiter wakes. A waiter is
a query that began after that invalidation. A hand of the materialized rows of
the owner to that waiter would serve a state older than a committed write. It
would also skip the checks of the schema and of the strict mode that every other
reader performs.

A waiter that reaches its timeout executes on its own. A waiter whose owner
failed also executes on its own.

Why does CamusDB take a snapshot of the row bucket of the table only, even for a
scan of an index? Every `INSERT`, `UPDATE`, and `DELETE` on a table writes the
key of the row. The generation of the row bucket therefore increases on any
write to that table. The fence of the row bucket covers a scan of an index as
well.

That is exactly the reason why a join must not take this path. A join touches
the buckets of more than one table. The fence of one bucket would not cover the
others.

## 4. The capture of a dependency

The operators of a scan and of a join feed a collector of each request, which is
the `QueryDependencyCollector`, as they read. CamusDB attaches the collector on
the path of the cache only. Every call that records a dependency has a guard. A
query without a cache therefore pays nothing.

The rules follow the shape of the scan:

- A full scan of a table records three things: the row bucket as a range
  dependency, the schema version of the table as a schema dependency, and the
  key of each fetched row as a point dependency.
- A scan of an index, a lookup, a range, and an `IN` list each record three
  things: the bucket of the index as a range dependency, the schema version, and
  the key of each fetched row as a point dependency. Both parts matter. The
  range of the index catches a phantom insert, and a change of the membership.
  The point of the row catches an update of a projected column that the index
  does not hold.
- CamusDB also records a row that a residual filter rejects later. A row that
  does not match today could match after an update. It is therefore a real
  dependency.

Two caps apply, and they can truncate the set. CamusDB caps the point
dependencies of each entry. It drops a point dependency past that cap, and the
range dependency then gives the coverage. That behavior is safe for an entry
without the strict mode, because an invalidation on the same node matches on the
range.

There is also a cap on the total number of the dependencies. CamusDB marks the
collector when the set passes that cap. It then does not publish the entry at
all. It bypasses the store, instead of a store of an incomplete set. A coverage
that misses something is never acceptable. A coverage that is too wide is.

## 5. The invalidation on the same node

The boundary of a transaction drives the invalidation. The invalidation is not
spread across the methods of the writes. A write of a batch and a write of one
point therefore have the same coverage.

For a write of a row and of an index, `KvTransactionsManager.CommitAsync`
collects the modified keys of the transaction. It derives the buckets of the key
space of those keys.

After a successful commit through Kahuna, it asks the cache to drop entries. It
drops every entry whose set of dependencies overlaps a modified key, and every
entry whose set overlaps a modified bucket.

A modified key of a row matches two things: a range dependency of a row bucket,
through its bucket, and a point dependency of a row, exactly.

All of that happens through the publish gate. It is therefore atomic against a
concurrent publish. See [section 6](#6-the-publish-gate). A transaction that
rolls back invalidates nothing.

A change of the schema and of the catalog needs a separate mechanism. A DDL
statement does not touch the keys of a row or of an index in the same way.

After a successful commit of a DDL statement, the executor evicts every entry
with a schema dependency on the affected table, through `InvalidateByTableId`. A
drop of a table evicts by the id of the table. A drop of a whole database evicts
by the database.

The fingerprint already holds the schema versions. A query after a change of the
schema therefore computes a different fingerprint. It cannot collide with an
entry from before the change, in any case.

The index of the dependencies, `DependencyIndex`, maps three things to the ids
of the entries that depend on them: a bucket, a point key, and a schema key of a
database and a table. The cost of an invalidation therefore follows the key
spaces that a write touched, and the entries that overlap. It does not follow the
total number of the cached entries.

## 6. The publish gate

The dangerous race is this. A query misses, executes, and publishes an entry, at
the same moment when a write commits into the same key space. The stale entry
would survive, if the publish landed after the invalidation of the write.

`CachePublishGate` closes that window. It holds two structures for each key
space:

- A counter of the generation. Every committed write increases it. It never
  decreases.
- A count of the marks of the writes in flight. CamusDB raises the count before
  a commit. It clears the count after that commit.

The protocol has two halves.

On the path of a write, inside `CommitAsync`, CamusDB marks the modified key
spaces as in flight, before the commit through Kahuna. It then resolves that
mark by the result of the finalize. The question is not "did this write commit?"
The question is "could this write be visible?"

| Result of the finalize | What it means | Action of the gate |
| --- | --- | --- |
| `Committed` | A final success | It increases the generations, invalidates inside the lock of the gate, and clears the marks. |
| A `MustRetry` past the bound of the retries, an `Errored`, or a cancellation or an exception after a request of a commit left the node | The outcome is unknown. The coordinator can apply a commit and still lose the response. The rows may therefore be readable here already. | The same as a `Committed`. It increases, invalidates, and clears. |
| An `Aborted`, a confirmed rollback, or any failure before the first request of a commit | A definite absence of a commit | It clears the marks only. |

A fence around a write that never landed costs one execution again. A skipped
fence around a write that did land serves rows older than a committed write.
That result is the one thing that [section 1](#1-the-mental-model) promises
cannot happen on this node.

CamusDB therefore resolves the unknown case conservatively. The caller can later
retry the same handle, and resolve it. The second fence then has no further
effect. A generation only moves forward, and the entries are gone already.

On the path of a read, CamusDB takes a snapshot of the generations of the key
spaces before the execution. It bypasses the cache when a key space is in flight
already.

After the execution, CamusDB publishes through `TryPublishUnderGeneration` only.
That method holds the same lock as the path of the commit. It checks the
generation again. It inserts the entry only when the generation did not move.

A publish therefore lands entirely before the invalidation of a write, and the
invalidation then removes it. Or CamusDB rejects the publish, because the
generation advanced. There is no interleaving between those two results.

CamusDB holds the lock across the bookkeeping in memory only. It never holds the
lock across a commit through Kahuna. The lock therefore stays cheap.

A false rejection is acceptable. Such a rejection makes a query execute again,
because an unrelated row of the same bucket changed. A stale entry that survives
a committed write is not acceptable.

## 7. The TTL and the strict validation

The guarantees above say nothing about a write on a different node. The commit
of that node never touches the index in the memory of this node. Two mechanisms
bound the staleness that results.

The first mechanism is the TTL. Every entry has an expiry, from the `ttl` of its
hint, or from the configured default. CamusDB checks the expiry at a probe. An
expired entry misses, and CamusDB removes it. A sweep in the background also
drops an expired entry periodically. It therefore does not stay in the memory.

The second mechanism is the strict validation. CamusDB validates a `strict`
entry against the live storage at every hit, before it serves the rows. The
`StrictValidator` performs three steps, in this order:

1. It checks the schema dependencies. The entry is stale when a table that it
   depends on is gone, or when that table now holds a different schema version.
2. It checks the point dependencies. It probes each key of a row, for the latest
   committed value. Two results mean that the entry is stale: an absent key,
   which is a delete, and a `LastModified` newer than `T_cache`, which is an
   update.
3. It checks the range dependencies. It scans each bucket. A key with a
   `LastModified` newer than `T_cache` means a phantom insert, or a change that
   CamusDB did not track.

Every read of the validation is outside a transaction. Each one reads the latest
committed value.

A limit on the keys of the probe bounds the validation. The validation fails
closed. CamusDB treats the entry as stale when the validation would pass the
limit. It executes the query again. It does not trust the entry.

A failed validation evicts the entry. The next probe therefore does not validate
an entry that CamusDB knows to be stale.

Two details of the correctness are worth your attention:

- A physical delete needs a point dependency. The key of a deleted row is gone,
  and a scan of a range cannot see it. Only the point dependency of the row
  catches the delete. That is the reason for one rule: CamusDB does not store a
  strict entry whose point dependencies the cap truncated. Without complete
  point dependencies, that entry could not detect a delete. It therefore
  bypasses the publish.
- The strict mode needs a snapshot. `T_cache` would have no meaning when the
  read in autocommit mode has no pinned HLC snapshot. Every comparison of a
  `LastModified` would then fail. CamusDB does not publish such a strict entry.
  It serves live rows instead.

A strict validation can cost as much as a scan of a range. It is an opt-in mode
of the correctness, for a read across several nodes. It is not a general path of
the performance.

## 8. The fingerprint

The fingerprint must never let two logically different queries share one entry.

It is a hash of 128 bits, and that hash is not cryptographic. CamusDB uses
XxHash128, over a canonical string that is injective. The fingerprint is not a
boundary of the security. It only avoids an accidental collision. A fast hash
over an unambiguous encoding is therefore the correct tool.

Six parts go into the canonical form:

1. The id of the database.
2. The name of the family.
3. The id of the shape of the query.
4. Every bound parameter, in the order of its name.
5. The schema dependencies, in the order of the name of the table, with their
   versions.
6. The options of the cache.

The encoding takes care in two ways that matter:

- Each value carries its type. The integer `1`, the string `"1"`, a `NULL`, and
  an object id therefore never encode in the same way.
- Every value of a variable length carries a prefix of its length. A value that
  holds a delimiter of the structure therefore cannot look like a different set
  of values. The format of a float is invariant of the culture. The locale of a
  node therefore cannot change a fingerprint.

The id of the shape of the query is a separate hash, of 64 bits. It covers the
structure of the query, with a placeholder in the position of each literal. The
plan cache shares that id. It identifies a query that is the same except for its
constants.

The fingerprint of a result always folds the literal values back in. The plan
cache ignores them by design. The result cache must not ignore them.

## 9. Configuration

The cache is on by default. It does nothing until a query opts in with a
`{cache=…}` hint.

Every setting is available in YAML only, because it tunes the operation. The
settings live in the same `config.yml` as the rest of the server.

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
| `query_result_cache_singleflight_wait_ms` | `250` | The wait of a concurrent miss of the same fingerprint, for the owner in flight, before it executes on its own. See the single-flight behavior in [section 3](#3-the-path-of-a-read). |
| `query_result_cache_strict_validation_max_keys` | `10000` | The budget of the keys of a probe, for a strict validation. Past that budget, the validation fails closed. |
| `query_result_cache_sweep_interval_ms` | `10000` | The interval of the sweep of the TTL in the background. |

A breach of a cap fails safe. The query still returns correct live rows. The
cache then bypasses the store of the entry, or it evicts an entry to make room.
It never stores an entry that is incomplete or too large.

Here is the guidance for an operator. The cache is on by default, and it is
inert until a query opts in. Add a `{cache=…}` hint to a query with these three
properties: it reads often, it repeats often with the same parameters, and its
data changes much less often than a client reads it. CamusDB caches nothing
without a hint.

In a cluster, remember that each node caches on its own. With the default
entries, which are not strict, a reader on one node can lag a write on another
node. The TTL bounds that lag.

Lower `default_ttl_ms` to make that bound tighter. You can also use
`{cache=…, strict}` on the specific queries that must never lag. That option
costs one scan of a validation at each hit.

Size `max_bytes` and `max_entries` to the working set that you want resident.
CamusDB simply does not cache a result that is too large.

Set `query_result_cache_enabled: false` when a deployment never uses a hint, and
when you want to remove the small bookkeeping of the gate at each write.

## 10. The limits, and the goals outside the design

- The cache is an L1 cache of one node only. There is no sharing across nodes,
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
