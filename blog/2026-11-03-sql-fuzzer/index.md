---
slug: what-a-sql-fuzzer-catches
title: What a SQL fuzzer catches
date: 2026-11-03
authors: [andresgutierrez]
tags: [camusdb, reliability, sql, testing]
image: /img/sqlfuzz.png
description: How the CamusDB SQL fuzzer finds wrong rows with no error, without a second database, and which defects it can catch in the future.
---

# What a SQL fuzzer catches

![SQLFuzz](/img/sqlfuzz.png)

Your database can return the wrong rows and report no error. A hand-written test catches only the cases its author thought of. A SQL fuzzer catches cases nobody thought of, and it runs every night on its own. This post shows how the CamusDB fuzzer works, which defects it can catch, and what it cannot see. You need no knowledge of fuzzers or of database internals.

<!-- truncate -->

## A fuzzer that needs no second database

A fuzzer makes random inputs and feeds them to the software under test. For a database, the inputs are tables, rows and SQL statements. The hard part is not to make a random query. The hard part is to know its correct answer.

One way is to run the same query on a second database, for example PostgreSQL, and compare the two answers. That needs a second database, and the two must agree on every rule of SQL. The CamusDB fuzzer takes another way. It does not know the correct answer. It knows that two different queries must give the same answer. The name for this is a **metamorphic** test. Each such rule is an **oracle**.

Here is an example. SQL has three truth values: a filter on a row is true, false or unknown, and unknown comes from NULL. So the rows where a filter is true, the rows where it is false and the rows where it is unknown add up to the whole table. The fuzzer runs the four queries and checks the sum. If the results do not agree, one of them is wrong. The fuzzer does not need to know which one.

The oracles are the ones of [SQLancer](https://github.com/sqlancer/sqlancer), an open tool for database tests, written again in C#. They run in the same process as the engine. No driver, no network, no second database.

## One round, step by step

The fuzzer works in rounds. Each round does five things:

1. It makes a random schema: a few tables with columns of mixed types, and some indexes.
2. It fills the tables with random rows, NULL values included.
3. It makes a random statement, for example a query with a join and a filter.
4. It hands the statement to one oracle. The oracle makes its variants and runs them all on the engine.
5. It compares the results.

A disagreement is a **finding**. The fuzzer writes it to disk at once, so a later hang cannot lose it. Then it shrinks the finding: it removes tables, rows, columns and parts of the query until the smallest case that still fails remains. Last, it prints the shrunk case as a ready-to-paste unit test, with the seed that replays it.

Every round takes its random numbers from a base seed and a round number. The same two numbers give the same schema, data and statements again. So a finding from the nightly job replays on a developer's machine with one command.

A time limit applies to every statement. A statement past the limit is a finding too. If it does not stop on cancellation, the fuzzer discards the engine and starts a new one.

## The defects it can catch

A **plan** is the engine's choice of how to run a query: which index to read, in which order to join the tables, and with which join algorithm. Most logic bugs hide in one plan and not in another. So the oracles make the engine take different paths to one answer. The table lists the five oracles, the rule each one enforces, and what a failure would point to.

| Oracle | The rule | A failure would mean |
| --- | --- | --- |
| Error classification | Every error carries a specific CamusDB error code. Every statement finishes within a time limit. Every result row serializes to the JSON that the HTTP API sends. | A raw exception that reaches the client, such as an overflow or a null reference. An internal-error code. A statement that never finishes. A value that no client can receive. |
| Ternary logic partitioning | The three-way split from above: the rows where a filter is true, false and unknown add up to the rows with no filter. The same holds for MIN, MAX, SUM and COUNT, for DISTINCT, for GROUP BY and HAVING, and for the ON condition of a join. | A NULL compared the wrong way. A NaN or a negative zero that is true on one path and false on another. A comparison whose truth value changes with the path. |
| NoREC | The unoptimized form is the reference: `COUNT(*)` with a filter equals `SUM(CASE WHEN filter THEN 1 ELSE 0 END)` with no filter. The first form lets the planner use indexes. The second form tests the filter on every row of a full scan. | An index seek with wrong bounds. A lookup that loses a key. A filter pushed to the wrong side of a join. |
| Plan equivalence | One query returns the same rows under every plan: each index choice, each join algorithm, the heuristic planner, the spill-to-disk join, the plan cache, and both row decoders. The oracle reads the EXPLAIN of both plans to confirm that they differ. | An index or a join algorithm that returns other rows than a plain scan. A cached plan that gives wrong rows on its second use. A join that drops a row when it spills to disk. |
| DML integrity | After each INSERT, UPDATE, DELETE or UPSERT, the table holds exactly what the rule expects: the affected-row count, each value, no extra row, no lost row. The row store, every index and the values stored outside their rows agree. A failed statement changes nothing. In a transaction, one failure aborts the whole transaction. | Twin rows. An index entry with no row, or a row with no index entry. A column copy inside an index that did not follow an update. A lost out-of-row value. A wrong affected-row count. An UPSERT that skipped its insert or its update. A failed write that changed data. |

A FLOAT64 sum gets a tolerance, because the order of the additions changes a float sum. Every other value compares exactly.

## What it cannot see

A metamorphic oracle finds results that disagree. It does not find a result that is wrong in the same way on every path. If every form of a query computes the same wrong value, the comparison passes. Such defects need a reference, for example PostgreSQL or an in-memory model. The generator is built for that: it makes statement trees, not SQL text, and a second printer can turn the same trees into another dialect.

The fuzzer runs one session at a time. It does not find concurrency bugs, isolation anomalies or bugs that need an injected fault. Other harnesses own those. The row oracles skip queries whose rows depend on order: LIMIT, window functions and set operations. Those forms still run under the error oracle, but nothing checks their rows.

## Run it

```sh
dotnet test CamusDB.SqlFuzz.Tests/CamusDB.SqlFuzz.Tests.csproj --filter "FullyQualifiedName~.FuzzCampaignTests."
```

This runs all five oracles for 30 seconds each, with a seed from the clock. `SQLFUZZ_SEED` fixes the seed, and `SQLFUZZ_BUDGET_SECONDS` sets the time per oracle. A failed run prints the seed, the round and a unit test that reproduces the finding. The full guide is `docs/sql-fuzzer.md` in the CamusDB repository.

## Why it matters

A hand-written test checks one schema, one data set and one query. The fuzzer makes a new schema, a new data set and new statements in every round, and each night starts from a new seed. It reaches the shapes nobody writes by hand: a NULL in a join key, an index on a column with one distinct value, an UPDATE that changes every column of an index at once.

This makes the two systems at the heart of CamusDB more robust. The query system must return the same rows under every plan, and the fuzzer forces every plan. The write system must leave rows, indexes and out-of-row values in agreement after every statement. The fuzzer checks that agreement after every write. A night with no finding is evidence that both rules hold. A finding arrives as a small failing test, before a user meets the same defect in production.

A change inside the engine joins the test on its first night. A new join algorithm, a new index path or a new row decoder needs no new test. The same statements run, and the oracles judge the new path as before. So each change costs less to trust, and each release ships with more evidence behind it.
