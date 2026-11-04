---
sidebar_position: 8
---

# Configuration

A node's configuration controls how it starts and runs: its ports, data
directory, standalone or cluster mode, TLS, storage engine, caches, and
background jobs. The [Settings reference](/docs/settings-reference) lists every key.

You do not need a configuration file to start a local node; the built-in
defaults work for development and for the tutorial. Edit the configuration
when you:

- Prepare a node for production, for example with a data directory on a
  dedicated disk, TLS, and authentication.
- Set up a [cluster](/docs/cluster). Each node needs its name, its peers, and
  the [partition](/docs/concepts#partition) count.
- Turn on a feature that is off by default, such as
  [spill to disk](/docs/spill-to-disk) or
  [performance diagnostics](/docs/performance-diagnostics).
- Deploy [C# extensions](/docs/csharp-extensions) that add scalar functions,
  triggers, or procedures to a node.

Some settings can change while the cluster runs, without a restart. See
[Runtime cluster settings](/docs/runtime-cluster-settings). To see the values a
running node uses, run [`SHOW VARIABLES`](/docs/show-variables).

## The configuration file

CamusDB reads the first configuration file it finds at startup. For an
installed node, run `camusdb init` to write a user-owned starter file:

```bash
camusdb init
```

That creates `~/.camusdb/config.yml` on macOS and Linux, or
`%APPDATA%\camusdb\config.yml` on Windows. Set `CAMUS_HOME` to relocate both the
user configuration and the default data directory.

The source-tree `CamusDB/Config/config.yml` is an annotated reference. It is not
the right place to keep settings for an installed node, because a checkout or
pull can replace it.

CamusDB merges the selected YAML file with CLI flags and environment variables
into one resolved configuration object.

## Configuration discovery

CamusDB searches in this order:

1. `--config <path>`
2. `CAMUS_CONFIG_PATH`
3. `./camusdb.yml`
4. `./Config/config.yml`
5. `~/.camusdb/config.yml` on macOS/Linux, or
   `%APPDATA%\camusdb\config.yml` on Windows
6. built-in defaults

If `--config` or `CAMUS_CONFIG_PATH` names a missing file, startup fails instead
of silently falling through to another location.

To see what a node resolved, run [`SHOW VARIABLES`](/docs/show-variables)
against it instead of reconstructing the merge by hand. The output names the
layer that supplied each value.

## Precedence

The highest layer wins:

1. A CLI flag. Only flags you pass explicitly override YAML; the options are
   nullable and have no sentinel defaults.
2. An environment variable. `CAMUS_KEY_RANGE_SHARDING` overrides
   `key_range_sharding`. Authentication is switched on with
   `CAMUSDB_AUTH_ENABLED`, and its secrets are read only from the environment.
3. `config.yml`.
4. The built-in default, listed in the [settings reference](/docs/settings-reference).

For example, if YAML holds `mode: cluster`, passing `--mode standalone` starts
the node in standalone mode. Without a `--mode` flag, the node stays in cluster
mode.

## CLI flags and YAML fields

These keys also have a CLI flag or an environment variable:

| YAML field | CLI flag | Default |
|------------|----------|---------|
| configuration file | `--config` | Search order described above |
| `data_dir` | `--data-dir` | `~/.camusdb/data`, or `$CAMUS_HOME/data` when set |
| `mode` | `--mode` | `standalone` |
| `memory_profile` | `--memory-profile` | `prod` |
| `node_name` | `--raft-nodename` | `""`. In cluster mode, the machine name. |
| `raft_node_id` | `--raft-nodeid` | `1` |
| `raft_host` | `--raft-host` | `localhost` |
| `raft_port` | `--raft-port` | `7070` |
| `initial_partitions` | `--initial-cluster-partitions` | `1` in standalone mode, `3` in cluster mode |
| `peers` | `--initial-cluster` | `[]` |
| `http_peers` | `--http-peers` | `[]` |
| `join_existing` | `--join-existing` | `false`. Join a running cluster using `peers` as seeds; see [growing a cluster](/docs/growing-a-one-node-cluster). |
| `pitr_bootstrap_from` | `--pitr-bootstrap-from` | Unset. Backup id used to seed a joining node; see [Backup and restore](/docs/backup-and-restore#seed-a-joining-node-from-a-backup). |
| `pitr_bootstrap_target_time_ms` | `--pitr-bootstrap-target-time-ms` | `0`, the latest point covered by the chain. |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` |
| `http_port` | `--http-port` | `5095` |
| `https_port` | `--https-port` | `7141` |
| `https_certificate` | `--https-certificate` | `""` |
| `raft_certificate` | `--raft-certificate` | `""` |
| `grpc_port` | `--grpc-port` | `5096` |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` |
| `extension_assemblies` | `--extension-assemblies` | `[]`. Absolute paths of safe C# extension DLLs. |
| `unsafe_extension_assemblies` | `--unsafe-extension-assemblies` | `[]`. Absolute paths of reviewed extension DLLs loaded without safe-assembly checks. |

| `key_range_sharding` | (none. Use the `CAMUS_KEY_RANGE_SHARDING` variable.) | `false` |

These lists make extensions available on each node after a restart. A superuser
must also run `CREATE EXTENSION` in each database that uses them. Deploy the
same builds on every node; see
[C# extension deployment](/docs/csharp-extensions#deploy-extensions).

Every other key is YAML only. The [settings reference](/docs/settings-reference)
lists them all.

## HTTP/3 on the HTTPS port

The REST API can also serve HTTP/3 over QUIC. HTTP/3 is off by default; to
turn it on, set `http3_enabled: true` and give the node an HTTPS certificate:

```yaml
https_port: 7141
https_certificate: /etc/camusdb/api.pfx
http3_enabled: true
```

The HTTPS port then serves HTTP/1.1, HTTP/2, and HTTP/3. The setting is read
when the node starts, so changing it requires a restart.

HTTP/3 requires:

- **TLS.** HTTP/3 always uses TLS, so the setting applies to the HTTPS port
  only. Without `https_certificate`, the node has no HTTPS port and the setting
  has no effect. The plain HTTP port, the [Raft](/docs/concepts#raft) port
  (node-to-node cluster traffic), and the gRPC port do not change.
- **UDP.** QUIC uses UDP, so open `https_port` for both UDP and TCP, in the
  firewall and in any container port mapping, for example
  `-p 7141:7141/tcp -p 7141:7141/udp`.
- **A QUIC library.** Linux and macOS need `libmsquic`. Windows needs Windows 11,
  Windows Server 2022, or later. Without the library, the port serves HTTP/1.1
  and HTTP/2 only. On macOS, .NET does not search the Homebrew library folder
  by default, so start the node with
  `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. macOS strips `DYLD_*`
  variables for system binaries such as `nohup`, so set the variable in the
  node process's own environment.

Clients that connect over TCP receive an `Alt-Svc` header on each response,
telling them the same port serves HTTP/3. Browsers and other HTTP/3-capable
clients then use it for later requests.

If `http3_enabled` is on but HTTP/3 cannot start, the node still starts and
logs a warning that names the cause: no `https_certificate`, or no QUIC
library.
`SHOW CONNECTIONS` shows an HTTP/3 connection with the protocol `HTTP/3`.

## gRPC listener

The client-facing gRPC API is enabled by default:

```yaml
grpc_enabled: true
grpc_port: 5096
grpc_batch_max_in_flight: 64
grpc_tls_enabled: true
```

`grpc_port` is separate from the HTTP API port. When `raft_certificate` is set,
CamusDB reuses that certificate for the gRPC listener unless
`grpc_certificate` names a separate PFX certificate. Otherwise the listener
uses plaintext HTTP/2, which is suitable for local development and trusted
private test networks.

Set `grpc_tls_enabled: false` to force plaintext h2c (HTTP/2 without TLS) on
the client-facing gRPC port even when `grpc_certificate` or `raft_certificate`
is configured. This does not change the Raft port. Use it only on a trusted
network or behind a proxy that terminates TLS for clients.

Use `grpc_certificate` when the Raft port and the client-facing gRPC port serve
different trust domains. A cluster-internal certificate is often right for Raft,
while clients need a certificate that their own trust store accepts.

`grpc_batch_max_in_flight` bounds how many operations one `BatchExecute` stream
can run at once before the server applies backpressure.

See [gRPC API](/docs/grpc-api).

## Cluster peer transport

In cluster mode, CamusDB uses peer HTTP endpoints for schema-DDL forwarding,
cluster-settings forwarding, and query-fragment exchange. Set
`peer_tls_enabled: true` when those peer HTTP endpoints serve HTTPS:

```yaml
peer_tls_enabled: true
```

An `http_peers` entry with an explicit `https://` scheme overrides this
default for that peer. Without peer TLS, the shared node secret that internal
routes use travels over plaintext peer HTTP. CamusDB logs startup warnings for
exposed cluster configurations that leave peer HTTP, Raft gRPC, or
client-facing gRPC traffic in plaintext.

## Dashboard

The read-only operator dashboard is enabled by default on the HTTP port:

```yaml
dashboard_enabled: true
dashboard_refresh_seconds: 2
```

Disable it with `dashboard_enabled: false`; the dashboard pages and endpoints
then return 404. With authentication disabled, the dashboard is loopback-only.
With authentication enabled, it uses a dashboard session cookie and applies the
user's privileges to each panel.

See [Operator Dashboard](/docs/operator-dashboard).

## Slow query log

The slow query log is off by default:

```yaml
slow_query_log_enabled: false
slow_query_log_threshold_ms: 1000
slow_query_log_max_entries: 200
slow_query_log_max_sql_length: 4096
```

Turn it on when you are diagnosing a node. It records qualifying statements in
a bounded in-memory ring and exposes them through `SHOW SLOW QUERIES`. The log
is node-local and does not survive a restart. If the node started with the log
off, it can still be enabled at runtime.

See [Slow Query Log](/docs/slow-query-log).

## Statement statistics and index usage

Use [statement statistics](/docs/statement-stats) to find expensive repeated
query shapes and [index usage](/docs/index-usage) to assess indexes against
their write cost:

```yaml
statement_stats_enabled: false
statement_stats_max_shapes: 2000
index_usage_enabled: true
```

The two enable flags can change at runtime. Shape capacity requires a restart.
Both features keep in-memory, node-local totals that reset when the node restarts.

## Key-range sharding and range splits

`key_range_sharding` defaults to false for new clusters. The cluster records
its routing mode at creation; a restart cannot change it on existing data:

```yaml
key_range_sharding: false
```

When it is on, eligible table and index key spaces can split by key range
instead of staying on one hash-routed partition. The nested `kahuna:` settings
control automatic splitting:

```yaml
kahuna:
  range_split_threshold: 0
  range_split_min_range_size: 10
  range_split_load_threshold: 500
  range_split_load_min_queue_depth: 8
  range_split_load_min_commit_wait_ms: 0
  range_split_load_window_ms: 15000
  range_split_load_poll_interval_ms: 5000
  range_split_load_imbalance_max: 0.8
  range_split_settle_window_ms: 10000
  range_split_indivisible_cooldown_ms: 300000
  range_move_settle_timeout_ms: 10000
  range_merge_min_size: 10
  enable_load_reports: false
```

Both kinds of split stay off until you set a threshold for them. Count-based
splits use `range_split_threshold`. Load-based splits use
`range_split_load_threshold`, gated by queue depth and, optionally, commit
wait.

See [Key-Range Sharding](/docs/key-range-sharding) and
[`SHOW RANGES`](/docs/show-ranges).

## Transaction outcome retention

Kahuna can keep a transaction's final outcome record after the transaction
finishes. CamusDB uses these records when a finalize path needs to resume, or
to diagnose an uncertain commit outcome:

```yaml
kahuna:
  transaction_outcome_retention_ttl_ms: 600000
  transaction_outcome_retention_max: 100000
```

`transaction_outcome_retention_ttl_ms` sets the age window; `0` disables age
pruning and leaves only the size cap. `transaction_outcome_retention_max` sets
the maximum number of retained records. For an investigation or a long
fault-injection run, raise both together, because a large TTL does nothing if
the count cap evicts records first.

## Kahuna engine section

The nested `kahuna:` map tunes [Kahuna](/docs/concepts#kahuna), the
transactional key/value layer embedded in each node, and through it
[Kommander](/docs/concepts#kommander) (the Raft library) and the on-disk
engine: RocksDB by default, with SQLite and [Solarium](https://solariumdb.github.io/) as alternatives. See
[Architecture: storage components](/docs/architecture#storage-components) for
their roles. CamusDB applies the map in both standalone and cluster mode, and
an unset key keeps the CamusDB baseline for that mode. The node reads the map
once at startup, so a change requires a restart.

[Kahuna keys](/docs/settings-reference#kahuna-keys) lists every accepted key with its default.
An unknown key fails validation at startup, and the error message lists every
accepted key. The `kahuna:` block in `CamusDB/Config/config.yml` is commented
out and documents each key inline.

`storage_revision` names the directory that Kahuna opens under
`{data_dir}/kv`. The current CamusDB baseline pins it, together with the WAL
revision, to the current key layout. Do not set it to an older revision to
reach older data. A server that finds an older revision directory leaves it
untouched; to move data across revisions, use a
[logical dump and reimport](/docs/logical-dump-and-reimport).

Kahuna serves keys and locks through a fixed set of in-memory workers called
actors (`key_value_workers` and `locks_workers`). Each key-value actor caches
the entries it serves, and evicts them in two ways:

- A size cap: `max_entries_per_actor` and `max_bytes_per_actor` bound what one
  actor holds in memory.
- A timed collection sweep: every `collection_interval_ms`, a pass evicts up to
  `cache_entries_to_remove` entries older than `cache_entry_ttl_ms`.

Three keys govern Raft log compaction: `compact_every_operations` sets how
often it runs, `compact_number_entries` sets how many trailing entries stay,
and `max_entries_per_compaction` caps how many entries one pass removes.

`compact_every_operations` counts persisted WAL batches, not individual log
entries. A busy batch can hold many entries, so this setting is a compaction
cadence rather than a direct row count. With the RocksDB Raft log, a pass also
drops whole files that lie below the persisted compaction floor, so it can free
more disk than `max_entries_per_compaction` suggests. This holds for the Kahuna
1.12.8 release that CamusDB ships with.

The storage backends are `memory`, `sqlite`, `rocksdb`, and `solarium`.

RocksDB buffers recent writes in memory (memtables) and flushes them to sorted
files on disk (SST files). See
[The RocksDB backend](/docs/storage#the-rocksdb-backend).

`kahuna.rocksdb_direct_reads` is off in CamusDB's baseline. With the default
buffered reads, a read that misses the RocksDB block cache and goes to an SST
file can be served from the operating system page cache, which helps when the
same disk is also handling Raft WAL fsyncs. Set it to `true` when you need
RocksDB reads to bypass the page cache and rely on the RocksDB block cache
alone.

### Solarium storage engine

[Solarium](https://solariumdb.github.io/) is a managed key/value engine that can store the KV state, the Raft
WAL, or both without a native RocksDB library. CamusDB includes and registers
its providers; no extension DLL is needed:

```yaml
kahuna:
  storage: solarium
  wal_storage: solarium
  solarium_environment: default
```

All nodes must agree on `storage` and `wal_storage`. Solarium and RocksDB files
are incompatible; switch engines using a
[logical dump and reimport](/docs/logical-dump-and-reimport), not by opening
existing files with another engine. PITR bootstrap through
`pitr_bootstrap_from` still requires RocksDB for both layers.

`solarium_environment` selects file I/O for both Solarium layers. `default`
uses the portable environment; `io_uring` needs a Linux kernel able to create
a ring, otherwise startup fails. RocksDB tuning and WAL-shard settings do not
apply to Solarium, except the two shared-budget keys below.

#### Cache and memtable budgets {#managed-memory-budgets}

[Solarium](https://solariumdb.github.io/) 0.1.4 and later hold memtable entries
and cached data blocks in native memory. Index and filter partitions and their
handles remain managed; the partitions account for roughly 2% of table bytes.
Shared cache and memtable budgets therefore sit outside the GC heap limit,
while still counting toward the node or container's total memory use.

`rocksdb_shared_memory_budget_mb` and `rocksdb_shared_memtable_budget_mb`
configure Solarium's shared cache and memtable sub-budget. Positive budgets
are shared regardless of `rocksdb_shared_memory`; that boolean controls
RocksDB sharing only. Unset prod budgets derive from machine or container
memory, as they do for RocksDB. Explicit values win.

The startup log identifies these budgets as native. The older warning about
them exceeding one third of the managed heap was removed. Leave room for
native storage budgets alongside the managed application and actor caches.
[Node stats](/docs/node-stats) reports `gc_memory_limit_bytes`.

The Solarium WAL's flush unit plus headroom is 256 MiB. The computed memtable
budget tries to cover it, but stops at half the shared cache. With 10% cache
sizing, that unit fits from roughly 5 GiB of machine memory. Smaller nodes can
log budget-forced WAL flush warnings; size both budgets explicitly to cover it.

#### Flush and compaction pacing

For either RocksDB or [Solarium](https://solariumdb.github.io/), `storage_compaction_rate_mbps` limits KV-store
flush and compaction writes in decimal MB/s; zero or unset leaves them unpaced.
`storage_max_background_compactions` sets parallel compactions; zero or unset
uses the engine default. Both are nonnegative, restart-time settings.

Solarium defaults to one compaction at a time without pacing. Setting a rate
also enables max(2, CPUs / 2) compactions unless an explicit concurrency wins.
RocksDB defaults to max(2, CPUs / 2). Choose pacing for the disk and workload:
too little bandwidth lets pending compactions accumulate and can slow writes.

### One-phase apply-time validation

`kahuna.one_phase_apply_time_validation` is on by default. It lets an eligible
read-modify-write transaction commit in one durable Raft round instead of the
normal two-phase path. To be eligible, the transaction must have one
participant partition, its anchor on that partition, and a read set that can be
validated there. Cross-partition transactions still use two-phase commit.

`kahuna.staged_base_fence_retention_ms` (default `600000`) is how far back the
validation fence and committed-head ledger remember transactionally written
keys. Set it above the longest transaction lifetime your deployment allows;
otherwise long transactions can be refused because their validation base fell
out of the retained window.

Treat the setting as a cluster-wide operational switch:

- Give every node the same values for both keys.
- During a rolling upgrade across Kahuna versions, set
  `one_phase_apply_time_validation: false` until every node runs a version that
  supports the apply-time check.
- When you start a data directory or snapshot that predates the committed-head
  ledger, start once with the setting off and let a checkpoint run. After that
  checkpoint rewrites the ledger, remove the override and restart.

### Persistent MVCC revision retention

Kahuna keeps several versions of each row so that readers see a consistent
snapshot ([MVCC](/docs/concepts#mvcc)). Every version of every row is stored
physically in the key-value layer, so without pruning, a hot table's retained
history and disk usage grow for the life of the store.

When both retention keys are unset, CamusDB keeps persisted history by age,
aligned with the effective point-in-time recovery window
(`kahuna.pitr_window_seconds`, default `3600`). In-window restores stay valid,
and older revision rows can be reclaimed. Snapshot reads older than the
retention age are not guaranteed. Branch forks pin their own snapshot floors,
and reclamation honors those pins while they remain protected.

- `kahuna.persistent_revision_retention_age_seconds` sets an explicit age bound.
  It must be at least the effective PITR window. `0` disables age pruning.
- `kahuna.persistent_revision_retention_count` sets a hard per-key revision cap.
  The default `0` disables it. A count cap can trim history below the PITR
  window on hot keys, so prefer the age bound unless you specifically want a
  per-key cap.

### Write aggregation

Kahuna groups key-value writes into Raft batches before replication:

- `kahuna.key_value_write_max_in_flight_batches_per_partition` (default `1`)
  controls how many write batches a partition may have waiting on Raft at once.
  Higher values pipeline batches, but change it only after an A/B test on the
  workload you are tuning.
- `kahuna.key_value_write_linger_ms` (default `1`) is how long the oldest queued
  write may wait, while nothing is in flight, before a batch is dispatched.
- `kahuna.key_value_write_max_batch_items` (default `512`) caps the number of
  items in one write batch.
- `kahuna.key_value_write_post_completion_hold_ms` (default `1`) waits after a
  batch completes before dispatching the next one. CamusDB ships a nonzero
  default to increase batch density at full occupancy. Set it to `0` to restore
  Kahuna's dispatch-at-once behavior.
- `kahuna.key_value_write_precise_wake` (default `false`) moves the write
  aggregator's hold, linger, and queue-age wakeups onto a dedicated timer
  thread. Use it when testing low-latency write aggregation, because it can
  wake closer to the configured millisecond deadline than the shared timer
  queue.
- `kahuna.key_value_write_fill_target_trigger` (default `false`) dispatches a
  held or lingering partition buffer as soon as it reaches the learned fill
  target, instead of always waiting for the timer. Kahuna keeps probing the
  timer path so the target can follow the current load.

These settings affect write latency and throughput. Record them alongside
benchmark results, because runs with different batching settings are not
directly comparable.

### Raft WAL shard column families

Eight `kahuna.wal_shard_*` keys override the RocksDB column-family settings for
the Raft log. CamusDB leaves them all unset by default, so Kommander's measured
defaults apply field by field. They take effect only when `kahuna.wal_storage`
is `rocksdb`.

| Key | Kommander default | Meaning |
|-----|-------------------|---------|
| `wal_shard_write_buffer_size_mb` | `64` | Size of one shard memtable. |
| `wal_shard_min_write_buffer_number_to_merge` | `2` | Immutable memtables merged into one flush. |
| `wal_shard_max_write_buffer_number` | `4` | Memtables per shard, mutable plus immutable. Must exceed the merge count. |
| `wal_shard_level0_file_num_compaction_trigger` | `8` | L0 files that trigger compaction. |
| `wal_shard_level0_slowdown_writes_trigger` | `28` | L0 files at which writers are slowed. |
| `wal_shard_level0_stop_writes_trigger` | `44` | L0 files at which writers are stopped. |
| `wal_shard_max_bytes_for_level_base_mb` | RocksDB's `256` | Base-level size for leveled compaction. |
| `wal_shard_universal_compaction` | `false` | Uses universal compaction instead of leveled compaction. |

Treat these as storage-engine tuning knobs. Larger flush units can reduce write
amplification in the Raft log, but they also raise memory pressure and restart
replay work. If `wal_shard_universal_compaction` is `true`,
`wal_shard_max_bytes_for_level_base_mb` has no effect, because RocksDB ignores
level sizing under universal compaction.

### Memory profile

`memory_profile` (or `--memory-profile`) selects the defaults for the four
cache-size settings below, and nothing else. It does not change the number of
workers or durability. The only effect an application can observe is how
often a read comes from cache instead of disk.

| Profile | Block cache | Memtable sub-budget | Actor caches | Total |
|---------|-------------|---------------------|--------------|-------|
| `prod`, the default | 10% of machine memory (RocksDB or [Solarium](https://solariumdb.github.io/)), up to 2 GiB | One quarter of the block cache, raised to the Raft-log flush unit when possible, up to 1 GiB | 6.25% of the managed heap budget, 64 MiB or more | Depends on engine and heap limit; see cache sizing below |
| `dev` | 64 MiB | 16 MiB | 32 MiB | About 96 MiB, on any machine |

Use `dev` for a node that shares a developer machine with the application you
are building. Its budgets are fixed, so the node is the same size on a 64 GiB
workstation and in a 2 GiB container.

The cost of `dev` is throughput once the working set outgrows the cache (see
the TPC-C measurement under
[Cache defaults proportional to memory](#cache-defaults-proportional-to-memory)),
so `dev` is not a server setting.

An explicit `kahuna.*` budget always beats the profile, so `dev` with one raised
budget is a valid combination, not a conflict.

The caches are ceilings, and CamusDB fills them lazily. A burst of large writes
can still push the process's resident memory far above the cache total. That
peak is dominated by transient managed allocations and the .NET garbage
collector. The server garbage collector is the default and uses one heap per
core. `DOTNET_gcServer=0` in the environment controls that half of the memory
footprint; it is a runtime setting, not a CamusDB setting.

`CAMUS_THREADPOOL_MIN_THREADS` overrides CamusDB's .NET worker-thread floor. The
default floor is `1024` worker threads, with a completion-port floor of `512`.
Use the override for controlled load tests or diagnostics when runtime metrics
show work queued in the thread pool. It is an environment variable and takes
effect when the process starts.

### Cache defaults proportional to memory

Under `memory_profile: prod`, most unset keys keep the Kahuna default. The four
cache-size settings are the exception: when you leave them unset, CamusDB
computes them at startup from the node's memory instead of using a fixed
constant.

Two memory sizes feed the computation:

- Machine memory sizes the RocksDB and Solarium block cache and memtable budgets. It is the
  container cgroup limit when one is set, otherwise physical RAM.
- The managed heap budget sizes the actor caches. It is the GC-reported limit:
  an explicit hard limit, the runtime's container default (normally 75% of the
  container limit), or machine memory when no heap limit applies.

RocksDB and Solarium use native memory for these storage budgets, which sit
outside a .NET heap hard limit
but still count against the container. Leave room for both when you set
`DOTNET_GCHeapHardLimit`, `DOTNET_GCHeapHardLimitPercent`, or related runtime
limits.

A measurement motivated this behavior. A fixed 320 MB block cache forced a
1.2 GB TPC-C working set through a disk read on almost every statement. Sizing
the cache to the machine took the same workload from 24.5 to 119.6
transactions per second, at 8 clients.

| Key | Computed value when unset | Clamp |
|-----|---------------------|-------|
| `rocksdb_shared_memory_budget_mb` | 10% of machine memory (RocksDB or Solarium) | 64 MiB to 2 GiB; the 320 MiB floor yields on small nodes |
| `rocksdb_shared_memtable_budget_mb` | One quarter of the block cache, raised to the Raft-log flush unit when possible | 16 MiB to 1 GiB; the 128 MiB floor yields on small nodes |
| `max_bytes_per_actor` | 6.25% of the managed heap budget, and at least 64 MiB for the layer, divided by `key_value_workers` | 1 MiB to 2 GiB for each actor; the 8 MiB floor yields on small nodes |
| `max_entries_per_actor` | `max_bytes_per_actor` divided by about 512 B | 2k to 4M; the 10k floor yields on small nodes |

Across the two cache layers, the total never exceeds 4 GiB, however large the
machine.

The fractions and ceilings are conservative because an unconfigured node is
more often a developer workstation, or a CI container sharing the machine with
a compiler and an editor, than a dedicated database server.

For example, on an 8 GiB machine with 8 cores, no heap limit, and none of the
four keys set, the block cache is 819 MiB and the memtable sub-budget is 204
MiB. The 8 cores give 32 key-value workers, each with a 16 MiB actor cache, for
512 MiB together. The total is about 1.3 GiB.

On a dedicated server, raise all four values explicitly. The computed sizes are
a floor to build from, not a recommendation for a machine whose only job is
CamusDB.

The 6.25% share and its 64 MiB floor bound the actor-cache layer as a whole.
CamusDB divides that budget by `key_value_workers` (default
max(32, 4 × CPU cores)), and only the 8 MiB minimum applies per actor. More
cores divide the same budget into more parts rather than enlarging it, so a
machine with many cores and little RAM does not get a multiple of the intended
share. Because `max_bytes_per_actor` applies to one actor, multiply it by
`key_value_workers` to get the total.

The two RocksDB budgets are shared by the KV store and the Raft WAL. See
[Shared RocksDB memory](/docs/storage#shared-rocksdb-memory) for how
`rocksdb_shared_memory` works and when it applies.

CamusDB charges the memtable sub-budget inside the block-cache budget rather
than adding it on top, so the sub-budget must not exceed the total. CamusDB
compares the two values after merging all layers, so overriding only one of
them can produce an inconsistent pair, such as a 100 MiB total with an
explicit 512 MiB memtable budget. Set both values together. The computed
memtable default never exceeds the total, including the flush-unit floor.

When `rocksdb_shared_memory` is on and both the KV store and the Raft WAL use
RocksDB, CamusDB tries to keep the computed memtable budget large enough for
the Raft-log flush unit, which is 192 MiB at the default WAL shard settings. If
a small container cannot fit that budget inside half of the block cache,
CamusDB keeps the smaller percentage-based value and Kommander logs a startup
warning. If that warning matters for your workload, raise both RocksDB budgets
explicitly or reduce WAL shard sizing.

## Validation errors

| Condition | Error |
|-----------|-------|
| Unknown `mode` | `InvalidConfig` |
| Unknown `memory_profile`, which is neither `prod` nor `dev` | `InvalidConfig` |
| A port outside the range 1 to 65535 | `InvalidConfig` |
| The count of `http_peers` differs from the count of `peers` | `InvalidConfig` |
| Invalid `default_isolation_level` | `InvalidConfig` |
| `range_lock_expires_ms` is too short for the effective collection interval | `InvalidConfig` |
| `transaction_finalize_retry_budget_ms` is smaller than the minimum safe retry budget | `InvalidConfig` |
| `spill_threshold_rows` is 0 or below | `InvalidConfig` |
| `spill_merge_fan_in` is 0 or below | `InvalidConfig` |
| `large_value_rewrite_batch_rows` is 0 or below, or is above half of `max_mutations_per_transaction` when that limit is enabled | `InvalidConfig` |
| `slow_query_log_threshold_ms` is below 0, or slow-query capacity settings are below 1 | `InvalidConfig` |
| A parser-cache limit is below 0, or its sweep interval is below 1 | `InvalidConfig` |
| Unknown `kahuna` key | `InvalidConfig` |
| Unknown `kahuna.storage` or `kahuna.wal_storage` | `InvalidConfig` |
| Invalid `kahuna.solarium_environment`, or negative compaction pacing/concurrency | `InvalidConfig` |
| `kahuna.start_election_timeout_ms` is at or above `kahuna.end_election_timeout_ms` | `InvalidConfig` |
| Effective `kahuna.recent_heartbeat_ms` is at or above effective `kahuna.heartbeat_interval_ms` | `InvalidConfig` |
| `kahuna.staged_base_fence_retention_ms` is 0 or below | `InvalidConfig` |
| `kahuna.persistent_revision_retention_count` or `kahuna.persistent_revision_retention_age_seconds` is below 0 | `InvalidConfig` |
| `kahuna.persistent_revision_retention_age_seconds` is nonzero but below the effective `kahuna.pitr_window_seconds` | `InvalidConfig` |
| `kahuna.wal_shard_write_buffer_size_mb` or `kahuna.wal_shard_max_bytes_for_level_base_mb` is outside 1 to 65536 | `InvalidConfig` |
| Any `kahuna.wal_shard_*` count is outside 1 to 64 | `InvalidConfig` |
| Effective `kahuna.wal_shard_max_write_buffer_number` is less than or equal to effective `kahuna.wal_shard_min_write_buffer_number_to_merge` | `InvalidConfig` |
| Effective `kahuna.wal_shard_level0_*` triggers are not strictly increasing | `InvalidConfig` |
| A range split threshold/window/imbalance setting cannot be satisfied | `InvalidConfig` |

See `CamusDB/Config/config.yml` for the inline documentation of every field.
