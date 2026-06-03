---
sidebar_position: 4
---

# Cluster Mode

CamusDB can run as a standalone node for local use or as a multi-node cluster.
Cluster mode partitions data across nodes, elects a leader for each partition,
and replicates writes through Raft consensus.

The cluster model is multi-active: each node can expose the database API, while
CamusDB routes writes to the leader for the partition that owns the target data.

CamusDB cluster mode is alpha-quality. Use it for testing and development, not
production workloads.

## Run A Local Cluster

The source repository includes a Docker Compose setup for a three-node cluster:

```bash
docker compose -f docker/local.yml up --build
```

This starts three CamusDB nodes on a private bridge network:

| Node | SQL/HTTP endpoint | Raft port |
| --- | --- | --- |
| `camus1` | `localhost:5095` | `7070` |
| `camus2` | `localhost:5096` | `7072` |
| `camus3` | `localhost:5097` | `7074` |

Connect with the SQL shell by pointing it at one of the node endpoints.

## Run A Standalone Node

Standalone mode is the default and does not require cluster configuration:

```bash
dotnet run --project CamusDB
```

Use standalone mode for local tutorials, quick experiments, and single-node
development.

## Run A Cluster Node Manually

Start each node with `--mode=cluster`, a unique node name, its Raft host and
port, the partition count, and the static peer list:

```bash
dotnet run --project CamusDB -- \
  --mode=cluster \
  --raft-nodename=camus-1 \
  --raft-host=192.168.1.10 \
  --raft-port=7070 \
  --initial-cluster-partitions=3 \
  --initial-cluster 192.168.1.10:7070 192.168.1.11:7072 192.168.1.12:7074
```

The supported cluster flags are:

| Flag | Purpose |
| --- | --- |
| `--mode` | `standalone` or `cluster`. |
| `--raft-nodename` | Unique node name in the cluster. |
| `--raft-host` | Host address used for Raft communication. |
| `--raft-port` | Port used for Raft communication. |
| `--initial-cluster` | Static peer list in `host:port` form. |
| `--initial-cluster-partitions` | Number of Raft partitions to initialize. |

CLI flags override matching values from `Config/config.yml`. See
[Configuration](/docs/configuration) for the full list of config keys and flags.

## Configuration

Cluster-related settings can also be provided in YAML:

```yaml
data_dir: /data/
mode: cluster
node_name: camus-1
raft_host: 192.168.1.10
raft_port: 7070
initial_partitions: 3
peers:
  - 192.168.1.11:7072
  - 192.168.1.12:7074
```

`data_dir` should point to persistent storage for each node. The included Docker
Compose setup mounts a separate volume for each node.

## How Distribution Works

- Data is partitioned across Raft partitions.
- Every node can expose the database API.
- Each partition elects its own leader.
- Reads and writes are routed to the partition that owns the target key range.
- Transactions use serializable isolation by default.
- Cross-partition writes use two-phase commit.

The current storage layout keeps all rows for a table under the same key prefix,
which preserves ordered table scans while the distributed storage layer handles
partition ownership and replication.
