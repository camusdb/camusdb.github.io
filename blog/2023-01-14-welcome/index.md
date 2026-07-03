---
slug: welcome
title: Why CamusDB Exists
date: 2026-07-03
authors: [andresgutierrez]
tags: [camusdb]
---

> Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.
>
> — Antoine de Saint-Exupéry

# Why I Started Building CamusDB

For many years I worked with Google Spanner, and somewhere along the way I fell in love with distributed SQL databases.

That may sound a little too dramatic for a database, but honestly, it is true.

In the video game industry, databases are not just boring infrastructure sitting in the background. They are a critical part of the player experience. Games need to handle spikes, global traffic, competitive systems, economies, inventories, matchmaking, leaderboards, live events, rewards, and a lot of things that must work correctly even when thousands or millions of players are active.

That is where distributed SQL really clicked for me.

Strong consistency matters. Scalability matters. Being able to reason about your data without constantly adding workarounds, queues, caches, compensating jobs, or manual repair scripts matters a lot. Spanner showed me that a database could solve many of these problems at the infrastructure level instead of forcing every backend team to reinvent the same patterns over and over again.

At some point, I started asking myself: what would it look like to build something like this myself?

Not because the world needs yet another database just for the sake of it, but because I wanted to explore the architecture deeply. I wanted to understand the tradeoffs, the hard parts, the abstractions, and the places where I could experiment with ideas that I think are useful.

That is how CamusDB started.

I began working on it in 2021. At the beginning, it felt like a big experiment. As I kept going, I realized it was not just big; it was a huge endeavor. Building a database, especially a distributed SQL database, touches almost every hard problem in backend infrastructure.

But that is also what makes it exciting.

It is challenging, sometimes painfully so, but I like that. I enjoy working on systems where every layer matters and where there is always one more thing to understand better.

## Why .NET?

One question I get often is: why build a database in .NET?

The short answer is: because .NET today is not the .NET people remember from 10 or 15 years ago.

The platform has been improving year after year, especially in performance. The JIT, the GC, the runtime, networking, memory APIs, async performance, Native AOT, and the standard libraries have all improved a lot. Modern .NET is fast, mature, productive, and very capable of handling serious backend infrastructure workloads.

I have been working with .NET for many years, and I know the ecosystem well. For me, building CamusDB in .NET is not a limitation. It is actually one of the reasons I can move fast while still keeping the system clean and understandable.

There is also something I like about challenging the default assumption that infrastructure projects must be written in Go, Rust, C++, or Java to be taken seriously. Those are great languages, of course, but .NET has earned its place in this conversation.

## CamusDB did not appear out of nowhere

CamusDB is not the first piece of this puzzle.

For years I have been building the lower-level infrastructure needed to make something like this possible.

The first big piece is [Kahuna](https://github.com/kahunakv/kahuna), a distributed key/value and locking layer. Kahuna provides the coordination and transactional primitives that CamusDB uses as its foundation.

Then there is [Kommander](https://github.com/kahunakv/kommander), the Raft library used to build the replicated consensus layer. Raft is one of those things that looks simple when you read the paper, but once you start implementing it and testing failure scenarios, you realize how many details matter.

CamusDB sits on top of all of that work.

So in many ways, CamusDB is the result of years of building the pieces underneath it: distributed coordination, locks, key/value storage, replication, consensus, transactions, and all the boring but necessary machinery that makes a database possible.

## Why build my own database?

A big reason is freedom.

When you work on your own database, you can add features that you personally believe are useful, even if they are not common yet in mainstream systems.

One example is database branching.

The idea is simple: what if branching a database felt more like branching code? What if you could create isolated branches of your data for testing, development, experiments, previews, or risky changes without needing to clone everything manually or maintain a bunch of fragile environments?

That is the kind of feature I find exciting because it comes from real-world pain. In backend and game development, we constantly need safe environments to test changes. We need to validate economy changes, content updates, migrations, live event configurations, and backend behavior without affecting production data.

Database branching is one of those features that feels obvious once you start thinking about databases as developer tools, not just storage engines.

And that is part of the philosophy behind CamusDB. I do not want to build only a technically interesting database. I want to build something useful. Something that solves practical problems for developers and teams.

## The hard parts are the fun parts

Building a distributed SQL database is not easy.

You have to think about query planning, transactions, distributed execution, indexes, consistency, replication, schema changes, locking, fault tolerance, storage, snapshots, and a long list of details that can break in subtle ways.

But that is also what makes it interesting.

Every feature forces you to understand the system more deeply. Every bug teaches you something. Every design decision has a tradeoff. You cannot hide from the complexity, but you can try to make it manageable and build the system piece by piece.

That process has been one of the most rewarding parts of working on CamusDB.

## Where things are now

The result is starting to look incredible.

CamusDB is no longer just an idea or a weekend experiment. It is becoming a real database with real capabilities, built on top of infrastructure that has taken years to design and implement.

There is still a lot to do. Databases are never "done." And honestly, the more I work on it, the more I understand how big the endeavor really is.

But that is part of the appeal.

It is hard, it is ambitious, and it constantly pushes me into problems that are deeper than they first look. That challenge is one of the main reasons I keep building it.

CamusDB started from my experience with Spanner, my love for distributed SQL, and years of dealing with backend problems in video games. It grew out of the belief that strong consistency and scalability should be more accessible, and that modern .NET is a great platform to build serious infrastructure.

But at the core, the reason is simple:

I wanted to build the database I wish I had for many of the systems I have worked on.

And so far, it has been one of the most exciting projects I have ever built.

<!-- truncate -->
