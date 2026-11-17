---
slug: welcome
title: "The origins of CamusDB: Spanner, game backends, and .NET"
date: 2026-07-03
authors: [andresgutierrez]
tags: [camusdb]
image: /img/why-camus.jpg
description: "Why CamusDB exists: years of distributed SQL in game backends, why it is built in .NET, the storage and consensus layers under it, and features such as database branching."
---

> Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.
> 
> — Antoine de Saint-Exupéry

![Why CamusDB exists](/img/why-camus.jpg)

# The origins of CamusDB: Spanner, game backends, and .NET

This post explains why CamusDB exists, why it is written in .NET, and which
projects it is built on. Read it to understand the goals of the database
before you evaluate it.

For many years I worked with Google Spanner, and I fell in love with
distributed SQL databases. A distributed SQL database stores its data on
several servers and keeps transactions consistent across them.

In the video game industry, the database is a critical part of the player
experience. Games need to handle spikes, global traffic, competitive systems,
economies, inventories, matchmaking, leaderboards, live events, and rewards.
All of it must work correctly when thousands or millions of players are
active.

Spanner showed me that a database could give strong consistency and
scalability at the infrastructure level. Without that, every backend team
adds its own workarounds: queues, caches, compensating jobs, and manual
repair scripts.

So I asked myself what it would take to build something like this. I wanted
to understand the tradeoffs, the hard parts, and the places where I could
experiment with ideas that I think are useful.

<!-- truncate -->

I began to work on CamusDB in 2021. At the beginning, it felt like a big
experiment. A distributed SQL database touches almost every hard problem in
backend infrastructure, and that is what makes it exciting to me.

## The reasons for .NET

One question I get often is why I build a database in .NET.

.NET has improved year after year, especially in performance: the JIT
compiler, the garbage collector, networking, memory APIs, async code, Native
AOT, and the standard libraries. Modern .NET is fast, mature, and capable of
serious backend infrastructure workloads.

I have worked with .NET for many years, and I know the ecosystem well. That
lets me move fast and keep the system clean and understandable.

For infrastructure projects, .NET has earned its place next to Go, Rust, C++,
and Java.

## The layers under CamusDB: Kahuna and Kommander

For years I built the lower-level infrastructure that CamusDB needs.

- [Kahuna](https://github.com/kahunakv/kahuna) is a distributed key/value
  and locking layer. It provides the coordination and the transactional
  primitives that CamusDB uses as its foundation.
- [Kommander](https://github.com/kahunakv/kommander) is the Raft library
  under Kahuna. Raft is a protocol with which servers agree on the order of
  writes. It looks simple in the paper, but an implementation that survives
  failure tests has many details.

CamusDB sits on top of that work: distributed coordination, locks, key/value
storage, replication, consensus, and transactions.

## Freedom to add features such as database branching

When you work on your own database, you can add features that you believe are
useful, even if mainstream systems do not have them yet.

One example is database branching. A branch is an isolated copy of your data
for tests, development, experiments, previews, or risky changes. You create
it without a manual clone of everything and without a set of fragile
environments.

The feature comes from real pain. In backend and game development, we
constantly need safe environments to validate economy changes, content
updates, migrations, live event configurations, and backend behavior, with no
effect on production data.

## The scope of a distributed SQL database

A distributed SQL database includes query planning, transactions, distributed
execution, indexes, consistency, replication, schema changes, locking, fault
tolerance, storage, and snapshots. Each of these can break in subtle ways.

Every feature forces me to understand the system more deeply, and every
design decision has a tradeoff.

## Current state

CamusDB is becoming a real database with real capabilities, on top of
infrastructure that took years to design and implement. There is still a lot
to do. The goal is to make strong consistency and scalability more
accessible.
