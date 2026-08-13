---
sidebar_position: 1.6
---

# Recover Dropped Objects

CamusDB can recover dropped root databases and tables during a configurable
retention window. A normal `DROP DATABASE` or `DROP TABLE` immediately removes
the object from the catalog and frees the name, but the underlying data is kept
as a recoverable orphan until it is reclaimed.

This is a safety net for catastrophic situations: an accidental production
`DROP`, a bad cleanup script, or a destructive migration can be handled without
starting from a full backup restore, as long as the orphan is still retained.

## Quick Workflow

Here is a real `camus-cli` session recovering a dropped database:

```camussql
camus>  show databases
┌──────────┐
│ Database │
├──────────┤
│ test     │
└──────────┘
1 rows in set (00:00:00.0712674)

camus>  drop database test
Query OK, 0 rows affected (00:00:00.1203752)

camus>  use test
Database changed to test

camus>  show orphan databases
┌────┬─────────────┬────────────────────────┬────────────────────────┐
│ id │ former_name │ dropped_at             │ expires_at             │
├────┼─────────────┼────────────────────────┼────────────────────────┤
│ I  │ test        │ HLC(1:1784427365296:2) │ HLC(1:1785032165296:2) │
└────┴─────────────┴────────────────────────┴────────────────────────┘
1 rows in set (00:00:00.0135411)

camus>  create database test relink to 'I'
Query OK, 0 rows affected (00:00:00.0442229)

camus>  use test
Database changed to test

camus>  show tables
┌─────────────────┐
│ tables          │
├─────────────────┤
│ orders_restored │
│ orders          │
└─────────────────┘
2 rows in set (00:00:00.0036480)
```

The same pattern applies to tables inside the current database:

```camussql
camus>  show tables
┌─────────────────┐
│ tables          │
├─────────────────┤
│ orders_restored │
│ orders          │
└─────────────────┘
2 rows in set (00:00:00.0036480)

camus>  drop table orders
Query OK, 0 rows affected (00:00:00.0926457)

camus>  show orphan tables
┌────┬─────────────┬────────────────────────┬────────────────────────┐
│ id │ former_name │ dropped_at             │ expires_at             │
├────┼─────────────┼────────────────────────┼────────────────────────┤
│ s6 │ orders      │ HLC(1:1784427567387:0) │ HLC(1:1785032367387:0) │
└────┴─────────────┴────────────────────────┴────────────────────────┘
1 rows in set (00:00:00.0068052)

camus>  create table orders relink to 's6'
Query OK, 0 rows affected (00:00:00.0655702)

camus>  desc orders
┌───────┬────────────┬──────┬─────┬──────────┬───────┐
│ Field │ Type       │ Null │ Key │ Default  │ Extra │
├───────┼────────────┼──────┼─────┼──────────┼───────┤
│ id    │ OID        │ NO   │ PRI │ gen_id() │       │
│ name  │ STRING(20) │ YES  │     │ NULL     │       │
└───────┴────────────┴──────┴─────┴──────────┴───────┘
2 rows in set (00:00:00.0073021)
```

`RELINK TO` uses the orphan id shown by `SHOW ORPHAN TABLES` or
`SHOW ORPHAN DATABASES`. Treat the id as an opaque string.

## What Plain DROP Does

A plain drop is deferred and recoverable:

```camussql
DROP DATABASE sales;
DROP TABLE orders;
```

After the statement succeeds:

- the database or table name is immediately free to reuse
- `SHOW DATABASES` or `SHOW TABLES` no longer lists the object
- queries against the dropped object fail as missing
- rows, indexes, constraints, and schema metadata are retained as an orphan
- the orphan can be recovered under a new name with `RELINK TO`

Object ids are not reused. If you drop `sales` and then create a new database
also named `sales`, the new database gets a new id and the old data remains
recoverable under its orphan id.

```camussql
DROP DATABASE sales;
CREATE DATABASE sales;

SHOW ORPHAN DATABASES;
CREATE DATABASE sales_before_migration RELINK TO '7';
```

This lets you keep the new database online while recovering the previous data
under a safe inspection name.

## Recover A Database

Use `SHOW ORPHAN DATABASES` from any connection. It does not require a current
database context.

```camussql
SHOW ORPHAN DATABASES;
```

The result includes the orphan id, former name, drop timestamp, and expiration
timestamp. Recover the database by creating a new name linked to that id:

```camussql
CREATE DATABASE sales_recovered RELINK TO '7';
USE sales_recovered;
SHOW TABLES;
```

The recovered database contains the retained tables and data from the moment it
was dropped.

## Recover A Table

Table recovery runs inside the current database. First select the database that
owned the table, then inspect table orphans:

```camussql
USE sales;
SHOW ORPHAN TABLES;
```

Recover the table under a new table name:

```camussql
CREATE TABLE orders_recovered RELINK TO 'A0';
SELECT * FROM orders_recovered LIMIT 10;
```

The recovered table keeps its rows, indexes, primary key, unique constraints,
check constraints, and column definitions from the time it was dropped.

## Permanent Drop With FORCE

Use `FORCE` only when the object should be deleted immediately and permanently:

```camussql
DROP DATABASE staging FORCE;
DROP TABLE scratch FORCE;
DROP DATABASE IF EXISTS old_test FORCE;
DROP TABLE IF EXISTS temp_rows FORCE;
```

A forced drop does not create an orphan record, does not appear in
`SHOW ORPHAN DATABASES` or `SHOW ORPHAN TABLES`, and cannot be recovered with
`RELINK TO`.

## Retention Settings

Two configuration values control how long dropped objects remain recoverable:

| Setting | Default | Meaning |
| --- | --- | --- |
| `orphan_retention_ms` | `604800000` | How long an orphan remains eligible for recovery before it may be reclaimed. The default is seven days. `0` or a negative value keeps orphans indefinitely. |
| `orphan_reclaim_interval_ms` | `300000` | How often the background reclaimer checks for expired orphans. The default is five minutes. `0` or a negative value disables the automatic sweep. |

Example:

```yaml
# Keep dropped databases and tables recoverable for 30 days.
orphan_retention_ms: 2592000000
orphan_reclaim_interval_ms: 300000
```

The expiration time shown by `SHOW ORPHAN DATABASES` and `SHOW ORPHAN TABLES`
is the point when the object becomes eligible for reclamation. Recovery can
succeed until the object is actually reclaimed.

## Practical Use Cases

- Recover from an accidental `DROP DATABASE` or `DROP TABLE`.
- Undo a migration script that dropped the wrong table.
- Bring back a previous database after a deployment created a new database with
  the same name.
- Restore a table under a temporary name for audit, comparison, or forensic
  analysis.
- Make operational cleanup safer: use normal `DROP` first, then use `FORCE`
  later only when you are certain the data is no longer needed.

Recovery complements backups. Backups are still important for disaster recovery,
long-term retention, and cases where the whole cluster or storage volume is
lost. Recoverable drops are faster when the data is still present in the same
cluster.

## Limits

Recoverable drops apply to root databases and tables in root databases.

They do not apply to:

- dropped columns
- branch databases
- tables dropped inside branch databases
- objects dropped with `FORCE`
- orphans already reclaimed after the retention window

Dropping a branch database removes the branch immediately. See
[Database Branching](/docs/database-branching) for branch lifecycle details.

## Errors

| Error | When it happens |
| --- | --- |
| `CADB0510` `OrphanNotFound` | `RELINK TO` references an orphan id that does not exist, was already recovered, or was reclaimed. |
| `CADB0012` `DatabaseAlreadyExists` | `CREATE DATABASE ... RELINK TO` targets a database name that already exists. |
| `CADB0013` `TableAlreadyExists` | `CREATE TABLE ... RELINK TO` targets a table name that already exists. |

## Related Pages

- [Databases](/docs/databases)
- [Tables And Columns](/docs/sql-schema)
- [Inspecting The Database](/docs/sql-inspection)
- [Configuration](/docs/configuration)
- [Backup And Restore](/docs/backup-and-restore)
- [Error Codes](/docs/error-codes)
