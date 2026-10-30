---
sidebar_position: 7.3
---

# camus-dump

`camus-dump` is a logical backup utility for CamusDB. It connects to a
database, reads the schema metadata, sequences, indexes, rows, and (when
requested) users, and writes them out as SQL. You can replay that SQL later
through `camus-cli` or another CamusDB SQL client.

The output writes exact literals for CamusDB values, including `NUMERIC`, `BYTES`,
full-precision floats, and sub-millisecond `DATETIME` values.

By default, the dump is consistent across tables: it fixes one instant when it
starts and reads every table as of that instant. Read
[Point in time](#point-in-time) before you turn that behavior off.

## When to use it

Use `camus-dump` when you want readable SQL: a logical backup you can inspect, a
table export, a dump for review or source control, or a copy you replay through
ordinary CamusSQL on another system. The data set must be small enough to replay
in a reasonable time.

For disaster recovery, or for a database of tens of gigabytes or more, use
[Backup and restore](/docs/backup-and-restore) instead. Its physical backup
covers a whole node, restores to a chosen point in time, and avoids replaying
every row. [Why it works this way](/docs/backup-and-restore#why-it-works-this-way)
explains why a dump does not scale for recovery.

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.Dump
```

The tool requires the .NET 10 SDK.

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

Dump a compressed SQL file:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --output factory.sql.gz
```

The `.gz` extension selects gzip automatically. You can also pass
`--compress gzip` and pipe the compressed stream to another command.

By default, `camus-dump` uses gRPC at `http://localhost:5096`, the default
CamusDB client gRPC port.

To use REST with JSON instead, pass `--protocol rest` with the REST endpoint.

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

CamusDB authentication is off by default. Against a server with
authentication, pass credentials or a bearer token:

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
CAMUSDB_ACCESS_TOKEN="camus_..." \
camus-dump -e https://camus.internal:5096 -d factory
```

| Option | Description |
| --- | --- |
| `-u`, `--user` | User to authenticate as. |
| `-p`, `--password` | User password. Prefer `CAMUSDB_PASSWORD` or `--ask-password` so the password does not appear in the process list. |
| `-W`, `--ask-password` | Prompt for the password on the terminal. |
| `--access-token` | Bearer token obtained elsewhere, used instead of logging in. Prefer the `CAMUSDB_ACCESS_TOKEN` environment variable so the token does not appear in the process list. |
| `--token-lifetime` | Seconds to reuse a minted token when the server reports no expiry. Defaults to `600`. |

The utility exchanges the password once for a short-lived bearer token.
Statements then use the token, not the password.

Over gRPC, authentication uses the `CamusAuth` service, on the same channel as
the dump's queries.

The dump reads the schema and table data. While authentication is enabled, the
user needs privileges for the relevant `SHOW` and `SELECT` operations.

For an authenticated deployment beyond loopback, use an `https://` address.
While TLS is required, CamusDB rejects plaintext requests with credentials from
outside loopback. If a VPN or SSH tunnel already protects the
link, pass `-c "AllowInsecureCredentials=true"` to allow credentials over that
plaintext hop.

## Choosing what to dump

| Option | Description |
| --- | --- |
| `-t`, `--table` | Dump only these tables. Accepts comma-separated names or repeated options. |
| `-x`, `--exclude-table` | Skip these tables. Accepts comma-separated names or repeated options. |
| `-w`, `--where` | Dump only rows matching this condition. It applies to every dumped table. The text is raw SQL that the dump appends after `WHERE` unchanged, so never build it from untrusted input. |
| `--as-of` | Read every table as of this point in time. |
| `--no-as-of` | Read the latest committed data instead. |
| `--all-users` | Also export every account and grant, including server-level `MONITOR` grants. Requires a superuser and a server with `SHOW USERS` and `SHOW GRANTS FOR *`. |
| `--users` | Also export these accounts and their grants. Use this for older servers or for a subset of accounts. |
| `--no-create-table` | Do not emit `CREATE TABLE`. |
| `--no-data` | Do not emit `INSERT`. |
| `--no-indexes` | Do not emit secondary index DDL. |

Example:

```bash
camus-dump -e http://localhost:5096 -d factory \
  --table orders \
  --where "status = 'open'" \
  --output open-orders.sql
```

## Dumping every database

`--all-databases` lists the server's databases with `SHOW DATABASES` and dumps
each one in turn, skipping any that `--exclude-database` names:

```bash
# Every database, as one stream of sections
camus-dump -A -o server.sql

# Every database except two, one file per database
camus-dump -A -X scratch,tempdb --output-directory backup/
```

The utility reads every database as of the same instant, which it fixes once
before the first statement is sent.

`--single-transaction` is the exception. A transaction belongs to a connection,
and each database gets its own connection, so this option makes each database
internally consistent but does not bind them to one common snapshot.

Each section opens with `CREATE DATABASE IF NOT EXISTS` and `USE`, with or
without `--create-database`, so one file restores every database in turn.

`USE` is not server SQL; the CamusDB parser rejects it. The client reads it and
points the following statements at that database, which is why `camus-cli`
accepts the whole file.

If your client does not understand `USE`, dump with `--output-directory`. The
utility then writes one `<database>.sql` per database. Each file replays on its
own, with `-d` naming its target.

The other options apply to each database. `-t` and `-x` match table names in
every database, and `-w` filters the rows of every table it applies to.

If a condition references a column that only some tables have, it fails on the
other tables.

## Point in time

By default, the dump does not read the latest data. When it starts, it fixes an
instant one second behind the wall clock, to stay clear of the server clock,
and reads every table with CamusDB's
[`AS OF SYSTEM TIME`](/docs/time-travel-reads) clause.

Without that default, a user could write a row between the scans of the first
and last tables. That row would land in the dump, but the rows it references,
in a table the dump already wrote, would not. The dump would then restore a
state the database never held.

The utility records the instant in the dump header, so you can repeat a dump
exactly:

```text
-- Point in time: 2026-07-29 19:15:35.277+00:00
-- Rows read with AS OF SYSTEM TIME '2026-07-29 19:15:35.277+00:00'; table definitions and indexes are current.
```

`--as-of` selects a different instant, in any form the server accepts:

```bash
# Five minutes ago
camus-dump -d factory --as-of -5m

# An absolute UTC instant, for example the one a previous dump recorded
camus-dump -d factory --as-of "2026-07-29 19:15:35.277+00:00"

# Unix epoch milliseconds
camus-dump -d factory --as-of 1721420000000
```

Offsets take `ms`, `s`, `m`, `h`, and `d`, and must be negative.

The utility resolves a relative offset to an absolute instant once, before the
first statement is sent, instead of passing the offset through. Otherwise the
server would evaluate the offset again for each table, and the tables would not
share a snapshot.

Keep in mind:

- Rows only. `SHOW CREATE TABLE` and `SHOW INDEXES` have no time-travel
  form, so the schema in the dump is the current one. A table created after the
  chosen instant appears with its definition and no rows.
- Foreign keys are part of `SHOW CREATE TABLE`. A child row from the chosen
  instant can fail to load if its parent row is no longer present in the dumped
  snapshot. The dump orders tables and rows by the foreign keys it can see, but
  it cannot restore a parent row that was not included in the snapshot.
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
| `-b`, `--batch` | Rows per `INSERT` statement. Defaults to `100`. |
| `-o`, `--output` | Write to a file instead of standard output. |
| `--output-directory` | Write one `<database>.sql` file per database into this directory, creating it if missing. Cannot be combined with `-o`. |
| `-z`, `--compress` | `gzip` or `none`. Defaults to `gzip` when the `--output` file name ends in `.gz`. With `--output-directory`, gzip names files `<database>.sql.gz`. |
| `--defer-indexes` | Emit each table's `CREATE INDEX` statements after its data. |
| `--add-drop-table` | Emit `DROP TABLE IF EXISTS` before each `CREATE TABLE`. |
| `--if-not-exists` | Emit `CREATE TABLE IF NOT EXISTS`, useful when replaying onto an existing schema. |
| `--create-database` | Emit `CREATE DATABASE IF NOT EXISTS` for the dumped database, followed by `USE`. Implied by `--all-databases`. |
| `--single-transaction` | Read every table from one lock-free Serializable snapshot instead of a fixed past instant. |
| `--strict` | Fail instead of emitting `NULL` for values that have no exact SQL literal. |
| `--no-header` | Omit the leading comment header. |
| `--no-progress` | Hide progress bars on standard error when writing to `--output` or `--output-directory`. |

`--single-transaction` replaces the default point-in-time read rather than
adding to it. Both give a snapshot that is consistent across tables.

Use it when you want the dump pinned to the present moment. The default pins the
dump to a fixed instant in the past.

Use `--batch 100` as a starting point for a restore. One row per `INSERT` is
usually much slower, while very large batches can hit the transaction mutation
limit or the transport message-size limit on wide tables.

`--defer-indexes` loads the table data before building secondary indexes. It can
help for a table with one secondary index, but it is not automatically faster
for a table with several indexes because each deferred index build scans the
table. Keep the target out of service until deferred indexes are built. If the
source server is too old to support `SHOW CREATE TABLE ... WITHOUT INDEXES`,
`--defer-indexes` warns and cannot defer inline indexes.

When writing to a file or an output directory, the utility shows progress bars
on standard error. Standard output stays reserved for the SQL dump. Use
`--no-progress` for scripts that need quiet stderr.

Output files are created readable and writable by their owner only. A path that
is already a symbolic link is refused instead of followed.

## Users and grants

`camus-dump` can export accounts and grants in addition to databases, tables,
sequences, indexes, and rows:

```bash
camus-dump -e https://db1.internal:5096 -u admin -A --all-users \
  --output-directory backup/

camus-dump -e https://db1.internal:5096 -u admin -d shop \
  --users app,reporting -o shop.sql
```

`--all-users` uses `SHOW USERS` and `SHOW GRANTS FOR *`. It needs a superuser
and a server that supports those statements. `--users` reads the named accounts
with `SHOW GRANTS FOR name`, which also works against older servers that cannot
list every account.

The export is split into two logical blocks. `CREATE USER IF NOT EXISTS` runs
before the data, because a grant needs its account. `GRANT` statements run after
the data, because object grants resolve databases and tables.

With `--output-directory`, those blocks are written as `users.sql` and
`grants.sql`:

```bash
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/users.sql
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/shop.sql
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/grants.sql
```

Passwords are not exported, because the server stores password verifiers rather
than cleartext passwords. A restored account cannot log in until you set a new
password with `ALTER USER name IDENTIFIED BY '...'`. Superuser status is not
exported either; it is a bootstrap property, not a grant.

## Dump contents

Depending on your options, the dump can include:

- optional header comments, including the point in time the rows were read at
- `CREATE USER IF NOT EXISTS` statements for exported accounts
- `CREATE DATABASE IF NOT EXISTS` followed by `USE`
- `DROP TABLE IF EXISTS`
- `CREATE SEQUENCE` statements
- `CREATE TABLE` statements
- `INSERT INTO` statements
- `SELECT setval(...)` statements for sequence positions
- secondary `CREATE INDEX IF NOT EXISTS` statements
- `GRANT` statements for exported accounts

The dump does not include views or materialized views. Record them with
`SHOW CREATE VIEW` and `SHOW CREATE MATERIALIZED VIEW`, and recreate them after
the load. See [Logical dump and reimport](/docs/logical-dump-and-reimport).

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

`camus-dump` writes each value as a CamusSQL literal that parses back to the
same stored value:

| Type | Dump form |
| --- | --- |
| `OID` | `STR_ID('...')` |
| `STRING` | Plain `'...'` when possible, or `E'...'` for control characters |
| `INT64` | Integer literal |
| `FLOAT64`, `FLOAT32` | Numeric literal |
| `NUMERIC` | `NUMERIC '...'` exact typed literal |
| `BOOL` | `true` or `false` |
| `BYTES` | `X'...'` hex bytes literal |
| `DATE` | Quoted `yyyy-MM-dd` string |
| `DATETIME` | Quoted ISO-8601 datetime string, including the seventh fractional digit when needed |
| `UUID` | Quoted canonical UUID string |
| `ARRAY` | `ARRAY[...]` |
| `NULL` | `NULL` |

Strings round-trip unchanged, even when they contain backslashes, a trailing
backslash, either kind of quotation mark, newlines, or NUL characters. See
[Data Types](/docs/data-types#string-literals) for the literal rules.

The dump writes each index twice: inline in the `CREATE TABLE`, and as a
separate `CREATE INDEX IF NOT EXISTS` statement. Index definitions include their
per-column sort direction and comment when the source server reports them.

That repetition keeps index definitions available with `--no-create-table`, and
lets `--defer-indexes` build the indexes after the rows load.

## Sequences and identity values

The dump restores sequences and the positions they reached.

Free-standing sequences are created before tables, because a table default can
draw from one. Identity and `serial` columns create their owned sequences
through `CREATE TABLE`; after the table, the dump restores any source-specific
sequence options, comments, and names that differ from the identity default.

After rows are loaded, `SELECT setval('name', n)` restores each sequence
position. Rows are inserted with explicit values, and explicit values do not
advance a sequence. Without `setval`, a restored sequence could hand out values
that restored rows already hold.

`GENERATED ALWAYS AS IDENTITY` normally refuses a supplied value. Dumped
`INSERT` statements for such tables use `OVERRIDING SYSTEM VALUE`, so restored
rows keep their identity values.

Sequence definitions and positions are current when the dump starts, not
time-traveled with `--as-of`, because the server does not expose historical
sequence metadata. `--no-create-table` leaves out `CREATE SEQUENCE`, and
`--no-data` leaves out sequence positions.

## Foreign keys

`camus-dump` orders tables and rows so a restore can satisfy foreign keys in one
pass.

Tables are written after the tables they reference. With `--add-drop-table`,
drops are written in the opposite direction: child tables before parents.

For a self-referencing table, parent rows are written before child rows when
that order exists. Rows that reference each other in a cycle cannot be restored
as separate statements in any order, so the utility writes them together in one
`INSERT` at the end of the table and prints a warning.

When `--table`, `--exclude-table`, or `--where` leaves out a referenced parent
table or parent row, the restore may still need that parent to exist already.
The utility warns when a dumped table references a table excluded by the table
filters.

## Lossy values

Most stored values have an exact SQL literal form. `camus-dump` reports any
value it cannot restore exactly.

Non-finite floats have no CamusSQL literal:

- `NaN`
- `+Infinity`
- `-Infinity`

By default, the dump writes `NULL` for such a value, adds a warning comment to
the dump, and prints a count to standard error at the end. Use `--strict` to
fail instead.

`DATETIME` values keep their full precision. Sub-millisecond values are written
with seven fractional digits.

## Restore a dump

To restore, send the generated SQL to `camus-cli`:

```bash
camus-cli -c "Endpoint=http://localhost:5096;Protocol=grpc"
```

Then run:

```camussql
source ./factory.sql
```

If the dump was made without `--create-database`, create the target database
first, then select it:

```camussql
CREATE DATABASE IF NOT EXISTS factory;
use factory;
source ./factory.sql
```

To restore a compressed dump, decompress it into the client:

```bash
gunzip -c factory.sql.gz | camus-cli factory -f -
```

A complete dump ends each database section with a `-- Dump completed` comment,
unless `--no-header` was used. Check for that footer when a dump was streamed to
object storage or through another pipeline that can keep a partial upload.

For interactive replays and manual restores, use
[camus-cli](/docs/camus-cli).
