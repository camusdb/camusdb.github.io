---
sidebar_position: 7.3
---

# camus-dump

`camus-dump` is a utility for a logical backup of CamusDB. It connects to a
database. It reads the metadata of the schema, and the rows. It then writes SQL.
You can replay that SQL later, through `camus-cli`, or through another client of
SQL for CamusDB.

Use the utility for one of three purposes: a backup in SQL that you can inspect,
an export of one table, or a consistent logical snapshot of a database.

The dump is consistent across the tables, by default. It fixes one instant at
its start. It then reads every table as of that instant. Read
[Point in time](#point-in-time) before you turn that behavior off.

## Not for large databases

`camus-dump` is the wrong tool for a database of tens of gigabytes, and of
hundreds of gigabytes. Use [Backup And Restore](/docs/backup-and-restore) at that
scale.

Every row travels through the layer of the SQL. It comes back out as text. Both
ends therefore grow with the count of the rows. They do not grow with the bytes
on the disk.

The dump runs slower than the disk that it reads. The file of the SQL is usually
larger than the data of its source.

The restore is the harder half. A replay of a dump parses every statement,
checks every constraint again, and builds every index from the start. That work
takes hours, and it can take days. A physical restore is a copy of some files,
plus a replay of the WAL.

A dump can need a long night for its creation. It can then need much longer for
its restore. That shape is exactly wrong for a path of a recovery.

Use `camus-dump` for two purposes. The output must be readable SQL that you can
carry to another system. The data set must also be small enough for a quick
replay.

Use a physical backup when your purpose is the return of the data.

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.Dump
```

The executable name is:

```bash
camus-dump
```

## Basic usage

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

By default, `camus-dump` uses the protocol of gRPC, and the address
`http://localhost:5096`. That port is the default port of gRPC for a client of
CamusDB.

Use a `--protocol rest`, with the endpoint of REST, when you want REST with JSON
instead.

## Connection options

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

The authentication of CamusDB is off by default. Against a server with
authentication, pass a credential, or a bearer token:

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

The utility exchanges the password one time, for a bearer token with a short
life. A statement then uses the token. It does not use the password.

Over gRPC, the authentication uses the service `CamusAuth`. That service runs on
the same channel as the queries of the dump.

The dump reads the schema, and the data of a table. While authentication is
enabled, the user needs the privileges of the relevant `SHOW` operations, and of
the relevant `SELECT` operations.

Use an `https://` address for a deployment with authentication, outside
loopback. While TLS is necessary, CamusDB rejects a plaintext request with a
credential from outside loopback.

## Choosing what to dump

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

## Dumping every database

`--all-databases` asks the server for its databases, with a `SHOW DATABASES`. It
then dumps each database in turn. It skips every database that an
`--exclude-database` names:

```bash
# Every database, as one stream of sections
camus-dump -A -o server.sql

# Every database except two, one file per database
camus-dump -A -X scratch,tempdb --output-directory backup/
```

The utility reads every database as of the same instant. It fixes the point in
time one time, before the first statement leaves.

`--single-transaction` is the exception. A transaction belongs to a connection,
and each database receives its own connection. That option therefore makes each
database internally consistent. It does not bind the databases to one common
snapshot.

Each section opens with a `CREATE DATABASE IF NOT EXISTS`, and with a `USE`.
That happens with a `--create-database`, and without one. One file therefore
restores every database, in turn.

A `USE` is not SQL of the server. The parser of CamusDB rejects it. A client
reads that statement, and it points the statements after it at that database.
`camus-cli` therefore takes the whole file.

Another client may not read a `USE`. Dump with an `--output-directory` for such a
client. The utility then writes one `<database>.sql` for each database. Each file
replays on its own, and a `-d` names its target.

The other options apply to each database. A `-t` and an `-x` match the names of
the tables of every database. A `-w` filters the rows of every table that it
names.

A condition can reference a column that only some tables hold. That condition
then fails on the other tables.

## Point in time

By default, the dump does not read the latest data. It fixes an instant at its
start. That instant is one second behind the wall clock, and it therefore stays
clear of the clock of the server. The dump then reads every table with the
[`AS OF SYSTEM TIME`](/docs/time-travel-reads) clause of CamusDB.

That default exists for a reason. Without it, a problem appears. A user writes a
row between the scan of the first table and the scan of the last one. That row
arrives in the dump. The rows that it references, in a table that the dump wrote
already, do not. The dump then restores a state that the database never held.

The utility records the instant in the header of the dump. You can therefore
repeat a dump exactly:

```text
-- Point in time: 2026-07-29 19:15:35.277+00:00
-- Rows read with AS OF SYSTEM TIME '2026-07-29 19:15:35.277+00:00'; table definitions and indexes are current.
```

An `--as-of` selects a different instant. It takes any form that the server
accepts:

```bash
# Five minutes ago
camus-dump -d factory --as-of -5m

# An absolute UTC instant, for example the one a previous dump recorded
camus-dump -d factory --as-of "2026-07-29 19:15:35.277+00:00"

# Unix epoch milliseconds
camus-dump -d factory --as-of 1721420000000
```

An offset takes `ms`, `s`, `m`, `h`, and `d`. It must be negative.

The utility resolves a relative offset to an absolute instant one time, before
the first statement leaves. It does not pass the offset through. The server would
otherwise evaluate that offset again for each table. The tables would then share
no snapshot.

Four points are worth your attention:

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

## Shaping the output

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

`--single-transaction` is an alternative to the default read at a point in time.
It is not an addition to that read. Both forms give a snapshot that is consistent
across the tables.

Use the option when you want the dump pinned to the present moment. The default
pins the dump to a fixed instant of the past.

Use a `--defer-indexes` for a large restore. CamusDB then loads the data of a
table before it builds the secondary indexes.

## Dump contents

The dump can include these parts. Your selected options decide:

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

## Literal encoding

`camus-dump` writes a value as a literal of CamusSQL. That literal parses back
to the same stored value:

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

A string returns unchanged, even with five difficult characters inside it: a
backslash, a backslash at its end, both kinds of quotation mark, a new line, and
a NUL. See [Data Types](/docs/data-types#string-literals) for the rules of a
literal.

The dump writes an index two times: inline, inside the `CREATE TABLE`, and as a
separate `CREATE INDEX IF NOT EXISTS` statement.

That repetition keeps the definitions of the indexes available with a
`--no-create-table`. It also lets a `--defer-indexes` build the indexes after the
load of the rows.

## Lossy values

Most stored values have an exact form as a literal of SQL. `camus-dump` reports
a value that it cannot restore exactly.

Non-finite floats have no CamusSQL literal:

- `NaN`
- `+Infinity`
- `-Infinity`

By default, the dump writes a `NULL` for such a value. It adds a comment of a
warning to the dump. It prints a count to the standard error at its end. Use a
`--strict` for a failure instead.

A literal of a `DATETIME` carries a precision of a millisecond. The tool can
need a truncation of a dumped datetime to that precision. It reports that
truncation as well. A `--strict` turns it into a failure.

## Restore a dump

Restore the data. Send the generated SQL to `camus-cli`:

```bash
camus-cli -c "Endpoint=http://localhost:5096;Protocol=grpc"
```

Then run:

```camussql
source ./factory.sql
```

The dump can hold no `--create-database`. Create the target database first. Then
select it:

```camussql
CREATE DATABASE IF NOT EXISTS factory;
use factory;
source ./factory.sql
```

See [camus-cli](/docs/camus-cli) for the use of the interactive shell.

## When to use it

Use `camus-dump` for these purposes:

- a logical SQL backup
- a table-level export
- a readable dump for review or source control
- a consistent snapshot across tables
- a restore path through ordinary CamusSQL

Every purpose above assumes a database small enough for a replay in a reasonable
time.

Use [Backup And Restore](/docs/backup-and-restore) instead in two cases: your
goal is a disaster recovery, and the database holds tens of gigabytes or more.

Such a backup is physical, and it covers a whole node. It restores to a chosen
point in time. It also returns far faster than a replay of a dump, statement by
statement. See [Not for large databases](#not-for-large-databases).

For an interactive replay, and for a restore by hand, use
[camus-cli](/docs/camus-cli).
