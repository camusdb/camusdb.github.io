---
sidebar_position: 8
---

# Configuration

CamusDB can start with no configuration file, which is the default experience
for the `CamusDB.Server` .NET global tool. At startup it locates the first YAML
file in a fixed search order, applies explicit command-line overrides, fills in
runtime defaults, validates the result, and then starts accepting work.

Install and run the server with:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

Upgrade an existing tool install with:

```bash
dotnet tool update --global CamusDB.Server
```

Create a user-owned starter configuration with:

```bash
camusdb init
```

This writes `~/.camusdb/config.yml` on macOS/Linux, or
`%APPDATA%\camusdb\config.yml` on Windows, and creates the default data
directory. If the file already exists, `camusdb init` exits without replacing
it; use `camusdb init --force` when you intentionally want to overwrite the
starter file.

CamusDB reads the first configuration it finds:

1. `--config <path>`
2. `CAMUS_CONFIG_PATH`
3. `./camusdb.yml`
4. `./Config/config.yml`
5. `~/.camusdb/config.yml` on macOS/Linux, or
   `%APPDATA%\camusdb\config.yml` on Windows
6. built-in defaults, when no file exists

An explicit path from `--config` or `CAMUS_CONFIG_PATH` must exist. If it does
not, startup fails instead of silently falling through to another file.

Precedence after a file is loaded is:

1. command-line flags
2. environment variables
3. the selected YAML file
4. built-in defaults

Only flags you pass explicitly override YAML values. Omitting a flag keeps the
value from the selected file. The resolved configuration source and data
directory are printed at startup.

After startup, inspect the effective engine configuration from SQL with
[`SHOW VARIABLES`](/docs/show-variables). This is useful when a CLI flag or
environment variable overrides the selected YAML file.

## Default Files And Directories

The source repository and Docker image ship a commented configuration reference
at `CamusDB/Config/config.yml`. Its active settings are:

```yaml
data_dir: /tmp/camusdb/
initial_partitions: 1
```

The commented sections show the available server, cluster, transaction,
recoverable-drop, parser, and Kahuna engine settings. Authentication secrets
are intentionally not configured in YAML; see
[Authentication And Authorization](/docs/sql-authentication). For real
deployments, set `data_dir` to persistent storage instead of relying on `/tmp`.

When no file or flag sets `data_dir`, CamusDB uses a user data directory:

- `$CAMUS_HOME/data`, when `CAMUS_HOME` is set
- `$XDG_DATA_HOME/camusdb` on macOS/Linux when `XDG_DATA_HOME` is set
- `~/.local/share/camusdb` on macOS/Linux otherwise
- `%LOCALAPPDATA%\camusdb` on Windows

`CAMUS_HOME` also relocates the user configuration file to
`$CAMUS_HOME/config.yml`.

When `initial_partitions` is not set explicitly, CamusDB chooses an effective
default from the run mode:

- standalone mode: `1`
- cluster mode: `3`

## Unified Reference

Most startup settings can now be configured either in `config.yml` or by a
matching command-line flag. CLI flags are useful for containers, scripts, and
per-node cluster settings; YAML is better for stable node configuration.

`--config <path>` selects the YAML file to load. It is not itself a YAML key.

| YAML key | CLI flag | Default | Purpose |
| --- | --- | --- | --- |
| `data_dir` | `--data-dir` | empty, with runtime fallback | Base directory for persisted database files. |
| `mode` | `--mode` | `standalone` | Run mode: `standalone` or `cluster`. |
| `node_name` | `--raft-nodename` | empty | Optional cluster node name; cluster mode falls back to the machine name when empty. |
| `raft_node_id` | `--raft-nodeid` | `1` | Numeric Raft node id. Must be greater than `0`. |
| `raft_host` | `--raft-host` | `localhost` | Host address used for Raft communication. |
| `raft_port` | `--raft-port` | `7070` | Port used for Raft gRPC traffic. |
| `initial_partitions` | `--initial-cluster-partitions` | runtime fallback | Number of Raft partitions to initialize. Defaults to `1` for standalone mode and `3` for cluster mode when unset. |
| `peers` | `--initial-cluster` | empty list | Static Raft peer list in `host:port` form. |
| `http_peers` | `--http-peers` | empty list | Per-peer HTTP addresses, parallel to `peers`. |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` | DDL schema-ack wait timeout in milliseconds. |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` | DDL live-node lease in milliseconds, or `-1` for infinite. |
| `http_port` | `--http-port` | `5095` | HTTP API listener port. |
| `https_port` | `--https-port` | `7141` | HTTPS API listener port when a certificate is configured. |
| `https_certificate` | `--https-certificate` | empty | Path to a PFX certificate for the HTTPS API listener; empty disables HTTPS. |
| `raft_certificate` | `--raft-certificate` | empty | Path to a PFX certificate for the Raft gRPC listener in cluster mode. |
| `require_tls_when_auth_enabled` | `--require-tls-when-auth-enabled` | `true` | When authentication is enabled, reject credential-bearing requests over plaintext except loopback. Set `false` only behind a trusted TLS terminator. |

The remaining YAML settings do not currently have command-line flags:

| YAML key | Default | Purpose |
| --- | --- | --- |
| `grpc_enabled` | `true` | Enable the client-facing gRPC API on a dedicated HTTP/2 listener. |
| `grpc_port` | `5096` | Port for the client-facing gRPC API when `grpc_enabled` is true. |
| `grpc_batch_max_in_flight` | `64` | Maximum concurrently executing operations per `CamusSql.BatchExecute` stream before backpressure. |
| `default_isolation_level` | `serializable` | Default transaction isolation when a request does not choose one. |
| `default_transaction_locking` | `pessimistic` | Default transaction locking strategy when a request does not choose one. |
| `default_transaction_priority` | `normal` | Default admission priority when a request does not choose one. |
| `transaction_admission_wait_ms` | `0` | How long a transaction may queue at the admission gate before a retryable refusal; `0` leaves `kahuna.default_admission_wait_ms` in force. This is not the transaction lifetime. |
| `range_lock_expires_ms` | `150000` | Initial Serializable range-lock TTL; the coordinator renews live range locks; positive values must be at least `2x` the effective Kahuna collection interval; `<= 0` disables expiry. |
| `max_serializable_transaction_lifetime_ms` | `3600000` | Maximum Serializable read-write transaction lifetime; `<= 0` disables the cap. |
| `transaction_idle_timeout_ms` | `300000` | Idle timeout for explicit client transactions before the background reaper rolls them back; `<= 0` disables the CamusDB-side reaper. |
| `transaction_reaper_interval_ms` | `30000` | Background sweep interval for abandoned explicit transactions. |
| `transaction_finalize_retry_budget_ms` | `15000` | Wall-clock budget for retrying an unresolved `COMMIT`/`ROLLBACK` on the same handle before returning `CADB0509`; `<= 0` attempts the finalize once. |
| `sequence_retry_budget_ms` | `10000` | Wall-clock budget for retrying a monotonic id counter while its partition has no confirmed leader, before failing with `CADB0535`; `<= 0` attempts the call once. |
| `database_idle_eviction_ms` | `900000` | How long a database may sit unused before this node releases its descriptor; `<= 0` disables idle eviction. |
| `prepared_statement_idle_timeout_ms` | `600000` | REST prepared-statement idle timeout; `<= 0` disables REST handle reaping. |
| `prepared_statement_sweep_interval_ms` | `60000` | Background sweep interval for expired REST prepared statements. Must be greater than `0`. |
| `grpc_max_prepared_statements_per_stream` | `512` | Maximum prepared statements per `CamusSql.BatchExecute` stream; `0` means unbounded. |
| `rest_max_prepared_statements_per_principal` | `512` | Maximum REST prepared statements per principal on one node; `0` means unbounded. |
| `rest_max_prepared_statements` | `8192` | Node-wide REST prepared-statement cap across principals; `0` means unbounded. |
| `max_prepared_statement_bytes` | `65536` | Maximum SQL text size for one prepared statement; `0` means unlimited. |
| `grpc_max_prepared_statement_bytes_per_stream` | `8388608` | Retained prepared SQL byte budget per gRPC batch stream; `0` means unlimited. |
| `rest_max_prepared_statement_bytes_per_principal` | `8388608` | Retained prepared SQL byte budget per REST principal; `0` means unlimited. |
| `rest_max_prepared_statement_bytes` | `67108864` | Node-wide retained REST prepared SQL byte budget; `0` means unlimited. |
| `orphan_retention_ms` | `604800000` | Recoverable orphan retention window for normal root database/table drops; `<= 0` keeps orphans indefinitely. |
| `orphan_reclaim_interval_ms` | `300000` | Background sweep interval for reclaiming expired orphans; `<= 0` disables automatic reclamation. |
| `lock_escalation_threshold` | `50` | Shared point-lock count per bucket before escalation. |
| `lock_wait_deadline_ms` | `500` | Per-operation Serializable conflict wait cap. |
| `key_range_sharding` | `false` | Opt tables and eligible indexes into Kahuna key-range routing. |
| `stats_flush_interval_ms` | `5000` | Advisory table-statistics flush interval. |
| `stats_analyze_sample_rows` | `100000` | Manual `ANALYZE` full-scan/sample threshold; `0` means always full scan. |
| `stats_histogram_buckets` | `100` | Histogram bucket count built per analyzed column. |
| `auto_analyze_enabled` | `true` | Enable background automatic table analyze. |
| `auto_analyze_check_interval_ms` | `60000` | Automatic analyze staleness sweep interval; `<= 0` disables the loop. |
| `auto_analyze_fraction_stale_rows` | `0.20` | Proportional staleness trigger for automatic analyze. |
| `auto_analyze_min_stale_rows` | `500` | Minimum mutations before a table is stale for automatic analyze. |
| `auto_analyze_max_concurrent` | `1` | Maximum background analyses running at once on a node. |
| `auto_analyze_max_rows_per_second` | `50000` | Background analyze scan-rate throttle; `<= 0` disables throttling. |
| `auto_analyze_histogram_sample_rows` | `10000` | Reservoir sample size per column for background histograms. |
| `auto_analyze_hll_precision` | `11` | HyperLogLog precision for automatic analyze distinct-value estimates; valid range `4..16`. |
| `auto_analyze_load_pause_threshold` | `16` | In-flight foreground work threshold above which automatic analyze backs off; `<= 0` disables load backoff. |
| `auto_analyze_ownership_check_rows` | `1000` | Rows between background analyze ownership/load re-checks. |
| `ttl_enabled` | `true` | Enable the row-level TTL background sweep loop. |
| `ttl_default_job_cron` | `@daily` | Default sweep cadence for TTL tables that do not set `ttl_job_cron`. |
| `ttl_default_select_batch_size` | `500` | Default rows read per TTL scan batch. |
| `ttl_default_delete_batch_size` | `100` | Default rows deleted per TTL transaction. |
| `ttl_default_select_rate_limit` | `0` | Default TTL scan cap in rows per second; `0` means unlimited. |
| `ttl_default_delete_rate_limit` | `100` | Default TTL delete cap in rows per second; `0` means unlimited. |
| `ttl_spans_per_table` | `64` | Number of spans a TTL run divides each table into. |
| `ttl_max_concurrent_spans_per_node` | `1` | Maximum TTL spans processed concurrently on one node. |
| `ttl_load_pause_threshold` | `16` | In-flight foreground work threshold above which TTL sweeps pause; `<= 0` disables load backoff. |
| `ttl_span_lease_ms` | `30000` | TTL span claim lease in milliseconds. |
| `ttl_span_lease_renew_interval_ms` | `10000` | TTL span lease renewal interval in milliseconds. |
| `cost_based_access_path_enabled` | `true` | Enable cost-based selection among viable table/index access paths. |
| `cost_based_join_order_enabled` | `true` | Enable cost-based left-deep join-order enumeration for eligible joins. |
| `plan_cache_enabled` | `false` | Enable the per-process query plan cache. |
| `plan_cache_max_entries` | `512` | Maximum plan-cache entries; `0` effectively disables caching. |
| `max_view_expansion_depth` | `32` | Maximum view-over-view nesting depth; a backstop behind the DDL-time cycle check. |
| `materialized_view_refresh_chunk_rows` | `10000` | Rows written per transaction while a materialized view is refreshed. Must stay well below `max_mutations_per_transaction`. |
| `materialized_view_refresh_enabled` | `true` | Whether this node may execute materialized-view refresh work. `WITH NO DATA` still works when disabled. |
| `materialized_view_refresh_takeover_attempts` | `3` | How many times the background sweep restarts a materialized-view refresh interrupted by a crash or a leadership change; `0` only reclaims the abandoned storage. |
| `regex_match_timeout_ms` | `250` | Per-match timeout for regex operators and regex scalar functions. |
| `regex_cache_max_entries` | `1024` | Maximum compiled regex patterns cached per process; `0` disables caching. |
| `engine_metrics_enabled` | `true` | Observe embedded [Kahuna](https://kahunakv.github.io/)/[Kommander](https://kahunakv.github.io/kommander.github.io/) engine metrics for `SHOW ENGINE STATS`. |
| `query_result_cache_enabled` | `true` | Enable the per-node in-memory query result cache. Queries still opt in individually with `{cache=...}`. |
| `query_result_cache_default_ttl_ms` | `5000` | Default TTL for result-cache entries without a per-query `ttl`. |
| `query_result_cache_max_entries` | `1024` | Maximum result-cache entries per process. |
| `query_result_cache_max_bytes` | `67108864` | Total result-cache byte budget per process. |
| `query_result_cache_max_entry_bytes` | `1048576` | Maximum bytes for a single result-cache entry. |
| `query_result_cache_max_entry_rows` | `10000` | Maximum rows for a single result-cache entry. |
| `query_result_cache_max_deps` | `4096` | Maximum dependency facts captured for one result-cache entry. |
| `query_result_cache_max_point_deps` | `2048` | Maximum point-key dependencies captured for one result-cache entry. |
| `query_result_cache_max_ranges` | `256` | Maximum range dependencies captured for one result-cache entry. |
| `query_result_cache_singleflight_wait_ms` | `250` | Reserved single-flight wait setting for result-cache misses. |
| `query_result_cache_strict_validation_max_keys` | `10000` | Maximum keys probed during strict validation before failing closed. |
| `query_result_cache_sweep_interval_ms` | `10000` | Background TTL sweep interval. |
| `sql_parser_cache_ttl_seconds` | `300` | Sliding TTL for cached SQL ASTs; `0` disables the parser cache. |
| `sql_parser_cache_max_entries` | `2048` | Maximum cached SQL texts; `0` means unbounded. |
| `sql_parser_cache_sweep_seconds` | `60` | Background sweep interval for expired parser-cache entries. |
| `max_identifier_length` | `64` | Maximum length for database, table, column, and index names; `<= 0` disables the limit. |
| `max_columns_per_table` | `512` | Maximum user-declared columns per table; `<= 0` disables the limit. |
| `max_indexes_per_table` | `64` | Maximum user-visible secondary indexes per table; `<= 0` disables the limit. |
| `max_tables_per_database` | `10000` | Maximum tables per database; `<= 0` disables the limit. |
| `max_index_columns` | `32` | Maximum key plus `INCLUDE` columns in one index; `<= 0` disables the limit. |
| `max_index_include_tuple_bytes` | `4096` | Maximum encoded bytes for one index entry's key plus included-column payload; `<= 0` disables the limit. |
| `max_mutations_per_transaction` | `20000` | Maximum row/index mutations in one user transaction; `<= 0` disables the user limit. |
| `spill_enabled` | `false` | Enable spill-to-disk for blocking query operators. |
| `spill_threshold_rows` | `500000` | Per-operator in-memory row cap before spilling starts. |
| `spill_merge_fan_in` | `16` | Maximum spill runs read at once during merge passes. |
| `branch_snapshot_hold_lease_ms` | `300000` | Lease window for branch snapshot-floor holds on parent MVCC history. |
| `kahuna` | empty mapping | Allow-listed storage and Raft engine overrides. |
| `diagnostics` | disabled mapping | Opt-in standalone Prometheus/OpenTelemetry diagnostics. |

Cluster mode is active when either `mode: cluster` is set or `peers` contains
at least one entry.

## Server And Cluster Settings

### `data_dir`

`data_dir` controls where CamusDB stores persistent state.

Both standalone and cluster mode use a shared storage node. The KV backend, WAL
backend, [query spill files](/docs/spill-to-disk), and other process-level
durable/runtime files are created under this base path. Databases are separated
by stable database-id key prefixes in the shared keyspace, not by per-database
directories.

Use persistent storage here if you expect data to survive restarts.

### `peers` and `http_peers`

`peers` contains the Raft endpoints used for static cluster discovery:

```yaml
peers:
  - 192.168.1.10:7070
  - 192.168.1.11:7072
  - 192.168.1.12:7074
```

`http_peers` maps each Raft peer to its HTTP API endpoint:

```yaml
http_peers:
  - 192.168.1.10:5095
  - 192.168.1.11:5096
  - 192.168.1.12:5097
```

Rules:

- `http_peers`, when present, must have the same number of entries as `peers`.
- Entries must be valid `host:port` values.
- The `peers` entry should byte-match the endpoint format reported by Raft.

If `http_peers` is omitted, CamusDB falls back to a uniform-port heuristic: it
uses the Raft endpoint host with this node's `http_port`.

### HTTP And TLS

CamusDB always binds the HTTP API on `http_port`.

If `https_certificate` is set, CamusDB also binds `https_port` using that PFX
certificate. In cluster mode, `raft_certificate` enables TLS on the Raft gRPC
listener.

```yaml
http_port: 5095
https_port: 7141
https_certificate: /etc/camusdb/api.pfx
raft_certificate: /etc/camusdb/raft.pfx
```

When authentication is enabled, CamusDB rejects credential-bearing requests over
plaintext by default, except loopback development traffic. If TLS terminates in
front of the node, keep that plaintext hop inside the trust boundary and set:

```yaml
require_tls_when_auth_enabled: false
```

or:

```bash
camusdb --require-tls-when-auth-enabled false
```

### Client gRPC

The client-facing gRPC API is enabled by default on a dedicated HTTP/2
listener:

```yaml
grpc_enabled: true
grpc_port: 5096
grpc_batch_max_in_flight: 64
```

Set `grpc_enabled: false` when you only want the HTTP API listener. The gRPC
listener is separate from the REST/JSON API on `http_port`. It exposes the
`CamusSql` and `CamusRows` services described in [gRPC API](/docs/grpc-api).

When `raft_certificate` is configured, CamusDB reuses it for TLS on the gRPC
listener. Without `raft_certificate`, the gRPC listener uses plaintext HTTP/2.

`grpc_batch_max_in_flight` bounds the number of concurrently executing
operations per `CamusSql.BatchExecute` duplex stream before the server applies
backpressure.

### Runtime Log Verbosity

CamusDB also reads optional environment variables that tune console logging at
process startup. These are useful in containers because they do not require
editing `appsettings.json` or rebuilding the image.

| Environment variable | Purpose |
| --- | --- |
| `CAMUS_LOG_LEVEL` | Default log level for categories without a more specific rule. |
| `CAMUS_LOG_LEVEL_KAHUNA` | Log level for Kahuna categories. Defaults to `Warning`. |
| `CAMUS_LOG_LEVEL_KOMMANDER` | Log level for Kommander categories. Defaults to `Warning`. |
| `CAMUS_LOG_LEVEL_GRPC` | Log level for gRPC categories. Defaults to `Warning`. |
| `CAMUS_LOG_FILTERS` | Comma-separated category filters in `Category=Level` form. |

Accepted levels are `Trace`, `Debug`, `Information`, `Warning`, `Error`,
`Critical`, and `None`, case-insensitively. Invalid values are ignored and the
built-in defaults remain active.

Examples:

```bash
CAMUS_LOG_LEVEL=Debug camusdb

CAMUS_LOG_LEVEL_KAHUNA=Information \
CAMUS_LOG_FILTERS="Microsoft.AspNetCore=Warning,CamusDB.Core=Debug" \
camusdb
```

### Authentication Environment

The authentication switch and secrets are configured with environment variables
or an external secret provider, not with `config.yml`:

| Environment variable | Purpose |
| --- | --- |
| `CAMUSDB_AUTH_ENABLED` | Set to `true` to require bearer tokens and enforce privileges. Defaults to off. |
| `CAMUSDB_AUTH_TOKEN_KEY` | HMAC key for access-token secrets. Required when auth is enabled; must match on every cluster node. |
| `CAMUSDB_BOOTSTRAP_USER` | First superuser name when the auth catalog is empty. |
| `CAMUSDB_BOOTSTRAP_PASSWORD` | Initial password for the bootstrap superuser. |
| `CAMUSDB_NODE_SECRET` | Shared node-to-node secret for internal cluster routes when auth is enabled. |

Do not put these values in YAML. See
[Authentication And Authorization](/docs/sql-authentication) for bootstrap,
login, grants, TLS, and token usage. The non-secret
`require_tls_when_auth_enabled` transport policy is configured in YAML or with
`--require-tls-when-auth-enabled`.

## Schema Ack Settings

These settings control the distributed schema two-version gate in cluster mode:

- `schema_ack_wait_timeout_ms`
  - How long a DDL proposer waits for all live nodes to acknowledge the needed
    schema version before failing the operation.
- `schema_ack_live_node_lease_ms`
  - How long since a member's last activity before the schema leader stops
    blocking on it.
  - `-1` means infinite lease.

Most users should keep the defaults unless they are testing cluster DDL behavior
or diagnosing slow convergence.

## Transaction And Locking Settings

Serializable is the default isolation level:

```yaml
default_isolation_level: serializable
default_transaction_locking: pessimistic
default_transaction_priority: normal
```

Use `read_committed` only when you explicitly want weaker isolation by default.
Individual SQL/API transactions can still request an isolation level.
Use `optimistic` for `default_transaction_locking` only when the deployment
wants transactions to avoid explicit locks and validate conflicts at commit by
default. Individual SQL/API transactions can still request a locking strategy.
Use a non-`normal` `default_transaction_priority` only when you intentionally
want untagged transactions to enter the admission queue at that level.

Locking settings tune Serializable read-write behavior:

```yaml
range_lock_expires_ms: 150000
max_serializable_transaction_lifetime_ms: 3600000
transaction_idle_timeout_ms: 300000
transaction_reaper_interval_ms: 30000
lock_escalation_threshold: 50
lock_wait_deadline_ms: 500
```

Operational notes:

- `range_lock_expires_ms` is the initial TTL for range locks acquired by
  Serializable read-write scans. The Kahuna coordinator renews live range locks
  on its collection tick, so a positive value must be at least `2x` the
  effective `kahuna.collection_interval_ms`. The default is `150000`
  milliseconds, which is safe with Kahuna's default `60000` millisecond
  collection interval.
- `max_serializable_transaction_lifetime_ms` limits how long an active
  Serializable read-write transaction can remain open. The same value is used
  as the Kahuna transaction coordinator session timeout.
- `transaction_idle_timeout_ms` controls how long an explicit client
  transaction may sit idle before CamusDB rolls it back. Set it to `<= 0` to
  disable the CamusDB-side reaper; Kahuna's transaction session timeout remains
  the final cleanup backstop.
- `transaction_reaper_interval_ms` controls how often the abandoned transaction
  reaper scans for idle explicit transactions.
- `lock_escalation_threshold` keeps lock bookkeeping bounded by escalating many
  point locks in the same bucket.
- `lock_wait_deadline_ms` limits how long a single lock acquisition waits before
  surfacing a Serializable conflict.

### Retry Budgets

Two settings bound how long the server keeps retrying an operation internally
before handing the retry back to the caller. Both are wall-clock durations rather
than attempt counts, because what they wait on — an election, a drain, a
leadership handover — resolves on its own schedule: a saturated node makes each
attempt take longer without making it take more attempts, so an attempt cap
shrinks the real budget exactly when the node most needs it.

```yaml
transaction_finalize_retry_budget_ms: 15000
sequence_retry_budget_ms: 10000
```

- `transaction_finalize_retry_budget_ms` is how long a `COMMIT` or `ROLLBACK`
  that comes back "outcome not known yet" is retried on the same handle. The
  write may already have landed, so this is retried rather than reported. When
  the budget runs out the client sees `CADB0509`
  `TransactionFinalizeUnresolved` and resends the same finalize itself — see
  [Retries And Conflicts](/docs/serializable-retries). Raise it on nodes that run
  hot. `<= 0` attempts the finalize once.
- `sequence_retry_budget_ms` is how long a call against a persistent monotonic
  counter — database ids, table ids, the registry's cross-node generation stamp —
  is retried while its Raft partition has no confirmed leader. Every
  `CREATE TABLE`, `CREATE VIEW`, and `CREATE TABLE AS SELECT` allocates an id
  first, so this budget decides whether an election is invisible or fails the
  statement with `CADB0535` `SequenceUnavailable`. The default is sized against
  an election, which runs in seconds. `<= 0` attempts the call once.

### Idle Database Eviction

A node releases a database descriptor it has not used for
`database_idle_eviction_ms`, so the set it holds open tracks its working set
rather than every database it has ever touched:

```yaml
database_idle_eviction_ms: 900000
```

The default is fifteen minutes; `<= 0` disables eviction entirely. Only the
in-memory descriptor and its per-database state are released — nothing on disk
changes, and the next statement against that database reopens it transparently at
the cost of one open.

Eviction never takes a descriptor out from under running work. A database with an
active transaction, an in-flight DDL, a caller holding a reference, an open branch
reading through it, or a drop in progress is skipped and retried on a later sweep.
The idle window is part of that safety rather than only a policy: a caller that
has just resolved a descriptor but not yet taken a reference on it reports an idle
time of approximately zero, so requiring minutes of idleness excludes that
interleaving rather than merely making it unlikely.

Lower it on a node that touches many databases and keeps few of them warm. Raise
it, or disable it, when a workload returns to the same databases on a long cycle
and you would rather not pay the reopen.

### Transaction Priority

Transaction priority controls which queued transaction starts next when the
local node is at its configured concurrency ceiling. It does not change
isolation, locking, commit semantics, or resource use after the transaction has
started.

The request-level default is:

```yaml
default_transaction_priority: normal
```

Accepted values are `background`, `low`, `normal`, `high`, and `critical`.

Priority has no admission effect unless the
[Kahuna](https://kahunakv.github.io/) gate is enabled:

```yaml
transaction_admission_wait_ms: 0

kahuna:
  max_concurrent_sessions: 0
  transaction_priority_reserved_slots: 0
  transaction_priority_aging_threshold: 1000
  transaction_priority_max_queued: 4096
  default_admission_wait_ms: 5000
  max_admission_wait_ms: 30000
```

Keep `kahuna.max_concurrent_sessions: 0` unless you have tested the gate with
your workload. When a ceiling is active, set
`kahuna.transaction_priority_reserved_slots` to at least `1` so high-priority
engine work cannot be queued behind ordinary user traffic.

The admission wait settings bound how long an *unadmitted* transaction queues
before being refused with a retryable `CADB0504`.
`transaction_admission_wait_ms` is the CamusDB-side budget; `0` defers to
`kahuna.default_admission_wait_ms`, and `kahuna.max_admission_wait_ms` clamps
any caller-supplied value. Keep the budget in seconds — it is not the
transaction lifetime, and a long door-wait makes a saturated node hold requests
open instead of shedding them.

See [Transaction Priority](/docs/transaction-priority) for SQL/API usage,
aging, observability, and operational tradeoffs.

## Prepared Statements

Prepared statements register a SQL text once and execute it repeatedly by
handle. See [Prepared Statements](/docs/prepared-statements) for the client
lifecycle.

```yaml
prepared_statement_idle_timeout_ms: 600000
prepared_statement_sweep_interval_ms: 60000
grpc_max_prepared_statements_per_stream: 512
rest_max_prepared_statements_per_principal: 512
rest_max_prepared_statements: 8192
max_prepared_statement_bytes: 65536
grpc_max_prepared_statement_bytes_per_stream: 8388608
rest_max_prepared_statement_bytes_per_principal: 8388608
rest_max_prepared_statement_bytes: 67108864
```

Settings:

- `prepared_statement_idle_timeout_ms`: idle cutoff for REST handles. Set it to
  `<= 0` to disable REST prepared-statement reaping.
- `prepared_statement_sweep_interval_ms`: how often the background reaper scans
  for expired REST handles. It must be greater than `0`.
- `grpc_max_prepared_statements_per_stream`: count cap for one
  `CamusSql.BatchExecute` stream. Set it to `0` for unbounded.
- `rest_max_prepared_statements_per_principal`: count cap for one principal on
  one node. Set it to `0` for unbounded.
- `rest_max_prepared_statements`: node-wide REST count cap across principals.
  Set it to `0` for unbounded.
- `max_prepared_statement_bytes`: maximum SQL text size for a single prepared
  statement. Set it to `0` for unlimited.
- `grpc_max_prepared_statement_bytes_per_stream`: retained prepared SQL byte
  budget for one gRPC batch stream. Set it to `0` for unlimited.
- `rest_max_prepared_statement_bytes_per_principal`: retained prepared SQL byte
  budget for one REST principal. Set it to `0` for unlimited.
- `rest_max_prepared_statement_bytes`: node-wide retained REST prepared SQL
  byte budget. Set it to `0` for unlimited.

Exceeding a prepared-statement count or byte budget rejects the new
registration with `CADB0521` `PreparedStatementLimitExceeded`. CamusDB does not
evict an existing handle silently.

Negative values are invalid at startup and return `CADB0600` `InvalidConfig`.

## Recoverable Drop Settings

Normal `DROP DATABASE` and `DROP TABLE` statements are deferred for root
databases and tables. The object disappears from the active catalog immediately,
but its data is retained as an orphan that can be recovered with
`CREATE ... RELINK TO` until it is reclaimed.

```yaml
orphan_retention_ms: 604800000
orphan_reclaim_interval_ms: 300000
```

Settings:

- `orphan_retention_ms`: how long a dropped database or table remains eligible
  for recovery. The default is seven days. Set it to `0` or a negative value to
  keep orphans indefinitely.
- `orphan_reclaim_interval_ms`: how often the background reclaimer checks for
  expired orphans. The default is five minutes. Set it to `0` or a negative
  value to disable the automatic sweep.

Use `DROP ... FORCE` when you want immediate permanent deletion instead of a
recoverable orphan. See [Recover Dropped Objects](/docs/recover-dropped-objects)
for SQL examples and operational guidance.

## Key-Range Sharding

Set `key_range_sharding: true` to opt table row spaces and eligible secondary
index spaces into Kahuna key-range routing:

```yaml
key_range_sharding: true
```

`CAMUS_KEY_RANGE_SHARDING` overrides YAML when it is set. Use `1` or `true` to
enable it from the environment:

```bash
CAMUS_KEY_RANGE_SHARDING=true camusdb
```

Operational notes:

- `initial_partitions` must be at least `2` for key-range routing to have an
  effect.
- With a single partition, enabling the option is safe but effectively a no-op.
- The server logs a warning when key-range sharding is enabled and
  `initial_partitions < 2`.

## Table Statistics

CamusDB updates advisory row-count, index-count, and min/max statistics in
memory on DML and flushes them to durable storage on a schedule.

```yaml
stats_flush_interval_ms: 5000
stats_analyze_sample_rows: 100000
stats_histogram_buckets: 100
auto_analyze_enabled: true
auto_analyze_check_interval_ms: 60000
auto_analyze_fraction_stale_rows: 0.20
auto_analyze_min_stale_rows: 500
auto_analyze_max_concurrent: 1
auto_analyze_max_rows_per_second: 50000
auto_analyze_histogram_sample_rows: 10000
auto_analyze_hll_precision: 11
auto_analyze_load_pause_threshold: 16
auto_analyze_ownership_check_rows: 1000
```

Values:

- `5000`: default; flush at most about once every 5 seconds per table.
- `0`: flush after every change; highest write amplification.
- `-1`: disable automatic flush; persist on explicit flush or close only.

This affects planner statistics durability, not SQL correctness.

`ANALYZE TABLE <name>` builds richer statistics used by the cost-based
optimizer, including equi-depth histograms and distinct-value counts.

Automatic analyze refreshes stale table statistics in the background by
default. See
[Automatic Analyze](/docs/automatic-analyze) for staleness rules, resource
limits, and per-table opt-out syntax.

## Row-Level TTL

Row-level TTL deletes expired rows in the background. The node-level scheduler
is enabled by default, but a table is swept only after it sets
`ttl_expiration_expression`:

```yaml
ttl_enabled: true
ttl_default_job_cron: '@daily'
ttl_default_select_batch_size: 500
ttl_default_delete_batch_size: 100
ttl_default_select_rate_limit: 0
ttl_default_delete_rate_limit: 100
ttl_spans_per_table: 64
ttl_max_concurrent_spans_per_node: 1
ttl_load_pause_threshold: 16
ttl_span_lease_ms: 30000
ttl_span_lease_renew_interval_ms: 10000
```

`ttl_enabled` is the node-level master switch. When it is `false`, no TTL sweep
loop starts even if a table has TTL settings.

Table settings such as `ttl_expiration_expression`, `ttl_job_cron`,
`ttl_delete_batch_size`, and `ttl_delete_rate_limit` override the node defaults
for one table. See [Row-Level TTL](/docs/row-level-ttl) for the SQL syntax and
table-level parameters.

Operational notes:

- `ttl_default_job_cron` accepts `@hourly`, `@daily`, `@midnight`, `@weekly`,
  and `@monthly`.
- Batch sizes must be at least `1`.
- Rate limits are rows per second; `0` means unlimited.
- `ttl_load_pause_threshold <= 0` disables load backoff.
- `ttl_span_lease_renew_interval_ms` must be less than `ttl_span_lease_ms`.

## Cost-Based Optimizer

The optimizer uses statistics to compare access paths, join algorithms, and
eligible join orders. The broad cost-based search passes are enabled by
default:

```yaml
cost_based_access_path_enabled: true
cost_based_join_order_enabled: true
plan_cache_enabled: false
plan_cache_max_entries: 512
```

Values:

- `cost_based_access_path_enabled`: when `true`, CamusDB enumerates viable
  table/index access paths and chooses the cheapest estimated path. When
  `false`, it uses the stable heuristic index selector with the existing
  cost-based broad-range veto.
- `cost_based_join_order_enabled`: when `true`, CamusDB uses a System-R-style
  dynamic program to choose a cheaper connected left-deep order for eligible
  inner joins. When `false`, it uses the heuristic join order.

Both cost-based flags default to `true`. Missing statistics or unsupported
query shapes fall back to the heuristic planner.

The plan cache is also opt-in:

- `plan_cache_enabled`: when `true`, CamusDB can reuse a cached optimization
  decision for the same query shape and compatible schema versions.
- `plan_cache_max_entries`: maximum number of cached plan entries. Set to `0`
  to keep caching effectively disabled even if `plan_cache_enabled` is `true`.

The cache is per process and does not change query correctness. It may preserve
an older access-path choice until schema changes invalidate the cached entry or
the process restarts.

## Query Result Cache

The query result cache stores fully materialized result sets for repeated
single-table reads that explicitly opt in with a `{cache=...}` hint.

```yaml
query_result_cache_enabled: true
query_result_cache_default_ttl_ms: 5000
query_result_cache_max_entries: 1024
query_result_cache_max_bytes: 67108864
query_result_cache_max_entry_bytes: 1048576
query_result_cache_max_entry_rows: 10000
query_result_cache_max_deps: 4096
query_result_cache_max_point_deps: 2048
query_result_cache_max_ranges: 256
query_result_cache_singleflight_wait_ms: 250
query_result_cache_strict_validation_max_keys: 10000
query_result_cache_sweep_interval_ms: 10000
```

Settings:

- `query_result_cache_enabled`: master switch. When `false`, hinted queries
  read live storage and report `cache-disabled`.
- `query_result_cache_default_ttl_ms`: TTL for entries without a per-query
  `ttl=...` hint.
- `query_result_cache_max_entries`: maximum number of result-cache entries.
  Older entries are evicted by LRU behavior when the cap is exceeded.
- `query_result_cache_max_bytes`: total byte budget across all cached entries.
- `query_result_cache_max_entry_bytes`: per-entry byte cap. Larger results are
  returned normally but not cached.
- `query_result_cache_max_entry_rows`: per-entry row cap. Larger results are
  returned normally but not cached.
- `query_result_cache_max_deps`: maximum combined range, point, and schema
  dependencies recorded for one entry. Exceeding it prevents publishing the
  entry.
- `query_result_cache_max_point_deps`: maximum point-key dependencies recorded
  for one entry. Strict entries are not stored if point dependencies are
  truncated.
- `query_result_cache_max_ranges`: maximum range dependencies recorded for one
  entry.
- `query_result_cache_singleflight_wait_ms`: reserved for future single-flight
  miss de-duplication. Current concurrent misses may compute independently.
- `query_result_cache_strict_validation_max_keys`: maximum probe budget for
  strict validation. Exceeding it treats the entry as stale and re-executes the
  query.
- `query_result_cache_sweep_interval_ms`: how often the background sweep removes
  expired entries.

The cache is enabled by default but inert until a query uses `{cache=...}` or
`@{cache=...}`. See [Query Result Cache](/docs/query-result-cache) for query
syntax, cache metadata, freshness behavior, and manual eviction.

## Spill To Disk

Spill-to-disk lets blocking query operators use temporary files when their
intermediate row buffers grow past a configured threshold:

```yaml
spill_enabled: false
spill_threshold_rows: 500000
spill_merge_fan_in: 16
```

Settings:

- `spill_enabled`: master switch. When `false`, blocking operators use their
  in-memory paths.
- `spill_threshold_rows`: per-operator row count before spilling starts. The
  setting is ignored when spilling is disabled.
- `spill_merge_fan_in`: maximum number of spill runs read at once during merge
  passes. Larger values reduce merge passes but use more open readers.

See [Spill To Disk](/docs/spill-to-disk) for supported operators, temporary
file layout, and failure behavior.

## Schema Limits

These settings bound schema growth and identifier sizes:

```yaml
max_identifier_length: 64
max_columns_per_table: 512
max_indexes_per_table: 64
max_tables_per_database: 10000
```

Set a value to `<= 0` to disable that specific limit. Exceeding one of these
limits returns `SchemaLimitExceeded`.

## SQL Parser Cache

These settings control the SQL parser AST cache:

```yaml
sql_parser_cache_ttl_seconds: 300
sql_parser_cache_max_entries: 2048
sql_parser_cache_sweep_seconds: 60
```

Details:

- `sql_parser_cache_ttl_seconds`: sliding TTL in seconds; `0` disables the
  cache.
- `sql_parser_cache_max_entries`: maximum number of distinct SQL texts to keep;
  `0` removes the cap.
- `sql_parser_cache_sweep_seconds`: how often the background sweep removes
  expired cache entries.

This cache affects parse overhead, not SQL semantics.

## Regex Safety Settings

Regex operators and regex scalar functions share the same compiled-pattern
cache and timeout settings:

```yaml
regex_match_timeout_ms: 250
regex_cache_max_entries: 1024
```

Settings:

- `regex_match_timeout_ms`: maximum time in milliseconds for a single regex
  match operation. A match that exceeds this limit fails with `InvalidInput`,
  or `CheckConstraintViolation` when the regex is being evaluated inside a
  check constraint.
- `regex_cache_max_entries`: maximum number of compiled regex patterns cached
  by the process. `0` disables caching. Queries still work when the cache is
  full; CamusDB compiles the pattern for the current operation and does not
  retain it.

These settings apply to `~`, `~*`, `!~`, `!~*`, and the `regexp_*` scalar
functions. See [Regex Functions](/docs/functions-regex) for function syntax,
flags, and matching rules.

## Engine Metrics

CamusDB observes embedded [Kahuna](https://kahunakv.github.io/) and
[Kommander](https://kahunakv.github.io/kommander.github.io/) metrics for
`SHOW ENGINE STATS` by default:

```yaml
engine_metrics_enabled: true
```

Set `engine_metrics_enabled: false` to detach the in-process engine metrics
listener. `SHOW ENGINE STATS` still succeeds, but returns zero rows.

This setting is independent from the standalone `diagnostics` exporters below.
See [Engine Stats](/docs/engine-stats) for the SQL statement, permissions, and
result columns.

## Diagnostics

Standalone diagnostics are opt-in:

```yaml
diagnostics:
  enabled: false
  prometheus_enabled: false
  prometheus_path: /metrics
  otlp_endpoint:
  trace_sample_ratio: 0.01
  include_runtime_metrics: true
```

When disabled, CamusDB does not register a metrics exporter, scrape endpoint,
trace exporter, or diagnostics collector. When enabled on a standalone node,
the server can expose Prometheus metrics and optional OpenTelemetry traces for
request handling, SQL execution, scans, query cache activity, transaction
commit, [Kahuna](https://kahunakv.github.io/),
[Kommander](https://kahunakv.github.io/kommander.github.io/), and runtime
metrics.

See [Performance Diagnostics](/docs/performance-diagnostics) for metric names,
security notes, and workload snapshot scripts.

## Kahuna Engine Options

The `kahuna` section is an allow-listed passthrough to embedded
[Kahuna](https://kahunakv.github.io/) options used by both standalone and
cluster nodes. Omit the section, or omit individual keys, to keep CamusDB's
mode-specific baseline. Standalone persistent storage uses RocksDB by default;
for cluster deployments, set the storage keys explicitly so every node uses the
same durable backend.

```yaml
kahuna:
  storage: rocksdb
  storage_revision: v1
  wal_storage: rocksdb
  wal_revision: v1
  wal_sync_writes: true
  wal_group_commit_linger_ms: 0
  wal_single_fsync_commit: false
  default_transaction_timeout_ms: 5000
  max_transaction_timeout_ms: 3600000
  default_admission_wait_ms: 5000
  max_admission_wait_ms: 30000
  max_concurrent_sessions: 0
  transaction_priority_reserved_slots: 0
  transaction_priority_aging_threshold: 1000
  transaction_priority_max_queued: 4096
  locks_workers: 8
  key_value_workers: 8
  background_writer_workers: 1
  read_io_threads: 8
  write_io_threads: 8
  start_election_timeout_ms: 2000
  end_election_timeout_ms: 4000
  start_election_timeout_increment_ms: 100
  end_election_timeout_increment_ms: 200
  heartbeat_interval_ms: 500
  voting_timeout_ms: 1500
  max_entries_per_actor: 50000
  max_bytes_per_actor: 268435456
  cache_entry_ttl_ms: 300000
  cache_entries_to_remove: 1000
  collection_interval_ms: 60000
  compact_every_operations: 1000
  compact_number_entries: 50
  max_entries_per_compaction: 5000
  rocksdb_shared_memory: true
  rocksdb_shared_memory_budget_mb: 320
  rocksdb_shared_memtable_budget_mb: 128
```

Allowed storage backends are `rocksdb`, `sqlite`, and `memory`. Use `rocksdb`
for the default durable path, `sqlite` when you specifically want SQLite-backed
embedded files, and `memory` only for development and tests because data is lost
on restart.

The allow-listed Kahuna keys are:

- storage settings: `storage`, `storage_revision`, `wal_storage`,
  `wal_revision`, `wal_sync_writes`, `wal_group_commit_linger_ms`, and
  `wal_single_fsync_commit`
- transaction and worker settings: `default_transaction_timeout_ms`,
  `max_transaction_timeout_ms`, `default_admission_wait_ms`,
  `max_admission_wait_ms`, `max_concurrent_sessions`,
  `transaction_priority_reserved_slots`,
  `transaction_priority_aging_threshold`, `transaction_priority_max_queued`,
  `locks_workers`, `key_value_workers`, `background_writer_workers`,
  `read_io_threads`, and `write_io_threads`
- Raft timing settings: `start_election_timeout_ms`,
  `end_election_timeout_ms`, `start_election_timeout_increment_ms`,
  `end_election_timeout_increment_ms`, `heartbeat_interval_ms`, and
  `voting_timeout_ms`
- in-memory actor bounds: `max_entries_per_actor` and `max_bytes_per_actor`
- time-based cache eviction: `cache_entry_ttl_ms`,
  `cache_entries_to_remove`, and `collection_interval_ms`
- Raft log compaction: `compact_every_operations`, `compact_number_entries`,
  and `max_entries_per_compaction`
- RocksDB shared memory: `rocksdb_shared_memory`,
  `rocksdb_shared_memory_budget_mb`, and
  `rocksdb_shared_memtable_budget_mb`
- backup and point-in-time recovery: `backup_dir`, `pitr_window_seconds`,
  `base_snapshot_interval_seconds`, `restore_root`,
  `allow_unconfined_remote_restore`, `backup_cluster_id`,
  `backup_mac_key_file`, `backup_retention_max_chains`,
  `backup_retention_max_age_seconds`, `backup_retention_max_bytes`,
  `backup_gc_interval_seconds`, and `backup_restore_throttle_bytes_per_sec`

Entry eviction has two controls. `max_entries_per_actor` and
`max_bytes_per_actor` bound actor memory by size, while
`collection_interval_ms` runs a background sweep that removes up to
`cache_entries_to_remove` entries older than `cache_entry_ttl_ms`.

Raft log compaction is controlled by `compact_every_operations`,
`compact_number_entries`, and `max_entries_per_compaction`. Tune them together:
one controls how often compaction runs, one controls how many trailing log
entries are retained, and one caps how much a single pass can remove.

### Memory-Proportional Cache Defaults

Four cache knobs are sized from the machine's available memory at startup when
you leave them unset, rather than sitting at a fixed value. Container limits are
respected.

| Setting | Default when unset | Clamped to |
| --- | --- | --- |
| `rocksdb_shared_memory_budget_mb` | 10% of RAM | 320 MiB – 2 GiB |
| `rocksdb_shared_memtable_budget_mb` | a quarter of the block cache | 128 MiB – 1 GiB |
| `max_bytes_per_actor` | 6.25% of RAM (at least 64 MiB for the layer) ÷ `key_value_workers` | 8 MiB – 2 GiB per actor |
| `max_entries_per_actor` | `max_bytes_per_actor` ÷ ~512 B | 10k – 4M |

That comes to roughly 16% of RAM across both cache layers, and never more than
4 GiB in total however large the machine is. On an 8 GiB, 8-core machine with none
of them set: an 819 MiB block cache, a 204 MiB memtable sub-budget, and
64 MiB × 8 = 512 MiB of actor caches — about 1.5 GiB.

The fractions and the ceilings are deliberately modest. An unconfigured node is
far more often a developer workstation or a CI container sharing the box with a
compiler and an IDE than a machine whose only job is CamusDB. Treat the sizing
above as a floor to build from: a dedicated server should raise all four
explicitly. An explicit value always wins over the computed one.

Note that the 6.25% share and its 64 MiB floor bound the actor-cache layer *as a
whole* and are then divided by `key_value_workers`; only the 8 MiB per-actor
minimum is per actor. Adding cores therefore splits the same budget more ways
rather than growing it, so a machine with many cores relative to its RAM does not
end up with a multiple of the intended share.

### WAL Durability And Throughput

`wal_sync_writes` controls whether each WAL write is fsynced for crash
durability before acknowledgement. Keep it `true` for production durability.
Use `false` only for development or bulk-load experiments where losing the most
recent unflushed WAL writes is acceptable.

Two WAL settings can improve write throughput while preserving the durable
acknowledgement contract:

- `wal_group_commit_linger_ms`: a small bounded wait, in milliseconds, that
  lets concurrent commits share one group fsync. `0` disables the linger. Try
  `1` or `2` for fsync-bound write-heavy workloads.
- `wal_single_fsync_commit`: allows eligible single-round autocommit proposals
  to acknowledge once the durable propose quorum is written, while the commit
  marker rides a later durable flush. This removes one serial fsync from the
  critical path without acknowledging an undurable commit.

Both settings affect latency/throughput tradeoffs, not SQL semantics. Compare
changes with the same workload shape and durability settings.

### RocksDB Shared Memory

When both the KV backend and WAL backend use RocksDB, CamusDB can share one
RocksDB block cache and one write-buffer manager across both embedded RocksDB
databases:

```yaml
kahuna:
  storage: rocksdb
  wal_storage: rocksdb
  rocksdb_shared_memory: true
  rocksdb_shared_memory_budget_mb: 320
  rocksdb_shared_memtable_budget_mb: 128
```

Settings:

- `rocksdb_shared_memory`: enables the shared RocksDB memory bundle. In
  CamusDB's RocksDB baselines this is enabled by default. Set it to `false`
  when you want the KV backend and WAL backend to use independent RocksDB
  memory resources.
- `rocksdb_shared_memory_budget_mb`: total shared block-cache budget in MiB.
  The memtable sub-budget lives inside this total.
- `rocksdb_shared_memtable_budget_mb`: memtable sub-budget in MiB, charged
  against the shared cache budget. It must be less than or equal to
  `rocksdb_shared_memory_budget_mb`.

The setting is active only when both `storage` and `wal_storage` are
`rocksdb`. If either side uses `sqlite` or `memory`, there is no second RocksDB
database to share with, so the shared-memory setting is ignored.

The feature changes only in-process RocksDB memory objects. It does not change
on-disk format, WAL semantics, recovery behavior, SQL behavior, or wire
protocols.

### Backups And Point-In-Time Recovery

Backups are off until `backup_dir` is set, and restore stays off until
`restore_root` is set on top of that. Both roots must be owner-only (`0700`) and
must not be symlinks.

```yaml
kahuna:
  backup_dir: /opt/camusdb/backups
  pitr_window_seconds: 3600
  base_snapshot_interval_seconds: 1800
  restore_root: /opt/camusdb/restores
  allow_unconfined_remote_restore: false
  backup_retention_max_chains: 0
  backup_retention_max_age_seconds: 0
  backup_retention_max_bytes: 0
  backup_gc_interval_seconds: 3600
  backup_restore_throttle_bytes_per_sec: 0
  backup_cluster_id: prod-cluster-a
  backup_mac_key_file: /etc/camusdb/backup.key
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `kahuna.backup_dir` | unset | Directory holding manifests and artifacts. Unset disables backups entirely. |
| `kahuna.pitr_window_seconds` | `3600` | How far back live WAL is retained for recovery. Must be `> 0` and `<= 21600`. |
| `kahuna.base_snapshot_interval_seconds` | `1800` | Base-image cadence. Must be `> 0` and `<=` the PITR window. |
| `kahuna.restore_root` | unset | Server-owned root that restore destinations are confined to. Unset keeps remote restore disabled. |
| `kahuna.allow_unconfined_remote_restore` | `false` | Allows restore to any absolute path. Insecure; avoid in production. |
| `kahuna.backup_retention_max_chains` | `0` | Keep at most N chains. `0` is unlimited. |
| `kahuna.backup_retention_max_age_seconds` | `0` | Delete chains older than this. `0` is unlimited. |
| `kahuna.backup_retention_max_bytes` | `0` | Cap total backup bytes. `0` is unlimited. |
| `kahuna.backup_gc_interval_seconds` | `3600` | Background GC cadence. `0` disables the tick; GC still runs after each backup. |
| `kahuna.backup_restore_throttle_bytes_per_sec` | `0` | Throughput budget for a restore's checkpoint copy. `0` is unlimited. |
| `kahuna.backup_cluster_id` | empty | Cluster identity stamped into manifests. Set the same value on every node. |
| `kahuna.backup_mac_key_file` | unset | HMAC-SHA-256 key file signing manifests. Same file on every node, kept outside `backup_dir`. |

`backup_dir`, `restore_root`, and `backup_mac_key_file` must not be blank when
the key is present. See [Backup And Restore](/docs/backup-and-restore) for the
API, the restore runbook, and the `CADB07xx` error codes.

Unknown `kahuna` keys are rejected at startup. Numeric worker, timeout, actor,
eviction, and compaction settings must be greater than `0`; when both election
timeout bounds are set, `start_election_timeout_ms` must be less than
`end_election_timeout_ms`.

## Validation Rules

CamusDB validates the resolved configuration after CLI overrides are applied.
Invalid configuration fails startup with `InvalidConfig`.

Important validation rules:

- `mode` must be `standalone` or `cluster`
- `raft_port`, `http_port`, `https_port`, and `grpc_port` must be in
  `1..65535`
- `raft_node_id` must be `> 0`
- `initial_partitions` must be `>= 1`
- `schema_ack_wait_timeout_ms` must be `> 0`
- `schema_ack_live_node_lease_ms` must be `> 0` or `-1`
- `default_isolation_level` must be `serializable` or `read_committed`
- `default_transaction_locking` must be `pessimistic` or `optimistic`
- `default_transaction_priority` must be `background`, `low`, `normal`,
  `high`, or `critical`
- `lock_escalation_threshold` and `lock_wait_deadline_ms` must be `> 0`
- `transaction_reaper_interval_ms` must be `> 0`
- `grpc_enabled` is boolean
- positive `range_lock_expires_ms` values must be at least `2x` the effective
  `kahuna.collection_interval_ms`
- `spill_enabled` is boolean
- `spill_threshold_rows` and `spill_merge_fan_in` must be `> 0`
- `diagnostics.trace_sample_ratio` must be in `0..1`
- `diagnostics.prometheus_path` must start with `/`
- `diagnostics.otlp_endpoint`, when set, must be an absolute URL
- `engine_metrics_enabled` is boolean
- `kahuna.wal_group_commit_linger_ms` must be `>= 0`
- `kahuna.max_concurrent_sessions` must be `>= 0`
- `kahuna.transaction_priority_reserved_slots`,
  `kahuna.transaction_priority_aging_threshold`, and
  `kahuna.transaction_priority_max_queued` must be `>= 0`
- when `kahuna.max_concurrent_sessions` is greater than `0`,
  `kahuna.transaction_priority_reserved_slots` must be less than
  `kahuna.max_concurrent_sessions`
- `kahuna.max_transaction_timeout_ms`, when set, must be `>=`
  `max_serializable_transaction_lifetime_ms`
- `stats_flush_interval_ms` must be `>= 0` or `-1`
- `stats_analyze_sample_rows` must be `>= 0`
- `stats_histogram_buckets` must be `>= 1`
- `auto_analyze_fraction_stale_rows` and `auto_analyze_min_stale_rows` must be
  `>= 0`
- `auto_analyze_max_concurrent` and
  `auto_analyze_histogram_sample_rows` must be `>= 1`
- `auto_analyze_hll_precision` must be in `4..16`
- `auto_analyze_ownership_check_rows` must be `>= 1`
- `ttl_enabled` is boolean
- `ttl_default_job_cron` must be `@hourly`, `@daily`, `@midnight`, `@weekly`,
  or `@monthly`
- `ttl_default_select_batch_size`, `ttl_default_delete_batch_size`,
  `ttl_spans_per_table`, `ttl_max_concurrent_spans_per_node`,
  `ttl_span_lease_ms`, and `ttl_span_lease_renew_interval_ms` must be `>= 1`
- `ttl_default_select_rate_limit` and `ttl_default_delete_rate_limit` must be
  `>= 0`
- `ttl_span_lease_renew_interval_ms` must be less than `ttl_span_lease_ms`
- `cost_based_access_path_enabled` and `cost_based_join_order_enabled` are
  booleans
- `regex_match_timeout_ms` must be `> 0`
- `regex_cache_max_entries` must be `>= 0`
- `kahuna.rocksdb_shared_memory_budget_mb` must be `> 0`
- `kahuna.rocksdb_shared_memtable_budget_mb` must be `> 0`
- `kahuna.rocksdb_shared_memtable_budget_mb` must be less than or equal to
  `kahuna.rocksdb_shared_memory_budget_mb` when shared RocksDB memory is active
- `plan_cache_enabled` is boolean
- `query_result_cache_enabled` is boolean
- `max_identifier_length`, `max_columns_per_table`,
  `max_indexes_per_table`, `max_tables_per_database`, `max_index_columns`,
  `max_index_include_tuple_bytes`, and `max_mutations_per_transaction` use
  `<= 0` to disable the corresponding limit
- `branch_snapshot_hold_lease_ms` must be `> 0`
- `sql_parser_cache_ttl_seconds` and `sql_parser_cache_max_entries` must be
  `>= 0`
- `sql_parser_cache_sweep_seconds` must be `> 0`
- `http_peers` count must match `peers` count when `http_peers` is supplied
- `peers` and `http_peers` entries must be valid `host:port` values

## Standalone Example

```yaml
data_dir: /var/lib/camusdb
mode: standalone
http_port: 5095
grpc_enabled: true
grpc_port: 5096
default_isolation_level: serializable
default_transaction_locking: pessimistic
stats_flush_interval_ms: 5000
stats_analyze_sample_rows: 100000
stats_histogram_buckets: 100
auto_analyze_enabled: true
cost_based_access_path_enabled: true
cost_based_join_order_enabled: true
plan_cache_enabled: true
plan_cache_max_entries: 512
query_result_cache_enabled: true
query_result_cache_default_ttl_ms: 5000
query_result_cache_max_entries: 1024
spill_enabled: false
sql_parser_cache_ttl_seconds: 300
sql_parser_cache_max_entries: 2048
sql_parser_cache_sweep_seconds: 60
kahuna:
  storage: rocksdb
  wal_storage: rocksdb
  wal_sync_writes: true
  wal_group_commit_linger_ms: 0
  wal_single_fsync_commit: false
  rocksdb_shared_memory: true
  rocksdb_shared_memory_budget_mb: 320
  rocksdb_shared_memtable_budget_mb: 128
```

Start with the YAML values:

```bash
camusdb --config /etc/camusdb/config.yml
```

Override only the HTTP port:

```bash
camusdb --config /etc/camusdb/config.yml --http-port=5096
```

## Cluster Example

```yaml
data_dir: /data
mode: cluster
node_name: camus-1
raft_node_id: 1
raft_host: 192.168.1.10
raft_port: 7070
http_port: 5095
grpc_enabled: true
grpc_port: 5096
initial_partitions: 3
peers:
  - 192.168.1.10:7070
  - 192.168.1.11:7072
  - 192.168.1.12:7074
http_peers:
  - 192.168.1.10:5095
  - 192.168.1.11:5096
  - 192.168.1.12:5097
schema_ack_wait_timeout_ms: 30000
schema_ack_live_node_lease_ms: 30000
key_range_sharding: true
default_transaction_locking: pessimistic
auto_analyze_enabled: true
cost_based_access_path_enabled: true
cost_based_join_order_enabled: true
plan_cache_enabled: true
plan_cache_max_entries: 512
query_result_cache_enabled: true
query_result_cache_default_ttl_ms: 5000
query_result_cache_max_entries: 1024
kahuna:
  storage: rocksdb
  wal_storage: rocksdb
  start_election_timeout_ms: 2000
  end_election_timeout_ms: 4000
```

Use `http_peers` whenever nodes do not all expose the API on the same HTTP
port.

The same node can be started with CLI overrides:

```bash
camusdb \
  --mode=cluster \
  --data-dir=/data \
  --http-port=5095 \
  --raft-nodename=camus-1 \
  --raft-nodeid=1 \
  --raft-host=192.168.1.10 \
  --raft-port=7070 \
  --initial-cluster-partitions=3 \
  --initial-cluster 192.168.1.10:7070 192.168.1.11:7072 192.168.1.12:7074 \
  --http-peers 192.168.1.10:5095 192.168.1.11:5096 192.168.1.12:5097
```

## Related Pages

See [Cluster Mode](/docs/cluster) for cluster startup,
[Distributed Schema Changes](/docs/distributed-schema) for the schema ack gate,
and [Transactions And Isolation](/docs/serializable-transactions) for
transaction behavior.
