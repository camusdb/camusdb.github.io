---
sidebar_position: 3.66
---

# Engine Stats

`SHOW ENGINE STATS` returns a live snapshot of node-local operational metrics
from the engines embedded in the CamusDB process.

CamusDB uses [Kahuna](https://kahunakv.github.io/) for distributed KV and
transaction coordination, and
[Kommander](https://kahunakv.github.io/kommander.github.io/) for Raft and WAL
coordination. Engine stats expose selected metrics from those layers through
SQL, which makes it possible to inspect storage, WAL, Raft, and transaction
pressure without setting up a Prometheus or OpenTelemetry pipeline first.

## Syntax

```camussql
SHOW ENGINE STATS;
SHOW ENGINE STATS LIKE 'raft.executor%';
```

`LIKE` filters by metric name using SQL `LIKE` matching. Use it when you know
which subsystem you want to inspect.

```camussql
SHOW ENGINE STATS LIKE 'raft.wal%';
SHOW ENGINE STATS LIKE 'kahuna.kv.write%';
```

This statement does not require a selected database. It can be run from
`camus-cli`, the HTTP SQL endpoint, or the gRPC SQL endpoint.

## What It Shows

Engine stats are process metrics. They are different from table statistics used
by the query optimizer.

Use engine stats for questions such as:

- Is the Raft executor seeing slow operations?
- Are WAL batches coalescing many writes, or mostly flushing one operation at a
  time?
- Are executor queues rejecting work because a partition is overloaded?
- Did leadership churn increase during a workload?
- Are [Kahuna](https://kahunakv.github.io/) write batches growing as expected
  under concurrency?

Use [`SHOW STATISTICS FOR <table>`](/docs/show-statistics), `ANALYZE`,
`EXPLAIN`, and the query-planning pages when you need table and cardinality
statistics for query plans.

## Result Columns

`SHOW ENGINE STATS` returns one row per metric and tag set.

| Column | Meaning |
| --- | --- |
| `node` | Local node or process label that produced the row. |
| `source` | Engine source, such as `kahuna` or `kommander`. |
| `metric` | Instrument name. |
| `tags` | Canonical comma-separated `key=value` tags. Empty when the metric has no tags. |
| `kind` | Metric kind: `counter`, `histogram`, or `gauge`. |
| `count` | Counter total, histogram observation count, or `1` for a sampled gauge. |
| `total` | Counter total or histogram sum. `NULL` for gauges. |
| `min` | Histogram minimum. `NULL` for counters and gauges. |
| `max` | Histogram maximum. `NULL` for counters and gauges. |
| `last` | Most recent histogram observation or current gauge value. `NULL` for counters. |

Rows are ordered by `source`, `metric`, and `tags`, so repeated snapshots are
easy to compare.

Example:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor.operation_duration_ms';
```

```text
┌────────────────┬───────────┬──────────────────────────────────────┬────────────────────────────────────────┬───────────┬───────┬─────────┬──────┬───────┬──────┐
│ node           │ source    │ metric                               │ tags                                   │ kind      │ count │ total   │ min  │ max   │ last │
├────────────────┼───────────┼──────────────────────────────────────┼────────────────────────────────────────┼───────────┼───────┼─────────┼──────┼───────┼──────┤
│ localhost:7070 │ kommander │ raft.executor.operation_duration_ms  │ operation_class=Control,partition_id=1 │ histogram │ 12043 │ 9821.50 │ 0.01 │ 468.2 │ 0.03 │
└────────────────┴───────────┴──────────────────────────────────────┴────────────────────────────────────────┴───────────┴───────┴─────────┴──────┴───────┴──────┘
```

## Reading Values

Counters and histograms are cumulative since the server process started. To
calculate a rate or a time-window delta, run the statement twice and subtract
the earlier values from the later values.

Gauges are sampled at statement time. They do not keep history, so the current
value appears in `last`.

Useful starting points:

| Metric | What To Check |
| --- | --- |
| `raft.executor.operation_duration_ms` | Operation latency by Raft partition and operation class. High `max` values help correlate slow dispatch warnings. |
| `raft.executor.rejections_total` | Rejected work because an executor queue was full. |
| `raft.wal.batch_size` | WAL batching density. A mean near `1` means writes are rarely coalescing. |
| `raft.heartbeat_delay_ms` | Leader heartbeat scheduling pressure. |
| `raft.elections_started_total` | Leadership churn. |
| `kahuna.kv.write.batches` | Number of KV write batches sent to storage. |
| `kahuna.kv.write.entries` | Number of KV entries written through those batches. |
| `kahuna.tx_admission.queued` | Transactions waiting at the priority admission gate, tagged by priority. |
| `kahuna.tx_admission.rejected_queue_full` | Transactions rejected because the admission queue reached its configured bound. |
| `ttl.rows_expired` | Rows deleted by row-level TTL on this node. |
| `ttl.rows_skipped_recheck` | TTL candidates spared because they no longer expired at delete time. |
| `ttl.rows_failed` | TTL delete attempts that failed or could not be resolved. |
| `ttl.spans_completed` | TTL spans completed on this node. |
| `ttl.spans_reclaimed` | TTL spans reclaimed after a worker lease expired. |
| `ttl.runs_planned` | TTL runs planned on this node. |
| `ttl.runs_completed` | TTL runs completed on this node. |
| `ttl.table.state` | Per-table TTL state, tagged with database and table. |
| `distributed.fragments_dispatched` | Query fragments this node sent to peers as a coordinator. |
| `distributed.fragments_served` | Query fragments this node executed for a peer. |
| `distributed.fragment_fallbacks` | Remote fragments that failed and were finished locally. |
| `distributed.rows_shipped_in` | Rows received from peers, survivors plus partial-aggregate groups. |
| `distributed.rows_shipped_out` | Rows this node returned to peers. |
| `distributed.partial_aggregate_gathers` | Aggregations run as per-span partials with a coordinator merge. |

The `distributed.*` rows appear only while `distributed_query_execution` is
enabled. With the feature off they are absent rather than zero, so an empty
result means distribution is off rather than idle. See
[Distributed Queries](/docs/distributed-queries) for how to read them.

## Node-Local Semantics

`SHOW ENGINE STATS` reads the current node only. It does not forward to a Raft
leader and it does not aggregate across the cluster.

For a cluster-wide view, query each node and compare the `node` column. This is
intentional: engine stats are for local runtime diagnosis, while the SQL layer
keeps the statement cheap and side-effect free.

## Permissions

When authentication is enabled, `SHOW ENGINE STATS` requires a superuser.

The statement exposes node-level workload volume, Raft topology details, and
storage/WAL behavior. Those signals are broader than a single database or table
grant, so regular `SELECT` privileges are not enough.

When authentication is disabled, the statement is available like other SQL
inspection statements.

## Configuration

Engine metric collection is enabled by default:

```yaml
engine_metrics_enabled: true
```

Set it to `false` when you do not want CamusDB to observe embedded engine
metrics:

```yaml
engine_metrics_enabled: false
```

With collection disabled, `SHOW ENGINE STATS` still succeeds but returns zero
rows.

This setting is independent from the `diagnostics` exporter configuration.
`SHOW ENGINE STATS` can be enabled without Prometheus or OpenTelemetry, and the
diagnostics exporters can be configured separately.
