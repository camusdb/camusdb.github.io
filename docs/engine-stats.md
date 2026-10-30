---
sidebar_position: 3.66
---

# Engine stats

When a node logs a slow operation, or latency rises, you need to know whether
the storage engine or the consensus layer is the cause. `SHOW ENGINE STATS`
answers that from any SQL prompt, so you need no monitoring system to use it.

```camussql
SHOW ENGINE STATS;
SHOW ENGINE STATS LIKE 'raft.executor%';
```

The statement reports the metrics of the two libraries that run inside the
CamusDB process: [Kahuna](/docs/concepts#kahuna), the transactional key/value
store, and [Kommander](/docs/concepts#kommander), the
[Raft](/docs/concepts#raft) library that keeps copies of the data in agreement
across nodes. Both publish their metrics through `System.Diagnostics.Metrics`,
and CamusDB reads them directly.

This statement inspects the engine, not table statistics. For the optimizer's
view of your data, see
[`SHOW STATISTICS FOR <table>`](/docs/show-statistics),
[`ANALYZE`](/docs/automatic-analyze), and
[the query planner guide](/docs/query-planning).

## What it is for

Kommander logs latency warnings like this one:

```text
warn: Kommander.IRaft[0] [RaftPartitionExecutor/1] Slow dispatch: CheckLeader took 468ms
```

That line reports one slow dispatch. `SHOW ENGINE STATS` tells you whether it
is a spike or a pattern, without leaving the SQL console:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor.operation_duration_ms';
```

| node | source | metric | tags | kind | count | total | min | max | last |
|---|---|---|---|---|---|---|---|---|---|
| localhost:8004 | kommander | raft.executor.operation_duration_ms | operation_class=Control,partition_id=1 | histogram | 12043 | 9821.5 | 0.01 | 468.2 | 0.03 |

`max` is the worst dispatch since the process started. `last` is the most
recent dispatch.

Compare `max` with the average, which is `total` divided by `count`. A `max`
far above that average, together with a normal `last`, is the signature of a
periodic stall, not of sustained pressure. The next section shows how to find
the cause.

## Result columns

| Column | Meaning |
|---|---|
| `node` | The internal cluster address of the node that produced this row. |
| `source` | The meter that published the row: `kommander` or `kahuna`. |
| `metric` | The instrument name, as the library publishes it. |
| `tags` | Canonical `k=v` pairs, separated by commas and sorted by key. Empty for a metric without tags. |
| `kind` | `counter`, `histogram`, or `gauge`. |
| `count` | A counter's total, a histogram's number of observations, or `1` for a sampled gauge. |
| `total` | A counter's total, or a histogram's sum. NULL for a gauge. |
| `min`, `max`, `last` | A histogram's distribution. `last` is the most recent value of a histogram or gauge, and a gauge has only `last`. All three are NULL for a counter. |

CamusDB orders the rows by `source`, then `metric`, then `tags`, so two runs of
the statement compare cleanly.

## Read the window correctly

These properties will mislead you if you assume otherwise:

- Counters and histograms accumulate from process start, with no reset. To
  measure a window, run the statement twice and subtract. A single reading of
  `raft.wal.batches_total` tells you nothing about the current rate.
- Gauges have no history. CamusDB samples a gauge when the statement runs and
  reports only `last`. CamusDB reports an observable counter as a gauge whose
  `last` is its running total.
- The statement is local to one node and never forwards to the
  [leader](/docs/concepts#leader). In a cluster, each node answers for its own
  process, which is exactly what you need when one node is slow. To see the
  whole cluster, you must query each node. That is why the `node` column
  exists: output you paste into an issue names the node that produced it.

## Correlate a slow dispatch with a background cycle

A latency spike once a minute usually has one cause: a periodic background
cycle contending with the Raft executor, the component that dispatches Raft
operations for each [partition](/docs/concepts#partition). Take two readings,
one minute apart:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 1
-- wait
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 2
```

Compare the two readings. If `raft.executor.operation_duration_ms.max` jumped
while `raft.executor.operations_total` grew only a little, the stall did not
come from load.

Next, widen the filter and look for a metric that did advance in the same
interval:

- `kahuna.kv.write.*` for write path batches.
- `raft.wal.*` for WAL flush behavior.
- `kahuna.backup.*` for a backup or point-in-time recovery cycle.

The Kahuna collection cycle statistics answer that question most directly:

| Metric | What it tells you |
|---|---|
| `kahuna.collect.cycles` | The collect cycles that ran. Use it as the denominator for the per-cycle averages below. |
| `kahuna.collect.cycle.duration` | How long a collect cycle held the actor's mailbox thread. A spike here lines up with the latency spike it causes. |
| `kahuna.collect.evicted` | The entries the cycle reclaimed, tagged `reason=tombstone\|expiry\|lru\|idle`. |
| `kahuna.collect.inspected` | The entries the cycle walked, tagged `scan=expiry\|lru`. A value far above the evicted count means the cycles spend their budget on pinned entries. |
| `kahuna.collect.backlogged` | The cycles that carried work past their budget. A value close to the cycle count means collection cannot keep up. |

These metrics are useful starting points:

| Metric | What it tells you |
|---|---|
| `raft.executor.operation_duration_ms` | Dispatch latency per operation, by partition and operation class. |
| `raft.executor.rejections_total` | Proposals (writes submitted to Raft) that CamusDB refused because a partition queue was full. A value above zero over a long period means overload. |
| `raft.wal.batch_size` | WAL batch efficiency. A mean near 1 means no coalescing happens. |
| `raft.heartbeat_delay_ms` | Scheduling pressure on the leader. A value well above the heartbeat interval means a CPU shortage. |
| `raft.elections_started_total` | Leadership churn. |
| `kahuna.kv.write.batches` and `kahuna.kv.write.entries` | Write aggregator effectiveness. Entries divided by batches is the average coalescing factor. |

## Permissions

While authentication is enabled, `SHOW ENGINE STATS` requires a superuser, a
higher bar than `SHOW DATABASES`. CamusDB filters `SHOW DATABASES` down to
what the caller can already reach, but the engine metrics describe the Raft
topology and the work volume of a whole node. No grant on a single database
narrows that view.

While authentication is disabled, the statement is available like any other.

## Configuration

```yml
engine_metrics_enabled: true   # default
```

Observing the meters costs one delegate call and one dictionary lookup per
measurement. While the flag is off, CamusDB attaches no listener, and the
meters return to their unobserved state, which costs nothing. Turn the flag
off only when you are measuring that overhead itself.

CamusDB reads the flag once at startup, so a change takes effect after a
restart.

While collection is disabled, the statement succeeds and returns zero rows
instead of raising an error, so a script that polls a fleet needs no special
case for nodes with the feature off.

This setting is independent of the `diagnostics:` section, which configures
OpenTelemetry and Prometheus export. Either one can be on without the other,
and both can read the same meters.

## Statement-statistics capacity

When [statement statistics](/docs/statement-stats) have been enabled, the
`camusdb` source exposes `statement_stats.shapes` (current shape count) and
`statement_stats.dropped` (admissions refused at capacity):

```camussql
SHOW ENGINE STATS LIKE 'statement_stats.%';
```

A rising dropped count means statement statistics omit new shapes. Increase
`statement_stats_max_shapes` and restart if that loss matters to your analysis.

## Related

[Statement statistics](/docs/statement-stats) report running totals by query
shape; [index usage](/docs/index-usage) reports the indexes the workload reads
and writes.

- [`SHOW RANGES`](/docs/show-ranges) for the current range placement of one
  table or index.
- [Slow Query Log](/docs/slow-query-log) for statements that crossed a
  duration threshold.
- [Operator Dashboard](/docs/operator-dashboard) for a browser view over engine
  metrics, slow queries, databases, backups, and configuration.
