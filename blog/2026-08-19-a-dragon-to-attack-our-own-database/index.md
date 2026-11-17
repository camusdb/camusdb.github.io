---
slug: a-dragon-to-attack-our-own-database
title: "Caraxes: how we test CamusDB against real failures"
date: 2026-08-19
authors: [andresgutierrez]
tags: [camusdb, reliability, chaos-testing, distributed-systems]
image: ./caraxes.png
---

# Caraxes: how we test CamusDB against real failures

![A dragon burning a city of glowing pyramids at night](./caraxes.png)

This post shows how we test CamusDB against real failures: killed servers,
broken networks, and full disks. You will see what the test tool checks, how
a test is written, and which failures it covers today. Use it to judge how
much evidence stands behind the CamusDB cluster guarantees.

When every server is healthy, almost any database looks correct. The hard
cases are a server that dies in the middle of a commit, a network that loses
packets, and a disk that fills up during a write. Those cases are hard to
create by hand, so we built a tool that creates them on demand. We named it
Caraxes, after a dragon, because its job is to attack our own cluster.

<!-- truncate -->

## A cluster can fail in part

A database on one server has a simple failure story. The process runs or it
does not. When it stops, recovery means one thing: read the write-ahead log
(the file that records each change before it is applied) and continue.

A cluster is a group of servers, called nodes, that hold copies of the same
data. In a cluster, one node can break while the others keep working, and the
others often cannot tell what kind of break they see.

Imagine three nodes, and one of them goes quiet. From outside, these cases
look the same:

- The node crashed.
- The node is alive but frozen for a few seconds.
- The node is fine, but the network between it and the others drops packets.

Each case needs a different reaction. A crashed node must be replaced. A
frozen node wakes up by itself. A node behind a broken network can still
think it is the leader (the node that accepts writes) and can still accept
work.

The cluster has to choose a reaction quickly, with missing information.

## Silent wrong answers are the dangerous failure

A wrong answer does more harm than an error, because nobody looks for a
problem they were never told about. During a failure, these are the risks:

- A write is confirmed, then lost when a new leader takes over.
- A deleted row comes back after an old copy of the data is promoted.
- A transfer takes money from one account and never adds it to the other.

A normal test suite runs on one healthy machine, with plenty of disk and a
perfect network. Those tests are still worth having, but they cannot find any
of these problems.

## Five properties that Caraxes measures

Reliability is several properties, and each one needs its own proof.

- **Durability.** If we confirm your commit, it survives, even if the node
  that confirmed it dies one second later.
- **Consistency.** You never see half of a transaction, no matter which node
  answers your query.
- **Availability.** The cluster keeps serving while part of it is down.
- **Recovery.** After the problem is fixed, the cluster goes back to normal
  by itself, and fast.
- **Predictability.** The same failure behaves the same way every time.

A database can pass four of these and fail the fifth. A cluster that stays
correct but needs two minutes to answer queries after it loses one node is
still painful to run. Caraxes measures all five in a single run.

## A test is one YAML file

The file says which cluster to build, what load to run, what to break, and
what result we expect.

```yml
name: kill-follower
cluster:
  name: chaos-kill
  nodes: 3
  partitions: 3
  replication_factor: 3
workload:
  database: caraxes
  rows: 20000
  mode: open
  target_ops: 300
  workers: 32
  duration: 60s
  warmup: 15s
nemesis:
  seed: 7
  events:
    - { at: 20s, fault: kill, target: random, duration: 20s }
checks:
  max_recovery_seconds: 45
```

One command does the rest. It builds the CamusDB image from the code on your
disk, starts a real cluster in Docker, waits until every node is ready, loads
a dataset, and sends real SQL traffic through the normal client. Twenty
seconds in, it kills a node. Twenty seconds later, it brings the node back.

The failures are real:

- A kill is a SIGKILL signal, which stops the process at once.
- A network partition is a firewall rule that drops packets between nodes.
- A slow link is added latency on the network interface.
- A full disk is a file that grows until the disk has no space left.

We avoid simulations here, because a simulation only tests the behavior we
already imagined.

The run ends with a pass or a fail, so a machine can read the result.

## The balance check: total money stays the same

One of our test workloads moves money between random accounts. Every transfer
takes an amount from one row and adds it to another, inside one transaction.

Money only moves, so the total of all balances must be exactly the same after
the test as before it. If the total changed, a transaction was not atomic,
and the test fails. We apply this check in every test, including the tests
that kill a node.

These transfers also make transactions conflict on the same rows. Our other
workload avoids conflicts so it can measure speed and failover cleanly, but a
test without conflicts cannot catch a broken transaction.

## Errors are judged by what the test injected

If we injected no failure, an internal error is a real bug and the test
fails.

If we just killed a node, connections close while requests are still
travelling, so a few client-side errors are normal. We count them and print
them, but they alone do not fail a test that stayed correct and recovered in
time. This keeps the test from failing on every run, which would teach us to
ignore it.

## Recovery time for every fault

Caraxes records every break and every repair with exact timestamps. The
workload records each second: how many operations succeeded, how many failed,
and how slow they were.

Afterwards, we put both records on the same clock. That answers three
questions for every failure:

- How bad did it get?
- Did the cluster keep doing useful work, or did it stop completely?
- How many seconds after the repair did things go back to normal?

```text
# Fault analysis

- Normal seconds: error rate 0.00 %, write p99 1,382.0 ms
- During the failure: error rate 40.45 %, write p99 392.9 ms
- Longest recovery: 5.5 s; everything recovered: yes

| fault | healed | window (s) | peak error | failed | progressed | recovery (s) |
|---|---|---|---|---|---|---|
| kill/camus2 | yes | 20.3 | 100 % | 4,074 | yes | 5.5 |
```

In this run we killed a node and errors jumped, but the cluster never stopped
completely. 5.5 seconds after the node came back, everything was normal
again. We compare that last number from one build to the next. (p99 is the
latency that 99% of operations stayed under.)

## A seed makes every run repeatable

Every random choice comes from a seed number. The same seed kills the same
node at the same second, in the same order.

When a run fails, we run it again and watch it fail in the same way. After we
fix the cause, we run it once more and watch it pass.

## Failures covered today

Each test asks one question.

- A run with no failures at all, so we know the cluster and the traffic work
  before we break anything.
- A node killed in the middle of the run, then restarted.
- A node cut off from all the others, and separately a node slowed down, so
  nothing dies but the network stops cooperating.
- Money transfers running while a node is killed, with the total checked
  afterwards.
- Six nodes in three zones, with one entire zone killed, so every partition
  loses a copy at the same moment and has to survive with two.
- A node with a full disk, to confirm that it refuses writes without a crash,
  and accepts them again once there is space.
- A long run with random failures arriving every ten to eighteen seconds.
- A test for the leader balancer alone: kill the busiest node, restart it,
  and check that leadership comes back to it.

## A test grid catches regressions

Recovery time gets worse in small steps. Someone adds a cache, changes a
timeout, or moves two lines in the commit path, and a fifteen second recovery
becomes fifty. Each change looks fine in review, and all the unit tests still
pass, because none of them ever unplugged a server.

So we run a whole grid of tests at once. One file expands into many runs
across locking modes, cluster sizes, and failure types. It produces a table
with every result and every recovery time side by side. When a change costs
us reliability, it shows up as a row that used to pass and now fails.

The result is a pass or fail code that our CI (the automated build and test
system) can read.

## Planned tests

- Deeper correctness checking, to catch strange orderings that a simple total
  cannot detect.
- Disks that are slow or that return damaged data.
- Clocks that disagree between nodes, because time is one of the things a
  cluster trusts the most.
- Nodes joining and leaving while traffic is running.
- Schema changes during failures, since a migration is the worst possible
  moment to lose a node.
- Distributed queries during failures, so a query split across the cluster
  still returns the same rows when one part disappears.
- Backups and restores while the cluster is under attack.
- Bigger clusters and much longer runs, because some bugs only appear after
  hours.

## Chaos testing covers only the injected failures

For each failure that Caraxes injects, a passing run shows that the cluster
kept the data correct and recovered in a time we measured and accept. Chaos
testing cannot prove that the database has no other bugs.
