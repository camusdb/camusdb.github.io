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

Use the utility for these purposes:

- Check that a local deployment, or a test deployment, handles concurrent reads
  and writes.
- Compare the behavior of a gRPC client with the behavior of a REST client.
- Measure the effect of a change of the configuration, such as a setting of the
  [write-ahead log (WAL)](/docs/concepts#wal) or of the optimizer.
- Collect a bundle of evidence that you can repeat, for the diagnosis of the
  performance.
- Compare two completed runs only when their invariant settings match, and
  establish a repeatable baseline from several repetitions of the same workload.

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
when you want a workload that touches several key
[ranges](/docs/concepts#ranges-and-spans) or [partitions](/docs/concepts#partition). Use the
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
| `--endpoint` | necessary | The endpoint of the server. Use the port of gRPC for `--protocol grpc`, such as `http://127.0.0.1:5096`. A comma-separated endpoint pool is allowed. |
| `--database` | necessary | The database of the workload. |
| `--protocol` | `grpc` | The protocol of the client: `grpc` or `rest`. |
| `--seed` | `1847` | The deterministic seed of the ids, the payloads, and the choice of an operation. |
| `--rows` | `100000` | The number of the rows of `workload_accounts`. |
| `--tables` | `1` | Number of workload tables. More than one spreads rows across `workload_accounts_00`, `workload_accounts_01`, and so on. |
| `--payload-bytes` | `256` | The size of the string of the payload, for each row. |
| `--no-auto-prepare` | `false` | Add `MaxAutoPrepare=0` to each connection string. |
| `--connection-options` | none | Append extra connection-string pairs verbatim to every setup, read, and write connection, such as `CoalescingDelay=0;ChannelPoolSize=4`. Recorded in `manifest.json`; runs that differ here are not directly comparable. |
| `--routing-mode` | driver default | Learned statement routing mode: `Off`, `Learned`, or `Auto`. When omitted, the driver default is `Auto`. |
| `--routing-nodes` | none | Trust map from server node identities to endpoint pool members, such as `node-a:7070=http://a:5095,node-b:7070=http://b:5095`. |
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
| `--isolation` | `read_committed` | Write-transaction isolation: `read_committed` or `serializable`. The utility sets it on each write transaction, so its default replaces the server default, which is `serializable`. |
| `--workload` | `accounts` | Write shape: `accounts`, `bank`, `fanout`, or `append`. |
| `--append-keys` | `10` | Append workload only: number of active list keys. Fewer keys create more contention and more dependency edges. |
| `--append-max-writes-per-key` | `64` | Append workload only: rotate to a new key after this many appends, which keeps each list short enough for the checker. |
| `--append-max-txn-length` | `4` | Append workload only: maximum number of read or append steps in one transaction. |
| `--expect-faults` | `false` | Treat conflicts and open-loop pacing shortfalls as validity warnings for chaos runs. |
| `--reconcile-timeout` | `600` | Seconds reconciliation keeps retrying while a cluster settles. |
| `--reconcile-request-timeout` | `120` | Per-request timeout in seconds for setup and reconciliation reads. Separate from `--request-timeout`, which should stay tuned for measured point operations. |
| `--scan-probe-interval` | `off` | Run `SELECT COUNT(*)` against each gateway during the measured window at the given interval, such as `5s`. A low count fails the run, and a failed probe fails unless `--expect-faults` is set. |
| `--scan-probe-timeout` | `60` | Per-request timeout in seconds for scan-probe connections. |
| `--no-row-attribution` | `false` | For transfer workloads, skip per-row balance/version attribution and verify the aggregate sum only. |
| `--metrics-endpoint` | none | Per-node Prometheus endpoints to scrape during the run, as `name=url`, repeatable or comma-separated. Writes `node-metrics.csv` and feeds `bottleneck-report.md`. |
| `--metrics-interval` | `5s` | Scrape interval for `--metrics-endpoint`. |
| `--node-endpoint` | none | Per-node HTTP API bases, as `name=url`, repeatable or comma-separated. Writes `cluster-facts.json` with version, health, configuration, and placement evidence. |
| `--pipeline` | `false` | For gRPC write workloads that support it, send each transaction through the batch-frame pipeline instead of one exchange per statement. Recorded in `manifest.json`; runs that differ here use different client behavior. |

Use `--pipeline` with the `accounts`, `bank`, or `fanout` workloads to measure
the gRPC transaction pipeline. The client sends each write transaction as batch
frames, using the server's `txn_start_ref` and `COMMIT_IF_OK` contract when the
server announces support. On the `bank` shape, the normal six exchanges
(`START`, two reads, two updates, `COMMIT`) can become two exchanges. When the
server or protocol cannot use the pipeline, the client falls back to one
exchange per step. Check `summary.json`'s `exchangesPerWriteTxn` field to see
what the run actually achieved.

The default `accounts` workload divides writers so two independent workers do
not update the same row. In that baseline, an unexpected conflict is evidence
against the run and the utility does not hide it behind a retry.

Use `--workload bank` for contended transfers inside one dataset. The invariant
is the conserved `SUM(balance)`.

Use `--workload fanout` with `--tables >= 2` for bank-style transfers whose two
legs land in different workload tables. That is useful for exercising
multi-range and cross-partition transaction paths.

Use `--workload append` for a list-append history that
[Elle](https://github.com/jepsen-io/elle), the transaction isolation checker
from the Jepsen project, can analyze. The utility creates a
separate `elle_append` table and runs short transactions over a small rotating
set of list keys. A transaction can read a list or append a unique value to a
list. The measured run still validates the seeded workload rows, but the append
operations are recorded separately for an external Elle check.

The append workload is useful when a conserved sum is not enough evidence. A
bank transfer invariant can prove that money was not created or destroyed; an
Elle list-append history can expose dependency cycles such as lost updates,
write skew, read skew, dirty reads, or reads of aborted writes.

`--no-row-attribution` makes transfer reconciliation cheaper by checking the
aggregate sum only. It can miss two opposite leaked writes that cancel each
other out, so use it only when the full before/after row scan is too expensive.

`--metrics-endpoint` and `--node-endpoint` are most useful in cluster runs. The
first records how work and backlogs moved across nodes during the measured
window. The second records what build, configuration, durability fingerprint,
and placement the run actually measured, so later comparisons can reject runs
that look similar but are not the same experiment.

## The artifacts of the output

A successful run writes a bundle of artifacts:

| File | Contents |
| --- | --- |
| `manifest.json` | The version of the tool, the endpoint, the protocol, the requested routing mode, trust map, connection-string options, pipeline mode, the shape of the workload, the runtime, and the fingerprint of the data set. |
| `summary.json` | A summary of the throughput, of the latency, of the errors, of `exchangesPerWriteTxn`, and of the validity, for a machine. |
| `summary.md` | A summary of the run, for a person. |
| `intervals.csv` | The samples of each second: the offered operations, the started operations, the completed operations, the failed operations, the operations in flight, and the latency. |
| `errors.json` | Error counts by code, sampled messages, and message-shape classes for each code. |
| `reconciliation.json` | The verification of the correctness, for the committed writes and for the final versions of the rows. |
| `run-meta.json` | The wall-clock anchor for the measured window, plus warmup, measurement, and drain durations. |
| `client-resources.json` | The load generator's own CPU, memory, and headroom, so a client-side bottleneck is visible. |

When `--scan-probe-interval` is enabled, the run also writes `scan-probe.csv`
with the in-window scan results.

When `--workload append` is enabled, the run also writes `history.edn` and
`elle.json`. `history.edn` is a Jepsen/Elle list-append history. `elle.json`
records the model, the history file name, the isolation and locking modes, the
append key settings, the run tag, and the counts of `ok`, `fail`, and `info`
operations. The workload utility records the history; run the Elle checker as a
separate step.

When `--metrics-endpoint` is set, the run also writes `node-metrics.csv`,
`node-metrics-meta.json`, `bottleneck-report.md`, and the last scrape files used
to build that report. When `--node-endpoint` is set, the run writes
`cluster-facts.json`.

Transfer workloads write `transfer-ledger.csv`. With row attribution enabled,
the reconciliation can also write row-attribution violation details. Those files
explain which rows and transaction attempts caused a balance or version
invariant to fail.

The `classes` section in `errors.json` groups messages that differ only by ids,
counts, revisions, or endpoint details. It helps separate distinct failure
causes that share one CamusDB error code without storing an unbounded set of raw
messages.

The process exits with a code above zero in two cases: the run is invalid, and
the reconciliation fails.

With `--concurrency-sweep`, each worker count is a complete run under
`<output>/workers-N`. The top level writes `sweep.csv` and `sweep.md` as the
cross-point summary.

## The report of the bottleneck

The server can expose Prometheus metrics. A run can collect per-node metrics
itself with `--metrics-endpoint`, which writes `node-metrics.csv` and usually
builds `bottleneck-report.md` automatically. The verb `report` can rebuild that
report later from either a single scraped `/metrics` file or a collected
`node-metrics.csv`:

```bash
dotnet run -c Release --project CamusDB.Workload -- report \
  --output /tmp/camus-workload-run \
  --metrics /tmp/server-metrics.txt
```

```bash
dotnet run -c Release --project CamusDB.Workload -- report \
  --output /tmp/camus-workload-run \
  --node-metrics /tmp/camus-workload-run/node-metrics.csv
```

That command writes `bottleneck-report.md` in the directory of the run.

The report compares the throughput and the latency at the client with the
metrics of the server. With per-node metrics and cluster facts, it can also show
request distribution, [leader](/docs/concepts#leader) concentration, partition
and table placement, WAL
or storage bottlenecks, and backlog growth.

The report is evidence for a diagnosis. Use it to see which measured stage
deserves your attention. Do that before you tune anything.

For a collection from one command, on a local machine, see
[Performance Diagnostics](/docs/performance-diagnostics).

## Compare and baseline

The `compare` verb compares two completed run directories. It refuses the pair
when invariant fields differ, unless you explicitly allow the field that is
under test:

```bash
dotnet run -c Release --project CamusDB.Workload -- compare \
  --baseline /tmp/camus-workload-base \
  --candidate /tmp/camus-workload-candidate \
  --allow workers \
  --require-ratio 1.10 \
  --p99-budget-ms 250 \
  --output /tmp/camus-workload-comparison
```

`--require-ratio`, `--require-ops`, and `--p99-budget-ms` turn the comparison
into a gate. The command exits 0 when the candidate is comparable and passes, 1
when it is comparable but misses the gate, and 3 when the runs should not be
compared.

The `baseline` verb aggregates repeated runs of the same workload. Use it when
you need to know the median result and the spread before judging a later
candidate:

```bash
dotnet run -c Release --project CamusDB.Workload -- baseline \
  --runs /tmp/run-1,/tmp/run-2,/tmp/run-3 \
  --output /tmp/camus-workload-baseline
```

It writes `baseline.md` when `--output` is set. Exit code 3 means the supplied
runs are not one comparable baseline.

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
