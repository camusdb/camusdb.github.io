---
sidebar_position: 6
---

# Distributed schema changes

CamusDB treats the schema as distributed state. The schema is not a local side
table that each node updates on its own. In cluster mode, a change to a table, a
column, or an index flows through the same replicated system that protects the
data writes.

For an operator of a cluster, five properties follow:

1. A schema change has one ordered source of truth.
2. Every node converges on the same schema version. The progress stays bounded,
   even when a follower lags.
3. CamusDB stages an online change. A reader and a writer therefore never jump
   between two incompatible layouts.
4. CamusDB executes a forwarded DDL statement again, on the schema leader. It
   removes a duplicate from a retry.
5. A restart and a change of leader lose no committed schema work.

CamusDB is in production use. Cluster mode is nevertheless an alpha feature. The
APIs and the storage formats can change between versions.

## Why this exists

In a distributed database, a schema change is harder than a DDL statement on one
node. Two nodes can receive a request at different times. A node can be slower,
it can restart during a change, or it can lose its leadership.

A schema in local metadata alone would create a risk. One node could accept a
write with a newer definition, while another node still reads with an older
one.

CamusDB avoids that risk. It treats the schema as a replicated state machine.
The cluster first agrees on the order of the schema changes. Each node then
applies the same committed changes, in that order.

## The source of truth

For a database in cluster mode, the source of truth is the committed schema log
in [Kommander](https://kahunakv.github.io/kommander.github.io/). The source of
truth is not a local metadata file.

CamusDB stores each schema change as a small record of the change:

- Create a table, or drop one.
- Add a column, or drop one.
- Add an index, or drop one.
- Advance a column or an index from one state of visibility to the next.

Every node applies a schema entry in the same order, after Raft commits that
entry. The persisted metadata in the KV storage is a checkpoint for a faster
restart. The committed schema log remains the authoritative history.

## Versions and convergence

CamusDB gives a schema change a version, and the versions only increase:

- The schema of a database has a counter of the version.
- Each table also carries its own version.
- A stored row keeps the schema version of its write.

Those versions let the cluster answer two questions precisely:

1. Which schema does a transaction use?
2. Did every live node reach the same schema yet?

CamusDB uses an acknowledgement from each live node. It therefore knows when
every node applied a committed schema version. It waits for the convergence of
the current stage across the live cluster, before it advances to the next stage
of an online change.

The practical effect is simple. A schema change is more than a commit on a
leader. CamusDB stages the change. The cluster therefore moves forward, and the
schema versions do not drift far apart.

The design uses a safety model of two versions during a staged DDL statement.
Before it proposes the next schema version, the cluster tries to confirm one
condition: enough nodes applied the previous version already. The spread of the
schema versions across the nodes therefore stays bounded.

In normal operation, every live node acknowledges the current version. One
follower can be slow, or it can be unreachable for a time. The leader can then
continue after a bounded delay, as soon as a majority applied the change. It
does not block the DDL statement forever. CamusDB then fences the node that lags
from normal work, until that node reaches the committed schema head.

## How a schema change flows

At a high level, a DDL request in a cluster follows this path:

1. A client sends `CREATE TABLE`, `ALTER TABLE`, or a DDL statement for an index
   to any CamusDB node.
2. That node forwards the request to the schema leader, if it is not the leader
   itself.
3. The leader validates the change against the current schema version.
4. CamusDB writes the schema change as a replicated log entry.
5. Raft commits the entry.
6. Each node applies the committed change locally.
7. The cluster waits for the acknowledgement of the applied version from the
   live nodes. It does so before it advances the next stage, where a next stage
   exists.

A DDL statement therefore behaves like a distributed workflow. It does not
behave like a local mutation of metadata.

A forwarded DDL request carries a stable identifier of the operation. A retry
after a lost response therefore does not apply the same schema change twice.

## A slow node, and bounded progress of a DDL statement

A distributed DDL statement must select one of two modes of failure:

- It waits forever for the slowest node.
- It lets the cluster continue, and it protects a node that lags in another way.

CamusDB uses the second mode.

After the commit of a schema step, the leader first tries to wait for the
convergence of every live node. That convergence can be too slow. The leader can
then treat a result that a majority applied as sufficient progress, and it
continues the staged change.

One slow follower therefore does not turn every schema change into a long stall.

The safety side of that decision matters as much. A node that falls too far
behind the committed schema head rejects a read and a DML statement for that
database. It does so until it catches up. Treat that state as a temporary
condition for a retry. It is not a silent mode of stale reads.

## The states of an online schema change

CamusDB does not expose every schema change at one time. It uses staged online
states. A column or an index therefore becomes visible in steps:

| State | Meaning |
| --- | --- |
| `DeleteOnly` | The new element exists in the metadata. It is not part of a normal read or a normal write yet. |
| `WriteOnly` | A new write maintains the element. A normal read does not depend on it yet. |
| `Public` | The element is fully visible to a normal query execution. |

A new column and a new index therefore do not jump from "absent" to "fully
active" in one step. CamusDB can take four steps:

1. It adds the metadata, in an internal state.
2. It lets a new write maintain the element.
3. It backfills the existing rows.
4. It publishes the element for the normal plan and the normal read.

That staged model is what keeps an online schema change compatible with live
traffic.

The number of stages differs by operation:

- CamusDB stages the addition of a column, and the addition of an index.
- CamusDB can stage the removal of a column, in the reverse order.
- The removal of an index is one replicated schema change today. It is not a
  staged rollout in reverse.

## A rename changes the metadata only

A rename of a table, of a column, or of an index needs no rewrite of the stored
rows.

CamusDB stores a row and an index with stable internal identifiers, and with a
row layout by position. It does not put a readable name in the payload of every
row. A rename of a column or of a table therefore updates the metadata and the
rules of the visibility. It forces no rewrite of the data across the cluster.

For a new table, the stable identifier is a short value in base62. CamusDB
allocates it from a persistent monotonic sequence, before it commits the DDL
statement. The replicated schema change carries the allocated id. A follower
therefore applies the same identity for the table. It does not generate its own.
An existing table with an older id of 24 characters stays valid.

The practical benefit for a user is clear. A rename is much lighter than an
operation that copies and rebuilds everything.

## The backfill, and its safety

CamusDB can add a column or an index that needs the existing data. It then uses
a coordinator that can resume. It does not assume that one short process
finishes the whole job.

That coordinator has four responsibilities:

- It moves the element one state at a time.
- It waits for the convergence of the cluster at each step.
- It runs the backfill before the element becomes fully public.
- It resumes the work after a restart, and after a change of leader.

One property matters most to a user. CamusDB does not forget partly completed
online work, and a move of the leadership or a restart of a node does not change
that.

For a new column with a default, CamusDB backfills the existing rows before the
column becomes fully public. For a new index, CamusDB backfills the index
entries before it publishes the index for the normal plan.

CamusDB writes a checkpoint of the progress of a backfill. The leadership can
change during the build of an online column or index. The next schema leader
then continues from the recorded progress. It does not start the whole job
again.

## Reads, writes, and compatibility

CamusDB keeps the spread of the schema versions bounded during a staged DDL
statement. That property matters. A transaction and the encoding of a row need a
coherent view of the schema that is in force.

Two decisions in the design make this workable:

- CamusDB expresses a schema change as a move from one version to another
  version. It does not express the change as a mutation of a state without a
  version.
- The storage of a row and of an index uses stable internal identifiers. A
  change of the metadata alone, such as a rename, therefore needs no rewrite of
  the rows.

The result is one common model of the versions. The readers, the writers, the
replication, and the backfill all use that model.

A transaction also pins the schema versions while it runs. A later DDL statement
can invalidate the schema of a transaction. CamusDB then rejects the commit of
that transaction. It does not mix two incompatible layouts in silence.

A long query and a long write therefore see one coherent view of the schema.
Neither one blends an old layout with a new one during its execution.

## Behavior after a failure

A distributed schema change survives the same operational problems as the
replication of the data:

| Failure | What happens |
| --- | --- |
| A follower receives a DDL statement | CamusDB forwards the request to the current schema leader. |
| The leader changes during a DDL statement | The committed schema log stays authoritative. The staged work can resume on the new leader. |
| A node restarts | The persisted checkpoints of the metadata load quickly. CamusDB can replay the committed entries of the schema log, and it restores the state in memory. |
| A node is slow | The leader can continue after a bounded delay, as soon as a majority applies the schema step. Meanwhile the node that lags cannot serve normal work, until it catches up. |
| A response to a DDL statement is lost | The leader removes the duplicate from a retry. It does not apply the schema change twice. |
| A transaction spans a DDL change | CamusDB can reject the commit, when the schema that the transaction pinned is no longer valid. |

This design does not make a schema change free. It makes the behavior of a
schema change explicit, and it makes that behavior recoverable.

The gate of the acknowledgements uses the live membership of Raft. It does not
use a static list of the peers alone. CamusDB waits for every node that the
current schema leader considers live. A node that is dead, or fully inactive,
therefore does not block a DDL statement forever. In cluster mode, the Raft
layer gives the live membership and the reachability of a follower. A manual
list on the side does not give them.

A node can fall more than one schema version behind the committed head of a
database. CamusDB then fences that node from normal table work, until it catches
up. That fence preserves the correctness of the cluster, while a DDL statement
continues with the backstop of a majority.

## What a user can expect

From the view of an end user, the distributed schema system gives CamusDB these
properties:

- A schema change in a cluster has one agreed order.
- A node does not invent its own local history of the schema.
- CamusDB can stage an online change. It does not expose the change at one
  time.
- A successful DDL statement means more than "the leader accepted it". CamusDB
  committed the change in the schema log, and it staged the change behind gates
  for the convergence. It did not treat the change as a local write of metadata.
- Committed schema work survives a restart and a change of leader.
- The schema and the data follow the same replicated model of the storage.
- A slow follower does not block the evolution of the schema forever. A node
  that falls behind can nevertheless reject table work for a time, until it
  catches up.
- A rename is a change of the metadata. It is not a rewrite of the rows.

One trade follows. A distributed DDL statement needs more coordination than a
DDL statement on one node. CamusDB prefers explicit convergence and recovery. It
does not pretend that a schema change in a cluster is a purely local write of
metadata.

## Related pages

- [Architecture](/docs/architecture) for the wider layout of the system.
- [Storage](/docs/storage) for the details of the KV mapping.
- [WAL And Recovery](/docs/wal-recovery) for the replay and the durability.
- [Cluster Mode](/docs/cluster) for the setup of a node.
