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
several servers, and its transactions are consistent across them.

In the video game industry, the database is a critical part of the player
experience. Games need to handle traffic spikes and players around the world.
Systems such as economies and inventories must work correctly when thousands
or millions of players are active.

Spanner showed me that a database could give strong consistency and
scalability at the infrastructure level. When the database does not give
them, backend teams add workarounds such as queues and manual repair scripts.

I wanted to learn what it takes to build such a database. I wanted to
understand the tradeoffs and the hard parts. I also wanted a place to
experiment with ideas that I think are useful.

<!-- truncate -->

I began to work on CamusDB in 2021. At the beginning, it felt like a big
experiment. A distributed SQL database touches most of the hard problems in
backend infrastructure, and that is what makes it exciting to me.

## The reasons for .NET

.NET has improved year after year, especially in performance. The JIT
compiler and the garbage collector are two examples. Modern .NET is fast and
mature, and it can run serious backend infrastructure workloads.

I have worked with .NET for many years, and I know the ecosystem well. That
lets me move fast and keep the system clean and understandable.

For infrastructure projects, .NET has earned its place next to languages such
as Go and Rust.

## The layers under CamusDB: Kahuna and Kommander

For years I built the lower-level infrastructure that CamusDB needs.

- [Kahuna](https://github.com/kahunakv/kahuna) is a distributed key/value
  and locking layer. It provides the coordination and the transactional
  primitives that CamusDB uses as its foundation.
- [Kommander](https://github.com/kahunakv/kommander) is the Raft library
  under Kahuna. Raft is a protocol with which servers agree on the order of
  writes. An implementation that survives failure tests has many more details
  than the paper describes.

CamusDB sits on top of that work. Those layers provide replicated storage and
transactions under the SQL engine.

## Freedom to add features such as database branching

When you work on your own database, you can add features that you believe are
useful, even if mainstream systems do not have them yet.

One example is database branching. A branch is an isolated copy of your data
for tests and risky changes. You don't need a manual clone of the data or a
set of fragile environments to create it.

In backend and game development, we constantly need safe environments to
validate changes such as migrations and economy updates. These tests must not
affect production data. Database branching comes from that need.

## The scope of a distributed SQL database

A distributed SQL database has many parts, from query planning and
distributed execution to replication and storage. Each of these can break in
subtle ways.

Features force me to understand the system more deeply, and design decisions
have tradeoffs.

## Current state

CamusDB is becoming a real database with real capabilities, on top of
infrastructure that took years to design and implement. There is a lot to
do. The goal is to make strong consistency and scalability more
accessible.
