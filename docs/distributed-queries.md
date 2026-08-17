---
sidebar_position: 3.3
---

# Distributed Queries

In a cluster, the rows of a table are spread across partitions, and each
partition has a leader that already holds its data. Distributed query execution
lets a scan run where the rows are instead of pulling every page to the node
that received the statement.

```yaml
key_range_sharding: true
distributed_query_execution: true
```

The feature is off by default. With it off, planning and execution are exactly
what a single node does today. With it on, an eligible scan is split into one
fragment per placement span, fragments whose data lives elsewhere run on the
node that owns them, and the coordinator concatenates what comes back.

Results are identical either way. This is a performance feature, and every part
of it falls back to local execution rather than failing.

## Why Use It

- Filters run at the data. A peer executing a fragment applies the residual
  predicate before shipping anything, so a scan that keeps one row in a thousand
  moves one row in a thousand across the network instead of the whole table.
- Spans run concurrently. A four-span table scans on four leaders at once, so
  the wall-clock cost of a full scan tracks the largest span rather than the sum
  of all of them.
- Aggregates collapse before they travel. `COUNT`, `SUM`, `MIN`, `MAX`, and
  `AVG` are computed per span and merged on the coordinator, so a rollup over a
  hundred million rows ships one row per group per span.
- The coordinator keeps less in memory. It merges streams instead of decoding
  every row of the table itself.
- Nothing about correctness depends on it. Placement snapshots are advisory,
  spans always cover the whole key space, and a failed fragment resumes locally,
  so a stale view or a dead peer costs a retry rather than a wrong answer.

## Turning It On

| Setting | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `key_range_sharding` | `false` | cluster | Required. Distribution slices a table by key range, so the table has to be key-range routed. |
| `distributed_query_execution` | `false` | cluster | Enables planner fragmentation and the peer fragment transport. |
| `max_query_parallelism` | `1` | node | Concurrent decode workers per full scan. Applies with or without distribution, including standalone. |
| `broadcast_join_max_build_rows` | `10000` | node | Largest hash-join build side eligible to be broadcast to remote probe spans. `0` disables broadcast joins. |

`distributed_query_execution` is restart-class and cluster-scoped: every node
has to agree on it, because a statement planned on one node assumes an execution
model its peers will be asked to honor. Set it in `config.yml` and restart the
node.

The other two are runtime-class and node-scoped, so they can be changed live and
nodes are free to differ:

```camussql
SET CLUSTER SETTING max_query_parallelism = 4;
SET CLUSTER SETTING broadcast_join_max_build_rows = 50000;
```

See [Runtime Cluster Settings](/docs/runtime-cluster-settings) for how a live
change propagates, and [`SHOW VARIABLES`](/docs/show-variables) for the value a
given node is running.

Cluster deployments should populate `http_peers` alongside `peers`. Fragments
travel over HTTP, and CamusDB resolves a peer's Raft endpoint to its HTTP
address through those two parallel lists. Without them it assumes every node
uses the same HTTP port as this one, which is true of the Docker Compose
topology and often not true of a hand-rolled one. See
[Cluster Mode](/docs/cluster).

## What Becomes Eligible

The planner wraps a scan in a `gather` when all of the following hold:

- the statement is a full primary-row table scan, not an index lookup, an index
  range scan, or a forced-index scan
- the node is in cluster mode with key-range sharding on
- the table's current placement reports more than one span
- the transaction is not an optimistic one, whose read set has to be built from
  a single session stream
- the statement is not the read half of an `UPDATE` or `DELETE`, which takes
  exclusive predicate locks

Anything else plans exactly as it would with the feature off. Eligibility is
decided per statement against live placement, so a fragmented plan is never
served from the plan cache; a table that splits into more spans starts using
them on the next query.

## How A Fragment Runs

A `gather` executes its scan once per span, with each execution bounded to that
span's row-id range, and concatenates the results in span order. Spans are
contiguous and ascending and together cover the whole key space, so
concatenation reproduces exactly the row stream an unbounded scan produces.
`ORDER BY`, `LIMIT`, and every streaming operator above the gather behave the
same as they always did.

A span is sent to a peer when its leader is another node and the query's
residual filter can be evaluated remotely. A shippable filter is a pure function
of the row, which rules out three things:

| Not shippable | Why |
| --- | --- |
| Subqueries and `EXISTS` | Evaluating one would mean re-entering the coordinator's executor from a peer. |
| Parameter placeholders | Bound values live in the coordinator's ticket, not on the peer. |
| Volatile functions such as `NOW()` | They have to be evaluated once, in one place, or two nodes disagree. |

A query with no filter at all is also left local. There is nothing to push down,
and the storage locator already streams a remote span's pages. Queries that are
[result cache](/docs/query-result-cache) candidates stay local too: cache
dependencies are recorded per scanned row on the coordinator, and remote
filtering would drop the rows the filter rejected, so a later update to one of
them would fail to invalidate the entry.

Spans that are not shipped are scanned locally through the ordinary routed read
path, in the same gather, at the same time as the remote ones.

When a `LIMIT` is present, the gather caps each span at `limit + offset`
surviving rows. Span order matches global row order, so the final cut can never
need more than that from any one span, and a remote fragment stops shipping when
it reaches the cap.

### When A Peer Fails

If a remote fragment fails part-way, for any reason at all, the coordinator
resumes that span locally starting after the last row it received. No row is
lost and none is delivered twice. The cached placement for the table is
invalidated so the next query re-resolves it, and the fallback is counted in
`distributed.fragment_fallbacks`.

A coordinator that cancels or dies takes its fragments with it: remote execution
is bound to the lifetime of the request that started it, so no fragment outlives
its caller.

## Aggregates

An aggregate sitting directly above a gather can run as per-span partials with a
merge on the coordinator. Each fragment aggregates its own span, ships one row
per group, and the coordinator re-aggregates those rows into the final answer.
`COUNT` merges by summing, `SUM`, `MIN`, and `MAX` merge by themselves, and
`AVG` is carried as an internal sum and count pair that is divided after the
merge, so an average over an integer column is not silently integer-divided.

Both halves run through the engine's own aggregator, which is what keeps
`NULL` and empty-input semantics identical to sequential execution.

The split applies to simple aliased aggregates whose group keys are plain
column names present in the projection. It is declined, and the aggregate runs
over gathered rows instead, for:

- `HAVING`, whose hidden-aggregate expansion needs the original rows
- expressions rather than plain columns as group keys
- global aggregates with more than one projection, or a global `AVG`
- `EXPLAIN (ANALYZE)`, which reports the row-gather strategy it instrumented
- result-cache dependency collection

## Broadcast Hash Join

When one side of a hash join is small, shipping it is cheaper than shipping the
other side. After the build phase finishes, a build side under
`broadcast_join_max_build_rows` is sent to the leaders of the probe table's
spans. Each peer scans its span, applies the probe-side filter and the `ON`
predicate against the build rows it was given, and returns only the probe rows
that matched, together with the build rows they matched. The coordinator
assembles the output from its own copy of the build side.

The decision is made at execution time, after the build hash table exists, so it
gates on the build's actual row count rather than an estimate. A join that the
optimizer expected to be small but was not simply probes locally.

Broadcast is used when distributed execution is on, the probe side is a plain
primary-row base table with a multi-span placement and at least one non-local
leader, and both the `ON` predicate and the probe filter are shippable under the
rules above. Every condition that fails falls back to the ordinary local probe,
and so does a remote failure mid-flight. Output is identical in all cases.

Set `broadcast_join_max_build_rows` to `0` to turn broadcast joins off while
leaving the rest of distributed execution on.

## Seeing It In EXPLAIN

With distribution enabled, every `EXPLAIN` gains a `distribution` row that says
whether the plan was fragmented, and if not, why:

```camussql
EXPLAIN SELECT * FROM orders WHERE status = "open";
```

```text
physical  distribution  distributed=yes
physical  gather        gather(spans: 4, remote_leader_fraction: 0.75)
physical  table-scan    table=orders
```

A plan that stayed local names the condition it missed:

```text
physical  distribution  distributed=no (placement has a single span)
```

The reasons map directly to the eligibility list: `key-range sharding is off`,
`not a primary-row full scan`, `standalone node`, `placement has a single span`,
`transaction folds reads (optimistic read-set needs one session stream)`, and
`exclusive predicate locks (DML write path)`.

`EXPLAIN (ANALYZE)` adds one `gather-span` row per span, so rows are attributed
to the partition and the node that produced them:

```text
analyze  gather-span  partition 1: mode=local, rows_delivered=25000
analyze  gather-span  partition 2: mode=remote, node=10.0.0.2:7070, rows_delivered=31, rows_shipped=31, remote_rows_scanned=24180
analyze  gather-span  partition 3: mode=remote-fallback, node=10.0.0.3:7070, rows_delivered=24903, rows_shipped=12
```

Read `mode` first. A `local` span delivers every row it scanned, because its
filter runs above the gather on the coordinator. A `remote` span delivers only
survivors, and `remote_rows_scanned` says how many rows it read to find them.
The gap between those two numbers is the shipping win. `remote-fallback` means
the peer failed after shipping `rows_shipped` rows and the coordinator finished
the span itself.

The row's `actual_rows` column carries `rows_delivered` and `rows_read` carries
`remote_rows_scanned`, so the numbers are also available without parsing the
detail text.

See [EXPLAIN](/docs/explain) for the rest of the output format.

## Counters

`SHOW ENGINE STATS` reports six process-lifetime counters under the `camusdb`
source, and only while distributed execution is enabled:

```camussql
SHOW ENGINE STATS LIKE 'distributed.%';
```

| Metric | Meaning |
| --- | --- |
| `distributed.fragments_dispatched` | Remote fragments this node started as a coordinator. |
| `distributed.fragment_fallbacks` | Remote fragments that failed and were finished locally. |
| `distributed.fragments_served` | Fragments this node executed on behalf of a peer. |
| `distributed.partial_aggregate_gathers` | Aggregations that ran as per-span partials with a coordinator merge. |
| `distributed.rows_shipped_in` | Rows received from peers, survivors plus partial-aggregate groups. |
| `distributed.rows_shipped_out` | Rows this node returned to peers. |

Every node is both a coordinator and a server, so the interesting readings are
comparative. Collect all six from every node: one node serving everybody, or
fallbacks concentrating on one peer, is visible as asymmetry between the
dispatched and served columns across the fleet.

Counters are cumulative since process start. Run the statement twice and
subtract to get a rate. With the feature disabled the rows are absent rather
than zero, so an empty result means distribution is off, not idle.

## Node-To-Node Traffic

Fragments travel over an internal HTTP route, `POST /internal/query-fragment`,
which streams surviving rows back as NDJSON. It is authenticated by the node
secret and never by a client token, so it needs `CAMUSDB_NODE_SECRET` set
consistently across the fleet when authentication is enabled. See
[Authentication And Authorization](/docs/sql-authentication).

The route is internal machinery. It is not a client API and carries no
compatibility promise.

## Parallel Scans Without A Cluster

`max_query_parallelism` is a separate knob that needs neither a cluster nor
key-range sharding. Above `1`, a full primary-row scan streams once but decodes
rows in fixed-size chunks on the thread pool, with chunks consumed in dispatch
order:

```camussql
SET CLUSTER SETTING max_query_parallelism = 4;
```

Row order is identical to the sequential scan for every plan shape, because the
producer reads in scan order and the consumer awaits chunks in that same order.
Filtering and all bookkeeping stay on the single consumer thread. What the
setting buys is decode throughput on wide rows; what it costs is one bounded
buffer per worker and more concurrent storage reads. The default of `1` keeps
the sequential pipeline.

## Limits

- Only full primary-row scans fragment. Index scans, point lookups, and forced
  index scans plan locally.
- Writes never fragment. `UPDATE` and `DELETE` read under exclusive predicate
  locks, and those stay on the coordinator.
- Optimistic transactions never fragment, since the read set has to be built
  from one session stream.
- Result-cache candidates stay local so their dependencies stay complete.
- `EXPLAIN (ANALYZE)` disables partial aggregation, so the plan it reports is
  the one it instrumented rather than the one an uninstrumented run would use.
- Fragmented plans bypass the plan cache, because their shape depends on live
  placement.
- Distribution is alpha alongside [cluster mode](/docs/cluster) itself.

## Related Pages

[Cluster Mode](/docs/cluster) for how nodes find each other,
[Query Planning](/docs/query-planning) for plan selection generally,
[EXPLAIN](/docs/explain) for reading a plan,
[Engine Stats](/docs/engine-stats) for the rest of the metric surface, and
[Configuration](/docs/configuration) for every setting named here.
