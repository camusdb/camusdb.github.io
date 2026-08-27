---
sidebar_position: 7.4
---

# Caraxes

Caraxes is the harness of the reliability tests and of the chaos tests of
CamusDB. It does four things:

1. It builds a cluster in Docker, from a declarative spec in YAML.
2. It drives a load of SQL, through
   [`CamusDB.Workload`](/docs/workload-utility).
3. It injects a fault while that load runs.
4. It turns the collected artifacts into a verdict of PASS or of FAIL.

Use Caraxes when you want evidence about the behavior of a build. An opinion is
not enough. The harness covers four events: a kill of a node, a partition of the
network, a full disk, and the loss of a whole zone of a failure.

The harness lives in its own repository, beside a checkout of CamusDB. It builds
the image of a node from `docker/Dockerfile` of the repository of CamusDB. A run
therefore always tests the code on your disk.

## Requirements

- .NET 10 SDK
- Docker with `docker compose`
- A CamusDB checkout, `~/camusdb` by default

Run every command below from the root of the repository of Caraxes.

## Cluster lifecycle

Four commands manage a cluster on its own. They need no workload:

```bash
# build the image, generate artifacts, start the fleet, wait until every node is ready
dotnet run --project Caraxes -- up --spec scenarios/cluster-3.yml

# per-node health plus the cluster's partition placement table
dotnet run --project Caraxes -- status --spec scenarios/cluster-3.yml

# one node's container logs
dotnet run --project Caraxes -- logs --spec scenarios/cluster-3.yml --node camus2

# stop the cluster and remove its containers, network, and volumes
dotnet run --project Caraxes -- down --spec scenarios/cluster-3.yml
```

`up` creates the certificate of the development again, after a change of the SAN
parameters of that certificate. Two such parameters are the count of the nodes,
and the subnet.

`up` then performs four steps. It builds the image again. It writes one
`config.yml` for each node, and one file of a compose, under `runs/<cluster>/`.
It starts the fleet. It polls `GET /v1/cluster/health`, until every node reports
that it is ready.

Pass a `--skip-build` to reuse the existing image. Pass a `--ready-timeout
<seconds>` to change the deadline of the readiness, which is 180 seconds.

`down` removes the volumes of the data, unless you pass a `--keep-volumes`.

The directory of a run is output that you can discard. The spec is the source of
the truth. `down` therefore creates the file of the compose again. It works even
after you delete `runs/`.

The nodes have the names `camus1` to `camusN`. Node `i` publishes its port of
REST on the host port `15095 + i - 1`. It publishes its port of gRPC on `16095 +
i - 1`.

Those two base numbers are high by design. A cluster of Caraxes therefore runs
beside a local server of a development, on the usual ports 5095 and 5096.

## Cluster spec

A spec of a cluster is one file in YAML. Only the `name` is necessary. Every
other key has a default.

```yml
name: rf3-baseline
nodes: 3
partitions: 3
replication_factor: 3
placement_rebalancer: true
leader_balancer: true
locking: optimistic
isolation: read_committed
diagnostics: true
```

| Key | Default | Meaning |
|---|---|---|
| `name` | (required) | Lowercase `[a-z0-9-]` identifier. Names containers, volumes, the compose project, and the derived image tag. |
| `nodes` | `3` | Node count. |
| `partitions` | `3` | Initial cluster partitions. |
| `replication_factor` | `3` | Per-partition replica-set size. `0` keeps full replication, where every node hosts every partition. |
| `placement_rebalancer` | `true` | Repair under-replication, trim over-replication, and smooth skew on join or leave. |
| `leader_balancer` | `true` | Spread partition leadership using load reports. |
| `zones` | `[]` | One failure-zone label per node, parallel to the node list. Empty means zone-unaware placement. |
| `locking` | `optimistic` | Maps to CamusDB `default_transaction_locking`. |
| `isolation` | `read_committed` | Maps to CamusDB `default_isolation_level`. |
| `key_range_sharding` | `false` | Maps to CamusDB `key_range_sharding`. |
| `distributed_query_execution` | `false` | Maps to CamusDB `distributed_query_execution`. See [Distributed Queries](/docs/distributed-queries). |
| `max_query_parallelism` | `1` | Maps to CamusDB `max_query_parallelism`. |
| `diagnostics` | `true` | Turns on OpenTelemetry and the Prometheus `/metrics` endpoint on every node. |
| `subnet` | `10.101.0` | First three octets of the cluster's `/24` bridge network. |
| `first_ip` | `2` | Last octet of node 1. Node `i` gets `first_ip + i - 1`. |
| `base_rest_port` | `15095` | Host port of node 1's REST API. |
| `base_grpc_port` | `16095` | Host port of node 1's gRPC API. |
| `base_raft_port` | `7070` | Raft port of node 1. Node `i` advertises `base_raft_port + 2 * (i - 1)`. Not published to the host. |
| `spare_certs` | `5` | Extra certificate SAN entries, so a node added later is covered without regenerating certificates. |
| `data_tmpfs_mb` | `0` | When above zero, each node's `/data` is a size-capped tmpfs of this many MiB instead of a named volume. Required by the `fill-disk` fault. |
| `camusdb_repo` | `~/camusdb` | Path of the CamusDB checkout that supplies the Dockerfile, the certificate script, and the build context. |
| `image` | (derived) | Image tag. Empty derives `caraxes/camusdb:{name}`. |
| `kahuna` | `{}` | Raw passthrough into the generated config's `kahuna:` section, for engine knobs the spec does not model. |

Caraxes validates the spec before anything starts. Six problems fail
immediately:

- A wrong `name`.
- A `zones` list whose length differs from the `nodes`.
- A `subnet` with a wrong form.
- A `/24` too small for the nodes, plus the spare certificates.
- An unknown value of a `locking` or of an `isolation`.
- A port outside the range 1 to 65535.

The message of each failure names the key of the problem. An error of a spec
exits with the code 2.

## Running a scenario

A scenario is one file, and it contains everything. It holds a `cluster:` block
and a `workload:` block. It can also hold a `nemesis:` block, and a `checks:`
block.

```bash
dotnet run --project Caraxes -- run --scenario scenarios/smoke-optimistic.yml
```

The verb `run` performs the whole cycle:

1. Publish `CamusDB.Workload` from the CamusDB checkout.
2. Bring the cluster up and wait until every node is ready.
3. Seed the dataset with `CamusDB.Workload init`.
4. Drive the measured run, with the nemesis schedule in parallel when there is one.
5. Collect artifacts, correlate faults, and write the verdict.
6. Tear the cluster down, unless the scenario sets `teardown: false`.

The verb exits with a 0 on a PASS. It exits with a 1 on a FAIL. Your CI can
therefore gate on it directly.

The teardown runs even after a failure of the workload. A sweep that leaves a
fleet in operation at every failure exhausts the machine.

The workload runs in a container that runs one time. Caraxes attaches that
container to the Docker network of the cluster.

The container uses the image of a node. That image trusts the built-in CA of the
development already. The certificate of each node also covers the DNS name
`camusN` of that node.

The workload therefore reaches every node over TLS. You change no trust on the
host.

```yml
name: smoke-optimistic
cluster:
  name: smoke-opt
  nodes: 3
  partitions: 3
  replication_factor: 3
  locking: optimistic
  isolation: read_committed
workload:
  database: caraxes
  rows: 20000
  mode: open
  target_ops: 400
  workers: 32
  duration: 60s
  warmup: 15s
  read_percent: 60
  write_percent: 40
teardown: true
```

### Workload block

The keys of the `workload:` block map onto the flags of `CamusDB.Workload`.

The defaults here are lighter than the defaults of that tool. A scenario of chaos
runs many workloads. It also cares about the behavior under a fault, and not
about the peak throughput.

| Key | Default | Meaning |
|---|---|---|
| `kind` | `accounts` | `accounts` for shard-disjoint read-modify-write, `bank` for contended transfers with a conserved-balance invariant. |
| `database` | `caraxes` | Database the scenario seeds and drives. `init` creates it when it is absent. |
| `seed` | `1847` | Dataset and workload seed. |
| `rows` | `100000` | Seeded row count. |
| `payload_bytes` | `256` | Payload size per row. |
| `batch` | `500` | Rows per seeding transaction. |
| `mode` | `open` | `open` for a fixed arrival rate, `closed` for saturation. |
| `target_ops` | `500` | Open-loop submitted operations per second. |
| `workers` | `32` | Concurrent workers. |
| `read_percent` / `write_percent` | `60` / `40` | Operation mix. The two must add up to 100. |
| `writes_per_transaction` | `1` | Writes per write transaction. |
| `duration` | `60s` | Measured window. |
| `warmup` | `15s` | Unmeasured warmup. |
| `drain` | `10s` | Drain period after the measured window. |
| `connections` | `8` | Client connections. |
| `max_in_flight` | `4096` | Concurrency ceiling. |
| `locking` | (inherits) | Empty inherits the cluster's `locking`. |
| `isolation` | (inherits) | Empty inherits the cluster's `isolation`. |
| `no_auto_prepare` | `false` | Disables automatic prepared statements. |
| `request_timeout` | `0` | Per-request timeout in seconds. `0` keeps the client default. |
| `expect_faults` | `true` | Treats conflicts and open-loop pacing shortfalls as warnings rather than as an invalid run. |

A duration accepts these forms: `15s`, `1m`, `250ms`, and `1h`. A bare number
means seconds.

One parser serves the block of the workload, and the block of the nemesis. A
scenario therefore reads consistently.

## Fault injection

A `nemesis:` block drives a fault at the same time as the workload. Caraxes
times every event from the start of the measured run. A window of a fault
therefore aligns with the series of each second of the workload.

```yml
nemesis:
  seed: 7
  events:
    - { at: 20s, fault: kill, target: random, duration: 20s }
```

### Fault kinds

| Fault | What it does | Heals by |
|---|---|---|
| `kill` | SIGKILL the node's process. No graceful shutdown, so it exercises crash recovery and re-election. | Restarting the container. |
| `stop` | Graceful stop: SIGTERM, then SIGKILL after Docker's grace period. Models a planned bounce. | Restarting the container. |
| `pause` | Freeze the process with SIGSTOP. The node stops answering while its TCP connections stay open, which exercises suspicion timeouts rather than connection resets. | SIGCONT. |
| `partition` | Isolate the node from every peer with iptables DROP rules in both directions. | Flushing the node's filter table. |
| `slow` | Add one-way latency with `tc qdisc netem`. Set `delay_ms` (default `100`). | Removing the qdisc. |
| `loss` | Add packet loss with `tc qdisc netem`. Set `loss_percent` (default `10`). | Removing the qdisc. |
| `fill-disk` | Write a filler file into `/data` until the mount returns ENOSPC. | Deleting the filler. |
| `remove-node` | Drain the node through `POST /v1/cluster/leave`, then stop the container. | Never. This is a one-way scale-down. |

Set a `heal: false` on an event. That event then holds its fault open, for the
rest of the run.

A `kill` then becomes a crash without a repair. The cluster must replicate again,
around a node that never returns.

A fault can be healable, and it can still be in effect at the end of the
workload. Caraxes heals every such fault during the exit. It uses a fresh token
of a cancellation for that work. It therefore never leaves the cluster in a
partition, under a throttle, or full.

The injection and the heal are both best-effort. Caraxes writes a fault of Docker
to the timeline. It does not fail the run for it.

### Targets

A `target` is one of three things: the name of a node, such as `camus2`, the
keyword `random`, or a `zone:<name>`.

A target of a zone expands to every node of that zone of a failure. The fault
applies to each one. A `kill` of a zone therefore takes the whole zone down
together.

Caraxes draws a random choice from the generator of the schedule, which has a
seed. A run of a nemesis therefore repeats exactly.

### Random soaks

A seeded `random:` soak is the alternative to an explicit `events:` timeline. A
schedule uses one form or the other. It never uses both.

```yml
nemesis:
  seed: 42
  random:
    faults: [kill, pause, partition, slow]
    min_interval: 10s
    max_interval: 18s
    duration: 12s
```

The soak selects a fault from its menu, for a random node. It waits from
`min_interval` to `max_interval` between two selections. It holds each fault for
its `duration`. It repeats until the workload ends. Set a `count` to cap the
number of the injections.

### Disk faults

A `fill-disk` has a meaning only with a cap on the size. The cluster must
therefore set a `data_tmpfs_mb`. The `/data` of each node then becomes a tmpfs.
That tmpfs uses the RAM, it has a cap on its size, and the fault can exhaust it.

Give the size some headroom. A tmpfs slightly larger than the
`min_free_disk_bytes` of CamusDB is too small. That value is the watermark of the
admission of a write. The free space then stays below the watermark for the whole
run, after the seed of the data set. No clean baseline remains for a comparison
against the fault.

The full node must refuse a new write cleanly, with `CADB0536`, which is
`InsufficientDiskSpace`. It must then admit a write again on its own, after the
disk becomes free. It needs no restart.

A tmpfs disappears at a restart. This fault therefore tests the behavior under
the pressure of a disk. It does not test the durability.

## Verdict

A scenario passes under four conditions. The workload accepted the run. The
reconciliation held. Every internal error has an explanation. Every check of the
resilience passed.

The reconciliation is the true guard of the consistency. It checks three things
after the run: the committed versions, the counts of the rows, and the
accounting.

Caraxes grades an internal error by its context. Without an injected fault, an
internal error has no explanation, and it fails the run. The validity of the
workload itself does not catch a defect of the server.

Under a fault, a race at the disposal of a connection is expected collateral.
Caraxes reports such a race loudly. That race alone nevertheless does not turn a
consistent and reconciled run into a FAIL.

### Resilience checks

For a run with a fault, Caraxes correlates the timeline of the faults with the
`intervals.csv` of the workload. That file holds one row for each second.
Caraxes aligns the two with the anchor of the wall clock. The workload writes
that anchor to `run-meta.json`.

Each window of a fault then yields three values: the peak rate of the errors,
whether the workload continued to complete an operation, and a time of the
recovery. Caraxes measures that time from the heal, until the rate of the errors
returns near zero.

```yml
checks:
  max_recovery_seconds: 45
  require_recovery: true
  require_progress_under_fault: true
```

| Key | Default | Fails the run when |
|---|---|---|
| `max_recovery_seconds` | `45` | A healed fault took longer than this to recover. |
| `require_recovery` | `true` | A healed fault never recovered before the run ended. |
| `require_progress_under_fault` | `true` | A fault window completed zero operations, meaning a total outage. |

A second counts as recovered at an error rate of 1 percent or below.

The baseline uses the median of the clean seconds. It does not use the mean. The
tail of the recovery after a heal sits outside the window of the fault. A mean
would therefore raise the bar of the judgement.

The figures inside a fault stay means. The degradation of the whole window is the
point there.

Caraxes writes the correlation to `analysis.md`, and to `scenario.json`:

```text
# Fault analysis — bank-kill

- Baseline (clean seconds): error rate 0.00 %, write p99 1,382.0 ms
- In-fault: error rate 40.45 %, write p99 392.9 ms (0.3x baseline)
- Max recovery time: 5.5 s; all healed faults recovered: yes

| fault | healed | window (s) | peak error | failed | progressed | recovery (s) |
|---|---|---|---|---|---|---|
| kill/camus2 | yes | 20.3 | 100 % | 4,074 | yes | 5.5 |
```

## Bank-transfer invariant

A `workload.kind: bank` replaces the baseline, whose shards do not meet. It uses
a transfer between two rows instead. It draws both rows from the whole key space.
That workload produces true contention between two writes. A bounded retry
absorbs that contention.

Every transfer preserves the total of the balances. Every transfer also commits
atomically. `SUM(balance)` must therefore hold the same value after the run. A
changed sum is direct evidence of a break of the atomicity.

Caraxes checks that invariant after the run. It never waives the check.

A conflict under a fault is expected. A broken sum is a failure of the
correctness, and a run of chaos exists to catch it.

```yml
name: bank-kill
cluster:
  name: bank-chaos
  nodes: 3
  partitions: 3
  replication_factor: 3
workload:
  kind: bank
  database: caraxes
  rows: 20000
  mode: closed
  workers: 32
  duration: 60s
  warmup: 15s
  read_percent: 50
  write_percent: 50
nemesis:
  seed: 5
  events:
    - { at: 20s, fault: kill, target: random, duration: 20s }
checks:
  max_recovery_seconds: 45
teardown: true
```

## Matrix sweeps

A matrix runs a sweep of a cartesian product. It writes a report across the
cells.

```bash
dotnet run --project Caraxes -- matrix --matrix scenarios/matrix-resilience.yml
```

A file of a matrix holds a base `cluster:` block, a base `workload:` block, and a
base `checks:` block. It also holds an `axes:` block.

The cells are the product of the axes. Every axis is optional. An axis without a
value contributes the base value alone.

| Axis | Varies |
|---|---|
| `locking` | `optimistic` and `pessimistic`. |
| `nodes` | Cluster node count. |
| `sharding` | `key_range_sharding` on and off. |
| `parallelism` | `max_query_parallelism`. |
| `nemesis` | Named fault presets. A preset with no `events` or `random` is a fault-free baseline column. |

```yml
axes:
  locking: [optimistic, pessimistic]
  nemesis:
    - name: none
    - name: kill
      seed: 7
      events:
        - { at: 20s, fault: kill, target: random, duration: 20s }
```

Every cell shares one image, and Caraxes builds that image one time. Two cells
differ only in the configuration of the runtime.

The cells run one after the other, through the ordinary path of a scenario. A
cell therefore behaves exactly like a scenario that you write by hand. The
behavior of a fault of one cell also cannot disturb another cell.

Each cell receives its own name of a cluster. Two containers therefore never
collide, and two volumes never collide.

The sweep writes a `matrix-report.md`, and a `matrix.json`. Both align four
values of each cell: the verdict, the maximum time of a recovery, the growth of
the latency, and the note of the first failure.

A cell can throw an exception. Caraxes records that cell as a failure, and the
sweep continues. The code of the exit is above zero after any failed cell.

## Leader-balance test

This test targets the balancer of the Raft leaders directly. It uses no
workload.

```bash
dotnet run --project Caraxes -- leader-balance --spec scenarios/leader-balance.yml
```

The test measures the spread of the leadership of the partitions. Each node
reports the partitions that it leads, through a `LeaderLocal` flag of
`GET /v1/cluster/placement`.

The test then kills the node with the most partitions. Those leaderships move
onto the nodes that survive. The test restarts the killed node. It then watches
the balancer, for a move of the leadership back.

The test passes under two conditions. The node that rejoined regains half of its
fair share, or more. The final spread is also near even.

Half of the fair share is a lenient bar, by design. The balancer weighs the load,
and it moves gradually.

With the balancer off, the node that rejoined stays at zero. That behavior makes
this a test of the balancer. It is not a test of the election of a leader.

The test waits at three points. It waits up to 90 seconds for the leadership to
settle. It waits 30 seconds after the kill, for a new election. It waits up to
150 seconds after the restart, for an action of the balancer. It polls every 5
seconds.

Use the passthrough `kahuna:` to shorten the intervals of the balancer. The
balancer then gets several passes inside that window:

```yml
name: leaderbal
nodes: 3
partitions: 9
replication_factor: 3
leader_balancer: true
kahuna:
  leader_balancer_interval_ms: 10000
  leader_balancer_report_interval_ms: 2000
  leader_balancer_report_ttl_ms: 8000
  min_leader_stability_ms: 2000
```

The test writes a `leader-balance.md`, and a `leaders.jsonl` with one entry for
each poll:

```text
# Leader-balance test — leaderbal

Verdict: **PASS** — fair share ~3/node, rejoined node regained up to 2, final imbalance 2.

| time | camus1 | camus2 | camus3 | resolved |
|---|---|---|---|---|
| 16:43:32 | 3 | 5 | 1 | 9/9 |
| 16:44:03 | 5 | 0 | 4 | 9/9 |
| 16:44:08 | 3 | 2 | 4 | 9/9 |
```

## Artifacts

Everything that a run produces arrives under `runs/`. That output is
disposable.

| Path | Holds |
|---|---|
| `runs/<cluster>/` | Generated `compose.yml` and one `config/camusN.yml` per node, for a cluster started from a bare spec. |
| `runs/clusters/<cluster>/` | The same, for the cluster embedded in a scenario. |
| `runs/scenarios/<name>/scenario.json` | The run manifest: cluster and workload settings, the CamusDB commit under test, exit codes, the verdict, and the fault analysis. |
| `runs/scenarios/<name>/analysis.md` | Fault correlation in readable form. |
| `runs/scenarios/<name>/timeline.jsonl` | One line per injection, heal, error, and note, each stamped with a UTC timestamp and an offset from the nemesis start. |
| `runs/scenarios/<name>/artifacts/run/` | The workload's own artifacts: `summary.json`, `summary.md`, `intervals.csv`, `errors.json`, `reconciliation.json`, `manifest.json`, and `run-meta.json`. |
| `runs/matrix/<name>/` | `matrix-report.md`, `matrix.json`, and one cell directory per combination. |
| `runs/leader-balance/<cluster>/` | `leader-balance.md` and `leaders.jsonl`. |

`scenario.json` records the short hash of the commit of the checkout of CamusDB
that Caraxes built. You can therefore always trace a verdict back to the code
that it judged.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | PASS. |
| `1` | FAIL, or the harness itself errored. |
| `2` | Spec, scenario, or matrix file was invalid or unreadable. |
| `130` | Interrupted with Ctrl-C. |

## Bundled scenarios

| File | Tests |
|---|---|
| `cluster-3.yml` | 3-node cluster spec at replication factor 3, the standard posture. |
| `cluster-5.yml` | 5-node cluster spec. |
| `cluster-zones.yml` | Zone-aware cluster spec. |
| `smoke-optimistic.yml` | Fault-free baseline proving the cluster and workload path end to end. |
| `smoke-pessimistic.yml` | The same baseline under pessimistic locking. |
| `kill-follower.yml` | Kill a random node 20 seconds in, hold it down 20 seconds, restart it. |
| `partition-and-slow.yml` | Isolate one node, then degrade another with 120 ms of latency. No process ever dies. |
| `bank-kill.yml` | Bank-transfer invariant under a node kill. |
| `zone-failure.yml` | 6 nodes across 3 zones. Kill a whole zone and require the 2-of-3 quorum to survive. |
| `disk-full.yml` | Exhaust one node's capped data disk under a bank workload. |
| `soak-random.yml` | Seeded random soak on a 5-node cluster with a mixed fault menu. |
| `matrix-resilience.yml` | Optimistic against pessimistic, crossed with no fault against a follower kill. |
| `leader-balance.yml` | Cluster spec for the leader-balance test. |

## Related

- [Workload Utility](/docs/workload-utility): the load generator Caraxes drives, and the meaning of
  the artifacts it writes.
- [Cluster](/docs/cluster): partitions, placement, and replication in CamusDB.
- [Configuration](/docs/configuration): the node settings a cluster spec writes.
- [Distributed Transactions](/docs/distributed-transactions): the commit path a kill under load
  exercises.
