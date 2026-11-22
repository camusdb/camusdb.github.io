---
sidebar_position: 3.65
---

# Performance diagnostics

Performance diagnostics show where a CamusDB node spends its time. They connect
a slow result in your application to the server stage that caused it.

Diagnostics are opt-in. When you turn them on, the server exports Prometheus
metrics, and it can also export sampled OpenTelemetry traces.

- [Prometheus](https://prometheus.io/) is a monitoring system. It reads numeric
  metrics from an HTTP endpoint at a fixed interval, and it stores them for
  charts and alerts. Grafana is a common dashboard tool for Prometheus.
- [OpenTelemetry](https://opentelemetry.io/) is a standard for traces. A trace
  records the steps of one request and the time of each step. A collector
  receives the traces, and a tracing tool shows them as a timeline.

## Find which server stage is slow

Use diagnostics when a workload is slower than you expect, and you don't know
which part is slow. They connect a workload result to a server stage, such as
scans or transaction commits.

Diagnostics also give you history, because Prometheus stores the metrics. This
means that you can compare a slow hour with a normal one, or one build with the
next.

For a first look at one slow query, you don't need diagnostics. Use
[`EXPLAIN (ANALYZE)`](/docs/explain) or the [slow query log](/docs/slow-query-log).
To see the statements that execute now, use
[query activity](/docs/query-activity).

For repeated statements, [statement statistics](/docs/statement-stats) show
the total cost, also below the slow-query threshold.
[Index usage](/docs/index-usage) shows whether the reads of an index justify
its write cost.

For a quick inspection from SQL, use
[`SHOW ENGINE STATS`](/docs/engine-stats). It shows the metrics of the embedded
storage engine ([Kahuna](/docs/concepts#kahuna)) and the consensus library
([Kommander](/docs/concepts#kommander)). Its switch is
`engine_metrics_enabled`. It doesn't need the exporter on this page.

Diagnostics are off by default. With `diagnostics.enabled: false`, CamusDB
doesn't register an exporter or an endpoint. Diagnostics work in standalone and
cluster mode. Each node exports the metrics of that node.

## Enable diagnostics

Add a `diagnostics` section to the `config.yml` file of the node:

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
| `diagnostics.enabled` | `false` | The main switch. While it is `false`, the other settings have no effect. |
| `diagnostics.prometheus_enabled` | `false` | Serve the Prometheus scrape endpoint on the HTTP listener. |
| `diagnostics.prometheus_path` | `/metrics` | The scrape path. It must start with `/`. |
| `diagnostics.otlp_endpoint` | empty | The absolute URL of an OTLP collector for traces. Optional. |
| `diagnostics.trace_sample_ratio` | `0.01` | The sample ratio for traces, from 0 to 1. |
| `diagnostics.include_runtime_metrics` | `true` | Include .NET runtime metrics, such as garbage collector metrics. |

Then scrape the endpoint on the HTTP port:

```bash
curl -s http://localhost:5095/metrics | grep '^camus_'
```

The endpoint doesn't have authentication. It shows operational metadata.
Protect it, or make it reachable from a trusted network only.

`CAMUS_CONFIG_PATH=/path/to/config.yml` points the server at another
configuration file. `CAMUS_DIAGNOSTICS_RUN_ID` adds a run id to the exported
data, as the OpenTelemetry resource attribute `camus.run_id`. In Prometheus, it
is the `camus_run_id` label of the `target_info` metric.

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

The `camus.request.*` metrics count gRPC requests, with the `transport` tag
`grpc_unary` or `grpc_batch`. For HTTP requests, use the ASP.NET Core metrics
in the same scrape, such as `http_server_request_duration_seconds`.

A metric appears in the scrape after its first use. For example,
`camus_query_cache_requests_total` appears after the first query with a cache
hint.

The meter has more instruments for specific features:

| Instrument | Counts |
| --- | --- |
| `camus.kv.scan_entries` | Entries that key/value range scans read. |
| `camus.kv.retryable_aborts`, `camus.kv.retry_waits` | Retryable aborts in key/value reads and writes, and the backoff waits of the retries. |
| `camus.point_read.row_id_cache.requests` | Primary-key point lookups, by the result of the row-id cache. |
| `camus.index_read.stale_entries` | Index entries that an index read skipped. Their row no longer matched the key. |
| `camus.foreign_key.operations` | The foreign-key check work. |
| `camus.matview.refreshes`, `camus.matview.refresh.*` | Materialized-view refreshes, with their duration and size. |
| `camus.batch.request_frames` | The request frames that gRPC `BatchExecute` streams read. |

Tag values come from a bounded set. Values from your data, such as SQL text or
row keys, aren't used as tags.

If `kahuna.wal_storage` is `solarium`, the exporter also reads the WAL meter of
[Solarium](https://solariumdb.github.io/). It has the same `raft.wal.*`
instruments as the RocksDB WAL. This means that the WAL metrics are available
with both engines.

## Dependency metrics

The exporter also reads the meters of the embedded dependencies and the .NET
runtime:

| Source | Examples |
| --- | --- |
| Kahuna | Key/value write batches, and transaction admission gauges. |
| Kommander | Batches written to the [Raft](/docs/concepts#raft) log, and WAL operations. |
| Row-level TTL | Expired rows, and completed key [spans](/docs/concepts#ranges-and-spans). |
| .NET runtime | The garbage collector and the thread pool. |

These signals help when a workload is limited by one of the following:

- WAL fsync latency.
- Storage batch density.
- Runtime pressure.
- Scan cost.
- Request concurrency.

Range splits also publish counters through the Kahuna meter. When
[key-range sharding](/docs/key-range-sharding) is on, you can inspect them:

```camussql
SHOW ENGINE STATS LIKE 'kahuna.range%';
```

The following rows are the most useful:

- `kahuna.range.splits`
- `kahuna.range.split.indivisible_refusals`
- `kahuna.range.split.no_relief_skips`
- `kahuna.range.split.settle_skips`
- `kahuna.range.merge.warm_skips`

Use them with [`SHOW RANGES`](/docs/show-ranges). `SHOW RANGES` shows the
current placement, and these counters show what the splitter tried to do.

## Traces

While `diagnostics.otlp_endpoint` is set, CamusDB can emit sampled traces from
the `CamusDB.Server` activity source. A request trace has one span for each
timed step, for example for parsing or for the transaction commit.

`diagnostics.trace_sample_ratio` sets the share of requests that are traced.
Errors use stable attributes for the outcome and the error code. CamusDB doesn't
add SQL text or row values to a span.

## The snapshot script

The CamusDB source tree has a script that collects local diagnostics with one
command:

```bash
scripts/bottleneck-snapshot.sh /tmp/camus-bottleneck \
  --workers 64 \
  --duration 5m \
  --rows 100000 \
  --mode closed
```

The script starts a standalone Release server with diagnostics on. Then it
executes `CamusDB.Workload` on a deterministic data set, and it scrapes
`/metrics`. The output directory must not exist. The script writes the
following bundle:

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

`bottleneck-report.md` compares the client throughput and latency with the
server and dependency metrics. Use it to find the next thing to investigate,
before you change the configuration.

## The overhead check

The source tree also has a script that measures the cost of diagnostics:

```bash
scripts/diagnostics-overhead.sh /tmp/camus-diagnostics-overhead \
  --runs 5 \
  --duration 60s
```

It alternates workload executions with diagnostics off and on, each against a
new standalone server. Then it prints the median throughput of each, and the
difference. The overhead depends on the environment. Measure it on the same
setup that you plan to compare.
