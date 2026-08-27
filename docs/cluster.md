---
sidebar_position: 4
---

# Cluster mode

CamusDB runs standalone by default. Cluster mode does three things. It divides
the data across the nodes into partitions. It elects one leader for each
partition. It replicates each write through the Raft consensus algorithm.

CamusDB is in production use. Cluster mode is nevertheless an alpha feature. The
APIs and the storage formats can change between versions.

## Run a standalone node

Standalone is the default. It needs no cluster configuration:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

Use standalone mode for a local tutorial, for a quick experiment, and for
single-node development.

## Run a local cluster

The source repository includes a Docker Compose file for a cluster of three
nodes:

```bash
docker compose -f docker/local.yml up --build
```

The three nodes start on a private bridge network:

| Node | HTTP SQL endpoint | Raft port |
| --- | --- | --- |
| `camus1` | `localhost:5095` | `7070` |
| `camus2` | `localhost:5096` | `7072` |
| `camus3` | `localhost:5097` | `7074` |

Point `camus-cli` at any one of the three nodes. The gRPC API for clients is on
by default. Configure it per node with `grpc_enabled` and `grpc_port`.

## Run a cluster node manually

Each node needs five values: `--mode=cluster`, a unique node name, its Raft host
and port, the partition count, and the static list of peers. Put these values in
a `config.yml` file, or pass them as flags:

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
| `--raft-host` | Host address for Raft communication. |
| `--raft-port` | Port for Raft communication. |
| `--http-port` | Listener port of the HTTP API. |
| `--initial-cluster` | Static list of peers, in `host:port` form. |
| `--initial-cluster-partitions` | Number of Raft partitions to initialize. |
| `--http-peers` | HTTP endpoint of each peer, in the same order as `--initial-cluster`. |

A flag overrides the equivalent YAML value only when you supply the flag. The
same settings in YAML look like this:

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
separate volume for each node.

See [Configuration](/docs/configuration) for every YAML key and every flag.

## How distribution works

- CamusDB divides the data across the Raft partitions.
- Each partition elects its own leader.
- Every node exposes the database API.
- CamusDB routes a read and a write to the partition that owns the target key
  range.
- A read uses committed MVCC versions. A write uses locks, write intents, and
  atomic commit.
- A write across more than one partition uses two-phase commit.

Every row of a table lives under the same key prefix. An ordered table scan
therefore still works. The storage layer handles the partition ownership and the
replication.

By default, the node that receives a query executes the whole query. It reads a
remote page through the storage locator. Turn
[distributed queries](/docs/distributed-queries) on to change that behavior.
CamusDB then divides an eligible scan into one fragment per partition. It runs
each fragment on the node that owns the rows. It therefore applies the filters
and the aggregates before the data crosses the network.

## Multi-active availability

There is no single active process that can fail. An application talks to any
node that it can reach. CamusDB routes each write to the leader that can commit
it safely.

Two older models make the contrast clear:

| Model | Write path | Failure behavior |
| --- | --- | --- |
| Active/standby | One active node | A standby must become active before writes continue |
| Classic active-active | Any node | Needs conflict resolution to prevent a divergent state |
| CamusDB | Any node, routed to the partition leader | The remaining members of the partition elect a new leader |

A write on a three-node cluster with one partition follows these steps:

1. Node A is the partition leader.
2. A client sends a write to node B.
3. CamusDB routes the write to node A.
4. Node A replicates the change through Raft.
5. The transaction can commit after a majority accepts the change.
6. Nodes B and C elect a new leader if node A fails later.

### Consistency before split-brain writes

A partition needs enough healthy members to reach consensus. It stops all
commits when it cannot reach consensus. It does not accept a change that could
conflict with another copy of the same data.

Availability is useful only while the data stays correct. CamusDB therefore
takes the unavailable side of that trade.

Serializable isolation is the default in a cluster, exactly as it is on one
node. See [Transactions And Isolation](/docs/serializable-transactions) for the
guarantees. See
[Distributed Transactions And HLC](/docs/distributed-transactions) for the
cross-partition commit protocol.

Configuration uses the same machinery. CamusDB commits a setting from
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings) through Raft, on its own
partition. Every node therefore applies the settings in the same order. A node
that was down catches up on replay. There is no rolling restart, and no node
keeps a stale value.
