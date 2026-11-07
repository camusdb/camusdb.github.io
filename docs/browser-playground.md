---
sidebar_position: 1.15
---

# Browser playground

Try CamusDB without installing anything. The playground runs the real CamusDB
engine in your browser: the same parser, planner, executor, and embedded storage
path, compiled to WebAssembly. No SQL or data is sent to a server.

You get more than a SQL console. The playground starts a small cluster, so you
can stop a node and watch the surviving replicas elect new leaders, or add a
node and watch CamusDB move replicas to it, then run your queries again and see
that the data is still there.

Open the [Playground](/playground) for one shared workspace: an interactive 3D
server scene beside a SQL console. Selecting a server changes the query
coordinator and the node inspector without switching sessions. The
[tutorial](/docs/intro#try-it-in-your-browser) also includes an embedded SQL
editor.

## Data center

The data center starts four real CamusDB engines automatically when you open it,
with eight data [partitions](/docs/concepts#partition) and
[replication factor](/docs/concepts#replica-and-replication-factor) three, so
each partition has three copies. Starting racks stay visible while WebAssembly
loads and the engines elect [leaders](/docs/concepts#leader). Metadata
membership, data replica placement, hosted partitions, and leader claims all
come from the engines. Click a rack to inspect that node.

**+** starts a fresh engine that uses the running cluster as seeds. The cluster
first adds it as a [learner](/docs/concepts#learner-and-voter), a member that
receives the log but does not vote, catches it up, and then promotes it to a
voter. CamusDB's placement rebalancer then moves replicas to it. **−** asks the
node with the highest ordinal to leave gracefully, waits for replica draining
and committed removal, and only then disposes of the engine. The browser host
supports four to nine nodes in this mode. These operations do not reset the
other engines or recreate the database.

The SQL panel sends queries through the selected rack to the `playground`
database. Create a table and insert rows, add or remove a node, then read the
rows again to verify that the data survives membership changes. A newly joined
or restarted node may need time to converge its schema before it serves a
query. After a removal, leader hints can also take time to refresh; retry any
query made during convergence.

**Simulate node failure** stops an actual server. You can stop multiple servers
to explore larger outages. A partition that keeps a [majority](/docs/concepts#majority)
(more than half) of its replicas elects a new leader within seconds, and the
playground retries statements during that election. A partition without a majority
has no leader, so it cannot serve reads or commit writes. A statement that needs
such a partition fails after about 15 seconds, while data on other partitions
stays available, sometimes with a few seconds of delay.
**Restart node** brings back an empty server that catches up from surviving
peers; use **Reset data center** to start fresh if the cluster cannot recover.
Adding or removing servers, including automatic scaling, waits until all existing
servers are running voters. Three replicas tolerate one unavailable replica per
data partition; adding nodes does not increase a partition's fault tolerance.

**Follow simulated demand** optionally picks a recommended cluster size from
synthetic traffic units, with a target of 4,000 units per node, 10% tolerance,
and bounds of 4–9 nodes. It waits four seconds before growing and ten before
shrinking, then asks for one real membership change. The input is not actual
engine throughput, and this is not a Kubernetes autoscaler. Catch-up and
draining run at engine speed, with no scripted completion time.

Links and LEDs illustrate topology, not measured packets. When a node reports
itself as leader, that is its own local claim. It does not prove that a majority
currently agrees, or that the replicas are up to date. The scene refreshes once
per second while no engine operation is in progress. Data is in memory and
resets on reload or **Reset data center**.

## SQL and data

The SQL console is available immediately. Once the engines are ready, use
**Run query** or **Cmd/Ctrl + Enter** to run SQL through the selected server.
A stopped server cannot run queries, so the console offers to switch to a running
server or to restart the stopped one.
The console includes examples for filtering, joins, subqueries, branching,
returning, JSONB documents, foreign keys, indexes, updates, schema inspection,
and functions. The JSONB example creates a GIN index, filters documents, and
updates a field; you can run it repeatedly. The
sample library (15 books and 7 authors) loads on startup and on reset.

The **Create a table** example creates a `quick_notes` table and inserts a row;
**Read rows** queries that table. Run the creation example once per fresh
session. Results and SQL errors appear directly below the editor.

Queries use the `playground` database. Scripts accept multiple statements;
each statement autocommits and execution stops at the first error. Use
`SHOW DATABASES;` to inspect databases. There is no SQL `USE` statement.

## WebAssembly notes

The playground uses the default single-threaded .NET WebAssembly runtime and can
be served by a static host without special isolation headers. All nodes share
one tab and an in-memory transport; they do not connect to other tabs or hosts.

There are no network sockets or durable database files, so backups and other
features that need external files are unavailable. 
