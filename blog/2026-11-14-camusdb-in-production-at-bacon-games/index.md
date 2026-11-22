---
slug: camusdb-in-production-at-bacon-games
title: "CamusDB in production at Bacon Games: a first-party report"
date: 2026-11-14
authors: [andresgutierrez]
image: /img/pyramid-powering-game-worlds.png
tags: [camusdb, video-games, game-backends, production]
description: "What Bacon Games runs on CamusDB since 2025, how teams use database branches, what failed, and what this report does not prove."
---

# CamusDB in production at Bacon Games: a first-party report

![A glowing pyramid connects a football stadium, a fantasy landscape, and futuristic cities](/img/pyramid-powering-game-worlds.png)

This post describes the CamusDB deployment at [Bacon Games](https://bacongames.co/): the workload, the
cluster, how teams use database branches, the defects that our backend found
in CamusDB, and the data that we store in other systems. If you are evaluating
CamusDB, it shows you one real production system and its limits.

I wrote CamusDB, and I am the CTO of Bacon Games. This is a report from the
team that builds the database, about how that team uses it in production. It
is evidence that CamusDB serves a real workload, from a team that is not
independent. No independent production user is public yet.

<!-- truncate -->

## What runs on CamusDB

Bacon Games has used CamusDB since 2025. It is the backend
database for many games. All games use one backend platform, and each system
of that platform stores its data in CamusDB.

| Kind of data | Systems |
|---|---|
| Player value | Wallets and currencies, inventories and item upgrades, rewards, code redemption |
| Purchases | The store, in-app purchase receipts, checkout orders, the transaction log |
| Players | Users, identity, devices, sessions, consent records, player statistics |
| Social | Social features, presence, leaderboards |
| Live operations | Game configs, parameters, game events, feature flags, experiments, player segments, scheduled jobs |
| Messages and content | The player inbox, player mail, news, localization |
| Marketing | Install attribution, ad placements, ad conversions |

The first group is a ledger. A wallet can't go below zero, an item has
exactly one owner, and a reward is granted once. We explained why that
workload needs serializable transactions, with a trade between two players in
SQL, in
[Game wallets and inventories need distributed transactions](/blog/player-inventories-are-bank-accounts).

The other groups are ordinary relational data. They live in the same database
as the ledger. This means that a purchase, the inventory change, and the
inbox message that confirms it can commit in one transaction.

## Branches in daily work

A [database branch](/docs/database-branching) is an isolated copy of a
database that shares the data of its source. A write to the branch does not
reach the source. Two teams use branches daily.

**Customer support and QA** create a branch to examine the case of one
player. They can repeat a purchase or run a fix against the real state of
that player, and the live data does not change.

**Developers** create a branch of the development database and work there.
A schema change or a test data set of one developer does not break the work
of another developer. When the work is done, the developer drops the branch.

The statement is the same in both cases. The names here are examples.

```camussql
CREATE DATABASE support_case_4812 BRANCH FROM game_prod;
```

## The deployment

| | |
|---|---|
| Used since | 2025 |
| CamusDB version today | 0.18 |
| Mode | [Cluster mode](/docs/cluster) |
| Nodes | 3, each with 4 cores and 16 GB of memory |
| Where it runs | Google Cloud |
| Replication factor | 3 |
| Client | The [EF Core provider](/docs/ef-core), over gRPC |
| Backups | [Point-in-time recovery](/docs/backup-and-restore) |

With three nodes and a replication factor of 3, each node has a copy of each
partition. A write commits when two of the three copies accept it. This means
that the cluster continues to commit while one node is down.

Point-in-time recovery restores the database to a chosen moment in a
retention window, in addition to the moment of the last backup.

## Why we run our own database

Before CamusDB, our games used MongoDB, DynamoDB and Google Cloud Spanner.

**MongoDB/DynamoDB.** Our data had no enforced structure, and all validation logic
lived in the application. Queries that needed joins were hard to write
without SQL. The transaction support was too limited for our ledger data.

**Google Spanner.** It gave us SQL and strong transactions across servers, and it
showed us that a database can provide consistency and scale together. It was
also costly for our workload, and it was a closed system for us: we could not
read the engine, and we could not extend it. It had no
[database branches](/docs/database-branching), no
[query result cache](/docs/query-result-cache), and none of the other
features that we later built into CamusDB, such as
[C# extensions](/docs/csharp-extensions).

**CockroachDB/YugabyteDB.** These are distributed SQL databases with
available source code, and we considered them. We did not choose them,
because a different company directs each product and decides its roadmap and
its license. They are also built on other technology: CockroachDB is written in
Go, and YugabyteDB is written in C and C++.

The technology matters to us because Bacon Games is a .NET studio. All of
our developers work in C#. With CamusDB, the game, the backend, and the
database use one language and one toolchain. A backend developer can read the
database source and debug it with the usual tools. The developer can also
write a trigger or a function in C# for the server.

These are the reasons of one team with one workload. All four products are
mature, and all of them run systems much larger than ours.

We chose CamusDB because we build it. This means that our judgment of this
choice has a bias. A team that does not build CamusDB must compare it with
PostgreSQL and with the established distributed SQL databases for the
workload of that team.
[Why CamusDB?](/docs/why-camusdb) lists the cases where CamusDB is a weaker
fit, and
[The origins of CamusDB](/blog/welcome) gives the longer history.

## Some issues found and fixed

Our backend is the first heavy user of each CamusDB release, so it finds
defects before other users do. We keep a record of each one, and this section
is that record.

Two defects had the largest effect.

**A commit that did not return.** EF Core saved the changes in an explicit
transaction, and the commit that followed did not complete and gave no error.
Config writes from our operations portal stopped. A driver release fixed it.

**A filter that became slower with each row.** A filter with a correlated
`EXISTS` subquery ran the subquery as a scan for each candidate row, at 3 to
30 ms per row. A filtered page of an inventory with 300 items reached the
10-second timeout. The query also became slower when other players had more
rows. The planner now reads the subquery table through its primary key, the
same queries on 1,200 items complete promptly, and two regression tests hold
that result.

The full record has fifteen entries.

| Area | Defect | Status |
|---|---|---|
| Transactions | The commit did not return after EF Core saved changes in an explicit transaction | Fixed |
| Transactions | The driver rejected the Read Committed isolation level | Fixed. We use it for append-only writes such as receipts and the transaction log |
| Transactions | A bulk insert in a read-only transaction preset reported success, and no row was stored | The preset is read-only by design. We use a read-write preset |
| Schema | A unique index on a nullable column rejected a second `NULL` | Fixed |
| Schema | The migration history check always answered "no migrations", and each migration looked pending | Fixed |
| Schema | Two concurrent `CREATE DATABASE IF NOT EXISTS` statements for one name: one can fail with "already registered" | Open in the server. The driver treats the error as success |
| Query translation | EF Core `AnyAsync` was not supported | Fixed |
| Query translation | A negated boolean column, `!row.IsDeleted`, was a syntax error | Fixed |
| Query translation | `StartsWith` with a `StringComparison` argument was not translated | Fixed |
| Query translation | `list.Contains(column)` threw an exception before the query ran | Fixed |
| Query translation | A negated correlated `EXISTS` was rejected | Fixed |
| Results | A UUID column that passed through a join had the wrong type, and the row could not be read | Fixed in the server and in the driver |
| Results | The driver looked up a column by name with exact case, while SQL ignores case | Fixed |
| Performance | A correlated `EXISTS` filter ran as a scan for each row | Fixed |
| JSONB | A driver older than 0.17 reads a JSONB cell as `NULL` over gRPC, with no error | Open. Upgrade each client before you add a JSONB column |

Twelve of the fifteen entries are fixed. The entries that remain are one
server defect with a driver workaround, one preset that needs a clear error,
and one upgrade order that you must follow.

Most of these defects are in the driver and the EF Core provider, and some
are in the query planner. [Caraxes](/docs/caraxes), our fault-injection
harness, tests a different layer: it kills nodes and cuts the network while
it checks that no committed data is lost. A real application that uses the
provider daily found what the fault tests do not look for.

## Only transactional data

Analytics data is in ClickHouse. ClickHouse is an analytics database, and
CamusDB is built for transactions. Large scans and aggregations over event
history belong in a system that is designed for them.

## The results

- CamusDB is the authoritative store of production data for a real product.
- It replaced MongoDB and Spanner for many games, and it has run in
  production since 2025.
- Database branches are part of the daily work of support, QA, and
  development.

It does not show three things.

- That CamusDB fits a workload that is different from ours.
- How CamusDB behaves at a size larger than the deployment above.
- That a team without the authors of the database can operate it. We fix the
  engine ourselves when production finds a defect.

CamusDB is still young, and APIs and storage formats can change between
versions. See [Current scope](/docs/why-camusdb#current-scope).

If you want to try CamusDB and find anything to improve tell us in a
[GitHub issue](https://github.com/camusdb/camusdb/issues). A report from an
independent team is worth more to other readers than this one.
