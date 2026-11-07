---
slug: how-much-we-test-camusdb
title: How much we test CamusDB
date: 2026-11-06
authors: [andresgutierrez]
tags: [camusdb, reliability, testing, chaos-testing]
image: /img/cybernetic-pyramid.png
description: About 5.4 million operations per night, 23 to 39 million in each daily two-hour fault soak, what each harness checks, how often the nightly jobs fail, and what the numbers do not prove.
---

# How much we test CamusDB

![A dark pyramid with glowing blue cracks under a night sky and a large planet](/img/cybernetic-pyramid.webp)

CamusDB is a young database, so you have a fair question: how much evidence stands behind it? Our answer has three parts: about **5.4 million operations per night**, **23 to 39 million operations in each daily two-hour fault soak**, and more than 21,000 automated tests. This post shows where these numbers come from and what they do not prove.

<!-- truncate -->

## The numbers

| Source | What runs | Volume per night | Basis |
| --- | --- | --- | --- |
| Caraxes nightly | 94 scenarios, most with Elle history checks | 5.1M operations | Counted on November 6 |
| SQL fuzzer | 5 oracles, 60 seconds each | 172,112 statements | Counted on November 6 |
| Kahuna Jepsen | 26 jobs | 100,167 operations | Counted on November 6 |
| Kommander Jepsen | 13 jobs | About 20,000 operations | Counted in 6 jobs, estimated for the rest |
| **Total per night** | | **About 5.4M** | |

These counts describe the current schedule, not a history. The nightly Elle matrix started on November 3 and the scheduled SQL fuzzer started on November 4, so you cannot multiply these numbers by the age of the project.

## The fault soak: volume

A **soak** is a long run that shows what a short run cannot: memory that creeps, logs that grow, and recovery that gets slower. [Caraxes](/blog/a-dragon-to-attack-our-own-database), our database test tool, runs a bank soak for two hours every day, and we also use it to accept new versions of the storage stack.

The bank workload moves money between accounts in a table of 2,000 rows, so transactions collide on purpose. After the run, the total balance must be exactly the same as at the start.

The workload has two kinds of operation, in equal parts:

- **A read** reads one row by its primary key.
- **A transfer** reads two rows, updates two rows and commits. The whole transaction counts as one operation.

[Our throughput post](/blog/from-400-to-10k-ops) recorded fault soaks at 3,230 to 5,485 operations per second. Over two hours, that is 23 to 39 million operations, and about 12 to 20 million of them are transfers. These rates are approximate and depend on the host. The figures are calculated from those rates and are not a count from one run.

The same post measured 10,284 operations per second with no faults, for 45 minutes self-hosted storage. That is a separate run and is not part of the soak figures.

The fault soak kills the leader, freezes processes and throttles a disk, with 14 faults in the window. [Part three of the dragon series](/blog/what-the-dragon-found-part-three) lists the pass rules: exact balances, no unresolved commit, no lost or duplicated row, and no two replicas that apply one log entry differently.

The daily soak runs on a dedicated Linux machine at our company, not on GitHub Actions. The reason is capacity: a two-hour soak needs steady CPU and disk for three nodes and a load generator, and the shared GitHub runners cannot give that. The soak scenarios are public, so you can run the same soak on your own hardware. The fixes are public too, as the commits below show.

## The nightly jobs: depth

The soak gives volume, but a total balance check cannot see every kind of anomaly. So the nightly jobs check less data more closely.

| Job | What it checks | Last count (November 6) |
| --- | --- | --- |
| Caraxes Elle matrix | 3 transaction shapes, 1 and 3 nodes, each isolation level, locking mode and wire mode | 76 scenarios, 4.7M operations |
| Caraxes append and bank scenarios | No faults, partitions, kills, clock jumps, leader transfers, range splits, replica moves | 18 scenarios, 348,000 operations |
| [SQL fuzzer](/blog/what-a-sql-fuzzer-catches) | The same query must give the same answer under every plan | 1,672 rounds, 172,112 statements, 56,622 checks |
| Kahuna Jepsen | The transactional storage layer under CamusDB, with faults | 26 jobs, 100,167 operations |
| Kommander Jepsen | The Raft consensus layer under Kahuna, with faults | 13 jobs, about 20,000 operations |
| Kommander random search | Generated fault plans on real three-node clusters | 38 seeds, 352 tests passed, 38 skipped |
| Plan quality | Query plans on two benchmark query sets, one of them the Join Order Benchmark | 212 queries |

**Elle** reads the full history of a run and looks for isolation anomalies such as lost updates and write skew. Before any Elle scenario runs, the job gives Elle histories with known verdicts. A checker that passes a lost update would make every green result meaningless.

**Jepsen** is a widely used tool that tests distributed systems under faults. The Jepsen counts are small on purpose. The clients run at 10 requests per second each, because the cost of the check grows quickly with the size of the history. A short history that a checker can fully judge is worth more than a long one that it cannot. These two harnesses test the layers under CamusDB, not its SQL.

A weekly job adds a long arm: 12 Elle scenarios, each of which must reach one million committed transactions or fail. Its first scheduled run is on November 8, so the totals above do not include it.

## The test suites

Each push to a main branch runs the full test suite of that repository. The last run of each suite on November 6 had these totals:

| Repository | Tests |
| --- | --- |
| CamusDB (including plan quality) | 11,843 |
| Kahuna | 5,443 |
| Kommander | 3,457 |
| Caraxes | 456 |
| **Total** | **21,199** |

## How often the nightly jobs fail

A volume number without its failures tells you little. These are the scheduled runs to date:

| Job | Since | Runs | Passed | Failed or cancelled |
| --- | --- | --- | --- | --- |
| Kahuna Jepsen | August 5 | 94 | 57 | 37 |
| Kommander Jepsen | August 13 | 86 | 76 | 10 |
| Kommander random search | September 4 | 64 | 48 | 16 |
| Caraxes append and bank scenarios | September 25 | 43 | 33 | 10 |
| Plan quality | October 15 | 23 | 22 | 1 |
| Caraxes Elle matrix | November 3 | 4 | 3 | 1 |
| SQL fuzzer | November 4 | 3 | 3 | 0 |

A failed night means "download the results and look". It is not always a database defect, because these jobs run on shared CI machines and a slow machine can also fail a run. We did not classify each failure for this post. The defects that these jobs and Caraxes did find are in the [dragon series](/blog/what-the-dragon-found).

## What the soak found this week

Volume matters only if it finds something. On November 4 and 5, three soaks in a row each found a new problem. These runs added kills of 2 and 4 minutes to the fault schedule. After a long kill, a replica can fall too far behind to catch up from the log. It then needs a **snapshot install**: a full copy of the data from the leader.

| Soak | What happened | Fix |
| --- | --- | --- |
| First, November 4 | A restarted replica could not rejoin. Its install took 53 to 130 seconds instead of 4 to 24. The leader kept sending log entries that the replica could not apply, about 2 million during one install, and the node ran out of memory at every limit we tried. | [Kommander](https://github.com/kahunakv/kommander/commit/d44cf2f) refuses these entries during an install. [Kahuna](https://github.com/kahunakv/kahuna/commit/c38f66b2) times each install phase and releases the old state before it builds the new state. |
| Second, November 4 | No node died, but one install took 205 seconds, and 174 of them were in a step that waited with no deadline. The leader also removed 2.4 million log entries that the replica still needed, so a second install followed. With only two voting replicas left, a 30-second pause of the leader became a 29-second outage. | [Kahuna](https://github.com/kahunakv/kahuna/commit/53edc178) removes that wait from the install. [Kommander](https://github.com/kahunakv/kommander/commit/6ebb69d) keeps the log entries until the install ends, and waits 10 minutes before it removes a dead member. |
| Third, November 5 | After a 2-minute kill of the leader, the new leader's connection to the returned node stayed broken for 53 minutes, with about 45,000 log lines per minute. With the third voting replica down, the two survivors kept repeating elections. The cause was [a timing defect in the .NET gRPC client](https://github.com/grpc/grpc-dotnet/issues/2734). | [Kommander](https://github.com/kahunakv/kommander/commit/a7a9078) moves to a gRPC version with the upstream fix, replaces a connection that stays failed for 30 seconds, and limits the log lines. |

The balance checks passed in the first two runs, so those defects cost availability and recovery time, not data. The first defect needs a store that is about an hour old, and a ten-minute run never has one. The third needs a timeout to fire in a narrow gap between two connection attempts. Hand-written tests rarely reach states like these. Later soaks on the fixed versions confirmed all of these fixes.

## What the numbers do not prove

- **Volume is not coverage.** Millions of transfers over 2,000 rows repeat one shape many times. The nightly jobs and the fuzzer exist to reach other shapes.
- **Most of the soak volume has a simple check.** The soak checks totals and row ledgers. The stronger Elle check applies to the nightly histories, about 5 million transactions per night.
- **This is not a production cluster.** These runs use one self-hosted machine or shared CI machines. They say little about a large table, a database larger than memory, or a real network between regions.

## What the testing gives us

These tests catch regressions and, more importantly, they find new edge cases. An edge case might appear only once in 2 million transactions, so a short test run rarely meets it. Each one we find is a chance to improve the system, try a better design or rethink an existing approach.

Even at this scale, the tests cannot prove that CamusDB has no bugs or that no area is left to improve. A green run says only that these checks found no defect in these runs. What the tests give us is greater confidence that we are building a solid system, and a steady way to make CamusDB more robust.

We also plan to add new test shapes that exercise the database from other angles, with a wider range of scenarios and combinations of features.

You do not have to take our word for most of this. The nightly runs are public on GitHub, and the harnesses are open: [Caraxes](https://github.com/camusdb/camusdb-caraxes), [Kahuna Jepsen](https://github.com/kahunakv/kahuna-jepsen) and [Kommander Jepsen](https://github.com/kahunakv/kommander-jepsen). You can read the scenarios and run them against your own build.
