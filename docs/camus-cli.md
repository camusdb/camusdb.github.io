---
sidebar_position: 1.5
---

# camus-cli

`camus-cli` is the interactive command-line SQL shell for CamusDB.

It connects through the CamusDB .NET driver and gives you:

- an interactive SQL prompt
- multiline editing
- syntax highlighting
- Tab autocompletion
- command history
- transaction commands
- SQL script execution
- non-interactive SQL execution with `-e`, and whole-file execution with `-f`
- database switching
- vertical query output for wide rows
- prepared-statement inspection
- backup administration
- built-in workload helpers

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.SqlSh
```

Update it:

```bash
dotnet tool update --global CamusDB.SqlSh
```

The executable name installed by the tool is:

```bash
camus-cli
```

The current tool package targets `net10.0`.

## Basic Usage

Start the shell with defaults:

```bash
camus-cli
```

With no connection string, the shell tries the local gRPC listener first and
falls back to the local REST listener:

```text
Endpoint=http://localhost:5096;Database=<database>;Protocol=grpc
Endpoint=http://localhost:5095;Database=<database>;Protocol=rest
```

If you do not pass a positional database name, the connection starts without a
selected database. System-level commands still work, and you can create or
select a database from the shell:

```camussql
CREATE DATABASE IF NOT EXISTS test;
USE test;
```

Open a different database with the positional database argument:

```bash
camus-cli northwind
```

This tries `http://localhost:5096` with `Protocol=grpc` first, then
`http://localhost:5095` with `Protocol=rest`.

Open a custom endpoint and database with an explicit connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind"
```

The connection string must include a valid absolute `Endpoint`. Include
`Database` when you want the shell to start with a selected database.
If the connection string does not include `Protocol=...`, the shell tries gRPC
and then REST against the supplied endpoint. If you include `Protocol=grpc` or
`Protocol=rest`, that explicit choice is honored with no fallback.

If no database is selected, system-level commands such as `CREATE DATABASE`,
`DROP DATABASE`, `RENAME DATABASE`, `ALTER DATABASE ... RENAME TO`,
`COMMENT ON DATABASE`, `CREATE USER`, `ALTER USER`, `DROP USER`, `GRANT`,
`REVOKE`, `SHOW GRANTS`, `CREATE DATABASE ... RELINK TO`, `SHOW DATABASES`,
`SHOW ORPHAN DATABASES`, `SHOW BRANCHES FROM ...`, and `SHOW ANCESTORS FROM ...`
still work. Table DDL, DML, table orphan recovery, and ordinary queries require
a selected database.

## Authentication

CamusDB authentication is off by default. A shell started without credentials
behaves as before. Against a server with authentication enabled, pass a user and
password:

```bash
camus-cli northwind -u app -p app-secret
```

If `-u` is given without `-p`, the shell prompts for the password without
echoing it:

```bash
camus-cli northwind -u app
```

Credentials can also come from environment variables:

```bash
export CAMUS_USER=app
export CAMUS_PASSWORD=app-secret
camus-cli northwind
```

or from the connection string:

```bash
camus-cli -c "Endpoint=https://db.example.com:7141;Database=northwind;User=app;Password=app-secret"
```

Flags override the same keys inside `-c`. If another process already obtained a
bearer token, pass it with `--token` or `CAMUS_ACCESS_TOKEN`; the token is used
directly and is not renewed.

The driver exchanges the password once for a short-lived bearer token. Later
statements carry the token, not the password, and the driver renews it before
expiry when it has the password. Prefer the prompt or `CAMUS_PASSWORD` over
`-p` on shared hosts because process command lines are visible to other local
users.

User and grant administration works before a database is selected because those
statements are server-level:

```camussql
CREATE USER app IDENTIFIED BY 'app-secret';
ALTER USER app IDENTIFIED BY 'rotated-secret';
GRANT SELECT, INSERT ON northwind.* TO app;
GRANT SELECT ON northwind.orders TO reader;
REVOKE INSERT ON northwind.* FROM app;
SHOW GRANTS FOR app;
DROP USER app;
```

Statements that inline a password with `IDENTIFIED ... BY '...'` remain
available in in-memory history during the session, but are not written to the
on-disk history file.

Common auth errors:

| Code | Meaning |
| --- | --- |
| `CADB0516` | Not authenticated: missing, invalid, expired, or rejected credentials. |
| `CADB0517` | Authenticated, but missing a privilege on a table touched by the statement, including joins and subqueries. |
| `CADB0519` | The server requires TLS for credential-bearing requests. Use `https://`, or configure the server for a trusted TLS-terminating proxy. |

## Command Line Syntax

```text
camus-cli [database] [options]
camus-cli workload <init|run> <bank|northwind|factory|tpcc|tpcb> [options]
```

Options:

| Option | Description |
| --- | --- |
| `[database]` | Optional database name. If omitted, the shell starts without a selected database. |
| `-c`, `--connection-source` | Full connection string. If it has no `Database=...`, the shell starts without a selected database. |
| `-e`, `--execute` | Execute one SQL string, or several separated by semicolons, and exit instead of starting the interactive shell. |
| `-f`, `--file` | Execute the statements in a `.sql` file and exit, stopping at the first error. Use `-f -` to read the script from standard input. |
| `-u`, `--user` | User to authenticate as. |
| `-p`, `--password` | Password for `-u`. If omitted in interactive use, the shell prompts. |
| `--token` | Use an existing bearer token instead of logging in with a password. |
| `--force-rich` | Force the rich editor on terminals whose capabilities are not detected automatically. |
| `--diagnose-terminal` | Print terminal capability detection details and exit. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version. |

Environment variables:

| Variable | Description |
| --- | --- |
| `CAMUS_FORCE_RICH` | Set to `1`, `true`, or `yes` to force the rich editor. |
| `CAMUS_USER` | Default for `-u`. |
| `CAMUS_PASSWORD` | Default for `-p`. Useful in scripts because it keeps the password out of the process command line. |
| `CAMUS_ACCESS_TOKEN` | Default for `--token`. |

Examples:

```bash
camus-cli
camus-cli mydb
camus-cli mydb -u app
camus-cli mydb -u app -p app-secret
camus-cli -c "Endpoint=http://localhost:5095;Database=mydb"
camus-cli -c "Endpoint=http://localhost:5096;Database=mydb;Protocol=grpc"
camus-cli -c "Endpoint=http://localhost:5095;Database=mydb;Protocol=rest"
camus-cli -c "Endpoint=http://localhost:5095"
camus-cli mydb -e "SELECT * FROM users"
camus-cli mydb -f schema.sql
cat schema.sql | camus-cli mydb -f -
camus-cli --diagnose-terminal
CAMUS_FORCE_RICH=1 camus-cli
camus-cli --help
camus-cli --version
```

## Interactive Shell

Primary prompt:

```text
camus>
```

Multiline continuation prompt:

```text
   ->
```

Built-in shell commands:

| Command | Description |
| --- | --- |
| `clear` | Clear the terminal screen. |
| `source <path> [--force]` | Execute SQL from a file, streaming it. |
| `use <database>` | Switch to another database. |
| `show prepared [sql]` | Report what the driver keeps prepared. Alias: `\prepared`. |
| `backup ...` | Take and administer server backups. |
| `exit` / `quit` | Exit the shell. |

Examples:

```camussql
use northwind;
source ./schema.sql
show prepared
backup list
clear
exit
```

These are the shell's own commands, not server SQL. `use` and `backup` in
particular have no server-side statement form.

Important guards:

- if a transaction is active, `exit` and `quit` are blocked until you `commit`
  or `rollback`
- if a transaction is active, `use <database>` is also blocked

## Multiline Input

The shell supports multiline SQL. It keeps collecting input while the statement
looks incomplete.

Current incomplete cases include:

- open single-quoted string
- open double-quoted string
- unmatched `(`
- trailing comma

Example:

```camussql
select
  id,
  name
from users
where active = true;
```

The shell also splits multiple statements on semicolons, while leaving
semicolons inside quoted strings alone.

Pasting multiline SQL works too. When a pasted statement spans several lines,
the editor turns the pasted `Enter` keys into new lines instead of submitting
each line as it arrives.

## Non-Interactive Execution

Use `-e` or `--execute` to run SQL and exit without starting the prompt:

```bash
camus-cli northwind -e "SELECT * FROM users"
camus-cli -c "Endpoint=http://localhost:5096;Database=northwind;Protocol=grpc" -e "SHOW TABLES"
```

Several semicolon-separated statements can run in one call:

```bash
camus-cli demo -e "INSERT INTO users (id, name) VALUES (gen_id(), 'Ada'); SELECT * FROM users"
```

Vertical output also works:

```bash
camus-cli demo -e "SELECT * FROM users\G"
```

This mode is useful for scripts, CI jobs, cron jobs, and shell redirection:

```bash
camus-cli demo -e "SELECT * FROM users" > users.txt
```

### Running A .sql File

Use `-f` or `--file` to run every statement in a file and exit, so a schema or a
migration can be applied without opening the interactive console:

```bash
camus-cli northwind -f schema.sql
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind" -f seed.sql
```

Statements are separated by semicolons and run in order, with `\G` and comments
handled exactly as by `source` inside the shell. The file is streamed, so its
size does not matter.

Execution stops at the first statement that fails. The error is printed with the
offending statement and the line it started on, the remaining statements are
left unrun, and the process exits with status `1`.

Pass `-` as the path to read the script from standard input:

```bash
cat schema.sql | camus-cli northwind -f -

camus-cli northwind -f - <<'SQL'
create table users (id oid primary key, name string);
insert into users values (gen_id(), 'Ada');
SQL
```

`-f` and `-e` combine, and the file runs first, so `-e` can read back what it
wrote:

```bash
camus-cli demo -f seed.sql -e "select count(*) from users"
```

## Prepared Statements

The driver registers a statement with the server once it has seen the same SQL
text a few times, and runs it prepared from then on. Nothing has to be enabled,
and a prepared execution returns exactly what an inline one does.

`show prepared` reports what is currently registered:

```text
camus> show prepared
Prepared statements: 1 (MaxAutoPrepare=128, AutoPrepareMinUsages=2)
  prepared     select id from robots where year = 1984
(the statement you ran last)
```

Pass a statement to ask about that one instead of the last one you ran:

```camussql
show prepared select id from robots where year = 1984
```

`\prepared` is an alias for both forms.

Statements typed at the prompt usually report as `inline`. They carry their
values in the SQL text, so each execution is distinct text and never repeats
often enough to be registered. The statements that do get prepared are the ones
a `source` file or an application repeats verbatim.

Both thresholds come from the connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=demo;MaxAutoPrepare=512;AutoPrepareMinUsages=1"
```

`MaxAutoPrepare` is how many statements stay registered, where `0` turns
registration off, and `AutoPrepareMinUsages` is how many executions come first.
See
[Parameters And Prepared Statements](/docs/prepared-statements).

## Backups

The `backup` family drives the server's online backup and point-in-time-recovery
administration. All of it is safe while the server serves traffic.

```text
backup full                            take a full backup
backup incremental <parent-backup-id>  chain an incremental onto a backup
backup coordinated                     take a cluster-wide consistent backup
backup list                            list the node's backup catalog
backup chain <leaf-backup-id>          resolve and validate a restore chain
backup gc preview                      report what retention would reclaim
backup gc                              run retention now
```

`backup` on its own, or `backup help`, prints that list.

A typical session takes a full backup, chains an incremental onto it, then
checks that the chain would actually restore:

```text
camus> backup full
    Backup Id: 971a0a88-3d36-42c6-b36b-8d1e773f40c4
         Type: Full
Created (UTC): 2026-08-10 03:45:47
       Parent: (none)
   Partitions: 4
Backup OK (00:00:03.117)

camus> backup incremental 971a0a88-3d36-42c6-b36b-8d1e773f40c4
camus> backup chain 719b7b6b-281d-4979-bf63-b495a7d1bdaf
```

`backup chain` is the validating read: a chain that cannot be assembled is
rejected here rather than at restore time, which makes it a "would this backup
actually restore?" check. It prints the chain root-first and, underneath, the
recoverable window a point-in-time restore may target.

Things worth knowing:

- Backups are node-wide, not per-database. Every database on the server
  shares one storage node. Nothing here is scoped to the current database, and
  the commands work with no database selected.
- The server must opt in. Backups are off until `kahuna.backup_dir` is set;
  until then every command fails with `CADB0700 BackupNotConfigured`.
- Superuser only. With authentication enabled, connect as a superuser with
  `-u` or `--token`. With authentication *disabled* the server restricts this
  surface to loopback callers, so a remote shell is refused rather than allowed
  to take an anonymous node-wide backup.
- An incremental can become a full. If the parent has aged past the
  retention floor, the server takes a full backup instead. The command still
  succeeds and reports the substitution and its reason.
- `backup coordinated` must reach the coordinator. Any other node refuses
  with `CADB070E BackupNotCoordinator`. Pin `BackupEndpoint=` to the coordinator
  when `Endpoint=` names a multi-node pool.
- The API is REST-only. It has no SQL form and no gRPC service. The shell
  points its default gRPC connection at the well-known HTTP port for you;
  against a `-c` connection string with an explicit `Protocol=grpc`, add
  `BackupEndpoint=` naming the server's HTTP endpoint.
- Backup requests use their own timeout. `BackupTimeout=` in the connection
  string, 300 seconds by default, rather than the statement timeout, because a
  full backup copies a whole node's base image.

Retention runs automatically after each backup and on a periodic tick, so
`backup gc` is only needed to reclaim space immediately after tightening the
limits. Preview it first; the preview deletes nothing:

```text
camus> backup gc preview
Retention preview: 2 backups, 0 orphans, 1.41 GB would reclaim (00:00:00.041)
```

Restore is not here. A restore rebuilds into a fresh data root, after which
the server is stopped and a new one booted against it. There is no hot in-place
restore, so it stays an operator runbook step rather than something the shell can
drive to completion. See [Backup And Restore](/docs/backup-and-restore).

## History

The shell loads and saves command history automatically.

History file:

```text
camusdb.history.json
```

It is stored under the system temporary directory.

Behavior from the current source:

- history is loaded on startup
- history is saved on normal exit
- history is also saved on `Ctrl+C`
- adjacent duplicate entries are removed
- statements that inline passwords with `IDENTIFIED ... BY ...` are kept out of
  the on-disk history file

## Keyboard Shortcuts

The enhanced editor supports:

| Key | Action |
| --- | --- |
| `Enter` | Submit the current statement. |
| `Shift+Enter` | Insert a new line. |
| `Up` / `Down` | Navigate lines or command history. |
| `Left` / `Right` | Move the cursor. |
| `Ctrl+Left` / `Ctrl+Right` | Move by word. |
| `Home` / `End` | Jump within the current line. |
| `PageUp` / `PageDown` | Jump to first or last multiline line. |
| `Backspace` / `Delete` | Delete text. |
| `Tab` | Autocomplete the current word. |
| `Ctrl+Tab` | Cycle to the previous completion. |

## SQL Execution

`camus-cli` routes statements by shape:

- query statements are shown as result tables
- DDL prints `Query OK`
- inserts, updates, and deletes print affected row counts

Queries include:

```camussql
select * from users;
explain select * from users;
explain (logical) select * from users;
explain (physical) select * from users;
explain (analyze) select * from users;
show tables;
desc users;
describe users;
show databases;
show columns from users;
describe indexes from users;
show branches from app;
show ancestors from app_test;
```

DDL includes:

```camussql
create database app;
create database if not exists app;
show databases;
rename database app to app_prod;
drop database if exists app_prod;
create database app_test branch from app_prod;

create table users (
  id oid primary key not null,
  name string not null
);

create index users_name_idx on users (name);
alter table users add column active bool default (true);
alter table users rename column name to display_name;
alter table users rename to app_users;
alter table app_users add constraint active_check check (active is not null);
drop table users;
```

Mutations include:

```camussql
insert into users (id, name) values (gen_id(), 'Ada');
update users set name = 'A. Lovelace' where id = '...';
delete from users where name = 'A. Lovelace';
```

## Vertical Output

Terminate a query with `\G` instead of `;` to print each row vertically. This is
useful for wide rows, long JSON values, or inspection commands with many
columns.

```camussql
select * from users\G
```

Example shape:

```text
*************************** 1. row ***************************
  id: 6a3dd713d615ae230488d7f2
name: Ada
1 rows in set (00:00:00.0123456)
```

`\G` also works in `source` files and in batches with multiple statements.

## Transactions

The shell has explicit transaction commands:

```camussql
begin;
commit;
rollback;
```

It also recognizes:

```camussql
start transaction;
```

Rules from the current implementation:

- only one active transaction is allowed at a time
- `commit` with no active transaction shows an error
- `rollback` with no active transaction shows an error
- after `commit` or `rollback`, the shell clears its local transaction state
- on `Ctrl+C`, an active transaction is rolled back before exit

## Syntax Highlighting

The interactive editor highlights:

- SQL keywords
- built-in shell commands
- booleans
- quoted strings
- numeric literals
- supported function names

The keyword and function list is embedded in the shell, so it tracks what the
CLI knows how to color even if it does not affect server-side SQL support.

The current highlighter includes newer CamusSQL types and keywords such as
`UUID`, `GUID`, `BYTES`, `BLOB`, `DATE`, `DATETIME`, `TIMESTAMP`, `ARRAY`,
`DATABASES`, `BRANCH`, `BRANCHES`, `ANCESTORS`, `ISOLATION LEVEL`,
`READ COMMITTED`, `SERIALIZABLE`, and transaction access keywords.

It also highlights line and block comments:

```camussql
-- one-line comment
/* block comment */
select gen_uuid_v7(), now();
```

## Autocompletion

Press `Tab` to autocomplete the word under the cursor. Press `Tab` again to
cycle forward through matches, or `Ctrl+Tab` to cycle backward.

Completion is context-aware. After a keyword that expects a relation name
(`from`, `into`, `update`, `join`, `table`, `view`, `desc`, or `describe`), the
shell suggests the table and view names of the current database. Elsewhere it
suggests SQL keywords, functions, constants, and shell commands.

```camussql
select * from us<Tab>
insert into <Tab>
sel<Tab>
```

Relation names are loaded with `SHOW TABLES`, `SHOW VIEWS`, and
`SHOW MATERIALIZED VIEWS`. They refresh on startup, after `use <database>`, and
after any statement that changes the set of relations: `CREATE`/`DROP TABLE`,
`CREATE [OR REPLACE]`/`DROP`/`ALTER VIEW`, and their materialized forms.

## Database Switching

You can change the current database without leaving the shell:

```camussql
use analytics;
use `order details`;
```

This rewrites the active connection string to replace the `Database=...` part,
then opens a new connection to that database. The target database must already
exist; `use` does not create it.

The name may be bare, `` `backticked` ``, or `"quoted"`. The quoted forms are
how a name that collides with a keyword or contains spaces is written.

`use` is handled by the shell, not the server, and works in script files and
with `-e` as well as at the prompt. A dump can therefore switch databases
mid-file, and a session started without a database can select one from its first
statement.

## Source Files

Execute a SQL script file:

```camussql
source ./seed.sql
```

The file is streamed rather than read into memory, so a dump larger than RAM
sources fine and the first statement runs immediately instead of after the whole
file has been parsed.

Statements are split on semicolons, ignoring any that fall inside `'strings'`,
`"strings"`, `` `quoted identifiers` ``, `-- line comments`, `# line comments`,
or `/* block comments */`. Doubled quotes (`'it''s'`) and backslash escapes
(`'it\'s'`) are understood, and comments are stripped before a statement is sent
to the server.

Statements terminated with `\G` inside source files use vertical output.

Execution stops at the first statement that fails, reporting the file and the
line the statement started on. Pass `--force` to carry on instead and print a
summary at the end:

```camussql
source ./seed.sql --force
```

An open transaction stops the file either way. The server has already aborted
it, so every remaining statement would fail too.

A file may contain `use` statements to switch databases as it goes. A `use`
inside an open transaction is refused and stops the file, since the rest of it
would otherwise run against the wrong database.

## Workload Subcommand

The CLI also includes a workload helper:

```bash
camus-cli workload <init|run> <bank|northwind|factory|tpcc|tpcb> [options]
```

Supported workloads:

- `bank`
- `northwind`
- `factory`
- `tpcc`
- `tpcb`

Workload options:

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | Connection string. |
| `--database` | Target database. Default: `demo`. |
| `--rows` | Rows to generate for `init`. Default: `1000`. Accounts for `bank` and `tpcb`, warehouses for `tpcc`. |
| `--concurrency` | Parallel workers for `run`, and parallel writers for `init`. Default: `64`. |
| `--duration` | Run duration in seconds. Default: `60`. |
| `--locking` | Transaction locking mode: `optimistic` or `pessimistic`. Default: `optimistic`. |
| `--isolation` | Isolation level: `serializable` or `read-committed`. Default: `serializable`. |
| `--no-prepare` | Run every statement inline instead of preparing it, to compare against the default prepared path. |
| `-u`, `--user` | User to authenticate as. Also read from `CAMUS_USER`. |
| `-p`, `--password` | Password for `-u`. Also read from `CAMUS_PASSWORD`. |

Examples:

```bash
camus-cli workload init bank --database demo --rows 5000
camus-cli workload run northwind --concurrency 5 --duration 120
camus-cli workload init factory --database factory
camus-cli workload run factory --concurrency 4 --duration 120
camus-cli workload init tpcc --database tpcc --rows 1
camus-cli workload run tpcc --concurrency 4 --duration 120
camus-cli workload init tpcb --database tpcb --rows 10000
camus-cli workload run tpcb --concurrency 8 --duration 120
```

If no connection string is supplied, the workload command defaults to:

```text
Endpoint=http://localhost:5096;Database=demo;Protocol=grpc
Endpoint=http://localhost:5095;Database=demo;Protocol=rest
```

If `-c` / `--connection-source` does not include `Database=...`, the workload
command appends the value from `--database`.

Like the interactive shell, workloads try gRPC first and REST second unless the
connection string pins `Protocol=...`. Workloads also set a wider default
command timeout for batched commits.

## Terminal Detection

The rich editor is enabled when the terminal reports ANSI support, interactive
input, and terminal output. If a capable terminal is not detected correctly, use
the diagnostic flag:

```bash
camus-cli --diagnose-terminal
```

Force the rich editor when you know the terminal supports it:

```bash
camus-cli --force-rich
```

or persistently:

```bash
export CAMUS_FORCE_RICH=1
```

## Connection Validation

Before the shell opens a connection, it validates that the connection string has:

- a valid absolute `Endpoint`

It also performs an initial ping so startup fails early if the target node is
not reachable.

When no database is selected, run `CREATE DATABASE ...` or `use <database>`
before table-level work.

## When To Use It

Use `camus-cli` when you want:

- a quick interactive SQL session
- easy local development against a CamusDB node
- script execution from `.sql` files, interactively or with `-f`
- manual transaction testing
- taking and inspecting backups without writing HTTP calls by hand
- lightweight workload bootstrapping for demos and experiments

For application integration, see [.NET Driver](/docs/dotnet-driver) and
[EF Core Provider](/docs/ef-core).
