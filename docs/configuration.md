---
sidebar_position: 8
---

# Configuration

CamusDB reads `Config/config.yml` at startup, validates it, and then applies the
resulting settings before the server begins normal work.

There are two sources of configuration:

- YAML file keys in `Config/config.yml`
- Command-line flags passed to `dotnet run --project CamusDB -- ...`

Some settings exist only as CLI flags today, especially HTTP/TLS listener
settings.

## Default File

The source repository currently ships this minimal config file:

```yaml
data_dir: /tmp/camusdb/
```

That means the out-of-the-box sample config uses `/tmp/camusdb/` unless you
change it.

For real deployments, set `data_dir` explicitly instead of relying on implicit
startup defaults.

## YAML Keys

These are the available keys in `Config/config.yml` today:

| Key | Default if omitted | Purpose |
| --- | --- | --- |
| `data_dir` | `Data` | Base directory for persisted database files. |
| `mode` | `standalone` | Run mode: `standalone` or `cluster`. |
| `node_name` | empty | Optional node name. In cluster mode, runtime falls back to the machine name when this is empty. |
| `raft_host` | `localhost` | Host advertised for Raft communication. |
| `raft_port` | `7070` | Port used for Raft communication. |
| `initial_partitions` | `1` | Number of Raft partitions to initialize. |
| `peers` | empty list | Static Raft peer list in `host:port` form. |
| `http_peers` | empty list | Per-peer HTTP addresses in `host:httpPort` form, parallel to `peers`. |
| `schema_ack_wait_timeout_ms` | `30000` | Cluster DDL ack wait timeout in milliseconds. |
| `schema_ack_live_node_lease_ms` | `-1` | Cluster DDL live-node lease in milliseconds, or `-1` for infinite. |
| `stats_flush_interval_ms` | `5000` | Background advisory table-statistics flush interval in milliseconds. |
| `sql_parser_cache_ttl_seconds` | `300` | Sliding TTL for the SQL parser AST cache; `0` disables the cache. |
| `sql_parser_cache_max_entries` | `2048` | Maximum cached SQL texts; `0` means unbounded. |
| `sql_parser_cache_sweep_seconds` | `60` | Background sweep interval for removing expired parser-cache entries. |

Cluster mode is active when either `mode: cluster` is set or `peers` contains
at least one entry.

## Key Details

### `data_dir`

`data_dir` controls where CamusDB stores persistent state.

- In standalone mode, opened databases create storage under this base path.
- In cluster mode, the process-level shared KV and WAL paths are created under
  this base path.

Use persistent storage here if you expect data to survive restarts.

### `peers` and `http_peers`

`peers` contains the Raft endpoints used for static cluster discovery:

```yaml
peers:
  - 192.168.1.10:7070
  - 192.168.1.11:7072
  - 192.168.1.12:7074
```

`http_peers` is optional, but important when HTTP listener addresses do not
match a simple "same host, shared HTTP port" pattern:

```yaml
http_peers:
  - 192.168.1.10:5095
  - 192.168.1.11:5096
  - 192.168.1.12:5097
```

Rules:

- `http_peers`, when present, must have the same number of entries as `peers`.
- Each `peers` entry must be valid `host:port`.
- Each `http_peers` entry must also be valid `host:port`.

If `http_peers` is omitted, CamusDB falls back to a uniform-port heuristic for
resolving a schema leader's HTTP address.

### Schema ack settings

These two settings control the distributed schema two-version gate in cluster
mode:

- `schema_ack_wait_timeout_ms`
  - How long a DDL proposer waits for all live nodes to acknowledge the needed
    schema version before failing the operation.
- `schema_ack_live_node_lease_ms`
  - Controls whether the leader waits on every configured live member
    conservatively (`-1`) or uses a finite liveness window for follower
    reachability.
  - `-1` means infinite lease.

Most users should keep the defaults unless they are testing cluster DDL behavior
or diagnosing slow convergence.

### `stats_flush_interval_ms`

CamusDB updates advisory row-count statistics in memory on DML and flushes them
to durable storage on a schedule.

Values:

- `5000`
  - Default. Flush at most about once every 5 seconds per table.
- `0`
  - Flush after every change. Highest write amplification.
- `-1`
  - Disable automatic flush; persist on explicit flush or close only.

This affects planner statistics durability, not SQL correctness.

### SQL parser cache settings

These settings control the SQL parser AST cache:

- `sql_parser_cache_ttl_seconds`
  - Sliding TTL in seconds.
  - `0` disables the cache, so every SQL text is parsed from scratch.
- `sql_parser_cache_max_entries`
  - Maximum number of distinct SQL texts to keep.
  - `0` removes the cap.
- `sql_parser_cache_sweep_seconds`
  - How often the background sweep removes expired cache entries.

This cache affects parse overhead, not SQL semantics.

## Validation Rules

CamusDB validates config on startup and rejects invalid values early.

Important validation rules:

- `mode` must be `standalone` or `cluster`
- `raft_port` must be in `1..65535`
- `initial_partitions` must be `>= 1`
- `schema_ack_wait_timeout_ms` must be `> 0`
- `schema_ack_live_node_lease_ms` must be `> 0` or `-1`
- `stats_flush_interval_ms` must be `>= 0` or `-1`
- `sql_parser_cache_ttl_seconds` must be `>= 0`
- `sql_parser_cache_max_entries` must be `>= 0`
- `sql_parser_cache_sweep_seconds` must be `> 0`
- `http_peers` count must match `peers` count when `http_peers` is supplied

## Standalone Example

```yaml
data_dir: /var/lib/camusdb
mode: standalone
stats_flush_interval_ms: 5000
sql_parser_cache_ttl_seconds: 300
sql_parser_cache_max_entries: 2048
sql_parser_cache_sweep_seconds: 60
```

Standalone mode is the default and the simplest option for tutorials, local
development, and single-node testing.

## Cluster Example

```yaml
data_dir: /data
mode: cluster
node_name: camus-1
raft_host: 192.168.1.10
raft_port: 7070
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
schema_ack_live_node_lease_ms: -1
stats_flush_interval_ms: 5000
sql_parser_cache_ttl_seconds: 300
sql_parser_cache_max_entries: 2048
sql_parser_cache_sweep_seconds: 60
```

Use `http_peers` whenever nodes do not all expose the API on the same HTTP
port.

## Command-Line Flags

These flags are accepted by the current server process:

| Flag | Default | Purpose |
| --- | --- | --- |
| `--mode` | `standalone` | Override run mode. |
| `--raft-nodename` | empty | Override `node_name`. |
| `--raft-nodeid` | `1` | Numeric node id for the Raft layer. |
| `--raft-host` | `localhost` | Override `raft_host`. |
| `--raft-port` | `7070` | Override `raft_port`. |
| `--initial-cluster` | empty | Override `peers`; pass a space-separated `host:port` list. |
| `--initial-cluster-partitions` | `1` | Override `initial_partitions`. |
| `--http-port` | `5095` | HTTP API listener port. |
| `--https-port` | `7141` | HTTPS API listener port. |
| `--https-certificate` | empty | Optional PFX certificate path for the HTTPS API listener. |
| `--raft-certificate` | empty | Optional PFX certificate path for the Raft gRPC listener. |

Example:

```bash
dotnet run --project CamusDB -- \
  --mode=cluster \
  --http-port=5095 \
  --raft-nodename=camus-1 \
  --raft-nodeid=1 \
  --raft-host=192.168.1.10 \
  --raft-port=7070 \
  --initial-cluster-partitions=3 \
  --initial-cluster 192.168.1.10:7070 192.168.1.11:7072 192.168.1.12:7074
```

## YAML vs CLI

Current behavior matters here:

- YAML controls the persistent engine and cluster settings listed above.
- CLI flags override matching YAML values for `mode`, `node_name`, `raft_host`,
  `raft_port`, `initial_partitions`, and `peers` when explicitly supplied.
- HTTP and HTTPS listener ports and certificate paths are CLI-only in the
  current source tree.
- `stats_flush_interval_ms` and the SQL parser cache settings are applied
  process-wide before the engine starts.
- `data_dir` is YAML-driven in the current source tree.

## Related Pages

See [Cluster Mode](/docs/cluster) for cluster startup, [Distributed Schema Changes](/docs/distributed-schema)
for the schema ack gate settings, and [Architecture](/docs/architecture) for the broader
system layout.
