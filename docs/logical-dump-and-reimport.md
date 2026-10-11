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
foreign keys, comments, covering-index included columns, and row-level TTL
settings.

Foreign keys affect load order. A `CREATE TABLE` with a foreign key needs its
parent table to exist, and a child `INSERT` needs its parent row to be loaded.
For a dump with foreign keys, either load parent tables and rows before their
children, or remove the `FOREIGN KEY` clauses from the initial table DDL, load
all rows, and add each constraint afterwards with
`ALTER TABLE ... ADD CONSTRAINT`. The `ADD CONSTRAINT` statement validates the
loaded rows.

Index definitions carry their per-column sort direction and their comment, both
in inline table DDL and in separate `CREATE INDEX` statements. A dump from a
server version that did not report those details cannot recover them later.
Check descending indexes after reimporting from an older dump.

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
camus-dump -e http://db1.internal:5096 --all-databases -b 100 \
  --output-directory /backup/camusdb-old/
```

`--all-databases` asks the server for every database. `-b` controls rows per
`INSERT`. Start with `-b 100`; it avoids one round trip per row without making
statements too large for wide tables.

With authentication enabled, pass credentials through the environment or an
interactive prompt, not through shell history:

```bash
CAMUSDB_PASSWORD=secret camus-dump -e https://db1.internal:5096 \
  --all-databases -u admin -b 100 \
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
2. Databases, tables, indexes, foreign keys, and rows from the dump.
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

## Batch size and deferred indexes

One row per `INSERT` is the slowest restore shape because each row pays its own
round trip and parse. A batch size around 100 rows usually recovers most of the
benefit while keeping statements modest.

Two hard limits still bound the batch:

- The transaction mutation limit. A row costs at least two mutations, plus one
  for each secondary index entry and one for each out-of-line large value.
- The transport message size. gRPC messages are much smaller than HTTP request
  bodies, so wide rows can hit the gRPC limit before they hit the mutation
  limit.

`--defer-indexes` writes each table's secondary `CREATE INDEX` statements after
the row data. It can help when a table has one secondary index. It is not a
free win for tables with several indexes, because the index build scans the
table once per index. Keep the target out of service until every deferred index
has been built and validated.

If the source server is too old to support `SHOW CREATE TABLE ... WITHOUT
INDEXES`, `camus-dump --defer-indexes` warns and cannot truly defer inline
indexes.

## Large values

A logical dump writes each value in full into SQL, regardless of whether CamusDB
stored that value inline, compressed, or out of line. A table with 1 MB values
therefore reaches the gRPC message limit at only a few rows per statement.

A reimported row is written under the current large-value rules. If a value is
stored out of line during reload, it also costs one more mutation for that row.
Use a smaller `--batch` for tables with large `STRING`, `BYTES`/`BLOB`, or
`ARRAY` columns, and see [Large Values](/docs/storage-layout) for the storage
rules and mutation impact.
