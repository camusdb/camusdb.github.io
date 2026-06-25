---
sidebar_position: 8
---

# Configuration

CamusDB reads `Config/config.yml` at startup, merges explicit command-line
flags, validates the result, and then applies the resolved configuration before
the server starts accepting work.

Precedence is:

1. command-line flags
2. environment variables
3. `Config/config.yml`
4. built-in defaults

Only flags you pass explicitly override YAML values. Omitting a flag keeps the
value from `config.yml`.

## Default File

The source repository ships a commented configuration reference at
`CamusDB/Config/config.yml`. Its only active setting is:

```yaml
data_dir: /tmp/camusdb/
```

The commented sections show the available server, cluster, transaction, parser,
and Kahuna engine settings. For real deployments, set `data_dir` to persistent
storage instead of relying on `/tmp`.

## Unified Reference

Most startup settings can now be configured either in `config.yml` or by a
matching command-line flag. CLI flags are useful for containers, scripts, and
per-node cluster settings; YAML is better for stable node configuration.

| YAML key | CLI flag | Default | Purpose |
| --- | --- | --- | --- |
| `data_dir` | `--data-dir` | empty, with runtime fallback | Base directory for persisted database files. |
| `mode` | `--mode` | `standalone` | Run mode: `standalone` or `cluster`. |
| `node_name` | `--raft-nodename` | empty | Optional cluster node name; cluster mode falls back to the machine name when empty. |
| `raft_node_id` | `--raft-nodeid` | `1` | Numeric Raft node id. Must be greater than `0`. |
| `raft_host` | `--raft-host` | `localhost` | Host address used for Raft communication. |
| `raft_port` | `--raft-port` | `7070` | Port used for Raft gRPC traffic. |
| `initial_partitions` | `--initial-cluster-partitions` | `1` | Number of Raft partitions to initialize. |
| `peers` | `--initial-cluster` | empty list | Static Raft peer list in `host:port` form. |
| `http_peers` | `--http-peers` | empty list | Per-peer HTTP addresses, parallel to `peers`. |
| `schema_ack_wait_timeout_ms` | `--schema-ack-wait-timeout-ms` | `30000` | DDL schema-ack wait timeout in milliseconds. |
| `schema_ack_live_node_lease_ms` | `--schema-ack-live-node-lease-ms` | `30000` | DDL live-node lease in milliseconds, or `-1` for infinite. |
| `http_port` | `--http-port` | `5095` | HTTP API listener port. |
| `https_port` | `--https-port` | `7141` | HTTPS API listener port when a certificate is configured. |
| `https_certificate` | `--https-certificate` | empty | Path to a PFX certificate for the HTTPS API listener; empty disables HTTPS. |
| `raft_certificate` | `--raft-certificate` | empty | Path to a PFX certificate for the Raft gRPC listener in cluster mode. |

The remaining YAML settings do not currently have command-line flags:

| YAML key | Default | Purpose |
| --- | --- | --- |
| `default_isolation_level` | `serializable` | Default transaction isolation when a request does not choose one. |
| `range_lock_expires_ms` | `30000` | Serializable range-lock TTL; `<= 0` disables expiry. |
| `range_lock_heartbeat_interval_ms` | `10000` | Renewal interval for live range locks. |
| `max_serializable_transaction_lifetime_ms` | `3600000` | Maximum Serializable read-write transaction lifetime; `<= 0` disables the cap. |
| `lock_escalation_threshold` | `50` | Shared point-lock count per bucket before escalation. |
| `lock_wait_deadline_ms` | `500` | Per-operation Serializable conflict wait cap. |
| `key_range_sharding` | `false` | Opt tables and eligible indexes into Kahuna key-range routing. |
| `stats_flush_interval_ms` | `5000` | Advisory table-statistics flush interval. |
| `sql_parser_cache_ttl_seconds` | `300` | Sliding TTL for cached SQL ASTs; `0` disables the parser cache. |
| `sql_parser_cache_max_entries` | `2048` | Maximum cached SQL texts; `0` means unbounded. |
| `sql_parser_cache_sweep_seconds` | `60` | Background sweep interval for expired parser-cache entries. |
| `kahuna` | empty mapping | Allow-listed storage and Raft engine overrides. |

Cluster mode is active when either `mode: cluster` is set or `peers` contains
at least one entry.

## Server And Cluster Settings

### `data_dir`

`data_dir` controls where CamusDB stores persistent state.

- In standalone mode, explicitly created databases use storage under this base
  path.
- In cluster mode, process-level KV and WAL paths are created under this base
  path.

Databases must be created explicitly. In standalone mode, each database is
stored under an immutable id directory inside `data_dir`; renaming the database
does not rename or move that directory.

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
```

Use `read_committed` only when you explicitly want weaker isolation by default.
Individual SQL/API transactions can still request an isolation level.

Locking settings tune Serializable read-write behavior:

```yaml
range_lock_expires_ms: 30000
range_lock_heartbeat_interval_ms: 10000
max_serializable_transaction_lifetime_ms: 3600000
lock_escalation_threshold: 50
lock_wait_deadline_ms: 500
```

Operational notes:

- `range_lock_heartbeat_interval_ms` must be less than
  `range_lock_expires_ms` when lock expiry is enabled.
- `max_serializable_transaction_lifetime_ms` limits how long an active
  Serializable read-write transaction can remain open.
- `lock_escalation_threshold` keeps lock bookkeeping bounded by escalating many
  point locks in the same bucket.
- `lock_wait_deadline_ms` limits how long a single lock acquisition waits before
  surfacing a Serializable conflict.

## Key-Range Sharding

Set `key_range_sharding: true` to opt table row spaces and eligible secondary
index spaces into Kahuna key-range routing:

```yaml
key_range_sharding: true
```

`CAMUS_KEY_RANGE_SHARDING` overrides YAML when it is set. Use `1` or `true` to
enable it from the environment:

```bash
CAMUS_KEY_RANGE_SHARDING=true dotnet run --project CamusDB
```

Operational notes:

- `initial_partitions` must be at least `2` for key-range routing to have an
  effect.
- With a single partition, enabling the option is safe but effectively a no-op.
- The server logs a warning when key-range sharding is enabled and
  `initial_partitions < 2`.

## Table Statistics

CamusDB updates advisory row-count statistics in memory on DML and flushes them
to durable storage on a schedule.

```yaml
stats_flush_interval_ms: 5000
```

Values:

- `5000`: default; flush at most about once every 5 seconds per table.
- `0`: flush after every change; highest write amplification.
- `-1`: disable automatic flush; persist on explicit flush or close only.

This affects planner statistics durability, not SQL correctness.

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

## Kahuna Engine Options

The `kahuna` section is an allow-listed passthrough to embedded
[Kahuna](https://kahunakv.github.io/) options used by both standalone and
cluster nodes. Omit the section, or omit individual keys, to keep CamusDB's
mode-specific baseline.

```yaml
kahuna:
  storage: sqlite
  storage_revision: v1
  wal_storage: sqlite
  wal_revision: v1
  wal_sync_writes: true
  default_transaction_timeout_ms: 5000
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
  compact_every_operations: 1000
```

Allowed storage backends are `memory`, `sqlite`, and `rocksdb`.

Unknown `kahuna` keys are rejected at startup. Numeric worker, timeout, actor,
and compaction settings must be greater than `0`; when both election timeout
bounds are set, `start_election_timeout_ms` must be less than
`end_election_timeout_ms`.

## Validation Rules

CamusDB validates the resolved configuration after CLI overrides are applied.
Invalid configuration fails startup with `InvalidConfig`.

Important validation rules:

- `mode` must be `standalone` or `cluster`
- `raft_port`, `http_port`, and `https_port` must be in `1..65535`
- `raft_node_id` must be `> 0`
- `initial_partitions` must be `>= 1`
- `schema_ack_wait_timeout_ms` must be `> 0`
- `schema_ack_live_node_lease_ms` must be `> 0` or `-1`
- `default_isolation_level` must be `serializable` or `read_committed`
- `range_lock_heartbeat_interval_ms` must be less than
  `range_lock_expires_ms` when expiry is enabled
- `lock_escalation_threshold` and `lock_wait_deadline_ms` must be `> 0`
- `stats_flush_interval_ms` must be `>= 0` or `-1`
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
default_isolation_level: serializable
stats_flush_interval_ms: 5000
sql_parser_cache_ttl_seconds: 300
sql_parser_cache_max_entries: 2048
sql_parser_cache_sweep_seconds: 60
kahuna:
  storage: sqlite
  wal_storage: sqlite
```

Start with the YAML values:

```bash
dotnet run --project CamusDB
```

Override only the HTTP port:

```bash
dotnet run --project CamusDB -- --http-port=5096
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
kahuna:
  storage: sqlite
  wal_storage: sqlite
  start_election_timeout_ms: 2000
  end_election_timeout_ms: 4000
```

Use `http_peers` whenever nodes do not all expose the API on the same HTTP
port.

The same node can be started with CLI overrides:

```bash
dotnet run --project CamusDB -- \
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
