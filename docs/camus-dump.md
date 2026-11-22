---
sidebar_position: 7.3
---

# camus-dump

`camus-dump` is a logical backup utility for CamusDB. It reads a database and
writes its schema and rows as SQL. It can also write the users and their
grants. You can load that SQL later with
`camus-cli` or another CamusDB SQL client.

The dump writes exact literals for CamusDB values, for example for `NUMERIC`
values and full-precision floats.

By default, the dump is consistent across tables. It fixes one instant when it
starts, and it reads all the tables as of that instant. Read
[Point in time](#point-in-time) before you turn off that behavior.

## Choose a dump or a physical backup

Use `camus-dump` when you want readable SQL, for example to review a database
or to copy data to another system through ordinary CamusSQL. The data must be small enough to load again in a reasonable time.

For disaster recovery, or for a database of tens of gigabytes or more, use
[Backup and restore](/docs/backup-and-restore). A physical backup covers a full
node, and it can restore to a chosen point in time without loading each row
again. For more information, see
[Physical backups versus logical dumps](/docs/backup-and-restore#physical-backups-versus-logical-dumps).

## Install

Install the global tool. It needs the .NET 10 SDK:

```bash
dotnet tool install --global CamusDB.Dump
```

The command is `camus-dump`.

## Basic usage

Dump a database to standard output:

```bash
camus-dump --endpoint http://localhost:5096 --database factory
```

Dump one table with 100 rows in each `INSERT`, and write it to a file:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --table orders \
  --batch 100 \
  --output orders.sql
```

Dump the database as it was five minutes ago, in a form that you can load into
an existing schema:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --as-of -5m \
  --if-not-exists \
  --output factory.sql
```

Dump each database on the server to a separate file:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --all-databases \
  --output-directory backup/
```

Dump to a compressed file:

```bash
camus-dump \
  --endpoint http://localhost:5096 \
  --database factory \
  --output factory.sql.gz
```

The `.gz` extension selects gzip. You can also pass `--compress gzip`, and pipe
the compressed stream to another command.

By default, `camus-dump` uses gRPC at `http://localhost:5096`, the default
CamusDB gRPC port. To use REST, pass `--protocol rest` with the REST endpoint.

## Connection options

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | A full connection string. The other connection options fill in the keys that the connection string doesn't set. |
| `-e`, `--endpoint` | The server endpoint, or a comma-separated endpoint pool. Default `http://localhost:5096`. |
| `-d`, `--database` | The database to dump. Default `test`. |
| `-A`, `--all-databases` | Dump all the databases on the server. |
| `-X`, `--exclude-database` | With `--all-databases`, skip these databases. Use comma-separated names, or repeat the option. |
| `--protocol` | `grpc` (default) or `rest`. The endpoint port must match the protocol. REST on the gRPC port returns *An HTTP/1.x request was sent to an HTTP/2 only endpoint*. |
| `--timeout` | The timeout for each statement, in seconds. Default `10`. |

For example, with a connection string:

```bash
camus-dump \
  --connection-source "Endpoint=http://localhost:5096;Database=factory;Protocol=grpc"
```

## Authentication

CamusDB authentication is off by default. If authentication is on, pass
credentials or a bearer token:

```bash
CAMUSDB_PASSWORD=app-secret \
camus-dump -e https://camus.internal:5096 -d factory -u app
```

To type the password at a prompt:

```bash
camus-dump -e https://camus.internal:5096 -d factory -u app --ask-password
```

To use a token from another source:

```bash
CAMUSDB_ACCESS_TOKEN="camus_..." \
camus-dump -e https://camus.internal:5096 -d factory
```

| Option | Description |
| --- | --- |
| `-u`, `--user` | The user to sign in as. |
| `-p`, `--password` | The password. Other processes can see a password on the command line. Use `CAMUSDB_PASSWORD` or `--ask-password`. |
| `-W`, `--ask-password` | Type the password at a prompt. |
| `--access-token` | A bearer token from another source. Other processes can see it on the command line. Use `CAMUSDB_ACCESS_TOKEN`. |
| `--token-lifetime` | How long to reuse a token, in seconds, when the server doesn't give an expiry. Default `600`. |

The utility exchanges the password once for a short-lived bearer token. Later
statements send the token. Over gRPC, the sign-in uses the `CamusAuth` service
on the same channel. The user needs the privileges for the `SHOW` and `SELECT`
statements that the dump executes.

Beyond loopback, use an `https://` address. While TLS is required, a request
with credentials over HTTP without TLS returns an error, except from loopback.
If a VPN or an SSH tunnel protects the link, pass
`-c "AllowInsecureCredentials=true"` to send credentials over that link.

## Choose what to dump

| Option | Description |
| --- | --- |
| `-t`, `--table` | Dump these tables only. Use comma-separated names, or repeat the option. |
| `-x`, `--exclude-table` | Skip these tables. Use comma-separated names, or repeat the option. |
| `-w`, `--where` | Dump only the rows that match this condition, in each dumped table. The text is added after `WHERE` as raw SQL. Don't build it from untrusted input. |
| `--as-of` | Read all the tables as of this point in time. |
| `--no-as-of` | Read the latest committed data. |
| `--all-users` | Also export all the accounts and grants, including `MONITOR` grants. Needs a superuser, and a server with `SHOW USERS` and `SHOW GRANTS FOR *`. |
| `--users` | Also export these accounts and their grants. Use it for older servers, or for some of the accounts. |
| `--no-create-table` | Don't write `CREATE TABLE`. |
| `--no-data` | Don't write `INSERT`. |
| `--no-indexes` | Don't write the secondary index DDL. |

For example:

```bash
camus-dump -e http://localhost:5096 -d factory \
  --table orders \
  --where "status = 'open'" \
  --output open-orders.sql
```

## Dump all databases

`--all-databases` lists the databases with `SHOW DATABASES`, and dumps them one
at a time. It skips the databases that `--exclude-database` names:

```bash
# All databases, in one stream of sections
camus-dump -A -o server.sql

# All databases except two, in one file for each database
camus-dump -A -X scratch,tempdb --output-directory backup/
```

The utility reads all the databases as of the same instant. It fixes that
instant once, before the first statement. However, `--single-transaction`
reads each database in a separate transaction. This means that each database
is consistent, but the databases don't share one snapshot.

Each section starts with `CREATE DATABASE IF NOT EXISTS` and `USE`. This means
that one file can restore all the databases. `USE` isn't server SQL, and the
server returns an error for it. The client reads it and sends the next
statements to that database. `camus-cli` understands `USE`.

With `--output-directory`, the utility writes one `<database>.sql` file for
each database. Each file also starts with `CREATE DATABASE IF NOT EXISTS` and
`USE`. If your client doesn't understand `USE`, dump each database with `-d`
and without `--create-database`. That file doesn't have `USE`, and you load it
over a connection to the target database.

The other options apply to each database. `-t` and `-x` match table names in
all the databases, and `-w` filters the rows of each table. A condition on a
column that only some tables have fails on the other tables.

## Point in time

By default, the dump doesn't read the latest data. When it starts, it fixes an
instant one second behind the clock, and it reads each table with
[`AS OF SYSTEM TIME`](/docs/time-travel-reads). This means that a write in the
last second before the dump isn't in it.

Without a fixed instant, a user could write a row between the scans of the
first and the last table. That row would be in the dump, but a row that it
references, in a table that was already dumped, might not be. The dump would
then restore a state that the database didn't have.

The dump header records the instant. You can use it to repeat the dump:

```text
-- Point in time: 2026-07-29 19:15:35.277+00:00
-- Rows read with AS OF SYSTEM TIME '2026-07-29 19:15:35.277+00:00'; table definitions and indexes are current.
```

To select a different instant, use `--as-of`:

```bash
# Five minutes ago
camus-dump -d factory --as-of -5m

# An absolute UTC instant, for example the one that a previous dump recorded
camus-dump -d factory --as-of "2026-07-29 19:15:35.277+00:00"

# Unix epoch milliseconds
camus-dump -d factory --as-of 1721420000000
```

An offset must be negative. Its unit can be milliseconds (`ms`) up to days
(`d`), for example `-30s` or `-2h`.
The utility converts it to an absolute instant once, before the first
statement. This means that all the tables share one snapshot.

Note the following:

- Only the rows are historical. `SHOW CREATE TABLE` and `SHOW INDEXES` don't
  have a time-travel form. This means that the schema in the dump is the
  current one. A
  table created after the instant is in the dump without rows.
- A child row from the instant can fail to load if its parent row isn't in the
  snapshot. The dump orders tables and rows by their foreign keys. However, it
  can't add a parent row that isn't in the snapshot.
- The retention of old row versions limits how far back you can read. By
  default, it is one hour. An instant older than the retained history returns
  `CADB0847`, and the dump prints a hint. For more information, see
  [Time-travel reads](/docs/time-travel-reads).
- `--single-transaction` replaces the fixed instant. CamusDB doesn't accept
  `AS OF SYSTEM TIME` in an explicit transaction, which already reads from one
  snapshot. `--single-transaction` with `--as-of` is an error.
- `--no-as-of` reads the latest committed data, and the tables don't share a
  snapshot.

## Shaping the output

| Option | Description |
| --- | --- |
| `-b`, `--batch` | The rows in each `INSERT` statement. Default `100`. |
| `-o`, `--output` | Write to a file, in place of standard output. |
| `--output-directory` | Write one `<database>.sql` file for each database into this directory. The directory is created if it doesn't exist. Can't be used with `-o`. |
| `-z`, `--compress` | `gzip` or `none`. The default is `gzip` when the `--output` file name ends in `.gz`. With `--output-directory`, gzip files are named `<database>.sql.gz`. |
| `--defer-indexes` | Write the `CREATE INDEX` statements of each table after its rows. |
| `--add-drop-table` | Write `DROP TABLE IF EXISTS` and `DROP SEQUENCE IF EXISTS` before the first `CREATE`. |
| `--if-not-exists` | Write `CREATE TABLE IF NOT EXISTS`, to load into an existing schema. |
| `--create-database` | Write `CREATE DATABASE IF NOT EXISTS` and `USE` for the dumped database. `--all-databases` does this by default. |
| `--single-transaction` | Read all the tables from one Serializable snapshot of the present, in place of a fixed past instant. The read takes no locks. |
| `--strict` | Fail, in place of writing `NULL`, for a value that doesn't have an exact SQL literal. |
| `--no-header` | Don't write the comment header. |
| `--no-progress` | Don't show progress bars on standard error when you write to `--output` or `--output-directory`. |

You should start with `--batch 100` for a restore. One row in each `INSERT` is
usually much slower. A very large batch can reach the transaction mutation
limit, or the message-size limit of the transport on wide tables.

`--defer-indexes` loads the rows of a table before it builds the secondary
indexes. It can help a table with one secondary index. For a table with several
indexes, it can be slower. Each deferred index build scans the table.
Keep the target out of service until the deferred indexes are built. If the
source server doesn't support `SHOW CREATE TABLE ... WITHOUT INDEXES`,
`--defer-indexes` prints a warning and can't defer the inline indexes.

When you write to a file or a directory, progress bars are shown on standard
error. Standard output is for the SQL only.

Output files are readable and writable by their owner only. If the output path
is a symbolic link, the dump returns an error, and it doesn't follow the link.

## Users and grants

`camus-dump` can also export accounts and grants:

```bash
camus-dump -e https://db1.internal:5096 -u admin -A --all-users \
  --output-directory backup/

camus-dump -e https://db1.internal:5096 -u admin -d shop \
  --users app,reporting -o shop.sql
```

`--all-users` uses `SHOW USERS` and `SHOW GRANTS FOR *`. It needs a superuser
and a server that supports those statements. `--users` reads each named account
with `SHOW GRANTS FOR name`. This also works with older servers that can't list
all the accounts.

The export has two parts. `CREATE USER IF NOT EXISTS` statements come before
the data, and `GRANT` statements come after it. A grant needs its account, and
also its database and table. With `--output-directory`,
the two parts are `users.sql` and `grants.sql`. Load them in this order:

```bash
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/users.sql
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/shop.sql
camus-cli -c "Endpoint=http://db1.internal:5095;Database=test" -f backup/grants.sql
```

Passwords aren't exported. The server stores password verifiers only. A
restored account can't sign in until you set a new password with
`ALTER USER name IDENTIFIED BY '...'`. Superuser status isn't exported either.
It is a property of the bootstrap user, not a grant.

## Dump contents

A dump can have the following statements, in this order:

1. Header comments, with the point in time of the rows.
2. `CREATE USER IF NOT EXISTS` for exported accounts.
3. `CREATE DATABASE IF NOT EXISTS` and `USE`.
4. `CREATE EXTENSION` for installed extensions, and `CREATE FUNCTION` for
   inline C# functions.
5. `DROP TABLE IF EXISTS` and `DROP SEQUENCE IF EXISTS`, with
   `--add-drop-table`.
6. `CREATE SEQUENCE`, each followed by `SELECT setval(...)` for its position.
7. The tables. A table has its `CREATE TABLE`, then its
   `CREATE INDEX IF NOT EXISTS` statements, then its rows. With
   `--defer-indexes`, the indexes come after the rows.
8. `CREATE TRIGGER`, after all the rows. This means that the load doesn't fire
   the triggers.
9. `GRANT` for exported accounts.
10. A `-- Dump completed` comment.

The dump doesn't include views or materialized views. Record them with
`SHOW CREATE VIEW` and `SHOW CREATE MATERIALIZED VIEW`, and create them again
after the load. For more information, see
[Logical dump and reimport](/docs/logical-dump-and-reimport).

A dump has the following shape:

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

`camus-dump` writes each value as a CamusSQL literal that gives the same stored
value when it is loaded:

| Type | Dump form |
| --- | --- |
| `OID` | `STR_ID('...')` |
| `STRING` | `'...'`, or `E'...'` if the string has a backslash or a control character |
| `INT64` | An integer literal |
| `FLOAT64`, `FLOAT32` | A numeric literal with all its digits |
| `NUMERIC` | `NUMERIC '...'`, an exact typed literal |
| `BOOL` | `true` or `false` |
| `BYTES` | `X'...'`, a hex literal |
| `DATE` | A quoted `yyyy-MM-dd` string |
| `DATETIME` | A quoted ISO 8601 string, with seven fractional digits when needed |
| `UUID` | A quoted canonical UUID string |
| `JSONB` | `JSONB '...'` |
| `ARRAY` | `ARRAY[...]` |
| `NULL` | `NULL` |

A string with special characters, such as backslashes or NUL characters, is
loaded back unchanged. For the literal rules, see
[Data types](/docs/data-types#string-literals).

The dump writes each index twice: in the `CREATE TABLE`, and as a separate
`CREATE INDEX IF NOT EXISTS` statement. An index definition has the sort
direction and the comment of each column, if the source server returns them.
This means that the indexes are in the dump also with `--no-create-table`, and
that `--defer-indexes` can build them after the rows.

For [expression indexes](/docs/sql-indexes#expression-indexes), use a version
of camus-dump that reads the `Key` column from `SHOW INDEXES`. Older versions
stop with an error when they encounter an expression key.

## Sequences and identity values

The dump restores the sequences and their positions.

Free-standing sequences come before the tables. A column default can use
one. Each `CREATE SEQUENCE` is followed by `SELECT setval('name', n)`,
which restores its position. Identity and `serial` columns create their
sequences through `CREATE TABLE`. Their `setval` comes after the rows of the
table.

The rows are inserted with explicit values, which don't move a sequence.
Without `setval`, a restored sequence could return values that restored rows
already have. Note that each `setval` takes about five seconds. It waits for
the storage lease. A dump with many sequences takes longer to load.
For more information, see [Sequences](/docs/sequences).

`GENERATED ALWAYS AS IDENTITY` normally doesn't accept a supplied value. The
`INSERT` statements for such tables use `OVERRIDING SYSTEM VALUE`. This means
that the restored rows keep their identity values.

The sequence definitions and positions are current when the dump starts. They
aren't historical with `--as-of`. The server doesn't keep the history of
sequences. `--no-create-table` leaves out `CREATE SEQUENCE`, and `--no-data`
leaves out the positions.

## Foreign keys

`camus-dump` orders tables and rows so that a restore can check all the foreign
keys in one pass.

A table is written after the tables that it references. With
`--add-drop-table`, the drops are in the opposite order: child tables before
their parents.

In a self-referencing table, parent rows are written before their child rows.
Rows that reference each other in a cycle can't be loaded with separate
statements. The utility writes them together in one `INSERT` at the end of the
table, and prints a warning. That `INSERT` doesn't follow `--batch`.

If a filter, such as `--table` or `--where`, leaves out a parent table or a
parent row, the parent must already exist on the target. The utility prints a
warning when a dumped table references a table that the table filters exclude.

## Lossy values

Most stored values have an exact SQL literal. `camus-dump` prints a warning for
each value that it can't restore exactly.

A non-finite float is written as a cast, for example `CAST('NaN' AS float64)`
or `CAST('-Infinity' AS float32)`. The dump then prints a note. An older
server doesn't accept these casts. For more information, see
[Floating-point values](/docs/data-types#floating-point-values). `camus-dump`
0.18.0 and later keep these values over both protocols. An older version can
write `NULL` in their place.

`DATETIME` values keep their full precision. A value with a fraction smaller
than a millisecond is written with seven fractional digits.

## Restore a dump

To restore a dump, load it with `camus-cli`. Put the target database in the
connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5096;Protocol=grpc;Database=factory" \
  -f factory.sql
```

`-f` stops at the first error. If the dump doesn't have `CREATE DATABASE`,
create the target database first. In an interactive `camus-cli` session, you
can also load a file with `source`:

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
unless you used `--no-header`. Check for that comment when a dump went to
object storage, or through a pipeline that can keep a partial upload.

For interactive loads, see [camus-cli](/docs/camus-cli).
