---
sidebar_position: 1.6
---

# Database branching

A branch of a database is an isolated clone of an existing database, at a point
in time:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
```

The branch starts with the same schema and the same view of the data as the
source database, at the point of the fork. It copies no row of the source at its
creation.

CamusDB uses a branch with a copy at the first write, over the existing layer of
the storage. An inherited read comes from the snapshot of the source. A write
and a change of the schema go into the private overlay of the branch.

A branch is therefore useful when you want realistic data, and no risk to the
base database. Five uses are common:

- Create one database for each feature, for development and for CI.
- Test a migration of a schema against data that is like the data of production.
- Reproduce a defect that appears in production only. You write nothing to
  production.
- Run a destructive experiment. Then discard the branch.
- Give an isolated clone of a database to each developer, and to each run of a
  test.

CamusDB is in production use. A branch is nevertheless an alpha feature. The
APIs and the storage formats can change between versions.

## Create a branch

Create the source database first:

```camussql
CREATE DATABASE prod;
USE prod;

CREATE TABLE orders (
  id OID PRIMARY KEY,
  status STRING,
  total FLOAT64
);
```

Then create a branch from it:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
USE feature_checkout;
```

Use `IF NOT EXISTS` when a script of a setup must be safe to repeat:

```camussql
CREATE DATABASE IF NOT EXISTS feature_checkout BRANCH FROM prod;
```

The name of the target must not exist already, unless you use `IF NOT EXISTS`.

The source database must exist. It must also hold no change of its schema in
flight, at the moment of the creation of the branch.

## What a branch sees

A branch reads from a line of ancestors:

1. Its own private overlay.
2. The source database, as of the timestamp of the fork.
3. Every deeper ancestor, when the source was itself a branch.

The nearest data wins:

- A read sees the version of the branch, after a change of a row in the branch.
- A delete in the branch hides the inherited row of the source.
- A read falls through to the snapshot of the source, for a row that the branch
  never touched.

```camussql
USE prod;
INSERT INTO orders VALUES (GEN_ID(), "paid", 120.50);

CREATE DATABASE bug_repro BRANCH FROM prod;
USE bug_repro;

-- Reads inherited rows from prod at the fork point.
SELECT * FROM orders;

-- This write is private to bug_repro.
UPDATE orders SET status = "refunded" WHERE status = "paid";

-- prod is unchanged.
USE prod;
SELECT * FROM orders;
```

A change of the parent after the fork is invisible to the branch. A change of
the branch is invisible to the parent, and to a branch beside it.

## The isolation of the schema

The creation of a branch copies the metadata of the schema of the source, at the
point of the fork. After that moment, four rules apply:

- A DDL statement on the parent is invisible to the branch.
- A DDL statement on the branch is invisible to the parent, and to a branch
  beside it.
- A `CREATE TABLE`, an `ALTER TABLE`, and a `CREATE INDEX` of the branch operate
  in the namespace of the branch.
- A `DROP TABLE` and a `DROP INDEX` of the branch remove the local metadata and
  the data of the overlay. Neither one scans and deletes an inherited row of the
  source.

A developer can therefore try a migration, and a table for one feature, against
a realistic start:

```camussql
CREATE DATABASE migration_test BRANCH FROM prod;
USE migration_test;

ALTER TABLE orders ADD COLUMN audit_note STRING;
CREATE INDEX orders_status_idx ON orders (status);
```

Drop the branch when the migration is wrong. Then create a fresh branch.

## Constraints, and a write

A write in a branch affects that branch only. A check of the uniqueness
nevertheless covers the branch, together with its inherited data.

The snapshot of the source can hold a value of a primary key, or of a unique
index. An insert of the same value in the branch then conflicts. The branch must
first delete that inherited row.

That behavior keeps a branch near a true clone of a database. CamusDB does not
treat the source as loose data of a seed.

A transaction still runs inside one database. A transaction can operate on
`prod`, or on `feature_checkout`. It cannot operate on both databases together.

## A truncate in a branch

The rows of a table in a branch are the overlay of the branch merged with the
rows of its ancestors. Each level uses the same id of the storage. A
[`TRUNCATE`](/docs/truncate-table) therefore has a total meaning in a branch.

| Action | Effect |
| --- | --- |
| A truncate in a branch | CamusDB gives the branch a new id of the storage. The view of the branch becomes empty. Its overlay disappears from that branch, and so do the rows that it inherits. |
| A recovery in a branch | CamusDB reconstructs the whole merged view of the branch before the truncate, under a new name of a table. |
| The reclamation | CamusDB scopes the reclamation to the id of the database of the branch. It never deletes a key of an ancestor. |
| A truncate of the source | A truncate of the source after a fork does not rewrite the copied schema of the descendant. The descendant keeps its forked contents. |

A truncate in a branch deletes nothing at once. The overlay becomes retired
contents, and CamusDB never touches the rows of the ancestor.

## Drop a branch

Drop a branch as you drop any database:

```camussql
DROP DATABASE feature_checkout;
```

You cannot drop a database with a live descendant branch. Drop the descendants
first, from the leaves back toward the root:

```camussql
DROP DATABASE feature_checkout_repro;
DROP DATABASE feature_checkout;
DROP DATABASE prod;
```

The drop of a branch releases the hold of the retention. That hold kept the
snapshot of the source readable.

A drop of a branch is immediate. `CREATE DATABASE ... RELINK TO` cannot recover
it. A recoverable drop covers a root database, and a table of a root database.
See [Recover Dropped Objects](/docs/recover-dropped-objects).

## Inspect the branches

Use `SHOW BRANCHES` and `SHOW ANCESTORS` to inspect the relations of the
branches, from SQL. Both are statements at the level of the server. Neither one
needs a current database.

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES FROM <database>` returns every descendant of the named database.
A direct branch has the depth `1`. A branch of such a branch has the depth `2`,
and so on. CamusDB orders the result by the depth, and then by the name of the
database.

| Column | Meaning |
| --- | --- |
| `database` | The name of the descendant database. |
| `id` | The stable internal id of the descendant database. |
| `depth` | The distance from the source database. |
| `parent` | The name of the immediate parent database. |
| `fork_timestamp` | The timestamp of the hybrid logical clock at the fork of the descendant from its parent. |

`SHOW ANCESTORS FROM <database>` returns the chain of the ancestors of the named
database. It starts with the immediate parent. It then walks back toward the
root. A root database returns an empty result.

| Column | Meaning |
| --- | --- |
| `database` | The name of the ancestor database. |
| `id` | The stable internal id of the ancestor database. |
| `depth` | The distance from the database of the query. |
| `fork_timestamp` | The timestamp of the hybrid logical clock, for the fork below this ancestor. |

Here is an example:

```camussql
CREATE DATABASE prod;
CREATE DATABASE feature_checkout BRANCH FROM prod;
CREATE DATABASE checkout_repro BRANCH FROM feature_checkout;

SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM checkout_repro;
```

Those two statements make three tasks easier. You find the leaf branches before
a drop of a parent. You see the depth of a chain of branches. You confirm the
snapshot of the source that a branch depends on.

## How it works

Every database has a stable internal id in the storage. A root database has no
ancestor. A branch records two values: the id of the source database, and the
timestamp of the hybrid logical clock at its fork.

At the creation of a branch, CamusDB does five things:

1. It creates a new id of a database, for the branch.
2. It records the ancestors of the branch.
3. It pins the snapshot of the source. An inherited read therefore stays valid.
4. It copies the metadata of the schema, as of the timestamp of the fork.
5. It publishes the branch as an ordinary name of a database.

CamusDB copies no row and no entry of an index during the creation of a branch.
A read merges the overlay of the branch with the snapshots of its ancestors. A
write, a delete, and a new object of a schema all go into the namespace of the
branch only.

## Notes for an operator

The retention of a snapshot is the main cost of the operation. A live branch
keeps the history of its source at the time of the fork readable. Many long
branches over a busy source can therefore hold the reclamation of the storage
back.

CamusDB renews the hold on the snapshot of the parent of each live branch, in
the background. The renewer scans the persistent registry of the branches. One
node can therefore renew a branch that another node created. That renewer is the
node that owns the work of the registry at that moment.

A rename of a branch preserves the hold. A drop of the branch releases it.

`branch_snapshot_hold_lease_ms` controls the window of the lease. See
[Configuration](/docs/configuration). The default is 300,000 milliseconds, which
is 5 minutes.

In cluster mode, CamusDB fences a drop of a parent against a concurrent creation
of a branch. The fence can fail to acquire, and its state can be indeterminate.
The drop then fails closed, with a retryable error. CamusDB does not purge a
parent while another node may publish a branch.

Watch the metrics of the floor of the snapshot in Kahuna, when your workload
uses many branches:

| Metric | Meaning |
| --- | --- |
| `kahuna.snapshot_floor.live_holds` | The number of the live holds on a snapshot. A steady increase usually means that nobody drops the branches. |
| `kahuna.snapshot_floor.effective_floor_ms` | The distance into the past that the oldest hold pins the history. |
| `kahuna.snapshot_floor.missing_protected_version_total` | It must stay at `0`. A value above zero means that CamusDB reclaimed protected history. |

A deep chain of branches also adds work to a read. CamusDB may probe one level
for each ancestor. Prefer a short branch for development, for a test, and for a
debug workflow. That advice holds until a feature of a compaction or of a rebase
exists.

## The current limits

A branch of a database does not include five features today:

- A merge back into the parent.
- A transaction across two branches.
- An automatic compaction of a branch, and an automatic rebase.
- A new parent for a descendant, after a drop of its parent.
- A hard maximum for the depth of a branch.

The feature serves four workflows: an isolated development, a test, a rehearsal
of a migration, and the reproduction of a problem. You can drop a branch of any
of those when you no longer need it.

## Error codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | The source database does not exist. A user also dropped it during the creation of the branch. |
| `CADB0012` | `DatabaseAlreadyExists` | The name of the target branch exists already, and the statement holds no `IF NOT EXISTS`. |
| `CADB0400` | `InvalidInput` | The source holds a change of its schema in flight. CamusDB also cannot acquire the hold on the snapshot. Another precondition of a branch or of a drop also fails. |
| `CADB0508` | `DatabaseHasLiveDescendants` | A `DROP DATABASE` targets a database with a live descendant branch. |

## Related pages

- [Databases](/docs/databases)
- [SQL](/docs/sql)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Storage](/docs/storage)
- [Error Codes](/docs/error-codes)
