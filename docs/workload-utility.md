---
sidebar_position: 3.3
---

# Workload utility

`CamusDB.Workload` is a utility in the source tree. It validates a CamusDB
server, and it measures that server, with a deterministic mixed workload.

The utility does four things. It creates a data set that you can repeat. It runs
traffic of reads and writes, through the protocol of the CamusDB client. It
verifies the result. It writes artifacts, and you can compare those artifacts
across two builds of the server, or across two configurations.

Use the utility for four purposes:

- Check that a local deployment, or a test deployment, handles concurrent reads
  and writes.
- Compare the behavior of a gRPC client with the behavior of a REST client.
- Measure the effect of a change of the configuration, such as a setting of the
  WAL or of the optimizer.
- Collect a bundle of evidence that you can repeat, for the diagnosis of the
  performance.

The utility lives in the source repository of CamusDB, as `CamusDB.Workload`.

To drive this same workload against a cluster in Docker, while a tool injects a
fault into it, see [Caraxes](/docs/caraxes). Caraxes is the harness of the chaos
tests, and it wraps this utility.

## The data set

The default workload uses a deterministic table with the name
`workload_accounts`:

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

The utility generates the rows, the ids, the balances, the owners, and the
payloads from three inputs: the configured seed, the count of the rows, and the
size of a payload. The same inputs produce the same fingerprint of the data set
every time. The verb `run` therefore confirms that it measures the shape of the
data that it expects.

Set `--tables` above `1` to spread the dataset across
`workload_accounts_00`, `workload_accounts_01`, and so on. That shape is useful
when you want a workload that touches several key ranges or partitions. Use the
same `--tables` value for `init` and `run`.

The setup and the reconciliation both happen outside the measured interval.

## Initialize

Run `init` one time. It creates the database, the table, the index, and the data
of the seed:

```bash
dotnet run -c Release --project CamusDB.Workload -- init \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --rows 100000 \
  --payload-bytes 256 \
  --batch 500
```

You can run `init` again safely. The schema and the expected rows can exist
already. A second run then changes no part of the measured workload.

These options are common:

| Option | Default | Meaning |
| --- | --- | --- |
| `--endpoint` | necessary | The endpoint of the server. Use the port of gRPC for `--protocol grpc`, such as `http://127.0.0.1:5096`. |
| `--database` | necessary | The database of the workload. |
| `--protocol` | `grpc` | The protocol of the client: `grpc` or `rest`. |
| `--seed` | `1847` | The deterministic seed of the ids, the payloads, and the choice of an operation. |
| `--rows` | `100000` | The number of the rows of `workload_accounts`. |
| `--tables` | `1` | Number of workload tables. More than one spreads rows across `workload_accounts_00`, `workload_accounts_01`, and so on. |
| `--payload-bytes` | `256` | The size of the string of the payload, for each row. |
| `--no-auto-prepare` | `false` | Add `MaxAutoPrepare=0` to each connection string. |
| `--request-timeout` | client default | Per-request timeout in seconds. |

## Run

The verb `run` performs six steps. It validates the data set. It warms the
system up. It runs the measured interval. It drains the work in flight. It
reconciles the correctness. It then writes the files of the output.

The open-loop mode submits a target number of operations for each second:

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

The closed-loop mode keeps a fixed number of workers busy. It helps you find the
point of the saturation:

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

These are the options of a run:

| Option | Default | Meaning |
| --- | --- | --- |
| `--output` | necessary | The directory of the output, for the artifacts. It must not exist already. |
| `--mode` | `open` | `open` for a load at a target rate. `closed` for the saturation of the workers. |
| `--target-ops` | `800` | The operations of one second that the open loop submits. |
| `--workers` | `64` | The number of the concurrent workers. |
| `--concurrency-sweep` | none | Closed-loop comma-separated worker counts, such as `1,8,16,32,64,128`. |
| `--read-percent` | `60` | The percent of the operations that are read-only point reads. |
| `--write-percent` | `40` | The percent of the operations that are transactions of a write. The total of the reads and of the writes must equal `100`. |
| `--writes-per-transaction` | `1` | The updates of a row, for each transaction of a write. |
| `--duration` | `5m` | The measured interval. |
| `--warmup` | `30s` | The warm-up, before the measurement. |
| `--drain` | `10s` | The window of the drain of the open loop, after the measurement. |
| `--connections` | `8` | The number of the connections of a read, and of the connections of a write, that the client opens. |
| `--max-in-flight` | `4096` | The cap of the open loop, for the pending operations plus the operations in flight. Past that cap, the utility counts a drop of the schedule. |
| `--init-if-missing` | `false` | Create the data set, and seed it, before the run, when it is absent. The setup still stays outside the measurement. |
| `--locking` | `optimistic` | Write-transaction locking: `optimistic` or `pessimistic`. |
| `--isolation` | `read_committed` | Write-transaction isolation: `read_committed` or `serializable`. |
| `--workload` | `accounts` | Write shape: `accounts`, `bank`, or `fanout`. |
| `--expect-faults` | `false` | Treat conflicts and open-loop pacing shortfalls as validity warnings for chaos runs. |
| `--reconcile-timeout` | `600` | Seconds reconciliation keeps retrying while a cluster settles. |
| `--no-row-attribution` | `false` | For transfer workloads, skip per-row balance/version attribution and verify the aggregate sum only. |

The default `accounts` workload divides writers so two independent workers do
not update the same row. In that baseline, an unexpected conflict is evidence
against the run and the utility does not hide it behind a retry.

Use `--workload bank` for contended transfers inside one dataset. The invariant
is the conserved `SUM(balance)`.

Use `--workload fanout` with `--tables >= 2` for bank-style transfers whose two
legs land in different workload tables. That is useful for exercising
multi-range and cross-partition transaction paths.

`--no-row-attribution` makes transfer reconciliation cheaper by checking the
aggregate sum only. It can miss two opposite leaked writes that cancel each
other out, so use it only when the full before/after row scan is too expensive.

## The artifacts of the output

A successful run writes six files:

| File | Contents |
| --- | --- |
| `manifest.json` | The version of the tool, the endpoint, the protocol, the shape of the workload, the runtime, and the fingerprint of the data set. |
| `summary.json` | A summary of the throughput, of the latency, of the errors, and of the validity, for a machine. |
| `summary.md` | A summary of the run, for a person. |
| `intervals.csv` | The samples of each second: the offered operations, the started operations, the completed operations, the failed operations, the operations in flight, and the latency. |
| `errors.json` | The counts of the errors, and some sampled messages, in a group for each code of an error. |
| `reconciliation.json` | The verification of the correctness, for the committed writes and for the final versions of the rows. |

The process exits with a code above zero in two cases: the run is invalid, and
the reconciliation fails.

## The report of the bottleneck

The server can expose the metrics of Prometheus. The verb `report` can then
combine a run of the workload with a scrape of `/metrics`:

```bash
dotnet run -c Release --project CamusDB.Workload -- report \
  --output /tmp/camus-workload-run \
  --metrics /tmp/server-metrics.txt
```

That command writes `bottleneck-report.md` in the directory of the run.

The report compares the throughput and the latency at the client with the
metrics of the server. Those metrics cover the requests, the execution, the
scans, the transactions, the runtime, Kahuna, and Kommander.

The report is evidence for a diagnosis. Use it to see which measured stage
deserves your attention. Do that before you tune anything.

For a collection from one command, on a local machine, see
[Performance Diagnostics](/docs/performance-diagnostics).

## Cleanup

The verb `cleanup` drops the database of the workload only. You must confirm the
name explicitly:

```bash
dotnet run -c Release --project CamusDB.Workload -- cleanup \
  --endpoint http://127.0.0.1:5096 \
  --database workload \
  --protocol grpc \
  --confirm workload
```

The command refuses four kinds of name of a database: an empty name, a default
name, a name of the system, and a name that you did not confirm.
