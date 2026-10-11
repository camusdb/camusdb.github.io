---
slug: what-the-dragon-found
title: What the dragon found
date: 2026-09-21
authors: [andresgutierrez]
tags: [camusdb, reliability, chaos-testing, distributed-systems]
image: /img/caraxes2.png
---

# What the dragon found

![A dragon breaking one pyramid in a city of glowing pyramids](/img/caraxes2.png)

In a world that's moving faster every day, where software verification is
essential to keep up with that pace, building increasingly specialized
harnesses, simulators, and test suites has become imperative.

A few weeks ago, we introduced [Caraxes](/blog/a-dragon-to-attack-our-own-database),
our test suite for simulating extreme scenarios and pushing the database to its
limits under all kinds of conditions: node failures, network issues, disk
contention, and more.

The results have been extremely valuable, helping us uncover issues in both
performance and correctness.

It's similar to putting an F1 car through different configurations in a
simulator before those failures happen during a race. It allows us to expose
the system to hundreds of hours of testing and exceptional conditions,
compressed into just a few hours.

This post is the second part. It tells what the dragon found, what we fixed,
and how the database is more robust today.

<!-- truncate -->

## One month, in numbers

CamusDB runs on two lower layers. Kahuna is the replicated key-value store
under the SQL engine. Kommander is the Raft implementation under Kahuna. A
chaos run attacks all three at once, so a finding can land in any of them.

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

## The first real bug that money found

The first post explained our strongest check. A workload moves money between
random accounts, and the total of all balances must be exactly the same at the
end. We call it the bank workload.

The first bank run that failed this check was a two-hour run, with random
faults, on an early build. The sum went down by three units.

| Before | After | Difference |
|---|---|---|
| 2,993,071,553 | 2,993,071,550 | -3 |

Three units out of three billion is a tiny number. It is also a proof that one
transaction applied only half of a transfer. We spent days on this one.

The cause was in the SQL engine, not in the replication layer. When CamusDB
reads a row from Kahuna, the answer can be a confirmed value, a confirmed
absence, or a non-answer. A non-answer means the read timed out, or the key
was in the middle of replication, or that key returned an error.

The read path treated the non-answer as an absence. From there, the failure
was quiet at every step:

1. The UPDATE for one side of the transfer looked for the row and found
   nothing.
2. A match of zero rows is not an error, so the statement reported success.
3. The transaction committed with one leg of the transfer missing.
4. Commit validation saw nothing wrong, because the read recorded no
   observation to validate.

The fix is a contract that now applies to every read path in the engine: a read
that cannot confirm the state of a key must fail the statement. It must never
report absence. A regression test in the engine carries the run name and the
missing three units in its comments.

We also added a tripwire in the workload. If an UPDATE matches zero rows right
after a SELECT that found the row, the transfer throws. That way, the same class
of bug appears as a loud failed transfer instead of a small drift in a sum.

## A cluster that says healthy while it is dead

The second finding is the one that changed how we read health checks.

A busy partition changed leader after a fault. The new leader started a
backfill for a follower. A heartbeat acknowledgement with no report made the
leader believe the follower was at entry one, so the backfill started at entry
one. The follower's log was already compacted, so it refused. The refusal never
escalated, and the partition stopped committing. Permanently.

During all that time, every node reported ready. The cluster health endpoint
said three of three nodes up, healthy, for 83 minutes, while the workload made
zero progress.

The fix in Kommander removed the fabricated anchor. Two more releases removed a
side effect, where the refusal escalated into a full snapshot on every election.
But the more important change was in how Caraxes and CamusDB judge health:

- Caraxes detects a wedge by commit progress, never by node liveness. A window
  with zero operations during a fault fails the run.
- CamusDB gained a degraded-partition detector. A partition whose leader has an
  open backfill refusal, or a snapshot rescue that never converges, is reported
  as degraded even while its healthy quorum keeps committing.
- Caraxes now probes every node during the run and grades outages against the
  fault timeline. A node that dies while its container stays up fails the run.
  This rule exists because one run passed with a dead node inside a green
  container.

The same family produced smaller fixes. A snapshot install loop sent 76
installs to one follower in 13 minutes without convergence. A step-down that
raced an in-flight proposal left callers with no reply, no failure, and no
timeout. A node did not rejoin after a SIGSTOP pause. Each one was found by a
run that stalled at a specific minute, with a specific seed, and was fixed
against a repeat of that run.

## One key, eight runs

Not every bug falls in one run. The longest chain in the notebooks started
with a 45-minute run named R and ended with a run named Z. Every run in the
chain used the same seed, the same faults, and the same workload. Only the
engine changed.

| Run | Result | What we learned |
|---|---|---|
| R | Sum off by 81, durable | A replica that held a write intent deferred its own transaction's materialization forever. Reads then served the older revision. |
| S | Sum off by 2 | The lost units were the first commit at the start of a wedge. The wedged key refused every write until the end of the run. |
| T | Sum off by 1, for 46 minutes | The new self-repair read from the wedged node's own state, which was itself behind, so it repaired nothing. |
| U | Pass, with two keys wedged read-only | The repair's single retry was lost in the same pause that caused the miss. Nothing re-armed it. |
| V | Could not seed | The new armed repair turned a cheap false alarm into a storm: about 1,000 re-drives per node in under a minute. |
| W | Pass | The repair now verifies a miss off the actor before it acts. |
| X | Fail, same build as W | 38 rows were frozen up to 186 commits behind in scans, while the aggregates were fully caught up. |
| Y, Z | Pass, twice | A durable head that only moves forward. Zero refusal lines across all nodes for the whole window. |

Two rules came out of this chain.

The first rule is that one clean window is not evidence. Run W passed and the
identical run X failed. Now a build must pass two consecutive windows before we
call it stable.

The second rule is that the aggregate cannot see a stale key. Run U conserved
the sum exactly, while one row sat one commit behind on every node. Now the
verdict reads the sum in two ways, through the aggregate and through a full row
scan, and both must agree.

## Scans that drop rows only while you write

The post-run check counts rows on a quiet cluster. For weeks it passed every
time. Then we added a probe that runs `SELECT COUNT(*)` on every gateway every
few seconds during the load.

Under load, the count returned between 1,962 and 1,999 rows out of 2,000. On
every gateway. A scan dropped a row that a point read returned. The row was
resident, written after the page started, and a non-snapshot page evaluated it
as a snapshot read, then dropped it on a miss from the archive.

The second half of the bug was in CamusDB. A read-only scan carried a
transaction id, so the MVCC pin in Kahuna could abort a retried page. One arm of
a device-pause run produced 365 aborts out of 399 read-only counts. Read-only
statements now carry no transaction id.

A related finding was much louder. A pessimistic run with serializable isolation
wedged the cluster. Two nodes each read more than 645 GiB from a data directory
of 118 MB, and the cluster could not serve one aggregate thirty minutes after
the load stopped. A prefix scan with a pinned read timestamp walked the full
revision history of every key, and the bank workload leaves each hot row with
hundreds of revisions.

The probe is now part of the verdict. A short count is never tolerated, and a
run without the probe prints that fact next to its result, because a run that
did not test scan visibility proves less than its pass suggests.

## Memory that grows without a bug, and memory that grows with one

The two-hour runs started to die at minute 88, then at minute 105. Nodes were
OOM-killed, or entered a garbage collection spiral with the container up at 110%
CPU and the REST port unreachable.

The first cause had no defect in it. The .NET runtime caps its heap at 75% of
the container limit by default. The heap plus the native memory of the storage
engine added up to more than the container. A node under load long enough to
reach its budget died with nothing wrong in the code.

The second cause was ours. Fixed cache floors pinned about 700 MB in caches for
a working set of a few megabytes. The floors now yield to a proportional share
when the container is small, and every Caraxes node runs with an explicit heap
budget of 60% of its limit.

After that, the memory findings became real leaks, and each one has a number.

| Finding | Measured | Fix |
|---|---|---|
| One retained async state machine per gateway request | 2,906,601 retained objects against 2,912,492 requests on one node | Constant-memory stream bookkeeping. Live growth fell from 0.258 to 0.039 KiB per operation. |
| Raft log reclamation could not keep up with ingest | 277 MB to 1,153 MB in ten minutes | The reclaim floor advances to the true floor on every pass, instead of a fixed number of entries. |
| Raft log write-ahead files pinned by a column family that never flushed | 443 MiB to 2,709 MiB in ten minutes, per node | Metadata column family made flushable, and a cap on total write-ahead size. |
| Durable transaction records retained by age only | Filled a 2,458 MiB heap in about five minutes at 8,000 ops/s | Retention budget by count and by bytes, plus a heap-pressure valve. |

One line from the notebooks explains why memory matters more in a soak than
in a benchmark. A faster commit path without a memory fix makes a long run
worse, because the run reaches the memory knee sooner. In one pair of runs,
5.8 times the throughput bought a decay that started 3.3 times earlier.

The last row of the table hid a second bug. An out-of-memory exception swallowed inside a
write-ahead log write left a follower reachable and healthy, with its queue
pinned at 4,096 and zero batches for four minutes. The run continued on a
reduced quorum. We call this the zombie rule now: a node whose write counter
stops while the busiest node keeps writing disqualifies the run, because a
cluster that lost a replica without a fault is not the cluster the test claims
to measure.

## The disk is a participant

The first post listed a full disk as the only disk fault. That was not enough.

During long runs on the benchmark host, the NVMe device produced fsync
excursions of up to 3.2 seconds under sustained load. An in-flight commit then
waited past its 15-second finalize budget and returned an unresolved outcome to
the client. Healthy followers logged the stalled leader as unavailable. Nothing
crashed, and nothing was wrong with the network.

So Caraxes gained a slow-disk fault. It caps one node's block writes through
the kernel's I/O controller, on demand, at a chosen rate. The default rate is a
device pause: one 4 KiB write per second. The process, its network, and its
peers stay healthy while every durable write waits at the block layer.

That fault drove three changes in the engine:

- A leader steps down cleanly on its own disk pause, and a follower's disk
  pause is ridden out from the log.
- Kahuna rides out a single node's disk pause without unknown outcomes.
- A local watchdog detects a durable write that stalls, so a node whose disk
  stopped answering no longer looks healthy.

A related gate compared a build with single-fsync commit on and off, under
kills and partitions, with three seeds. The first pass failed the off arm with
real data loss: the sum was short by one, and one row was short by five with
zero indeterminate attempts, so no ambiguity band could explain it. The on arm
passed. We repeated the gate with three more seeds, because one failure and one
pass cannot separate a flag that helps from a flag that got lucky. Single-fsync
commit is the default today.

The same campaign hardened restarts. A node restarted under load could take a
snapshot for a log that already covered the floor, and then livelock on a
tombstone. A node that restarted while a peer was briefly unreachable crashed
at startup. Both are now regular scenarios, not accidents.

## Balanced requests are not balanced work

A three-node run split its requests almost perfectly across the three
gateways, at 33.4%, 33.3%, and 33.4%. The report called it distributed. In the
same run, one node led every partition, and one disk did 100% of the durable
write work. One node logged about 500,000 key-value entries while the other
two logged fewer than 2,000.

The leader balancer was on. It planned six moves and reported five timeouts,
and it never emitted a success at all. A transfer suggestion addressed to the
node that runs the balancer took an in-process shortcut instead of the
transport, and every one of those moves was dropped. The drop paths logged at
debug level, so a balancer that failed five of six moves was silent at the
default log level.

The transport shortcut is fixed, and a lagging transfer target is now caught
up within a bounded wait. Caraxes now waits for leadership to spread before a
capacity window opens, and it fails a run that opens with all leaders on one
node. An even gateway share says nothing about which disk does the writes.

## When the dragon was wrong

A harness that attacks a database also attacks the truth about it. Several of
the most useful entries in the notebooks are findings against the measurement,
not against the database.

- A twelve-table seed appeared to stall for six hours and eighteen minutes.
  Three node logs fell silent in the same second and resumed together. The
  first reading was a defect report against the database. The laptop had
  slept. Caraxes now compares a monotonic clock with wall time, and a run whose
  host slept fails without exception.
- A dependency bump looked like it cost 38% of throughput. We rebuilt the same
  commit with one character changed, the dependency version, and the bump cost
  6.2%. Four commits in CamusDB owned the rest. A bisect on one merge commit
  separated two candidates cleanly.
- Two arms with byte-identical binaries differed by 1.36x, and run order
  predicted throughput with a correlation of -0.963. Two recorded findings
  were retracted. Every performance comparison now runs as interleaved pairs in
  the order base, candidate, candidate, base, and a pair that disagrees in
  direction is refused.
- The host NVMe serves the first 30 to 35 GB of a run from a write cache, then
  changes regime. Where that boundary lands depends on what the previous run
  left in the cache. Caraxes now writes fsynced ballast during warm-up so every
  run measures the same regime.
- A closed-loop run reported 1,182 ops/s with 29.994 requests in flight against
  a cap of 32. That number was a limit of the load generator, not of the
  server. The verdict now records the generator's own CPU and queue depth and
  can fail a capacity run whose client had no headroom.
- The container memory figure from Docker counts page cache and kernel memory
  together with the process. A tool now splits it into cache, native, unused
  heap, and live data, so a growth curve says which component grew.

Each of these produced a check. The checks are cheap, and they protect every
later run from a false alarm we already paid for once.

## A tuning note that reads like a bug

One finding deserves a separate mention, because it was neither a bug nor a
false alarm. It was a knob nobody turned.

The write-ahead log on the leader never grouped commits. It wrote exactly one
operation per batch at every concurrency from 32 to 256 workers. The group
commit linger defaults to zero, and the cluster baseline never set it. A report
to the Raft layer that the log does not coalesce, written from runs where
coalescing was off, would be a bad filing.

The measurements that followed changed defaults:

| Knob | Measured | Decision |
|---|---|---|
| Linger of 1, 3, or 5 ms | Identical batches at full occupancy | Left alone. The linger is inert on a single hot partition by design. |
| Post-completion hold of 2 ms | 51 to 110 items per round at 128 workers, 6% more throughput, lower write p50 | Now the default. |
| Two or four in-flight batches per partition | 15 to 20% lower throughput | Default stays at one. |
| Direct reads in the storage engine | Leader reads from 1 ms to 40 to 50 ms with the CPU idle | Ships off. |

## What the database looks like today

The list of fixes is long. The shape of the database after them is easier to
describe.

- Unknown is never absent. A read that cannot confirm a key fails the
  statement. A commit whose transport failed after submission reports an
  unresolved outcome, and the client retries the same commit on the same
  handle, instead of a definite-looking error that hides a landed write.
- A stale leader cannot write. Proposals carry an expected term, quorum checks
  are on by default, and a leader that lost quorum learns it.
- A published commit index never runs ahead of durable storage. The checkpoint
  floor advances only when every entry below it is on disk.
- A wedge is loud. Backfill refusals, non-converging rescues, and stalled
  durable writes are reported by the node, and the harness fails a run with
  zero progress under a fault.
- Memory has budgets. Retention is bounded by count and bytes, batch streams
  use constant memory, and storage budgets derive from the real heap limit.
- The disk can pause and the cluster survives, with no unknown outcomes for
  a single paused node.
- Every crash leaves evidence. Crash dumps live outside the data volume, node
  logs are captured before teardown, and the harness records which build,
  which durability settings, and which host produced every number.

The scenarios from the first post still run, and their recovery numbers are
the ones we compare from build to build.

| Scenario | Fault | Peak error rate | Recovery after heal |
|---|---|---|---|
| Kill a node during transfers | SIGKILL for 20 seconds | 100% | 5.5 s |
| Kill a whole zone | Two nodes of six, 30 seconds | 100% | 4.1 s |
| Full disk | Data volume filled to the last byte, 15 seconds | 25% | 1.6 s |

The full disk case is the one we like most. The node refused writes with a
clean error, kept serving reads, and accepted writes again with no restart as
soon as space came back.

Kommander also gained an in-process simulation with seeded faults, trace
shrinking, and invariant checkers, and Kahuna can now start a multi-node
cluster in one process with link blocks and restarts. Caraxes found the
failures at the level of a real cluster in Docker. These simulators reproduce
them in milliseconds inside a unit test, so a fix comes with a test that fails
on the old code.

## Three lessons

Invariants beat logs. Every serious correctness bug in this post was found by a
number that did not add up, and only then explained by a log. Engine-side
analysis of the logs alone ran out of evidence more than once. A per-row ledger
of every transfer, joined against the seeded baseline, is what turned a deficit
we could count into a deficit we could attribute.

The measurement is part of the system under test. A sleeping laptop, a busy
host, a write cache, and a saturated load generator all produced findings that
looked exactly like database defects. Each false alarm cost us time once. Each
one now costs a check that runs on every run.

A fix reveals the next bug. The chain from run R to run Z is eight fixes deep,
and every fix uncovered the next failure by removing the one in front of it.
This is not a sign that the database was worse than we thought. It is what
progress looks like when the test is stronger than the code.

The dragon is not done. There are scenarios in the notebooks with questions
still open, and a few new faults on the list. But a server that dies on a busy
afternoon now dies in a way we studied, on a build that passed the same
afternoon many times before.
