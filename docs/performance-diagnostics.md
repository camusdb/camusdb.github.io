---
sidebar_position: 3.65
---

# Performance diagnostics

Performance diagnostics show where a CamusDB node spends its time. They connect
a slow result in your application to the server stage that caused it.

CamusDB can expose opt-in diagnostics for a standalone node. While diagnostics
are enabled, the server exports Prometheus metrics, and it can also export
sampled OpenTelemetry traces.

- [Prometheus](https://prometheus.io/) is a monitoring system. It reads
  numeric metrics from an HTTP endpoint at a fixed interval, stores them, and
  uses them for charts and alerts. Grafana is a common dashboard tool on top of
  it.
- [OpenTelemetry](https://opentelemetry.io/) is a standard for traces. A trace
  records the steps of one request and how long each step took. A collector
  receives the traces, and a tracing tool shows them as a timeline.

## Why use performance diagnostics

Use diagnostics when a workload is slower than you expect and you do not know
which part is slow. They let you connect a workload result to a server stage:
request handling, SQL execution, scans, transaction commits, or
[write-ahead log](/docs/concepts#wal) (WAL) activity.

Diagnostics also give you history. Prometheus keeps the metrics over time, so
you can compare a slow hour with a normal one, or one build with the next.

You do not need them for a first look at one slow query. Use
[`EXPLAIN (ANALYZE)`](/docs/explain), the
[slow query log](/docs/slow-query-log), or
[query activity](/docs/query-activity) for that.

For repeated statements, [statement statistics](/docs/statement-stats) reveal
cumulative cost even below the slow-query threshold. [Index usage](/docs/index-usage)
shows whether reads and constraint checks justify each index's write cost.

For a quick inspection from SQL, use
[`SHOW ENGINE STATS`](/docs/engine-stats). It reports metrics from the embedded
storage engine, [Kahuna](/docs/concepts#kahuna), and the embedded consensus
library, [Kommander](/docs/concepts#kommander). It has its own switch,
`engine_metrics_enabled`, and works without the exporter on this page.

Diagnostics are off by default. With `diagnostics.enabled: false`, CamusDB
registers no exporter, no endpoint, and no background collector. The current
diagnostics path serves a standalone node.

## Enable diagnostics

Add a `diagnostics` section to the selected `config.yml` file:

```yaml
diagnostics:
  enabled: true
  prometheus_enabled: true
  prometheus_path: /metrics
  otlp_endpoint:
  trace_sample_ratio: 0.01
  include_runtime_metrics: true
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `diagnostics.enabled` | `false` | The main switch. While it is false, CamusDB exports nothing. |
| `diagnostics.prometheus_enabled` | `false` | Bind the Prometheus scrape endpoint on the HTTP listener. |
| `diagnostics.prometheus_path` | `/metrics` | The scrape path. It must start with `/`. |
| `diagnostics.otlp_endpoint` | empty | An optional absolute URL of an OTLP collector for traces. |
| `diagnostics.trace_sample_ratio` | `0.01` | The head sample ratio for traces, from 0 to 1. |
| `diagnostics.include_runtime_metrics` | `true` | Include .NET runtime metrics, such as garbage collector and thread pool metrics. |

Protect the Prometheus endpoint, or bind it only on a trusted interface. It
exposes operational metadata and adds no authentication of its own.

`CAMUS_CONFIG_PATH=/path/to/config.yml` points the server at another
configuration file. `CAMUS_DIAGNOSTICS_RUN_ID` attaches a stable run id as the
OpenTelemetry resource attribute `camus.run_id`.

## Server metrics

CamusDB exports these metrics from the `CamusDB.Server` meter:

| Instrument | Prometheus name | Type | Tags |
| --- | --- | --- | --- |
| `camus.request.count` | `camus_request_count_total` | counter | `operation`, `transport`, `outcome` |
| `camus.request.duration` | `camus_request_duration_milliseconds` | histogram | `operation`, `transport`, `outcome` |
| `camus.request.in_flight` | `camus_request_in_flight` | up-down | `transport` |
| `camus.execute.duration` | `camus_execute_duration_milliseconds` | histogram | `operation`, `statement` |
| `camus.sql.parse.cache` | `camus_sql_parse_cache_total` | counter | `result` |
| `camus.sql.parse.duration` | `camus_sql_parse_duration_milliseconds` | histogram | none |
| `camus.query.rows` | `camus_query_rows_total` | counter | `scan`, `stage` |
| `camus.query.scan.duration` | `camus_query_scan_duration_milliseconds` | histogram | `scan` |
| `camus.query_cache.requests` | `camus_query_cache_requests_total` | counter | `result` |
| `camus.transaction.count` | `camus_transaction_count_total` | counter | `operation`, `outcome` |
| `camus.transaction.active` | `camus_transaction_active` | up-down | `transaction_mode` |
| `camus.transaction.commit.duration` | `camus_transaction_commit_duration_milliseconds` | histogram | `outcome` |
| `camus.transaction.staged_mutations` | `camus_transaction_staged_mutations` | histogram | none |

Tag values come from a bounded set. CamusDB never uses SQL text, row keys, ids,
messages, or user values as metric tags.

## Dependency metrics

The diagnostics exporter also subscribes to the meters of the embedded
dependencies and the runtime:

- Kahuna metrics, including key/value write batches, write entries, durable
  transaction counters, and transaction admission gauges.
- Kommander metrics, including batches written to the
  [Raft](/docs/concepts#raft) log, WAL operations, batch size, executor
  duration, and client queue depth.
- Row-level TTL counters, including expired rows, skips after a re-check,
  completed key [spans](/docs/concepts#ranges-and-spans), and planned runs.
- .NET runtime metrics, including the garbage collector, heap, allocations,
  thread pool, and process.

These signals help when a run is limited by:

- WAL fsync latency.
- Storage batch density.
- Runtime pressure.
- Scan cost.
- Request concurrency.

Range splitting also publishes counters through the Kahuna meter. When
[key-range sharding](/docs/key-range-sharding) is enabled, inspect them with:

```camussql
SHOW ENGINE STATS LIKE 'kahuna.range%';
```

The most useful rows are `kahuna.range.splits`,
`kahuna.range.split.indivisible_refusals`,
`kahuna.range.split.no_relief_skips`, `kahuna.range.split.settle_skips`, and
`kahuna.range.merge.warm_skips`. Use them together with
[`SHOW RANGES`](/docs/show-ranges): `SHOW RANGES` shows the current placement,
while these counters explain what the splitter attempted.

## Traces

While `diagnostics.otlp_endpoint` is set, CamusDB can emit sampled traces from
the `CamusDB.Server` activity source. A typical request trace contains trace
spans (one timed step each) for parsing, execution, storage reads, and the
transaction commit.

`diagnostics.trace_sample_ratio` controls trace sampling. Error metadata uses
stable attributes for the outcome and the error code. CamusDB adds no SQL text
and no row values to a span.

## The snapshot script

The CamusDB source tree includes a helper script that gives you local
diagnostics from one command:

```bash
scripts/bottleneck-snapshot.sh /tmp/camus-bottleneck \
  --workers 64 \
  --duration 5m \
  --rows 100000 \
  --mode closed
```

The script starts a standalone server in the Release configuration with
diagnostics enabled, seeds a deterministic data set for the workload, runs
`CamusDB.Workload`, scrapes `/metrics`, and then writes a bundle:

```text
server-command.txt
config-used.yml
server.log
server-metrics.txt
workload/manifest.json
workload/summary.json
workload/summary.md
workload/intervals.csv
workload/errors.json
workload/reconciliation.json
workload/bottleneck-report.md
```

The generated `bottleneck-report.md` lines up client-side throughput and
latency with the server stage and dependency metrics. Use it to pick the next
thing to investigate before you change any configuration.

## The overhead check

The source tree also includes a second script:

```bash
scripts/diagnostics-overhead.sh /tmp/camus-diagnostics-overhead \
  --runs 5 \
  --duration 60s
```

It alternates runs with diagnostics disabled and enabled, then reports the
median throughput difference. Measure the overhead on the same machine, data
shape, and server build that you plan to compare.
