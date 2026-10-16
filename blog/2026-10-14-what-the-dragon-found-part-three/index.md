---
slug: what-the-dragon-found-part-three
title: What the dragon found, part three
date: 2026-10-14
authors: [andresgutierrez]
tags: [camusdb, reliability, chaos-testing, distributed-systems]
image: /img/caraxes3.png
---

# What the dragon found, part three

![A dragon breaking one artic city of glowing pyramids](/img/caraxes3.png)

A ten-minute test finds the bugs that happen in ten minutes.

A distributed database is hard to build, and the code is the smaller half of
the work. The larger half is verification. You check the results again and
again, you dig into the system until you know what it really does, and you push
it past the point where it should break. A guarantee on a documentation page is
worth exactly what the evidence behind it can show, and that evidence has to
cover speed and correctness at the same time.

[Part one](/blog/a-dragon-to-attack-our-own-database) introduced Caraxes, the
harness that attacks a real CamusDB cluster in Docker. [Part two](/blog/what-the-dragon-found)
told what it found in its first month: a dropped transfer leg, a cluster that
said healthy while it was dead, scans that lost rows under load. 

This part covers the three weeks after that. Most of it is about one test. It
runs for two hours, it injects a fault every eight minutes, and it took eight
attempts before it passed. Every failed attempt found something, and the runs
after the first pass kept finding things.

<!-- truncate -->

## Three weeks, in numbers

CamusDB still runs on two lower layers. Kahuna is the replicated key-value
store under the SQL engine. Kommander is the Raft implementation under Kahuna.
A chaos run attacks all three at once.

| Repository | Commits since 2026-09-21 | Versions consumed by CamusDB |
|---|---|---|
| CamusDB | 116 | |
| Kahuna | 100 | from 1.9.2 to 1.11.10 |
| Kommander | 68 | from 1.7.6 to 1.10.9 |
| Caraxes | 25 | |
| .NET client | 26 | |

Caraxes now has 332 scenario files, up from about 200. More than thirty of
the runs in this period were two hours long. That is more than sixty hours of
a cluster under attack, on one host, with the same seed.

## Why two hours

Every ten-minute scenario in part two passed on the stack we shipped at the
time. In those runs, node memory climbed to between 3.3 and 3.9 GB of a 4 GiB
limit within ten minutes and then stayed there. Whether that plateau holds for
two hours, or creeps, is a question no ten-minute run can answer. Snapshot
installs, log compaction and retention floors are also things that only start
to matter when the log is tens of millions of entries long.

So we wrote the soak. Three nodes with 4 GiB each, one partition replicated
three times, the bank workload from part two with 128 workers over 2,000 rows,
and a two-hour measured window. Fourteen faults land one every eight minutes.
Six of them kill the current leader and restart it 30 seconds later. Four
freeze a process for 30 seconds. Four pause one node's disk at 4 KiB per
second for 30 seconds.

```yml
nemesis:
  seed: 1
  events:
    - { at: 8m,   fault: kill,      target: leader, duration: 30s }
    - { at: 16m,  fault: slow-disk, target: camus1, duration: 30s }
    - { at: 24m,  fault: kill,      target: leader, duration: 30s }
    - { at: 32m,  fault: pause,     target: camus2, duration: 30s }
    # ... fourteen windows in all ...
    - { at: 104m, fault: pause,     target: leader, duration: 30s }
    - { at: 112m, fault: kill,      target: leader, duration: 30s }
```

A soak passes when all of these hold:

- The window completes, and no node dies on its own.
- The sum of all balances is exactly 2,993,071,553 at the end, the same
  number as in part two.
- Every indeterminate write is resolved. An indeterminate write is a commit
  whose answer the client never received, because the connection was cut
  while the commit travelled. The ledger resolves them afterwards: the sum of
  all row versions must land inside a band whose floor is the committed writes
  and whose ceiling adds the indeterminate ones.
- The per-row ledger, joined against the seeded data, names no lost, missing,
  duplicated or half-applied row.
- No two replicas applied the same log entry with different verdicts.
- Every fault window recovers, and the cluster makes progress inside every
  window.

Throughput gates are not what the soak is for. The host's NVMe changes regime
after 30 to 35 GB of writes, as part two explained, and a two-hour run always
crosses that line. The harness marks a throughput finding inadmissible when
the device moved inside the window, and most windows after minute 30 are. The
verdict rests on the correctness checks, which do not depend on the device.

Since late September every soak runs as a pair. One arm has the new settle
path on, where a transaction's resolved values are installed on every replica
when the transaction settles. The other arm has it off, so a replica can keep
a reference to the intent and fill in the value later. We call those
by-reference records. The settle path writes 4.0 Raft entries per commit
instead of 6.4, and it is the default today. Both arms must pass.

## Run one: two nodes die, and the first three diagnoses are wrong

The first soak completed its window: 17.9 million operations in two hours. It
also finished with one node alive, and the reconciliation could not read the
sum.

The first node died at minute 51. It was the leader, it was killed on
schedule, it restarted, and it ran out of memory while it deserialized the
backfill from the new leader. The runtime terminated it on purpose, with a
message that said the orchestrator would restart it. Nothing did, because the
harness only restarts a node as part of a kill fault, and that fault had
already healed. The second node died after the window closed, while the
reconciliation tried to read the sum from a two-node cluster. It was at 99.6
percent of its memory limit, with no trace and no dump. The kernel killed it.

The memory was real. What it was took four runs to find.

| Suspect | Test | Result |
|---|---|---|
| Transaction record retention. The heap valve logged 185,064 resident records. | Read the node metrics | The retention stores peaked at 117 to 131 MB per node, about 3 percent of the container, and held flat. Wrong. |
| RocksDB block cache and memtables | fs2: one shared budget of 768 MiB for both storage engines | Native memory unchanged at about 3 GB per node. A node died at minute 36, earlier than before. Wrong. |
| Index and filter blocks of the Raft log, kept outside every cache | Measured at 8.9 percent of live SST bytes in a probe. Fixed in Kommander, with new gauges. fs3. | Table readers read 0 MB. Native memory still 3,069 MB. The live SST was 262 MB, not the 34 GB the ratio implied. Wrong. |
| glibc malloc arenas | Read the process maps on a live node | 116 anonymous mappings of 60 to 70 MB each, 1,227 MB resident. The process ran 133 threads on 16 cores, right at the allocator's ceiling of eight arenas per core. |

glibc is the C library under .NET on Linux. Its allocator keeps a memory
arena per thread, and freed memory stays in the arena. It does not return to
the kernel. No subsystem gauge could find that memory, because it was not any
subsystem's live data.

The fourth soak ran with one environment variable added, `MALLOC_ARENA_MAX=2`.
The 60 MB mappings fell from 116 to 7.

| Node | fs3 peak | fs4 peak |
|---|---|---|
| camus1 | 4,095 MiB, 100% | 3,463 MiB, 85% |
| camus2 | 4,000 MiB, 98% | 2,947 MiB, 72% |
| camus3 | 3,957 MiB, 97% | 3,268 MiB, 80% |

No node died. Memory came down between faults, with no creep. Three soaks
died of this, and the remedy was a deployment variable, not a change in either
codebase. The fix for the Raft log's index blocks stays anyway. It bounded an
allocation that had no bound, and its gauges are what made the measurement
possible.

One native memory table from the first run says why the first diagnosis was
wrong. On the node that died last, the working set grew from 382 MB to 4,057
MB over two hours, while the managed heap shrank from 767 MB to 441 MB. Read
the difference between those two numbers before you blame anything the garbage
collector manages.

## The wedge under the memory wall

With the deaths out of the way, the fourth soak showed a worse defect.

An hour into the window, with no fault active, client throughput went from
2,160 operations per second to zero in one second. It stayed at zero for 59 minutes.
All three nodes were alive and answered every health probe.

All three voters shared a hole in their Raft log. The log was contiguous
through entry 48,266,403, and entries were present up to 48,266,486. Neither
recovery path could get past the hole:

- One node won a term and refused to lead on the hole guard. It did that 598
  times.
- Another node won a term and its promotion barrier timed out. It reverted 297
  times.
- The third node never led. Terms climbed to 614. One node logged that the
  leader could not be resolved 167,244 times.

The trigger was a transient disk stall on one follower that cleared in
seconds. The wedge outlived it by an hour.

This was not a new defect. The Kommander Jepsen suite found it in August, and
its findings file recorded 90 nightly runs since then without a reproduction.
This was its first reproduction outside Jepsen, on a far newer build, from
ordinary device jitter rather than an injected fault. The soak also carried two
details the Jepsen runs did not have. The refusal counter reset on every
promotion attempt, so the truncation escape hatch could never fire. And 296 of
the 297 barrier timeouts named no cause, while the real obstacle was the
shared hole. Kommander 1.7.7 fixed it, and the next soak had no wedge.

## A replica that came back with less than it left with

The fifth soak ran on the published Kommander 1.7.7. No wedge, no node death,
peak memory 55 percent. And the cluster stopped before minute 50 anyway, with
all three nodes alive.

| Minutes | 0-10 | 10-20 | 20-30 | 30-40 | 40-50 | 50-60 | 60-70 | 70-90 | 90-120 |
|---|---|---|---|---|---|---|---|---|---|
| Ops/s | 5,086 | 4,310 | 2,225 | 4,480 | 1,755 | 59 | 43 | 0 | 31-85 |

The leader was killed at minute 24 and rejoined. The new leader escalated to a
snapshot install, and chunk 22 of 23 was rejected after a 16-second install.
Within 41 seconds the node's checkpoint jumped ahead of the gap. The retry
at that index was answered "already covered, nothing was imported".

From then on, that node held committed values for fewer rows than its peers at
the same applied log position: 1,828 rows, then 1,777, then 1,756 of 2,000.
Kahuna's fingerprint probe caught the difference three times at error level.
The probe only logged, so the node was elected leader twice with the
incomplete state. It also kept 172 prepared intents that the other two
replicas settled long before. Under retention pressure those intents lost their
records, and recovery must hold a record-less intent forever. 86 transactions'
keys went read-only, workers piled onto them, and every full-table scan failed
its page budget. The reconciliation could not read the table.

The sixth soak, on Kahuna 1.9.7 and Kommander 1.7.9, showed the same defect on
a different node, after a snapshot install that completed cleanly with no
chunk rejected. So the loss survives a clean install. The seventh soak ran a
local Kommander fix for the skip. Same divergence, after two full installs,
and this time no kill was involved: the leader stepped down on its own during
a disk stall, with a hole in its own log.

Three Kommander changes closed it:

1. A skip must deliver the committed entries below the index, or it must
   become an install.
2. The installer skips the import when the application already applied past
   the index. An import there rewound state below the apply cursor, and those
   entries were never re-delivered.
3. The leader does not escalate to a snapshot for a peer that already reports
   committed through the checkpoint.

The eighth soak passed. It was the first complete, clean two-hour window:
conservation exact, 2,912 indeterminate writes all resolved, zero divergence,
all fourteen windows recovered in at most 0.8 seconds. The ninth soak repeated
it on published packages, Kahuna 1.9.9 and Kommander 1.8.0. That run matters
more than the eighth, because it hit the exact shapes that wedged runs five to
seven three times. One node went through a rejected chunk, a forced install
and a 24-chunk re-install, and was then elected leader three times with no
divergence and no held intents.

Kahuna 1.9.11 then added containment. A replica whose apply projection
diverges from its peers is gated: it gives up leadership, withholds its
candidacy, and is re-seeded. Live intents are part of the fingerprint now, and
a record-less hold is cross-checked with peers. The tenth soak passed with the
containment in the build and silent, which is what it should be with nothing
to contain.

| Run | Stack | Result | What it found |
|---|---|---|---|
| fs1 | Kahuna 1.9.3, Kommander 1.7.6 | Two nodes dead, no verdict | Native memory grew while the managed heap shrank |
| fs2 | Same, with a 768 MiB storage budget | One node dead at minute 36 | Not the block cache |
| fs3 | Raft log index blocks charged to the cache | One node dead at minute 85, sum exact | Not the table readers. Allocator arenas. |
| fs4 | `MALLOC_ARENA_MAX=2` | No deaths. Leaderless for 59 minutes. | Three voters shared one hole in the log |
| fs5 | Kahuna 1.9.4, Kommander 1.7.7 | Read-only wedge by minute 50 | A replica rejoined with about 10 percent of its rows behind, and led twice |
| fs6 | Kahuna 1.9.7, Kommander 1.7.9 | Same | The loss survives a clean install |
| fs7 | Local Kommander skip fix | Same, with no kill involved | An import below the apply cursor rewound state |
| fs8 | Three Kommander changes, local | Pass | The first clean two hours |
| fs9 | Kahuna 1.9.9, Kommander 1.8.0 | Pass | Repair paths exercised three times, no divergence |
| fs10 | Kahuna 1.9.11, Kommander 1.8.2 | Pass | Containment in the build, silent |

## The rest of the chain

We ran the soak again on every new stack after it passed, and it found more.
None of them was a lost write on a published package. Several of them
were one step away from it.

**A candidate that discarded valid votes.** The eleventh soak paused the
leader's process for 30 seconds, and the cluster completed zero operations
for all 30. One survivor campaigned in terms 72 through 78. The other granted
its vote every time. The candidate discarded every grant, because it re-checked
the voter's log by index only, while the voter judged by term and index. Each
grant also put the voter into its post-vote cooldown, so it never campaigned
itself. The partition had no leader until the paused node woke up. The same
discarded-vote line appeared 4 times in fs9 and zero times in fs8 and fs10, so
the condition depends on timing and a soak alone cannot prove it gone.
Kommander now judges a grant by the voter's own rule, and a deterministic test
holds the shape.

**A veto that arrived late.** One error line grew with every build: 2 or 3 per
node in fs3, 21 in fs8, 47 in fs9, 78 distinct transactions in fs10. The ledger
found zero lost writes every time, so it sat on the watch list. The cause was a
prepare re-driven to a successor after a step-down. Its first copy had already
settled, and the re-driven copy installed a phantom intent that the fence then
refused against the transaction's own commit. Kahuna now remembers settled
identities from the log, and the count went from 78 to zero.

**The faster commit path broke the retention floor.** A Kommander change that
fans a proposal out before the leader's local write took one fsync out of every
round. On this host's device that is 5,292 operations per second against
2,243 on the same body. It also turned the log retention budget of one million
entries from 80 seconds of log into 37. A leader killed for 30 seconds came
back 1.7 million entries behind, below the compaction floor, and needed a
whole-partition transfer. The import ran out of memory. Retention is sized in
time as well as entries since Kommander 1.9.2, and that soak passed at 4,235
operations per second, with 6,971 in its first ten minutes before the device
changed regime.

**An install loop with a 15-second deadline.** On Kahuna 1.10.5 a restarted
leader entered a snapshot install loop. The last chunk's install took longer
than the 15-second acknowledgement deadline on a busy device. The retry
started a new export at a new index instead of a resume. The follower rejected
the retry while its own install was in progress. Six attempts in four minutes,
and the node's memory went from 1.15 GB to 4.08 GB in three and a half
minutes, then it crashed. The same loop ran in the previous soak and finished
on the second to fourth attempt, with memory at 96.6 percent. The margin was
between 100 and 300 MB. The settle-path arm of the same pair landed five of six
installs on the first attempt in 8 to 15 seconds, because its snapshot carries
fewer intents. A smaller snapshot hid the race, and did not fix it.

**Lost writes, twice, on local packs.** The packs that fixed the loop lost
committed writes. In the first run the sum came back short by 4. Two rows were
58 and 180 version increments behind, about 100 seconds of each row's writes.
The restarted node received a checkpoint over its replication gap. The
leader escalated to a snapshot at exactly that index, the receiver answered
"already covered, nothing was imported", and the leader moved its cursors past
the gap. The node led one minute later. The entries between its frontier and
the boundary never reached its application. In the second run the sum was
short by 2, from a different cause. On restart, the node replayed the window
below its certified position as history, and 82,536 by-reference records on
all 2,000 keys found no intent to resolve against. The values were missing on
that one node. The control arm, with the settle path on, on the same packs and
the same schedule, passed. One variable, one answer.

**A gate that fired nine minutes late.** With the replay fixed, the next soak
passed, and one of its six restarts left 10,773 unresolved records on 13 keys.
Kahuna's new recovery gate caught it nine minutes later, after the node had
won three terms. The node refused to serve, handed leadership to the fuller
replica, re-seeded in 19.6 seconds and ungated. No loss. Nine minutes is too
long, so the gate now fires at detection, and the next pair passed on both
arms with the unresolved counter at zero on six restarts.

**A paused follower re-seeded three times.** The soak on the published Kahuna
1.11.5 and Kommander 1.10.4 passed on both arms, and both arms showed the same
thing. A 30-second pause at minute 104, with 60 to 70 million entries in the
log, was followed by three consecutive whole-partition re-seeds: 32, 38 and 31
chunks in 60, 41 and 8 seconds, with the follower at 92 percent of its memory
during the first. The first diagnosis said the follower fell below the
compaction floor. The code said otherwise. The retention window covered it by
an order of magnitude. The backfill's no-progress probe counted four shipments
fruitless because the follower's reported commit frontier did not move, while
its presence frontier advanced at 1,100 entries per second against a stream of
6,700. Each install left the follower a million entries behind, and the probe
fired again. With the probe reading every frontier, the same pause was repaired
by backfill: 92,000 entries behind to 13 in 28 seconds. Kommander 1.10.7 ships
it, and in the latest soak the minute-104 pause hit the leader, which caught up
from 188,000 entries behind to 3,000 in three minutes with no escalation.

| Run | Stack | Result | What it found |
|---|---|---|---|
| fs11 | Kahuna veto fix, local | Fail: 30 s with zero ops during a leader pause | A candidate discarded valid votes |
| fs12 | Kommander vote fix, local | Pass | |
| fs13 | Kahuna 1.10.1, Kommander 1.9.0 | Correct. Harness fail. | A health probe issued 0.28 s before the kill |
| r3a6 | Kommander round pack, local | Fail: import ran out of memory | 2.4x the throughput made a 30 s kill fall below the retention floor |
| rl4b | Kahuna 1.10.4, Kommander 1.9.2 | Pass, both arms | The version band had the wrong unit |
| rl5 | Kahuna 1.10.5, Kommander 1.9.3 | Fail: node dead in an install loop | A 15 s chunk deadline the last chunk could not meet |
| sn1 | Local snapshot packs | Fail: sum short by 4 | A skipped install over a gap, then the node led |
| sn2 | Local, skip fixed | Fail: sum short by 2. Control arm passed. | Restart replay left 82,536 values unresolved |
| sn3 | Local, replay fixed | Pass | The recovery gate caught 10,773 unresolved records, nine minutes late |
| sn4 | Local, gate at detection | Pass, both arms | |
| rl6 | Kahuna 1.11.5, Kommander 1.10.4 | Pass, both arms | A paused follower re-seeded three times in four minutes |
| ps1 | Local probe fix | Pass, both arms | The same pause repaired by backfill in 28 s |
| rl7 | Kahuna 1.11.7, Kommander 1.10.7 | One arm failed a harness rule | A client check on one 1-second sample |
| rl7b | Same | Pass | Two green verdicts on one published stack |

## When the dragon was wrong, again

Part two had a section with this name. Here is the new list. Every item cost
us a wrong reading once, and every item is a check now.

- **A node that died on its own, twice, did not.** In one run the health probe
  was issued 0.28 seconds before the scheduled SIGKILL, and the harness graded
  the missed probe as a death with no fault active. In another, `docker kill`
  took 6.8 seconds to return on a device at 98 percent busy, and the harness
  opened the fault window when the command returned, seven seconds after the
  node died. Fault windows now open when the fault is issued, and a probe in
  flight within its own timeout before a window is excused. Both runs re-grade
  as passes on recorded data.
- **801 version increments above the band were the band's unit.** One run's
  version sum exceeded the ceiling that the indeterminate writes allowed. The
  ceiling counted one row per indeterminate transaction. A transfer increments
  two rows. With the right unit the sum was inside the band and the excess
  above the floor was even, so every transfer applied whole. We replayed the
  corrected band over 410 archived runs. Thirty runs that had read "above the
  maximum" were inside. One run from August 28, with zero indeterminate writes
  and a conserved balance, grew the version sum by 8: four transfers applied
  that the client never committed. The check was waived under faults
  at the time, and the waiver hid it. The band is graded in bank mode now, and
  an odd excess fails as a half-applied transfer.
- **An Elle history with holes in it.** On Docker Desktop for macOS the
  workload wrote its history through a bind mount, and every time a fault
  started a helper container, a page-aligned run of zero bytes appeared in the
  host copy. Elle could not parse the history, so one scenario never had a
  verdict. The measured run now writes inside its container and the harness
  copies the output out.
- **A node that left the cluster, except it did not.** The node-removal fault
  posted its leave request from the host. The request arrived through Docker's
  port proxy from the bridge gateway, and the node refused it, because cluster
  administration over the network requires authentication. The vacuity check
  described below caught it: a run that promised replica moves had none. The
  request now runs from inside the target's own network namespace.
- **A clock library that broke sleep.** The first clock-skew shim was
  libfaketime. Under .NET 10 it made timed waits return at once, so the test
  subject was a database with no timers. The shim is now a small C library
  that moves the wall clock and leaves monotonic time alone.
- **A client check on one sample.** A soak with every database signal clean
  failed on the load generator's thread-pool queue, which peaked at 103 against
  a bar of 100 for one second. The rule now judges the queue on dwell time and
  the 95th percentile. In the same run a fault aimed at the leader was skipped,
  because one placement sweep taken mid-election saw no leader. The resolver
  now sweeps every half second for up to ten seconds.
- **An idle disk probe that predicted nothing.** We waited up to three hours
  for the host's idle fsync latency to drop below a threshold before a soak.
  It read 2.4 to 3.1 ms the whole time on a rebooted idle host, and the run
  then opened at 0.05 ms anyway. The in-run regime rules are the signal. The
  gate is gone.

## A test that did nothing must not pass

A fault that never fires leaves a green run behind. The node-removal item above
was found by a rule we added for exactly that reason. A scenario can now
declare that it requires a range split, or a replica move, and the harness
fails the run as vacuous when the placement samples show neither happened.

That rule guards four new scenarios. Two run key-range sharding, where a table
is split into ranges by key and the ranges move between nodes as they grow.
The seeded data starts a cascade of splits that outlasts the warm-up, and a
partition and a kill land while ranges still split. Two run replica
placement on five nodes with three replicas each: a kill at 25 seconds, then a
decommission at 80 seconds that drains every replica the node hosts onto the
others, so the cluster finishes the run with four nodes. Each pair has an Elle
arm, which looks for isolation anomalies in a list-append history, and a bank
arm, where the conserved sum and the per-row ledger see a row that a split copy
or a seeded replica lost.

Both features are opt-in. The consistency report listed them as the two
weakest verified parts of the system. They now have CamusDB-level scenarios
that run every night.

## Clocks, and the nightly

Part one promised clocks that disagree between nodes. Caraxes can now move one
node's wall clock forward or back, by up to twelve hours, and move it back on
heal. Only the wall clock moves, so the fault reaches the hybrid logical clock
and every lease built on it, and not Raft, whose elections use monotonic time.

Four scenarios target what a given skew can reach: 2 seconds on three nodes as
a control, a jump past the 5-second snapshot clock fence, a jump past the
15-second intent and prepare lease, and 3 minutes forward then 1 minute back,
past the gossip and schema leases. All four passed with a serializable Elle
history. One change came out of them: Kahuna now refuses a snapshot read whose
timestamp leads the node's clock, and no longer serves it unfenced.

Caraxes also has CI now. Tests run on every push. Every night at 05:00 UTC a
workflow builds CamusDB from main and runs the ten Elle list-append scenarios,
one job per scenario. The nightly runs in a correctness-only mode: the
recovery-time and throughput rules are reported as not graded, because a
hosted runner's speed says nothing about the change. Elle, the ledger, the
divergent-apply check, node health and the total-outage rule still grade the
run.

## Notes from the performance side

The harness is also how we measure speed, and three of its findings in this
period were about the measurement or the client, not the server.

- **TLS was never the cost.** A pair of ten-minute runs on one image, with the
  client path in TLS and in cleartext, read 9,082 and 9,240 operations per
  second at an identical 0.90 CPU-milliseconds per operation on the leader.
  Cleartext is now the control shape. Raft keeps its certificate.
- **A pipelined client that landed on the wrong node.** The new client sends a
  transfer as two frames instead of six exchanges. Its first measurement was
  5,029 operations per second against 9,236 for the sequential client. A
  pipelined statement carried no routing negotiation, so two thirds of first
  frames began on a follower, and follower CPU per operation went up four
  times. With routing fixed in client 0.15.1 the pipelined arm reads 5,737.
  The second frame, two updates and a commit, costs 27.9 ms against 13.6 ms
  for the same statements sent one by one. That question is open.
- **A thread pool with a floor of 1,024.** Scheduler statistics put 6.8 of the
  leader's 8.3 cores in 233 to 284 pool workers, at 29 to 33 time slices per
  client operation, on a host with 16 hardware threads. The server's default
  minimum of 1,024 threads is what lets the pool grow that far. The pair at a
  floor of 64 and 128 is the next run.

## What the database looks like today

- A node that runs out of memory was a deployment problem. Every Caraxes node
  runs with `MALLOC_ARENA_MAX=2`, the Raft log's index blocks are charged to
  the shared storage budget, and node memory peaks between 80 and 93 percent
  of 4 GiB over two hours and comes down between faults.
- A partition whose voters share a hole in the log elects a leader.
- A replica that diverges is contained. It gives up leadership, withholds its
  candidacy, and is re-seeded. A restart that leaves unresolved by-reference
  records gates at detection, before the node can win a term.
- A snapshot install cannot skip over a gap, an import cannot rewind below the
  apply cursor, and a leader does not re-seed a peer that catches up on its
  own.
- A vote is judged by term and index on both sides.
- Log retention is sized in time as well as entries, so a faster commit path
  does not shrink the window a 30-second restart needs.
- A re-driven prepare whose first copy settled is rejected, instead of
  installed as a phantom.

The last pair on a published stack, Kahuna 1.11.7 and Kommander 1.10.7, is
double green.

| Check | Settle path off | Settle path on |
|---|---|---|
| Conservation | exact | exact |
| Lost rows, divergent applies, unresolved records | 0, 0, 0 | 0, 0, 0 |
| Faults recovered | 14 of 14 | 13 of 13 |
| Longest recovery | 0.9 s | 0.7 s |
| Snapshot installs | 0 | 0 |
| Pauses repaired by backfill | 4 of 4 | 3 of 3 |
| Memory peak | 90% | 90% |

The settle-path arm injected thirteen faults, not fourteen. One pause aimed at
the leader was skipped by the resolver bug listed above, which is fixed since.

CamusDB today pins a Kahuna three releases past that pair. The pin is ahead of
its evidence, as it was in part two, and the next soak closes that gap.

## Three lessons

Some bugs need two hours. Every ten-minute run in part two plateaued at 3.3 to
3.9 GB and passed. In hindsight those plateaus were the memory wall, a few
hundred megabytes away. A plateau is not evidence of a bound. Only a long run
with the same budget is.

Measure the quantity. Do not infer it from a ratio. The table-reader ratio of
8.9 percent was right, and the SST volume it was multiplied against was never
measured. The inference said 34 GB. The gauge said 262 MB. Two subsystem
hypotheses failed in a row for the same reason, and the one that held came
from reading the process maps.

Change one thing. The sum came back short by 2 on a pack that changed two
things. The control arm with the settle path on, same pack, same schedule,
passed, and that isolated the loss to the by-reference replay in one run.
Three soaks died of memory, and the fix was one environment variable with no
code change. A result you cannot attribute to one variable is a story, not a
finding.

Part two's third lesson held as well. The chain from the first soak to the
latest is memory, then a wedge, then a divergence, then a livelock, then an
install loop, then two lost writes, then a re-seed storm. Every fix uncovered
the next failure when it removed the one in front of it.

This is what most of the engineering on a distributed database looks like. Not
new features, but a long check that the ones we promised still hold, under
faults, under load, for hours, on a real device. A database earns its
guarantees twice, once in the code and once in the evidence, and the second
time never ends. The soak is that second time, for performance and for
correctness in the same run.

The dragon is not done. The next runs are the kill matrix under load, a second
kill window measured on a device that holds its regime, and the two open
questions from the performance side. But a server that dies on a busy
afternoon now dies on a build that survived fourteen of those afternoons in a
row, twice, with the sum exact at the end.
