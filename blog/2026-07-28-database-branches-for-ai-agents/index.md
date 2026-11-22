---
slug: database-branches-for-ai-agents
title: A database branch for every AI agent experiment
date: 2026-07-28
authors: [andresgutierrez]
tags: [camusdb, database-branching, ai-agents]
description: "AI agents explore several solutions in parallel, and each one needs a realistic database. Copy-on-write branches give every experiment an isolated database that is fast to create and drop."
---

# A database branch for every AI agent experiment

This post explains how database branches give each experiment an isolated
database that is fast to create and to drop. You will see the SQL, how
copy-on-write makes a branch cheap, and the limits of the feature today. It
is useful if AI agents or automated jobs test changes against your data.

A developer usually tests one idea at a time. An AI agent can explore several
solutions in parallel: one tries a schema migration, another rewrites some
data, a third reproduces a bug. Each one needs a realistic database, and none
of them must damage the shared starting point.

<!-- truncate -->

## Parallel experiments interfere on a shared database

Consider an agent that must improve the checkout flow of an online store. It
compares three approaches.

- Add a new status to the current table.
- Move payment details into a separate table.
- Keep the schema and change only the application logic.

If all three use the same database, they interfere. A migration from the
first attempt can break the second. Test data from the second can change the
result of the third. When something fails, it is hard to tell which action
caused it.

The usual response is to create separate databases or to restore the same
backup several times. That adds time and operational work, and the cost grows
when software creates the experiments.

## Create a branch with SQL

CamusDB creates an isolated branch from a point in time with one statement.

```camussql
CREATE DATABASE checkout_attempt BRANCH FROM prod;
```
The new database begins with the schema and data of `prod` at that moment,
the fork point. After that, changes in the branch stay in the branch.

- New rows do not appear in the parent database.
- Updates do not replace the parent's values.
- Deletes do not remove the parent's rows.
- Schema changes do not alter the parent's structure.

CamusDB does not copy the source rows when it creates the branch. Reads of
inherited data use the source snapshot. New writes and schema changes go into
a private overlay that the branch owns. This model is called copy-on-write.

So a branch can begin from a large, realistic database with no full copy.
Storage grows as the branch diverges from its parent.

Two experiments can start from the same database.

```camussql
CREATE DATABASE checkout_schema_test BRANCH FROM prod;
CREATE DATABASE checkout_data_repair BRANCH FROM prod;
```
The first branch tests a migration.

```camussql
USE checkout_schema_test;

ALTER TABLE orders ADD COLUMN payment_reference STRING;
CREATE INDEX orders_payment_reference_idx
ON orders (payment_reference);
```
The second tests a data change.

```camussql
USE checkout_data_repair;

UPDATE orders
SET status = "review"
WHERE status = "payment_unknown";
```
Neither experiment changes `prod`, and neither branch can see the other
branch's work.

## Fast creation makes a branch per task practical

If an isolated environment takes several minutes to create, an agent creates
fewer of them. It reuses an old test database or puts several tasks in the
same environment. Both choices reduce isolation.

When a branch is fast to create, a system can create one for each task or
test run. Failed branches can be inspected and then removed.

Creation time also affects parallel work. If one task explores eight possible
changes, the eight workers can start from the same state at once and move
independently.

## The agent workflow: branch, change, check, drop

Many agent workflows follow the same five steps.

1. Start from a known state.
2. Create one or more isolated branches.
3. Make a different change in each branch.
4. Run checks and compare the results.
5. Keep the useful information and drop the branches.

For example, an agent investigates a bug that appears only in production. It
creates several branches from the same point in time. In one branch, it
changes an order's status. In another, it removes a related payment record.
In a third, it applies a proposed schema fix. All the branches have the same
starting point. This means that the results are easy to compare.

Branches are also useful for other tasks that change data.

- Rehearse migrations against realistic data.
- Test data repair scripts before approval.
- Compare alternative indexing strategies.
- Generate test cases that modify the database.
- Run destructive checks in disposable environments.

## Each result has a known starting state

When several workers share one database, a successful test can depend on data
that another worker created. A failed test can come from an unrelated
migration. A retry can give a different answer, because the starting state
changed.

With branches, each attempt has a clear parent and a clear fork point. If an
attempt fails, the branch is available afterwards. A developer can query it
and see the exact state that produced the failure.

`SHOW BRANCHES` and `SHOW ANCESTORS` show these relationships.

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM checkout_schema_test;
```
They answer three questions: which experiments exist, where a branch
came from, and how deep its history is.

## Costs and limits of branches

A live branch needs its source snapshot. This means that CamusDB cannot
always reclaim old history while the branch depends on it. In a deep chain of
branches, a read checks several ancestors and is slower.

For automated workflows, keep branches focused and short-lived.

- Create a branch for a specific task.
- Record the result and any useful diagnostics.
- Keep a failed branch while it needs investigation.
- Drop branches when the task is complete.
- Avoid long chains when several branches can start from the same parent.

CamusDB has two limits today. Changes cannot be merged back into the parent,
and transactions cannot cross branches.

A successful experiment must produce a reviewed migration, script, or
application change, which you apply through the normal delivery process.
