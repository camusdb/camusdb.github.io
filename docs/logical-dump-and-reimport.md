---
sidebar_position: 8.15
---

# Logical dump and reimport

Use a logical dump and reimport when data must cross CamusDB storage revisions,
or when you want to copy a server into a fresh environment through SQL instead
of through a physical backup.

## Why this is needed

CamusDB stores rows, indexes, schema metadata, transaction state, and recovery
state in the storage layer. Some releases can change that physical layout. A
storage revision is the compatibility boundary for those on-disk structures.

CamusDB does not rewrite a previous revision in place. A newer server opens its
own revision directory under `data_dir` and leaves older revision directories
untouched. Move data across revisions with [`camus-dump`](/docs/camus-dump) and
[`camus-cli`](/docs/camus-cli).

## What a dump carries

`camus-dump` writes SQL for databases, tables, indexes, and rows. The table DDL
comes from `SHOW CREATE TABLE`, so it carries defaults, check constraints,
comments, covering-index included columns, and row-level TTL settings.

Record and recreate these objects separately:

| Object | Before the move | After the reimport |
| --- | --- | --- |
| Views | `SHOW VIEWS` and `SHOW CREATE VIEW name` | Run the printed `CREATE VIEW`. |
| Materialized views | `SHOW MATERIALIZED VIEWS` and `SHOW CREATE MATERIALIZED VIEW name` | Run the printed statement, then refresh it. |
| Users | `SHOW USERS`, as a superuser. Passwords are not exported. | Run `CREATE USER`. |
| Grants | `SHOW GRANTS FOR *`, as a superuser | Run the matching `GRANT` statements. |
| Cluster settings | `SHOW VARIABLES`, keeping non-default values | Run `SET CLUSTER SETTING`. |
| Table statistics | Nothing to record | Run `ANALYZE` after the load. |
| Physical backups | Nothing to record | Take a fresh full backup after the load. |

A branch is dumped as the full database view that the branch can read. The
reimported copy is an independent database, not a copy-on-write branch of the
original parent.

A storage revision move starts the new server with a fresh user catalog. Accounts,
grants, and sessions live in the same storage revision as the rows, so record
accounts and grants before the move with `SHOW USERS` and `SHOW GRANTS FOR *`.
Passwords cannot be exported; plan to set a new password for each account after
the reimport.

## Dump

Run the dump before upgrading, or run the previous CamusDB version against the
old revision directory:

```bash
camus-dump -e http://db1.internal:5096 --all-databases -b 500 --defer-indexes \
  --output-directory /backup/camusdb-old/
```

`--all-databases` asks the server for every database. `-b` controls rows per
`INSERT`. `--defer-indexes` creates secondary indexes after rows load, so the
load does not maintain every index row by row.

With authentication enabled, pass credentials through the environment or an
interactive prompt, not through shell history:

```bash
CAMUSDB_PASSWORD=secret camus-dump -e https://db1.internal:5096 \
  --all-databases -u admin --defer-indexes \
  --output-directory /backup/camusdb-old/
```

Keep row counts for verification:

```bash
camus-cli -c "Endpoint=http://db1.internal:5095;Database=shop" \
  -e "SELECT COUNT(*) FROM orders"
```

## Reimport

Start the new CamusDB version on the target `data_dir`. If authentication is
enabled, bootstrap a superuser as described in
[Authentication And Authorization](/docs/sql-authentication), because the user
catalog lives in the old storage revision too.

Import each dump file with `camus-cli`:

```bash
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" \
  -f /backup/camusdb-old/shop.sql
```

Load supporting objects in this order:

1. Users.
2. Databases, tables, indexes, and rows from the dump.
3. Views and materialized views.
4. Grants.
5. Cluster settings.
6. `ANALYZE` for each table.

If a load fails partway through, fix the cause, drop the partly loaded database,
and run the file again. `CREATE DATABASE IF NOT EXISTS` can be repeated, but
`INSERT` statements are not idempotent.

## Verify

After the load:

```camussql
SHOW DATABASES;
SHOW TABLES;
SHOW INDEXES FROM orders;
SELECT COUNT(*) FROM orders;
```

Compare row counts with the old server. Spot-check important queries and
indexes before directing application traffic to the new server.

Take a fresh full [physical backup](/docs/backup-and-restore) after verification.
Only then remove old revision directories from every node.
