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
- database switching
- vertical query output for wide rows
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

From the current source code, the default connection string is:

```text
Endpoint=http://localhost:5095;Database=test
```

The database named in the connection string must exist before you run table DDL,
DML, or queries against it. You can create databases from the shell:

```camussql
CREATE DATABASE IF NOT EXISTS test;
```

Open a different database with the positional database argument:

```bash
camus-cli northwind
```

Open a custom endpoint and database with an explicit connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind"
```

The connection string must include a valid absolute `Endpoint`. Include
`Database` when you want the shell to start with a selected database.

If no database is selected, system-level commands such as `CREATE DATABASE`,
`DROP DATABASE`, `RENAME DATABASE`, `SHOW DATABASES`, `SHOW BRANCHES FROM ...`,
and `SHOW ANCESTORS FROM ...` still work. Table DDL, DML, and ordinary queries
require a selected database.

## Command Line Syntax

```text
camus-cli [database] [options]
camus-cli workload <init|run> <bank|northwind|factory|tpcc> [options]
```

Options:

| Option | Description |
| --- | --- |
| `[database]` | Optional database name. Defaults to `test`. |
| `-c`, `--connection-source` | Full connection string. If it has no `Database=...`, the shell starts without a selected database. |
| `--force-rich` | Force the rich editor on terminals whose capabilities are not detected automatically. |
| `--diagnose-terminal` | Print terminal capability detection details and exit. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version. |

Environment variables:

| Variable | Description |
| --- | --- |
| `CAMUS_FORCE_RICH` | Set to `1`, `true`, or `yes` to force the rich editor. |

Examples:

```bash
camus-cli
camus-cli mydb
camus-cli -c "Endpoint=http://localhost:5095;Database=mydb"
camus-cli -c "Endpoint=http://localhost:5095"
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
| `source <path>` | Execute SQL from a file. |
| `use <database>` | Switch to another database. |
| `exit` / `quit` | Exit the shell. |

Examples:

```camussql
use northwind;
source ./schema.sql
clear
exit
```

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

Completion is context-aware. After keywords that usually expect a table name,
such as `from`, `into`, `update`, `join`, `table`, `desc`, and `describe`, the
shell suggests table names from the current database. Elsewhere it suggests SQL
keywords, functions, constants, and shell commands.

```camussql
select * from us<Tab>
insert into <Tab>
sel<Tab>
```

Table names are loaded with `SHOW TABLES` and refreshed on startup, after
`use <database>`, and after `CREATE TABLE` or `DROP TABLE`.

## Database Switching

You can change the current database without leaving the shell:

```camussql
use analytics;
```

This rewrites the active connection string to replace the `Database=...` part,
then opens a new connection to that database. The target database must already
exist; `use` does not create it.

## Source Files

Execute a SQL script file:

```camussql
source ./seed.sql
```

The shell reads the file, splits statements on semicolons outside quoted
strings, and runs them one by one.

Statements terminated with `\G` inside source files use vertical output.

## Workload Subcommand

The CLI also includes a workload helper:

```bash
camus-cli workload <init|run> <bank|northwind|factory|tpcc> [options]
```

Supported workloads:

- `bank`
- `northwind`
- `factory`
- `tpcc`

Workload options:

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | Connection string. |
| `--database` | Target database. Default: `demo`. |
| `--rows` | Rows to generate for `init`. Default: `1000`; used by `bank` and as the warehouse count for `tpcc`. |
| `--concurrency` | Parallel workers for `run`. Default: `3`. |
| `--duration` | Run duration in seconds. Default: `60`. |

Examples:

```bash
camus-cli workload init bank --database demo --rows 5000
camus-cli workload run northwind --concurrency 5 --duration 120
camus-cli workload init factory --database factory
camus-cli workload run factory --concurrency 4 --duration 120
camus-cli workload init tpcc --database tpcc --rows 1
camus-cli workload run tpcc --concurrency 4 --duration 120
```

If no connection string is supplied, the workload command defaults to:

```text
Endpoint=http://localhost:5095;Database=demo
```

If `-c` / `--connection-source` does not include `Database=...`, the workload
command appends the value from `--database`.

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
- script execution from `.sql` files
- manual transaction testing
- lightweight workload bootstrapping for demos and experiments

For application integration, see [.NET Driver](/docs/dotnet-driver) and
[EF Core Provider](/docs/ef-core).
