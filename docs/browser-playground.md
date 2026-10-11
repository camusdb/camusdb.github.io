---
sidebar_position: 1.15
---

# Browser playground

Run the real CamusDB engine in your browser: the same parser, planner, executor,
and embedded storage path, compiled to WebAssembly. No SQL or data is sent to a
server.

Open the [Playground](/playground) to explore a **three-node cluster** or switch to
**Single node** for SQL experiments. The [tutorial](/docs/intro#try-it-in-your-browser)
also includes the single-node SQL editor.

## Explore a cluster

Select **Start 3-node cluster** to start three engines and load the sample library.
The engines communicate over in-memory transports inside your tab. Their Raft
leader elections, replication, and failover run in the real engine.

1. Choose **Route queries here** on a connected node. Run a query to see its results
   and the node that returned them.
2. Select **Stop metadata leader**, or **Stop node** on any node. The remaining two
   nodes elect leaders for the affected partitions. Watch the partition summary
   and live event stream update.
3. Run SQL through a surviving node. Try an update, then read the rows again.
4. **Restart node** brings the stopped engine back empty so it can catch up from
   its peers. Select it as the query target and read the data again. A query made
   immediately after a restart can be early; allow time for recovery and retry.

You can also **Isolate** a node. This cuts every peer link in both directions while
its engine keeps running. **Restore all links** reconnects it. Restore or restart
the failed node before introducing another fault; two connected nodes must survive.

### Read the cluster view

| Indicator | Meaning |
| --- | --- |
| Metadata leader / P0 | The node reporting leadership of the metadata partition. |
| Data leader / P1 | The node reporting leadership of the data partition. It can differ from the metadata leader. |
| Follower | A running node that currently reports no partition leadership. |
| Online | The engine is running and retains peer connectivity. This is not a replication-lag measurement. |
| Stopped | The engine has been stopped to simulate a crash. |
| Isolated | Peer traffic is blocked, but the engine is still running. |
| Query target | The node to which your next script will be submitted. |
| Returned last result | The node that returned the last successful script's results. |

Leadership is **per partition**, rather than one leader for the whole cluster.
The view polls the engine every second while idle. An isolated node can continue
to claim leadership until it hears from its peers; conflicting or isolated claims
are labeled explicitly. A stable cluster has three connected nodes and one
connected leader reported for each partition.

The query route identifies the **request coordinator**. The engine does not expose
per-query internal data reads or replication traces. Connection animations
illustrate the topology, not individual measured packets. Motion is disabled when
your system requests reduced motion.

## SQL and data

- Data lives in memory. Reloading the page or selecting **Reset cluster** starts over.
- Single-node and cluster sessions have separate data. Switching out of cluster
  mode stops that cluster; starting it again loads a fresh sample library.
- The database selector controls the context database for tables, views, and queries.
- Scripts accept multiple statements separated by top-level semicolons.
- Each statement autocommits, and execution stops at the first error.
- The engine loads on demand when you start the cluster. Single-node mode starts
  its engine when you open it.

The sample `playground` database contains `books` and `authors`. Example buttons
in the cluster editor load SQL for you to edit and run. Use **Run query** or
**Cmd/Ctrl + Enter** to execute it.

Use SQL to create databases and branches:

```camussql
CREATE DATABASE lab;
CREATE DATABASE lab_copy BRANCH FROM lab;
SHOW DATABASES;
SHOW BRANCHES FROM lab;
```

There is no SQL `USE` statement in CamusDB. Use the database selector instead.
After a script creates a database or branch, the playground selects the new database.

## WebAssembly notes

The playground uses the default single-threaded .NET WebAssembly runtime and can
be served by a static host without special isolation headers. Three nodes share
one tab and an in-memory transport; they do not connect to other tabs or hosts.

There are no network sockets or durable database files. Backups and features that
require external files are unavailable. 
