---
sidebar_position: 3.3
---

# Workload Utility

`CamusDB.Workload` is a source-tree utility for validating and measuring a
CamusDB server with a deterministic mixed workload. It creates a repeatable
dataset, runs read/write traffic through the CamusDB client protocol, verifies
the result, and writes artifacts that can be compared across server builds or
configuration changes.

Use it when you want to:

- check that a local or test deployment can handle concurrent reads and writes
- compare gRPC and REST client behavior
- measure the effect of configuration changes such as WAL or optimizer settings
- collect a repeatable evidence bundle for performance diagnosis

The utility lives in the CamusDB source repository as `CamusDB.Workload`.

## Dataset

The workload uses a deterministic table named `workload_accounts`:

```camussql
CREATE TABLE workload_accounts (
  id OID PRIMARY KEY,
  owner INT64 NOT NULL,
  balance INT64 NOT NULL,
  version INT64 NOT NULL,
  payload STRING NOT NULL
);

CREATE INDEX workload_accounts_owner ON workload_accounts (owner);
```

Rows, ids, balances, owners, and payloads are generated from the configured
seed, row count, and payload size. The same inputs produce the same dataset
fingerprint every time, which lets `run` verify that it is measuring the data
shape it expects.

Setup and reconciliation happen outside the measured interval.

## Initialize

Run `init` once to create the database, table, index, and seed data:

```bash
dotnet run -c Release --project CamusDB.Workload -- init \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --rows 100000 \
  --payload-bytes 256 \
  --batch 500
```

`init` is idempotent. If the schema and expected rows already exist, it can be
run again without changing the measured workload.

Common options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--endpoint` | required | Server endpoint. Use the gRPC port for `--protocol grpc`, for example `http://127.0.0.1:5096`. |
| `--database` | required | Database used by the workload. |
| `--protocol` | `grpc` | Client protocol: `grpc` or `rest`. |
| `--seed` | `1847` | Deterministic seed for ids, payloads, and operation selection. |
| `--rows` | `100000` | Number of rows in `workload_accounts`. |
| `--payload-bytes` | `256` | Payload string size per row. |

## Run

The `run` verb validates the dataset, warms up, runs the measured interval,
drains in-flight work, reconciles correctness, and writes output files.

Open-loop mode submits a target number of operations per second:

```bash
dotnet run -c Release --project CamusDB.Workload -- run \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --output /tmp/camus-workload-run \
  --mode open \
  --target-ops 800 \
  --workers 64 \
  --connections 8 \
  --duration 5m \
  --warmup 30s \
  --drain 10s
```

Closed-loop mode keeps a fixed number of workers busy and is useful for finding
a saturation point:

```bash
dotnet run -c Release --project CamusDB.Workload -- run \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --output /tmp/camus-workload-closed \
  --mode closed \
  --workers 64 \
  --connections 8 \
  --duration 5m \
  --warmup 30s
```

Run options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--output` | required | Output directory for artifacts. It must not already exist. |
| `--mode` | `open` | `open` for target-rate load, `closed` for worker saturation. |
| `--target-ops` | `800` | Open-loop submitted operations per second. |
| `--workers` | `64` | Concurrent workers. |
| `--read-percent` | `60` | Percent of operations that are read-only point reads. |
| `--write-percent` | `40` | Percent of operations that are write transactions. Must make the read/write total equal `100`. |
| `--writes-per-transaction` | `1` | Row updates per write transaction. |
| `--duration` | `5m` | Measured interval. |
| `--warmup` | `30s` | Warm-up before measurement. |
| `--drain` | `10s` | Open-loop drain window after measurement. |
| `--connections` | `8` | Number of read connections and write connections opened by the client. |
| `--max-in-flight` | `4096` | Open-loop cap for pending plus in-flight operations before schedule drops are counted. |
| `--init-if-missing` | `false` | Create and seed the dataset before the run if it is absent. Setup is still outside measurement. |

The write side uses optimistic read/write transactions. The baseline workload
shards writers so independent workers should not update the same rows. In that
non-conflicting baseline, conflicts are reported as invalidating evidence
rather than hidden by retries.

## Output Artifacts

A successful run writes:

| File | Contents |
| --- | --- |
| `manifest.json` | Tool version, endpoint, protocol, workload shape, runtime, and dataset fingerprint. |
| `summary.json` | Machine-readable throughput, latency, error, and validity summary. |
| `summary.md` | Human-readable run summary. |
| `intervals.csv` | Per-second offered, started, completed, failed, in-flight, and latency samples. |
| `errors.json` | Error counts and sampled messages grouped by error code. |
| `reconciliation.json` | Correctness verification for committed writes and final row versions. |

The process exits with a non-zero code when the run is invalid or
reconciliation fails.

## Bottleneck Report

If the server exposes Prometheus metrics, `report` can combine a workload run
with a `/metrics` scrape:

```bash
dotnet run -c Release --project CamusDB.Workload -- report \
  --output /tmp/camus-workload-run \
  --metrics /tmp/server-metrics.txt
```

This writes `bottleneck-report.md` in the run directory. The report compares
client throughput and latency with server request, execution, scan, transaction,
runtime, Kahuna, and Kommander metrics. It is diagnostic evidence: use it to
see which measured stages deserve attention before tuning.

For one-command local collection, see
[Performance Diagnostics](/docs/performance-diagnostics).

## Cleanup

`cleanup` drops only the explicitly confirmed workload database:

```bash
dotnet run -c Release --project CamusDB.Workload -- cleanup \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --confirm workload
```

The command refuses empty, default, system, or unconfirmed database names.

