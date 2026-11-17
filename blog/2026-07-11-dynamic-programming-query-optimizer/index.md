---
slug: dynamic-programming-query-optimizer
title: Teaching CamusDB to choose better query plans
date: 2026-07-11
authors: [andresgutierrez]
tags: [camusdb, query-optimizer, sql]
description: "How the CamusDB query optimizer uses dynamic programming and table statistics to choose a join order, and why the search space grows so fast."
---

# Teaching CamusDB to choose better query plans

This post explains how CamusDB chooses the order in which it joins tables,
and why that choice has a large effect on query time. You will see how the
search works, how table statistics improve it, and how to enable it and
inspect its result with `EXPLAIN`.

The query optimizer is the part of a database that decides how to run a SQL
query. A query can use a table scan, an index lookup, an index range scan, a
hash join, a merge join, a nested loop join, a sort, an aggregate, a derived
table, or a subquery. Every option gives a correct result, but only some are
fast. The optimizer chooses a plan before the query runs.

<!-- truncate -->

SQL is declarative. This query says which result the user wants, and gives no
order in which to read the tables:

```camussql
SELECT u.email, p.title, c.body
FROM users u
JOIN posts p ON p.user_id = u.id
JOIN comments c ON c.post_id = p.id
WHERE u.active = true;
```
The database decides the order.

## Join order decides how much data a query reads

Assume these three tables:

- `users` has many rows, but only a few are active.
- `posts` has many rows for each user.
- `comments` has many rows for each post.

If CamusDB starts with all comments, then joins posts, then joins users, it
reads a lot of data before it finds that most rows do not match
`u.active = true`.

If it starts with the active users, it reduces the data much earlier. The
result is the same, but the amount of work is very different. So the
optimizer has to estimate the cost of each order.

## The number of join orders grows fast

With two tables, there are only a few orders. With five, six, or seven
tables, the number of possible orders grows very quickly.

An optimizer could try every order, estimate the cost of each one, and pick
the cheapest. That works for tiny cases, but then the optimizer itself
becomes too slow.

CamusDB uses dynamic programming for eligible inner joins when cost-based
join ordering is enabled. Dynamic programming solves a large problem from the
saved answers to smaller ones. This approach comes from System R, an early
relational database.

The optimizer asks smaller questions first:

- What is the best plan for `users`?
- What is the best plan for `posts`?
- What is the best plan for `comments`?
- What is the best plan for `users JOIN posts`?
- What is the best plan for `posts JOIN comments`?

It remembers the best answer for each small set of tables and reuses it to
build the answer for a larger set.

## The optimizer fills a table of partial plans

First, the optimizer estimates the best way to read each table. One table can
use an index, and another a full scan.

Then it looks at pairs of tables that can be joined. For each pair, it asks:

- Can this pair be joined with an indexed nested loop?
- Is a hash join cheaper?
- Can both sides arrive ordered, so that a merge join is possible?
- How many rows will probably come out?
- How expensive is the intermediate result?

Then it does the same for groups of three tables, then four, and so on. Each
step builds on the best smaller plans it already found. At the end, it has a
plan for the full query.

These are estimates. The optimizer does not know the exact row counts.

## The memo table and the recurrence

The optimizer keeps a memo table:

```text
dp[set of tables] = cheapest known left-deep plan for exactly that set
```
"Left-deep" is explained in the next section. For a query with three tables,
the optimizer first creates entries for single tables:

```text
dp[{users}]
dp[{posts}]
dp[{comments}]
```
Each entry stores a partial plan, its estimated cost, and the estimated
number of rows that it produces.

Then CamusDB builds larger entries from smaller ones:

```text
dp[{users, posts}]
dp[{posts, comments}]
dp[{users, comments}]
dp[{users, posts, comments}]
```
The recurrence is roughly:

```text
best(S) =
  min over each table R in S:
    best(S - R) joined with R
```
CamusDB only considers a join when a predicate connects the existing left
side and the new right table. That prevents a cross product, which is a join
of every row against every row.

For each possible extension, the optimizer asks which join algorithm is
cheaper:

- If the right table has an index on the join key, an indexed nested-loop
  join can be cheap.
- If repeated index probes look expensive, a hash join can be cheaper.
- If both sides can arrive ordered by the join key, a merge join can be a
  good option.

In simplified form:

```text
candidate_cost =
  cost(best_left_plan)
  + cost(join best_left_plan with next_table)
```
If the new candidate is cheaper than the current `dp[S]`, it replaces it.

```mermaid
flowchart TD
    A[Parse SQL] --> B[Bind tables and aliases]
    B --> C[Collect join leaves and ON predicates]
    C --> D[Estimate each table scan]
    D --> E[Initialize dp for single tables]
    E --> F[Build connected 2-table subsets]
    F --> G[Build connected 3-table subsets]
    G --> H[Continue until the full table set]
    H --> I[Pick cheapest left-deep join tree]
    I --> J[Build physical join operators]
    J --> K[EXPLAIN shows estimated rows and cost]
```
The real implementation has more details, but this is the core.

## The search covers left-deep plans only

A left-deep plan looks like this:

```text
(((users JOIN posts) JOIN comments) JOIN reactions)
```
The left side grows one table at a time, and each step adds one new table on
the right.

In a bushy plan, both sides of a join can be joined subtrees:

```text
(users JOIN posts) JOIN (comments JOIN reactions)
```
Bushy plans can be useful, but they make the search space larger. For now,
CamusDB searches left-deep plans only.

The search has more boundaries:

- It is used for eligible inner joins.
- It works with `JOIN ... ON` predicates that can be safely reordered.
- It is capped for very wide joins, so planning time stays bounded.
- Unsupported shapes fall back to the heuristic join order.

## Statistics from ANALYZE improve the estimates

CamusDB can use table statistics, index counts, histograms, min/max values,
and distinct-value counts that `ANALYZE` collects. These values answer
questions like:

- How many rows are in this table?
- What fraction of the rows does this filter keep?
- Is this index likely to return a small number of rows?
- How many rows can this join produce?

```camussql
ANALYZE TABLE users;
ANALYZE TABLE posts;
ANALYZE TABLE comments;
```
You can inspect the result with `EXPLAIN`:

```camussql
EXPLAIN
SELECT u.email, p.title, c.body
FROM users u
JOIN posts p ON p.user_id = u.id
JOIN comments c ON c.post_id = p.id
WHERE u.active = true;
```
`EXPLAIN` shows the selected physical plan with its estimated rows and cost.
You can see whether CamusDB picked a hash join, a merge join, an indexed
nested loop join, or a fallback nested loop join.

## Constraints on the optimizer

In the real engine, the optimizer has these constraints:

- It must preserve SQL semantics.
- It must respect join predicates.
- It must not reorder joins when that changes the result.
- It must know which indexes are available.
- It must estimate row counts from imperfect statistics.
- It must choose between different join algorithms.
- It must still produce a plan quickly.

Your part is small: write SQL, create useful indexes, and run `ANALYZE` when
the data changes.

## The cost-based optimizer is opt-in

CamusDB keeps the cost-based optimizer behind configuration flags:

```yaml
cost_based_access_path_enabled: true
cost_based_join_order_enabled: true
```
The rule-based planner remains stable and predictable. Enable the cost-based
planner when you want CamusDB to compare more plans and use statistics.
