---
sidebar_position: 8
---

# Configuration

CamusDB reads `CamusDB/Config/config.yml` at startup. It merges the CLI flags
and the environment variables into one resolved configuration object.

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
| `data_dir` | `--data-dir` | `Data`, in the working directory of the process |
| `mode` | `--mode` | `standalone` |
| `memory_profile` | `--memory-profile` | `prod` |
| `node_name` | `--raft-nodename` | `""`. In cluster mode, the machine name. |
| `raft_node_id` | `--raft-nodeid` | `1` |
| `raft_host` | `--raft-host` | `localhost` |
| `raft_port` | `--raft-port` | `7070` |
| `initial_partitions` | `--initial-cluster-partitions` | `1` |
| `peers` | `--initial-cluster` | `[]` |
| `http_peers` | `--http-peers` | `[]` |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` |
| `http_port` | `--http-port` | `5095` |
| `https_port` | `--https-port` | `7141` |
| `https_certificate` | `--https-certificate` | `""` |
| `raft_certificate` | `--raft-certificate` | `""` |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` |
| `default_isolation_level` | (none) | `serializable` |
| `default_transaction_locking` | (none) | `pessimistic` |
| `default_transaction_priority` | (none) | `normal` |
| `transaction_admission_wait_ms` | (none) | `0`, the node default |
| `range_lock_expires_ms` | (none) | `30000` |
| `range_lock_heartbeat_interval_ms` | (none) | `10000` |
| `max_serializable_transaction_lifetime_ms` | (none) | `3600000` |
| `lock_escalation_threshold` | (none) | `50` |
| `lock_wait_deadline_ms` | (none) | `500` |
| `key_range_sharding` | (none. Use the `CAMUS_KEY_RANGE_SHARDING` variable.) | `false` |
| `stats_flush_interval_ms` | (none) | `5000` |
| `sql_parser_cache_ttl_seconds` | (none) | `300` |
| `sql_parser_cache_max_entries` | (none) | `2048` |
| `sql_parser_cache_sweep_seconds` | (none) | `60` |
| `spill_enabled` | (none) | `false` |
| `spill_threshold_rows` | (none) | `500000` |
| `spill_merge_fan_in` | (none) | `16` |
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

Four groups of settings are available in YAML only: the parser cache, the locks
and the isolation level, the spill, and the query result cache. They tune the
operation of a node. They are not startup flags for one node.

The result cache is on by default. A query opts in with a `{cache=…}` hint. Set
`query_result_cache_enabled: false` to turn the cache off completely. See
[Query Result Cache](/docs/query-result-cache) for the purpose of each setting,
and for operator guidance.

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

The error message for a rejected key lists every accepted key.

Two mechanisms evict an entry. The first mechanism is a cap on size.
`max_entries_per_actor` and `max_bytes_per_actor` bound what one actor holds in
memory. The second mechanism is a collection sweep on a timer.
`collection_interval_ms` sets the period. Each pass evicts up to
`cache_entries_to_remove` entries that are older than `cache_entry_ttl_ms`.

Three keys together govern the compaction of the Raft log:
`compact_every_operations` sets how often, `compact_number_entries` sets how many
trailing entries stay, and `max_entries_per_compaction` caps the removals of one
pass.

The storage backends are `memory`, `sqlite`, and `rocksdb`.

### Memory profile

`memory_profile`, or `--memory-profile`, selects the default of the four
cache-size settings below. It changes nothing else. It does not change the
number of workers, and it does not change durability. An application can observe
one effect only: how often a read comes from the cache instead of the disk.

| Profile | Block cache | Memtable sub-budget | Actor caches | Total |
|---------|-------------|---------------------|--------------|-------|
| `prod`, the default | 10% of RAM, from 320 MiB to 2 GiB | One quarter of the block cache, from 128 MiB to 1 GiB | 6.25% of RAM, 64 MiB or more | About 16% of RAM, or about 1.5 GiB on an 8 GiB machine |
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
computes them at startup from the available memory of the machine. It respects a
container limit. It does not use a fixed constant.

A measurement motivated this behavior. A fixed block cache of 320 MB forced a
TPC-C working set of 1.2 GB through a disk read on almost every statement. A
cache sized to the machine took the same workload from 24.5 to 119.6
transactions per second, at 8 clients.

| Key | Computed value when unset | Clamp |
|-----|---------------------|-------|
| `rocksdb_shared_memory_budget_mb` | 10% of RAM | 320 MiB to 2 GiB |
| `rocksdb_shared_memtable_budget_mb` | One quarter of the block cache | 128 MiB to 1 GiB |
| `max_bytes_per_actor` | 6.25% of RAM, and at least 64 MiB for the layer, divided by `key_value_workers` | 8 MiB to 2 GiB for each actor |
| `max_entries_per_actor` | `max_bytes_per_actor` divided by about 512 B | 10k to 4M |

The result is about 16% of RAM across the two cache layers. The total never
exceeds 4 GiB, however large the machine is.

The fractions and the ceilings are conservative for a reason. An unconfigured
node is more often a developer workstation, or a CI container that shares the
machine with a compiler and an editor. It is less often a dedicated database
server. An explicit value always wins over the computed one.

Here is the result on an 8 GiB machine with 8 cores, with none of the four keys
set. The block cache is 819 MiB. The memtable sub-budget is 204 MiB. Each of the
8 workers gets an actor cache of 64 MiB, which is 512 MiB together. The total is
about 1.5 GiB.

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
example is a total of 100 MiB against a computed memtable of 512 MiB. The node
then fails at startup with `InvalidConfig`. Set both values together.

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
| `range_lock_heartbeat_interval_ms` is at or above `range_lock_expires_ms`, when the expiry is above 0 | `InvalidConfig` |
| `spill_threshold_rows` is 0 or below | `InvalidConfig` |
| `spill_merge_fan_in` is 0 or below | `InvalidConfig` |
| Unknown `kahuna` key | `InvalidConfig` |
| Unknown `kahuna.storage` or `kahuna.wal_storage` | `InvalidConfig` |
| `kahuna.start_election_timeout_ms` is at or above `kahuna.end_election_timeout_ms` | `InvalidConfig` |

See `CamusDB/Config/config.yml` for the inline documentation of every field.
