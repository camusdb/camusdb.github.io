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

This statement inspects the engine. It does not report the statistics of a
table. For the view that the optimizer has of your data, see
[`SHOW STATISTICS FOR <table>`](/docs/show-statistics),
[`ANALYZE`](/docs/automatic-analyze), and
[the query planner guide](/docs/query-planning).

## What it is for

Kommander logs a warning about latency, like this one:

```text
warn: Kommander.IRaft[0] [RaftPartitionExecutor/1] Slow dispatch: CheckLeader took 468ms
```

That line reports one slow dispatch. `SHOW ENGINE STATS` tells you whether the
event is a spike or a pattern. You stay in the SQL console:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor.operation_duration_ms';
```

| node | source | metric | tags | kind | count | total | min | max | last |
|---|---|---|---|---|---|---|---|---|---|
| localhost:8004 | kommander | raft.executor.operation_duration_ms | operation_class=Control,partition_id=1 | histogram | 12043 | 9821.5 | 0.01 | 468.2 | 0.03 |

`max` is the worst dispatch since the start of the process. `last` is the most
recent dispatch.

Compare `max` with the average, which is `total` divided by `count`. A `max` far
above that average, together with a normal `last`, is the signature of a
periodic stall. It is not the signature of sustained pressure. The next section
shows how to find the cause.

## Result columns

| Column | Meaning |
|---|---|
| `node` | The internal cluster address of the node that produced this row. |
| `source` | The meter that published the row: `kommander` or `kahuna`. |
| `metric` | The name of the instrument, as the library publishes it. |
| `tags` | The `k=v` pairs in canonical form, separated by commas, and sorted by key. The column is empty for a metric without a tag. |
| `kind` | `counter`, `histogram`, or `gauge`. |
| `count` | The total of a counter, the number of observations of a histogram, or `1` for a sampled gauge. |
| `total` | The total of a counter, or the sum of a histogram. It is NULL for a gauge. |
| `min`, `max`, `last` | The distribution of a histogram. `last` is the most recent value of a histogram or a gauge. A gauge has only `last`. All three are NULL for a counter. |

CamusDB orders the rows by `source`, then by `metric`, then by `tags`. Two runs
of the statement therefore compare cleanly.

## Read the window correctly

Three properties will mislead you if you assume something else:

- A counter and a histogram accumulate from the start of the process. There is
  no reset. To measure a window, run the statement twice. Then subtract. One
  reading of `raft.wal.batches_total` tells you nothing about the current rate.
- A gauge has no history. CamusDB samples it at the instant of the statement,
  and it reports `last` only. CamusDB reports an observable counter as a gauge.
  The `last` of that gauge is its running total.
- The statement is local to one node. It never forwards to the
  [leader](/docs/concepts#leader). In a
  cluster, each node answers for its own process. That behavior is exactly what
  you need when one node is slow. You must therefore query each node to see the
  whole cluster. The `node` column exists for that reason. Output that you paste
  into an issue names the node that produced it.

## Correlate a slow dispatch with a background cycle

A spike in latency once a minute usually has one cause. A periodic background
cycle contends with the Raft executor, the component that dispatches Raft
operations for each [partition](/docs/concepts#partition). Take two readings, one minute apart:

```camussql
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 1
-- wait
SHOW ENGINE STATS LIKE 'raft.executor%';   -- reading 2
```

Compare the two readings. The stall did not come from load if two things are
true: `raft.executor.operation_duration_ms.max` jumped, and
`raft.executor.operations_total` grew only a little.

Widen the filter next. Look for a metric that did advance in the same interval:

- `kahuna.kv.write.*` for the batches of the write path.
- `raft.wal.*` for the behavior of the WAL flush.
- `kahuna.backup.*` for a backup cycle or a point-in-time recovery cycle.

The statistics of the Kahuna collection cycle answer that question most
directly:

| Metric | What it tells you |
|---|---|
| `kahuna.collect.cycles` | The collect cycles that ran. Use it as the denominator for the per-cycle averages below. |
| `kahuna.collect.cycle.duration` | How long a collect cycle held the mailbox thread of the actor. A spike here aligns with the spike in latency that it causes. |
| `kahuna.collect.evicted` | The entries that the cycle reclaimed, with the tag `reason=tombstone\|expiry\|lru\|idle`. |
| `kahuna.collect.inspected` | The entries that the cycle walked, with the tag `scan=expiry\|lru`. A value far above the evicted count means that the cycles spend their budget on pinned entries. |
| `kahuna.collect.backlogged` | The cycles that carried work past their budget. A value close to the cycle count means that the collection cannot keep up. |

These metrics are useful starting points:

| Metric | What it tells you |
|---|---|
| `raft.executor.operation_duration_ms` | The dispatch latency of each operation, by partition and by class of operation. |
| `raft.executor.rejections_total` | The proposals, writes submitted to Raft, that CamusDB refused because a partition queue was full. A value above zero over a long period means overload. |
| `raft.wal.batch_size` | The efficiency of the WAL batches. A mean near 1 means that no coalescing happens. |
| `raft.heartbeat_delay_ms` | The scheduling pressure on the leader. A value well above the heartbeat interval means a shortage of CPU. |
| `raft.elections_started_total` | The churn of the leadership. |
| `kahuna.kv.write.batches` and `kahuna.kv.write.entries` | The effectiveness of the write aggregator. Entries divided by batches is the average coalescing factor. |

## Permissions

`SHOW ENGINE STATS` needs a superuser while authentication is enabled. Its
requirement is higher than the requirement of `SHOW DATABASES`. CamusDB filters
`SHOW DATABASES` down to what the caller can already reach. The engine metrics
instead describe the Raft topology and the volume of work on a whole node. No
grant on one database narrows that view.

While authentication is disabled, the statement is available like any other
statement.

## Configuration

```yml
engine_metrics_enabled: true   # default
```

Observation of the meters costs one call of a delegate and one lookup in a
dictionary, for each measurement. While the flag is off, CamusDB attaches no
listener, and the meters return to their unobserved state, which costs nothing.
Turn the flag off only when you measure that overhead itself.

CamusDB reads the flag once at startup, so a change takes effect after a
restart.

While the collection is disabled, the statement succeeds and returns zero rows.
It does not raise an error. A script that polls a fleet therefore needs no
special case for a node with the feature off.

This setting is independent of the `diagnostics:` section. That section
configures the export to OpenTelemetry and to Prometheus. Either one can be on
without the other, and both can read the same meters.

## Related

- [`SHOW RANGES`](/docs/show-ranges) for the current range placement of one
  table or index.
- [Slow Query Log](/docs/slow-query-log) for statements that crossed a
  duration threshold.
- [Operator Dashboard](/docs/operator-dashboard) for a browser view over engine
  metrics, slow queries, databases, backups, and configuration.
