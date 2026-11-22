---
slug: what-the-dragon-found
title: "What the dragon found: defects from a month of chaos testing"
date: 2026-09-21
authors: [andresgutierrez]
tags: [camusdb, reliability, chaos-testing, distributed-systems]
image: /img/caraxes2.png
---

# What the dragon found: defects from a month of chaos testing

![A dragon breaking one pyramid in a city of glowing pyramids](/img/caraxes2.png)

This post lists the defects that one month of chaos tests found in CamusDB,
how we fixed each one, and how the database behaves today. If you are
evaluating CamusDB, it shows which failure cases have a test behind them.

[Caraxes](/blog/a-dragon-to-attack-our-own-database) is our test tool. It
starts a real cluster and injects node failures, network faults, and disk
faults under a workload. This is the second post about it.

<!-- truncate -->

## Commits and releases in one month

CamusDB is built on two lower layers. Kahuna is the replicated key-value store
under the SQL engine. Kommander is the Raft implementation under Kahuna. A
chaos run attacks all three at once, and a finding can land in any of them.

Between the first post and this one, the three repositories received a large
amount of work. Most of it came from a Caraxes run that failed.

| Repository | Commits since 2026-08-19 | Releases consumed by CamusDB |
|---|---|---|
| CamusDB | 150 | |
| Kahuna | about 133 | 45 versions, from 1.0.6 to 1.9.2 |
| Kommander | about 110 | from 1.2.x to 1.7.6 |

Caraxes itself has about 200 scenario files. Many of them carry a long header
that reads like a lab notebook. The header records what the previous run showed,
what changed for this run, and what result counts as a pass. The rest of this
post is a walk through those notebooks.

## Terms in this post

- **Raft:** the protocol with which nodes agree on the order of writes. The
  data is divided into partitions. Each partition has one leader that takes
  the writes and followers that copy its log.
- **Quorum:** a majority of the copies of a partition.
- **Backfill and snapshot:** a leader sends missing log entries to a follower
  that is behind (backfill). If those entries no longer exist, because the
  log was compacted, it sends a full copy of the state (snapshot).
- **Wedge:** a partition or a key that stops making progress and does not
  recover by itself.
- **Gateway:** the node that receives a client request.
- **fsync:** the system call that forces a write to the disk.
- **Soak:** a long test run.

## A lost half of a transfer: the sum fell by three

The first post explained our strongest check. A workload moves money between
random accounts, and the total of all balances must be exactly the same at the
end. We call it the bank workload.

The first bank run that failed this check was a two-hour run, with random
faults, on an early build. The sum went down by three units.

| Before | After | Difference |
|---|---|---|
| 2,993,071,553 | 2,993,071,550 | -3 |

Three units out of three billion prove that one transaction applied only half
of a transfer.

It took days to find the cause, which was in the SQL engine. When CamusDB
reads a row from Kahuna, the answer can be a confirmed value, a confirmed
absence, or a non-answer. A non-answer means the read timed out, or the key
was in the middle of replication, or that key returned an error.

The read path treated the non-answer as an absence. From there, the failure
was quiet at each step.

1. The UPDATE for one side of the transfer looked for the row and did not
   find it.
2. A match of zero rows is not an error, and the statement reported success.
3. The transaction committed with one leg of the transfer missing.
4. Commit validation found no problem, because the read recorded no
   observation to validate.

The fix is a contract that now applies to all read paths in the engine: a read
that cannot confirm the state of a key must fail the statement, and it can't
report the key as absent. A regression test in the engine carries the run name and the
missing three units in its comments.

We also added a tripwire in the workload. If an UPDATE matches zero rows right
after a SELECT that found the row, the transfer throws. That way, the same class
of bug appears as a failed transfer, which is easier to see than a small drift
in a sum.

## A partition that stopped while every node reported healthy

A busy partition changed leader after a fault. The new leader started a
backfill for a follower. A heartbeat acknowledgement with no report made the
leader believe the follower was at entry one, and the backfill started at
entry one. The follower's log was already compacted, and the follower refused.
The refusal did not escalate, and the partition stopped committing and did
not recover.

During all that time, all the nodes reported ready. The cluster health endpoint
said three of three nodes up, healthy, for 83 minutes, while the workload made
zero progress.

The fix in Kommander removed the fabricated anchor. Two more releases removed a
side effect, where the refusal escalated into a full snapshot on each election.
The larger change was in how Caraxes and CamusDB judge health.

- Caraxes detects a wedge by commit progress, because the nodes of a wedged
  partition can all be alive. A window with zero operations during a fault
  fails the run.
- CamusDB gained a degraded-partition detector. A partition whose leader has an
  open backfill refusal, or a snapshot rescue that does not converge, is
  reported as degraded even while its healthy quorum continues to commit.
- Caraxes now probes all the nodes during the run and grades outages against
  the fault timeline. A node that dies while its container is up fails the
  run. This rule exists because one run passed with a dead node in a green
  container.

The same family produced smaller fixes. A snapshot install loop sent 76
installs to one follower in 13 minutes and did not converge. A step-down that
raced an in-flight proposal left callers with no reply, no failure, and no
timeout. A node did not rejoin after a SIGSTOP pause. Each one was found by a
run that stalled at a specific minute with a specific seed, and it was fixed
against a repeat of that run.

## A stale key that took eight runs to fix

The longest chain in the notebooks started
with a 45-minute run named R and ended with a run named Z. Each run in the
chain used the same seed, the same faults, and the same workload, and only
the engine changed between them.

| Run | Result | What we learned |
|---|---|---|
| R | Sum off by 81, durable | A replica that held a write intent deferred the materialization of that transaction forever. Reads then served the older revision. |
| S | Sum off by 2 | The lost units were the first commit at the start of a wedge. The wedged key refused all writes until the end of the run. |
| T | Sum off by 1, for 46 minutes | The new self-repair read from the wedged node's own state, which was itself behind, and the repair had no effect. |
| U | Pass, with two keys wedged read-only | The repair's single retry was lost in the same pause that caused the miss. It was not re-armed. |
| V | Could not seed | The new armed repair turned a cheap false alarm into a storm: about 1,000 re-drives per node in under a minute. |
| W | Pass | The repair now verifies a miss off the actor before it acts. |
| X | Fail, same build as W | 38 rows were frozen up to 186 commits behind in scans, while the aggregates were fully caught up. |
| Y, Z | Pass, twice | A durable head that only moves forward. Zero refusal lines across all nodes for the full window. |

The first rule from this chain is that one clean window is weak evidence. Run W passed and the
identical run X failed. Now a build must pass two consecutive windows before we
call it stable.

The second rule is that the aggregate cannot see a stale key. Run U conserved
the sum exactly, while one row sat one commit behind on all nodes. Now the
verdict reads the sum in two ways, through the aggregate and through a full row
scan, and both must agree.

## Scans that dropped rows under write load

The post-run check counts rows on a quiet cluster, and it passed each time
for weeks. A new probe sends `SELECT COUNT(*)` to all the gateways at
intervals of a few seconds during the load.

Under load, the count returned between 1,962 and 1,999 rows out of 2,000 on
all the gateways. A scan dropped a row that a point read returned. The row was
resident, written after the page started, and a non-snapshot page evaluated it
as a snapshot read, then dropped it on a miss from the archive.

The second half of the bug was in CamusDB. A read-only scan carried a
transaction id, which let the MVCC pin in Kahuna abort a retried page. (MVCC
stores several revisions of a row, and a read sees one point in time.) One arm of
a device-pause run produced 365 aborts out of 399 read-only counts. Read-only
statements now carry no transaction id.

In a related finding, a pessimistic run with serializable isolation wedged
the cluster. Two nodes each read more than 645 GiB from a data directory
of 118 MB, and the cluster could not serve one aggregate thirty minutes after
the load stopped. A prefix scan with a pinned read timestamp walked the full
revision history of each key, and the bank workload leaves each hot row with
hundreds of revisions.

The probe is now part of the verdict. A short count always fails the run. A
run that lacks the probe prints that fact next to its result, because a run
that did not test scan visibility proves less than its pass suggests.

## Memory growth: one configuration cause and four leaks

The two-hour tests started to die at minute 88, then at minute 105. Nodes were
OOM-killed (stopped by the operating system for lack of memory), or entered a garbage collection spiral with the container up at 110%
CPU and the REST port unreachable.

The first cause was a default of the .NET runtime, which caps its heap at 75%
of the container limit. The heap plus the native memory of the storage
engine added up to more than the container. A node under load long enough to
reach its budget died although the code had no defect.

In the second cause, fixed cache floors in our code pinned about 700 MB in
caches for a working set of a few megabytes. The floors now yield to a proportional share
when the container is small, and each Caraxes node has an explicit heap
budget of 60% of its limit.

The memory findings after that were leaks, and the table gives the
measurement for each one.

| Finding | Measured | Fix |
|---|---|---|
| One retained async state machine per gateway request | 2,906,601 retained objects against 2,912,492 requests on one node | Constant-memory stream bookkeeping. Live growth fell from 0.258 to 0.039 KiB per operation. |
| Raft log reclamation could not keep up with ingest | 277 MB to 1,153 MB in ten minutes | The reclaim floor advances to the true floor on each pass. Before, it advanced by a fixed number of entries. |
| Raft log write-ahead files pinned by a column family that did not flush | 443 MiB to 2,709 MiB in ten minutes, per node | Metadata column family made flushable, and a cap on total write-ahead size. |
| Durable transaction records retained by age only | Filled a 2,458 MiB heap in about five minutes at 8,000 ops/s | Retention budget by count and by bytes, plus a heap-pressure valve. |

A faster commit path without a memory fix makes a long run
worse. The run reaches the memory knee sooner. In one pair of tests,
5.8 times the throughput bought a decay that started 3.3 times earlier.

In the case of the last row, an out-of-memory exception that was swallowed
in a write-ahead log write left a follower reachable and healthy, with its queue
pinned at 4,096 and zero batches for four minutes. The run continued on a
reduced quorum. We call this the zombie rule now: a node whose write counter
stops while the busiest node continues to write disqualifies the run, because the
test claims to measure a cluster with all its replicas.

## Slow disks: a new fault and three engine changes

The first post listed a full disk as the only disk fault. Long tests showed a
second kind: a slow disk.

During long tests on the benchmark host, the NVMe device produced fsync
excursions of up to 3.2 seconds under sustained load. An in-flight commit then
waited past its 15-second finalize budget and returned an unresolved outcome to
the client. Healthy followers logged the stalled leader as unavailable. No
process crashed, and the network had no fault.

So Caraxes gained a slow-disk fault. It caps one node's block writes through
the kernel's I/O controller, on demand, at a chosen rate. The default rate is a
device pause: one 4 KiB write per second. The process, its network, and its
peers stay healthy while each durable write waits at the block layer.

That fault drove three changes in the engine.

- A leader steps down cleanly when its disk pauses, and a follower's disk
  pause is ridden out from the log.
- Kahuna rides out a single node's disk pause without unknown outcomes.
- A local watchdog detects a durable write that stalls. A node whose disk
  stopped answering no longer looks healthy.

A related gate compared a build with single-fsync commit on and off, under
kills and partitions, with three seeds. The first pass failed the off arm with
real data loss: the sum was short by one, and one row was short by five with
zero indeterminate attempts, which no ambiguity band could explain. The on arm
passed. We repeated the gate with three more seeds. One failure and one pass
cannot separate a flag that helps from a flag that got lucky. Single-fsync
commit is the default today.

The same campaign hardened restarts. A node restarted under load could take a
snapshot for a log that already covered the floor, and then livelock on a
tombstone. A node that restarted while a peer was briefly unreachable crashed
at startup. Both are now regular scenarios.

## One node led every partition while requests looked balanced

A three-node run split its requests almost perfectly across the three
gateways, at 33.4%, 33.3%, and 33.4%. The report called it distributed. In the
same run, one node led all the partitions, and one disk did 100% of the durable
write work. One node logged about 500,000 key-value entries while the other
two logged fewer than 2,000.

The leader balancer was on. It planned six moves and reported five timeouts,
and it emitted no success at all. A transfer suggestion addressed to the
node that hosts the balancer took an in-process shortcut and skipped the
transport, and all of those moves were dropped. The drop paths logged at
debug level. This means that a balancer that failed five of six moves was
silent at the default log level.

The transport shortcut is fixed, and a lagging transfer target is now caught
up within a bounded wait. Caraxes now waits for leadership to spread before a
capacity window opens, and it fails a run that opens with all leaders on one
node. An even gateway share does not show which disk does the writes.

## Six false alarms from the test setup

Several of the most useful entries in the notebooks are findings against the
measurement.

- A twelve-table seed appeared to stall for six hours and eighteen minutes.
  The laptop had slept, and three node logs fell silent in the same second
  and resumed together. Our first reading was a defect in the database. Caraxes now compares a monotonic clock with wall time, and a run whose
  host slept fails without exception.
- A dependency bump looked like it cost 38% of throughput. We rebuilt the same
  commit with one character changed (the dependency version), and the bump
  cost 6.2%. Four commits in CamusDB owned the rest. A bisect on one merge commit
  separated two candidates cleanly.
- Two arms with byte-identical binaries differed by 1.36x, and run order
  predicted throughput with a correlation of -0.963. Two recorded findings
  were retracted. Each performance comparison is now a set of interleaved
  pairs in the order base, candidate, candidate, base. A pair that disagrees
  in direction is refused.
- The host NVMe serves the first 30 to 35 GB of a run from a write cache, then
  changes regime. Where that boundary lands depends on what the previous run
  left in the cache. Caraxes now writes fsynced ballast during warm-up so that
  each run measures the same regime.
- A closed-loop run reported 1,182 ops/s with 29.994 requests in flight against
  a cap of 32. That number was a limit of the load generator. The verdict now records the generator's own CPU and queue depth and
  can fail a capacity run whose client had no headroom.
- The container memory figure from Docker counts page cache and kernel memory
  together with the process. A tool now splits it into cache, native, unused
  heap, and live data. A growth curve then says which component grew.

Each of these produced a check that is now part of each later run.

## Group commit settings that changed defaults

The write-ahead log on the leader did not group commits. It wrote exactly one
operation per batch at all concurrency levels from 32 to 256 workers. The
group commit linger defaults to zero, and the cluster baseline did not set it. So a
defect report to the Raft layer would have been wrong.

The measurements that followed changed defaults.

| Knob | Measured | Decision |
|---|---|---|
| Linger of 1, 3, or 5 ms | Identical batches at full occupancy | Left alone. The linger is inert on a single hot partition by design. |
| Post-completion hold of 2 ms | 51 to 110 items per round at 128 workers, 6% more throughput, lower write p50 | Now the default. |
| Two or four in-flight batches per partition | 15 to 20% lower throughput | The default is unchanged at one. |
| Direct reads in the storage engine | Leader reads from 1 ms to 40 to 50 ms with the CPU idle | Ships off. |

## Behavior of the database today

- A read that cannot confirm a key fails the statement. A commit whose
  transport failed after submission returns an unresolved outcome, and the
  client retries the same commit on the same handle. A definite-looking error
  would hide a landed write.
- A stale leader cannot write. Proposals carry an expected term, quorum checks
  are on by default, and a leader that lost quorum learns it.
- A published commit index is not ahead of durable storage. The checkpoint
  floor advances after all the entries below it are on disk.
- The node flags the causes of a wedge: a backfill refusal, a snapshot rescue
  that does not converge, or a stalled durable write. The harness fails a run
  with zero progress under a fault.
- Memory has budgets. Retention is bounded by count and bytes, batch streams
  use constant memory, and storage budgets derive from the real heap limit.
- The disk can pause and the cluster survives, with no unknown outcomes for
  a single paused node.
- A crash leaves evidence. Crash dumps live outside the data volume, and node
  logs are captured before teardown. The harness records the build and the
  host behind each number, with the durability settings.

The scenarios from the first post still run, and their recovery numbers are
the ones we compare from build to build.

| Scenario | Fault | Peak error rate | Recovery after heal |
|---|---|---|---|
| Kill a node during transfers | SIGKILL for 20 seconds | 100% | 5.5 s |
| Kill a whole zone | Two nodes of six, 30 seconds | 100% | 4.1 s |
| Full disk | Data volume filled to the last byte, 15 seconds | 25% | 1.6 s |

In the full disk case, the node refused writes with a
clean error and continued to serve reads. It accepted writes again as soon as
space came back, and it needed no restart.

Kommander also gained an in-process simulation. It has seeded faults and
trace shrinking, and it checks invariants. Kahuna can now start a multi-node
cluster in one process with link blocks and restarts. Caraxes found the
failures at the level of a real cluster in Docker. These simulators reproduce
them in milliseconds in a unit test. A fix now comes with a test that fails
on the old code.

## Three rules for fault testing

Check invariants first. All the serious correctness bugs in this post were
found by a number that did not add up, and only then explained by a log.
Engine-side analysis of the logs alone ran out of evidence more than once. A
per-row ledger of all transfers, joined against the seeded baseline, let us attribute a
deficit to its rows.

Test the measurement too. A sleeping laptop and a saturated load generator,
among others, produced findings that looked exactly like database defects.
Each one now has a check in each later test.

Expect each fix to reveal the next bug. The chain from run R to run Z is eight fixes deep,
and each fix uncovered the next failure by removing the one in front of it.

Some scenarios in the notebooks still have open questions, and a few new
faults are on the list.
