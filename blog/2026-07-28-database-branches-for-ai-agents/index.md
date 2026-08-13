---
slug: database-branches-for-ai-agents
title: When Every Experiment Needs Its Own Database
date: 2026-07-28
authors: [andresgutierrez]
tags: [camusdb, database-branching, ai-agents]
---

# When Every Experiment Needs Its Own Database

Software is starting to work at a different rhythm.

A developer may test one idea at a time, but an AI agent can explore several
possible solutions in parallel. One path may try a schema migration. Another
may rewrite some data. A third may reproduce a bug using a different sequence
of events.

Each path needs a database that feels real, but none of them should be allowed
to damage the shared starting point.

This is where database branching becomes more than a convenient development
feature. It becomes a practical way to give every experiment a safe place to
work.

<!-- truncate -->

## One Starting Point, Many Possible Futures

Imagine that an agent is asked to improve an online store's checkout flow. It
may need to add a column, update existing orders, create an index, and test how
the application behaves with the new structure.

There is rarely only one possible solution. The agent might want to compare
three approaches:

- Add a new status to the current table.
- Move payment details into a separate table.
- Keep the schema and change only the application logic.

If all three approaches use the same database, they will interfere with one
another. A migration from the first attempt may break the second. Test data
from the second may change the result of the third. When something fails, it
becomes difficult to tell which action caused the problem.

The usual response is to create separate databases or restore the same backup
several times. That can work, but it adds time and operational work. The cost
becomes much more visible when experiments are created by software, not only by
people.

An agent that can explore ten ideas should not spend most of its time waiting
for ten full database copies.

## A Branch Is A Private Timeline

A database branch starts from a known moment in another database. At the
beginning, it sees the same schema and data. After that, it follows its own
path.

Changes in the branch stay in the branch:

- New rows do not appear in the parent database.
- Updates do not replace the parent's values.
- Deletes do not remove the parent's rows.
- Schema changes do not alter the parent's structure.

This gives each experiment a private timeline. The agent can make bold changes
because the original database remains untouched.

The idea is similar to working on a separate code branch, but data introduces
its own challenges. A database is often much larger than a source repository,
and it changes while applications are running. Creating a branch must preserve
a consistent view without turning every experiment into a full copy of all
stored rows.

## Why Creation Time Matters

Branching is useful only when it is cheap enough to become part of the normal
workflow.

If creating an isolated environment takes several minutes, an agent will avoid
doing it frequently. It may reuse an old test database, perform fewer
experiments, or place several tasks in the same environment. All of those
choices reduce isolation.

When branches can be created quickly, the safer option also becomes the
simpler option. A system can create a fresh branch for every task, attempt, or
test run. Failed branches can be inspected and then removed. Successful
branches can provide evidence for the next step.

Creation time also affects parallel work. Suppose one task explores eight
possible changes. The database should not become the slow gate in front of
those eight workers. The value comes from allowing them to start from the same
state and move independently.

In other words, branch speed is not just about saving a few seconds. It
determines whether branching is an occasional manual action or a basic building
block for automated work.

## The Explore, Evaluate, Discard Loop

Many agent workflows follow a simple pattern:

1. Start from a known state.
2. Create one or more isolated paths.
3. Make a different change in each path.
4. Run checks and compare the results.
5. Keep the useful information and discard the temporary environments.

The database needs to support this loop without making every round expensive.

Consider an agent investigating a production-only bug. It can create several
branches from the same point in time. In one branch, it changes an order's
status. In another, it removes a related payment record. In a third, it applies
a proposed schema fix. Because every branch has the same starting point, the
results are easier to compare.

This approach is also useful for:

- Rehearsing migrations against realistic data.
- Testing data repair scripts before approval.
- Comparing alternative indexing strategies.
- Generating test cases that modify the database.
- Running destructive checks in disposable environments.

The important part is not that an agent can write SQL. The important part is
that it can try, observe, and fail without leaving a confusing trail in a
shared database.

## How CamusDB Approaches Branching

CamusDB creates an isolated, point-in-time branch with SQL:

```camussql
CREATE DATABASE checkout_attempt BRANCH FROM prod;
```

The new database begins with the schema and data view from `prod` at the fork
point. CamusDB does not copy every source row when the branch is created.
Instead, inherited reads use the source snapshot, while new writes and schema
changes go into a private overlay owned by the branch.

That copy-on-write model is important. A branch can begin from a large,
realistic database without first duplicating all of its contents. Storage grows
as the branch diverges, not simply because the branch exists.

For example, two experiments can start from the same database:

```camussql
CREATE DATABASE checkout_schema_test BRANCH FROM prod;
CREATE DATABASE checkout_data_repair BRANCH FROM prod;
```

The first branch can test a migration:

```camussql
USE checkout_schema_test;

ALTER TABLE orders ADD COLUMN payment_reference STRING;
CREATE INDEX orders_payment_reference_idx
ON orders (payment_reference);
```

The second can test a data change:

```camussql
USE checkout_data_repair;

UPDATE orders
SET status = "review"
WHERE status = "payment_unknown";
```

Neither experiment changes `prod`, and neither branch can see the other
branch's work.

## Isolation Makes Results Easier To Trust

Parallel execution is only helpful when the results remain understandable.

When several workers share one mutable database, a successful test may depend
on data created by another worker. A failed test may be caused by an unrelated
migration. Retrying the same task can produce a different answer because the
starting state has already changed.

Branches reduce this uncertainty. Each attempt has a clear parent and a clear
fork point. That makes the database state part of the experiment's identity.
If an attempt fails, the branch can remain available for inspection. A
developer can query it, examine its schema, and follow the exact state that
produced the failure.

This is valuable for people as well as agents. Automation should not turn a
failure into a mystery. It should leave behind enough context for someone to
understand what happened.

CamusDB provides `SHOW BRANCHES` and `SHOW ANCESTORS` to inspect these
relationships:

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM checkout_schema_test;
```

These commands help answer simple but important questions: Which experiments
still exist? Where did a branch come from? How deep is its history?

## Disposable Does Not Mean Careless

Temporary branches still have a cost.

A live CamusDB branch keeps its source snapshot available, so old history
cannot always be reclaimed while the branch depends on it. Deep chains also
require more work during reads because the database may need to check several
ancestors.

For automated workflows, a good rule is to keep branches focused and
short-lived:

- Create a branch for a specific task.
- Record the result and any useful diagnostics.
- Keep failed branches only when they need investigation.
- Drop branches when the task is complete.
- Avoid long chains when several branches can start from the same parent.

This lifecycle matters at scale. Fast creation should be matched by clear
cleanup.

CamusDB also has an important limit today: branches are isolated workspaces,
not a merge system. Changes cannot currently be merged back into the parent,
and transactions cannot cross branches. A successful experiment should
produce a reviewed migration, script, or application change that can be
applied through the normal delivery process.

That boundary is useful for safety. An experimental branch is evidence, not
automatic permission to change the main database.

## A Better Default For Automated Work

As software takes on more independent tasks, databases need to support more
than one shared present. They need to represent several possible futures at the
same time.

Database branching offers a clean model:

- The parent is the trusted starting point.
- Each branch is an isolated proposal.
- Tests decide which proposal is useful.
- Unsuccessful paths can be removed without repairing the parent.

For newcomers, the main idea is simple: give every experiment its own database
view, and make that view cheap enough to use by default.

This is the direction CamusDB is exploring with copy-on-write branches. The
feature is still evolving, like the rest of the project, but it already
captures an important principle: safe experimentation should be part of the
database itself, not a fragile process built around it.

When creating a clean starting point is easy, both developers and agents can
move faster without giving up control.
