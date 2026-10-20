---
sidebar_position: 3.65
---

# Performance diagnostics

Performance diagnostics show where a CamusDB node spends its time. They connect
a slow result in your application to the stage of the server that caused it.

CamusDB can expose opt-in diagnostics for a standalone node. While the
diagnostics are enabled, the server exports Prometheus metrics. It can also
export sampled OpenTelemetry traces.

- [Prometheus](https://prometheus.io/) is a monitoring system. It reads
  numeric metrics from an HTTP endpoint at a fixed interval, stores them, and
  draws them on charts and alerts. Grafana is a common dashboard tool on top of
  it.
- [OpenTelemetry](https://opentelemetry.io/) is a standard for traces. A trace
  records the steps of one request and the time of each step. A collector
  receives the traces, and a tracing tool shows them as a timeline.

## Why use performance diagnostics

Use the diagnostics when a workload is slower than you expect, and you do not
know which part is slow. You can connect a workload result to a stage on the
server. Those stages are the handling of a request, the SQL execution, a scan,
the commit of a transaction, and the activity of the
[write-ahead log](/docs/concepts#wal) (WAL).

The diagnostics also give you a history. Prometheus keeps the metrics over
time, so you can compare a slow hour with a normal hour, or one build with the
next.

You do not need them for a first look at one slow query. Use
[`EXPLAIN (ANALYZE)`](/docs/explain), the
[slow query log](/docs/slow-query-log), or
[query activity](/docs/query-activity) for that.

For a quick inspection from SQL, use
[`SHOW ENGINE STATS`](/docs/engine-stats). It reports the metrics of the
embedded storage engine, [Kahuna](/docs/concepts#kahuna), and the embedded
consensus library, [Kommander](/docs/concepts#kommander). It has its own
switch, `engine_metrics_enabled`, and works without the exporter on this page.

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

The settings are these:

| Setting | Default | Meaning |
| --- | --- | --- |
| `diagnostics.enabled` | `false` | The main switch. While it is false, CamusDB exports nothing. |
| `diagnostics.prometheus_enabled` | `false` | Bind the Prometheus scrape endpoint on the HTTP listener. |
| `diagnostics.prometheus_path` | `/metrics` | The scrape path. It must start with `/`. |
| `diagnostics.otlp_endpoint` | empty | An optional absolute URL of an OTLP collector, for the traces. |
| `diagnostics.trace_sample_ratio` | `0.01` | The head sample ratio for the traces. It must be from 0 to 1. |
| `diagnostics.include_runtime_metrics` | `true` | Include the .NET runtime metrics, such as the metrics of the garbage collector and of the thread pool. |

Protect the Prometheus endpoint. You can also bind it on a trusted interface
only. It exposes operational metadata, and it adds no authentication of its own.

`CAMUS_CONFIG_PATH=/path/to/config.yml` points the server at another
configuration file. `CAMUS_DIAGNOSTICS_RUN_ID` attaches a stable run id as an
OpenTelemetry resource attribute. The attribute is `camus.run_id`.

## Server metrics

CamusDB exports the metrics of the `CamusDB.Server` meter:

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

The set of tag values is bounded. CamusDB never uses SQL text, a row key, an id,
a message, or a user value as a metric tag.

## Dependency metrics

The diagnostics exporter also subscribes to the meters of the embedded
dependencies and of the runtime:

- Kahuna metrics. They include the key/value write batches, the write
  entries, the counters of durable transactions, and the gauges of the
  transaction admission.
- Kommander metrics. They include the batches written to the
  [Raft](/docs/concepts#raft) log, the WAL operations, the batch size, the
  duration of the executor, and the depth of the client queue.
- Row-level TTL counters. They include the expired rows, the skips after a
  re-check, the completed key [spans](/docs/concepts#ranges-and-spans), and
  the planned runs.
- .NET runtime metrics. They include the garbage collector, the heap, the
  allocations, the thread pool, and the process.

These signals help when one of five things limits a run:

- The fsync latency of the WAL.
- The density of a storage batch.
- Pressure in the runtime.
- The cost of a scan.
- The concurrency of the requests.

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

CamusDB can emit sampled traces from the `CamusDB.Server` activity source, while
`diagnostics.otlp_endpoint` holds a value. A typical trace of a request contains
trace spans, one timed step each, for the parse, the execution, the storage
reads, and the commit of the transaction.

`diagnostics.trace_sample_ratio` samples the traces. The metadata of an error
uses stable attributes for the outcome and for the error code. CamusDB adds no
SQL text and no row value to a span.

## The snapshot script

The source tree of CamusDB includes a helper script. It gives local diagnostics
from one command:

```bash
scripts/bottleneck-snapshot.sh /tmp/camus-bottleneck \
  --workers 64 \
  --duration 5m \
  --rows 100000 \
  --mode closed
```

The script does five things. It starts a standalone server in the Release
configuration, with the diagnostics enabled. It seeds a deterministic data set
for the workload. It runs `CamusDB.Workload`. It scrapes `/metrics`. It then
writes a bundle:

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

The generated `bottleneck-report.md` aligns the throughput and the latency at
the client with the metrics of the server stages and of the dependencies. Use it
to select the next thing to investigate. Do that before you change a
configuration.

## The overhead check

The source tree also includes a second script:

```bash
scripts/diagnostics-overhead.sh /tmp/camus-diagnostics-overhead \
  --runs 5 \
  --duration 60s
```

It alternates a run with the diagnostics disabled and a run with them enabled.
It then reports the median difference in throughput. Measure the overhead on the
machine, on the shape of data, and on the build of the server that you plan to
compare.
