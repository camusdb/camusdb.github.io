---
sidebar_position: 1.15
---

# Browser playground

Run the real CamusDB engine in your browser: the same parser, planner, executor,
and embedded storage path, compiled to WebAssembly. No SQL or data is sent to a
server.

Open the [Playground](/playground) for one shared workspace: an interactive
3D server scene beside a SQL console. Selecting a server changes the query
coordinator and the node inspector without switching sessions. The
[tutorial](/docs/intro#try-it-in-your-browser) also includes an embedded SQL editor.

## Data center

The data center starts four real CamusDB engines automatically when you open it,
with eight data partitions and replication factor three. Starting racks remain
visible while WebAssembly loads and the engines elect leaders. Metadata membership, data replica placement, hosted partitions,
and leader claims come from the engines. Click a rack to inspect that node.

**+** starts a fresh engine using the running cluster as seeds. Kommander admits it
as a learner and catches it up before promoting it to a voter; CamusDB's placement
rebalancer moves replicas. **−** asks the highest ordinal to leave gracefully,
waits for replica draining and committed removal, and only then disposes the
engine. The browser host supports four to nine nodes in this mode. These operations
do not reset the other engines or recreate the database.

The SQL panel sends queries through the selected rack to the `playground`
database. Create a table and insert rows, add or remove a node, and read them again
to verify that the data survives membership changes. A newly joined or restarted
node may need time to converge its schema before serving a query. After removal,
leader hints can also take time to refresh; retry a query made during convergence.

**Simulate node failure** stops an actual engine. **Restart node** brings back an
empty engine to catch up from surviving peers. A connected metadata majority must
remain running. Membership changes hold until all existing engines are voters and
running. Three replicas tolerate one unavailable replica per data partition;
adding nodes does not increase that partition's fault tolerance.

**Follow simulated demand** optionally chooses a recommended size from synthetic
traffic units, with a target of 4,000 units per node, 10% tolerance, and bounds of
4–9 nodes. It waits four seconds before growth and ten before shrink, then asks
for one real membership change. The input is not actual engine throughput or a
Kubernetes autoscaler. Catch-up and draining run at engine speed, with no scripted
completion time.

Links and LEDs illustrate topology, not measured packets. A single reported
leader is a local leadership claim, not proof of quorum or replication freshness.
The scene refreshes once per second while no engine operation is in progress.
Data is in memory and resets on reload or **Reset data center**.

## SQL and data

The SQL console is available immediately. Once the engines are ready, use
**Run query** or **Cmd/Ctrl + Enter** to execute SQL through the selected server.
The console includes examples for filtering, joins, subqueries, branching, returning,
foreign keys, indexes, updates, schema inspection, and functions. The sample
library (15 books and 7 authors) loads on startup and reset.

The **Create a table** example creates a `quick_notes` table and inserts a row;
**Read rows** queries that table. Run the creation example once per fresh session.
Results and SQL errors appear directly below the editor.

Queries use the `playground` database. Scripts accept multiple statements;
each statement autocommits and execution stops at the first error. Use
`SHOW DATABASES;` to inspect databases. There is no SQL `USE` statement.

## WebAssembly notes

The playground uses the default single-threaded .NET WebAssembly runtime and can
be served by a static host without special isolation headers. All nodes share
one tab and an in-memory transport; they do not connect to other tabs or hosts.

There are no network sockets or durable database files. Backups and features that
require external files are unavailable. 
