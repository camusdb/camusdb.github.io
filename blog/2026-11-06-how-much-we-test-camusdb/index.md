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

This post shows how much testing stands behind CamusDB: about **5.4 million operations per night**, **23 to 39 million operations in each daily two-hour fault soak**, and more than 21,000 automated tests. You will see where these numbers come from and what they do not prove.

<!-- truncate -->

## Test volume per night

| Source | Workload | Volume per night | Basis |
| --- | --- | --- | --- |
| Caraxes nightly | 94 scenarios, most with Elle history checks | 5.1M operations | Counted on November 6 |
| SQL fuzzer | 5 oracles, 60 seconds each | 172,112 statements | Counted on November 6 |
| Kahuna Jepsen | 26 jobs | 100,167 operations | Counted on November 6 |
| Kommander Jepsen | 13 jobs | About 20,000 operations | Counted in 6 jobs, estimated for the rest |
| **Total per night** | | **About 5.4M** | |

These counts describe the current schedule. The nightly Elle matrix started on November 3 and the scheduled SQL fuzzer started on November 4. This means that you cannot multiply these numbers by the age of the project.

## The fault soak: volume

A **soak** is a long run that shows what a short run cannot: memory that creeps, logs that grow, and recovery that gets slower. We run a two-hour bank soak daily with [Caraxes](/blog/a-dragon-to-attack-our-own-database), our database test tool, and we also use it to accept new versions of the storage stack.

The bank workload moves money between accounts in a table of 2,000 rows, which makes transactions collide on purpose. After the run, the total balance must be exactly the same as at the start.

The workload has two kinds of operation, in equal parts.

- **A read** reads one row by its primary key.
- **A transfer** reads two rows, updates two rows and commits. The transaction counts as one operation.

[Our throughput post](/blog/from-400-to-10k-ops) recorded fault soaks at 3,230 to 5,485 operations per second. Over two hours, that is 23 to 39 million operations, and about 12 to 20 million of them are transfers. These rates are approximate and depend on the host. The figures are calculated from those rates and are not a count from one run.

The same post measured 10,284 operations per second with no faults, for 45 minutes self-hosted storage. That is a separate run and is not part of the soak figures.

The fault soak kills the leader, freezes processes and throttles a disk, with 14 faults in the window. [Part three of the dragon series](/blog/what-the-dragon-found-part-three) lists the pass rules: exact balances, no unresolved commit, no lost or duplicated row, and no two replicas that apply one log entry differently.

We run the daily soak on a dedicated Linux machine at our company, because a two-hour soak needs steady CPU and disk for three nodes and a load generator, and the shared GitHub runners cannot give that. The soak scenarios are public, and you can run the same soak on your own hardware. The fixes are public too, as the commits below show.

## The nightly jobs: depth

The soak gives volume, but a total balance check cannot see all kinds of anomaly. So the nightly jobs check less data more closely.

| Job | What it checks | Last count (November 6) |
| --- | --- | --- |
| Caraxes Elle matrix | 3 transaction shapes, 1 and 3 nodes, each isolation level, locking mode and wire mode | 76 scenarios, 4.7M operations |
| Caraxes append and bank scenarios | No faults, partitions, kills, clock jumps, leader transfers, range splits, replica moves | 18 scenarios, 348,000 operations |
| [SQL fuzzer](/blog/what-a-sql-fuzzer-catches) | The same query must give the same answer under all plans | 1,672 rounds, 172,112 statements, 56,622 checks |
| Kahuna Jepsen | The transactional storage layer under CamusDB, with faults | 26 jobs, 100,167 operations |
| Kommander Jepsen | The Raft consensus layer under Kahuna, with faults | 13 jobs, about 20,000 operations |
| Kommander random search | Generated fault plans on real three-node clusters | 38 seeds, 352 tests passed, 38 skipped |
| Plan quality | Query plans on two benchmark query sets, one of them the Join Order Benchmark | 212 queries |

**Elle** reads the full history of a run and looks for isolation anomalies such as lost updates and write skew. Before the first Elle scenario, the job gives Elle histories with known verdicts. A checker that passes a lost update would make all green results meaningless.

**Jepsen** is a widely used tool that tests distributed systems under faults. The Jepsen counts are small on purpose. The clients run at 10 requests per second each, because the cost of the check grows quickly with the size of the history, and a checker can fully judge a short history. These two harnesses test the layers under the SQL engine of CamusDB.

A weekly job adds a long arm: 12 Elle scenarios, each of which must reach one million committed transactions or fail. Its first scheduled run is on November 8, and the totals above do not include it.

## The test suites

Each push to a main branch starts the full test suite of that repository. The totals are from the last run of each suite on November 6.

| Repository | Tests |
| --- | --- |
| CamusDB (including plan quality) | 11,843 |
| Kahuna | 5,443 |
| Kommander | 3,457 |
| Caraxes | 456 |
| **Total** | **21,199** |

## Failure rate of the nightly jobs

A volume number without its failures tells you little. The table counts each scheduled run to date.

| Job | Since | Runs | Passed | Failed or cancelled |
| --- | --- | --- | --- | --- |
| Kahuna Jepsen | August 5 | 94 | 57 | 37 |
| Kommander Jepsen | August 13 | 86 | 76 | 10 |
| Kommander random search | September 4 | 64 | 48 | 16 |
| Caraxes append and bank scenarios | September 25 | 43 | 33 | 10 |
| Plan quality | October 15 | 23 | 22 | 1 |
| Caraxes Elle matrix | November 3 | 4 | 3 | 1 |
| SQL fuzzer | November 4 | 3 | 3 | 0 |

A failed night means "download the results and look". These jobs run on shared CI machines, where a slow machine can also fail a run. This means that a failed night is not always a database defect. We did not classify each failure for this post. The defects that these jobs and Caraxes did find are in the [dragon series](/blog/what-the-dragon-found).

## Three defects the soak found this week

On November 4 and 5, three soaks in a row each found a new problem. These soaks added kills of 2 and 4 minutes to the fault schedule. After a long kill, a replica can fall too far behind to catch up from the log. It then needs a **snapshot install**: a full copy of the data from the leader.

| Soak | What happened | Fix |
| --- | --- | --- |
| First, November 4 | A restarted replica could not rejoin. Its install took 53 to 130 seconds. The normal time is 4 to 24 seconds. The leader kept sending log entries that the replica could not apply, about 2 million during one install, and the node ran out of memory at all the limits we tried. | [Kommander](https://github.com/kahunakv/kommander/commit/d44cf2f) no longer takes these entries during an install. [Kahuna](https://github.com/kahunakv/kahuna/commit/c38f66b2) times each install phase and releases the old state before it builds the new state. |
| Second, November 4 | No node died, but one install took 205 seconds, and 174 of them were in a step that waited with no deadline. The leader also removed 2.4 million log entries that the replica needed, and a second install followed. With only two voting replicas left, a 30-second pause of the leader became a 29-second outage. | [Kahuna](https://github.com/kahunakv/kahuna/commit/53edc178) removes that wait from the install. [Kommander](https://github.com/kahunakv/kommander/commit/6ebb69d) retains the log entries until the install ends, and waits 10 minutes before it removes a dead member. |
| Third, November 5 | After a 2-minute kill of the leader, the new leader's connection to the returned node stayed broken for 53 minutes, with about 45,000 log lines per minute. With the third voting replica down, the two survivors kept repeating elections. The cause was [a timing defect in the .NET gRPC client](https://github.com/grpc/grpc-dotnet/issues/2734). | [Kommander](https://github.com/kahunakv/kommander/commit/a7a9078) moves to a gRPC version with the upstream fix, replaces a connection that is failed for 30 seconds, and limits the log lines. |

The balance checks passed in the first two soaks. Those defects cost availability and recovery time, and no data was lost. The first defect needs a store that is about an hour old, which a ten-minute run does not have. The third needs a timeout to fire in a narrow gap between two connection attempts. Hand-written tests rarely reach states like these. Later soaks on the fixed versions confirmed all of these fixes.

## Limits of these numbers

- **High volume covers few shapes.** Millions of transfers over 2,000 rows repeat one shape many times. The nightly jobs and the fuzzer exist to reach other shapes.
- **Most of the soak volume has a simple check.** The soak checks totals and row ledgers. The stronger Elle check applies to the nightly histories, about 5 million transactions per night.
- **This is not a production cluster.** These tests use one self-hosted machine or shared CI machines. They say little about a large table, a database larger than memory, or a real network between regions.

## Edge cases, planned tests, and public harnesses

These tests catch regressions and find new edge cases. An edge case might appear only once in 2 million transactions, and a short test run rarely meets it.

The tests cannot prove that CamusDB is free of bugs. A green run says only that these checks found no defect.

We plan to add new test shapes that exercise the database from other angles, with a wider range of scenarios and combinations of features.

The nightly results are public on GitHub, and the harnesses are open: [Caraxes](https://github.com/camusdb/camusdb-caraxes), [Kahuna Jepsen](https://github.com/kahunakv/kahuna-jepsen) and [Kommander Jepsen](https://github.com/kahunakv/kommander-jepsen). You can read the scenarios and run them against your own build.
