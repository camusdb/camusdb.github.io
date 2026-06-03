---
sidebar_position: 8
---

# Configuration

CamusDB reads `Config/config.yml` at startup. Command-line flags can override
cluster and network settings when running the server manually or in containers.

The default standalone configuration is intentionally small:

```yaml
data_dir: /tmp/camusdb/
```

`data_dir` is the most important setting. It points to the directory where
CamusDB stores database state. In standalone mode, each opened database creates
its own storage directories under this path. In cluster mode, the node uses the
path for the shared KV and WAL storage directories.

## Config File Keys

| Key | Default | Purpose |
| --- | --- | --- |
| `data_dir` | `Data` | Directory for persisted database files. |
| `mode` | `standalone` | `standalone` or `cluster`. |
| `node_name` | Machine name in cluster mode | Human-readable node name. |
| `raft_host` | `localhost` | Host address advertised for Raft communication. |
| `raft_port` | `7070` | Port used for Raft communication. |
| `initial_partitions` | `1` | Number of Raft partitions to initialize. |
| `peers` | empty list | Static peer list in `host:port` form. |

Cluster mode is enabled when `mode: cluster` is set or when `peers` contains at
least one entry.

## Standalone Example

```yaml
data_dir: /var/lib/camusdb
mode: standalone
```

Standalone mode is the default. Use it for local development, tutorials, and
single-node experiments.

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
  - 192.168.1.11:7070
  - 192.168.1.12:7070
```

Each node should use a persistent `data_dir` and a unique `node_name`. The
`peers` list should contain the Raft addresses for the cluster members.

## Command-Line Overrides

The server also accepts command-line flags:

| Flag | Purpose |
| --- | --- |
| `--mode` | Override run mode: `standalone` or `cluster`. |
| `--raft-nodename` | Override `node_name`. |
| `--raft-nodeid` | Numeric node id used by the Raft layer. |
| `--raft-host` | Override `raft_host`. |
| `--raft-port` | Override `raft_port`. |
| `--initial-cluster` | Override `peers`; pass a space-separated `host:port` list. |
| `--initial-cluster-partitions` | Override `initial_partitions`. |
| `--http-port` | HTTP listener port. |
| `--https-port` | HTTPS listener port. |
| `--raft-certificate` | Optional PFX certificate path for the Raft gRPC port. |

Example:

```bash
dotnet run --project CamusDB -- \
  --mode=cluster \
  --raft-nodename=camus-1 \
  --raft-host=192.168.1.10 \
  --raft-port=7070 \
  --initial-cluster-partitions=3 \
  --initial-cluster 192.168.1.10:7070 192.168.1.11:7070 192.168.1.12:7070
```

## Notes

- CLI flags override matching `Config/config.yml` values.
- Keep `data_dir` on persistent storage if you want data to survive restarts.
