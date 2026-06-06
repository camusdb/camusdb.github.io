---
sidebar_position: 6
---

# Distributed Schema Changes

CamusDB treats schema as distributed state, not as a local side table that each
node updates independently. In cluster mode, table, column, and index changes
flow through the same replicated system that protects data writes.

This page explains what that means for users operating CamusDB clusters:

- Schema changes have one ordered source of truth.
- Nodes converge on the same schema version before the next stage proceeds.
- Online changes are staged so readers and writers do not jump across
  incompatible layouts.
- DDL forwarded from a follower is re-executed on the schema leader with retry
  deduplication.
- Restarts and leader changes do not lose committed schema work.

CamusDB cluster mode is alpha-quality. Use it for testing and development, not
production workloads.

## Why This Exists

In a distributed database, schema changes are harder than single-node DDL.
Different nodes may receive requests at different times. Some nodes may be
slower, restart mid-change, or lose leadership. If schema were only updated as
local metadata, one node could accept writes with a newer definition while
another still reads with an older one.

CamusDB avoids that by treating schema as a replicated state machine. The
cluster agrees on the order of schema changes first, and each node applies the
same committed changes in that order.

## Source Of Truth

For a database running in cluster mode, the source of truth is the committed
schema log in [Kommander](https://kahunakv.github.io/kommander.github.io/), not
an arbitrary local metadata file.

Each schema change is stored as a small change record:

- Create or drop a table.
- Add or drop a column.
- Add or drop an index.
- Advance a column or index from one visibility state to the next.

Once a schema entry is committed through Raft, every node applies that same
entry in the same order. Persisted metadata in KV storage acts as a checkpoint
for faster restart, but the committed schema log is the authoritative history.

## Versions And Convergence

CamusDB versions schema changes monotonically:

- The database schema has a version counter.
- Each table also carries its own version.
- Stored rows keep the schema version they were written with.

That versioning gives the cluster a precise way to answer two questions:

1. Which schema should a transaction use?
2. Has every live node reached the same schema yet?

CamusDB uses acknowledgements from live nodes to know when a committed schema
version has been applied everywhere. Before the system advances to the next
stage of an online change, it waits for the current stage to converge across
the live cluster.

The practical effect is simple: a schema change is not just "committed on a
leader". It is staged so the cluster can move forward without letting schema
versions drift arbitrarily apart.

CamusDB enforces a two-version safety rule during staged DDL: before proposing
the next schema version, every live node must already have applied the current
version. That keeps the cluster from drifting into a larger spread of active
schema versions.

## How A Schema Change Flows

At a high level, a cluster DDL request follows this path:

1. A client sends `CREATE TABLE`, `ALTER TABLE`, or index DDL to any CamusDB
   node.
2. If that node is not the current schema leader, the request is forwarded to
   the leader.
3. The leader validates the change against the current schema version.
4. CamusDB writes the schema change as a replicated log entry.
5. Raft commits the entry.
6. Each node applies the committed change locally.
7. The cluster waits for live nodes to acknowledge the applied version before
   advancing the next stage when required.

This means DDL behaves more like a distributed workflow than a local metadata
mutation.

Forwarded DDL requests carry a stable operation identifier, so a retry after a
lost response does not accidentally apply the same schema change twice.

## Online Schema States

Some schema changes are not exposed all at once. CamusDB uses staged online
states so a column or index can become visible gradually:

| State | Meaning |
| --- | --- |
| `DeleteOnly` | The new element exists in metadata but is not yet part of normal reads and writes. |
| `WriteOnly` | New writes maintain the element, but normal reads do not depend on it yet. |
| `Public` | The element is fully visible for normal query execution. |

For example, adding a column or index is not one jump from "missing" to "fully
active". CamusDB can:

1. Add the metadata in an internal state.
2. Let new writes maintain it.
3. Backfill existing rows.
4. Publish it for normal planning and reads.

The same staged model is what keeps online schema changes compatible with live
traffic.

Not every schema operation uses the same number of stages:

- Adding a column or index is staged.
- Dropping a column can be staged in reverse.
- Dropping an index is currently a single replicated schema change, not a
  staged reverse rollout.

## Backfill And Safety

When CamusDB adds a column or index that needs existing data to catch up, it
uses a resumable coordinator rather than assuming one short-lived process will
finish the whole job.

That coordinator is responsible for:

- Moving the element one state at a time.
- Waiting for the cluster to converge at each step.
- Running backfill before the element becomes fully public.
- Resuming work after restart or leader change.

For users, the important property is that partially completed online work is
not forgotten just because leadership moved or a node restarted.

For added columns with defaults, CamusDB backfills existing rows before the
column becomes fully public. For added indexes, CamusDB backfills index entries
before publishing the index for normal planning.

## Reads, Writes, And Compatibility

CamusDB keeps a bounded spread of schema versions during staged DDL. That
matters because transactions and row encoding need a coherent understanding of
which schema is in effect.

Two design choices make this workable:

- Schema changes are expressed as `from version -> to version`, not as
  unversioned "set state" mutations.
- Row and index storage rely on stable internal identifiers, so metadata-only
  changes such as renames do not require a full row rewrite.

The result is that readers, writers, replication, and backfill all have a
common version model to reason about.

Transactions also pin schema versions while they run. If a transaction tries to
commit against a schema that was invalidated by a later DDL change, CamusDB can
reject that commit instead of silently mixing incompatible layouts.

## Failure Behavior

Distributed schema changes are designed to survive the same operational issues
as data replication:

| Failure | What happens |
| --- | --- |
| Follower receives DDL | The request is forwarded to the current schema leader. |
| Leader changes mid-DDL | The committed schema log remains authoritative; resumable staged work can continue on the new leader. |
| Node restarts | Persisted metadata checkpoints reload quickly, and committed schema log entries can be replayed to restore in-memory state. |
| Slow node | The cluster can detect that not every live node has acknowledged the current schema version yet, so later stages wait instead of racing ahead blindly. |
| Lost DDL response | A retry can be deduplicated on the leader instead of double-applying the schema change. |

This does not make schema changes free. It makes their behavior explicit and
recoverable.

The acknowledgement gate is based on live Raft membership, not just a static
peer list. In practice, CamusDB waits for every node the current schema leader
considers live, rather than requiring a dead or fully inactive node to block
DDL forever.

## What Users Should Expect

From an end-user perspective, the distributed schema system gives CamusDB these
properties:

- Cluster schema changes have one agreed order.
- Nodes do not invent their own local schema history.
- Online changes can be staged instead of exposed all at once.
- A DDL success means more than "the leader accepted it"; staged steps wait for
  live-cluster convergence before later steps continue.
- Committed schema work can survive restarts and leader changes.
- Schema and data durability follow the same replicated storage model.

It also implies a tradeoff: distributed DDL is more coordinated than single-node
DDL. CamusDB prefers explicit convergence and recoverability over pretending a
cluster schema change is a purely local metadata write.

## Related Pages

Read [Architecture](/docs/architecture) for the broader system layout,
[Storage](/docs/storage) for KV mapping details, [WAL And Recovery](/docs/wal-recovery)
for replay and durability, and [Cluster Mode](/docs/cluster) for node setup.
