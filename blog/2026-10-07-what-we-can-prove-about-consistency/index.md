---
slug: what-we-can-prove-about-consistency
title: What we can prove about consistency
date: 2026-10-07
authors: [andresgutierrez]
tags: [camusdb, reliability, consistency, jepsen, distributed-systems]
image: /img/caraxes2.png
---

# What we can prove about consistency

A database for money needs a report, not a promise.

This post is that report. It follows the shape of a Jepsen analysis: what the
system claims, how we tested the claims, what broke, what we fixed, and what we
still cannot prove. Jepsen LLC did not write it. We wrote it, with our own
harnesses, and two of those harnesses are built on the Jepsen library. Every
number below comes from a file in one of four repositories, and the last section
tells you how to run the same tests yourself.

<!-- truncate -->

## The system under test

CamusDB is a SQL database on three layers. Kommander is the Raft implementation.
Kahuna is the replicated transactional key-value store built on Kommander.
CamusDB is the SQL engine on Kahuna. A bug can live in any layer, so each layer
has its own test suite and its own history of findings.

The report covers these versions.

| Layer | Version | Date |
|---|---|---|
| CamusDB | commit `a02b144a` | 2026-10-07 |
| Kahuna | 1.11.2 | 2026-10-06 |
| Kommander | 1.10.2 | 2026-10-06 |

## The claims

The transaction documentation makes these claims. The rest of the post tests
them.

1. The default isolation level is Serializable, for autocommit statements and
   for explicit transactions. Read Committed is an explicit opt-out.
2. A Serializable read-write transaction uses strict two-phase locking. Reads
   take shared point locks and shared range locks, and hold them to commit.
   This blocks non-repeatable reads, phantoms, write skew, and lost updates.
3. A Serializable read-only transaction reads one snapshot, pinned to one
   hybrid logical clock timestamp. It never blocks and is never blocked.
4. Deadlocks resolve by wait-die. The older transaction waits and wins. The
   younger one aborts at once.
5. A commit is durable when a majority of replicas hold it.
6. A commit whose outcome the client cannot learn returns one specific error,
   and the client retries the same commit on the same handle.

One claim is absent on purpose. CamusDB does not claim external consistency or
linearizability across transactions. Transaction order is logically consistent
through the hybrid logical clock. There is no commit-wait. Keep that in mind
when you read the Kahuna and Kommander sections, where linearizability is
checked at the key-value and log level.

## How we test

Four suites test the three layers.

| Suite | Layer | Tool | Checkers | Faults |
|---|---|---|---|---|
| kommander-jepsen | Kommander | Jepsen 0.3.7, 5 nodes | Knossos linearizability on a CAS register, a custom Log Matching checker, HLC monotonicity | partition, kill, pause, membership, HLC skew |
| kahuna-jepsen | Kahuna | Jepsen 0.3.7, 5 or 6 nodes | Knossos on a register, Elle list-append (serializable), lock fencing, sequencer, pinned snapshot | partition, kill, pause, membership, replica placement, key-range split and merge |
| Caraxes | CamusDB | Docker cluster, real SQL over gRPC | Elle list-append (serializable), bank balance conservation, divergent-apply scan, live `COUNT(*)` probe | kill, stop, pause, partition, slow link, packet loss, full disk, slow disk, leader transfer, clock skew |
| Unit and integration suites | all three | NUnit | assertions | injected faults in process |

The faults are real. A kill is SIGKILL. A partition is a firewall rule. A slow
disk is a kernel I/O limit of 4 KiB per second. A clock jump is a shim on the
real-time clock, up to 12 hours.

The two Jepsen suites run every night in CI. Both suites say in their design
documents that they are not a per-pull-request gate, because the runs are
nondeterministic. A green night is evidence. A red night is a finding to
investigate, not always a bug.

## Results by layer

### Kommander: the Raft log

The register workload checks linearizability per key with Knossos. The
log-append workload checks the Raft Log Matching Property: every acknowledged
entry is present on every replica that answers, no index holds two values, no
value applies twice, and application is monotonic.

The register workload found no linearizability violation in any recorded run.

The latest stored run is a log-append run under kill plus HLC skew, from
2026-09-29.

| Metric | Value |
|---|---|
| Operations | 909 |
| Acknowledged appends | 599 |
| Holes | 0 |
| Tail losses | 0 |
| Diverged indexes | 0 |
| Duplicates | 0 |
| Undelivered entries | 0 |
| HLC comparisons checked | 3,015 |
| HLC regressions | 0 |
| Kills | 8 |
| Clock bumps and strobes | 16 |
| Largest HLC lead injected | 255 s |
| Converged after the run | yes, in 89 ms |

The suite found five defects in August 2026. Four are fixed and verified by
later runs. One is open.

| Finding | Exposed by | Status |
|---|---|---|
| The leader did not apply some of its own committed entries. Pipelined proposals completed out of order and the applied frontier skipped one. | log-append, partition and kill | Fixed in commit `f1658ba`. About 14 later runs show zero holes. |
| A follower acknowledged appends from an old term after it voted in a new one. Acked writes at four indexes were lost. | register, ring partition | Fixed in Kommander on 2026-08-13. The nightly register jobs with partitions passed 9 of 9 on 2026-08-14. |
| Follower write-ahead log backpressure threw instead of pushed back. The leader resent blindly. | log-append, partition | Fixed in commits `985f017` and `6eb2a09`. Not yet reproduced often enough to call it verified under load. |
| Two different entries committed at the same index. The proposal index allocator regressed below an occupied index after a promotion. | log-append, partition and kill | Fixed in commit `04429b3`. Two nightly runs after the fix passed 9 of 9. |
| One acknowledged append was absent from every replica, and its index held a different entry. Three occurrences. | log-append, partition and kill | Open. Root cause not established. |

The last row is the most important one in this section. It is a real
durability defect, it occurred three times in August, and we do not know the
cause yet. We have not seen it since the index allocator fix, but absence
across a few weeks of nightly runs is not proof.

### Kahuna: the transactional key-value store

Kahuna is where most of the consistency logic lives, so it has the longest
findings file: 25 server-side findings, plus about a dozen harness false
positives that we fixed in the checkers.

The latest fully recorded nightly matrix is from 2026-08-19, on Kahuna commit
`70b75d2`.

| Metric | Value |
|---|---|
| Nightly jobs | 25 |
| Jobs passed | 24 |
| Job with no verdict | 1, replication factor 1 under kill plus placement, insufficient data |

Later verification runs, grouped by anomaly class:

| Property | Runs | Commits or operations | Anomalies |
|---|---|---|---|
| No lost update (Elle, partition and kill) | 11 | 1,936 commits | 0 |
| No aborted read, G1a (Elle, partition and kill) | 22 | 6,713 commits | 0 |
| No write skew, G2-item (Elle, partition and kill) | 29 | 78 to 744 commits each | 0 |
| Fencing tokens monotonic (lock, partition at 5 s interval) | 16 | 66 to 155 acquires each | 0 |
| Pinned snapshot never changes (300 s, partition) | 1 | 450 protected reads, depth up to 32 | 0 |
| Key-range split and merge under partition and kill | 1 | 6 splits, 2 merges, 167 range maps sampled | 0, linearizable throughout |

The findings that matter most for a database of record:

| Finding | Exposed by | Status |
|---|---|---|
| A node in a minority partition served stale reads. Reads trusted the local leader belief. | register, partition | Fixed. Reads now confirm leadership with a quorum. 8 of 8 clean after the fix, against 1 in 3 before. |
| Lost update. The read-modify-write base was never validated at commit. | append, partition and kill | Fixed with a staged-base compare-and-set before propose. |
| Aborted read. A client received a definite Aborted without a durable abort record, and once after the commit landed. | append, partition and kill | Fixed. A refusal before the record exists now says retry, not aborted. |
| Fencing tokens went backwards after kill plus restart. A replay floor advanced past unflushed lock state. | lock, partition and kill | Fixed in Kahuna `485daa3` and `39ec8e0`. |
| Fencing tokens went backwards under partition alone. Promotion read the log while writes were still queued. | lock, partition | Fixed in Kommander 1.0.10. 16 of 16 clean. |
| A held snapshot rewound to an older revision. Compaction left a hole and the lookup skipped the disk. Reproduced with no fault at all. | snapshot | Fixed in `65fcc70`. 64 violating reads went to 0. |
| Read skew during a key-range split. The new partition leader served a stale read while prepared intents were unsettled. | append, range split | Fixed in `cfbb55d2` with a settle-before-cutover barrier. The first two runs after the fix passed. The base rate was 1 in 3, so this is weak evidence. |
| Write skew under key-range routing, before the split. | append, partition, placement, range | Open. |
| Fencing tokens went backwards and one token was reused by two owners under replica placement. | lock, partition and placement | Open. |
| The system partition never checkpoints its log. | placement jobs | Open. |

Three findings are open. None of the three is on the default path of a CamusDB
cluster today. Key-range sharding and online replica placement are opt-in
features. That is a reason to keep them opt-in, not a reason to ignore them.

### CamusDB: SQL under faults

Caraxes runs real SQL through the gRPC client against a three-node cluster, and
checks two things that a bank cares about.

The first check is Elle. The append workload runs list-append transactions
over 8 keys with 16 workers, and Elle searches the history for cycles under the
serializable model. Only a verdict of valid passes. A timeout fails.

The second check is the bank invariant. Transfers move money between random
rows, and the sum of all balances must be identical after the run. Since the
second dragon post, the verdict reads the sum twice, once through the aggregate
and once through a full row scan, and both must match the seed.

The local run archive holds 38 Elle runs on CamusDB 0.13.2 and 0.13.3, with
Kahuna 1.9.8 to 1.10.4. The table lists the runs with a valid Elle verdict and
zero divergent applies.

| Scenario | Fault | Operations | Elle |
|---|---|---|---|
| append-smoke | none | 20,689 and 22,944 | valid, twice |
| append-rw-8keys | none | 18,196 to 18,626 | valid, 3 runs |
| append-rw-contended, 2 keys | none | 23,013 and 22,920 | valid, twice |
| append-read-committed | none, read-committed model | 39,157 to 43,565 | valid, 3 runs |
| append-optimistic | none, optimistic locking | 17,915 and 19,296 | valid, twice |
| append-partition | partition | 13,489 and 13,727 | valid, twice |
| append-pause | SIGSTOP | 20,470 to 23,524 | valid, 5 runs |
| append-slow | 150 ms added latency | 19,177 and 18,750 | valid, twice |
| append-kill-optimistic | SIGKILL | 15,842 and 17,808 | valid, twice |
| append-leader-transfer | 5 handovers in 90 s | 26,187 to 36,642 | valid in 5 runs, invalid in 2, no verdict in 2, see below |
| append-clock-skew-small | ±2 s skew | 37,035 | valid |
| append-clock-jump | jump over 5 s | 37,583 | valid |
| append-clock-jump-locks | jump over 15 s | 44,549 | valid |
| append-clock-jump-liveness | 3 min forward, 1 min back | 29,556 | valid |

Thirteen of those runs still carry a FAIL verdict in the archive. The Elle
check passed in each one. The failure was the recovery rule: the cluster did
not regain 90 percent of its throughput within 45 seconds, or the 90 second
window ended before the last fault healed. We report that as a performance
finding, not a correctness one, and the two are graded apart.

Two runs failed on correctness, and one more had a divergent apply with no
Elle verdict. All three were leader-transfer runs on Kahuna 1.9.8 and 1.9.9.

| Run | Kahuna | What Elle saw |
|---|---|---|
| cp2 | 1.9.8 | G0, G2-item, incompatible order. Four divergent applies on two keys. |
| k198b-r1 | 1.9.8 | Three divergent applies on one row key at log entry 41723, on all three nodes. Elle crashed. |
| k199-r1 | 1.9.9 | G-single-item, incompatible order. Not read committed. |

These are the most serious CamusDB-level findings of the year, so they get the
detail.

A transaction's staged writes lived only in the memory of the partition leader.
A leader change dropped them, and nothing told the transaction. The new leader
answered the next read with the committed value, and staged the next write
from the committed head, as if the key were untouched. The commit then wrote
the last staged value and lost the transaction's own earlier write. The base
check passed, because no other commit had moved the head. Kahuna 1.10.3 fences
the staging chain. A restaged key must sit exactly one revision above the
previous staging, and a break refuses the commit.

The same class of bug had a second shape, found by the nightly on Kahuna
1.10.6. A lock also lived only in the leader's memory. After a leader change,
a renewal or a shared-to-exclusive upgrade came back as a fresh grant, and the
commit never checked that the lock was still held. In between, the new leader
granted the same key to a competitor. One writer overwrote a competitor's
commit with a value computed from the old row. One reader committed a view of
one key at two committed states. The fix on 2026-10-01 refuses a commit whose
locks a leader change dropped. Both fixes ship in Kahuna 1.11.2, the version
CamusDB uses today, and both carry regression tests in the Kahuna suite.

The honest caveat: the local archive has no leader-transfer Elle run on 1.11.2.
The nightly append matrix runs the scenario every night, and the nightly is
where the second shape was found. We will post the numbers when a month of
nights is in.

The bank invariant history is in the second dragon post. The short version:
one dropped transfer leg in 1,805,784 operations, three units out of three
billion, found in July and fixed; a chain of eight 45-minute runs that ended
with two consecutive clean windows; and a live scan probe after a run returned
1,962 to 1,999 rows out of 2,000 under load. The rule that came out of that
chain still holds. A build must pass two consecutive windows before we call it
stable.

### The unit and integration suites

The four suites above are the ones that find the hard bugs. The ordinary suites
are what keep them fixed. Every finding above has a regression test in one of
them.

| Suite | Test cases | Latest full run | Passed | Failed |
|---|---|---|---|---|
| CamusDB.Tests | 7,270 | 2026-10-07, 36 min 54 s | 7,261 | 0, 9 not executed |
| Kahuna.Server.Tests | 3,807 | 2026-10-07, working tree | 3,797 | 2 |
| Kahuna.Client.Tests | 145 | 2026-09-25 | 145 | 0 |
| Kommander.Tests | 2,938 | 2026-10-01, working tree | 2,922 | 1 |

That is 14,160 test cases across the three layers. The two Kahuna failures and
the one Kommander failure are from local runs on uncommitted working trees.
This report does not analyse them. The CamusDB run is on commit `a02b144a`.

Inside the CamusDB suite, the consistency-specific coverage breaks down like
this:

| Area | Test methods |
|---|---|
| Named for Serializable behavior | 93 |
| Named for retry contracts | 58 |
| Named for concurrent access | 56 |
| Named for snapshot reads | 40 |
| Named for range locks | 30 |
| Phantom, lost update, write skew, non-repeatable read, by name | 15 |
| Files that inject Kahuna faults through a delegating seam | 18 |

The anomaly suite covers every class the documentation claims to block: a
non-repeatable read, a phantom, write skew, a lost update, and two writers of
one row where the younger aborts at once.

## What this report does not prove

A consistency report is only as good as its list of gaps. These are ours.

- **No linearizability claim for SQL.** Elle checks serializable, not strict
  serializable. Real-time order across transactions is not asserted anywhere
  for CamusDB. The register workloads check linearizability for Kahuna keys
  and Kommander entries, not for SQL rows.
- **Clock faults are thin.** Caraxes jumps the real-time clock, and Kommander
  skews the hybrid logical clock. The Kahuna Jepsen suite does not test clock
  skew at all. Raft timers run on a monotonic clock, so the exposure is in
  transaction timestamps, not elections.
- **No disk faults in the Kommander suite.** Full-disk and slow-disk faults are
  Caraxes only.
- **Kill mid-transaction in NUnit is absent.** The NUnit restart tests close
  and reopen a database on one node. No NUnit test kills a Raft node in the
  middle of a transaction. That coverage lives in the three chaos suites.
- **The 3-node anomaly claim in the docs is not a test.** The anomaly suite in
  NUnit runs on one node. The documentation says the same suite passes on a
  3-node cluster, and the Caraxes Elle runs support it, but no checked-in test
  asserts it.
- **Verification is probabilistic.** Several closures rest on an absence. A
  1-in-3 bug that passes two runs is not fixed with confidence. The findings
  files say so for each case, and this post repeats it.
- **Replication factor 1 and online placement are weakly verified.** The
  placement job at factor 1 is bistable in CI, and completed moves at factor 1
  are not asserted.
- **One Kommander durability finding is open.** An acknowledged append absent
  from every replica is the kind of bug a bank cannot accept. It has not
  recurred since August. That is not closure.

## How to run it yourself

Each suite builds the layer from source on your disk.

```bash
# Kommander: linearizable register under partitions, 5 nodes
cd kommander-jepsen
lein run test --workload register --faults partition --time-limit 180 --rate 10

# Kahuna: Elle list-append under partition and kill
cd kahuna-jepsen
lein run test --workload append --faults partition,kill --time-limit 180 --rate 10

# CamusDB: Elle list-append during five leader transfers, real Docker cluster
cd camusdb-caraxes
dotnet run --project Caraxes -- run --scenario scenarios/append-leader-transfer.yml

# CamusDB: the bank invariant under a node kill
dotnet run --project Caraxes -- run --scenario scenarios/bank-kill.yml
```

Every run writes a history, a verdict, and the node logs. A FAIL exits with
code 1. The findings files in the two Jepsen repositories are public, and they
record the false alarms next to the real bugs.

## What this means for a ledger

A bank asks three questions of a database. Did a confirmed write survive? Did
any transaction see half of another? Can you show me?

For the first two, the answer today is: under every fault we inject on the
default configuration, with the current versions, the checkers find nothing.
Under two opt-in features, key-range sharding and online placement, two
anomalies are open. One Raft-level durability defect from August has no root
cause.

For the third question, this post is the answer, and it is not finished. The
next report will carry a month of nightly leader-transfer results on Kahuna
1.11.2, a strict-serializable Elle arm, and clock skew in the Kahuna suite. A
database earns trust on its worst day, and the only way to know what that day
looks like is to keep causing it.
