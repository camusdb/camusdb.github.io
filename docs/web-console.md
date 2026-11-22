---
sidebar_position: 7.25
---

import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

# Web Console

The Web Console is a browser workspace for CamusDB. You can run SQL, read query
plans as diagrams, and change the schema and the rows. You can also check node
health and backups. You don't need a SQL client on each machine.

<ThemedImage
  alt="CamusDB Web Console"
  sources={{
    light: useBaseUrl('/img/screenshots/webconsole-query-light.webp'),
    dark: useBaseUrl('/img/screenshots/webconsole-query-dark.webp'),
  }}
/>

## Quick start

You need a running CamusDB server. By default, it serves REST on port `5095`
and gRPC on port `5096`. The console can use either protocol.

Install the console as a .NET tool. It needs the .NET 10 runtime or later:

```bash
dotnet tool install -g CamusDB.WebConsole
camusdb-webconsole --endpoint http://localhost:5095 --database demo
```

The console starts on `http://127.0.0.1:5164` and opens your browser. To change
the connection for your browser session, click **Configure** in the app bar.

| Option | Description |
| --- | --- |
| `--endpoint <url>` | The CamusDB server. Default `http://localhost:5095`. |
| `--database <name>` | The database to open first. |
| `--protocol <name>` | `rest` (default) or `grpc`. |
| `--user <name>` | The user to sign in as. Enter the password in **Configure**. |
| `--port <number>` | The console port. Default `5164`. `0` picks a free port. |
| `--no-browser` | Don't open the browser. |
| `--version`, `--help` | Show the version or the help. |

There is no password option, because other users can read a command line in
the process list. Use **Configure** or the `CamusDB__Password` environment
variable. To update the tool, run `dotnet tool update -g CamusDB.WebConsole`.

The tool listens on loopback only. ASP.NET Core options such as `--urls` change
the listen address, and the console then doesn't open the browser. Before you
serve other machines, read [Deploy on a network](#deploy-on-a-network).

### Run it with Docker

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -e CamusDB__Endpoint=http://host.docker.internal:5095 \
  -e CamusDB__Database=demo \
  camusdb/camusdb-webconsole:latest
```

Open `http://localhost:8080`.

- `host.docker.internal` is the host machine under Docker Desktop. On Linux
  without that name, use the LAN IP of the host, or add
  `--add-host=host.docker.internal:host-gateway`.
- `127.0.0.1:` in `-p` publishes the port to the Docker host only. Keep it
  until an authenticated gate is in front. See
  [Deploy on a network](#deploy-on-a-network).

### Run from source

With the .NET 10 SDK, from a checkout of
[camusdb-webconsole](https://github.com/camusdb/camusdb-webconsole):

```bash
cd src/CamusDB.WebConsole
dotnet run
```

Open the address that the application prints.

## Run SQL

The editor is Monaco, the editor of VS Code, with CamusDB SQL highlighting and
completion. Each tab has separate SQL and results.

| Command | Key | Executes |
| --- | --- | --- |
| **Run statement** | Ctrl/Cmd+Enter | The statement at the cursor, or the selected text. |
| **Run script** | Alt+X | Each statement of the tab or the selection, in order. Each statement gets a result tab. The script stops at the first failure. |

- Before you execute a statement that removes data, such as `DROP TABLE` or
  `TRUNCATE`, the console lists those statements and asks for confirmation. A script asks once, before
  its first statement. If you cancel, no statement is executed.
- A script splits at each `;` that isn't quoted or in a comment. A
  dollar-quoted body (`$$ … $$`) counts as quoted. This means that a
  `CREATE FUNCTION` with a C# body is one statement.
- **Stop** cancels the current statement and the rest of the script.

Completion offers keywords and functions. It also offers the tables of the
session database, and the columns of the tables that the statement names. `WITH`
queries appear as tables, and `alias.` lists the columns of that table only.
Names that are keywords get backticks. DDL from the editor refreshes the
completion and the schema tree.

### Transactions

Each statement commits by itself, unless a transaction is open. To open a
transaction, execute `BEGIN` or `START TRANSACTION`. To close it, execute
`COMMIT` or `ROLLBACK`. You can also use the **Commit** and **Rollback** buttons
in the editor toolbar. While a transaction is open, the toolbar shows its database and the
count of its statements.

- The transaction belongs to the session, not to one tab. All the statements
  that the console sends go in it, also the row edits and the schema dialogs.
- To set the isolation level, execute `SET TRANSACTION ISOLATION LEVEL …` as
  the first statement after `BEGIN`.
- If a statement in the transaction fails, CamusDB rolls back the transaction,
  and the console closes it. **Stop** has the same result.
- While the transaction is open, the session can't change to another database.
- **Connect** in **Configure** rolls back the open transaction. A sign-out and
  the end of the session do the same.

Some statements behave differently in a transaction:

| Statement | Result |
| --- | --- |
| `TRUNCATE`, `ALTER TABLE … REWRITE STORAGE`, `ALTER SEQUENCE … RESTART` | `CADB0538`. The transaction is rolled back. |
| `CREATE`, `DROP`, `ALTER`, or `RENAME DATABASE` | The console doesn't send it. The transaction isn't closed. |
| Other DDL, such as `CREATE TABLE` or `GRANT` | Commits at once. A `ROLLBACK` doesn't undo it. |
| Schema DDL on a table that the transaction wrote to | The `COMMIT` returns `CADB0502`, and the writes are lost. |

For more information, see [Transactions](/docs/sql-transactions).

### Query history

The clock button lists the last 200 statements, newest first. Each entry shows
details such as the database and the duration. You can search the entries by
text. Double-click an entry to open it in a
new tab.

The history is in the `localStorage` of the browser. The console replaces each
string literal of `CREATE USER` and `ALTER USER` with `'********'`. This means
that the history doesn't contain passwords.

## Work with results

How a statement shows its result:

- A query, such as `SELECT` or `SHOW`, fills the grid.
- A write with `RETURNING` shows the returned rows and the count of affected
  rows.
- Other DML and DDL show the count of affected rows and a status message.
- After a `WITH` clause, the main statement decides. `WITH s AS (…) UPDATE …`
  shows a count, and `WITH s AS (…) DELETE … RETURNING …` shows rows.

The grid styles each cell by its type. Blobs show as hex. `NUMERIC` shows its exact text, up to 38 digits.
`JSONB` shows the document in PostgreSQL text form, with the full document in a
tooltip. A JSON `null` shows as `null`, and SQL `NULL` shows as `NULL`.

### Paging

A `SELECT` without a final `LIMIT` or `OFFSET` loads one page of `MaxRows` rows
(default `1000`). This includes `WITH … SELECT`. **Fetch more** adds the next
page. You should add `ORDER BY` when the page order must be stable.

- One result has at most 100,000 rows. To see more, narrow the query with
  `WHERE`, or use `LIMIT` and `OFFSET`.
- Other statements that return rows, such as `SHOW` or a `SELECT` with a `LIMIT`,
  load up to `MaxRows` rows. The console warns when it cuts the
  result.

### Sort and filter

Click a column header to sort ascending. Click again for descending, and a
third time to remove the sort. `NUMERIC` sorts by exact value, and `NULL` sorts
first.

| Tab | Sort and filter apply to |
| --- | --- |
| Query tab | The loaded rows. Use **Filter loaded rows** to filter. |
| Data tab (**Edit/View Data**) | The table, on the server. A header click adds `ORDER BY`, and the **WHERE** box adds a condition. The console writes the new query into the editor of the tab. |

### Copy cells

Click a cell to select it. Shift+click or drag to select a rectangle.
Ctrl/Cmd+A selects all the loaded rows, and Esc clears the selection.

Ctrl/Cmd+C copies the selection as tab-separated text, which a spreadsheet
pastes as cells. Right-click a cell for other formats:

| Item | Copies |
| --- | --- |
| **Copy with headers** | Tab-separated text with the column names on the first line. |
| **Copy as CSV** / **Copy as JSON** | The same format as **Export**. |
| **Copy as Markdown** | A Markdown table. |
| **Copy as SQL INSERT** | One `INSERT` for each row. In a data tab, it names the table. |

A copy contains the loaded rows only. A new sort or filter clears the
selection. **Fetch more** clears it too.

### Export

**Export** in the results toolbar downloads the loaded rows as CSV or JSON. The
export uses the sort and filter of the grid, and it doesn't execute the query
again. For a paged result, use **Fetch more** first to include more rows.

In JSON, dates are ISO 8601 text and blobs are hex. `NUMERIC` values are
strings, so that no digits are lost. `JSONB` values are JSON documents. A
duplicate column name gets a suffix, such as `id_2`.

To export all the rows of a table, right-click it and choose **Export Table**. The export
stops at `MaxRows` rows, and it warns when it cuts the result. For a full
logical backup, use [camus-dump](/docs/camus-dump).

## Query plans

Execute `EXPLAIN` or one of its forms, such as `EXPLAIN (ANALYZE)`. The
results toolbar then shows a **Table | Steps | Graph**
switch. The console opens the next plan in the view that you used last.

<ThemedImage
  alt="CamusDB Web Console query plan graph"
  sources={{
    light: useBaseUrl('/img/screenshots/webconsole-plan-light.webp'),
    dark: useBaseUrl('/img/screenshots/webconsole-plan-dark.webp'),
  }}
/>

| View | Shows |
| --- | --- |
| **Table** | The plan rows that CamusDB returns. |
| **Steps** | One card for each operator, from the source at the top to the result at the bottom. A card shows the operator and its share of the estimated cost. |
| **Graph** | The rows that flow from the tables on the left to the result on the right. The width of a band follows the row count on a log scale. A red band marks a scan or filter that dropped more than half of the rows that it read. **Fit** shrinks a wide diagram to the pane. |

The views show the full plan shape:

- The right input of a join is a dashed box next to the join.
- A set operation, such as `UNION`, shows each operand as a branch.
  `WITH RECURSIVE` shows its non-recursive and recursive terms.
- *Computed once: name* marks a reader of a `WITH` query that the server
  computes one time and reuses.
- Plan-wide rows, such as `plan-info` and `distribution`, appear below the
  diagram.

With `ANALYZE`, each operator also shows the measured rows and its counters,
such as KV lookups. The summary shows the execution and planning time.
*Estimate off N×* marks an operator whose measured rows differ from the
estimate by ten times or more.

To open the inspector, click an operator. With the keyboard, select it with
Tab and press Enter. The inspector shows the details of the operator, such as
the row counts and the cost.
With `ANALYZE`, it compares the measured and estimated rows. If the server
sends `estimate_trace`, it also shows how the planner made the estimate.

**Findings** lists the parts of the plan that need attention. Click a finding
to select its operator.

| Finding | Condition |
| --- | --- |
| *Hash join spilled to disk* | The join executed as `grace-hash` (`ANALYZE` only). |
| *Hash join fell back to a nested loop* | The join executed as `nested-loop-fallback` (`ANALYZE` only). |
| *Right side read for each left row* | The join executed as `nested-loop-rescan` (`ANALYZE` only). |
| *Window spilled to disk* | The window operator spilled rows (`ANALYZE` only). |
| *Full scan of table* | A `table-scan` reads 10,000 rows or more, and 20% or less of them are left after the filter. |
| *Estimate off N×* | The measured and estimated rows differ by ten times or more, on 100 rows or more. |
| *Nested loop without an index* | A `nested-loop-join` reads 1,000 left rows or more, and its right side doesn't use an index. A range seek or an `IN` list counts as index use. |
| *Most of the cost* | One operator has half of the estimated cost or more. |

For the operator names and plan fields, see [EXPLAIN](/docs/explain).

## Browse and change the schema

The sidebar shows a tree of the databases and their objects, such as tables and
functions. Under each table, you can see objects such as its columns and
indexes. To filter by
name, type in the filter box. Click a database to make it the session
database.

Double-click an object to put a statement into the active tab:

| Object | Inserts |
| --- | --- |
| Table | `SELECT * FROM table LIMIT 100` |
| Sequence | `SHOW CREATE SEQUENCE sequence` |
| Function | `SHOW CREATE FUNCTION function` |
| Trigger | `SHOW CREATE TRIGGER trigger ON table` |

Hover over an object for details. For example, a foreign key shows its parent
table and its actions. A function shows its compile state on the node that
answered, such as `compiled`.

### Context menus

Right-click an object for its actions. Each **Drop** asks for confirmation.

| Object | Actions |
| --- | --- |
| Database | **Create a Table**, **Create a Function**, **Rename Database**, **Drop Database** |
| Table | **Edit/View Data**, **Rename Table**, **Drop Table**, **Export Table**, **Add a Column**, **Add an Index**, **Add a Foreign Key**, **Add a Trigger** |
| Column | **Rename Column** |
| Index | **Rename Index** |
| Foreign key | **Drop Constraint**. This also drops an index that the constraint created. |
| Sequence | **Show Create Sequence**, **Rename Sequence**, **Drop Sequence** |
| Function | **Show Create Function**, **Drop Function** |
| Trigger | **Show Create Trigger**, **Drop Trigger** |

The dialogs execute ordinary SQL. For a change that a dialog can't make, write
the SQL in the editor.

- **Create a Table** defines the columns and the primary key. It can also add
  defaults and single-column foreign keys. An `INT64` column can have a
  `nextval('sequence')` default.
- **Add a Column** executes `ALTER TABLE … ADD COLUMN`. Existing rows get a
  constant default. This means that a `NOT NULL` column needs a default.
- **Add an Index** can create a `UNIQUE` index. On a `JSONB` column, it creates
  a single-column GIN index, marked `(GIN)` in the tree. For more information,
  see [JSON documents](/docs/json).
- **Add a Foreign Key** supports one or more column pairs. The server checks
  the existing rows first. If a row doesn't have a parent, it returns
  `CADB0304`. The dialog offers `NO ACTION` and `RESTRICT`, the actions that
  CamusDB supports.
- **Rename** shows the statement before it is executed. Names must match
  `[a-zA-Z_][a-zA-Z0-9_]*`. A renamed sequence updates the `nextval()` defaults
  that use it. Open tabs and the query history aren't changed.
- **Create a Function** and **Add a Trigger** put a `CREATE FUNCTION` or
  `CREATE TRIGGER … LANGUAGE csharp` template into the active tab. Edit the
  template, then execute it. For inline C#, the server needs
  `inline_functions_enabled` or `inline_triggers_enabled`. Both are off by
  default. For more information, see
  [C# extensions](/docs/csharp-extensions#inline-functions).

## Edit rows

**Edit/View Data** on a table opens a data tab. Each row gets **Edit** and
**Delete** actions, also on the right-click menu of the row. The tab sorts and
filters the rows on the server.

- The edit dialog follows the table schema. Primary-key fields are read-only.
  Nullable fields get a **NULL** toggle.
- The console checks each value against its column type, including the range of
  integers, before it builds the statement.
- `UPDATE` and `DELETE` find the row by its primary key. For a table without a
  primary key, the actions are disabled.
- `NUMERIC` values are written as `NUMERIC '…'`. This means that exact decimals
  keep all their digits.
- A `JSONB` field opens as an indented document and is written as `JSONB '…'`.
  The text `null` is a JSON null. The **NULL** toggle is SQL `NULL`.

After an edit or a delete, the tab executes its query again.

## Administration

**Administration** in the app bar opens views of one node: the node that
answered the connection of the console.

| Panel | Shows or does | Access with authentication on |
| --- | --- | --- |
| Node | Disk space, CPU, and memory. You can select a node from an endpoint pool. | Superuser or `MONITOR` |
| Engine stats | `SHOW ENGINE STATS` | Superuser |
| Statements | `SHOW STATEMENT STATS`: counts and times for each statement. | Superuser |
| Index usage | `SHOW INDEX USAGE` for the current database: reads and writes for each index. | Superuser |
| Variables | `SHOW VARIABLES`: the effective settings of the node. | Superuser |
| Backups | Backups and the backup catalog. See [Manage backups](#manage-backups). | Superuser |

Grant `MONITOR` for read-only health checks, then reconnect:

```camussql
GRANT MONITOR ON *.* TO ops_user;
```

The other panels need a superuser. Statement statistics contain the SQL of
other users, and backups cover all the databases on the node. To inspect
another node in these panels, change the console connection.

### Check node resources

**Node** shows the free space of each engine volume against the write
watermark, and the CPU and memory use. *Below watermark* means that the node
returns `CADB0536` for writes. Click **Take reading** to refresh, or turn on
automatic readings at 5-second intervals. For more information, see
[Node stats](/docs/node-stats).

### Find expensive statements

[Statement statistics](/docs/statement-stats) are off by default. Turn them on
for the node:

```camussql
SET CLUSTER SETTING statement_stats_enabled = true;
```

In **Statements**, take two readings to compare an interval, or turn on the
10-second refresh. You can filter by SQL text or database, and sort by columns
such as total time and calls. **Reset baseline** returns to cumulative totals.

### Review index usage

**Index usage** can filter to drop candidates: non-unique indexes that get
writes but no reads. The counters reset when the node restarts. Before you drop
an index, check each node over a representative workload. For more
information, see [Index usage](/docs/index-usage).

### Manage backups

The **Backups** panel needs a backup configuration on the server, and it uses
the REST backup API. Set `BackupEndpoint` when the console connects over gRPC,
or when the endpoint is a pool. A coordinated backup must reach the backup
coordinator: the node that [leads](/docs/concepts#leader) the backup metadata
of the cluster. For more information, see
[Backup and restore](/docs/backup-and-restore).

## Configuration

The console reads the `CamusDB` section of `appsettings.json`. You can set a key
from the environment with the `CamusDB__` prefix, for example
`CamusDB__Endpoint`. The .NET tool and the Docker image accept the same
variables.

| Key | Default | Description |
| --- | --- | --- |
| `Endpoint` | `http://localhost:5095` | The base URL of CamusDB. With `grpc`, use the gRPC port, usually `5096`. |
| `Database` | `test` | The session database. |
| `Protocol` | `rest` | `rest` or `grpc`. |
| `TimeoutSeconds` | `30` | The request timeout. Maximum `600`. |
| `MaxRows` | `1000` | The rows in each page, and the row limit for exports and results that aren't paged. Maximum `100000`. |
| `User` | empty | The user to sign in as at startup. Empty means no sign-in. |
| `Password` | empty | The password for `User`. |
| `AccessToken` | empty | A bearer token from another source. The console uses it as is. |
| `RequireAccessToken` | `false` | Refuse user and password sign-in. See [Token-only consoles](#token-only-consoles). |
| `TokenLifetimeSeconds` | `0` | How long to reuse a token when the server doesn't give an expiry. `0` uses 10 minutes. |
| `LockEndpoint` | `false` | Refuse endpoint and protocol changes from **Configure** and from vendor launches. |
| `AllowInsecureCredentials` | `false` | Send credentials to an `http://` endpoint that isn't loopback. Use it only when the link is protected in another way, for example by a tunnel. |
| `BackupEndpoint` | empty | The REST endpoint for the **Backups** panel. Empty uses `Endpoint`. |
| `BackupTimeoutSeconds` | `0` | The timeout for backup calls. `0` uses 300 seconds. |

Keep passwords out of committed files. Use an environment variable or a secret
store.

The UI state, such as the open SQL tabs, is stored in the `localStorage` of
the browser. The dark or light theme is stored in a cookie. The console doesn't store a password or a token in the browser.

## Authentication

CamusDB authentication is off by default, and the console then sends no
credentials. On a server started with `CAMUSDB_AUTH_ENABLED=true`, sign in with
**Configure**. Use a user and password, or an access token from another system.

With a password, the console signs in once and gets a short-lived bearer token.
Later statements send the token only. The console renews the token before it
expires. If the server doesn't accept the token any more, for example after a
password change, the console signs in again.

- Credentials belong to one browser session, and they are kept in the memory of
  the console server. They aren't part of the connection string or of another
  user's session.
- The identity chip in the app bar signs you out. The console revokes a token
  that it created. It forgets a token that you supplied, and doesn't revoke it.
- The console can't renew a supplied token. The session ends when the token
  expires.

Manage users and grants with SQL from a superuser session:

```camussql
CREATE USER app IDENTIFIED BY 'app-password';
GRANT SELECT, INSERT ON app_db.* TO app;
SHOW GRANTS FOR app;
```

A user without `SELECT` on a table sees the table name in the schema tree, and
`Columns (no privilege)` when they expand it. For the privileges, see
[Authentication and authorization](/docs/sql-authentication). For the errors
`CADB0516` to `CADB0519`, see
[Error codes](/docs/error-codes#common-user-facing-errors).

### Token-only consoles

Set `CamusDB__RequireAccessToken=true` when another system issues tokens, such
as an SSO broker or a [vendor launch](#vendor-launch), and nobody types a
password into the console. **Configure** then shows the token field only. A
user name or a password from any caller returns an error.

- The setting controls the sign-in method only. If authentication is off on the
  server, the console connects without an identity.
- If `User` or `Password` is also set, the console doesn't start.

### TLS

With authentication on, a request with credentials over HTTP without TLS
returns an error, except from loopback. For each server that isn't on loopback, use an `https://`
endpoint.

- If TLS ends at a proxy in front of CamusDB, keep the unencrypted hop in your
  trust boundary. Start the server with `--require-tls-when-auth-enabled false`.
- The console also doesn't send credentials to an `http://` endpoint that isn't
  loopback. Set `CamusDB__AllowInsecureCredentials=true` only when another layer,
  such as a VPN, protects that link.

## Deploy on a network

The console doesn't have a separate sign-in. Anyone who can reach it can use
its CamusDB connection with all its privileges, also for DDL and backups.
Before you open the port to other machines:

1. Put an authenticated reverse proxy or VPN in front, with connection and
   request limits.
2. Turn on CamusDB authentication, or set `CamusDB__RequireAccessToken=true`.
3. Set `CamusDB__LockEndpoint=true` or `ConsoleLaunch__AllowedEndpoints`. See
   [Endpoint safety](#endpoint-safety).
4. Set connection limits for the process, for example
   `Kestrel__Limits__MaxConcurrentConnections=500` and
   `Kestrel__Limits__MaxConcurrentUpgradedConnections=200`. Each browser tab
   uses one long-lived connection, and its session state is in memory.

When the proxy is on the same host, keep the `127.0.0.1:` binding in the `-p`
option of Docker. The proxy is then the only way in. A bare `-p 8080:8080`
listens on all host addresses, and on Linux the firewall rules of Docker
bypass `ufw`.

### Endpoint safety

**Configure** and vendor launch payloads can change the CamusDB endpoint. The
console process opens that URL. This means that a visitor could make it reach
internal hosts, such as cloud metadata services. Set one of these controls:

- `CamusDB__LockEndpoint=true` blocks all endpoint changes.
- `ConsoleLaunch__AllowedEndpoints` allows the listed endpoints only. It
  applies to all endpoint changes, also from launch payloads.

```bash
ConsoleLaunch__AllowedEndpoints="https://db.acme.example,db.internal.example:5095"
```

| Entry | Matches |
| --- | --- |
| `https://db.acme.example` | That host with that scheme and port (443 here). |
| `db.acme.example` | That host on any scheme and port. |
| `db.acme.example:5095` | That host on port 5095, any scheme. |

Separate the entries with commas. Semicolons and whitespace also work. Wildcards aren't
supported. An invalid entry stops the startup. The configured
`CamusDB:Endpoint` is always accepted. If neither control is set, the console
logs a warning at startup.

### Security controls

The console limits failed sign-ins and vendor launch requests, and the open
browser connections of each client address. All these controls are on by
default. Set them in the `Security` section, or with `Security__` environment
variables.

| Key | Default | Description |
| --- | --- | --- |
| `LoginThrottleEnabled` | `true` | Count and slow down failed sign-ins from **Configure**. |
| `LoginFreeAttempts` | `3` | Failures that add no delay. |
| `LoginMaxAttempts` | `10` | Failures for one address and user name before sign-ins are blocked for the lockout period. |
| `LoginSprayMultiplier` | `5` | Multiplies `LoginMaxAttempts` to limit one address across all user names. |
| `LoginWindowSeconds` | `300` | How long failures are remembered. |
| `LoginLockoutSeconds` | `300` | How long a refusal lasts. |
| `LoginMaxDelaySeconds` | `8` | The longest delay before an attempt. |
| `MaxTrackedClients` | `20000` | The most client addresses kept in memory. |
| `RateLimitEnabled` | `true` | Rate-limit the vendor launch endpoints for each address. |
| `LaunchPermitLimit` | `30` | Requests from one address to each launch endpoint in one window. |
| `LaunchWindowSeconds` | `60` | The length of the launch rate-limit window. |
| `MaxConnectionsPerClient` | `20` | Open browser connections for each address. More connections get HTTP `429`. `0` turns off the limit. |

These controls use the socket peer address, and they ignore
`X-Forwarded-For`, because a caller can set that header. Behind a proxy, all
visitors have the address of the proxy. Configure trusted forwarded headers, or
raise the limits and enforce limits at the proxy.

## Vendor launch

Another product can open the console under a different brand name. The CamusDB
access token doesn't go to the browser of the user. Use it when your
application already authenticates users and wants to offer a database console.
The feature is off by default.

```bash
curl -X POST https://console.example.com/api/console/sessions \
  -H "X-Console-Key: $CONSOLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "brandName": "Acme Data Console",
        "accessToken": "<camusdb-access-token>",
        "database": "analytics"
      }'
```

1. The vendor backend sends this request and gets a single-use `launchUrl`
   that expires in 60 seconds.
2. The vendor redirects the browser to `launchUrl`.
3. The console sets an `HttpOnly` session cookie and opens the console.

The token moves between the two backends only. It isn't in a URL or anywhere in
the page. Only `brandName` is required. The request can also have `endpoint`
and `protocol`, which [Endpoint safety](#endpoint-safety)
restricts. `brandName` can have letters, digits, spaces, and `-_.,&'()+`, up to
64 characters.

| Key | Default | Description |
| --- | --- | --- |
| `Enabled` | `false` | Turn on the launch endpoints. When they are off, they answer as missing routes. |
| `ApiKey` | empty | The key sent as `X-Console-Key`. At least 32 characters. Generate it with `openssl rand -base64 32`. |
| `RequireHttps` | `true` | Refuse to create launch links over HTTP without TLS. |
| `CodeLifetimeSeconds` | `60` | The lifetime of the single-use launch code. |
| `SessionLifetimeMinutes` | `60` | The lifetime of the launched session. |
| `DefaultBrandName` | `CamusDB Web Console` | The name shown without a vendor launch. |
| `MaxLiveEntries` | `2000` | The most live codes and sessions together. At the limit, new launches get HTTP `503`. |
| `AllowedEndpoints` | empty | The endpoint allowlist. See [Endpoint safety](#endpoint-safety). |
| `PublicBaseUrl` | empty | The public console URL, used to build launch links. |

Set these keys with the `ConsoleLaunch__` prefix. Keep `ApiKey` in an
environment variable.

- Codes and sessions are in process memory. Several instances need sticky
  sessions.
- A launch request can be at most 64 KB.
- A sign-out clears the console connection. However, the launch cookie lasts
  until it expires, and a reload restores the vendor session. To limit this,
  shorten `SessionLifetimeMinutes`.

## Related pages

- [camus-cli](/docs/camus-cli)
- [camus-dump](/docs/camus-dump)
- [EXPLAIN](/docs/explain)
- [Authentication and authorization](/docs/sql-authentication)
- [Backup and restore](/docs/backup-and-restore)
- [C# extensions](/docs/csharp-extensions)
- [.NET driver](/docs/dotnet-driver)
