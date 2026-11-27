---
sidebar_position: 8
---

# Configuration

The configuration of a node controls how it starts and works, for example its ports and its storage engine. The
[settings reference](/docs/settings-reference) lists all the keys.

You don't need a configuration file to start a local node. The built-in
defaults work for development and for the tutorial. Edit the configuration in
these cases:

- You prepare a node for production, for example with TLS
  and authentication.
- You set up a [cluster](/docs/cluster). Each node needs its name and its peers.
  The cluster also needs a [partition](/docs/concepts#partition) count.
- You turn on a feature that is off by default, such as
  [performance diagnostics](/docs/performance-diagnostics).
- You deploy [C# extensions](/docs/csharp-extensions).

Some settings can change while the cluster is running. See
[Runtime cluster settings](/docs/runtime-cluster-settings). To see the values
that a running node uses, run [`SHOW VARIABLES`](/docs/show-variables).

## The configuration file

At startup, CamusDB reads the first configuration file that it finds. For an
installed node, run `camusdb init` to write a starter file that you own:

```bash
camusdb init
```

The file is `~/.camusdb/config.yml` on macOS and Linux, or
`%APPDATA%\camusdb\config.yml` on Windows. To move the user configuration and
the default data directory, set `CAMUS_HOME`.

`CamusDB/Config/config.yml` in the source tree is an annotated reference. Don't keep the settings of an installed node in it. A checkout or pull can
replace it.

CamusDB merges the selected YAML file with CLI flags and environment variables
into one resolved configuration.

## Configuration discovery

CamusDB looks for a file in this order:

1. `--config <path>`
2. `CAMUS_CONFIG_PATH`
3. `./camusdb.yml`
4. `./Config/config.yml`
5. `~/.camusdb/config.yml` on macOS and Linux, or
   `%APPDATA%\camusdb\config.yml` on Windows
6. The built-in defaults

If `--config` or `CAMUS_CONFIG_PATH` names a file that doesn't exist, the node
doesn't start. It doesn't use the next location.

To see what a node resolved, run [`SHOW VARIABLES`](/docs/show-variables). The
`source` column names the layer that supplied each value.

## Precedence

The highest layer wins:

1. A CLI flag. Only the flags that you pass override YAML.
2. An environment variable. For example, `CAMUS_KEY_RANGE_SHARDING` overrides
   `key_range_sharding`. `CAMUSDB_AUTH_ENABLED` turns on authentication, and
   the authentication secrets are read from the environment only.
3. `config.yml`.
4. The built-in default, as listed in the
   [settings reference](/docs/settings-reference).

For example, if YAML has `mode: cluster`, `--mode standalone` starts the node in
standalone mode. If you don't pass the flag,
the node starts in cluster mode.

## CLI flags and YAML fields

The following keys also have a CLI flag or an environment variable:

| YAML field | CLI flag | Default |
|------------|----------|---------|
| configuration file | `--config` | The search order above. |
| `data_dir` | `--data-dir` | `~/.camusdb/data`, or `$CAMUS_HOME/data` when it is set. |
| `mode` | `--mode` | `standalone` |
| `memory_profile` | `--memory-profile` | `prod` |
| `node_name` | `--raft-nodename` | `""`. In cluster mode, the machine name. |
| `raft_node_id` | `--raft-nodeid` | `1` |
| `raft_host` | `--raft-host` | `localhost` |
| `raft_port` | `--raft-port` | `7070` |
| `initial_partitions` | `--initial-cluster-partitions` | `1` in standalone mode, `3` in cluster mode. |
| `peers` | `--initial-cluster` | `[]` |
| `http_peers` | `--http-peers` | `[]` |
| `join_existing` | `--join-existing` | `false`. Joins a running cluster with `peers` as seeds. See [Growing a cluster](/docs/growing-a-one-node-cluster). |
| `pitr_bootstrap_from` | `--pitr-bootstrap-from` | Unset. The backup id that seeds a joining node. See [Backup and restore](/docs/backup-and-restore#seed-a-joining-node-from-a-backup). |
| `pitr_bootstrap_target_time_ms` | `--pitr-bootstrap-target-time-ms` | `0`, the latest point of the chain. |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` |
| `http_port` | `--http-port` | `5095` |
| `https_port` | `--https-port` | `7141` |
| `https_certificate` | `--https-certificate` | `""` |
| `raft_certificate` | `--raft-certificate` | `""` |
| `grpc_port` | `--grpc-port` | `5096` |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` |
| `extension_assemblies` | `--extension-assemblies` | `[]`. The absolute paths of safe C# extension DLLs. |
| `unsafe_extension_assemblies` | `--unsafe-extension-assemblies` | `[]`. The absolute paths of reviewed extension DLLs. The safe-assembly checks don't apply. |
| `key_range_sharding` | The `CAMUS_KEY_RANGE_SHARDING` variable. | `false` |

The extension lists make extensions available on a node after a restart. A
superuser must also run `CREATE EXTENSION` in each database that uses them.
Deploy the same builds on all nodes. See
[C# extension deployment](/docs/csharp-extensions#deploy-extensions).

The other keys are YAML only. The [settings reference](/docs/settings-reference)
lists them.

## Inline C# functions and triggers

Inline definitions let database users create C# functions and row triggers, and
you don't deploy DLLs. Both features are off by default, and you turn them on
separately:

```yaml
inline_functions_enabled: true
inline_triggers_enabled: true
```

A change needs a restart. Use the same values on all nodes. If you turn a feature
off, new definitions aren't allowed. Existing functions can be called, and
existing triggers continue to fire. See [inline functions](/docs/csharp-extensions#inline-functions) and
[inline triggers](/docs/csharp-extensions#inline-triggers). For the budgets, see
the [settings reference](/docs/settings-reference#inline-c-functions-and-triggers).

Inline bodies are checked against an allowlist, and they execute with resource
budgets. The checks happen between framework operations. A hard limit on the
process heap is the last protection for memory. See
[Cache defaults proportional to memory](#cache-defaults-proportional-to-memory).

## HTTP/3 on the HTTPS port

The REST API can also serve HTTP/3 over QUIC. HTTP/3 is off by default. To turn
it on, set `http3_enabled: true`. The node also needs an HTTPS certificate:

```yaml
https_port: 7141
https_certificate: /etc/camusdb/api.pfx
http3_enabled: true
```

The HTTPS port then serves HTTP/3 too. A change needs a restart. HTTP/3 has the following requirements:

- **TLS.** HTTP/3 always uses TLS. This means that it applies to the HTTPS port
  only. If `https_certificate` isn't set, the node doesn't have an HTTPS port, and
  HTTP/3 isn't available. The other ports don't change.
- **UDP.** QUIC uses UDP. Open `https_port` for both UDP and TCP, in the firewall
  and in container port mappings, for example
  `-p 7141:7141/tcp -p 7141:7141/udp`.
- **A QUIC library.** Linux and macOS need `libmsquic`. Windows needs Windows 11 or
  Windows Server 2022, or later. If the library is missing, the port serves
  HTTP/1.1 and HTTP/2 only. On macOS, .NET doesn't search the Homebrew library folder.
  Start the node with `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib` in the
  environment of the node process. macOS removes `DYLD_*` variables for system
  binaries such as `nohup`.

A client that connects over TCP receives an `Alt-Svc` header on each response.
The header tells it that the same port serves HTTP/3. Browsers and other HTTP/3
clients then use HTTP/3 for later requests.

If `http3_enabled` is on, but HTTP/3 can't start, the node starts and logs a
warning with the cause. `SHOW CONNECTIONS` shows an HTTP/3 connection with the
protocol `HTTP/3`.

## gRPC listener

The client gRPC API is on by default:

```yaml
grpc_enabled: true
grpc_port: 5096
grpc_batch_max_in_flight: 64
grpc_tls_enabled: true
```

`grpc_port` is separate from the HTTP port. If `raft_certificate` is set, the
gRPC listener uses that certificate, unless `grpc_certificate` names a separate
PFX certificate. If there is no certificate, the listener uses plaintext HTTP/2. Use it for local
development and private test networks.

`grpc_tls_enabled: false` forces plaintext HTTP/2 on the client gRPC port, also
when a certificate is set. The Raft port doesn't change. Use it on a trusted
network only, or behind a proxy that terminates TLS for clients.

Use `grpc_certificate` when the Raft port and the client gRPC port serve
different trust domains. A cluster-internal certificate is often correct for
Raft, but clients need a certificate that their trust store recognizes.

`grpc_batch_max_in_flight` sets how many operations one `BatchExecute` stream
can execute at the same time before the server applies backpressure. See
[gRPC API](/docs/grpc-api).

## Cluster peer transport

In cluster mode, CamusDB uses the HTTP endpoints of the other nodes for
internal requests, for example forwarded schema changes. If those endpoints
serve HTTPS, set `peer_tls_enabled: true`:

```yaml
peer_tls_enabled: true
```

An `http_peers` entry with an explicit `https://` scheme overrides this setting
for that peer. If peer TLS is off, the shared node secret of the internal routes
is sent over plaintext HTTP. At startup, CamusDB logs warnings for cluster
configurations with plaintext traffic between nodes or to clients.

## Dashboard

The read-only operator dashboard is on by default, on the HTTP port:

```yaml
dashboard_enabled: true
dashboard_refresh_seconds: 2
```

With `dashboard_enabled: false`, the dashboard pages and endpoints return 404.
With authentication off, the dashboard is available from the same machine only.
With authentication on, it uses a session cookie, and each panel applies the
privileges of the user. See [Operator dashboard](/docs/operator-dashboard).

## Slow query log

The slow query log is off by default:

```yaml
slow_query_log_enabled: false
slow_query_log_threshold_ms: 1000
slow_query_log_max_entries: 200
slow_query_log_max_sql_length: 4096
```

Turn it on when you diagnose a node. It records slow statements in memory, and
`SHOW SLOW QUERIES` shows them. The log is local to the node, and a restart
clears it. You can turn it on at runtime. See
[Slow query log](/docs/slow-query-log).

## Statement statistics and index usage

Use [statement statistics](/docs/statement-stats) to find expensive query
shapes, and [index usage](/docs/index-usage) to find indexes that aren't used:

```yaml
statement_stats_enabled: false
statement_stats_max_shapes: 2000
index_usage_enabled: true
```

The two switches can change at runtime. A change to the shape capacity needs a
restart. Both features count in memory on each node. A restart resets
them.

## Key-range sharding and range splits

`key_range_sharding` is off by default for new clusters. A cluster records its
routing mode when it is created, and a restart can't change it for existing
data:

```yaml
key_range_sharding: false
```

When it is on, table and index key spaces can split by key range. Splits are off
until you set a threshold. Count-based splits use `range_split_threshold`.
Load-based splits use `range_split_load_threshold`, with a queue-depth gate and
an optional commit-wait gate:

```yaml
kahuna:
  range_split_threshold: 0        # default: off
  range_split_load_threshold: 0   # default: off
```

The other split and merge keys are in the
[settings reference](/docs/settings-reference#kahuna-keys). See
[Key-range sharding](/docs/key-range-sharding) and
[`SHOW RANGES`](/docs/show-ranges).

## Transaction outcome retention

Kahuna can keep the final outcome of a transaction after it finishes. CamusDB
uses these records to continue a finalize, or to diagnose an uncertain commit.
By default, a record is retained for 300000 ms (5 minutes), with at most 10000
records. For an investigation or a long fault-injection run, raise
both together:

```yaml
kahuna:
  transaction_outcome_retention_ttl_ms: 600000
  transaction_outcome_retention_max: 100000
```

`transaction_outcome_retention_ttl_ms` sets the age limit, and `0` turns off age
pruning. `transaction_outcome_retention_max` sets the maximum number of records.
If the count limit evicts records first, a large age limit doesn't help.

## Kahuna engine section

The `kahuna:` map tunes [Kahuna](/docs/concepts#kahuna), the transactional
key/value layer in each node. Through Kahuna, it also tunes
[Kommander](/docs/concepts#kommander) (the Raft library) and the storage engine.
The engine is RocksDB by default, and SQLite and
[Solarium](https://solariumdb.github.io/) are the alternatives. See
[Architecture: storage components](/docs/architecture#storage-components).

The map applies in standalone and cluster mode. An unset key uses the CamusDB
baseline for the mode. The node reads the map at startup, and a change needs a
restart. [Kahuna keys](/docs/settings-reference#kahuna-keys) lists the keys and
their defaults. An unknown key stops the node at startup, and the error message
lists the accepted keys. The commented `kahuna:` block in
`CamusDB/Config/config.yml` describes each key.

`storage_revision` names the directory under `{data_dir}/kv` that Kahuna opens.
The CamusDB baseline pins it, and the WAL revision, to the current key layout.
Don't set it to an older revision to reach older data. A server that finds an
older revision directory doesn't change it. To move data across revisions, use
a [logical dump and reimport](/docs/logical-dump-and-reimport).

Kahuna serves keys and locks through a fixed set of in-memory workers called
actors (`key_value_workers` and `locks_workers`). Each key-value actor caches
the entries that it serves, and it evicts them in two ways:

- A size limit: `max_entries_per_actor` and `max_bytes_per_actor`.
- A timed sweep: at each `collection_interval_ms`, a pass evicts up to
  `cache_entries_to_remove` entries older than `cache_entry_ttl_ms`.

Three keys control Raft log compaction. `compact_every_operations` sets how
often it happens, `compact_number_entries` sets how many recent entries stay,
and `max_entries_per_compaction` limits one pass. `compact_every_operations`
counts persisted WAL batches, and a batch can have many entries. With the
RocksDB Raft log, a pass also drops the files below the persisted compaction
floor. This means that it can free more disk than `max_entries_per_compaction`
suggests.

The storage backends are `memory`, `sqlite`, `rocksdb`, and `solarium`. RocksDB
buffers recent writes in memory (memtables), and it flushes them to sorted files
on disk (SST files). See [The RocksDB backend](/docs/storage#the-rocksdb-backend).

`kahuna.rocksdb_direct_reads` is off in the CamusDB baseline. With buffered
reads, a read that misses the RocksDB block cache can be served from the page
cache of the operating system. This helps when the same disk also handles Raft
WAL fsyncs. To read from the RocksDB block cache only, and bypass the page
cache, set it to `true`.

### Storage damage and lost log entries

With RocksDB or Solarium, a store that detects damage stops serving data. The
node gives up leadership and doesn't become a candidate, and it doesn't rewrite
the damaged files. A read that returns `CADB0837 StorageCorrupted` failed. It
didn't find "no rows". Don't retry this error as a transient conflict. See
[storage health](/docs/cluster#check-storage-health).

After a restart, `kahuna.raft_lost_acknowledged_entries_policy` controls a
replica that finds that it lost log entries that it had acknowledged:

| Value | Behavior |
| --- | --- |
| `quarantine` (default) | The replica doesn't vote or campaign until its leader repairs it. With one replica, no peer can repair it. The partition then doesn't have a leader, and a Critical log entry is written. |
| `accept_and_log` | Logs the loss, and continues. This turns off the protection. It doesn't restore entries. With one replica, the loss is permanent. |

A change of the policy needs a restart. It is separate from the repair of
damaged storage, or a restore from a [backup](/docs/backup-and-restore).

Solarium also stops service and raises a fault when it detects corruption.
SQLite doesn't have page checksums, and its WAL replay can stop at a damaged
frame. Its Raft metadata uses `synchronous=NORMAL`, whatever `wal_sync_writes`
is. Note that a healthy endpoint doesn't verify each stored byte.

### Solarium storage engine

[Solarium](https://solariumdb.github.io/) is a managed key/value engine. It can store
the KV state and the Raft WAL. It doesn't need a native library. CamusDB includes its providers, and you don't need an extension DLL:

```yaml
kahuna:
  storage: solarium
  wal_storage: solarium
  solarium_environment: default
```

All nodes must use the same `storage` and `wal_storage`. Solarium and RocksDB
files aren't compatible. To change engines, use a
[logical dump and reimport](/docs/logical-dump-and-reimport). PITR bootstrap with
`pitr_bootstrap_from` needs RocksDB for both layers.

`solarium_environment` selects the file I/O of both Solarium layers. `default`
is the portable environment. `io_uring` needs a Linux kernel that can create a
ring, and otherwise the node doesn't start. RocksDB tuning and WAL shard settings
don't apply to Solarium, except the two shared budget keys below.

#### Cache and memtable budgets {#managed-memory-budgets}

Solarium stores memtable entries and cached data blocks in native memory. Index
and filter partitions, about 2% of the table bytes, are managed memory. This
means that the shared cache and memtable budgets are outside the GC heap limit,
but they count toward the total memory of the node or container.

`rocksdb_shared_memory_budget_mb` and `rocksdb_shared_memtable_budget_mb` set
the shared cache and memtable budgets of Solarium. Positive budgets are shared,
whatever `rocksdb_shared_memory` is. That switch applies to RocksDB only.
Unset `prod` budgets come from the machine or container memory, as for RocksDB.
Explicit values win.

The startup log shows these budgets as native. Leave room for them next to the
managed heap. [Node stats](/docs/node-stats) shows `gc_memory_limit_bytes`.

The flush unit of the Solarium WAL, with headroom, is 256 MiB. The computed
memtable budget tries to cover it, but it stops at half the shared cache. With
10% cache sizing, the unit fits from about 5 GiB of machine memory. A smaller
node can log warnings about forced WAL flushes. To prevent them, set both
budgets explicitly.

#### Flush and compaction pacing

For RocksDB and Solarium, `storage_compaction_rate_mbps` limits the flush and
compaction writes of the KV store, in decimal MB/s. Zero or unset doesn't limit
them. `storage_max_background_compactions` sets the number of parallel
compactions, and zero or unset uses the engine default. Both are nonnegative,
and a change needs a restart.

Solarium does one compaction at a time by default, and it isn't paced. A rate
also allows max(2, CPUs / 2) compactions, unless you set the concurrency. RocksDB
uses max(2, CPUs / 2) by default. Choose the pacing for the disk and the
workload. With too little bandwidth, pending compactions accumulate. Then writes can slow
down.

### One-phase apply-time validation

`kahuna.one_phase_apply_time_validation` is on by default. It lets an eligible
read-modify-write transaction commit in one durable Raft round. The transaction
must have one participant partition, with its anchor on that partition, and a
read set that can be validated there. Transactions across partitions use
two-phase commit.

`kahuna.staged_base_fence_retention_ms` (default `600000`) sets how far back the
validation fence remembers transactionally written keys. You should set it above
the longest transaction lifetime that you allow. Otherwise, a long transaction can return an error. Its validation base can be
older than the window.

Treat the setting as a switch for the full cluster:

- Give all nodes the same values for both keys.
- During a rolling upgrade across Kahuna versions, set
  `one_phase_apply_time_validation: false` until all nodes support the check.
- If you start a data directory or snapshot that is older than the
  committed-head ledger, start once with the setting off, and let a checkpoint
  happen. Then remove the override and restart.

### Log entries per commit

Kahuna.Core 1.19.0 adds two startup settings that can reduce the number of
Raft log entries written for durable transactions. Both default to `false`.

- `kahuna.durable_merge_adjacent_settles` combines adjacent operations that
  apply committed writes into one log entry. The merged entry uses the
  existing settlement format and needs no special upgrade order.
- `kahuna.durable_one_phase_bundle_entry` writes the record, prepare, and
  decision of a one-phase commit in one entry. Before enabling it on any
  node, upgrade all nodes to builds with Kahuna.Core 1.19.0 or later. Keep
  those builds on nodes that join or replay a log containing bundle entries.

You can turn either setting off. Turning off the bundle setting changes
future writes. Nodes still need a compatible build to read entries already
in the log.

### Persistent MVCC revision retention

Kahuna stores several versions of each row. Then readers see a consistent
snapshot ([MVCC](/docs/concepts#mvcc)). Each version is stored in the key/value
layer. This means that, if history isn't pruned, the history and the disk use of a busy
table grow for the life of the store.

When both retention keys are unset, history is retained by age, aligned with
the point-in-time recovery window (`kahuna.pitr_window_seconds`, default
`3600`). Restores in the window stay valid, and older revisions can be
reclaimed. Snapshot reads older than the retention age aren't guaranteed. A
branch pins the snapshot that it forked from, and reclamation respects the pin.

- `kahuna.persistent_revision_retention_age_seconds` sets an explicit age limit.
  It must be at least the PITR window, and `0` turns off age pruning.
- `kahuna.persistent_revision_retention_count` sets a limit of revisions for
  each key. The default `0` turns it off. A count limit can remove history in the
  PITR window on busy keys. You should prefer the age limit.

### Write aggregation

Kahuna groups key/value writes into Raft batches before replication. By
default, a dedicated timer thread wakes the batch at its deadline. A batch can
also be dispatched sooner when it reaches the size learned from recent load.

| Key | Default | Effect |
| --- | --- | --- |
| `kahuna.key_value_write_max_in_flight_batches_per_partition` | `1` | The batches of a partition that can wait on Raft at the same time. Change it only after an A/B test on your workload. |
| `kahuna.key_value_write_linger_ms` | `0` standalone, `1` cluster | How long the oldest queued write can wait, while no batch is in flight, before a batch is sent. |
| `kahuna.key_value_write_max_batch_items` | `512` | The maximum items in one batch. |
| `kahuna.key_value_write_post_completion_hold_ms` | `0` standalone, `1` cluster | How long the aggregator waits after a batch completes before it sends the next one. |
| `kahuna.key_value_write_precise_wake` | `true` | Uses a dedicated timer thread for the aggregator wakeups. It can wake closer to the deadline. |
| `kahuna.key_value_write_fill_target_trigger` | `true` | Sends a buffer as soon as it reaches the learned fill target, and doesn't always wait for the timer. |

Standalone mode dispatches a batch as soon as the partition is ready. A node
short of CPU at high concurrency can set both delays to `1` ms to accumulate
larger batches at the cost of added latency. A one-node cluster uses the
cluster defaults. Explicit settings override the defaults in either mode.

### Garbage collection and write batching

The shipped server disables .NET's dynamic garbage collection adaptation.
This helps a busy leader avoid frequent small collections when the write
aggregator cycles quickly. The default can increase idle managed memory use.

If you set `DOTNET_GCDynamicAdaptationMode=1` with server GC and short write
batching cycles, the server logs a startup warning. To run with adaptation
enabled, set `kahuna.key_value_write_precise_wake: false` and keep
`kahuna.key_value_write_post_completion_hold_ms` at 1 or higher.

### Raft WAL shard column families

Eight `kahuna.wal_shard_*` keys override the RocksDB column-family settings of
the Raft log. CamusDB leaves them unset by default, and the Kommander defaults
apply. They apply when `kahuna.wal_storage` is `rocksdb`.

| Key | Kommander default | Meaning |
|-----|-------------------|---------|
| `wal_shard_write_buffer_size_mb` | `64` | The size of one shard memtable. |
| `wal_shard_min_write_buffer_number_to_merge` | `2` | The immutable memtables merged into one flush. |
| `wal_shard_max_write_buffer_number` | `4` | The memtables of a shard. Must be above the merge count. |
| `wal_shard_level0_file_num_compaction_trigger` | `8` | The L0 files that start a compaction. |
| `wal_shard_level0_slowdown_writes_trigger` | `28` | The L0 files at which writes slow down. |
| `wal_shard_level0_stop_writes_trigger` | `44` | The L0 files at which writes stop. |
| `wal_shard_max_bytes_for_level_base_mb` | RocksDB's `256` | The base-level size for leveled compaction. |
| `wal_shard_universal_compaction` | `false` | Uses universal compaction, and not leveled compaction. |

Larger flush units can reduce write amplification in the Raft log. However,
they also increase memory pressure and replay work at restart. With universal compaction, `wal_shard_max_bytes_for_level_base_mb` is ignored.

### Memory profile

`memory_profile` (or `--memory-profile`) selects the defaults of the four cache
sizes below. It doesn't change the worker counts or durability. An application
can see the profile only in how often a read comes from cache.

| Profile | Block cache | Memtable sub-budget | Actor caches | Total |
|---------|-------------|---------------------|--------------|-------|
| `prod` (default) | 10% of machine memory, up to 2 GiB | A quarter of the block cache, raised to the Raft-log flush unit when possible, up to 1 GiB | Caps based on 6.25% of the managed heap budget. See [cache sizing](#cache-defaults-proportional-to-memory). | Depends on the engine and the heap limit. |
| `dev` | 64 MiB | 16 MiB | 32 MiB | About 96 MiB, on any machine. |

Use `dev` for a node that shares a developer machine with your application. Its
budgets are fixed. This means that the node has the same size on a 64 GiB
workstation and in a 2 GiB container. When the working set is larger than the
cache, `dev` costs throughput. See the TPC-C measurement under
[Cache defaults proportional to memory](#cache-defaults-proportional-to-memory).
Don't use `dev` on a server.

An explicit `kahuna.*` budget always overrides the profile. You can combine
`dev` with one larger budget.

The caches are limits, and they fill as they are used. A burst of large writes
can push the resident memory far above the cache total. Transient managed
allocations and the .NET garbage collector cause most of that peak. The server
garbage collector is the default, with one heap for each core.
`DOTNET_gcServer=0` changes that part of the memory use. It is a runtime
setting, and not a CamusDB setting.

`CAMUS_THREADPOOL_MIN_THREADS` overrides the minimum of .NET worker threads.
The default is `1024` worker threads, and `512` completion-port threads. Use it
for load tests or diagnostics, when runtime metrics show queued work in the
thread pool. It is an environment variable, read when the process starts.

### Cache defaults proportional to memory

With `memory_profile: prod`, most unset keys keep the Kahuna default. The four
cache sizes are different. If you don't set them, CamusDB computes them at
startup from the memory of the node. Two memory sizes are used:

- Machine memory sizes the block cache and the memtable budget. It is the container cgroup limit if one is set.
  Otherwise, it is the physical RAM.
- The managed heap budget sizes the actor caches. It is the limit of the GC: an explicit hard limit, the default of the runtime in a container
  (normally 75% of the container limit), or the machine memory.

RocksDB and Solarium keep these storage budgets in native memory, outside a .NET
heap hard limit, but they count toward the container limit. Leave room for both
when you set `DOTNET_GCHeapHardLimit` or a similar runtime limit.

A measurement led to this behavior. With a fixed 320 MB block cache, a 1.2 GB
TPC-C working set needed a disk read for almost each statement. When the cache
was sized to the machine, the same workload went from 24.5 to 119.6
transactions per second, with 8 clients.

| Key | Computed value when unset | Limits |
|-----|---------------------|-------|
| `rocksdb_shared_memory_budget_mb` | 10% of machine memory. | 64 MiB to 2 GiB. The 320 MiB minimum doesn't apply on small nodes. |
| `rocksdb_shared_memtable_budget_mb` | A quarter of the block cache, raised to the Raft-log flush unit when possible. | 16 MiB to 1 GiB. The 128 MiB minimum doesn't apply on small nodes. |
| `max_bytes_per_actor` | One share of the actor-cache budget, or up to four shares with a managed heap budget of at least 2 GiB. | 1 MiB to 2 GiB per actor. |
| `max_entries_per_actor` | `max_bytes_per_actor` divided by about 512 B. | 2k to 4M. The 10k minimum doesn't apply on small nodes. |

The actor-cache budget is 6.25% of the managed heap budget, with a minimum of
64 MiB. One share is that budget divided by `key_value_workers`. At a heap
budget of 2 GiB or more, each actor can use four shares, up to the actor-cache
budget. This gives busy actors more room. Four shares per actor allow a
combined cap of up to four times the budget before the per-actor limits in
the table apply.

For example, with an 8 GiB managed heap and 32 workers, the actor-cache budget
is 512 MiB. Each worker can cache up to 64 MiB, for a combined cap of 2 GiB.
To size the cap for your workload, set `max_bytes_per_actor` and
`max_entries_per_actor` explicitly.

The KV store and the Raft WAL share the two RocksDB budgets. See
[Shared RocksDB memory](/docs/storage#shared-rocksdb-memory).

The memtable sub-budget is charged to the block cache budget, and it must
not be larger. The two values are compared after all layers are merged. This
means that an override of one of them can give an invalid pair, such as a
100 MiB total with an explicit 512 MiB memtable budget. Set both values
together. The computed memtable default isn't above the total.

When `rocksdb_shared_memory` is on, and both the KV store and the Raft WAL use
RocksDB, CamusDB tries to keep the computed memtable budget large enough for the
Raft-log flush unit. The unit is 192 MiB with the default WAL shard settings. If
a small container can't fit that budget in half of the block cache, CamusDB uses
the smaller value, and Kommander logs a warning at startup. To fix it, raise both
RocksDB budgets explicitly, or reduce the WAL shard sizes.

## Validation errors

The following conditions stop the node at startup with `InvalidConfig`:

| Condition |
|-----------|
| An unknown `mode`, or a `memory_profile` that isn't `prod` or `dev`. |
| A port outside the range 1 to 65535. |
| A different number of `http_peers` and `peers`. |
| An invalid `default_isolation_level`. |
| A `range_lock_expires_ms` that is too short for the collection interval. |
| A `transaction_finalize_retry_budget_ms` below the minimum safe budget. |
| A `spill_threshold_rows` or `spill_merge_fan_in` of 0 or less. |
| A `large_value_rewrite_batch_rows` of 0 or less, or above half of `max_mutations_per_transaction` when that limit is on. |
| A `slow_query_log_threshold_ms` below 0, or a slow query capacity below 1. |
| A parser-cache limit below 0, or a sweep interval below 1. |
| An unknown `kahuna` key, or an unknown `kahuna.storage` or `kahuna.wal_storage`. |
| An invalid `kahuna.raft_lost_acknowledged_entries_policy` (the values are `quarantine` and `accept_and_log`). |
| An invalid `kahuna.solarium_environment`, or negative compaction pacing or concurrency. |
| A `kahuna.start_election_timeout_ms` at or above `kahuna.end_election_timeout_ms`. |
| An effective `kahuna.recent_heartbeat_ms` at or above the effective `kahuna.heartbeat_interval_ms`. |
| A `kahuna.staged_base_fence_retention_ms` of 0 or less. |
| A negative `kahuna.persistent_revision_retention_count` or `kahuna.persistent_revision_retention_age_seconds`. |
| A `kahuna.persistent_revision_retention_age_seconds` above zero, but below the effective `kahuna.pitr_window_seconds`. |
| A `kahuna.wal_shard_write_buffer_size_mb` or `kahuna.wal_shard_max_bytes_for_level_base_mb` outside 1 to 65536. |
| A `kahuna.wal_shard_*` count outside 1 to 64. |
| An effective `kahuna.wal_shard_max_write_buffer_number` at or below the effective `kahuna.wal_shard_min_write_buffer_number_to_merge`. |
| Effective `kahuna.wal_shard_level0_*` triggers that don't strictly increase. |
| A range split setting that can't be satisfied, such as a window. |

For the inline documentation of each field, see `CamusDB/Config/config.yml`.
