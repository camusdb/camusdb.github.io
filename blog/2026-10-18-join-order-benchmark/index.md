---
slug: join-order-benchmark
title: A young database meets the Join Order Benchmark
date: 2026-10-18
authors: [andresgutierrez]
tags: [camusdb, query-optimizer, sql, benchmarks]
image: /img/temple.png
---

# A young database meets the Join Order Benchmark

![Data temple order](/img/temple.png)

If your queries join five, ten or fifteen tables, CamusDB now plans them
better and runs them faster. This post explains what changed in plain terms,
so you can see what to expect from your own queries.

A join query names its tables and its conditions. It does not say in which
order to join the tables. The database picks the order, and the order decides
how much data the query reads. A good order starts from the few rows that
survive the filters. A bad order can build millions of rows and then throw
most of them away.

The [Join Order Benchmark](https://www.vldb.org/pvldb/vol9/p204-leis.pdf)
(JOB) is a set of 113 queries from a 2015 paper by Leis and five co-authors.
The queries run over a movie database of 21 tables, and each one joins 4 to
17 tables. The paper tested mature databases and found that their estimates
of how many rows a join returns were often wrong by orders of magnitude. The
error grows with each join, and a wrong estimate leads to a slow plan. The
benchmark exists to show that weakness.

<!-- truncate -->

## Where we started

In July I wrote about
[how CamusDB searches for a join order](/blog/dynamic-programming-query-optimizer).
In short, the planner finds the cheapest plan for small groups of tables first
and reuses those plans for larger groups.

Our first run of the 113 JOB queries used synthetic movie data at 1/1000 of
the real size. SQLite ran the same rows as an independent check. Every CamusDB
result matched. But 25 queries did not finish in 30 seconds, and the full run
took 1,159 seconds. Every plan contained a cross product, a join of every row
against every row.

The executor was fine. We put the tables of two queries in a good order by
hand. One query went from 10 seconds to 0.4 seconds. Another went from a
timeout to 40 milliseconds. The planner did not find the order on its own.

## What changed

Six changes made the difference. Each one stands on its own, and each one
applies to every join query, not only to the benchmark.

**The planner reads every condition on its own.** A JOB query lists its tables
with commas and puts all conditions in `WHERE`. The old planner grouped the
conditions as the query wrote them. A table whose only link came through a
later table looked unconnected, so the planner joined it with a cross product.
The planner now reads each condition on its own and finds the links between
tables wherever they are. No JOB plan has a cross product today. The run went
from 1,159 seconds to 184 seconds, with no timeouts.

**One estimate per group of tables.** To compare two orders, the planner
estimates how many rows each step produces. JOB queries name the same movie
through up to six columns and write every pair of them as equal. The old
estimator treated each of those fifteen equalities as a separate filter and
multiplied the estimate down to almost nothing. The new estimator sees one
fact: these six columns hold the same value. The run went from 184 seconds to
9.5 seconds.

**Wide joins get the full search.** The search compares every group of tables
that an order can build. That number grows fast, so the old search stopped at
12 tables and used a simple rule above that. Nine JOB queries have 14 or 17
tables. The search now skips the groups that no order can build, which are
most of them, and plans joins of up to 30 tables. Past a budget of steps it
takes a fast greedy order instead of a slow search.

**Statistics that see popular values.** The planner sizes a join from the
number of distinct values in the join column. That formula assumes every value
is as common as every other. Real data is not like that: one movie has
thousands of cast rows and most have a few. `ANALYZE` now keeps the most
common values of each column with their counts, and the planner uses them. It
also records how many rows hold NULL, because a NULL key joins with nothing.
When a query filters a small lookup table down to one row, the planner reads
that row before it plans. It then prices the join by the popularity of that
key.

**Each lookup costs less.** With a good order, a join runs as a chain of index
lookups. For each row on the left, the join finds the rows on the right that
match. The old
lookup asked the store for a page of 512 index entries and used 11 of them on
average. The lookup now stops at the entries of its key. The join also keeps
the rows of each key it found, so a repeated key costs nothing. And it sends a
page of left rows to the store in one request instead of one request per row.

**A test that watches plan quality.** A correctness test does not catch a
planner that returns the right rows and reads ten times more data to do it. A
new test suite runs a fixed set of queries on fixed data and counts the rows
and lookups of each plan. It compares the counts with a baseline file in git
and fails when a query's work grows by more than half. The JOB queries run
every night, and every result is checked against SQLite.

## The numbers

Work is the number of rows read, key lookups and index entries scanned over
the whole plan, at a scale of about 225,000 rows.

| Baseline | Total work, 113 queries | Largest estimate error |
| --- | ---: | ---: |
| First baseline | 6,111,336 | 78,378x |
| Current | 1,007,752 | 1,240x |

The engine does one sixth of the work it did at the first baseline, for the
same results. The same test on the same laptop ran the 113 queries in 51
seconds before the lookup changes and runs them in 7.9 seconds today. No query takes more than a
second. The three 17-table queries took 4 to 5 seconds each and now run in
under 15 milliseconds.

The [plan quality page](/docs/plan-quality-testing#comparison-with-sqlite-and-postgresql)
in the docs compares the three engines on the same rows with warm runs.
CamusDB takes 1.5 seconds, SQLite 7.2 seconds and PostgreSQL 0.74 seconds.
CamusDB runs as an embedded node on a transactional key-value store, so this
is a reference and not a race. Before this work, 25 of these queries did not
finish at all.

## Why this matters outside a benchmark

Each change answers a problem that real tables have. The benchmark only made
them visible at the same time.

The shape of a JOB query is common. One large table links to many small ones,
and the filters sit on the small ones. That is a star schema, and most
applications have one:

- An online store joins orders to customers, products, categories, warehouses
  and shipments. A report filters on one category or one month.
- A ledger joins transactions to accounts, counterparties, currencies and
  instruments. A statement filters on one account and a date range.
- A multi-tenant product joins events to tenants, users, projects and plans.
  Every query filters on one tenant.
- A game backend joins players, inventories, items, trades and guilds. A
  player's screen filters on one player.

The data behind those tables is skewed, has NULLs, and repeats its keys:

- A few products appear in most orders. A few accounts hold most of the
  transactions. One tenant can hold half of the rows. A planner that prices
  every value alike plans for the average and then meets the largest customer.
- Foreign keys are often NULL: an order without a coupon, a transaction
  without a counterparty, an item without an owner. An estimate that ignores
  NULLs is wrong by the NULL share.
- Keys repeat. Every line of an order carries the same order id, and every row
  of an inventory carries the same owner. A lookup that remembers its answers
  runs once per key.
- Nobody writes a `FROM` list in the best order, and an ORM or a report
  builder writes it in no order at all. The planner has to find it.

The last point matters most for CamusDB. The store is distributed, so each
lookup can be a network round trip. A plan that looks up a thousand times
where ten would do is slow by the latency of the cluster.

## What a robust optimizer means here

A benchmark win can hide a fragile optimizer. These are the properties I care
about more than the time:

1. **Results never change.** SQLite checks every plan on every nightly run. A
   plan that changes results is a bug, not an optimization.
2. **The search is bounded.** The step budget and the greedy fallback keep
   planning time small at any width. The 17-table queries plan in 9 to 16
   milliseconds.
3. **The same query gets the same plan.** Two orders of equal cost keep the
   order the user wrote.
4. **No statistics means a fallback, not a failure.** Without statistics the
   planner uses a simple order and still removes avoidable cross products.
5. **The plan is visible.** `EXPLAIN (ANALYZE)` shows the order the search
   chose, its estimate next to the actual rows, and the lookups each join saved.
6. **Regressions are caught before merge.** The plan quality test runs on every
   pull request.

## What is still open

PostgreSQL executes the corpus five times faster, and the gap is in the
executor, not in the planner. The search considers one shape of plan, a chain
that adds one table at a time. Plans that join two groups of tables, and a
search below an outer join, are not there yet. The worst estimate error is
still above 1,000x on one query.

A young database does not win a benchmark. It learns from one. JOB told us
where the optimizer was wrong, in a form we could measure and gate. That is
the victory I want to keep.
