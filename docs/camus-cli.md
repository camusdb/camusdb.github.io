---
sidebar_position: 1.5
---

# camus-cli

![camus-cli interactive shell](/img/screenshots/cli.webp)

`camus-cli` is the command-line SQL shell for CamusDB. You type SQL in a
terminal and see the results immediately. It is the fastest way to talk to a
CamusDB node without an application or a graphical tool.

## When to use it

Use `camus-cli` for:

- Quick interactive SQL sessions to look at data or test a query.
- Local development against a CamusDB node.
- Running `.sql` script files, interactively or with `-f`, such as schema setup
  in a CI job.
- Testing transactions by hand.
- Taking and inspecting backups without making HTTP calls by hand.
- Small workloads for demos or experiments.

For a graphical workspace in a browser, see [Web Console](/docs/web-console).
To integrate with an application, use a driver, such as the
[.NET driver](/docs/dotnet-driver), [EF Core provider](/docs/ef-core),
[TypeScript connector](/docs/typescript-connector), or
[Python driver](/docs/python-driver).

## Features

- An interactive prompt with syntax highlighting, Tab autocompletion, and
  history, plus a full-screen mode with catalog, editor, and result panes.
- Scripted execution with `-e` and `-f`, with JSON or YAML output.
- Result export to CSV, JSON, or YAML.
- Backup administration and prepared-statement inspection.
- Built-in workloads for demos and load tests.

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.SqlSh
```

Update it:

```bash
dotnet tool update --global CamusDB.SqlSh
```

The tool installs this executable:

```bash
camus-cli
```

## Basic usage

Start the shell with defaults:

```bash
camus-cli
```

Without a connection string, the shell tries the local gRPC listener first,
then falls back to the local REST listener:

```text
Endpoint=http://localhost:5096;Database=<database>;Protocol=grpc
Endpoint=http://localhost:5095;Database=<database>;Protocol=rest
```

If you do not pass a database name as the first argument, the connection
starts with no selected database.

You can create a database from the shell and then select it:

```camussql
CREATE DATABASE IF NOT EXISTS test;
USE test;
```

To open a different database, pass its name as the first argument:

```bash
camus-cli northwind
```

That command tries `http://localhost:5096` with `Protocol=grpc` first, then
`http://localhost:5095` with `Protocol=rest`.

To open your own endpoint and database, use an explicit connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind"
```

The connection string must contain a valid absolute `Endpoint` or a
comma-separated pool of absolute endpoints:

```bash
camus-cli -c "Endpoint=http://node1:5096,http://node2:5096;Database=northwind;Protocol=grpc"
```

The driver can use the endpoint pool across requests. Add `Database` when the
shell must start with a selected database.

If the connection string has no `Protocol=...`, the shell tries gRPC against
the supplied endpoint, then REST. If it has `Protocol=grpc` or
`Protocol=rest`, the shell honors that choice with no fallback.

Server-level commands work without a selected database:

- `CREATE DATABASE`, `DROP DATABASE`, `RENAME DATABASE`, and
  `ALTER DATABASE ... RENAME TO`.
- `COMMENT ON DATABASE`.
- `CREATE USER`, `ALTER USER`, and `DROP USER`.
- `GRANT`, `REVOKE`, and `SHOW GRANTS`.
- `CREATE DATABASE ... RELINK TO`.
- `SHOW DATABASES`, and `SHOW ORPHAN DATABASES`.
- `SHOW BRANCHES FROM ...`, and `SHOW ANCESTORS FROM ...`.

Table DDL, DML statements, orphan table recovery, and ordinary queries need a
selected database.

## Authentication

CamusDB authentication is off by default, so a shell without credentials
behaves as it always did.

Against a server with authentication enabled, pass a user and password:

```bash
camus-cli northwind -u app -p app-secret
```

Prefer a prompt to putting the password on the command line. Give `-u` without
`-p`, or give a bare `-p`; both forms ask for the password without echoing it:

```bash
camus-cli northwind -u app
camus-cli northwind -u app -p
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

A flag overrides the same key inside `-c`.

If another process already holds a bearer token, pass it with `--token` or
`CAMUS_ACCESS_TOKEN`. The shell uses the token directly and does not renew it.

The driver exchanges the password once for a short-lived bearer token. Later
statements carry the token, not the password. While the driver holds the
password, it renews the token before it expires.

On a shared host, prefer the prompt or `CAMUS_PASSWORD` to `-p app-secret`.
Other local users can see a process's command line, and the shell prints a
warning when you pass a password that way.

The shell refuses to send credentials to a non-local `http://` endpoint. Use
`https://` for remote authenticated connections. If TLS terminates before
CamusDB and the final hop is protected by your own network, pass
`--allow-insecure-credentials`; the shell then connects and prints a warning.

User and grant administration works without a selected database, because
those statements are server-level:

```camussql
CREATE USER app IDENTIFIED BY 'app-secret';
ALTER USER app IDENTIFIED BY 'rotated-secret';
GRANT SELECT, INSERT ON northwind.* TO app;
GRANT SELECT ON northwind.orders TO reader;
REVOKE INSERT ON northwind.* FROM app;
SHOW GRANTS FOR app;
DROP USER app;
```

A statement with an inline password (`IDENTIFIED ... BY '...'`) stays in the
in-memory history for the session, but the shell never writes it to the history
file on disk.

Authentication failures use the codes `CADB0516` to `CADB0519`. See
[Error codes](/docs/error-codes#common-user-facing-errors) for what each one
means.

## Command line syntax

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
| `--format` | Output format for `-e` and `-f`: `table`, `json`, or `yaml`. The default is `table`. |
| `-u`, `--user` | User to authenticate as. |
| `-p`, `--password` | Password for `-u`. Use bare `-p`, or omit it when `-u` is present, to prompt without echo. |
| `--token` | Use an existing bearer token instead of logging in with a password. |
| `--allow-insecure-credentials` | Allow credentials on a non-local plaintext `http://` endpoint. |
| `--no-history` | Do not load or save statement history. |
| `--tui` | Open the full-screen mode with catalog, editor, and result panes. |
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
camus-cli -c "Endpoint=http://node1:5096,http://node2:5096;Database=mydb;Protocol=grpc"
camus-cli -c "Endpoint=http://localhost:5095"
camus-cli mydb -e "SELECT * FROM users"
camus-cli mydb -e "SELECT * FROM users" --format json
camus-cli mydb -f schema.sql
cat schema.sql | camus-cli mydb -f -
camus-cli mydb --tui
camus-cli --diagnose-terminal
CAMUS_FORCE_RICH=1 camus-cli
camus-cli --help
camus-cli --version
```

## Interactive shell

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
| `\plan [flow\|table]` | Choose the display used for `EXPLAIN`. Alias: `/plan`. |
| `\export csv\|json\|yaml [to <file>] <query>` | Write a query result to a file. Alias: `/export`. |
| `backup ...` | Take and administer server backups. |
| `exit` / `quit` | Exit the shell. |
| `help`, `\h`, `\?`, `?`, `/help` | List the shell commands. |

Examples:

```camussql
use northwind;
source ./schema.sql
show prepared
backup list
clear
exit
```

These are shell commands, not server SQL. `use` and `backup` have no server
statement form.

While a transaction is active:

- `exit` and `quit` are blocked until you `commit` or `rollback`.
- `use <database>` is also blocked.

### Export a result set

`\export` runs a row-returning query and writes CSV, JSON, or YAML without
printing the rows to the terminal:

```camussql
\export csv select * from titles
\export json to titles.json select id, title from titles where production_year > 2000
/export yaml to 'my titles.yaml' select * from titles
```

Without `to <file>`, the shell suggests a timestamped name based on the first
table after `FROM`. At an interactive prompt you can accept or edit it; in a
`source` file, `-e`, or `-f`, the suggestion is used without prompting. CSV has
a header row, JSON and YAML use the same shape as `--format`, and an existing
target is replaced. The shell writes to a temporary file first, so a failed
query does not leave a partial export.

## Full-screen mode

Use `--tui` when you want the catalog, editor, and results visible at the same
time:

![camus-cli full-screen TUI](/img/screenshots/tui.webp)

```bash
camus-cli northwind --tui
camus-cli -c "Endpoint=http://localhost:5096;Database=northwind;Protocol=grpc" --tui
```

The screen has three panes:

| Pane | Purpose |
| --- | --- |
| Data Catalog | Lists databases, tables, columns, and types. A green dot marks the current database. |
| Query Editor | Holds SQL text with syntax coloring and completion. |
| Query Results | Shows the latest result grid and one log line for each statement that ran. |

Common keys:

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Move between panes. |
| `F5` / `Ctrl+R` / `Shift+Enter` | Run the statement at the cursor. |
| `F6` / `Ctrl+G` | Run every statement in the editor. |
| `Esc` | Cancel the running query or close the help bar. |
| `Ctrl+C` | Cancel a running query; when idle, ask to quit. |
| `F1` | Show or hide the key list. |
| `F2` | Turn the result row cap on or off. |
| `F4` | Refresh the catalog. |
| `Ctrl+S` | Save the editor text. |
| `Ctrl+L` / `Ctrl+U` | Clear the editor. |
| `Ctrl+Q` | Quit. |

Expand a database in the catalog to load its tables, and expand a table to see
its columns. `Enter` on another database switches the session to it. `Space`
inserts the selected name into the editor. The catalog refreshes after schema
or database DDL; use `F4` to see changes made by another session.

The editor uses `Ctrl+N` and `Ctrl+P` to move through completions because `Tab`
changes panes. The statement at the cursor extends through its terminating
semicolon. If the cursor is after the final statement, the final statement is
run.

The result pane uses the arrow, paging, `Home`, and `End` keys to select cells.
Press `Enter` to inspect the complete cell, `c` to copy a cell, `Shift+C` to copy
a row, and `m` to open the last 500 execution messages. Clipboard copying uses
OSC 52 and therefore depends on terminal support.

The result grid pages rows in chunks of 200. A display cap of 500 rows is on at
startup; press `F2` to remove that display cap. The cap is not a SQL `LIMIT`.

The editor text is persisted between TUI sessions as `query.sql` in the same
state directory as the history file:

```text
query.sql
```

Backup commands do not run inside `--tui`. Use the prompt, `source`, `-e`, or
`-f`.

The mode needs an ANSI terminal. If detection fails for a capable terminal, use
`--force-rich` or set `CAMUS_FORCE_RICH=1`.

## Query plans

At the interactive prompt, `EXPLAIN` results open as a flow from source to
result. Operator boxes show their detail and estimated cost, arrows show row
estimates, and joins show their right input beside the operator. `EXPLAIN
(ANALYZE)` adds measured rows and flags large estimate misses.

Use `\plan table` for the raw rows and `\plan flow` to return to the diagram.
`/plan` is an alias. Vertical output, `--format json|yaml`, and the TUI retain
the raw table representation.

## Multiline input

The shell supports multiline SQL. It keeps collecting input while the statement
looks incomplete, which currently means:

- an open single-quoted string
- an open double-quoted string
- an unmatched `(`
- a trailing comma

Example:

```camussql
select
  id,
  name
from users
where active = true;
```

The shell also splits multiple statements at semicolons, ignoring semicolons
inside quoted strings.

Pasting multiline SQL also works: the editor turns each pasted `Enter` into a
new line instead of submitting each line as it arrives.

## Non-interactive execution

Use `-e` or `--execute` to run SQL and exit without starting a prompt:

```bash
camus-cli northwind -e "SELECT * FROM users"
camus-cli -c "Endpoint=http://localhost:5096;Database=northwind;Protocol=grpc" -e "SHOW TABLES"
```

To run several statements in one call, separate them with semicolons:

```bash
camus-cli demo -e "INSERT INTO users (id, name) VALUES (gen_id(), 'Ada'); SELECT * FROM users"
```

Vertical output also works:

```bash
camus-cli demo -e "SELECT * FROM users\G"
```

This mode is useful in scripts, CI jobs, cron jobs, and shell redirects:

```bash
camus-cli demo -e "SELECT * FROM users" > users.txt
```

### Running a .sql file

Use `-f` or `--file` to run every statement in a file and exit, so you can
apply a schema or migration without the interactive console:

```bash
camus-cli northwind -f schema.sql
camus-cli -c "Endpoint=http://localhost:5095;Database=northwind" -f seed.sql
```

Semicolons separate statements, and the statements run in order. The shell
handles `\G` and comments exactly as `source` does inside the shell.

The shell streams the file, so its size does not matter.

Execution stops at the first failing statement. The shell prints the error, the
failing statement, and the line where it starts. The remaining statements do
not run, and the process exits with status `1`.

Pass `-` as the path to read the script from standard input:

```bash
cat schema.sql | camus-cli northwind -f -

camus-cli northwind -f - <<'SQL'
create table users (id oid primary key, name string);
insert into users values (gen_id(), 'Ada');
SQL
```

You can combine `-f` and `-e`. The file runs first, so `-e` can read back what
the file wrote:

```bash
camus-cli demo -f seed.sql -e "select count(*) from users"
```

### JSON and YAML output

Use `--format json` or `--format yaml` with `-e` or `-f` when another program
will read the rows:

```bash
camus-cli demo -e "select id, name from users" --format json | jq '.[].name'
camus-cli demo -e "select id, name from users" --format yaml > users.yaml
```

With these formats, standard output contains only row documents. The version
banner, `rows in set`, `Query OK`, and errors go to standard error. Each
statement that returns rows emits one document. JSON emits an array of objects.
YAML emits a sequence of mappings and separates multiple result sets with
`---`. A query with no rows emits an empty array. A statement that returns no
rows emits no document.

Values keep their useful types: integers, floats, and booleans stay scalar;
`NULL` stays null; `NUMERIC` is written as a string to avoid losing precision;
`BYTES` is base64; arrays are arrays. The `\G` vertical-output suffix has no
effect in JSON or YAML mode.

## Prepared statements

After the driver sees the same SQL text a few times, it registers the statement
with the server and runs it in prepared form from then on.

There is nothing to enable. A prepared execution returns exactly the same
result as an inline one.

`show prepared` reports the current registrations:

```text
camus> show prepared
Prepared statements: 1 (MaxAutoPrepare=128, AutoPrepareMinUsages=2)
  prepared     select id from robots where year = 1984
(the statement you ran last)
```

Pass a statement to ask about it. Otherwise, the shell reports the last
statement of your session:

```camussql
show prepared select id from robots where year = 1984
```

`\prepared` is an alias of both forms.

A statement typed at the prompt usually reports as `inline`. It carries its
values inside the SQL text, so each execution is different text that never
repeats often enough to be registered.

Statements that reach prepared form come from `source` files and applications,
which repeat a statement verbatim.

Set both thresholds in the connection string:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=demo;MaxAutoPrepare=512;AutoPrepareMinUsages=1"
```

`MaxAutoPrepare` is how many statements stay registered. `0` turns
registration off.

`AutoPrepareMinUsages` is how many executions happen before registration.
See [Parameters And Prepared Statements](/docs/prepared-statements).

## Backups

The `backup` commands drive online backups and point-in-time recovery on the
server. Every `backup` command is safe while the server serves traffic.

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

A typical session takes a full backup, chains an incremental backup onto it,
and then checks that the chain would actually restore:

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

`backup chain` is a validating read: CamusDB rejects a chain it cannot assemble
now, rather than at restore time. It answers one question: would this backup
actually restore?

It prints the chain, root first, followed by the recoverable window that a
point-in-time restore may target.

Keep in mind:

- Backups are node-wide, not per-database. Every database on the server
  shares one storage node. Nothing here is scoped to the current database, and
  the commands work with no database selected.
- The server must opt in. Backups are off until `kahuna.backup_dir` is set;
  until then every command fails with `CADB0700 BackupNotConfigured`.
- The commands work at the prompt, in `source` files, with `-e`, and with `-f`.
  They do not run inside `--tui`.
- Superuser only. With authentication enabled, connect as a superuser with `-u`
  or `--token`. With authentication disabled, the server limits these commands
  to loopback callers, so it refuses a remote shell instead of allowing a
  whole-node backup without an identity.
- An incremental can become a full. If the parent has aged past the
  retention floor, the server takes a full backup instead. The command still
  succeeds and reports the substitution and its reason.
- `backup coordinated` must reach the backup coordinator, the node that
  currently [leads](/docs/concepts#leader) the cluster's backup metadata. Any
  other node refuses with `CADB070E BackupNotCoordinator`. Pin
  `BackupEndpoint=` to the coordinator when `Endpoint=` names a multi-node pool.
- The API is REST only, with no SQL form and no gRPC service. For the default
  gRPC connection, the shell points backups at the known HTTP port for you. With
  a `-c` connection string that sets `Protocol=grpc`, add `BackupEndpoint=` with
  the server's HTTP endpoint.
- Backup requests use their own timeout, `BackupTimeout=` in the connection
  string (300 seconds by default), rather than the statement timeout, because a
  full backup copies a whole node's base image.

Retention runs automatically after each backup and on a periodic tick. You only
need `backup gc` to reclaim space immediately after tightening a limit.

Preview the pass first. A preview deletes nothing:

```text
camus> backup gc preview
Retention preview: 2 backups, 0 orphans, 1.41 GB would reclaim (00:00:00.041)
```

Restore is not a `backup` command. There is no in-place hot restore: a restore
builds into a fresh data directory, and an operator then stops the server and
starts a new one against that directory. The shell cannot drive that runbook
end to end. See [Backup And Restore](/docs/backup-and-restore#the-restore-runbook).

## History

The shell loads and saves command history automatically.

History file:

| Platform | Path |
| --- | --- |
| Any, when `XDG_STATE_HOME` is set | `$XDG_STATE_HOME/camusdb/history.json` |
| Linux and macOS | `~/.config/camusdb/history.json` |
| Windows | `%LOCALAPPDATA%\camusdb\history.json` |

Behavior:

- history is loaded on startup
- history is saved on normal exit
- history is also saved on `Ctrl+C`
- the state directory and history file are created with owner-only permissions
  on Unix-like systems
- adjacent duplicate entries are removed
- statements that inline passwords with `IDENTIFIED ... BY ...` are kept out of
  the on-disk history file
- `--no-history` disables loading and saving for the session

## Keyboard shortcuts

The rich editor supports these keys:

| Key | Action |
| --- | --- |
| `Enter` | Submit the current statement. |
| `Shift+Enter` | Insert a new line when the terminal reports the modifier. |
| `Alt+Enter` / `Ctrl+O` | Insert a new line on terminals that do not report `Shift+Enter`. |
| `Up` / `Down` | Navigate lines or command history. |
| `Left` / `Right` | Move the cursor. |
| `Ctrl+Left` / `Ctrl+Right` | Move by word. |
| `Home` / `End` | Jump within the current line. |
| `PageUp` / `PageDown` | Jump to first or last multiline line. |
| `Backspace` / `Delete` | Delete text. |
| `Tab` | Autocomplete the current word. |
| `Ctrl+Tab` | Cycle to the previous completion. |

## Statement handling

`camus-cli` sends SQL to the server and formats the response. Queries show
result tables, DDL prints `Query OK`, and writes print affected row counts. The
shell runs `INSERT ... RETURNING` through a reader so it can show the returned
rows and still print the affected-row count.

Most SQL syntax belongs to the server, not to the shell. Use the SQL reference
pages for statement semantics:

- [SQL overview](/docs/sql)
- [SQL schema](/docs/sql-schema)
- [SQL writes](/docs/sql-writes)
- [SQL inspection](/docs/sql-inspection)
- [Query activity](/docs/query-activity)

The shell intercepts only a small set of client-side commands, such as `use`,
`source`, `show prepared`, `backup`, `clear`, `exit`, and `quit`.

## Vertical output

End a query with `\G` instead of `;` to print each row vertically. This helps
with wide rows, long JSON values, and inspection commands with many columns.

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

`\G` also works inside `source` files and multi-statement batches.

## Transactions

The shell supports explicit transaction commands:

```camussql
begin;
commit;
rollback;
```

It also accepts:

```camussql
start transaction;
```

Current rules:

- only one active transaction is allowed at a time
- `commit` with no active transaction shows an error
- `rollback` with no active transaction shows an error
- after `commit` or `rollback`, the shell clears its local transaction state
- on `Ctrl+C`, an active transaction is rolled back before exit

## Syntax highlighting

The interactive editor highlights:

- SQL keywords
- built-in shell commands
- booleans
- quoted strings
- numeric literals
- supported function names

The keyword and function lists are built into the shell. They control CLI
coloring only and do not affect which SQL the server supports.

The current highlighter follows the newer CamusSQL vocabulary, including
`NUMERIC`/`DECIMAL`, `SERIAL`/`BIGSERIAL`, arrays, UUIDs, blobs, temporal
types, joins, `RETURNING`, sequences, foreign keys, query activity statements,
storage strategy statements, and the inspection statements under
[SQL Inspection](/docs/sql-inspection).

It also highlights line and block comments:

```camussql
-- one-line comment
/* block comment */
select gen_uuid_v7(), now();
```

## Autocompletion

Press `Tab` to complete the word under the cursor. Press `Tab` again to move
forward through the matches. Press `Ctrl+Tab` to move backward.

Completion is context-aware. These positions expect a relation name: `from`,
`into`, `update`, `join`, `table`, `view`, `desc`, `describe`, `truncate`,
`references`, and the table position of `show statistics for`. After one of
them, the shell offers the current database's tables, views, and materialized
views.

The shell also offers:

- `table@index` targets after `show ranges from index`.
- sequence names after `alter sequence`, `drop sequence`, `show create
  sequence`, and `comment on sequence`.
- runtime configuration keys after `set cluster setting` and `reset cluster
  setting`.

Anywhere else, it offers SQL keywords, functions, constants, and shell
commands.

```camussql
select * from us<Tab>
insert into <Tab>
show statistics for <Tab>
show ranges from index users@<Tab>
drop sequence <Tab>
sel<Tab>
```

The shell loads relation names with `SHOW TABLES`, `SHOW VIEWS`, and
`SHOW MATERIALIZED VIEWS`. It loads sequence names with `SHOW SEQUENCES`. It
loads configuration keys with `SHOW VARIABLES` and omits restart-only keys from
the completion list.

It refreshes those names at startup, after `use <database>`, and after any
statement that changes the set of relations:

- `CREATE TABLE` or `DROP TABLE`.
- `CREATE VIEW`, `CREATE OR REPLACE VIEW`, `DROP VIEW`, or `ALTER
  VIEW`.
- The materialized view equivalents of those.
- Sequence create, alter, drop, or rename.

Index completions are loaded table by table with `SHOW INDEXES`. A statement
that creates or drops an index clears that cache, and the next relevant `Tab`
loads fresh names.

## Database switching

You can change the current database without leaving the shell:

```camussql
use analytics;
use `order details`;
```

The command replaces the `Database=...` part of the active connection string
and opens a new connection to that database.

The target database must already exist; `use` does not create it.

The name can be bare, or wrapped in backticks or quotation marks. Quote names
that match a keyword or contain a space.

The shell, not the server, handles `use`. It works in script files, with `-e`,
and at the prompt. A dump can therefore switch databases partway through a
file, and a session that starts without a database can select one in its first
statement.

## Source files

Run a SQL script file:

```camussql
source ./seed.sql
```

The shell streams the file instead of reading it into memory, so a dump larger
than RAM works, and the first statement runs immediately instead of waiting for
the whole file to be parsed.

The shell splits statements at semicolons, ignoring semicolons inside:

- Single-quoted strings.
- Double-quoted strings.
- Backtick-quoted identifiers.
- `--` line comments.
- `#` line comments.
- Block comments.

It understands doubled quotes, as in `'it''s'`, and backslash escapes. It
strips comments before sending a statement to the server.

A statement ending in `\G` inside a `source` file uses vertical output.

Execution stops at the first failing statement. The shell reports the file and
the line where that statement starts.

Pass `--force` to continue instead. The shell then prints a summary at the end:

```camussql
source ./seed.sql --force
```

A failure inside an open transaction stops the file even with `--force`. The
server has already aborted that transaction, so every later statement would
fail too.

A file can contain `use` statements to change databases as it runs.

The shell refuses `use` inside an open transaction and stops the file, because
the rest of the file would otherwise run against the wrong database.

## Workload subcommand

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
| `-p`, `--password` | Password for `-u`. Give bare `-p` to prompt. Also read from `CAMUS_PASSWORD`. |
| `--allow-insecure-credentials` | Allow credentials on a non-local plaintext `http://` endpoint. |

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

Without a connection string, the workload command uses these defaults:

```text
Endpoint=http://localhost:5096;Database=demo;Protocol=grpc
Endpoint=http://localhost:5095;Database=demo;Protocol=rest
```

If `-c` or `--connection-source` has no `Database=...`, the workload command
adds the `--database` value.

Like the interactive shell, a workload tries gRPC first and REST second. A
`Protocol=...` in the connection string turns off that fallback.

A workload also sets a longer default command timeout, because batch commits
need the extra time.

## Terminal detection

The rich editor turns on when the terminal reports ANSI support, the input is
interactive, and the output goes to a terminal.

If the shell fails to detect a capable terminal, run the diagnostic:

```bash
camus-cli --diagnose-terminal
```

If you know your terminal supports it, force the rich editor:

```bash
camus-cli --force-rich
```

or persistently:

```bash
export CAMUS_FORCE_RICH=1
```

## Connection validation

Before it opens a connection, the shell checks that the connection string has
a valid `Endpoint` (see [Basic usage](#basic-usage)). It then sends a first
ping, so startup fails early when it cannot reach the target node.
