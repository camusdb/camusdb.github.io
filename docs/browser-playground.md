---
sidebar_position: 1.15
---

# Browser playground

You can try CamusDB without installing anything. The playground is the real
CamusDB engine, compiled to WebAssembly, in your browser. It is the same SQL
engine as the server. Your SQL and data aren't sent to a server.

The playground also starts a small cluster. You can stop a node and watch the
other replicas elect new leaders. You can also add a node and watch CamusDB move
replicas to it. Then execute your queries again, and check that the data is
there.

Open the [Playground](/playground) for one workspace: an interactive 3D server
scene next to a SQL console. When you select a server, it becomes the query
coordinator, and the node inspector shows it. The
[tutorial](/docs/intro#try-it-in-your-browser) also has an embedded SQL editor.

## Data center

When you open the data center, it starts four CamusDB engines, with eight data
[partitions](/docs/concepts#partition) and
[replication factor](/docs/concepts#replica-and-replication-factor) three. This
means that each partition has three copies. The racks are visible while
WebAssembly loads and the engines elect [leaders](/docs/concepts#leader). All
the state in the scene, such as the replica placement, comes from the engines.
Click a rack to inspect that node.

**+** starts a new engine, with the running cluster as seeds. The cluster adds
it as a [learner](/docs/concepts#learner-and-voter), a member that receives the
log but doesn't vote. After the learner catches up, it becomes a voter, and the
placement rebalancer moves replicas to it.

**−** asks the node with the highest ordinal to leave. The engine is removed
after its replicas have moved and the removal has committed. The data center
supports four to nine nodes. These operations don't reset the other engines or
the database.

The SQL panel sends queries through the selected rack to the `playground`
database. Create a table and insert rows. Then add or remove a node, and read
the rows again: the data survives membership changes. A new or restarted node
can need time to catch up with the schema before it serves a query. After a
removal, the leader hints can also take time to refresh. If a query fails in
this time, retry it.

**Simulate node failure** stops a server. You can stop several servers to
explore larger outages:

- A partition that has a [majority](/docs/concepts#majority) (more than half) of
  its replicas elects a new leader in seconds. The playground retries statements
  during the election.
- A partition that doesn't have a majority doesn't have a leader. It can't serve
  reads or commit writes. A statement that needs it fails after about 15
  seconds. The data on the other partitions continues to be available,
  sometimes after a few seconds.

**Restart node** brings back an empty server, which catches up from the other
nodes. If the cluster can't recover, use **Reset data center**. A change to the
node count, also by automatic scaling, waits until all servers are running
voters. Three replicas tolerate one unavailable replica in each partition. More
nodes don't increase the fault tolerance of a partition.

**Follow simulated demand** picks a cluster size from synthetic traffic units.
The target is 4,000 units for each node, with 10% tolerance, and the limits are
4 and 9 nodes. A recommendation must last four seconds to grow the cluster, and
ten seconds to shrink it. Then the size changes by one real membership change.
The input is synthetic, and it doesn't measure the engines. Catch-up and
draining happen at engine speed.

The links and LEDs illustrate the topology, and they don't show measured
packets. When a node shows that it is a leader, that is its local claim. It
doesn't prove that a majority agrees, or that the replicas are up to date. The
scene refreshes once a second while no engine operation is in progress. The
data is in memory, and a reload or **Reset data center** removes it.

## SQL and data

The SQL console is available at once. When the engines are ready, use
**Run query** or **Cmd/Ctrl + Enter** to execute SQL through the selected
server. A stopped server can't execute queries. The console offers to switch to
a running server, or to restart the stopped one.

The console has examples, such as branching and JSONB documents. You can run the
JSONB example more than once. It creates a GIN index and updates a field. The
sample library of 15 books and 7 authors loads at startup and at reset.

The **Create a table** example creates a `quick_notes` table and inserts a row.
**Read rows** queries that table. Run the first example once in a new session.
Results and SQL errors appear below the editor.

Queries use the `playground` database. A script can have several statements.
Each statement autocommits, and the script stops at the first error. To list the
databases, use `SHOW DATABASES;`. The console doesn't have a `USE` statement.

## WebAssembly notes

The playground uses the default single-threaded .NET WebAssembly runtime. A
static host can serve it, and it doesn't need special isolation headers. All
nodes share one tab and an in-memory transport. They don't connect to other tabs
or hosts.

There are no network sockets and no durable database files. This means that
backups are unavailable, and so are other features that need files, such as
spill to disk.
