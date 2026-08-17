---
sidebar_position: 7.3
---

# camus-dump

`camus-dump` is a logical backup utility for CamusDB. It connects to a
database, reads schema metadata and rows, and writes SQL that can be replayed
later through `camus-cli` or another CamusDB SQL client.

Use it when you want an inspectable SQL backup, a table-level export, or a
consistent logical snapshot of a database.

The dump is consistent across tables by default: it fixes one instant when it
starts and reads every table as of that instant. See
[Point In Time](#point-in-time) before turning that off.

## Not For Large Databases

`camus-dump` is not the right tool for a database of dozens or hundreds of
gigabytes. Use [Backup And Restore](/docs/backup-and-restore) for anything at
that scale.

Every row travels through the SQL layer and comes back out as text, so both ends
scale with row count rather than bytes on disk. The dump runs slower than the
disk it is reading, and the SQL file is typically larger than the data it came
from.

The restore is the harder half. Replaying a dump means parsing every statement,
re-checking every constraint, and rebuilding every index from scratch: hours or
days of work where a physical restore is a file copy plus a WAL replay. A dump
that takes a long night to produce can take considerably longer to put back,
which is precisely the wrong shape for a recovery path.

Reach for `camus-dump` when the output being readable, portable SQL is the
point, and for datasets small enough that replaying them is quick. Reach for a
physical backup when the point is getting the data back.

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.Dump
```

The executable name is:

```bash
camus-dump
```

## Basic Usage

Dump a database to standard output:

```bash
camus-dump --endpoint http://localhost:5096 --database factory
```

Dump one table, group 100 rows per `INSERT`, and write to a file:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --table orders \
  --batch 100 \
  --output orders.sql
```

Dump the database as it was five minutes ago, replayable onto an existing
schema:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --as-of -5m \
  --if-not-exists \
  --output factory.sql
```

Dump every database on the server, one file each:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --all-databases \
  --output-directory backup/
```

By default, `camus-dump` uses the gRPC protocol and `http://localhost:5096`,
which is CamusDB's default client gRPC port. Use `--protocol rest` with the
REST endpoint when you want REST/JSON instead.

## Connection Options

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | Full connection string. Other connection options fill in keys that the connection string does not already set. |
| `-e`, `--endpoint` | Server endpoint or comma-separated endpoint pool. Defaults to `http://localhost:5096`. |
| `-d`, `--database` | Database to dump. Defaults to `test`. |
| `-A`, `--all-databases` | Dump every database on the server. |
| `-X`, `--exclude-database` | With `--all-databases`, skip these databases. Accepts comma-separated names or repeated options. |
| `--protocol` | `grpc` by default, or `rest`. The endpoint port must match the selected protocol. Pointing REST at the gRPC port fails with *an HTTP/1.x request was sent to an HTTP/2 only endpoint*. |
| `--timeout` | Per-statement timeout in seconds. Defaults to `10`. |

Example with a connection string:

```bash
camus-dump \
  --connection-source "Endpoint=http://localhost:5096;Database=factory;Protocol=grpc"
```

## Authentication

CamusDB authentication is off by default. Against an authenticated server, pass
credentials or a bearer token:

```bash
CAMUSDB_PASSWORD=app-secret \
camus-dump -e https://camus.internal:5096 -d factory -u app
```

Prompt for the password:

```bash
camus-dump -e https://camus.internal:5096 -d factory -u app --ask-password
```

Use a token obtained elsewhere:

```bash
camus-dump -e https://camus.internal:5096 -d factory --access-token "camus_..."
```

| Option | Description |
| --- | --- |
| `-u`, `--user` | User to authenticate as. |
| `-p`, `--password` | User password. Prefer `CAMUSDB_PASSWORD` or `--ask-password` so the password does not appear in the process list. |
| `-W`, `--ask-password` | Prompt for the password on the terminal. |
| `--access-token` | Bearer token obtained elsewhere, used instead of logging in. |
| `--token-lifetime` | Seconds to reuse a minted token when the server reports no expiry. Defaults to `600`. |

The password is exchanged once for a short-lived bearer token. Statements use
the token, not the password. Over gRPC, authentication uses the `CamusAuth`
service on the same channel that carries dump queries.

The dump reads schema and table data. With authentication enabled, the user
needs privileges that allow the relevant `SHOW` and `SELECT` operations.

Use `https://` for non-loopback authenticated deployments. CamusDB rejects
credential-bearing plaintext requests outside loopback when TLS is required.

## Choosing What To Dump

| Option | Description |
| --- | --- |
| `-t`, `--table` | Dump only these tables. Accepts comma-separated names or repeated options. |
| `-x`, `--exclude-table` | Skip these tables. Accepts comma-separated names or repeated options. |
| `-w`, `--where` | Dump only rows matching this condition. |
| `--as-of` | Read every table as of this point in time. |
| `--no-as-of` | Read the latest committed data instead. |
| `--no-create-table` | Do not emit `CREATE TABLE`. |
| `--no-data` | Do not emit `INSERT`. |
| `--no-indexes` | Do not emit secondary index DDL. |

Example:

```bash
camus-dump -e http://localhost:5096 -d factory \
  --table orders \
  --where 'status = "open"' \
  --output open-orders.sql
```

## Dumping Every Database

`--all-databases` asks the server for its databases with `SHOW DATABASES` and
dumps each one in turn, skipping anything `--exclude-database` names:

```bash
# Every database, as one stream of sections
camus-dump -A -o server.sql

# Every database except two, one file per database
camus-dump -A -X scratch,tempdb --output-directory backup/
```

Every database is read as of the same instant, because the point in time is
fixed once before the first statement goes out. `--single-transaction` is the
exception: a transaction belongs to a connection and each database gets its own,
so it makes each database internally consistent without tying them to a common
snapshot.

Each section opens with `CREATE DATABASE IF NOT EXISTS` and a `USE`, whether or
not `--create-database` was passed, so one file restores every database in turn.

`USE` is not server-side SQL; CamusDB's parser rejects it. A client reads it
and points the statements that follow at that database, which is how `camus-cli`
takes the whole file. For a client that does not, dump with
`--output-directory`: it writes one `<database>.sql` per database, and each file
replays on its own with `-d` naming the target.

The remaining options apply per database. `-t` and `-x` match table names in
every one of them, and `-w` filters rows in every table it names, so a condition
referencing a column that only some tables have will fail on the others.

## Point In Time

By default the dump does not read the latest data. It fixes an instant when it
starts, a second behind the wall clock to stay clear of the server's own clock,
and reads every table with CamusDB's
[`AS OF SYSTEM TIME`](/docs/time-travel-reads) clause.

That default exists for a reason. Without it, a row written between the first
table's scan and the last one's lands in the dump without whatever it referenced
in a table already written, and the dump restores into a state the database was
never in.

The instant is recorded in the dump header, so a dump can be reproduced exactly:

```text
-- Point in time: 2026-07-29 19:15:35.277+00:00
-- Rows read with AS OF SYSTEM TIME '2026-07-29 19:15:35.277+00:00'; table definitions and indexes are current.
```

`--as-of` picks a different instant, in any form the server accepts:

```bash
# Five minutes ago
camus-dump -d factory --as-of -5m

# An absolute UTC instant, for example the one a previous dump recorded
camus-dump -d factory --as-of "2026-07-29 19:15:35.277+00:00"

# Unix epoch milliseconds
camus-dump -d factory --as-of 1721420000000
```

Offsets take `ms`, `s`, `m`, `h`, and `d`, and must be negative. A relative
offset is resolved to an absolute instant once, before the first statement goes
out, rather than passed through. Otherwise the server would evaluate it afresh
for each table and the tables would not share a snapshot.

Four things are worth knowing:

- Rows only. `SHOW CREATE TABLE` and `SHOW INDEXES` have no time-travel
  form, so the schema in the dump is the current one. A table created after the
  chosen instant appears with its definition and no rows.
- Retention bounds how far back you can look. An instant older than the
  history the storage layer still keeps reads as empty rather than as an error.
- `--single-transaction` replaces it. CamusDB rejects `AS OF SYSTEM TIME`
  inside an explicit transaction, which is already pinned to one snapshot.
  Passing `--single-transaction` turns the default off; passing it together with
  `--as-of` is an error.
- `--no-as-of` reads the latest committed data, with no consistency
  guarantee across tables.

## Shaping The Output

| Option | Description |
| --- | --- |
| `-b`, `--batch` | Rows per `INSERT` statement. Defaults to `1`. |
| `-o`, `--output` | Write to a file instead of standard output. |
| `--output-directory` | Write one `<database>.sql` file per database into this directory, creating it if missing. Cannot be combined with `-o`. |
| `--defer-indexes` | Emit each table's `CREATE INDEX` statements after its data. |
| `--add-drop-table` | Emit `DROP TABLE IF EXISTS` before each `CREATE TABLE`. |
| `--if-not-exists` | Emit `CREATE TABLE IF NOT EXISTS`, useful when replaying onto an existing schema. |
| `--create-database` | Emit `CREATE DATABASE IF NOT EXISTS` for the dumped database, followed by `USE`. Implied by `--all-databases`. |
| `--single-transaction` | Read every table from one lock-free Serializable snapshot instead of a fixed past instant. |
| `--strict` | Fail instead of emitting `NULL` for values that have no exact SQL literal. |
| `--no-header` | Omit the leading comment header. |

`--single-transaction` is an alternative to the default point-in-time read, not
an addition to it, and both give a snapshot consistent across tables. Reach for it
when you want the dump pinned to *now* rather than to a fixed instant in the
past.

Use `--defer-indexes` for large restores when you want table data loaded before
secondary indexes are built.

## Dump Contents

Depending on the selected options, the dump can include:

- optional header comments, including the point in time the rows were read at
- `CREATE DATABASE IF NOT EXISTS` followed by `USE`
- `DROP TABLE IF EXISTS`
- `CREATE TABLE` statements
- `INSERT INTO` statements
- secondary `CREATE INDEX IF NOT EXISTS` statements

Typical shape:

```camussql
CREATE DATABASE IF NOT EXISTS factory;
USE factory;

CREATE TABLE IF NOT EXISTS `orders` (
  `id` OID NOT NULL DEFAULT (gen_id()),
  `name` STRING(20) NULL,
  PRIMARY KEY (`id`)
);

INSERT INTO `orders` (`id`, `name`)
VALUES
  (STR_ID('507f1f77bcf86cd799439011'), 'first order'),
  (STR_ID('507f1f77bcf86cd799439012'), 'second order');
```

## Literal Encoding

`camus-dump` emits values as CamusSQL literals that parse back to the same
stored value:

| Type | Dump form |
| --- | --- |
| `OID` | `STR_ID('...')` |
| `STRING` | Plain `'...'` when possible, or `E'...'` for control characters |
| `INT64` | Integer literal |
| `FLOAT64`, `FLOAT32` | Numeric literal |
| `BOOL` | `true` or `false` |
| `BYTES` | `X'...'` hex bytes literal |
| `DATE` | Quoted `yyyy-MM-dd` string |
| `DATETIME` | Quoted ISO-8601 datetime string |
| `UUID` | Quoted canonical UUID string |
| `ARRAY` | `ARRAY[...]` |
| `NULL` | `NULL` |

Strings round-trip even when they contain a backslash, a trailing backslash,
both quote characters, a newline, or a NUL. See
[Data Types](/docs/data-types#string-literals) for the literal rules.

Indexes are dumped both inline in `CREATE TABLE` and as separate
`CREATE INDEX IF NOT EXISTS` statements. This keeps index definitions available
when `--no-create-table` is used and lets `--defer-indexes` build indexes after
row loading.

## Lossy Values

Most stored values have exact SQL literal forms. When a value cannot be restored
exactly, `camus-dump` reports it.

Non-finite floats have no CamusSQL literal:

- `NaN`
- `+Infinity`
- `-Infinity`

By default, the dump emits `NULL` for those values, adds warning comments to the
dump, and prints a count to standard error at the end. Use `--strict` to fail
instead.

`DATETIME` literals carry millisecond precision. If a dumped datetime must be
truncated to milliseconds, the tool reports that too; `--strict` turns it into a
failure.

## Restore A Dump

Restore by feeding the generated SQL to `camus-cli`:

```bash
camus-cli -c "Endpoint=http://localhost:5096;Protocol=grpc"
```

Then run:

```camussql
source ./factory.sql
```

If the dump does not include `--create-database`, create and select the target
database first:

```camussql
CREATE DATABASE IF NOT EXISTS factory;
use factory;
source ./factory.sql
```

See [camus-cli](/docs/camus-cli) for interactive shell usage.

## When To Use It

Use `camus-dump` when you want:

- a logical SQL backup
- a table-level export
- a readable dump for review or source control
- a consistent snapshot across tables
- a restore path through ordinary CamusSQL

All of that assumes a database small enough to replay in reasonable time. Reach
for [Backup And Restore](/docs/backup-and-restore) instead when the goal is
disaster recovery, or when the database runs to dozens of gigabytes or more.
Those backups are physical and node-wide, restore to a chosen point in time, and
come back far faster than replaying a dump statement by statement. See
[Not For Large Databases](#not-for-large-databases).

For interactive replay and manual restore, use [camus-cli](/docs/camus-cli).
