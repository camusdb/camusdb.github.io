---
sidebar_position: 3.15
---

# Query Result Cache

CamusDB includes an opt-in query result cache for repeated read-heavy
`SELECT` statements. The cache is per node, in memory, and stores fully
materialized result sets for queries that explicitly request caching.

Nothing is cached automatically. Add a `{cache=...}` hint to the query you want
to cache:

```camussql
SELECT id, total
FROM orders {cache=recent_orders}
WHERE status = "paid"
ORDER BY total DESC
LIMIT 20;
```

The first execution reads live storage and stores the completed result if it
fits the configured limits. A later identical query can be served from memory
when the query shape, bound values, schema versions, cache family, and cache
options all match.

## When To Use It

Use the result cache for small or moderate result sets that are:

- read frequently
- expensive enough to justify caching
- changed less often than they are read
- safe to cache for a short time on each server node

Good examples include dashboard widgets, frequently repeated lookup screens,
small filtered lists, and parameterized API reads whose results are reused
often.

Avoid caching queries whose result depends on wall-clock time, random values,
or session state. `UPDATE` and `DELETE` never read from the result cache; they
always evaluate against live storage.

## Cache Hints

The cache hint is attached to a table reference. If the table has an alias, put
the hint after the alias:

```camussql
SELECT id, total
FROM orders o {cache=recent_orders}
WHERE o.status = "paid";
```

The cache family name groups related entries. It is case-insensitive and is
also used by manual eviction commands.

You can override the entry TTL:

```camussql
SELECT *
FROM orders {cache=hot_orders, ttl=30s}
WHERE status = "paid";
```

Supported `ttl` units are:

| Unit | Meaning |
| --- | --- |
| `ms` | milliseconds |
| `s` | seconds |
| `m` | minutes |
| `h` | hours |

A bare integer is interpreted as milliseconds. The value must be a positive
integer.

Use `strict` when a cache hit must be validated against live storage before it
is returned:

```camussql
SELECT *
FROM orders {cache=hot_orders, ttl=5m, strict}
WHERE status = "paid";
```

Strict validation removes the usual cross-node TTL staleness window, but it can
be as expensive as validating the query dependencies against storage. Use it
for specific reads that need the stronger freshness behavior, not as a default
for every cached query.

The `@{cache=...}` form is also accepted:

```camussql
SELECT *
FROM orders @{cache=hot_orders, ttl=30s};
```

Only one cache hint is allowed per `SELECT`.

## Eligibility

A query uses the result-cache path only when all of these are true:

- the statement is a `SELECT`
- the query has a `{cache=...}` or `@{cache=...}` hint
- the query is an autocommit read
- the query reads a single table
- the result cache is enabled

Explicit transactions always read live storage. Joins bypass the result cache
even if a cache hint is present. A cache hint inside a subquery is ignored.

## Freshness

The cache is correct before it is fast.

On the same node, committed writes and schema changes invalidate overlapping
cache entries before later reads can use them. This means a write committed on
the same CamusDB process does not leave a stale result behind for that process.

Across nodes, the cache is not shared and invalidation is not broadcast eagerly.
A write on another node can remain invisible to this node's non-strict cache
entry until that entry's TTL expires. To tighten that behavior:

- lower `query_result_cache_default_ttl_ms`
- use a shorter per-query `ttl=...`
- add `strict` to queries that must validate every hit

The cache does not survive process restart.

## Manual Eviction

Evict one cache family in the current database:

```camussql
EVICT CACHE 'recent_orders';
```

Evict every result-cache entry for the current database:

```camussql
EVICT CACHE ALL;
```

Manual eviction is scoped to the current database. It does not evict entries
for other databases.

## Observability

Responses for hinted queries include cache metadata:

| Field | Meaning |
| --- | --- |
| `cacheStatus` | `hit`, `miss`, `bypass`, `stale-revalidated`, or `evicted-before-publish`. |
| `cacheBypassReason` | Why the query bypassed caching or could not publish an entry. |
| `cacheName` | Cache family name. |
| `cachedAtHlc` | HLC timestamp when a served entry was computed. |
| `ageMs` | Approximate age of a served entry in milliseconds. |

Common bypass reasons:

| Reason | Meaning |
| --- | --- |
| `in-flight-write` | A write was committing into the scanned keyspace. The query read live storage and did not publish. |
| `cache-disabled` | The cache feature is disabled. |
| `oversized-result` | The result exceeded row, byte, or total cache limits. |
| `dependency-limit` | The query touched too many dependencies to cache safely. |

Use `EXPLAIN` to see static cache eligibility:

```camussql
EXPLAIN
SELECT id, total
FROM orders {cache=recent_orders}
WHERE status = "paid";
```

When a cache hint is present, `EXPLAIN` appends a `cache` informational row. It
does not probe the cache or report whether an entry currently exists; the
runtime response metadata is authoritative for hits and misses.

## Configuration

The result cache is enabled by default, but remains inert until a query opts in
with a cache hint.

```yaml
query_result_cache_enabled: true
query_result_cache_default_ttl_ms: 5000
query_result_cache_max_entries: 1024
query_result_cache_max_bytes: 67108864
query_result_cache_max_entry_bytes: 1048576
query_result_cache_max_entry_rows: 10000
query_result_cache_strict_validation_max_keys: 10000
query_result_cache_sweep_interval_ms: 10000
```

See [Configuration](/docs/configuration#query-result-cache) for the full knob
reference, including advanced dependency limits.

## Current Limits

- The cache is per node and in memory.
- Cache entries are not replicated and are not persisted across restarts.
- Only single-table autocommit `SELECT` statements are cache eligible.
- Joins and explicit transactions read live storage.
- Non-strict cross-node freshness is bounded by TTL, not eager invalidation.
- Strict validation can add storage reads on every hit.

## Related Pages

- [Query Planning](/docs/query-planning)
- [Explaining Queries And Commands](/docs/explain)
- [Configuration](/docs/configuration)
