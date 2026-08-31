---
sidebar_position: 2
---

# Why CamusDB?

CamusDB is a distributed SQL database for applications that need **strong
consistency, transactional correctness, and room to scale** without giving up a
relational data model.

Many applications start with a simple architecture: one database, SQL, and
transactions. As they grow, maintaining those same guarantees across more
machines can introduce sharding, routing, distributed coordination, retries,
and application-level consistency logic.

CamusDB is designed to keep that complexity in the database.

It combines a relational SQL engine with a distributed transactional storage
layer, so applications can work with tables, indexes, queries, and transactions
while CamusDB handles replication, partitioning, consensus, and distributed
commits underneath.

It is especially useful for systems where the database represents
**authoritative state**: money, inventory, ownership, reservations,
entitlements, workflow state, quotas, or any other data where conflicting
answers are difficult or expensive to reconcile later.

> CamusDB is not intended to be a drop-in replacement for another SQL database.
> It has its own SQL dialect, feature set, and operational model. The goal is to
> provide a familiar relational and transactional model while being designed for
> distributed operation from the start.

## Built for data that needs one answer

Some data can tolerate temporary disagreement between replicas. Some cannot.

If two requests try to reserve the last available item, spend the same balance,
claim the same reward, or assign the same resource, the application eventually
needs one authoritative outcome.

CamusDB uses **serializable transactions by default** and coordinates writes
across partitions when a transaction spans multiple parts of the cluster.

This makes it a natural fit for workloads such as:

- Financial balances, ledgers, and payment state.
- Game inventories, currencies, rewards, and entitlements.
- Orders and limited inventory.
- Reservations and ticketing.
- Marketplace ownership and trading.
- SaaS subscriptions, quotas, and control-plane state.
- Logistics and resource allocation.
- Telecom quotas and provisioning.
- Industrial and manufacturing workflows.
- Distributed coordination for application infrastructure.

The important property is not the industry. It is the invariant:

```text
inventory >= 0
balance >= 0
one seat -> one reservation
one asset -> one owner
one task -> one active assignee
```

CamusDB is designed for applications where those rules should be enforced
against a consistent view of the data.

## Scale without making distribution your application model

CamusDB distributes data across multiple Raft partitions. Each partition has its
own leader and replicated state, allowing different parts of the database to
make progress across the cluster.

Applications do not need to manually decide which database server owns a row or
coordinate conflicting writes between independent replicas.

A transaction that touches one partition commits through that partition. When a
transaction touches multiple partitions, CamusDB coordinates the operation
using two-phase commit.

This lets the application continue to think primarily in terms of data and
transactions:

```camussql
BEGIN;

UPDATE accounts
SET balance = balance - 100
WHERE id = 10;

UPDATE accounts
SET balance = balance + 100
WHERE id = 20;

INSERT INTO transfers (source, destination, amount)
VALUES (10, 20, 100);

COMMIT;
```

The two accounts do not need to live on the same partition for the operation to
remain atomic.

See [Transactions and Isolation](/docs/serializable-transactions) and
[Distributed Transactions and HLC](/docs/distributed-transactions) for the
current guarantees and trade-offs.

## A relational database, not SQL added as an afterthought

CamusDB contains its own relational engine.

It includes:

- A SQL parser.
- A cost-based query planner.
- Secondary, unique, composite, and covering indexes.
- Table statistics and automatic analysis.
- Joins, subqueries, aggregates, grouping, and sorting.
- Views and materialized views.
- Prepared statements.
- A query result cache.
- Spill-to-disk for memory-intensive operations.
- A write-ahead log and crash recovery.

For example:

```camussql
SELECT
    customer_id,
    COUNT(*) AS orders,
    SUM(total) AS revenue
FROM orders
WHERE created_at >= '2026-01-01'
GROUP BY customer_id
HAVING COUNT(*) > 5
ORDER BY revenue DESC
LIMIT 100;
```

The planner uses collected statistics to choose indexes, join strategies, and
other execution decisions. `EXPLAIN` lets you inspect the resulting plan.

The objective is straightforward: distributed storage should not require giving
up the relational tools that are useful for modeling transactional
applications.

See [SQL](/docs/sql), [Query Planning](/docs/query-planning), and
[EXPLAIN](/docs/explain).

## Familiar territory for .NET developers

CamusDB is written in C# and runs on .NET.

For teams already building applications with ASP.NET Core, ADO.NET, EF Core,
Docker, Kubernetes, and the wider Microsoft ecosystem, that makes the database
unusually approachable.

CamusDB provides:

- An **ADO.NET provider**.
- An **Entity Framework Core provider**.
- A native .NET codebase.
- HTTP and gRPC APIs.
- An interactive SQL CLI.
- A browser-based Web Console.

A .NET application can use familiar database abstractions while the storage
engine, transaction coordinator, query engine, and distributed systems code are
also part of the same ecosystem.

CamusDB does not try to reproduce SQL Server or its SQL dialect. The advantage
for Microsoft-oriented teams is instead that many of the fundamental concepts:
relational schemas, transactions, indexes, SQL, ADO.NET, and EF Core remain
familiar.

See [.NET Driver](/docs/dotnet-driver) and [EF Core Provider](/docs/ef-core).

## Database branches for development, testing, and AI workflows

A database is increasingly part of the development environment, not just
production infrastructure.

CamusDB can create an isolated branch from an existing database at a specific
point in time:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
```

The branch initially shares the source snapshot and diverges as changes are
made. Writes, deletes, and schema changes remain isolated from the source
database.

That makes database branches useful for:

- Feature development.
- Integration tests.
- Reproducing production problems.
- Testing schema migrations.
- Creating temporary environments.
- Experimenting with realistic datasets.
- Giving coding agents isolated database state.

A developer, or an AI coding agent, can have both a code branch and a database
branch:

```text
feature/payment-refactor
        |
        +-- Git branch
        |
        +-- CamusDB database branch
```

Run migrations, modify data, execute tests, and discard the branch when the
work is finished without modifying the source database.

See [Database Branching](/docs/database-branching).

## Mistakes do not always need to become disasters

Operational mistakes happen.

Someone runs:

```camussql
DROP TABLE orders;
```

against the wrong database.

In many systems, recovery begins with finding and restoring a backup.

CamusDB takes a different approach for ordinary `DROP TABLE` and
`DROP DATABASE` operations. Dropped objects can remain recoverable for a
configured retention window.

For example:

```camussql
SHOW ORPHAN TABLES;

CREATE TABLE orders_recovered RELINK TO "A0";
```

The object can be relinked under a safe name and inspected without first
restoring an entire backup.

Permanent deletion is still available explicitly with `DROP ... FORCE`.

This is not a replacement for backups, but it provides another layer of
protection against one of the most common and damaging operational failures:
deleting the wrong thing.

See [Recover Dropped Objects](/docs/recover-dropped-objects).

## Query historical data without restoring a backup

CamusDB supports time-travel reads:

```camussql
SELECT *
FROM orders
AS OF SYSTEM TIME '2026-08-01T00:00:00Z';
```

Historical reads can help with:

- Auditing.
- Investigating incidents.
- Comparing state before and after a deployment.
- Understanding an unexpected data change.
- Producing reports against a previous snapshot.

The current state of the database does not need to be modified to inspect the
past.

See [Time Travel Reads](/docs/time-travel-reads).

## Keep AI close to transactional data

CamusDB includes vector-distance operations for embeddings, allowing similarity
searches to run alongside relational queries and transactional data.

This is useful when vector search is part of an application rather than an
independent analytics platform.

For example, an application may keep:

```text
customer
document
permissions
metadata
embedding
```

in the same logical database instead of immediately introducing another
persistence system solely for similarity search.

CamusDB also exposes an **MCP server**, allowing AI agents and development
tools to interact with the database through the Model Context Protocol.

See [Vector Search](/docs/vector-search) and [MCP Server](/docs/mcp-server).

## Run locally or as a cluster

CamusDB does not require a distributed environment for local development.

Install it as a .NET tool:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

or run it with Docker.

When you need to exercise the distributed architecture, CamusDB can run as a
multi-node cluster:

```bash
docker compose -f docker/local.yml up --build
```

Each node can expose the database API. Data ownership and transaction routing
are handled by the cluster.

The same database can therefore be practical for a developer working locally
while retaining a distributed architecture for environments where availability
and scale matter.

## More than one way to connect

CamusDB provides several interfaces depending on the application:

| Interface | Use |
| --- | --- |
| `camus-cli` | Interactive SQL shell |
| Web Console | Query and inspect the database from a browser |
| HTTP API | Simple JSON-based access |
| gRPC API | Binary protocol with streamed results |
| .NET driver | ADO.NET integration |
| EF Core provider | Entity Framework Core integration |
| MCP server | Database access for AI agents and tools |

It also includes `camus-dump` for backup and restore workflows and a workload
utility for performance testing.

## Where CamusDB fits

CamusDB is most interesting when several of these are true:

- The application owns transactional or authoritative state.
- Strong consistency simplifies important business rules.
- The workload needs to grow beyond a single machine.
- High availability matters.
- The data naturally fits a relational model.
- Transactions may span different parts of the dataset.
- The team wants to avoid building application-level sharding and coordination
  prematurely.
- Developers want SQL without making physical partitioning the center of the
  domain model.
- The application is built on .NET and benefits from first-class integration
  with that ecosystem.
- Database branching, historical reads, or recoverable schema operations
  simplify development and operations.

CamusDB is less compelling when the workload is primarily an analytics
warehouse, an object store, a telemetry pipeline, or a document store where weak
consistency and simple key-based access are already sufficient.

A distributed database introduces its own costs and trade-offs. It should solve
a real problem.

## Current scope

CamusDB is in production use, but it is still an evolving project. Some
capabilities remain alpha, and APIs or storage formats can change between
versions.

Today, the engine includes:

- Distributed replicated storage using Raft.
- Key-range partitioning.
- Serializable transactions.
- Distributed transactions using two-phase commit.
- A relational SQL engine.
- Cost-based query planning.
- Secondary and covering indexes.
- Table statistics and automatic analysis.
- Joins, aggregates, and disk-backed execution.
- Views and materialized views.
- Prepared statements.
- Result caching.
- Row-level TTL.
- Vector search.
- Time-travel reads.
- Database branching.
- Recoverable dropped objects.
- Write-ahead logging and crash recovery.
- ADO.NET and EF Core integration.
- HTTP, gRPC, CLI, Web Console, and MCP interfaces.

Areas such as operational tooling, broader production hardening, and richer
multi-region controls continue to evolve.

CamusDB is not trying to hide that fact.

The project is building toward a database where **applications can keep a simple
model of their most important data even when the infrastructure underneath it
is distributed**.

That is the problem CamusDB is designed to solve.
