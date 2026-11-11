---
title: Settings reference
description: Every key a CamusDB node accepts, with its default, type, and whether a change needs a restart.
hide_table_of_contents: true
---

# Settings reference

This page lists every setting that a CamusDB node accepts, with its default,
its type, when a change takes effect, and whether all nodes must agree. Each
variable that [`SHOW VARIABLES`](/docs/show-variables) lists has an entry here.
Use this page to look up a value that you see in that output, or to choose a
value before you edit `config.yml`.

For how to write `config.yml`, the order in which the configuration layers
apply, and the command-line flags, see [Configuration](/docs/configuration).

Most keys are top-level keys in `config.yml`. Two nested maps have their own
tables: [Kahuna keys](#kahuna-keys) and [Diagnostics keys](#diagnostics-keys).


The **Change** column says when a new value takes effect:

- **runtime**: you can change the value with
  [`SET CLUSTER SETTING`](/docs/runtime-cluster-settings), and the next
  statement or background pass uses it.
- **restart**: edit `config.yml` and restart the node. `SET CLUSTER SETTING`
  rejects the key, with six exceptions: it accepts those keys, but the node
  applies the new value only after a restart. Their rows and notes say so.

The **Scope** column says whether nodes must agree:

- **cluster**: every node must use the same value. A runtime change reaches
  every node.
- **node**: nodes may use different values, set in each node's `config.yml`. A
  `SET CLUSTER SETTING` value still applies to every node and overrides the file.

Sizes are in bytes and durations in milliseconds unless the key name says
otherwise (`_seconds`, `_mb`).

## Node identity and cluster membership

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `data_dir` | `~/.camusdb/data`, or `$CAMUS_HOME/data` | path | restart | node | Where the node stores its data. |
| `mode` | `standalone` | `standalone` or `cluster` | restart | node | Runs a single node, or a node in a Raft [cluster](/docs/cluster). |
| `memory_profile` | `prod` | `prod` or `dev` | restart | node | Sizes the storage caches that you leave unset. See [Memory profile](/docs/configuration#memory-profile). |
| `node_name` | `""`, then the machine name in cluster mode | string | restart | node | This node's name in the cluster. |
| `raft_node_id` | `1` | int | restart | node | Numeric Raft node id. Must be above `0`. |
| `raft_host` | `localhost` | string | restart | node | Host name of this node's Raft endpoint. |
| `raft_port` | `7070` | port | restart | node | Port for node-to-node Raft traffic. |
| `initial_partitions` | `1` standalone, `3` cluster | int | restart | cluster | Initial hash-pool partition count, fixed at first boot. Later values are ignored with a warning. Standalone mode always uses `1`. Must be at least `1`. |
| `peers` | `[]` | list of `host:port` | restart | node | Raft endpoints of the other nodes, or the seed nodes when `join_existing` is on. |
| `http_peers` | `[]` | list of `host:port` | restart | node | Each peer's HTTP address, in the same order as `peers`. The two lists must have the same length. |
| `join_existing` | `false` | bool | restart | node | Joins a running cluster as a new member, with `peers` as the seed list. Cluster mode only. |
| `pitr_bootstrap_from` | unset | backup id | restart | node | Seeds a joining node from this backup before it joins. Needs `join_existing` and `kahuna.backup_dir`. See [Backup and restore](/docs/backup-and-restore#seed-a-joining-node-from-a-backup). |
| `pitr_bootstrap_target_time_ms` | `0` | Unix time, ms | restart | node | Point in time to seed to. `0` is the latest point that the chain covers. Needs `pitr_bootstrap_from`. |
| `schema_ack_wait_timeout_ms` | `30000` | ms | restart | node | How long a DDL statement waits for every live node to acknowledge the previous schema version. See [Distributed schema](/docs/distributed-schema). |
| `schema_ack_live_node_lease_ms` | `30000` | ms | restart | node | How long after its last contact a node still counts as live for that wait. `-1` always waits for every configured node. |
| `schema_freshness_check_interval_ms` | `10000` | ms | restart | node | How often a cluster node compares each open database's schema with its durable checkpoint, and reloads the schema when it is behind. |
| `unhosted_control_log_probe_interval_ms` | `250` | ms | restart | node | How often a node probes the checkpoint of a control log (schema or cluster settings) whose Raft partition it does not host. This matters when `kahuna.replication_factor` is below the node count. `0` or less turns the probe off. |
| `coordinator_job_sweep_interval_ms` | `10000` | ms | restart | node | How often the schema leader of each open database looks for a staged schema change, such as `CREATE INDEX` or `ALTER TABLE ... ADD COLUMN`, whose driver stopped, and finishes it. A failed attempt retries with a backoff that doubles each time. Runs in standalone and cluster mode. `0` or less turns the sweep off. |
| `registry_generation_lease_ms` | `250` | ms | restart | cluster | How long a cluster node trusts its cached database names. `DROP DATABASE` and `RENAME DATABASE` wait out one lease before they return. `0` checks on every lookup. Ignored in standalone mode. |
| `database_idle_eviction_ms` | `900000` | ms | restart | node | How long an unused database stays open on this node before the node frees its memory. `0` or less keeps it open. |
| `extension_assemblies` | `[]` | list of paths | restart | node | [C# extension](/docs/csharp-extensions) DLLs loaded with the safe-assembly checks. |
| `unsafe_extension_assemblies` | `[]` | list of paths | restart | node | Reviewed extension DLLs loaded without the safe-assembly checks. |

## Inline C# functions and triggers

All keys below require a restart. See [inline C# definitions](/docs/csharp-extensions#inline-functions).

| Key | Default | Type | Change | Scope | Description |
| --- | --- | --- | --- | --- | --- |
| `inline_functions_enabled` | `false` | bool | restart | cluster | Accept CREATE FUNCTION. Existing functions still run when disabled. |
| `inline_triggers_enabled` | `false` | bool | restart | cluster | Accept CREATE TRIGGER ... LANGUAGE csharp. Existing triggers still fire when disabled. |
| `inline_function_call_timeout_ms` | `1000` | ms | restart | cluster | Time budget per function call or trigger fire, excluding nested trigger SQL. Zero or less disables it. |
| `inline_function_allocation_limit_bytes` | `16777216` (16 MiB) | bytes | restart | cluster | Managed allocation per call/fire, excluding nested SQL. Zero or less disables it. |
| `inline_function_array_limit` | `1048576` | elements | restart | cluster | Maximum elements in `new T[n]`. Zero or less disables it; other allocations still use the memory budget. |
| `inline_function_source_limit_bytes` | `65536` | UTF-8 bytes | restart | cluster | Maximum source body size; must be positive. |
| `inline_function_compile_timeout_ms` | `10000` | ms | restart | node | Compile deadline, including wait for a compile slot; must be positive. |
| `inline_function_compile_concurrency` | `2` | int | restart | node | Concurrent inline compiles on this node; must be positive. |
| `max_inline_functions_per_database` | `256` | int | restart | cluster | Maximum inline functions in one database. Zero or less disables it. |

## Network, TLS, and client protocols

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `http_port` | `5095` | port | restart | node | [HTTP API](/docs/http-api) port. |
| `https_port` | `7141` | port | restart | node | HTTPS port. It opens only when `https_certificate` is set. |
| `https_certificate` | `""` | path | restart | node | PFX certificate for the HTTPS port. Empty means no HTTPS. |
| `http3_enabled` | `false` | bool | restart | node | Also serves HTTP/3 on the HTTPS port. See [HTTP/3](/docs/configuration#http3-on-the-https-port). |
| `grpc_enabled` | `true` | bool | restart | node | Opens the client-facing [gRPC API](/docs/grpc-api). |
| `grpc_port` | `5096` | port | restart | node | gRPC API port. |
| `grpc_certificate` | `""` | path | restart | node | PFX certificate for the gRPC port. Empty falls back to `raft_certificate`. |
| `grpc_tls_enabled` | `true` | bool | restart | node | `false` serves gRPC as plaintext h2c even when a certificate is set. |
| `grpc_batch_max_in_flight` | `64` | int | runtime | node | Operations one `BatchExecute` stream may run at once before backpressure. |
| `raft_certificate` | `""` | path | restart | node | PFX certificate for the Raft port in cluster mode. |
| `raft_mutual_tls_enabled` | `false` | bool | restart | node | Cluster mode: each peer must present a client certificate that chains to `raft_peer_ca`. Needs `raft_certificate` and `raft_peer_ca`. |
| `raft_peer_ca` | `""` | path | restart | node | PEM file with the CA that peer certificates must chain to. Use a CA that signs only this cluster's nodes, because the node accepts every certificate it signed. |
| `peer_tls_enabled` | `false` | bool | restart | node | Reaches peer HTTP endpoints over HTTPS. See [Cluster peer transport](/docs/configuration#cluster-peer-transport). |
| `require_tls_when_auth_enabled` | `true` | bool | runtime | node | With authentication on, refuses credentials sent over plaintext, except from loopback. |
| `sql_routing_advice_enabled` | `true` | bool | restart | node | Adds [routing advice](/docs/sql-routing-advice) to responses for clients that ask for it. |
| `sql_routing_advice_ttl_ms` | `5000` | ms | restart | node | Maximum age at which a client may reuse an advertised route. `1` to `600000`. |

## Authentication and sessions

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
| `authentication_cache_max_entries` | `10000` | int | restart | node | Per-node authentication cache size limit. |
| `session_reaper_interval_ms` | `300000` | ms | restart | node | How often expired session records are deleted. `0` or less turns the sweep off. |
| `expired_session_retention_ms` | `300000` | ms | restart | cluster | How long a session record is kept after it expires, so a long-lived stream can tell expiry from revocation. |

The five keys below come only from environment variables. `config.yml` does
not accept them. [`SHOW VARIABLES`](/docs/show-variables) lists them with
source `env` when the variable is set, and masks the three secrets.

| Key | Environment variable | Type | Change | Scope | Description |
|-----|----------------------|------|--------|-------|-------------|
| `authentication_enabled` | `CAMUSDB_AUTH_ENABLED` | bool | restart | cluster | `true` requires a valid token on every request and checks privileges on every statement. Any other value, or no value, turns authentication off. |
| `access_token_server_key` | `CAMUSDB_AUTH_TOKEN_KEY` | secret | restart | cluster | Key that hashes each access-token secret (HMAC) before the session catalog stores it, so a copy of the catalog does not give usable tokens. Required while authentication is on. At least 32 bytes. Same value on every node. |
| `bootstrap_superuser` | `CAMUSDB_BOOTSTRAP_USER` | string | restart | node | Name of the first superuser. CamusDB creates it at the first start with authentication, when no user exists yet. After that, CamusDB ignores it and logs a warning. |
| `bootstrap_superuser_password` | `CAMUSDB_BOOTSTRAP_PASSWORD` | secret | restart | node | Password of the bootstrap superuser. CamusDB uses it once and never stores it in cleartext. |
| `node_secret` | `CAMUSDB_NODE_SECRET` | secret | restart | node | Shared secret for node-to-node forwarding routes while authentication is on. Without it, a cluster node refuses those routes. At least 32 bytes when set. Same value on every node. |

## Transactions and locking

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
| `lock_escalation_threshold` | `50` | int | runtime | cluster | Number of shared point locks in one table or index bucket after which a serializable read-write transaction takes one shared lock on the whole bucket. |
| `lock_wait_deadline_ms` | `500` | ms | runtime | cluster | Longest time one lock-acquire retry loop waits during a serializable conflict. |
| `replication_wait_deadline_ms` | `5000` | ms | runtime | cluster | Longest time a lock or write waits on a key whose value is still replicating, or whose previous writer committed but did not settle yet. This wait is not a lock conflict, so it has its own budget, separate from `lock_wait_deadline_ms`. When the budget runs out, the statement fails with a retryable error. Must be above `0`. |
| `max_mutations_per_transaction` | `20000` | int | runtime | cluster | Number of row and index-entry writes one transaction may make. `0` or less turns the limit off. |
| `key_range_sharding` | `false` | bool | restart | cluster | Routing mode fixed at cluster creation. Unset nodes follow the stored mode; an explicit mismatch refuses startup. See [Key-range sharding](/docs/configuration#key-range-sharding-and-range-splits). |

## Request resource limits

These runtime settings bound the work and state a node accepts. A value of
`0` or below disables the corresponding cap.

| Key | Default | Unit | Change | Scope | Meaning |
| --- | --- | --- | --- | --- | --- |
| `max_statement_bytes` | `8388608` (8 MiB) | UTF-8 bytes | runtime | node | Maximum inline SQL before parsing; excess fails with `CADB0557`, HTTP 413. Bound parameter values are excluded. |
| `max_buffered_result_rows` | `1000000` | rows | runtime | node | Rows held for one buffered response; excess fails with `CADB0556`. |
| `max_buffered_result_bytes` | `268435456` (256 MiB) | estimated bytes | runtime | node | Memory estimate for one buffered response; excess fails with `CADB0556`. |
| `max_open_explicit_transactions` | `10000` | transactions | runtime | node | Open explicit transactions per node; excess begins fail with `CADB0558`, HTTP 503. Autocommit is excluded. |
| `max_client_connections` | `10000` | connections | runtime | node | Open HTTP, HTTPS, and gRPC client connections; excess connections are closed before reading a request. Raft is excluded. |
| `max_databases` | `10000` | databases | runtime | cluster | Registry capacity for creates, branch creates, and relinks; excess fails with `CADB0408`. |
| `cluster_activity_max_concurrent_fan_outs` | `8` | requests | runtime | node | Concurrent SHOW CLUSTER QUERIES/CONNECTIONS requests; excess fails with `CADB0558`. |

Buffered results are checked before commit, so exceeding a cap rolls back the
statement. The byte estimate includes in-memory overhead and counts strings
at two bytes per character; it is not the JSON payload size. Ordinary streaming
reads bypass these result caps. Writes with RETURNING, and locking reads that
buffer before autocommit, can still hit them even on a streaming endpoint.

Lowering the connection cap does not close existing connections. Transaction
slots are released on commit, rollback, reaping, or a failed begin. Database
capacity is checked against each node's registry view: concurrent creates on
different nodes can briefly overshoot it, so it is not a strict global quota.

These settings do not impose per-client request rates or a statement execution
timeout. A small response can still require a large scan. Prepared statements
also have the separate `max_prepared_statement_bytes` cap. See
[transaction limits](/docs/transaction-limits) and
[query activity](/docs/query-activity) for operational guidance.

## Prepared statements

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

## Query planning and statistics

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
| `plan_cache_max_entries` | `512` | int | runtime | node | Plan cache size limit. |
| `bound_query_cache_enabled` | `true` | bool | runtime | node | Reuses name resolution for cached `SELECT` text across executions. |

## Automatic ANALYZE

See [Automatic ANALYZE](/docs/automatic-analyze).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `auto_analyze_enabled` | `true` | bool | runtime | cluster | Refreshes statistics in the background. |
| `auto_analyze_check_interval_ms` | `60000` | ms | runtime | cluster | How often the leader looks for stale tables. `0` or less turns the loop off. |
| `auto_analyze_fraction_stale_rows` | `0.20` | double | runtime | cluster | A table is stale once its changes since the last `ANALYZE` reach this fraction of its rows, plus `auto_analyze_min_stale_rows`. |
| `auto_analyze_min_stale_rows` | `500` | rows | runtime | cluster | Minimum changes before a table can be stale. |
| `auto_analyze_max_concurrent` | `1` | int | runtime | node | Number of background analyses that may run at once on this node. |
| `auto_analyze_max_rows_per_second` | `50000` | rows/s | runtime | cluster | Scan rate limit. `0` or less removes the limit. |
| `auto_analyze_histogram_sample_rows` | `10000` | rows | runtime | cluster | Sample size per column for background histograms. |
| `auto_analyze_hll_precision` | `11` | int | runtime | cluster | Distinct-count sketch precision. `4` to `16`. |
| `auto_analyze_load_pause_threshold` | `16` | transactions | runtime | node | Pauses background analysis while more foreground transactions than this are running. `0` or less turns the pause off. |
| `auto_analyze_ownership_check_rows` | `1000` | rows | runtime | cluster | Rows scanned between checks for lost leadership and foreground load. |

## Query execution

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `max_query_parallelism` | `1` | int | runtime | node | Workers one full table scan may use. `1` scans sequentially. More workers use more memory and do not change results or row order. |
| `index_scan_fetch_batch_size` | `64` | rows | runtime | node | Row ids a non-covering index scan collects before it fetches the rows in one batch. |
| `distributed_query_execution` | `false` | bool | restart | cluster | Splits eligible scans of key-range-sharded tables into per-range fragments. See [Distributed queries](/docs/distributed-queries). |
| `broadcast_join_max_build_rows` | `10000` | rows | runtime | node | Largest hash-join build side that may be sent to remote fragments. `0` turns broadcast joins off. |
| `hash_join_max_build_rows` | `1000000` | rows | runtime | node | When spill is off, a hash-join build larger than this falls back to a nested-loop join. |
| `regex_match_timeout_ms` | `250` | ms | runtime | node | Time limit for one [regex](/docs/functions-regex) match. |
| `slot_backed_decode` | `true` | bool | runtime | node | Internal row-decode mode. Keep the default. |
| `borrowed_decode` | `adaptive` | `adaptive`, `force_eager`, `force_borrowed` | runtime | node | Internal zero-copy decode policy. Keep the default. |

## Spill to disk

See [Spill to disk](/docs/spill-to-disk).

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `spill_enabled` | `false` | bool | runtime | node | Lets sorts, joins, and aggregations write to temporary files when they grow too large. |
| `spill_threshold_rows` | `500000` | rows | runtime | node | Rows one operator keeps in memory before it spills. Must be above `0`. |
| `spill_threshold_bytes` | `268435456` | bytes | runtime | node | Bytes one operator keeps in memory before it spills. The operator spills at whichever limit it reaches first. |
| `spill_merge_fan_in` | `16` | int | runtime | node | Spill files merged in one pass. Must be above `0`. |
| `spill_max_frame_bytes` | `268435456` | bytes | runtime | node | Largest record that a spill file may declare. A larger length is treated as corruption. |
| `spill_max_total_bytes` | `8589934592` | bytes | runtime | node | Total size of all spill files on this node. A statement that would exceed it fails. |

`SHOW VARIABLES` also lists `force_spill_threshold_rows`, with the value
`null`. This is a test hook that makes every operator spill on small inputs.
No configuration layer sets it, and it has no production use.

## Caches

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `sql_parser_cache_ttl_seconds` | `300` | seconds | runtime | node | How long a parsed statement stays cached after its last use. `0` turns the cache off. |
| `sql_parser_cache_max_entries` | `2048` | int | runtime | node | Parser cache size limit. `0` means no limit. |
| `sql_parser_cache_sweep_seconds` | `60` | seconds | runtime | node | How often expired parser-cache entries are removed. Must be above `0`. |
| `sql_parser_cache_max_bytes` | `67108864` | bytes | runtime | node | Approximate parser cache memory limit. `0` means no limit. |
| `regex_cache_max_entries` | `1024` | int | runtime | node | Compiled regex patterns kept in memory. `0` turns caching off. |
| `point_read_row_id_cache_enabled` | `true` | bool | restart | node | Remembers which row a primary key points to, so a repeated point lookup needs one storage read instead of two. |
| `point_read_row_id_cache_max_entries` | `1000000` | int | restart | node | Number of keys remembered per table. The cache is cleared when it fills up. |

## Query result cache

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

## Schema limits

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

## Large values and disk space

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

## Row-level TTL

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
| `ttl_spans_per_table` | `64` | int | runtime | cluster | Number of spans a table is divided into for each run. |
| `ttl_max_concurrent_spans_per_node` | `1` | int | runtime | node | Number of spans one node processes at once. |
| `ttl_load_pause_threshold` | `16` | transactions | runtime | node | Pauses the sweep while more foreground transactions than this are running. `0` or less turns the pause off. |
| `ttl_span_lease_ms` | `30000` | ms | runtime | cluster | Lease on a claimed span. Another node takes over a span whose lease lapses. |
| `ttl_span_lease_renew_interval_ms` | `10000` | ms | runtime | cluster | How often the owner renews its span lease. Must be below `ttl_span_lease_ms`. |

## Materialized views, branches, and dropped objects

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
| `keyspace_purge_batch_size` | `512` | keys | runtime | node | Keys per `DROP DATABASE` purge batch. Each batch shares one delete-many round trip, bounding memory and amortizing Raft work. |

## Observability and the dashboard

| Key | Default | Type | Change | Scope | Description |
|-----|---------|------|--------|-------|-------------|
| `engine_metrics_enabled` | `true` | bool | restart | node | Collects storage-engine metrics for [`SHOW ENGINE STATS`](/docs/engine-stats). |
| `slow_query_log_enabled` | `false` | bool | runtime | node | Records slow statements; enabling or disabling takes effect on the next statement. See [Slow query log](/docs/configuration#slow-query-log). |
| `slow_query_log_threshold_ms` | `1000` | ms | runtime | node | Statements at least this slow are recorded. `0` records every statement. |
| `slow_query_log_max_entries` | `200` | int | restart | node | Entries the log keeps. |
| `slow_query_log_max_sql_length` | `4096` | characters | runtime | node | SQL text stored per slow entry or statement-statistics sample. |
| `statement_stats_enabled` | `false` | bool | runtime | node | Collects per-shape [statement statistics](/docs/statement-stats). Disabling preserves totals. |
| `statement_stats_max_shapes` | `2000` | int | restart | node | Maximum recorded shapes. Existing shapes are retained; new admissions are refused at capacity. |
| `index_usage_enabled` | `true` | bool | runtime | node | Collects [index usage](/docs/index-usage) reads, constraint reads, and writes. Disabling preserves counters. |
| `query_activity_enabled` | `true` | bool | runtime | node | Lists running statements for [`SHOW QUERIES`](/docs/query-activity) and `CANCEL QUERY`. |
| `query_activity_max_sql_length` | `1024` | characters | runtime | node | SQL text shown per `SHOW QUERIES` row. |
| `cluster_activity_peer_timeout_ms` | `2000` | ms | runtime | node | How long `SHOW CLUSTER QUERIES`, `SHOW CLUSTER CONNECTIONS`, and a forwarded `CANCEL QUERY` wait for each peer. |
| `dashboard_enabled` | `true` | bool | restart | node | Serves the [operator dashboard](/docs/operator-dashboard). |
| `dashboard_refresh_seconds` | `2` | seconds | runtime | node | Dashboard load panel refresh interval. The server clamps it to `1` to `300`. |
| `query_tracing_enabled` | `false` | bool | runtime | node | Logs one line per executed plan step. |
| `lock_tracing_enabled` | `false` | bool | runtime | node | Logs one line per lock acquired. |

## Kahuna keys

Every key below goes under the `kahuna:` map. Each one is read once when the
node starts, so a change requires a restart, and `SET CLUSTER SETTING` rejects
it. Each node reads its own file; where a row says so, give every node the same
value.

"Kahuna default" means the value comes from the storage engine itself.

### Storage and Raft log

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.storage` | `rocksdb` | `memory`, `sqlite`, `rocksdb`, `solarium` | Key-value storage backend. |
| `kahuna.storage_revision` | `v2` | string | On-disk layout revision of the store. Read [Kahuna engine section](/docs/configuration#kahuna-engine-section) before you change it. |
| `kahuna.wal_storage` | `rocksdb` | `memory`, `sqlite`, `rocksdb`, `solarium` | Raft log backend. |
| `kahuna.solarium_environment` | `default` | `default`, `io_uring` | File I/O for [Solarium](https://solariumdb.github.io/) layers; io_uring requires Linux support. |
| `kahuna.storage_compaction_rate_mbps` | unset | integer MB/s | KV flush/compaction pacing for RocksDB or Solarium; 0 means unlimited. |
| `kahuna.storage_max_background_compactions` | unset | int | KV compaction concurrency; 0 uses the engine default. |
| `kahuna.wal_revision` | `v2` | string | On-disk layout revision of the Raft log. |
| `kahuna.wal_sync_writes` | `true` (Kahuna default) | bool | Controls Raft log write syncing for backends that honor it. With `false`, an operating system crash or power loss can lose recent log entries. SQLite Raft metadata uses `synchronous=NORMAL` regardless of this flag. |
| `kahuna.raft_lost_acknowledged_entries_policy` | `quarantine` | `quarantine`, `accept_and_log` | Restart-only policy when recovery finds lost acknowledged log entries. See [storage damage and lost log entries](/docs/configuration#storage-damage-and-lost-log-entries) before changing it. |
| `kahuna.wal_group_commit_linger_ms` | `0` (Kahuna default) | ms | How long a log writer waits to group more commits into one fsync. `0` turns the wait off. |
| `kahuna.wal_single_fsync_commit` | `true` | bool | Acknowledges an autocommit write once a majority has stored it, and writes its commit marker with the next flush. This removes one fsync from the commit path. |
| `kahuna.wal_shard_write_buffer_size_mb` | unset (`64`) | MiB | See [Raft WAL shard column families](/docs/configuration#raft-wal-shard-column-families) for this key and the next seven. `1` to `65536`. |
| `kahuna.wal_shard_min_write_buffer_number_to_merge` | unset (`2`) | int | `1` to `64`. |
| `kahuna.wal_shard_max_write_buffer_number` | unset (`4`) | int | `1` to `64`. Must exceed the merge count. |
| `kahuna.wal_shard_level0_file_num_compaction_trigger` | unset (`8`) | int | `1` to `64`. |
| `kahuna.wal_shard_level0_slowdown_writes_trigger` | unset (`28`) | int | `1` to `64`. |
| `kahuna.wal_shard_level0_stop_writes_trigger` | unset (`44`) | int | `1` to `64`. |
| `kahuna.wal_shard_max_bytes_for_level_base_mb` | unset (`256`) | MiB | `1` to `65536`. |
| `kahuna.wal_shard_universal_compaction` | unset (`false`) | bool | Universal instead of leveled compaction. |

### Transactions and admission

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
| `kahuna.transaction_outcome_retention_ttl_ms` | `300000` (Kahuna default) | ms | How long a finished transaction's outcome record is kept. `0` turns age pruning off. See [Transaction outcome retention](/docs/configuration#transaction-outcome-retention). |
| `kahuna.transaction_outcome_retention_max` | `10000` (Kahuna default) | int | Outcome records kept per node. |
| `kahuna.one_phase_apply_time_validation` | `true` | bool | Lets an eligible single-partition read-modify-write commit in one Raft round. Same value on every node. See [One-phase apply-time validation](/docs/configuration#one-phase-apply-time-validation). |
| `kahuna.staged_base_fence_retention_ms` | `600000` (Kahuna default) | ms | How long the validation fence remembers committed keys. Same value on every node. Must be above `0`. |
| `kahuna.durable_materialize_on_resolve` | `true` | bool | A committed transaction installs its values on every replica when it resolves, instead of writing a separate record per key. During a rolling upgrade from a Kahuna version older than 1.10.1, set it to `false` until every node is upgraded. |
| `kahuna.scan_page_retry_budget_ms` | `5000` (Kahuna default) | ms | How long one range-scan page retries transient errors before the scan fails with an error that names the range. Keep it below the client command deadline. |

### Workers and threads

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.locks_workers` | max(32, 4 × CPU cores) | int | Lock actors. Each lock resource is served by one of them. |
| `kahuna.key_value_workers` | max(32, 4 × CPU cores) | int | Key-value actors. Each key is served by one of them. |
| `kahuna.background_writer_workers` | `1` (Kahuna default) | int | Workers that write changed objects to the storage backend. |
| `kahuna.read_io_threads` | `4` (Kahuna default) | int | Threads that serve Raft log reads. |
| `kahuna.write_io_threads` | `8` (Kahuna default) | int | Threads that flush Raft log writes. |

All five must be above `0` when set.

### Raft timing

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.start_election_timeout_ms` | `2000` cluster, `500` standalone | ms | Lower bound of the random election timeout. Must be below `kahuna.end_election_timeout_ms`. |
| `kahuna.end_election_timeout_ms` | `4000` cluster, `1500` standalone | ms | Upper bound of the random election timeout. |
| `kahuna.start_election_timeout_increment_ms` | `100` (Kahuna default) | ms | Added to the lower bound after each failed election round. |
| `kahuna.end_election_timeout_increment_ms` | `200` (Kahuna default) | ms | Added to the upper bound after each failed election round. |
| `kahuna.heartbeat_interval_ms` | `100` (Kahuna default) | ms | How often a leader sends heartbeats. |
| `kahuna.recent_heartbeat_ms` | a quarter of `kahuna.heartbeat_interval_ms` | ms | A leader skips the heartbeat to a peer it contacted this recently. Must be below `kahuna.heartbeat_interval_ms`. |
| `kahuna.voting_timeout_ms` | `1500` (Kahuna default) | ms | How long a candidate waits for votes before it starts a new election round. |

### Caches, eviction, and log compaction

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.max_entries_per_actor` | computed from memory | int | Cached entries per actor. See [Cache defaults proportional to memory](/docs/configuration#cache-defaults-proportional-to-memory). |
| `kahuna.max_bytes_per_actor` | computed from memory | bytes | Cache size per actor. |
| `kahuna.cache_entry_ttl_ms` | `300000` (Kahuna default) | ms | Idle time after which the collection sweep may evict a cached entry. |
| `kahuna.cache_entries_to_remove` | `1000` (Kahuna default) | int | Entries one collection pass evicts. |
| `kahuna.collection_interval_ms` | `60000` (Kahuna default) | ms | How often the collection sweep runs. `range_lock_expires_ms` must be at least twice this value. |
| `kahuna.compact_every_operations` | `1000` (Kahuna default) | int | Persisted Raft log batches between compaction passes. |
| `kahuna.compact_number_entries` | `50` (Kahuna default) | int | Trailing log entries each pass keeps. |
| `kahuna.max_entries_per_compaction` | `5000` (Kahuna default) | int | Log entries one pass may delete. |
| `kahuna.rocksdb_shared_memory` | `true` | bool | One RocksDB block cache and write-buffer budget for both the store and the Raft log. Only applies when both use `rocksdb`. |
| `kahuna.rocksdb_shared_memory_budget_mb` | computed from memory | MiB | Shared cache for RocksDB or [Solarium](https://solariumdb.github.io/), sized from machine/container memory. |
| `kahuna.rocksdb_shared_memtable_budget_mb` | computed from memory | MiB | Shared memtable sub-budget for RocksDB or Solarium. Must not exceed `kahuna.rocksdb_shared_memory_budget_mb`. |
| `kahuna.rocksdb_direct_reads` | `false` | bool | Reads SST files with direct I/O, past the operating system page cache. |

The count and size keys above must be above `0` when set.

### Write aggregation keys

See [Write aggregation](/docs/configuration#write-aggregation).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.key_value_write_max_in_flight_batches_per_partition` | `1` (Kahuna default) | int | Write batches a partition may have waiting on Raft. `1` to `64`. |
| `kahuna.key_value_write_linger_ms` | `1` (Kahuna default) | ms | How long the oldest queued write may wait while nothing is in flight. `0` to `1000`. |
| `kahuna.key_value_write_post_completion_hold_ms` | `1` | ms | Wait after a batch completes before the next one is sent. `0` to `1000`. |
| `kahuna.key_value_write_precise_wake` | `false` (Kahuna default) | bool | Runs the aggregator's timers on a dedicated thread. |
| `kahuna.key_value_write_fill_target_trigger` | `false` (Kahuna default) | bool | Sends a held batch as soon as it reaches the learned fill target. |
| `kahuna.key_value_write_max_batch_items` | `512` (Kahuna default) | int | Items per write batch. `1` to `65536`. |

### Backup and point-in-time recovery

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

`SHOW VARIABLES` also lists a top-level `pitr_window_seconds`. It is a copy of
the effective `kahuna.pitr_window_seconds`, `3600` when that key is unset. The
restore command uses it to reject a target time outside the window. You cannot
set it directly. Set `kahuna.pitr_window_seconds` instead.

### Row history retention

See [Persistent MVCC revision retention](/docs/configuration#persistent-mvcc-revision-retention) and
[Time travel reads](/docs/time-travel-reads).

| Key | Default | Type | Description |
|-----|---------|------|-------------|
| `kahuna.persistent_revision_retention_age_seconds` | `kahuna.pitr_window_seconds` when both retention keys are unset | seconds | Age after which old row versions are pruned. `0` turns age pruning off. A nonzero value must be at least the PITR window. |
| `kahuna.persistent_revision_retention_count` | `0` | int | Row versions kept per key. `0` turns count pruning off. |

### Range splits and merges

These apply only with [key-range sharding](/docs/key-range-sharding). See
[Key-range sharding and range splits](/docs/configuration#key-range-sharding-and-range-splits).

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

### Replica placement and leader balancing

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

## Diagnostics keys

Keys under the `diagnostics:` map export server metrics and traces. Everything is off by
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
