---
sidebar_position: 4
---

# Multi-Active Availability

CamusDB's cluster mode is designed so applications do not have to treat one
database process as the only active endpoint. A cluster can run multiple nodes,
partition data across Raft groups, and route work to the partition leader that
can safely commit it.

CamusDB is alpha-quality software. This page describes the cluster availability
model and project direction; it is not a production-readiness claim.

## Why Multi-Active?

Traditional high availability designs often make one node active and keep one
or more standby nodes ready to take over. That model is simple, but it creates a
single active write path. If the active node fails, the system has to promote a
standby before applications can continue.

Traditional active-active designs let more than one node receive traffic, but
they need a way to prevent conflicting writes from creating divergent state.

CamusDB's cluster model uses consensus replication to combine the operational
shape of active-active systems with a consistency-first commit path.

## CamusDB's Model

In cluster mode:

- Every CamusDB process exposes the database API.
- Data is assigned to Raft partitions.
- Each partition elects its own leader.
- Writes are routed to the leader for the partition that owns the target keys.
- A write is committed only through the partition's consensus protocol.
- If a partition leader fails, the remaining members can elect a new leader.

This means the application can connect to a running node in the cluster while
CamusDB handles partition ownership and leader routing internally.

## Consistency Over Split-Brain Writes

CamusDB favors a consistent committed state over accepting conflicting writes on
isolated replicas. In practical terms, a partition needs enough healthy members
to reach consensus. If it cannot reach consensus, it should stop committing
writes rather than accept changes that might conflict with another copy of the
same data.

That tradeoff is important for transactional systems: availability is useful
only when the data remains correct.

## Example

Consider a three-node cluster with one partition:

1. Node A is the leader for the partition.
2. A client sends a write to node B.
3. CamusDB routes the write to the partition leader.
4. The leader replicates the change through Raft.
5. Once consensus accepts the write, the transaction can commit.
6. If node A fails later, nodes B and C can elect a new leader.

The client-facing shape is multi-active: applications are not tied to a single
primary process. The commit path remains consensus-backed: CamusDB does not let
independent nodes accept incompatible versions of the same row.

## Relationship To Transactions

Serializable transactions are the default. For writes that touch more than one
partition, CamusDB uses two-phase commit so each participating partition can
coordinate a single transaction outcome.

This matters when availability and correctness interact. The cluster can route
work across active nodes, but it still commits transactions through a
consistency-preserving protocol.

## Try It Locally

Start the included three-node cluster:

```bash
docker compose -f docker/local.yml up --build
```

The nodes listen on:

| Node | Endpoint | Raft port |
| --- | --- | --- |
| `camus1` | `localhost:5095` | `7070` |
| `camus2` | `localhost:5096` | `7072` |
| `camus3` | `localhost:5097` | `7074` |

Then connect the SQL shell to one of the running nodes:

```bash
camus-cli
```

For startup flags and configuration, see [Cluster Mode](/docs/cluster).
