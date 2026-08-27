---
sidebar_position: 3.3
---

# Distributed queries

In a cluster, CamusDB spreads the rows of a table across the partitions. Each
partition has a leader, and that leader already holds its data.

Distributed execution lets a scan run at the position of the rows. The node that
received the statement does not pull every page to itself.

```yaml
key_range_sharding: true
distributed_query_execution: true
```

The feature is off by default. While it is off, the plan and the execution are
exactly the plan and the execution of one node today.

While it is on, CamusDB divides an eligible scan into one fragment for each span
of the placement. A fragment whose data lives elsewhere runs on the node that
owns that data. The coordinator then joins the results together.

The results are identical in both cases. This is a feature of the performance.
Every part of it falls back to a local execution. No part of it fails.

## Why you use it

- A filter runs at the data. A peer that executes a fragment applies the
  residual predicate before it ships anything. A scan that keeps one row in a
  thousand therefore moves one row in a thousand across the network. It does not
  move the whole table.
- The spans run at the same time. A table of four spans scans on four leaders at
  once. The wall-clock cost of a full scan therefore follows the largest span.
  It does not follow the sum of every span.
- An aggregate collapses before it travels. CamusDB computes `COUNT`, `SUM`,
  `MIN`, `MAX`, and `AVG` for each span. It then merges them on the coordinator.
  A rollup over one hundred million rows therefore ships one row for each group
  of each span.
- The coordinator keeps less in memory. It merges the streams. It does not
  decode every row of the table itself.
- Correctness depends on none of this. A snapshot of a placement is advisory. A
  set of spans always covers the whole key space. A failed fragment continues
  locally. A stale view and a dead peer therefore cost a retry. Neither one
  gives a wrong answer.

## Turn it on

| Setting | Default | Scope | Meaning |
| --- | --- | --- | --- |
| `key_range_sharding` | `false` | cluster | Necessary. The distribution divides a table by the range of the key. The table must therefore use the routing by key range. |
| `distributed_query_execution` | `false` | cluster | It enables the fragments of the planner, and the transport of a fragment to a peer. |
| `max_query_parallelism` | `1` | node | The number of concurrent workers that decode rows, for each full scan. It applies with the distribution and without it. It also applies on a standalone node. |
| `broadcast_join_max_build_rows` | `10000` | node | The largest build side of a hash join that CamusDB may broadcast to a remote span of the probe. A `0` disables a broadcast join. |

`distributed_query_execution` is a setting of the class `restart`, and of the
scope `cluster`. Every node must agree on it. A statement that one node plans
assumes a model of the execution, and CamusDB will ask the peers of that node to
honor the model. Set the value in `config.yml`. Then restart the node.

The other two settings are of the class `runtime`, and of the scope `node`. You
can therefore change them while a node runs, and two nodes may differ:

```camussql
SET CLUSTER SETTING max_query_parallelism = 4;
SET CLUSTER SETTING broadcast_join_max_build_rows = 50000;
```

See [Runtime Cluster Settings](/docs/runtime-cluster-settings) for the
propagation of a live change. See [`SHOW VARIABLES`](/docs/show-variables) for
the value that one node runs.

A cluster deployment must fill `http_peers`, together with `peers`. A fragment
travels over HTTP. CamusDB resolves the Raft endpoint of a peer to its HTTP
address, through those two parallel lists.

Without those lists, CamusDB assumes that every node uses the same HTTP port as
this node. That assumption is true of the topology of Docker Compose. It is
often false of a topology that you build by hand. See
[Cluster Mode](/docs/cluster).

## What becomes eligible

The planner puts a scan inside a `gather` when every one of these conditions
holds:

- The statement is a full scan of the primary rows. It is not a point lookup on
  an index, a scan of a range of an index, or a scan of a forced index.
- The node is in cluster mode, with the sharding by key range on.
- The current placement of the table reports more than one span.
- The transaction is not optimistic. CamusDB must build the read set of such a
  transaction from one stream of the session.
- The statement is not the read half of an `UPDATE` or a `DELETE`. That half
  takes exclusive locks on a predicate.

Every other statement plans exactly as it plans with the feature off.

CamusDB decides the eligibility for each statement, against the live placement.
It therefore never serves a plan with fragments from the plan cache. A table
that divides into more spans starts to use them at the next query.

## How a fragment runs

A `gather` executes its scan one time for each span. Each execution stays inside
the range of the row ids of that span. The `gather` then joins the results in
the order of the spans.

The spans are contiguous, they ascend, and together they cover the whole key
space. The join therefore reproduces exactly the stream of rows of a scan
without a bound. An `ORDER BY`, a `LIMIT`, and every streaming operator above
the gather behave as they always did.

CamusDB sends a span to a peer under two conditions: the leader of that span is
another node, and a peer can evaluate the residual filter of the query.

A filter that CamusDB can ship is a pure function of the row. That rule excludes
three things:

| Not shippable | Why |
| --- | --- |
| A subquery, and an `EXISTS` | An evaluation would make a peer enter the executor of the coordinator again. |
| A placeholder of a parameter | The bound values live in the ticket of the coordinator. They do not live on the peer. |
| A volatile function, such as `NOW()` | CamusDB must evaluate such a function one time, in one place. Otherwise two nodes disagree. |

CamusDB also leaves a query with no filter at all on the local node. There is
nothing to push down, and the locator of the storage already streams the pages
of a remote span.

A query that is a candidate for the [result cache](/docs/query-result-cache)
also stays local. The coordinator records the dependencies of the cache for each
scanned row. A remote filter would drop the rows that the filter rejected. A
later update of one of those rows would then fail to invalidate the entry.

A span that CamusDB does not ship scans locally, through the ordinary routed
path of a read. It scans inside the same gather, at the same time as the remote
spans.

With a `LIMIT` present, the gather caps each span at `limit + offset` surviving
rows. The order of the spans matches the global order of the rows. The final cut
can therefore never need more than that number from one span. A remote fragment
stops the shipment when it reaches the cap.

### When a peer fails

A remote fragment can fail in the middle, for any reason at all. The coordinator
then continues that span locally. It starts after the last row that it received.
CamusDB loses no row, and it delivers no row twice.

CamusDB also invalidates the cached placement of the table. The next query
therefore resolves that placement again. It counts the event in
`distributed.fragment_fallbacks`.

A coordinator that cancels, and a coordinator that dies, takes its fragments
with it. A remote execution is bound to the life of the request that started it.
No fragment therefore outlives its caller.

## Aggregates

An aggregate directly above a gather can run as a partial result for each span,
with a merge on the coordinator. Each fragment aggregates its own span. It ships
one row for each group. The coordinator then aggregates those rows again, into
the final answer.

`COUNT` merges by a sum. `SUM`, `MIN`, and `MAX` each merge with themselves.
`AVG` travels as an internal pair of a sum and a count. CamusDB divides that
pair after the merge. An average over a column of integers therefore does not
become an integer division in silence.

Both halves run through the aggregator of the engine itself. That is what keeps
two semantics identical to a sequential execution: the semantics of a `NULL`,
and the semantics of an empty input.

The division applies to a simple aggregate with an alias, whose keys of the
group are plain names of columns in the projection.

CamusDB declines the division in five cases. The aggregate then runs over the
gathered rows:

- A `HAVING` clause. Its expansion of a hidden aggregate needs the original
  rows.
- An expression as a key of the group, instead of a plain column.
- A global aggregate with more than one projection, and a global `AVG`.
- An `EXPLAIN (ANALYZE)`. It reports the strategy of the gather of the rows that
  it measured.
- The collection of the dependencies of the result cache.

## A broadcast hash join

One side of a hash join can be small. A shipment of that side is then cheaper
than a shipment of the other side.

After the build phase finishes, CamusDB sends a build side below
`broadcast_join_max_build_rows` to the leaders of the spans of the probe table.
Each peer scans its span. It applies the filter of the probe side, and the `ON`
predicate, against the build rows that it received. It returns only the rows of
the probe that matched, together with the build rows that they matched. The
coordinator then assembles the output from its own copy of the build side.

CamusDB makes the decision at the time of the execution, after the hash table of
the build exists. The decision therefore uses the true count of the rows of the
build. It does not use an estimate. A join that the optimizer expected to be
small, and that is not small, simply probes locally.

CamusDB uses a broadcast under four conditions:

1. The distributed execution is on.
2. The probe side is a plain base table of primary rows. It has a placement of
   several spans, and at least one leader that is not local.
3. The `ON` predicate is shippable under the rules above.
4. The filter of the probe is shippable too.

Every condition that fails leads to the ordinary local probe. A remote failure
in the middle leads there as well. The output is identical in every case.

Set `broadcast_join_max_build_rows` to `0` to turn a broadcast join off. The
rest of the distributed execution stays on.

## See it in EXPLAIN

With the distribution enabled, every `EXPLAIN` gains a `distribution` row. That
row says whether CamusDB divided the plan into fragments. It gives the reason
when CamusDB did not:

```camussql
EXPLAIN SELECT * FROM orders WHERE status = "open";
```

```text
physical  distribution  distributed=yes
physical  gather        gather(spans: 4, remote_leader_fraction: 0.75)
physical  table-scan    table=orders
```

A plan that stayed local names the condition that it missed:

```text
physical  distribution  distributed=no (placement has a single span)
```

The reasons map directly to the list of the eligibility:

- `key-range sharding is off`
- `not a primary-row full scan`
- `standalone node`
- `placement has a single span`
- `transaction folds reads (optimistic read-set needs one session stream)`
- `exclusive predicate locks (DML write path)`

`EXPLAIN (ANALYZE)` adds one `gather-span` row for each span. Each row therefore
attributes its rows to the partition and to the node that produced them:

```text
analyze  gather-span  partition 1: mode=local, rows_delivered=25000
analyze  gather-span  partition 2: mode=remote, node=10.0.0.2:7070, rows_delivered=31, rows_shipped=31, remote_rows_scanned=24180
analyze  gather-span  partition 3: mode=remote-fallback, node=10.0.0.3:7070, rows_delivered=24903, rows_shipped=12
```

Read `mode` first.

A `local` span delivers every row that it scanned. Its filter runs above the
gather, on the coordinator.

A `remote` span delivers the survivors only. `remote_rows_scanned` gives the
number of rows that the peer read to find them. The difference between those two
numbers is the benefit of the shipment.

`remote-fallback` means two things. The peer failed after it shipped
`rows_shipped` rows. The coordinator then finished the span itself.

The `actual_rows` column of the row carries `rows_delivered`. The `rows_read`
column carries `remote_rows_scanned`. The numbers are therefore also available
without a parse of the text of the detail.

See [EXPLAIN](/docs/explain) for the rest of the format of the output.

## Counters

`SHOW ENGINE STATS` reports six counters. Each one accumulates over the life of
the process. They are under the source `camusdb`, and they appear only while the
distributed execution is enabled:

```camussql
SHOW ENGINE STATS LIKE 'distributed.%';
```

| Metric | Meaning |
| --- | --- |
| `distributed.fragments_dispatched` | The remote fragments that this node started as a coordinator. |
| `distributed.fragment_fallbacks` | The remote fragments that failed, and that this node finished locally. |
| `distributed.fragments_served` | The fragments that this node executed for a peer. |
| `distributed.partial_aggregate_gathers` | The aggregations that ran as partial results for each span, with a merge on the coordinator. |
| `distributed.rows_shipped_in` | The rows that this node received from a peer. That count holds the survivors, plus the groups of a partial aggregate. |
| `distributed.rows_shipped_out` | The rows that this node returned to a peer. |

Every node is both a coordinator and a server. The interesting readings are
therefore comparative. Collect all six counters from every node.

Two patterns then become visible as an asymmetry, between the column of the
dispatched fragments and the column of the served fragments: one node that
serves everybody, and a group of fallbacks that concentrate on one peer.

Each counter accumulates from the start of the process. Run the statement twice,
and subtract, to get a rate. With the feature disabled, the rows are absent
rather than zero. An empty result therefore means that the distribution is off.
It does not mean that the node is idle.

## The traffic between two nodes

A fragment travels over an internal HTTP route,
`POST /internal/query-fragment`. That route streams the surviving rows back as
NDJSON.

The secret of the node authenticates the route. A token of a client never
authenticates it. The route therefore needs `CAMUSDB_NODE_SECRET`, with the same
value across the fleet, while authentication is enabled. See
[Authentication And Authorization](/docs/sql-authentication).

The route is internal machinery. It is not an API for a client, and it carries
no promise of compatibility.

## A parallel scan without a cluster

`max_query_parallelism` is a separate setting. It needs no cluster, and it needs
no sharding by key range.

Above `1`, a full scan of the primary rows streams one time. It nevertheless
decodes the rows in chunks of a fixed size, on the thread pool. The consumer
takes the chunks in the order of their dispatch:

```camussql
SET CLUSTER SETTING max_query_parallelism = 4;
```

The order of the rows is identical to the order of a sequential scan, for every
shape of a plan. The producer reads in the order of the scan. The consumer waits
for the chunks in that same order.

The filter and every record stay on the single thread of the consumer.

The setting buys throughput of the decode, on a wide row. It costs one bounded
buffer for each worker, and more concurrent reads of the storage. The default of
`1` keeps the sequential pipeline.

## Limits

- Only a full scan of the primary rows divides into fragments. A scan of an
  index, a point lookup, and a scan of a forced index all plan locally.
- A write never divides into fragments. An `UPDATE` and a `DELETE` read under
  exclusive locks on a predicate. Those reads stay on the coordinator.
- An optimistic transaction never divides into fragments. CamusDB must build its
  read set from one stream of the session.
- A candidate of the result cache stays local. Its dependencies therefore stay
  complete.
- `EXPLAIN (ANALYZE)` disables the partial aggregation. The plan that it reports
  is therefore the plan that it measured. It is not the plan of a run without
  the measurement.
- A plan with fragments bypasses the plan cache. Its shape depends on the live
  placement.
- The distribution is an alpha feature, together with
  [cluster mode](/docs/cluster) itself. The APIs and the behavior can change
  between versions.

## Related pages

- [Cluster Mode](/docs/cluster) for the way that nodes find each other.
- [Query Planning](/docs/query-planning) for the selection of a plan in general.
- [EXPLAIN](/docs/explain) for the way that you read a plan.
- [Engine Stats](/docs/engine-stats) for the rest of the surface of the metrics.
- [Configuration](/docs/configuration) for every setting on this page.
