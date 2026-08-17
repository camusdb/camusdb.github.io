---
sidebar_position: 4
---

# Cluster Mode

CamusDB runs standalone by default. Cluster mode partitions data across nodes,
elects a leader per partition, and replicates writes through Raft consensus.

Cluster mode is alpha-quality. Use it for testing and development, not
production workloads.

## Run A Standalone Node

Standalone is the default and needs no cluster configuration:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

Use it for local tutorials, quick experiments, and single-node development.

## Run A Local Cluster

The source repository ships a Docker Compose file for a three-node cluster:

```bash
docker compose -f docker/local.yml up --build
```

Three nodes come up on a private bridge network:

| Node | HTTP SQL endpoint | Raft port |
| --- | --- | --- |
| `camus1` | `localhost:5095` | `7070` |
| `camus2` | `localhost:5096` | `7072` |
| `camus3` | `localhost:5097` | `7074` |

Point `camus-cli` at any one of them. The client-facing gRPC API is on by
default and configurable per node with `grpc_enabled` and `grpc_port`.

## Run A Cluster Node Manually

Each node needs `--mode=cluster`, a unique node name, its Raft host and port,
the partition count, and the static peer list. These can live in a `config.yml`
or be passed as flags:

```bash
camusdb \
  --mode=cluster \
  --raft-nodename=camus-1 \
  --raft-host=192.168.1.10 \
  --raft-port=7070 \
  --http-port=5095 \
  --initial-cluster-partitions=3 \
  --initial-cluster 192.168.1.10:7070 192.168.1.11:7072 192.168.1.12:7074 \
  --http-peers 192.168.1.10:5095 192.168.1.11:5096 192.168.1.12:5097
```

| Flag | Purpose |
| --- | --- |
| `--config` | Explicit YAML configuration file. A missing explicit file is a startup error. |
| `--mode` | `standalone` or `cluster`. |
| `--raft-nodename` | Unique node name in the cluster. |
| `--raft-nodeid` | Numeric Raft node id. |
| `--raft-host` | Host address used for Raft communication. |
| `--raft-port` | Port used for Raft communication. |
| `--http-port` | HTTP API listener port. |
| `--initial-cluster` | Static peer list in `host:port` form. |
| `--initial-cluster-partitions` | Number of Raft partitions to initialize. |
| `--http-peers` | Per-peer HTTP endpoints, parallel to `--initial-cluster`. |

A flag overrides the matching YAML value only when it is actually provided. The
same settings in YAML:

```yaml
data_dir: /data/
mode: cluster
node_name: camus-1
raft_host: 192.168.1.10
raft_port: 7070
initial_partitions: 3
http_port: 5095
peers:
  - 192.168.1.10:7070
  - 192.168.1.11:7072
  - 192.168.1.12:7074
http_peers:
  - 192.168.1.10:5095
  - 192.168.1.11:5096
  - 192.168.1.12:5097
```

Give each node its own persistent `data_dir`. The Docker Compose setup mounts a
separate volume per node.

See [Configuration](/docs/configuration) for every YAML key and flag.

## How Distribution Works

- Data is partitioned across Raft partitions.
- Each partition elects its own leader.
- Every node exposes the database API.
- Reads and writes are routed to the partition owning the target key range.
- Reads use committed MVCC versions; writes use locks, intents, and atomic
  commit.
- Writes spanning more than one partition use two-phase commit.

All rows for a table live under the same key prefix, so ordered table scans
still work while the storage layer handles partition ownership and replication.

By default a query is executed entirely by the node that received it, reading
remote pages through the storage locator. Turning on
[distributed queries](/docs/distributed-queries) instead splits an eligible scan
into one fragment per partition and runs each fragment on the node that owns the
rows, so filters and aggregates are applied before the data crosses the network.

## Multi-Active Availability

There is no single active process to fail over. Applications talk to whichever
node they can reach, and CamusDB routes each write to the leader that can
safely commit it.

The contrast is with two older shapes:

| Model | Write path | Failure behavior |
| --- | --- | --- |
| Active/standby | One active node | A standby must be promoted before writes resume |
| Classic active-active | Any node | Needs conflict resolution to avoid divergent state |
| CamusDB | Any node, routed to the partition leader | Remaining partition members elect a new leader |

Walking through a write on a three-node, single-partition cluster:

1. Node A is the partition leader.
2. A client sends a write to node B.
3. CamusDB routes it to node A.
4. Node A replicates the change through Raft.
5. Once a majority accepts it, the transaction can commit.
6. If node A later fails, nodes B and C elect a new leader.

### Consistency Over Split-Brain Writes

A partition needs enough healthy members to reach consensus. When it cannot, it
stops committing writes rather than accepting changes that might conflict with
another copy of the same data. Availability is only useful while the data stays
correct, so CamusDB takes the unavailable side of that trade.

Serializable isolation is the default in a cluster exactly as it is on one
node. See [Transactions And Isolation](/docs/serializable-transactions) for the
guarantees and [Distributed Transactions And HLC](/docs/distributed-transactions)
for the cross-partition commit protocol.

Configuration rides the same machinery. A setting changed with
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings) is committed through Raft
on its own partition, so every node applies it in the same order and a node that
was down catches up on replay. There is no rolling restart, and no node left on
a stale value.
