---
sidebar_position: 1.5
---

# camus-cli

`camus-cli` is the interactive command-line SQL shell for CamusDB.

It connects through the CamusDB .NET driver and gives you:

- an interactive SQL prompt
- multiline editing
- syntax highlighting
- command history
- transaction commands
- SQL script execution
- database switching
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

## Basic Usage

Start the shell with defaults:

```bash
camus-cli
```

From the current source code, the default connection string is:

```text
Endpoint=http://localhost:5095;Database=test
```

Open a different database with the positional database argument:

```bash
camus-cli northwind
```

Open a custom endpoint and database with an explicit connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind"
```

The connection string must include both:

- `Endpoint`
- `Database`

## Command Line Syntax

```text
camus-cli [database] [options]
camus-cli workload <init|run> <bank|northwind> [options]
```

Options:

| Option | Description |
| --- | --- |
| `[database]` | Optional database name. Defaults to `test`. |
| `-c`, `--connection-source` | Full connection string. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show version. |

Examples:

```bash
camus-cli
camus-cli mydb
camus-cli -c "Endpoint=http://localhost:5095;Database=mydb"
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

```sql
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

```sql
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

## SQL Execution

`camus-cli` routes statements by shape:

- query statements are shown as result tables
- DDL prints `Query OK`
- inserts, updates, and deletes print affected row counts

Queries include:

```sql
select * from users;
explain select * from users;
explain (logical) select * from users;
explain (physical) select * from users;
explain (analyze) select * from users;
show tables;
desc users;
describe users;
```

DDL includes:

```sql
create table users (
  id oid primary key not null,
  name string not null
);

create index users_name_idx on users (name);
alter table users add column active bool default (true);
drop table users;
```

Mutations include:

```sql
insert into users (id, name) values (gen_id(), 'Ada');
update users set name = 'A. Lovelace' where id = '...';
delete from users where name = 'A. Lovelace';
```

## Transactions

The shell has explicit transaction commands:

```sql
begin;
commit;
rollback;
```

It also recognizes:

```sql
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

## Database Switching

You can change the current database without leaving the shell:

```sql
use analytics;
```

This rewrites the active connection string to replace the `Database=...` part,
then opens a new connection to that database.

## Source Files

Execute a SQL script file:

```sql
source ./seed.sql
```

The shell reads the file, splits statements on semicolons outside quoted
strings, and runs them one by one.

## Workload Subcommand

The CLI also includes a workload helper:

```bash
camus-cli workload <init|run> <bank|northwind> [options]
```

Supported workloads:

- `bank`
- `northwind`

Workload options:

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | Connection string. |
| `--database` | Target database. Default: `demo`. |
| `--rows` | Rows to generate for `init`. Default: `1000` for `bank`. |
| `--concurrency` | Parallel workers for `run`. Default: `3`. |
| `--duration` | Run duration in seconds. Default: `60`. |

Examples:

```bash
camus-cli workload init bank --database demo --rows 5000
camus-cli workload run northwind --concurrency 5 --duration 120
```

If no connection string is supplied, the workload command defaults to:

```text
Endpoint=http://localhost:5095;Database=demo
```

## Connection Validation

Before the shell opens a connection, it validates that the connection string has:

- a valid absolute `Endpoint`
- a non-empty `Database`

It also performs an initial ping so startup fails early if the target node is
not reachable.

## When To Use It

Use `camus-cli` when you want:

- a quick interactive SQL session
- easy local development against a CamusDB node
- script execution from `.sql` files
- manual transaction testing
- lightweight workload bootstrapping for demos and experiments

For application integration, see [.NET Driver](/docs/dotnet-driver) and
[EF Core Provider](/docs/ef-core).
