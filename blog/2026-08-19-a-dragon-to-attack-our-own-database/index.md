---
slug: a-dragon-to-attack-our-own-database
title: We built a dragon to attack our own database
date: 2026-08-19
authors: [andresgutierrez]
tags: [camusdb, reliability, chaos-testing, distributed-systems]
image: ./caraxes.png
---

# We built a dragon to attack our own database

![A dragon burning a city of glowing pyramids at night](./caraxes.png)

A database earns your trust on its worst day, not on its best one.

When everything is healthy, almost any database looks correct. You insert rows,
you read them back, and the numbers add up. The real question is what happens
when a server dies in the middle of a commit, when the network starts losing
packets, or when a disk fills up while a transaction is still writing.

Those moments are hard to create by hand. They are also the moments a
distributed database exists to survive.

So we built a tool that creates them whenever we want. We named it Caraxes,
after a dragon, because its only job is to attack our own cluster while we
watch what happens.

<!-- truncate -->

## One server or many is a very different problem

A database on a single server has a simple failure story. The process is either
running or it is not. When it stops, everyone notices at the same time, and
recovery means one thing: read the write-ahead log and continue.

A cluster is not that kind. In a cluster, one part can break while everything
else keeps working. Even better, the parts that still work often cannot tell
what kind of break they are looking at.

Imagine three nodes, and one of them goes quiet. From outside, that looks the
same as:

- the node crashed,
- the node is alive but frozen for a few seconds,
- the node is alive and fine, but the network between it and the others is
  dropping packets.

Each case needs a different reaction. A crashed node must be replaced. A frozen
node will wake up by itself. A node behind a broken network may still think it
is the leader, and may still be accepting work.

The cluster has to choose a reaction anyway. It has to choose quickly, with
missing information, while people are waiting for their queries. Every
distributed database is a set of answers to that problem, and those answers are
only as good as the conditions you tested them in.

## Failing loudly is fine. failing quietly is not.

A database that returns an error is annoying. A database that returns a wrong
answer is dangerous, because nobody looks for a problem they were never told
about.

When something breaks, the danger changes shape. It stops being about speed and
starts being about truth:

- a write is confirmed, then lost when a new leader takes over,
- a deleted row comes back after an old replica is promoted,
- a transfer takes money from one account and never adds it to the other.

A normal test suite will not find any of that. A normal test suite runs on one
healthy machine, with plenty of disk and a perfect network. Those tests are
still worth having. They simply cannot answer the questions that matter most in
cluster mode.

## What reliability really means

Reliability is not one thing. It is several, and each one needs its own proof.

- Durability. If we confirm your commit, it survives, even if the node that
  confirmed it dies one second later.
- Consistency. You never see half of a transaction, no matter which replica
  answers your query.
- Availability. The cluster keeps serving while part of it is down.
- Recovery. After the problem is fixed, the cluster goes back to normal by
  itself, and fast.
- Predictability. The same failure behaves the same way every time.

A database can pass four of these and fail the fifth, and still be painful to
run. Imagine a cluster that stays perfectly correct but needs two minutes to
answer queries again after losing one node. It is correct, and it is still a bad
afternoon for everyone waiting.

This is why Caraxes measures all of them in a single run.

## How Caraxes works

A test is one YAML file. It says which cluster to build, what load to run, what
to break, and what result we expect.

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
disk, starts a real cluster in Docker, waits until every node is ready, loads a
dataset, and sends real SQL traffic through the normal client. Twenty seconds
in, it kills a node. Twenty seconds later, it brings the node back.

The failures are real, not simulated:

- a kill is a real SIGKILL to the process,
- a network partition is a real firewall rule that drops packets between nodes,
- a slow link is real added latency on the network interface,
- a full disk is a real file that grows until the disk has no space left.

We avoid simulations here. A simulation only tests the behavior we already
imagined.

At the end, the run finishes with a pass or a fail, so a machine can read the
result without a human in the loop.

## A simple rule beats a long discussion

The strongest check in the whole tool is also the easiest one to explain.

One of our test workloads moves money between random accounts. Every transfer
takes an amount from one row and adds it to another, inside one transaction.

That gives us a rule that cannot be argued with. Money only moves, it is never
created or destroyed, so the total of all balances must be exactly the same
after the test as before it.

Now we do not need to read logs or discuss whether a warning was serious. If the
total changed, a transaction was not atomic, and no amount of good performance
makes that acceptable. We never ignore this check, not even in a test where we
killed a node on purpose.

These transfers also create real conflicts between transactions, which is the
whole idea. Our other workload avoids conflicts so it can measure speed and
failover cleanly, but a test without conflicts will never catch a broken
transaction. You have to make transactions fight over the same rows, and then
kill a node while they are fighting.

## The same error can mean two things

An error means something different depending on what was happening at the time.

If we injected no failure at all, an internal error has no excuse. Nothing was
attacking the cluster, so we treat it as a real bug and the test fails.

If we just killed a node, the situation is different. Connections are closing
while requests are still travelling, so a few client-side errors are normal.
We count them and print them clearly, but they alone do not fail a test that
stayed correct and recovered in time.

This balance matters more than it sounds. A test that reports a problem every
single time gets ignored, and an ignored test protects nothing.

## Recovery time is a number we watch

While the failures happen, Caraxes writes down every break and every repair,
with exact timestamps. At the same time, the workload records what happened each
second: how many operations succeeded, how many failed, and how slow they were.

Afterwards, we put both records on the same clock. That answers three questions
for every failure. How bad did it get? Did the cluster keep doing useful work,
or did it stop completely? And how many seconds after the repair did things go
back to normal?

```text
# Fault analysis

- Normal seconds: error rate 0.00 %, write p99 1,382.0 ms
- During the failure: error rate 40.45 %, write p99 392.9 ms
- Longest recovery: 5.5 s; everything recovered: yes

| fault | healed | window (s) | peak error | failed | progressed | recovery (s) |
|---|---|---|---|---|---|---|
| kill/camus2 | yes | 20.3 | 100 % | 4,074 | yes | 5.5 |
```

Reading that line: we killed a node, errors jumped, the cluster never stopped
completely, and five and a half seconds after the node came back everything was
normal again. That last number is what we compare from one build to the next.

## Every test can be repeated

Every random choice comes from a seed number. The same seed kills the same node
at the same second, in the same order.

This is what turns a demo into a test. When a run fails, we can run it again and
watch it fail in exactly the same way. After we fix the cause, we run it once
more and watch it pass. A failure you cannot reproduce is just a story you tell
later.

## What we break today

Each test asks one clear question.

- A run with no failures at all, so we know the cluster and the traffic work
  before we break anything.
- A node killed in the middle of the run, then restarted.
- A node cut off from all the others, and separately a node slowed down, so
  nothing dies but the network stops cooperating.
- Money transfers running while a node is killed, with the total checked
  afterwards.
- Six nodes in three zones, with one entire zone killed, so every partition
  loses a replica at the same moment and has to survive with two.
- A node with a full disk, to confirm it refuses writes politely instead of
  crashing, and starts accepting them again once there is space.
- A long run with random failures arriving every ten to eighteen seconds.
- A test for the leader balancer alone: kill the busiest node, restart it, and
  check that leadership actually comes back to it.

## Stopping problems from coming back

A quality that nobody measures slowly gets worse.

Nobody breaks recovery time on purpose. Someone adds a cache, changes a timeout,
or moves two lines in the commit path, and a fifteen second recovery becomes
fifty. Each change looks fine in review. All the unit tests still pass, because
none of them ever unplugged a server.

That is why we can run a whole grid of tests at once. One file expands into many
runs across locking modes, cluster sizes, and failure types, and produces a
table with every result and every recovery time side by side. When a change
costs us reliability, it shows up as a row that used to pass and now does not.

The result is a pass or fail code that CI can read, because a judgement that
lives only in someone's memory of last month is not protection.

## What comes next

The plan is to keep adding tests until the questions we care about all have
answers.

- Deeper correctness checking, to catch strange orderings that a simple total
  cannot detect.
- Disks that are slow or that return damaged data, not only disks that are full.
- Clocks that disagree between nodes, because time is one of the things a
  cluster trusts the most.
- Nodes joining and leaving while traffic is running.
- Schema changes during failures, since a migration is the worst possible moment
  to lose a node.
- Distributed queries during failures, so a query split across the cluster still
  returns the same rows when one part disappears.
- Backups and restores while the cluster is under attack.
- Bigger clusters and much longer runs, because some bugs only appear after
  hours.

Every item is a question with a yes or no answer and a number next to it. We are
not collecting a badge that says the software passed. We are building a list of
questions we can answer with evidence instead of hope.

## Why this matters to us

CamusDB is meant to run in cluster mode for people who will never read its
source code.

They will not know which failures we thought about, which ones we tested, and
which ones we only assumed would be fine. They will find out on the day a server
dies during a busy afternoon. On that day, they will judge us on two things
only: was the data still there, and did the application keep working?

Preparing for that afternoon before it arrives is the only honest way to deserve
that trust. Chaos testing does not prove a database is perfect. It makes sure
that when it does fail, it fails in a way we already studied, already measured,
and already decided we can accept.
