---
sidebar_position: 3.66
---

# Engine stats

`SHOW ENGINE STATS` shows, from a SQL prompt, whether the storage engine or the
consensus layer causes a slow operation or rising latency. You don't need a
monitoring system to use it.

```camussql
SHOW ENGINE STATS;
SHOW ENGINE STATS LIKE 'raft.executor%';
```

The statement shows the metrics of the two libraries in the CamusDB process:
[Kahuna](/docs/concepts#kahuna), the transactional key/value store, and
[Kommander](/docs/concepts#kommander), the [Raft](/docs/concepts#raft) library
that replicates the data across nodes. CamusDB reads their .NET metrics
directly, and it adds a few counters.

`SHOW ENGINE STATS` inspects the engine. It doesn't show table statistics. For
the optimizer's view of your data, see
[`SHOW STATISTICS FOR <table>`](/docs/show-statistics) and
[Query planning](/docs/query-planning).

## Tell a spike from a pattern

Kommander logs latency warnings like this one:

```text
warn: Kommander.IRaft[0] [RaftPartitionExecutor/1] Slow dispatch: CheckLeader took 468ms
```

That line is about one slow dispatch. `SHOW ENGINE STATS` shows whether it is a
spike or a pattern, from the SQL console:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor.operation_duration_ms';
```

```text
┌─────────────┬───────────┬─────────────────────────────────────┬────────────────────────────────────────────┬───────────┬───────┬────────────────────┬─────────┬──────────┬─────────┐
│ node        │ source    │ metric                              │ tags                                       │ kind      │ count │ total              │ min     │ max      │ last    │
├─────────────┼───────────┼─────────────────────────────────────┼────────────────────────────────────────────┼───────────┼───────┼────────────────────┼─────────┼──────────┼─────────┤
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Client,partition_id=0      │ histogram │ 105   │ 38.674300000000024 │ 0.0002  │ 34.6909  │ 0.1197  │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Client,partition_id=1      │ histogram │ 2635  │ 71.44910000000004  │ 0.0001  │ 6.7377   │ 0.0997  │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Control,partition_id=0     │ histogram │ 9400  │ 603.7856999999972  │ 0.0021  │ 43.7292  │ 0.0276  │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Control,partition_id=1     │ histogram │ 9400  │ 524.1932999999975  │ 0.0002  │ 43.2406  │ 0.0041  │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Maintenance,partition_id=0 │ histogram │ 1     │ 12.2922            │ 12.2922 │ 12.2922  │ 12.2922 │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Maintenance,partition_id=1 │ histogram │ 1     │ 0.1983             │ 0.1983  │ 0.1983   │ 0.1983  │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Replication,partition_id=0 │ histogram │ 19078 │ 282.3444999999984  │ 0       │ 29.1557  │ 0.001   │
│ localhost:0 │ kommander │ raft.executor.operation_duration_ms │ operation_class=Replication,partition_id=1 │ histogram │ 25772 │ 620.3006000000038  │ 0       │ 126.0075 │ 0.0007  │
└─────────────┴───────────┴─────────────────────────────────────┴────────────────────────────────────────────┴───────────┴───────┴────────────────────┴─────────┴──────────┴─────────┘
8 rows in set (00:00:00.0326698)
```

`max` is the slowest dispatch since the process started. `last` is the most
recent dispatch.

Compare `max` with the average, which is `total` divided by `count`. A `max`
far above the average, with a normal `last`, is the signature of a periodic
stall. Sustained pressure looks different. In the output above, the
`Replication` row for partition 1 averages about 0.02 ms for each dispatch,
and its `max` is 126 ms. To find the cause, see
[Correlate a slow dispatch with a background cycle](#correlate-a-slow-dispatch-with-a-background-cycle).

## Result columns

| Column | Meaning |
|---|---|
| `node` | The internal cluster address of the node that produced the row. |
| `source` | `kommander`, `kahuna`, or `camusdb` for the counters that CamusDB maintains. |
| `metric` | The instrument name, as the library publishes it. |
| `tags` | `k=v` pairs, separated by commas and sorted by key. Empty if the metric doesn't have tags. |
| `kind` | `counter`, `histogram`, or `gauge`. |
| `count` | The total of a counter, the number of observations of a histogram, or `1` for a gauge. |
| `total` | The total of a counter, or the sum of a histogram. `NULL` for a gauge. |
| `min`, `max`, `last` | The distribution of a histogram. `last` is also the current value of a gauge, and `min` and `max` are `NULL` for a gauge. All three are `NULL` for a counter. |

The rows are sorted by `source`, then `metric`, then `tags`. This means that you
can compare the output of two executions line by line.

## Read the window correctly

Note the following when you read the numbers:

- Counters and histograms add up from the start of the process, and they don't
  reset. To measure a window, execute the statement twice and subtract. One
  reading of `raft.wal.batches_total` doesn't tell you the current rate.
- A gauge doesn't have history. The gauge is sampled when the statement
  executes, and the result has only `last`. An observable counter is shown as
  a gauge whose `last` is its running total.
- A metric appears after its first event. For example, the `kahuna.collect.*`
  metrics appear after the first collect cycle, and a counter that is zero can
  be missing.
- The statement is local to one node, and it isn't forwarded to the
  [leader](/docs/concepts#leader). In a cluster, each node answers for its
  process only. This means that you can inspect a slow node directly. To see the
  full cluster, query each node. The `node` column names the node of each row.

## Correlate a slow dispatch with a background cycle

A latency spike once a minute usually has one cause: a periodic background
cycle that competes with the Raft executor. The executor dispatches the Raft
operations of each [partition](/docs/concepts#partition). Take two readings,
one minute apart:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 1
-- wait
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 2
```

Compare the two readings. If the `max` of `raft.executor.operation_duration_ms`
jumped while `raft.executor.operations_total` grew only a little, the load
didn't cause the stall.

Then widen the filter, and look for a metric that grew in the same interval:

- `kahuna.kv.write.*` for write batches.
- `raft.wal.*` for WAL flushes.
- `kahuna.backup.*` for a backup or a point-in-time recovery cycle.

The statistics of the Kahuna collect cycle answer that question most directly:

| Metric | What it tells you |
|---|---|
| `kahuna.collect.cycles` | The collect cycles that executed. Use it to compute averages for each cycle. |
| `kahuna.collect.cycle.duration` | How long a collect cycle held the mailbox thread of the actor. A spike here lines up with the latency spike that it causes. |
| `kahuna.collect.evicted` | The entries that the cycle reclaimed, tagged with the reason, such as `reason=expiry`. |
| `kahuna.collect.inspected` | The entries that the cycle walked, tagged `scan=expiry` or `lru`. A value far above the evicted count means that the cycles spend their budget on pinned entries. |
| `kahuna.collect.backlogged` | The cycles that had more work than their budget. A value close to the cycle count means that collection can't keep up. |

These metrics are useful starting points:

| Metric | What it tells you |
|---|---|
| `raft.executor.operation_duration_ms` | The dispatch latency of each operation, by partition and operation class. |
| `raft.executor.rejections_total` | Proposals (writes submitted to Raft) that weren't accepted when a partition queue was full. A value above zero over a long period means overload. |
| `raft.wal.batch_size` | WAL batch efficiency. A mean near 1 means that writes aren't coalesced. |
| `raft.heartbeat_delay_ms` | Scheduling pressure on the leader. A value well above the heartbeat interval means a CPU shortage. |
| `raft.elections_started_total` | Leadership changes. |
| `raft.transport.channel_rebuilds_total` | Rebuilds of gRPC channels between nodes that stayed in TransientFailure. A growing count points to repeated transport recovery. |
| `raft.transport.channels_in_transient_failure` | The channels between nodes that are in TransientFailure now, tagged by peer. Use it to find a peer that is unreachable or stuck. |
| `kahuna.kv.write.batches` and `kahuna.kv.write.entries` | Write aggregation. Entries divided by batches is the average coalescing factor. |

## Permissions

While authentication is on, `SHOW ENGINE STATS` needs a superuser. A `MONITOR`
grant isn't enough. `SHOW DATABASES` shows only what the caller can reach.
However, the engine metrics describe the Raft topology and the work volume of
the full node, and a grant on one database can't narrow that view.

While authentication is off, any client can execute the statement.

## Configuration

```yml
engine_metrics_enabled: true   # default
```

Reading the meters costs one delegate call and one dictionary lookup for each
measurement. While the setting is off, CamusDB doesn't attach a listener, and
the meters have no cost. Turn it off only to measure that cost. A change needs a
restart.

While collection is off, the statement returns zero rows, and not an error. This
means that a script that polls many nodes needs no special case for nodes with
the feature off.

This setting doesn't depend on the `diagnostics:` section, which configures
the OpenTelemetry and Prometheus export. You can turn on either one, or
both. For more information, see
[Performance diagnostics](/docs/performance-diagnostics).

## Statement-statistics capacity

When [statement statistics](/docs/statement-stats) are on, the `camusdb` source
has two more rows: `statement_stats.shapes`, the current number of shapes, and
`statement_stats.dropped`, the shapes that weren't admitted because the store
was full:

```camussql
SHOW ENGINE STATS LIKE 'statement_stats.%';
```

A rising dropped count means that statement statistics leave out new shapes. If
that loss matters for your analysis, increase `statement_stats_max_shapes` and
restart.

## Join fallbacks {#join-fallbacks}

`join.nested_loop_fallbacks` (source `camusdb`) counts the hash joins that
executed as nested loops. Their build side was over the row or byte limit
while spill to disk was off. It counts each execution of such a join,
from the start of the process. The row appears while spill to disk is off, or
after a fallback.

A growing count can explain slow joins whose plans show a hash join. Look for
`ran=nested-loop-fallback` in [`EXPLAIN (ANALYZE)`](/docs/explain). Each
fallback also writes a rate-limited warning to the server log, with the
database and the build size. To fix it, turn on spill to disk, or review the
[build limits](/docs/spill-to-disk#hash-join-limits-with-spill-disabled).

## Related

- [Statement statistics](/docs/statement-stats) for running totals by query
  shape.
- [Index usage](/docs/index-usage) for the indexes that the workload reads and
  writes.
- [`SHOW RANGES`](/docs/show-ranges) for the current range placement of a
  table or index.
- [Slow query log](/docs/slow-query-log) for statements over a duration
  threshold.
- [Operator dashboard](/docs/operator-dashboard) for a browser view of the
  engine metrics and other operational data.
