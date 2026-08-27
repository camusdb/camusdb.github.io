---
sidebar_position: 1.6
---

# Recover dropped objects

CamusDB can recover a dropped root database, and a dropped table, during a
configurable window of the retention.

An ordinary `DROP DATABASE` and an ordinary `DROP TABLE` remove the object from
the catalog immediately. Both free the name at once. CamusDB nevertheless keeps
the data below that object as a recoverable orphan, until it reclaims that
orphan.

The feature is a safety net for a catastrophic situation. Three examples are an
accidental `DROP` in production, a wrong script of a cleanup, and a destructive
migration. You handle each one without a restore of a full backup, while CamusDB
still keeps the orphan.

## The quick workflow

Here is a real session of `camus-cli`. It recovers a dropped database:

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

The same pattern applies to a table of the current database:

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

`RELINK TO` takes the id of the orphan. `SHOW ORPHAN TABLES` and `SHOW ORPHAN
DATABASES` both show that id. Treat the id as an opaque string.

## The kind of an orphan table

`SHOW ORPHAN TABLES` has one more column, which has the name `kind`. CamusDB
retains two different things, and they look the same without that column:

| `kind` | What it is | Is `former_name` a live table? |
| --- | --- | --- |
| `dropped table` | A table that somebody dropped. | No. CamusDB freed the name. |
| `retired contents` | One set of contents that a still live table stopped to read, after a [`TRUNCATE`](/docs/truncate-table). | Yes. That table still exists, and it is empty. |

A recovery of `retired contents` publishes the retained rows as a separate new
table, with a fresh id of a relation. The recovery does not affect the table in
`former_name`. See
[TRUNCATE TABLE](/docs/truncate-table#recovery-of-the-previous-contents).

`SHOW ORPHAN DATABASES` has no `kind` column. A dropped database is always a
dropped database.

## What a plain DROP does

A plain drop is deferred, and it is recoverable:

```camussql
DROP DATABASE sales;
DROP TABLE orders;
```

Five things are true after the statement succeeds:

- You can use the name of the database or of the table again, immediately.
- `SHOW DATABASES` and `SHOW TABLES` no longer list the object.
- A query against the dropped object fails, because the object is absent.
- CamusDB keeps the rows, the indexes, the constraints, and the metadata of the
  schema, as an orphan.
- You can recover the orphan under a new name, with a `RELINK TO`.

CamusDB does not reuse the id of an object. You can drop `sales`, and then
create a new database with the same name `sales`. The new database receives a
new id. The old data stays recoverable, under the id of its orphan.

```camussql
DROP DATABASE sales;
CREATE DATABASE sales;

SHOW ORPHAN DATABASES;
CREATE DATABASE sales_before_migration RELINK TO '7';
```

The new database therefore stays online. You recover the previous data at the
same time, under a safe name for the inspection.

## Recover a database

Use `SHOW ORPHAN DATABASES` from any connection. It needs no current database.

```camussql
SHOW ORPHAN DATABASES;
```

The result holds four values: the id of the orphan, its former name, the
timestamp of the drop, and the timestamp of the expiry.

Recover the database. Create a new name, and link it to that id:

```camussql
CREATE DATABASE sales_recovered RELINK TO '7';
USE sales_recovered;
SHOW TABLES;
```

The recovered database holds the retained tables and the retained data. Both
come from the moment of the drop.

## Recover a table

The recovery of a table runs inside the current database. Select the database
that owned the table first. Then inspect the orphan tables:

```camussql
USE sales;
SHOW ORPHAN TABLES;
```

Recover the table under a new name of a table:

```camussql
CREATE TABLE orders_recovered RELINK TO 'A0';
SELECT * FROM orders_recovered LIMIT 10;
```

The recovered table keeps six things from the time of the drop: its rows, its
indexes, its primary key, its unique constraints, its check constraints, and the
definitions of its columns.

## A permanent drop, with FORCE

Use `FORCE` only when CamusDB must delete the object immediately and
permanently:

```camussql
DROP DATABASE staging FORCE;
DROP TABLE scratch FORCE;
DROP DATABASE IF EXISTS old_test FORCE;
DROP TABLE IF EXISTS temp_rows FORCE;
```

A forced drop creates no record of an orphan. The object appears in neither
`SHOW ORPHAN DATABASES` nor `SHOW ORPHAN TABLES`. A `RELINK TO` cannot recover
it.

## The settings of the retention

Two values of the configuration control the time of the recovery:

| Setting | Default | Meaning |
| --- | --- | --- |
| `orphan_retention_ms` | `604800000` | The time that an orphan stays eligible for a recovery, before CamusDB may reclaim it. The default is seven days. A value of `0` or below keeps an orphan without a limit. |
| `orphan_reclaim_interval_ms` | `300000` | The period between two checks of the reclaimer in the background, for an expired orphan. The default is five minutes. A value of `0` or below disables the automatic sweep. |

Here is an example:

```yaml
# Keep dropped databases and tables recoverable for 30 days.
orphan_retention_ms: 2592000000
orphan_reclaim_interval_ms: 300000
```

`SHOW ORPHAN DATABASES` and `SHOW ORPHAN TABLES` show a time of an expiry. That
time is the point at which the object becomes eligible for a reclamation. A
recovery can succeed until CamusDB truly reclaims the object.

## Practical uses

- Recover from an accidental `DROP DATABASE`, or from an accidental `DROP
  TABLE`.
- Undo a script of a migration that dropped the wrong table.
- Bring a previous database back, after a deployment created a new database with
  the same name.
- Restore a table under a temporary name. Use it for an audit, for a comparison,
  or for a forensic analysis.
- Make the cleanup of an operator safer. Use a normal `DROP` first. Use a
  `FORCE` later, only when you are certain that nobody needs the data.

A recovery adds to a backup. It does not replace one. A backup still matters for
three cases: a disaster recovery, a long retention, and the loss of a whole
cluster or of a volume of the storage. A recoverable drop is faster while the
data is still present in the same cluster.

## Limits

A recoverable drop applies to a root database, and to a table of a root
database.

It does not apply to these five objects:

- A dropped column.
- A branch of a database.
- A table that a user dropped inside a branch of a database.
- An object that a user dropped with a `FORCE`.
- An orphan that CamusDB reclaimed after the window of the retention.

A drop of a branch of a database removes that branch immediately. See
[Database Branching](/docs/database-branching) for the details of the life of a
branch.

## Errors

| Error | When it happens |
| --- | --- |
| `CADB0510` `OrphanNotFound` | A `RELINK TO` references an id of an orphan that does not exist, that a user recovered already, or that CamusDB reclaimed. |
| `CADB0012` `DatabaseAlreadyExists` | A `CREATE DATABASE ... RELINK TO` targets a name of a database that exists already. |
| `CADB0013` `TableAlreadyExists` | A `CREATE TABLE ... RELINK TO` targets a name of a table that exists already. |

## Related pages

- [Databases](/docs/databases)
- [Tables And Columns](/docs/sql-schema)
- [Inspecting The Database](/docs/sql-inspection)
- [Configuration](/docs/configuration)
- [Backup And Restore](/docs/backup-and-restore)
- [Error Codes](/docs/error-codes)
