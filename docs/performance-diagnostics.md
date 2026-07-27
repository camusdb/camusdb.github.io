---
sidebar_position: 3.65
---

# Performance Diagnostics

CamusDB can expose opt-in diagnostics for a standalone node. When enabled, the
server exports Prometheus metrics and optional sampled OpenTelemetry traces so
you can connect a workload result to server stages such as request handling,
SQL execution, scans, transaction commit, and WAL activity.

Diagnostics are off by default. With `diagnostics.enabled: false`, CamusDB
registers no exporter, endpoint, or background collector. The current
diagnostics path is for standalone nodes.

## Enable Diagnostics

Add a `diagnostics` section to `Config/config.yml`:

```yaml
diagnostics:
  enabled: true
  prometheus_enabled: true
  prometheus_path: /metrics
  otlp_endpoint:
  trace_sample_ratio: 0.01
  include_runtime_metrics: true
```

Settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `diagnostics.enabled` | `false` | Master switch. When false, nothing is exported. |
| `diagnostics.prometheus_enabled` | `false` | Bind the Prometheus scrape endpoint on the HTTP listener. |
| `diagnostics.prometheus_path` | `/metrics` | Scrape path. Must start with `/`. |
| `diagnostics.otlp_endpoint` | empty | Optional absolute OTLP collector URL for traces. |
| `diagnostics.trace_sample_ratio` | `0.01` | Head sampling ratio for traces. Must be in `0..1`. |
| `diagnostics.include_runtime_metrics` | `true` | Include .NET runtime metrics such as GC and thread-pool metrics. |

Protect the Prometheus endpoint or bind it only on a trusted interface. It
exposes operational metadata and does not add built-in authentication.

`CAMUS_CONFIG_PATH=/path/to/config.yml` can point the server at an alternate
configuration file. `CAMUS_DIAGNOSTICS_RUN_ID` attaches a stable run id as an
OpenTelemetry resource attribute named `camus.run_id`.

## Server Metrics

CamusDB exports metrics from the `CamusDB.Server` meter:

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

Tag values are bounded. CamusDB does not use SQL text, row keys, ids, messages,
or user values as metric tags.

## Dependency Metrics

The diagnostics exporter also subscribes to embedded dependency and runtime
meters:

- [Kahuna](https://kahunakv.github.io/) metrics, including KV write batches,
  write entries, and durable transaction counters.
- [Kommander](https://kahunakv.github.io/kommander.github.io/) metrics,
  including Raft WAL batches, WAL operations, batch size, executor duration,
  and client queue depth.
- .NET runtime metrics, including GC, heap, allocation, thread-pool, and
  process metrics.

These signals are useful when a run is limited by WAL fsync latency, storage
batch density, runtime pressure, scan cost, or request concurrency.

## Traces

When `diagnostics.otlp_endpoint` is set, CamusDB can emit sampled traces from
the `CamusDB.Server` activity source. A typical request trace contains spans
for parsing, execution, storage reads, and transaction commit.

Traces are sampled by `diagnostics.trace_sample_ratio`. Error metadata uses
stable outcome and error-code attributes; SQL text and row values are not added
to spans.

## Snapshot Script

The CamusDB source tree includes a helper script for one-command local
diagnostics:

```bash
scripts/bottleneck-snapshot.sh /tmp/camus-bottleneck \
  --workers 64 \
  --duration 5m \
  --rows 100000 \
  --mode closed
```

The script starts a Release standalone server with diagnostics enabled, seeds a
deterministic workload dataset, runs `CamusDB.Workload`, scrapes `/metrics`, and
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

The generated `bottleneck-report.md` lines up client-side throughput and
latency with server-stage and dependency metrics. Use it to narrow the next
thing to investigate before changing configuration.

## Overhead Check

The source tree also includes:

```bash
scripts/diagnostics-overhead.sh /tmp/camus-diagnostics-overhead \
  --runs 5 \
  --duration 60s
```

It alternates diagnostics-disabled and diagnostics-enabled runs and reports the
median throughput delta. Measure overhead on the same machine, data shape, and
server build you plan to compare.

