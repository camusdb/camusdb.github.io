---
sidebar_position: 8
---

# Configuration

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

Run [`SHOW VARIABLES`](/docs/show-variables) against a node to see what that node
resolved. The output names the layer that supplied each value. Do not
reconstruct the merge by hand.

## Precedence

The highest layer wins:

1. A CLI flag. Only a flag that you pass explicitly overrides YAML. The options
   are nullable, and they have no sentinel defaults.
2. An environment variable. At present `CAMUS_KEY_RANGE_SHARDING` overrides
   `key_range_sharding`.
3. `config.yml`.
4. A built-in default, in `ConfigDefinition` or in `CamusDBConfig`.

Here is an example. YAML holds `mode: cluster`. The node starts in standalone
mode if you pass `--mode standalone`. The node stays in cluster mode if you pass
no `--mode` flag.

## Map of CLI flags to YAML fields

| YAML field | CLI flag | Default |
|------------|----------|---------|
| configuration file | `--config` | Search order described above |
| `data_dir` | `--data-dir` | `$CAMUS_HOME/data`, `$XDG_DATA_HOME/camusdb`, `~/.local/share/camusdb`, or `%LOCALAPPDATA%\camusdb` |
| `mode` | `--mode` | `standalone` |
| `memory_profile` | `--memory-profile` | `prod` |
| `node_name` | `--raft-nodename` | `""`. In cluster mode, the machine name. |
| `raft_node_id` | `--raft-nodeid` | `1` |
| `raft_host` | `--raft-host` | `localhost` |
| `raft_port` | `--raft-port` | `7070` |
| `initial_partitions` | `--initial-cluster-partitions` | `1` |
| `peers` | `--initial-cluster` | `[]` |
| `http_peers` | `--http-peers` | `[]` |
| `join_existing` | `--join-existing` | `false` |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `-1` |
| `schema_freshness_check_interval_ms` | (none) | `10000` |
| `http_port` | `--http-port` | `5095` |
| `https_port` | `--https-port` | `7141` |
| `https_certificate` | `--https-certificate` | `""` |
| `raft_certificate` | `--raft-certificate` | `""` |
| `grpc_certificate` | (none) | `""`. Falls back to `raft_certificate`. |
| `peer_tls_enabled` | (none) | `false` |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` |
| `login_max_attempts_per_source_per_minute` | (none) | `200` |
| `session_reaper_interval_ms` | (none) | `300000` |
| `grpc_enabled` | (none) | `true` |
| `grpc_port` | (none) | `5096` |
| `grpc_batch_max_in_flight` | (none) | `64` |
| `dashboard_enabled` | (none) | `true` |
| `dashboard_refresh_seconds` | (none) | `2` |
| `default_isolation_level` | (none) | `serializable` |
| `default_transaction_locking` | (none) | `pessimistic` |
| `default_transaction_priority` | (none) | `normal` |
| `transaction_admission_wait_ms` | (none) | `0`, the node default |
| `range_lock_expires_ms` | (none) | `150000` |
| `max_serializable_transaction_lifetime_ms` | (none) | `3600000` |
| `transaction_finalize_retry_budget_ms` | (none) | `15000` |
| `sequence_retry_budget_ms` | (none) | `10000` |
| `transaction_idle_timeout_ms` | (none) | `300000` |
| `transaction_reaper_interval_ms` | (none) | `30000` |
| `lock_escalation_threshold` | (none) | `50` |
| `lock_wait_deadline_ms` | (none) | `500` |
| `key_range_sharding` | (none. Use the `CAMUS_KEY_RANGE_SHARDING` variable.) | `false` |
| `engine_metrics_enabled` | (none) | `true` |
| `slow_query_log_enabled` | (none) | `false` |
| `slow_query_log_threshold_ms` | (none) | `1000` |
| `slow_query_log_max_entries` | (none) | `200` |
| `slow_query_log_max_sql_length` | (none) | `4096` |
| `stats_flush_interval_ms` | (none) | `5000` |
| `stats_analyze_sample_rows` | (none) | `100000` |
| `stats_histogram_buckets` | (none) | `100` |
| `cost_based_access_path_enabled` | (none) | `true` |
| `cost_based_join_order_enabled` | (none) | `true` |
| `plan_cache_enabled` | (none) | `false` |
| `plan_cache_max_entries` | (none) | `512` |
| `bound_query_cache_enabled` | (none) | `true` |
| `sql_routing_advice_enabled` | (none) | `true` |
| `sql_routing_advice_ttl_ms` | (none) | `5000` |
| `sql_parser_cache_ttl_seconds` | (none) | `300` |
| `sql_parser_cache_max_entries` | (none) | `2048` |
| `sql_parser_cache_sweep_seconds` | (none) | `60` |
| `regex_match_timeout_ms` | (none) | `250` |
| `regex_cache_max_entries` | (none) | `1024` |
| `spill_enabled` | (none) | `false` |
| `spill_threshold_rows` | (none) | `500000` |
| `spill_merge_fan_in` | (none) | `16` |
| `min_free_disk_bytes` | (none) | `67108864` |
| `query_result_cache_enabled` | (none) | `true` |
| `query_result_cache_default_ttl_ms` | (none) | `5000` |
| `query_result_cache_max_entries` | (none) | `1024` |
| `query_result_cache_max_bytes` | (none) | `67108864` |
| `query_result_cache_max_entry_bytes` | (none) | `1048576` |
| `query_result_cache_max_entry_rows` | (none) | `10000` |
| `query_result_cache_max_deps` | (none) | `4096` |
| `query_result_cache_max_point_deps` | (none) | `2048` |
| `query_result_cache_max_ranges` | (none) | `256` |
| `query_result_cache_singleflight_wait_ms` | (none) | `250` |
| `query_result_cache_strict_validation_max_keys` | (none) | `10000` |
| `query_result_cache_sweep_interval_ms` | (none) | `10000` |
| `kahuna.*` | (none) | A baseline for the mode |

Most tuning settings are YAML only. They tune the operation of a node or a
cluster after startup options have selected where the node runs.

The result cache is on by default. A query opts in with a `{cache=…}` hint. Set
`query_result_cache_enabled: false` to turn the cache off completely. See
[Query Result Cache](/docs/query-result-cache) for the purpose of each setting,
and for operator guidance.

SQL routing advice is on by default, but clients see it only when they opt in on
the request. `sql_routing_advice_ttl_ms` controls the maximum age that a client
may reuse an advertised route. See [SQL Routing Advice](/docs/sql-routing-advice).

## gRPC listener

The client-facing gRPC API is enabled by default:

```yaml
grpc_enabled: true
grpc_port: 5096
grpc_batch_max_in_flight: 64
```

`grpc_port` is separate from the HTTP API port. When `raft_certificate` is set,
CamusDB reuses that certificate for the gRPC listener unless
`grpc_certificate` names a separate PFX certificate. Otherwise the listener
uses plaintext HTTP/2, which is suitable for local development and trusted
private test networks.

Use `grpc_certificate` when the Raft port and the client-facing gRPC port serve
different trust domains. A cluster-internal certificate is often right for Raft,
while clients need a certificate that their own trust store accepts.

`grpc_batch_max_in_flight` bounds how many operations one `BatchExecute` stream
can have executing at the same time before the server applies backpressure.

See [gRPC API](/docs/grpc-api).

## Cluster peer transport

In cluster mode, CamusDB uses peer HTTP endpoints for schema-DDL forwarding,
cluster-settings forwarding, and query-fragment exchange. Set
`peer_tls_enabled: true` when those peer HTTP endpoints serve HTTPS:

```yaml
peer_tls_enabled: true
```

An `http_peers` entry with an explicit `https://` scheme overrides this default
for that peer. Without peer TLS, the shared node secret used by internal routes
travels over plaintext peer HTTP. CamusDB logs startup warnings for exposed
cluster configurations that leave peer HTTP, Raft gRPC, or client-facing gRPC
traffic in plaintext.

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
a bounded in-memory ring and exposes them with `SHOW SLOW QUERIES`. The log is
node-local and does not survive restart.

See [Slow Query Log](/docs/slow-query-log).

## Key-range sharding and range splits

`key_range_sharding` is off by default and restart-scoped:

```yaml
key_range_sharding: false
```

When enabled, eligible table and index key spaces can split by key range instead
of staying on one hash-routed partition. Automatic splitting is controlled by
the nested `kahuna:` settings:

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

Both split branches are disabled unless a threshold asks for them. The count
branch uses `range_split_threshold`; the load branch uses
`range_split_load_threshold` with queue-depth and optional commit-wait gates.

See [Key-Range Sharding](/docs/key-range-sharding) and
[`SHOW RANGES`](/docs/show-ranges).

## Transaction outcome retention

Kahuna can retain terminal transaction outcome records after a transaction
finishes. CamusDB uses those records when a finalize path needs to resume or
diagnose an uncertain commit outcome:

```yaml
kahuna:
  transaction_outcome_retention_ttl_ms: 600000
  transaction_outcome_retention_max: 100000
```

`transaction_outcome_retention_ttl_ms` controls the age window. `0` disables
age pruning and leaves only the size cap. `transaction_outcome_retention_max`
controls the maximum number of retained records. Raise both together for an
investigation or a long fault-injection run; a large TTL is ineffective if the
count cap evicts records first.

## The Kahuna engine section

The nested `kahuna:` map passes values through to `EmbeddedKahunaOptions`. Only
allow-listed keys pass. CamusDB uses the map for the cluster node, in
`Program.cs`, and for a standalone per-database node, in `DatabaseOpener`. An
unset key keeps the CamusDB baseline for that mode. An unknown key fails the
validation at startup.

The authoritative allow-list is `KahunaOptionsConfig.AllowedYamlKeys`. The
`kahuna:` block in `CamusDB/Config/config.yml` is commented out, and it
documents the meaning of each key. The keys cover these areas:

- The storage backend and the WAL backend.
- The transaction timeouts and the admission control.
- The number of workers and the number of I/O threads.
- The Raft election times and heartbeat times.
- The cache settings and the eviction settings described below.
- The shared memory of RocksDB.
- The backup settings and the point-in-time recovery settings.
- The write aggregation, Raft WAL shard sizing, and MVCC revision retention
  settings described below.

The error message for a rejected key lists every accepted key.

`storage_revision` names the directory that Kahuna opens under
`{data_dir}/kv`. The current CamusDB baseline pins it, together with the WAL
revision, to the current key layout. Do not set it to an older revision to reach
older data. A server that finds an older revision directory leaves it untouched;
move data across revisions with a [logical dump and reimport](/docs/logical-dump-and-reimport).

Two mechanisms evict an entry. The first mechanism is a cap on size.
`max_entries_per_actor` and `max_bytes_per_actor` bound what one actor holds in
memory. The second mechanism is a collection sweep on a timer.
`collection_interval_ms` sets the period. Each pass evicts up to
`cache_entries_to_remove` entries that are older than `cache_entry_ttl_ms`.

Three keys together govern the compaction of the Raft log:
`compact_every_operations` sets how often, `compact_number_entries` sets how many
trailing entries stay, and `max_entries_per_compaction` caps the removals of one
pass.

`compact_every_operations` counts persisted WAL batches, not individual log
entries. A busy batch can contain many entries, so this setting is a compaction
cadence rather than a direct row count. In current Kahuna releases,
`max_entries_per_compaction` limits how many entries a pass tombstones; whole-file
reclaim below the persisted compaction floor can still remove more storage than
that cap implies.

The storage backends are `memory`, `sqlite`, and `rocksdb`.

`kahuna.rocksdb_direct_reads` is off in CamusDB's baseline. With the default
buffered reads, SST misses can be served by the operating system page cache,
which helps when the same disk is also handling Raft WAL fsyncs. Set it to
`true` when you need RocksDB reads to bypass the page cache and rely on the
RocksDB block cache alone.

### One-phase apply-time validation

`kahuna.one_phase_apply_time_validation` is on by default. When it is on, an
eligible read-modify-write transaction can commit in one durable Raft round
instead of the normal two-phase path. The transaction must have one participant
partition, its anchor on that partition, and a read set that can be validated
there. Cross-partition transactions still use two-phase commit.

`kahuna.staged_base_fence_retention_ms`, default `600000`, is the horizon that
the validation fence and committed-head ledger remember for transactionally
written keys. Set it above the longest transaction lifetime that the deployment
allows, or long transactions can be refused because their validation base fell
out of the retained window.

Use the setting as a cluster-wide operational switch:

- Give every node the same values for both keys.
- During a rolling upgrade across Kahuna versions, set
  `one_phase_apply_time_validation: false` until every node runs a version that
  supports the apply-time check.
- When starting a data directory or snapshot that predates the committed-head
  ledger, start once with it off and let a checkpoint run. After that checkpoint
  rewrites the ledger, remove the override and restart.

### Persistent MVCC revision retention

Every version of every row is stored physically in the key-value layer. Without
pruning, a hot table's retained history and disk usage grow for the life of the
store.

When both retention keys are unset, CamusDB keeps persisted history by age,
aligned with the effective point-in-time recovery window
(`kahuna.pitr_window_seconds`, default `3600`). That keeps in-window restores
valid while allowing older revision rows to be reclaimed. Snapshot reads older
than the retention age are not guaranteed. Branch forks pin their own snapshot
floors, and reclamation honors those pins while they remain protected.

- `kahuna.persistent_revision_retention_age_seconds` sets an explicit age bound.
  It must be at least the effective PITR window. `0` disables age pruning.
- `kahuna.persistent_revision_retention_count` sets a hard per-key revision cap.
  The default `0` disables the count cap. A count cap can trim history below the
  PITR window on hot keys, so prefer the age bound unless a per-key cap is the
  goal.

### Write aggregation

Kahuna groups key-value writes into Raft batches before replication:

- `kahuna.key_value_write_max_in_flight_batches_per_partition`, default `1`,
  controls how many write batches a partition may have waiting on Raft at once.
  Higher values pipeline batches, but should be changed only after an A/B test on
  the workload you are tuning.
- `kahuna.key_value_write_linger_ms`, default `1`, is how long the oldest queued
  write may wait before a batch is dispatched while nothing is in flight.
- `kahuna.key_value_write_max_batch_items`, default `512`, caps the number of
  items in one write batch.
- `kahuna.key_value_write_post_completion_hold_ms`, default `2`, waits after a
  batch completes before dispatching the next one. CamusDB ships a nonzero
  default to increase batch density at full occupancy. Set it to `0` to restore
  Kahuna's dispatch-at-once behavior.

These settings affect write latency and throughput. Record them with benchmark
results; runs with different batching settings are not directly comparable.

### Raft WAL shard column families

Eight `kahuna.wal_shard_*` keys override the RocksDB column-family settings used
for the Raft log. CamusDB leaves all of them unset by default, which lets
Kommander's measured defaults apply field by field. They take effect only when
`kahuna.wal_storage` is `rocksdb`.

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
`wal_shard_max_bytes_for_level_base_mb` has no effect because RocksDB does not
consult level sizing under universal compaction.

### Memory profile

`memory_profile`, or `--memory-profile`, selects the default of the four
cache-size settings below. It changes nothing else. It does not change the
number of workers, and it does not change durability. An application can observe
one effect only: how often a read comes from the cache instead of the disk.

| Profile | Block cache | Memtable sub-budget | Actor caches | Total |
|---------|-------------|---------------------|--------------|-------|
| `prod`, the default | 10% of machine memory, up to 2 GiB | One quarter of the block cache, raised to the Raft-log flush unit when possible, up to 1 GiB | 6.25% of the managed heap budget, 64 MiB or more | About 16% of memory, or about 1.5 GiB on an 8 GiB machine |
| `dev` | 64 MiB | 16 MiB | 32 MiB | About 96 MiB, on any machine |

Use `dev` for a node that shares a developer machine with the application under
construction. The budgets are fixed. The node is therefore the same size on a
64 GiB workstation and in a 2 GiB container.

The cost of `dev` is throughput, once the working set becomes larger than the
cache. The TPC-C run that motivated proportional sizes was about 5 times slower
against a 320 MiB block cache. `dev` is therefore not a server setting.

The caches are ceilings, and CamusDB fills them lazily. A burst of large writes
can still push the resident memory of the process far above the cache total.
Transient managed allocations and the .NET garbage collector dominate that peak.
The server garbage collector is the default, and it uses one heap per core.
`DOTNET_gcServer=0` in the environment is the control for that half of the
memory footprint. It is a runtime setting, not a CamusDB setting.

An explicit `kahuna.*` budget always beats the profile. `dev` together with one
raised budget is therefore a valid combination. It is not a conflict.

### Cache defaults proportional to memory

Under `memory_profile: prod`, most unset keys keep the Kahuna default. The four
cache-size settings are the exception. When you leave them unset, CamusDB
computes them at startup from the node's memory rather than from a fixed
constant.

Two memory sizes feed the computation:

- Machine memory sizes the RocksDB block cache and memtable budget. It is the
  container cgroup limit when one is set, otherwise physical RAM.
- Managed heap budget sizes the actor caches. It is the .NET GC heap hard limit
  when one is set, otherwise the same machine-memory value.

RocksDB uses native memory, so its budgets sit outside a .NET heap hard limit and
still count against the container. Leave room for both when you set
`DOTNET_GCHeapHardLimit`, `DOTNET_GCHeapHardLimitPercent`, or related runtime
limits.

A measurement motivated this behavior. A fixed block cache of 320 MB forced a
TPC-C working set of 1.2 GB through a disk read on almost every statement. A
cache sized to the machine took the same workload from 24.5 to 119.6
transactions per second, at 8 clients.

| Key | Computed value when unset | Clamp |
|-----|---------------------|-------|
| `rocksdb_shared_memory_budget_mb` | 10% of machine memory | 64 MiB to 2 GiB; the 320 MiB floor yields on small nodes |
| `rocksdb_shared_memtable_budget_mb` | One quarter of the block cache, raised to the Raft-log flush unit when possible | 16 MiB to 1 GiB; the 128 MiB floor yields on small nodes |
| `max_bytes_per_actor` | 6.25% of the managed heap budget, and at least 64 MiB for the layer, divided by `key_value_workers` | 1 MiB to 2 GiB for each actor; the 8 MiB floor yields on small nodes |
| `max_entries_per_actor` | `max_bytes_per_actor` divided by about 512 B | 2k to 4M; the 10k floor yields on small nodes |

The result is about 16% of memory across the two cache layers. The total never
exceeds 4 GiB, however large the machine is.

When `rocksdb_shared_memory` is on and both the KV store and the Raft WAL use
RocksDB, CamusDB tries to keep the computed memtable budget large enough for the
Raft-log flush unit. At the default WAL shard settings that unit is 192 MiB. If a
small container cannot fit that budget inside half of the block cache, CamusDB
keeps the smaller percentage-based value and Kommander logs a startup warning.
Raise both RocksDB budgets explicitly or reduce WAL shard sizing if that warning
matters for the workload.

The fractions and the ceilings are conservative for a reason. An unconfigured
node is more often a developer workstation, or a CI container that shares the
machine with a compiler and an editor. It is less often a dedicated database
server. An explicit value always wins over the computed one.

Here is the result on an 8 GiB machine with 8 cores, no heap limit, and none of
the four keys set. The block cache is 819 MiB. The memtable sub-budget is 204
MiB. Each of the 8 workers gets an actor cache of 64 MiB, which is 512 MiB
together. The total is about 1.5 GiB.

Raise all four values explicitly on a dedicated server. The sizes above are a
floor to build from. They are not a recommendation for a machine whose only job
is CamusDB.

The share of 6.25%, and its floor of 64 MiB, bound the actor-cache layer as a
whole. CamusDB then divides that budget by `key_value_workers`. Only the minimum
of 8 MiB applies to one actor. More cores therefore divide the same budget into
more parts. They do not make the budget larger. A machine with many cores and
little RAM therefore does not receive a multiple of the intended share.

The RocksDB pair of budgets is shared. `rocksdb_shared_memory` is on by default.
It has no effect unless `storage` and `wal_storage` are both `rocksdb`. It makes
one block cache and one write-buffer manager serve both the KV store and the
Raft WAL.

CamusDB charges the memtable sub-budget inside the total block-cache budget. It
does not add the sub-budget to the total. The sub-budget must not exceed the
total. CamusDB compares the two values after the merge of all layers. An
override of only one of the two can therefore produce an inconsistent pair. One
example is a total of 100 MiB against an explicit memtable budget of 512 MiB. The
computed memtable default never exceeds the total, including the flush-unit
floor. Set both values together.

`max_bytes_per_actor` applies to one actor. Multiply it by `key_value_workers`
to get the total. The default is one worker for each CPU.

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
| `slow_query_log_threshold_ms` is below 0, or slow-query capacity settings are below 1 | `InvalidConfig` |
| `dashboard_refresh_seconds` is outside the accepted range | `InvalidConfig` |
| Unknown `kahuna` key | `InvalidConfig` |
| Unknown `kahuna.storage` or `kahuna.wal_storage` | `InvalidConfig` |
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
