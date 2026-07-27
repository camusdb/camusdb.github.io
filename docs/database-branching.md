---
sidebar_position: 1.6
---

# Database Branching

Database branching lets you create an isolated point-in-time clone of an
existing database:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
```

The branch starts with the same schema and data view as the source database at
the fork point, but it does not copy all source rows when it is created. CamusDB
uses copy-on-write branching over the existing storage layer: inherited reads
come from the source snapshot, while writes and schema changes go into the
branch's own private overlay.

This makes branching useful when you want realistic data without risking the
base database:

- create per-feature databases for development and CI
- test schema migrations against production-like data
- reproduce production-only bugs without writing to production
- run destructive experiments and throw the branch away
- give each developer or test run an isolated database clone

CamusDB is still alpha-quality software. Branching describes the intended
workflow and current engine behavior, not a recommendation to run CamusDB as a
production system yet.

## Create A Branch

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

Then branch from it:

```camussql
CREATE DATABASE feature_checkout BRANCH FROM prod;
USE feature_checkout;
```

Use `IF NOT EXISTS` when setup scripts should be idempotent:

```camussql
CREATE DATABASE IF NOT EXISTS feature_checkout BRANCH FROM prod;
```

The target name must not already exist unless `IF NOT EXISTS` is used. The
source database must exist and must not have an in-flight schema change at the
moment the branch is created.

## What A Branch Sees

A branch reads from a lineage:

1. its own private overlay
2. the source database as of the fork timestamp
3. any deeper ancestors, if the source was itself a branch

Nearest data wins. If a row is changed in the branch, reads see the branch
version. If a row is deleted in the branch, the delete hides the inherited
source row. If a row is never touched in the branch, reads fall through to the
source snapshot.

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

Parent changes after the fork are not visible to the branch. Branch changes are
not visible to the parent or to sibling branches.

## Schema Isolation

Branch creation copies the source schema metadata at the fork point. After that:

- DDL on the parent is invisible to the branch.
- DDL on the branch is invisible to the parent and siblings.
- Branch `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` operate in the
  branch namespace.
- Branch `DROP TABLE` and `DROP INDEX` remove branch-local metadata and overlay
  data without scanning and deleting inherited source rows.

This lets developers try migrations and feature-specific tables against a
realistic starting point:

```camussql
CREATE DATABASE migration_test BRANCH FROM prod;
USE migration_test;

ALTER TABLE orders ADD COLUMN audit_note STRING;
CREATE INDEX orders_status_idx ON orders (status);
```

If the migration is wrong, drop the branch and create a fresh one.

## Constraints And Writes

Writes in a branch only affect that branch, but uniqueness checks still consider
the branch plus its inherited data. If the source snapshot contains a primary
key or unique index value, inserting the same value in the branch conflicts
unless the branch first deletes that inherited row.

This keeps branch behavior close to a real database clone instead of treating
the source as loose seed data.

Transactions still run inside one database. A transaction can operate on
`prod` or on `feature_checkout`, but not across both databases at once.

## Drop Branches

Drop a branch the same way you drop any database:

```camussql
DROP DATABASE feature_checkout;
```

A database that still has live branch descendants cannot be dropped. Drop
descendants first, from leaves back toward the root:

```camussql
DROP DATABASE feature_checkout_repro;
DROP DATABASE feature_checkout;
DROP DATABASE prod;
```

Dropping a branch releases the retention hold that kept its source snapshot
readable. Branch drops are immediate and are not recoverable with
`CREATE DATABASE ... RELINK TO`. Recoverable drops apply to root databases and
tables in root databases; see [Recover Dropped Objects](/docs/recover-dropped-objects).

## Inspect Branches

Use `SHOW BRANCHES` and `SHOW ANCESTORS` to inspect branch relationships from
SQL. These are server-level statements, so they do not require a current
database context.

```camussql
SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW BRANCHES FROM <database>` returns every descendant of the named database.
Direct branches have depth `1`; branches of those branches have depth `2`, and
so on. Results are ordered by depth and then by database name.

| Column | Meaning |
| --- | --- |
| `database` | Descendant database name. |
| `id` | Stable internal database id for the descendant. |
| `depth` | Distance from the source database. |
| `parent` | Immediate parent database name. |
| `fork_timestamp` | Hybrid logical clock timestamp when the descendant was forked from its parent. |

`SHOW ANCESTORS FROM <database>` returns the ancestry chain for the named
database, starting with the immediate parent and walking back toward the root.
A root database returns an empty result set.

| Column | Meaning |
| --- | --- |
| `database` | Ancestor database name. |
| `id` | Stable internal database id for the ancestor. |
| `depth` | Distance from the queried database. |
| `fork_timestamp` | Hybrid logical clock timestamp for the fork below this ancestor. |

For example:

```camussql
CREATE DATABASE prod;
CREATE DATABASE feature_checkout BRANCH FROM prod;
CREATE DATABASE checkout_repro BRANCH FROM feature_checkout;

SHOW BRANCHES FROM prod;
SHOW ANCESTORS FROM checkout_repro;
```

This makes it easier to find leaf branches before dropping a parent, understand
how deep a branch chain has become, and confirm which source snapshot a branch
depends on.

## How It Works

Every database has a stable internal storage id. A root database has no
ancestors. A branch records the source database id and the hybrid logical clock
timestamp at which it was forked.

At branch creation time, CamusDB:

- creates a new database id for the branch
- records the branch ancestry
- pins the source snapshot so inherited reads remain valid
- copies schema metadata as of the fork timestamp
- publishes the branch as an ordinary database name

Rows and index entries are not copied during branch creation. Reads merge the
branch overlay with ancestor snapshots. Writes, deletes, and new schema objects
go only into the branch namespace.

## Operational Notes

Snapshot retention is the main operational cost. A live branch keeps the
source's fork-time history readable, so many long-lived branches over a hot
source can hold back storage reclamation.

CamusDB keeps each live branch's parent snapshot hold renewed in the
background. The renewer scans the persistent branch registry, so a branch
created on one node can still be renewed by the node that currently owns the
registry work. Renaming a branch preserves that hold, and dropping the branch
releases it.

The lease window is controlled by `branch_snapshot_hold_lease_ms` in
[Configuration](/docs/configuration). The default is 300,000 milliseconds, or
5 minutes.

In cluster mode, CamusDB fences parent drops against concurrent branch creation.
If the fence cannot be acquired or its state is indeterminate, the drop fails
closed with a retryable error instead of purging a parent while another node may
be publishing a branch.

Watch the Kahuna snapshot-floor metrics when branches are used heavily:

| Metric | Meaning |
| --- | --- |
| `kahuna.snapshot_floor.live_holds` | Number of live snapshot holds. A steady increase usually means branches are not being dropped. |
| `kahuna.snapshot_floor.effective_floor_ms` | How far back the oldest hold pins history. |
| `kahuna.snapshot_floor.missing_protected_version_total` | Should stay `0`; a non-zero value means protected history was reclaimed. |

Deep branch chains also add read work because CamusDB may probe one level per
ancestor. Prefer short-lived branches for development, test, and debugging
workflows until compaction or rebase features exist.

## Current Limits

Database branching does not currently include:

- merge-back into the parent
- cross-branch transactions
- automatic branch compaction or rebase
- reparenting descendants when a parent is dropped
- a hard maximum branch depth

The feature is intended for isolated development, testing, migration rehearsal,
and issue reproduction workflows where branches can be dropped when they are no
longer needed.

## Error Codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | The source database does not exist, or it was dropped while the branch was being created. |
| `CADB0012` | `DatabaseAlreadyExists` | The target branch name already exists and `IF NOT EXISTS` was not used. |
| `CADB0400` | `InvalidInput` | The source has in-flight schema changes, the snapshot hold cannot be acquired, or another branch/drop precondition fails. |
| `CADB0508` | `DatabaseHasLiveDescendants` | A database is dropped while it still has live branch descendants. |

## Related Pages

- [Databases](/docs/databases)
- [SQL](/docs/sql)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Storage](/docs/storage)
- [Error Codes](/docs/error-codes)
