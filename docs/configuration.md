---
sidebar_position: 8
---

# Configuration

The configuration of a node controls how that node starts and runs: its ports,
its data directory, standalone or cluster mode, TLS, the storage engine, the
caches, and the background jobs. This page is the reference for every key.

You do not need a configuration file to start a local node. The built-in
defaults work for development and for the tutorial. Edit the configuration in
these cases:

- You prepare a node for production, for example with a data directory on a
  dedicated disk, TLS, and authentication.
- You set up a [cluster](/docs/cluster). Each node needs its name, its peers,
  and the [partition](/docs/concepts#partition) count.
- You turn on a feature that is off by default, such as
  [spill to disk](/docs/spill-to-disk) or
  [performance diagnostics](/docs/performance-diagnostics).
- You deploy [C# extensions](/docs/csharp-extensions) that add scalar functions,
  triggers, or procedures to a node.

Some settings can change while the cluster runs, with no restart. See
[Runtime cluster settings](/docs/runtime-cluster-settings). To see the values
that a running node uses, run [`SHOW VARIABLES`](/docs/show-variables).

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

Run [`SHOW VARIABLES`](/docs/show-variables) against a node to see what that node
resolved. The output names the layer that supplied each value. Do not
reconstruct the merge by hand.

## Precedence

The highest layer wins:

1. A CLI flag. Only a flag that you pass explicitly overrides YAML. The options
   are nullable, and they have no sentinel defaults.
2. An environment variable. `CAMUS_KEY_RANGE_SHARDING` overrides
   `key_range_sharding`. Authentication is switched on with
   `CAMUSDB_AUTH_ENABLED`, and its secrets are read only from the environment.
3. `config.yml`.
4. The built-in default, listed in the [settings reference](#settings-reference).

Here is an example. YAML holds `mode: cluster`. The node starts in standalone
mode if you pass `--mode standalone`. The node stays in cluster mode if you pass
no `--mode` flag.

## Map of CLI flags to YAML fields

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
| `join_existing` | `--join-existing` | `false` |
| `pitr_bootstrap_from` | `--pitr-bootstrap-from` | Unset. Backup id used to seed a joining node; see [Backup and restore](/docs/backup-and-restore#seed-a-joining-node-from-a-backup). |
| `pitr_bootstrap_target_time_ms` | `--pitr-bootstrap-target-time-ms` | `0`, the latest point covered by the chain. |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` |
| `http_port` | `--http-port` | `5095` |
| `https_port` | `--https-port` | `7141` |
| `https_certificate` | `--https-certificate` | `""` |
| `raft_certificate` | `--raft-certificate` | `""` |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` |
| `extension_assemblies` | `--extension-assemblies` | `[]`. Absolute paths of safe C# extension DLLs. |
| `unsafe_extension_assemblies` | `--unsafe-extension-assemblies` | `[]`. Absolute paths of reviewed extension DLLs loaded without safe-assembly checks. |
| `key_range_sharding` | (none. Use the `CAMUS_KEY_RANGE_SHARDING` variable.) | `false` |

Every other key is YAML only. The [settings reference](#settings-reference)
lists all of them.

## HTTP/3 on the HTTPS port

The REST API can also serve HTTP/3 over QUIC. HTTP/3 is off by default. To turn
it on, set `http3_enabled: true` and give the node an HTTPS certificate:

```yaml
https_port: 7141
https_certificate: /etc/camusdb/api.pfx
http3_enabled: true
```

The HTTPS port then serves HTTP/1.1, HTTP/2, and HTTP/3. The setting takes
effect when the node starts. A change needs a restart.

HTTP/3 has these requirements:

- **TLS.** HTTP/3 always uses TLS, so the setting applies to the HTTPS port
  only. Without `https_certificate`, the node has no HTTPS port and the setting
  has no effect. The plain HTTP port, the [Raft](/docs/concepts#raft) port
  (node-to-node cluster traffic), and the gRPC port do not change.
- **UDP.** QUIC uses UDP. Open `https_port` for UDP and for TCP. This includes
  the firewall and any container port mapping, for example
  `-p 7141:7141/tcp -p 7141:7141/udp`.
- **A QUIC library.** Linux and macOS need `libmsquic`. Windows needs Windows 11
  or Windows Server 2022, or a later version. Without the library, the port
  serves HTTP/1.1 and HTTP/2 only. On macOS, .NET does not search the Homebrew
  library folder by default; start the node with
  `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`. macOS removes `DYLD_*`
  variables for system binaries such as `nohup`, so set the variable in the
  environment of the node process itself.

A client that connects over TCP receives an `Alt-Svc` header on each response.
This header tells the client that the same port serves HTTP/3. Browsers and
other clients that support HTTP/3 then use it for the next requests.

If `http3_enabled` is on but HTTP/3 cannot start, the node still starts. It logs
a warning that names the cause: no `https_certificate`, or no QUIC library.
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
is configured. This does not change the Raft port. Use it only on a trusted network or behind a proxy
that terminates TLS for clients.

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
node-local and does not survive restart. If the node started with the log off,
turning it on needs a restart.

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

## Settings reference

The tables below list every top-level key. The nested sections have their own
tables: [All kahuna keys](#all-kahuna-keys) and
[The diagnostics section](#the-diagnostics-section).

The **Change** column says when a new value takes effect:

- **runtime**: you can change the value with
  [`SET CLUSTER SETTING`](/docs/runtime-cluster-settings), and the next
  statement or background pass uses it.
- **restart**: edit `config.yml` and restart the node. `SET CLUSTER SETTING`
  rejects the key. Six keys are an exception: it accepts them, but the node
  applies the new value only after a restart. Their rows and notes say so.

The **Scope** column says whether nodes must agree:

- **cluster**: every node must use the same value. A runtime change reaches every
  node.
- **node**: nodes may use different values, set in each node's `config.yml`. A
  `SET CLUSTER SETTING` value still applies to every node and overrides the file.

Sizes are in bytes and durations in milliseconds unless the key name says
otherwise (`_seconds`, `_mb`).

### Node identity and cluster membership

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `data_dir` | `~/.camusdb/data`, or `$CAMUS_HOME/data` | path | restart | node | Where the node stores its data. |
| `mode` | `standalone` | `standalone` or `cluster` | restart | node | Runs one node, or a node of a Raft [cluster](/docs/cluster). |
| `memory_profile` | `prod` | `prod` or `dev` | restart | node | Sizes the storage caches that you leave unset. See [Memory profile](#memory-profile). |
| `node_name` | `""`, then the machine name in cluster mode | string | restart | node | Name of this cluster node. |
| `raft_node_id` | `1` | int | restart | node | Numeric Raft node id. Must be above `0`. |
| `raft_host` | `localhost` | string | restart | node | Host name of this node's Raft endpoint. |
| `raft_port` | `7070` | port | restart | node | Port for node-to-node Raft traffic. |
| `initial_partitions` | `1` standalone, `3` cluster | int | restart | cluster | Raft data partitions that a new cluster starts with. Standalone mode always uses `1`. Must be at least `1`. |
| `peers` | `[]` | list of `host:port` | restart | node | Raft endpoints of the other nodes, or the seed nodes when `join_existing` is on. |
| `http_peers` | `[]` | list of `host:port` | restart | node | HTTP address of each peer, in the same order as `peers`. The two lists must have the same length. |
| `join_existing` | `false` | bool | restart | node | Joins a running cluster as a new member, with `peers` as the seed list. Cluster mode only. |
| `pitr_bootstrap_from` | unset | backup id | restart | node | Seeds a joining node from this backup before it joins. Needs `join_existing` and `kahuna.backup_dir`. See [Backup and restore](/docs/backup-and-restore#seed-a-joining-node-from-a-backup). |
| `pitr_bootstrap_target_time_ms` | `0` | Unix time, ms | restart | node | Point in time to seed to. `0` is the latest point that the chain covers. Needs `pitr_bootstrap_from`. |
| `schema_ack_wait_timeout_ms` | `30000` | ms | restart | node | How long a DDL statement waits for every live node to acknowledge the previous schema version. See [Distributed schema](/docs/distributed-schema). |
| `schema_ack_live_node_lease_ms` | `30000` | ms | restart | node | How long after the last contact a node still counts as live for that wait. `-1` always waits for every configured node. |
| `schema_freshness_check_interval_ms` | `10000` | ms | restart | node | How often a cluster node compares each open database's schema with its durable checkpoint, and reloads it when it is behind. |
| `unhosted_control_log_probe_interval_ms` | `250` | ms | restart | node | How often a node probes the checkpoint of a control log (schema or cluster settings) whose Raft partition it does not host. This matters when `kahuna.replication_factor` is below the node count. `0` or less turns the probe off. |
| `registry_generation_lease_ms` | `250` | ms | restart | cluster | How long a cluster node trusts its cached database names. `DROP DATABASE` and `RENAME DATABASE` wait out one lease before they return. `0` checks on every lookup. Ignored in standalone mode. |
| `database_idle_eviction_ms` | `900000` | ms | restart | node | How long an unused database stays open on this node before the node frees its memory. `0` or less keeps it open. |
| `extension_assemblies` | `[]` | list of paths | restart | node | [C# extension](/docs/csharp-extensions) DLLs loaded with the safe-assembly checks. |
| `unsafe_extension_assemblies` | `[]` | list of paths | restart | node | Reviewed extension DLLs loaded without the safe-assembly checks. |

### Network, TLS, and client protocols

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `http_port` | `5095` | port | restart | node | Port of the [HTTP API](/docs/http-api). |
| `https_port` | `7141` | port | restart | node | HTTPS port. It opens only when `https_certificate` is set. |
| `https_certificate` | `""` | path | restart | node | PFX certificate for the HTTPS port. Empty means no HTTPS. |
| `http3_enabled` | `false` | bool | restart | node | Also serves HTTP/3 on the HTTPS port. See [HTTP/3](#http3-on-the-https-port). |
| `grpc_enabled` | `true` | bool | restart | node | Opens the client-facing [gRPC API](/docs/grpc-api). |
| `grpc_port` | `5096` | port | restart | node | Port of the gRPC API. |
| `grpc_certificate` | `""` | path | restart | node | PFX certificate for the gRPC port. Empty falls back to `raft_certificate`. |
| `grpc_tls_enabled` | `true` | bool | restart | node | `false` serves gRPC as plaintext h2c even when a certificate is set. |
| `grpc_batch_max_in_flight` | `64` | int | runtime | node | Operations one `BatchExecute` stream may run at once before backpressure. |
| `raft_certificate` | `""` | path | restart | node | PFX certificate for the Raft port in cluster mode. |
| `raft_mutual_tls_enabled` | `false` | bool | restart | node | Cluster mode: each peer must present a client certificate that chains to `raft_peer_ca`. Needs `raft_certificate` and `raft_peer_ca`. |
| `raft_peer_ca` | `""` | path | restart | node | PEM file with the CA that peer certificates must chain to. Use a CA that signs only this cluster's nodes, because the node accepts every certificate it signed. |
| `peer_tls_enabled` | `false` | bool | restart | node | Reaches peer HTTP endpoints over HTTPS. See [Cluster peer transport](#cluster-peer-transport). |
| `require_tls_when_auth_enabled` | `true` | bool | runtime | node | With authentication on, refuses credentials sent over plaintext, except from loopback. |
| `sql_routing_advice_enabled` | `true` | bool | restart | node | Adds [routing advice](/docs/sql-routing-advice) to responses for clients that ask for it. |
| `sql_routing_advice_ttl_ms` | `5000` | ms | restart | node | Maximum age at which a client may reuse an advertised route. `1` to `600000`. |

### Authentication and sessions

Authentication is turned on with `CAMUSDB_AUTH_ENABLED`, and its secrets come
only from the environment. See [SQL authentication](/docs/sql-authentication).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `password_hash_iterations` | `600000` | int | restart | cluster | PBKDF2-HMAC-SHA256 iterations for new password hashes. Existing hashes keep their stored count. |
| `login_kdf_max_concurrency` | `8` | int | restart | node | Password checks that may run at once. Others queue. |
| `login_max_attempts_per_minute` | `20` | int | restart | node | Login attempts per account and source address in a rolling minute. |
| `login_max_attempts_per_source_per_minute` | `200` | int | restart | node | Login attempts per source address in a rolling minute, across all accounts. |
| `login_rate_limit_max_entries` | `100000` | int | restart | node | Keys that each login rate limiter tracks. When the per-source map is full, logins fail. When the per-account map is full, it stops adding keys and the per-source limit still applies. |
| `access_token_ttl` | `900000` | ms | restart | cluster | Absolute lifetime of an access token. |
| `authentication_cache_ttl` | `1000` | ms | restart | node | How long a node trusts a cached token or privilege check. `0` checks the catalog on every request. |
| `authentication_cache_max_entries` | `10000` | int | restart | node | Size limit of the per-node authentication cache. |
| `session_reaper_interval_ms` | `300000` | ms | restart | node | How often expired session records are deleted. `0` or less turns the sweep off. |
| `expired_session_retention_ms` | `300000` | ms | restart | cluster | How long a session record is kept after it expires, so a long-lived stream can tell expiry from revocation. |

### Transactions and locking

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `default_isolation_level` | `serializable` | `serializable` or `read_committed` | runtime | cluster | Isolation level of a transaction that does not set one. See [Serializable transactions](/docs/serializable-transactions). |
| `default_transaction_locking` | `pessimistic` | `pessimistic` or `optimistic` | runtime | cluster | Locking mode of a transaction that does not set one. |
| `default_read_validation` | `none` | `none` or `track_and_validate` | runtime | cluster | Read-set validation of a transaction that does not set one. See [Transactions and locking internals](/docs/transactions-locking-internals). |
| `default_decision_durability` | `best_effort` | `best_effort` or `durable` | runtime | cluster | Commit-decision durability of a transaction that does not set one. See [Transactions and locking internals](/docs/transactions-locking-internals). |
| `default_transaction_priority` | `normal` | `background`, `low`, `normal`, `high`, `critical` | runtime | cluster | Priority of a transaction that does not set one. Only the admission gate uses it, and the gate is off while `kahuna.max_concurrent_sessions` is `0`. See [Transaction priority](/docs/transaction-priority). |
| `transaction_admission_wait_ms` | `0` | ms | runtime | cluster | How long a transaction queues at the admission gate before it is refused. `0` uses `kahuna.default_admission_wait_ms`. |
| `range_lock_expires_ms` | `150000` | ms | runtime | cluster | Initial lease of a range lock. The coordinator renews it while the transaction lives. Must be at least twice `kahuna.collection_interval_ms`. `0` or less turns expiry off. |
| `max_serializable_transaction_lifetime_ms` | `3600000` | ms | runtime | cluster | Longest time a serializable transaction may run. |
| `transaction_finalize_retry_budget_ms` | `15000` | ms | runtime | cluster | How long `COMMIT` or `ROLLBACK` retries while the outcome is not known yet. At least `2000`, or `0` or less to turn retries off. |
| `sequence_retry_budget_ms` | `10000` | ms | runtime | cluster | How long a call to an internal id counter (database id, table id) retries while storage asks for a retry. |
| `transaction_idle_timeout_ms` | `300000` | ms | restart | cluster | An explicit transaction idle this long is rolled back and its locks are released. `0` or less turns the idle check off. See [Transaction limits](/docs/transaction-limits). `SET CLUSTER SETTING` accepts a new value, but the node reads it only at startup. |
| `transaction_reaper_interval_ms` | `30000` | ms | restart | node | How often the reaper looks for idle transactions. `SET CLUSTER SETTING` accepts a new value, but the node reads it only at startup. |
| `abandoned_transaction_release_after_ms` | `0` | ms | runtime | cluster | Age after which a rollback of a transaction that the coordinator no longer knows releases its leftover locks and staged writes. `0` derives it: the larger of `kahuna.max_transaction_timeout_ms` and `max_serializable_transaction_lifetime_ms`, plus 30 seconds. A negative value turns the release off. A positive value must be at least `max_serializable_transaction_lifetime_ms`. |
| `lock_escalation_threshold` | `50` | int | runtime | cluster | Shared point locks per table or index bucket before a serializable read-write transaction takes one shared lock on the whole bucket. |
| `lock_wait_deadline_ms` | `500` | ms | runtime | cluster | Longest time one lock-acquire retry loop waits during a serializable conflict. |
| `max_mutations_per_transaction` | `20000` | int | runtime | cluster | Row and index-entry writes one transaction may make. `0` or less turns the limit off. |
| `key_range_sharding` | `false` | bool | restart | cluster | Routes eligible tables and indexes by key range instead of by hash. See [Key-range sharding](#key-range-sharding-and-range-splits). |

### Prepared statements

See [Prepared statements](/docs/prepared-statements).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `prepared_statement_idle_timeout_ms` | `600000` | ms | runtime | node | A REST prepared statement unused this long is dropped. `0` keeps it until it is closed. |
| `prepared_statement_sweep_interval_ms` | `60000` | ms | runtime | node | How often the REST prepared-statement sweep runs. |
| `max_prepared_statement_bytes` | `65536` | bytes | runtime | node | Largest statement text that may be prepared, on either transport. `0` means no limit. |
| `rest_max_prepared_statements` | `8192` | int | runtime | node | REST prepared statements this node holds, across all principals. `0` means no limit. |
| `rest_max_prepared_statements_per_principal` | `512` | int | runtime | node | REST prepared statements one principal may hold. `0` means no limit. |
| `rest_max_prepared_statement_bytes` | `67108864` | bytes | runtime | node | Total REST prepared-statement text this node holds. `0` means no limit. |
| `rest_max_prepared_statement_bytes_per_principal` | `8388608` | bytes | runtime | node | REST prepared-statement text one principal may hold. `0` means no limit. |
| `grpc_max_prepared_statements_per_stream` | `512` | int | runtime | node | Prepared statements one gRPC `BatchExecute` stream may hold. `0` means no limit. |
| `grpc_max_prepared_statement_bytes_per_stream` | `8388608` | bytes | runtime | node | Prepared-statement text one gRPC stream may hold. `0` means no limit. |

### Query planning and statistics

See [Query planning](/docs/query-planning) and
[`SHOW STATISTICS`](/docs/show-statistics).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `cost_based_access_path_enabled` | `true` | bool | runtime | cluster | Chooses between indexes and a full scan by cost, for analyzed tables. |
| `cost_based_join_order_enabled` | `true` | bool | runtime | cluster | Chooses the join order by cost. |
| `net_weight` | `0.01` | double | runtime | cluster | Planner cost of each byte read from another node. `0` turns network costing off. |
| `stats_flush_interval_ms` | `5000` | ms | runtime | cluster | Shortest interval between writes of a table's in-memory statistics to storage. `0` writes after each change. `-1` turns the background write off. |
| `stats_analyze_sample_rows` | `100000` | rows | runtime | cluster | Rows a manual `ANALYZE` reads, the first ones in storage order. `0` reads all rows. |
| `stats_histogram_buckets` | `100` | int | runtime | cluster | Histogram buckets per column. Must be at least `1`. |
| `stats_top_values` | `100` | int | runtime | cluster | Most common values kept per column. `0` keeps none. |
| `stats_analyze_max_columns` | `32` | int | runtime | cluster | Columns per table that `ANALYZE` collects. The leading column of each index is always collected. |
| `stats_plan_time_lookup_max_rows` | `2000` | rows | runtime | node | Largest small table whose filtered rows the join planner reads while it plans. `0` turns the lookup off. |
| `plan_cache_enabled` | `false` | bool | runtime | node | Caches access-path and join-order decisions per query shape. |
| `plan_cache_max_entries` | `512` | int | runtime | node | Size limit of the plan cache. |
| `bound_query_cache_enabled` | `true` | bool | runtime | node | Reuses the name resolution of a cached `SELECT` text across executions. |

### Automatic ANALYZE

See [Automatic ANALYZE](/docs/automatic-analyze).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `auto_analyze_enabled` | `true` | bool | runtime | cluster | Refreshes statistics in the background. |
| `auto_analyze_check_interval_ms` | `60000` | ms | runtime | cluster | How often the leader looks for stale tables. `0` or less turns the loop off. |
| `auto_analyze_fraction_stale_rows` | `0.20` | double | runtime | cluster | A table is stale once its changes since the last `ANALYZE` reach this fraction of its rows, plus `auto_analyze_min_stale_rows`. |
| `auto_analyze_min_stale_rows` | `500` | rows | runtime | cluster | Minimum changes before a table can be stale. |
| `auto_analyze_max_concurrent` | `1` | int | runtime | node | Background analyses that run at once on this node. |
| `auto_analyze_max_rows_per_second` | `50000` | rows/s | runtime | cluster | Scan rate limit. `0` or less removes the limit. |
| `auto_analyze_histogram_sample_rows` | `10000` | rows | runtime | cluster | Sample size per column for background histograms. |
| `auto_analyze_hll_precision` | `11` | int | runtime | cluster | Precision of the distinct-count sketch. `4` to `16`. |
| `auto_analyze_load_pause_threshold` | `16` | transactions | runtime | node | Pauses background analysis while more foreground transactions than this are running. `0` or less turns the pause off. |
| `auto_analyze_ownership_check_rows` | `1000` | rows | runtime | cluster | Rows scanned between checks for lost leadership and foreground load. |

### Query execution

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `max_query_parallelism` | `1` | int | runtime | node | Workers one full table scan may use. `1` scans sequentially. More workers use more memory and do not change results or row order. |
| `index_scan_fetch_batch_size` | `64` | rows | runtime | node | Row ids a non-covering index scan collects before it fetches the rows in one batch. |
| `distributed_query_execution` | `false` | bool | restart | cluster | Splits eligible scans of key-range-sharded tables into per-range fragments. See [Distributed queries](/docs/distributed-queries). |
| `broadcast_join_max_build_rows` | `10000` | rows | runtime | node | Largest hash-join build side that may be sent to remote fragments. `0` turns broadcast joins off. |
| `hash_join_max_build_rows` | `1000000` | rows | runtime | node | When spill is off, a hash-join build larger than this falls back to a nested-loop join. |
| `regex_match_timeout_ms` | `250` | ms | runtime | node | Time limit of one [regex](/docs/functions-regex) match. |
| `slot_backed_decode` | `true` | bool | runtime | node | Internal row-decode mode. Keep the default. |
| `borrowed_decode` | `adaptive` | `adaptive`, `force_eager`, `force_borrowed` | runtime | node | Internal zero-copy decode policy. Keep the default. |

### Spill to disk

See [Spill to disk](/docs/spill-to-disk).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `spill_enabled` | `false` | bool | runtime | node | Lets sorts, joins, and aggregations write to temporary files when they grow too large. |
| `spill_threshold_rows` | `500000` | rows | runtime | node | Rows one operator keeps in memory before it spills. Must be above `0`. |
| `spill_threshold_bytes` | `268435456` | bytes | runtime | node | Bytes one operator keeps in memory before it spills. The operator spills at whichever limit it reaches first. |
| `spill_merge_fan_in` | `16` | int | runtime | node | Spill files merged in one pass. Must be above `0`. |
| `spill_max_frame_bytes` | `268435456` | bytes | runtime | node | Largest record that a spill file may declare. A larger length is treated as corruption. |
| `spill_max_total_bytes` | `8589934592` | bytes | runtime | node | Total size of all spill files on this node. A statement that would exceed it fails. |

### Caches

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `sql_parser_cache_ttl_seconds` | `300` | seconds | runtime | node | How long a parsed statement stays cached after its last use. `0` turns the cache off. |
| `sql_parser_cache_max_entries` | `2048` | int | runtime | node | Size limit of the parser cache. `0` means no limit. |
| `sql_parser_cache_sweep_seconds` | `60` | seconds | runtime | node | How often expired parser-cache entries are removed. Must be above `0`. |
| `sql_parser_cache_max_bytes` | `67108864` | bytes | runtime | node | Approximate memory limit of the parser cache. `0` means no limit. |
| `regex_cache_max_entries` | `1024` | int | runtime | node | Compiled regex patterns kept in memory. `0` turns caching off. |
| `point_read_row_id_cache_enabled` | `true` | bool | restart | node | Remembers which row a primary key points to, so a repeated point lookup needs one storage read instead of two. |
| `point_read_row_id_cache_max_entries` | `1000000` | int | restart | node | Remembered keys per table. The cache is cleared when it is full. |

### Query result cache

The result cache is on by default. A query opts in with a `{cache=…}` hint. Set
`query_result_cache_enabled: false` to turn the cache off completely. See
[Query result cache](/docs/query-result-cache) for the purpose of each setting
and for operator guidance.

`SET CLUSTER SETTING` accepts new values for `query_result_cache_default_ttl_ms`,
`query_result_cache_max_entries`, `query_result_cache_max_bytes`, and
`query_result_cache_sweep_interval_ms`, but the running cache keeps the values it
started with. Restart the node to apply them.

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `query_result_cache_enabled` | `true` | bool | restart | node | Turns the result cache on or off. |
| `query_result_cache_default_ttl_ms` | `5000` | ms | restart | node | Lifetime of an entry whose hint sets no TTL. |
| `query_result_cache_max_entries` | `1024` | int | restart | node | Entries the cache holds. |
| `query_result_cache_max_bytes` | `67108864` | bytes | restart | node | Total size of all entries. |
| `query_result_cache_max_entry_bytes` | `1048576` | bytes | runtime | node | A larger result is not cached. |
| `query_result_cache_max_entry_rows` | `10000` | rows | runtime | node | A result with more rows is not cached. |
| `query_result_cache_max_deps` | `4096` | int | runtime | node | Dependencies of one entry. |
| `query_result_cache_max_point_deps` | `2048` | int | runtime | node | Point-key dependencies of one entry. |
| `query_result_cache_max_ranges` | `256` | int | runtime | node | Range dependencies of one entry. |
| `query_result_cache_singleflight_wait_ms` | `250` | ms | runtime | node | How long a query waits for an identical query in flight before it runs on its own. |
| `query_result_cache_strict_validation_max_keys` | `10000` | int | runtime | node | Keys that strict validation checks before it recomputes the entry. |
| `query_result_cache_sweep_interval_ms` | `10000` | ms | restart | node | How often expired entries are removed. |

### Schema limits

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `max_identifier_length` | `64` | UTF-16 units | runtime | cluster | Longest name of a new database, table, column, or index. Existing names still load. |
| `max_columns_per_table` | `512` | int | runtime | cluster | Columns per table. |
| `max_indexes_per_table` | `64` | int | runtime | cluster | Secondary indexes per table. |
| `max_tables_per_database` | `10000` | int | runtime | cluster | Tables per database. |
| `max_index_columns` | `32` | int | runtime | cluster | Key and `INCLUDE` columns of one index. See [Indexes](/docs/sql-indexes). |
| `max_index_include_tuple_bytes` | `4096` | bytes | runtime | cluster | Encoded size of the `INCLUDE` values in one index entry. A larger row is rejected. |
| `max_view_expansion_depth` | `32` | int | runtime | cluster | Nesting depth of [views](/docs/views) over views. |

For the first six keys, `0` or less turns the limit off.

### Large values and disk space

The `large_value_*` settings control compression, out-of-line storage, and
rewrite batching for large `STRING`, `BYTES`/`BLOB`, and `ARRAY` values. See
[Large values](/docs/storage-layout).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `large_value_threshold_bytes` | `2048` | bytes | runtime | cluster | Stored size at which a value moves out of its row, when the column's storage strategy allows it. |
| `large_value_compression_enabled` | `true` | bool | runtime | cluster | Lets the writer compress values of 256 bytes or more. Reads work either way. |
| `large_value_compression_min_saving_percent` | `12` | percent | runtime | cluster | A compressed value that saves less is stored raw. |
| `large_value_rewrite_batch_rows` | `200` | rows | runtime | cluster | Rows per transaction for `ALTER TABLE ... REWRITE STORAGE`. At most half of `max_mutations_per_transaction`. |
| `large_value_resolve_batch_bytes` | `67108864` | bytes | runtime | node | Decoded size of compressed and out-of-line values that one read resolves at a time. |
| `min_free_disk_bytes` | `67108864` | bytes | runtime | node | New DML writes fail with `CADB0536` when the data volume has less free space. Reads, DDL, and rollbacks still work. `0` or less turns the check off. |

### Row-level TTL

See [Row-level TTL](/docs/row-level-ttl). The `ttl_default_*` keys apply to a
table that does not set its own value.

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `ttl_enabled` | `true` | bool | runtime | cluster | Runs the expired-row sweep. Only tables with a TTL expression take part. |
| `ttl_default_job_cron` | `@daily` | `@hourly`, `@daily`, `@weekly`, `@monthly` | runtime | cluster | How often a table's sweep runs. |
| `ttl_default_select_batch_size` | `500` | rows | runtime | cluster | Rows read per batch while looking for expired rows. |
| `ttl_default_delete_batch_size` | `100` | rows | runtime | cluster | Rows deleted per transaction. |
| `ttl_default_select_rate_limit` | `0` | rows/s | runtime | cluster | Read rate limit. `0` means no limit. |
| `ttl_default_delete_rate_limit` | `100` | rows/s | runtime | cluster | Delete rate limit. `0` means no limit. |
| `ttl_spans_per_table` | `64` | int | runtime | cluster | Spans a table is divided into for each run. |
| `ttl_max_concurrent_spans_per_node` | `1` | int | runtime | node | Spans one node processes at once. |
| `ttl_load_pause_threshold` | `16` | transactions | runtime | node | Pauses the sweep while more foreground transactions than this are running. `0` or less turns the pause off. |
| `ttl_span_lease_ms` | `30000` | ms | runtime | cluster | Lease on a claimed span. Another node takes over a span whose lease lapses. |
| `ttl_span_lease_renew_interval_ms` | `10000` | ms | runtime | cluster | How often the owner renews its span lease. Must be below `ttl_span_lease_ms`. |

### Materialized views, branches, and dropped objects

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `materialized_view_refresh_enabled` | `true` | bool | runtime | node | Lets this node run [materialized view](/docs/materialized-views) refreshes. Reads and DDL work either way. |
| `materialized_view_refresh_chunk_rows` | `10000` | rows | runtime | cluster | Rows a refresh writes per transaction. At most half of `max_mutations_per_transaction`. |
| `materialized_view_refresh_takeover_attempts` | `3` | int | runtime | cluster | Restarts of an interrupted refresh before it gives up. The view then keeps its previous contents. |
| `branch_snapshot_hold_lease_ms` | `300000` | ms | runtime | cluster | Lease on the history a [branch](/docs/database-branching) pins on its parent. It is renewed while the branch exists. At least `5000`. |
| `snapshot_hold_retry_budget_ms` | `10000` | ms | runtime | cluster | How long a statement that needs a snapshot hold, such as creating a branch, retries during a leader election. `0` or less tries once. |
| `orphan_retention_ms` | `604800000` | ms | runtime | cluster | How long a dropped database or table stays [recoverable](/docs/recover-dropped-objects). `0` or less turns automatic reclaim off. |
| `orphan_reclaim_interval_ms` | `300000` | ms | runtime | cluster | How often one elected node reclaims expired dropped objects. `0` or less turns the sweep off. |
| `fence_lease_ms` | `30000` | ms | runtime | cluster | Lease on the lock that `DROP`, `RELINK`, and the reclaim sweep take on a database or table. A crashed holder frees it after the lease. |
| `fence_lease_renew_interval_ms` | `10000` | ms | runtime | cluster | How often the holder renews that lease. Must be below `fence_lease_ms`. |
| `keyspace_purge_batch_size` | `512` | keys | runtime | node | Keys `DROP DATABASE` deletes per batch. |

### Observability and the dashboard

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `engine_metrics_enabled` | `true` | bool | restart | node | Collects storage-engine metrics for [`SHOW ENGINE STATS`](/docs/engine-stats). |
| `slow_query_log_enabled` | `false` | bool | runtime | node | Records slow statements. See [Slow query log](#slow-query-log). Turning it on needs a restart if the node started with it off. |
| `slow_query_log_threshold_ms` | `1000` | ms | runtime | node | Statements at least this slow are recorded. `0` records every statement. |
| `slow_query_log_max_entries` | `200` | int | restart | node | Entries the log keeps. |
| `slow_query_log_max_sql_length` | `4096` | characters | runtime | node | SQL text stored per entry. |
| `query_activity_enabled` | `true` | bool | runtime | node | Lists running statements for [`SHOW QUERIES`](/docs/query-activity) and `CANCEL QUERY`. |
| `query_activity_max_sql_length` | `1024` | characters | runtime | node | SQL text shown per `SHOW QUERIES` row. |
| `cluster_activity_peer_timeout_ms` | `2000` | ms | runtime | node | How long `SHOW CLUSTER QUERIES`, `SHOW CLUSTER CONNECTIONS`, and a forwarded `CANCEL QUERY` wait for each peer. |
| `dashboard_enabled` | `true` | bool | restart | node | Serves the [operator dashboard](/docs/operator-dashboard). |
| `dashboard_refresh_seconds` | `2` | seconds | runtime | node | Refresh interval of the dashboard load panel. The server clamps it to `1` to `300`. |
| `query_tracing_enabled` | `false` | bool | runtime | node | Logs one line per executed plan step. |
| `lock_tracing_enabled` | `false` | bool | runtime | node | Logs one line per lock acquired. |

## The Kahuna engine section

The nested `kahuna:` map tunes [Kahuna](/docs/concepts#kahuna), the
transactional key/value layer embedded in each node, and through it
[Kommander](/docs/concepts#kommander) (the Raft library) and RocksDB (the
on-disk engine). See
[Architecture: storage components](/docs/architecture#storage-components) for
their roles. CamusDB applies the map in both standalone and cluster mode. An unset key keeps
the CamusDB baseline for that mode. The node reads the map once at startup, so a
change needs a restart.

[All kahuna keys](#all-kahuna-keys) lists every accepted key with its default.
An unknown key fails validation at startup, and the error message lists every
accepted key. The `kahuna:` block in `CamusDB/Config/config.yml` is commented
out, and it documents each key inline.

`storage_revision` names the directory that Kahuna opens under
`{data_dir}/kv`. The current CamusDB baseline pins it, together with the WAL
revision, to the current key layout. Do not set it to an older revision to reach
older data. A server that finds an older revision directory leaves it untouched;
move data across revisions with a [logical dump and reimport](/docs/logical-dump-and-reimport).

Kahuna serves keys and locks through a fixed set of in-memory workers called
actors (`key_value_workers` and `locks_workers`). Each key-value actor caches
the entries it serves. Two mechanisms evict a cached entry. The first mechanism
is a cap on size. `max_entries_per_actor` and `max_bytes_per_actor` bound what
one actor holds in memory. The second mechanism is a collection sweep on a timer.
`collection_interval_ms` sets the period. Each pass evicts up to
`cache_entries_to_remove` entries that are older than `cache_entry_ttl_ms`.

Three keys together govern the compaction of the Raft log:
`compact_every_operations` sets how often, `compact_number_entries` sets how many
trailing entries stay, and `max_entries_per_compaction` caps the removals of one
pass.

`compact_every_operations` counts persisted WAL batches, not individual log
entries. A busy batch can contain many entries, so this setting is a compaction
cadence rather than a direct row count. `max_entries_per_compaction` limits how
many entries one pass deletes. With the RocksDB Raft log, a pass also drops whole
files that lie below the persisted compaction floor, so it can free more disk
than that cap suggests. This holds for the Kahuna 1.12.8 release that CamusDB
ships with.

The storage backends are `memory`, `sqlite`, and `rocksdb`.

RocksDB buffers recent writes in memory, in memtables, and flushes them to
sorted files on disk, called SST files. See
[The RocksDB backend](/docs/storage#the-rocksdb-backend).

`kahuna.rocksdb_direct_reads` is off in CamusDB's baseline. With the default
buffered reads, a read that misses the RocksDB block cache and goes to an SST
file can be served by the operating system page cache,
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

Kahuna keeps several versions of each row, so a reader can see a consistent
snapshot ([MVCC](/docs/concepts#mvcc)). Every version of every row is stored
physically in the key-value layer. Without
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
- `kahuna.key_value_write_post_completion_hold_ms`, default `1`, waits after a
  batch completes before dispatching the next one. CamusDB ships a nonzero
  default to increase batch density at full occupancy. Set it to `0` to restore
  Kahuna's dispatch-at-once behavior.
- `kahuna.key_value_write_precise_wake`, default `false`, moves the write
  aggregator's hold, linger, and queue-age wakeups onto a dedicated timer thread.
  Use it when you are testing low-latency write aggregation, because it can wake
  closer to the configured millisecond deadline than the shared timer queue.
- `kahuna.key_value_write_fill_target_trigger`, default `false`, dispatches a
  held or lingering partition buffer as soon as it reaches the learned fill
  target instead of always waiting for the timer. Kahuna keeps probing the timer
  path so the target can follow the current load.

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
| `prod`, the default | 10% of machine memory, up to 2 GiB | One quarter of the block cache, raised to the Raft-log flush unit when possible, up to 1 GiB | 6.25% of the managed heap budget, 64 MiB or more | About 16% of memory, or about 1.3 GiB on an 8 GiB machine |
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

`CAMUS_THREADPOOL_MIN_THREADS` overrides CamusDB's .NET worker-thread floor. The
default floor is `1024` worker threads, with a completion-port floor of `512`.
Use the override for controlled load tests or diagnostics when runtime metrics
show queued work in the thread pool. It is an environment variable and takes
effect when the process starts.

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
MiB, inside the block cache. The 8 cores give 32 key-value workers, and each
gets an actor cache of 16 MiB, which is 512 MiB together. The total is about
1.3 GiB.

Raise all four values explicitly on a dedicated server. The sizes above are a
floor to build from. They are not a recommendation for a machine whose only job
is CamusDB.

The share of 6.25%, and its floor of 64 MiB, bound the actor-cache layer as a
whole. CamusDB then divides that budget by `key_value_workers`. Only the minimum
of 8 MiB applies to one actor. More cores therefore divide the same budget into
more parts. They do not make the budget larger. A machine with many cores and
little RAM therefore does not receive a multiple of the intended share.

The two RocksDB budgets are shared by the KV store and the Raft WAL. See
[Shared RocksDB memory](/docs/storage#shared-rocksdb-memory) for how
`rocksdb_shared_memory` works and when it applies.

CamusDB charges the memtable sub-budget inside the total block-cache budget. It
does not add the sub-budget to the total. The sub-budget must not exceed the
total. CamusDB compares the two values after the merge of all layers. An
override of only one of the two can therefore produce an inconsistent pair. One
example is a total of 100 MiB against an explicit memtable budget of 512 MiB. The
computed memtable default never exceeds the total, including the flush-unit
floor. Set both values together.

`max_bytes_per_actor` applies to one actor. Multiply it by `key_value_workers`
to get the total. The default worker count is max(32, 4 × CPU cores).

### All kahuna keys

Every key below goes under the `kahuna:` map. Each one is read once when the
node starts, so a change needs a restart, and `SET CLUSTER SETTING` rejects it.
Each node reads its own file. Where a row says so, give every node the same
value.

"Kahuna default" means the value comes from the storage engine itself.

#### Storage and Raft log

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.storage` | `rocksdb` | `memory`, `sqlite`, `rocksdb` | Key-value storage backend. |
| `kahuna.storage_revision` | `v2` | string | On-disk layout revision of the store. See [above](#the-kahuna-engine-section) before you change it. |
| `kahuna.wal_storage` | `rocksdb` | `memory`, `sqlite`, `rocksdb` | Raft log backend. |
| `kahuna.wal_revision` | `v2` | string | On-disk layout revision of the Raft log. |
| `kahuna.wal_sync_writes` | `true` (Kahuna default) | bool | Syncs each Raft log write to disk. With `false`, an operating system crash or power loss can lose recent log entries. |
| `kahuna.wal_group_commit_linger_ms` | `0` (Kahuna default) | ms | How long a log writer waits to group more commits into one fsync. `0` turns the wait off. |
| `kahuna.wal_single_fsync_commit` | `true` | bool | Acknowledges an autocommit write once a majority has stored it, and writes its commit marker with the next flush. This removes one fsync from the commit path. |
| `kahuna.wal_shard_write_buffer_size_mb` | unset (`64`) | MiB | See [Raft WAL shard column families](#raft-wal-shard-column-families) for this key and the next seven. `1` to `65536`. |
| `kahuna.wal_shard_min_write_buffer_number_to_merge` | unset (`2`) | int | `1` to `64`. |
| `kahuna.wal_shard_max_write_buffer_number` | unset (`4`) | int | `1` to `64`. Must exceed the merge count. |
| `kahuna.wal_shard_level0_file_num_compaction_trigger` | unset (`8`) | int | `1` to `64`. |
| `kahuna.wal_shard_level0_slowdown_writes_trigger` | unset (`28`) | int | `1` to `64`. |
| `kahuna.wal_shard_level0_stop_writes_trigger` | unset (`44`) | int | `1` to `64`. |
| `kahuna.wal_shard_max_bytes_for_level_base_mb` | unset (`256`) | MiB | `1` to `65536`. |
| `kahuna.wal_shard_universal_compaction` | unset (`false`) | bool | Universal instead of leveled compaction. |

#### Transactions and admission

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.default_transaction_timeout_ms` | `5000` (Kahuna default) | ms | Session timeout when a caller passes none. Must not exceed `kahuna.max_transaction_timeout_ms`. |
| `kahuna.max_transaction_timeout_ms` | `300000`, raised to `max_serializable_transaction_lifetime_ms` when that is larger | ms | Upper bound on any session timeout. An explicit value must be at least `max_serializable_transaction_lifetime_ms`. |
| `kahuna.max_concurrent_sessions` | `0` | int | Sessions open at once on this node. Further transactions queue by priority. `0` turns the [admission gate](/docs/transaction-priority) off. |
| `kahuna.default_admission_wait_ms` | `5000` (Kahuna default) | ms | How long a transaction queues at the gate before it is refused. Must not exceed `kahuna.max_admission_wait_ms`. |
| `kahuna.max_admission_wait_ms` | `30000` (Kahuna default) | ms | Upper bound on any admission wait. |
| `kahuna.transaction_priority_reserved_slots` | `0` | int | Session slots only `high` and `critical` transactions may use. Must be below `kahuna.max_concurrent_sessions`. |
| `kahuna.transaction_priority_aging_threshold` | `1000` (Kahuna default) | ms | Wait time after which a queued transaction gains one priority level. `0` turns aging off. |
| `kahuna.transaction_priority_max_queued` | `4096` (Kahuna default) | int | Transactions that may wait at the gate. More are refused with a retryable error. `0` means no limit. |
| `kahuna.transaction_outcome_retention_ttl_ms` | `300000` (Kahuna default) | ms | How long a finished transaction's outcome record is kept. `0` turns age pruning off. See [Transaction outcome retention](#transaction-outcome-retention). |
| `kahuna.transaction_outcome_retention_max` | `10000` (Kahuna default) | int | Outcome records kept per node. |
| `kahuna.one_phase_apply_time_validation` | `true` | bool | Lets an eligible single-partition read-modify-write commit in one Raft round. Same value on every node. See [One-phase apply-time validation](#one-phase-apply-time-validation). |
| `kahuna.staged_base_fence_retention_ms` | `600000` (Kahuna default) | ms | How long the validation fence remembers committed keys. Same value on every node. Must be above `0`. |
| `kahuna.durable_materialize_on_resolve` | `true` | bool | A committed transaction installs its values on every replica when it resolves, instead of writing a separate record per key. During a rolling upgrade from a Kahuna version older than 1.10.1, set it to `false` until every node is upgraded. |
| `kahuna.scan_page_retry_budget_ms` | `5000` (Kahuna default) | ms | How long one range-scan page retries transient errors before the scan fails with an error that names the range. Keep it below the client command deadline. |

#### Workers and threads

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.locks_workers` | max(32, 4 × CPU cores) | int | Lock actors. Each lock resource is served by one of them. |
| `kahuna.key_value_workers` | max(32, 4 × CPU cores) | int | Key-value actors. Each key is served by one of them. |
| `kahuna.background_writer_workers` | `1` (Kahuna default) | int | Workers that write changed objects to the storage backend. |
| `kahuna.read_io_threads` | `4` (Kahuna default) | int | Threads that serve Raft log reads. |
| `kahuna.write_io_threads` | `8` (Kahuna default) | int | Threads that flush Raft log writes. |

All five must be above `0` when set.

#### Raft timing

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.start_election_timeout_ms` | `2000` cluster, `500` standalone | ms | Lower bound of the random election timeout. Must be below `kahuna.end_election_timeout_ms`. |
| `kahuna.end_election_timeout_ms` | `4000` cluster, `1500` standalone | ms | Upper bound of the random election timeout. |
| `kahuna.start_election_timeout_increment_ms` | `100` (Kahuna default) | ms | Added to the lower bound after each failed election round. |
| `kahuna.end_election_timeout_increment_ms` | `200` (Kahuna default) | ms | Added to the upper bound after each failed election round. |
| `kahuna.heartbeat_interval_ms` | `100` (Kahuna default) | ms | How often a leader sends heartbeats. |
| `kahuna.recent_heartbeat_ms` | a quarter of `kahuna.heartbeat_interval_ms` | ms | A leader skips the heartbeat to a peer it contacted this recently. Must be below `kahuna.heartbeat_interval_ms`. |
| `kahuna.voting_timeout_ms` | `1500` (Kahuna default) | ms | How long a candidate waits for votes before it starts a new election round. |

#### Caches, eviction, and log compaction

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.max_entries_per_actor` | computed from memory | int | Cached entries per actor. See [Cache defaults proportional to memory](#cache-defaults-proportional-to-memory). |
| `kahuna.max_bytes_per_actor` | computed from memory | bytes | Cache size per actor. |
| `kahuna.cache_entry_ttl_ms` | `300000` (Kahuna default) | ms | Idle time after which the collection sweep may evict a cached entry. |
| `kahuna.cache_entries_to_remove` | `1000` (Kahuna default) | int | Entries one collection pass evicts. |
| `kahuna.collection_interval_ms` | `60000` (Kahuna default) | ms | How often the collection sweep runs. `range_lock_expires_ms` must be at least twice this value. |
| `kahuna.compact_every_operations` | `1000` (Kahuna default) | int | Persisted Raft log batches between compaction passes. |
| `kahuna.compact_number_entries` | `50` (Kahuna default) | int | Trailing log entries each pass keeps. |
| `kahuna.max_entries_per_compaction` | `5000` (Kahuna default) | int | Log entries one pass may delete. |
| `kahuna.rocksdb_shared_memory` | `true` | bool | One RocksDB block cache and write-buffer budget for both the store and the Raft log. Only applies when both use `rocksdb`. |
| `kahuna.rocksdb_shared_memory_budget_mb` | computed from memory | MiB | Shared block cache size. |
| `kahuna.rocksdb_shared_memtable_budget_mb` | computed from memory | MiB | Memtable budget inside the block cache. Must not exceed `kahuna.rocksdb_shared_memory_budget_mb`. |
| `kahuna.rocksdb_direct_reads` | `false` | bool | Reads SST files with direct I/O, past the operating system page cache. |

The count and size keys above must be above `0` when set.

#### Write aggregation keys

See [Write aggregation](#write-aggregation).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.key_value_write_max_in_flight_batches_per_partition` | `1` (Kahuna default) | int | Write batches a partition may have waiting on Raft. `1` to `64`. |
| `kahuna.key_value_write_linger_ms` | `1` (Kahuna default) | ms | How long the oldest queued write may wait while nothing is in flight. `0` to `1000`. |
| `kahuna.key_value_write_post_completion_hold_ms` | `1` | ms | Wait after a batch completes before the next one is sent. `0` to `1000`. |
| `kahuna.key_value_write_precise_wake` | `false` (Kahuna default) | bool | Runs the aggregator's timers on a dedicated thread. |
| `kahuna.key_value_write_fill_target_trigger` | `false` (Kahuna default) | bool | Sends a held batch as soon as it reaches the learned fill target. |
| `kahuna.key_value_write_max_batch_items` | `512` (Kahuna default) | int | Items per write batch. `1` to `65536`. |

#### Backup and point-in-time recovery

See [Backup and restore](/docs/backup-and-restore).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.backup_dir` | unset (backups off) | path | Directory for backups. Setting it turns backups on. Must not be blank when present. |
| `kahuna.pitr_window_seconds` | `3600` (Kahuna default) | seconds | How far back a restore may target. `1` to `21600`. |
| `kahuna.base_snapshot_interval_seconds` | `1800` (Kahuna default) | seconds | How often a new base image is taken. Must not exceed `kahuna.pitr_window_seconds`. |
| `kahuna.restore_root` | unset | path | Turns on remote restore, with destinations confined to this directory. |
| `kahuna.allow_unconfined_remote_restore` | `false` | bool | Allows remote restore without `kahuna.restore_root`, to any path. Not safe. |
| `kahuna.backup_cluster_id` | unset | string | Cluster identity written into backup manifests. Same value on every node. |
| `kahuna.backup_mac_key_file` | unset | path | Key file that signs and verifies backup manifests. Same file on every node. |
| `kahuna.backup_retention_max_chains` | `0` | int | Backup chains to keep. `0` means no limit. |
| `kahuna.backup_retention_max_age_seconds` | `0` | seconds | Maximum chain age. `0` means no limit. |
| `kahuna.backup_retention_max_bytes` | `0` | bytes | Total backup size. `0` means no limit. |
| `kahuna.backup_gc_interval_seconds` | `3600` (Kahuna default) | seconds | How often the backup cleanup runs. `0` turns the timer off. |
| `kahuna.backup_restore_throttle_bytes_per_sec` | `0` | bytes/s | Copy rate limit of a restore. `0` means no limit. |

#### Row history retention

See [Persistent MVCC revision retention](#persistent-mvcc-revision-retention) and
[Time travel reads](/docs/time-travel-reads).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.persistent_revision_retention_age_seconds` | `kahuna.pitr_window_seconds` when both retention keys are unset | seconds | Age after which old row versions are pruned. `0` turns age pruning off. A nonzero value must be at least the PITR window. |
| `kahuna.persistent_revision_retention_count` | `0` | int | Row versions kept per key. `0` turns count pruning off. |

#### Range splits and merges

These apply only with [key-range sharding](/docs/key-range-sharding). See
[Key-range sharding and range splits](#key-range-sharding-and-range-splits).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.range_split_threshold` | `0` | keys | Sampled key count at which a range splits. `0` turns count-based splits off. A nonzero value must be at least twice `kahuna.range_split_min_range_size`. |
| `kahuna.range_split_min_range_size` | `10` (Kahuna default) | keys | Keys each child range must keep after a split. |
| `kahuna.range_split_load_threshold` | `0` | operations/s | Sustained load at which a range splits. `0` turns load-based splits off. |
| `kahuna.range_split_load_min_queue_depth` | `8` (Kahuna default) | int | Pending log writes a partition must also show. |
| `kahuna.range_split_load_min_commit_wait_ms` | `0` (Kahuna default) | ms | Commit wait a partition must also show. `0` turns this check off. |
| `kahuna.range_split_load_window_ms` | `15000` (Kahuna default) | ms | How long the load must last before a split. |
| `kahuna.range_split_load_poll_interval_ms` | `5000` (Kahuna default) | ms | How often load is sampled. Must be below the window. |
| `kahuna.range_split_load_imbalance_max` | `0.8` (Kahuna default) | fraction | A split is refused when one child would still get this share of the writes. Above `0.5`, at most `1.0`. |
| `kahuna.range_split_settle_window_ms` | `10000` (Kahuna default) | ms | How long a new child range is left alone. Must be at least `kahuna.min_leader_stability_ms`. |
| `kahuna.range_split_indivisible_cooldown_ms` | `300000` (Kahuna default) | ms | How long a range that could not be split is skipped. |
| `kahuna.range_move_settle_timeout_ms` | `10000` (Kahuna default) | ms | Longest pause a split or merge holds on the moving range while it settles pending writes. |
| `kahuna.range_merge_min_size` | `10` (Kahuna default) | keys | Two neighboring ranges smaller than this may merge. `0` turns merges off. |
| `kahuna.enable_load_reports` | `false` | bool | Shares per-partition load reports between nodes even when nothing else needs them. |

#### Replica placement and leader balancing

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.replication_factor` | `0` | int | Replicas per data partition. `0` places every partition on every node. Prefer an odd number. See [Cluster](/docs/cluster). |
| `kahuna.zone` | unset | string | Failure-domain label of this node, such as a rack or availability zone. Replicas of a range spread across zones. |
| `kahuna.enable_placement_rebalancer` | `false` | bool | Moves replicas over time: repairs ranges that lost a replica, and evens out the spread as nodes join and leave. |
| `kahuna.placement_pass_interval_ms` | `5000` (Kahuna default) | ms | How often the placement pass runs. |
| `kahuna.max_replica_moves_per_pass` | `4` (Kahuna default) | int | Replica moves one pass may start. |
| `kahuna.max_concurrent_replica_transfers` | `1` (Kahuna default) | int | Balancing moves in flight. |
| `kahuna.max_concurrent_replica_repairs` | `3` (Kahuna default) | int | Repair moves in flight. |
| `kahuna.replica_count_deadband` | `1` (Kahuna default) | int | Replica-count imbalance per node that is tolerated before balancing. |
| `kahuna.decommission_drain_timeout_ms` | `120000` (Kahuna default) | ms | How long a decommission waits for the leaving node's replicas to move before it removes the node anyway. |
| `kahuna.enable_leader_balancer` | `false` | bool | Moves Raft leaders between nodes to spread load. Same value on every node. |
| `kahuna.leader_balancer_interval_ms` | `30000` (Kahuna default) | ms | How often the leader balancer runs. |
| `kahuna.leader_balancer_report_interval_ms` | `5000` (Kahuna default) | ms | How often each node publishes its load report. |
| `kahuna.leader_balancer_report_ttl_ms` | `20000` (Kahuna default) | ms | Age after which a load report is ignored. Must be above the report interval. |
| `kahuna.min_leader_stability_ms` | `5000` (Kahuna default) | ms | Shortest time a partition keeps its leader before the balancer may move it again. |

The interval, count, and timeout keys in this table must be above `0` when set.

## The diagnostics section

The `diagnostics:` map exports server metrics and traces. Everything is off by
default. The node reads these keys at startup, so a change needs a restart. See
[Performance diagnostics](/docs/performance-diagnostics).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `diagnostics.enabled` | `false` | bool | Turns diagnostics on. When `false`, the other keys have no effect. |
| `diagnostics.prometheus_enabled` | `false` | bool | Serves a Prometheus scrape endpoint on the HTTP port. |
| `diagnostics.prometheus_path` | `/metrics` | path | Path of the scrape endpoint. Must start with `/`. |
| `diagnostics.otlp_endpoint` | unset | URL | OTLP collector address. Setting it turns on the OTLP exporter. Must be an absolute URL. |
| `diagnostics.trace_sample_ratio` | `0.01` | `0` to `1` | Share of requests that are traced. |
| `diagnostics.include_runtime_metrics` | `true` | bool | Also exports .NET runtime and process metrics (GC, thread pool, CPU). |

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
