---
sidebar_position: 7.25
---

import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

# Web Console

The CamusDB Web Console lets you browse, query, and administer a CamusDB node or
cluster from a browser, so you do not need a SQL client on each machine. You run
the console as a .NET tool, with Docker, or from source, and open it in a browser.

<ThemedImage
  alt="CamusDB Web Console"
  sources={{
    light: useBaseUrl('/img/screenshots/webconsole-query-light.webp'),
    dark: useBaseUrl('/img/screenshots/webconsole-query-dark.webp'),
  }}
/>

In the console you can browse schemas, run SQL, inspect results, edit small
result sets, export tables, view node configuration and engine metrics, read
`EXPLAIN` plans as visual flows, and administer backups.

## Requirements

- A running CamusDB server.
- Docker, or .NET 10 for the tool. Building from source requires the .NET 10 SDK.

By default, CamusDB serves REST on port `5095` and client gRPC on port `5096`.
The Web Console can use either protocol.

## Install as a .NET tool

For a local workspace, install the console from NuGet:

```bash
dotnet tool install -g CamusDB.WebConsole
camusdb-webconsole --endpoint http://localhost:5095 --database demo
```

The console listens on `http://127.0.0.1:5164` and opens your browser.

| Option | Description |
| --- | --- |
| `--endpoint <url>` | CamusDB endpoint; defaults to `http://localhost:5095`. |
| `--database <name>` | Database to open first. |
| `--protocol <name>` | `rest` (default) or `grpc`. |
| `--user <name>` | User to sign in as. Enter the password in Configure. |
| `--port <number>` | Console port; defaults to `5164`. Use `0` for a free port. |
| `--no-browser` | Start without opening a browser. |
| `--version`, `--help` | Show version or usage information. |

The environment variables below work for the tool too. There is no password
option; use Configure or `CamusDB__Password`. Update with:

```bash
dotnet tool update -g CamusDB.WebConsole
```

The tool binds to loopback by default. ASP.NET Core host options such as
`--urls` can override the address; an explicit address also disables automatic
browser opening. See [Network deployment](#network-deployment) before exposing it.

## Run it with Docker

The Docker image contains everything needed to run the console:

```bash
docker run --rm -p 127.0.0.1:8080:8080 \
  -e CamusDB__Endpoint=http://host.docker.internal:5095 \
  -e CamusDB__Database=demo \
  camusdb/camusdb-webconsole:latest
```

Open this address:

```text
http://localhost:8080
```

With Docker Desktop, `host.docker.internal` reaches CamusDB on the host machine.
A Linux host may not provide that DNS name. In that case, use the host's LAN IP,
or add this option:

```bash
--add-host=host.docker.internal:host-gateway
```

The published port is reachable only from the Docker host. See
[Network deployment](#network-deployment) before publishing it to other machines.

On first load, the console uses its configured defaults. Use the Configure
control in the app bar to change the endpoint, database, protocol, backup
endpoint, timeout, maximum rows, and credentials for the current browser
session.

## Run from source

From a checkout of [camusdb-webconsole](https://github.com/camusdb/camusdb-webconsole):

```bash
cd src/CamusDB.WebConsole
dotnet run
```

Open the address printed by the application.

## Configuration

The Web Console reads the `CamusDB` configuration section. In a container, set
the same keys as environment variables with two underscores.

| Setting | Environment variable | Description |
| --- | --- | --- |
| `Endpoint` | `CamusDB__Endpoint` | CamusDB base URL. Use the REST port for `rest` and the gRPC port for `grpc`. |
| `Database` | `CamusDB__Database` | Session database name. |
| `Protocol` | `CamusDB__Protocol` | `rest` by default. Also accepts `grpc`. |
| `TimeoutSeconds` | `CamusDB__TimeoutSeconds` | Request timeout in seconds; defaults to `30`, capped at `600`. |
| `MaxRows` | `CamusDB__MaxRows` | Rows per page for pageable queries, and the cap for other results and exports. Defaults to `1000`, capped at `100000`. |
| `User` | `CamusDB__User` | User to authenticate as. An empty value means no authentication. |
| `Password` | `CamusDB__Password` | Password for `User`. |
| `AccessToken` | `CamusDB__AccessToken` | A bearer token from another source. The console uses it instead of a login. |
| `RequireAccessToken` | `CamusDB__RequireAccessToken` | Refuse user/password sign-in. The console then accepts access tokens only. |
| `AllowInsecureCredentials` | `CamusDB__AllowInsecureCredentials` | Allow credentials to a non-loopback `http://` endpoint. Use only behind a trusted TLS terminator, private link, or tunnel. |
| `LockEndpoint` | `CamusDB__LockEndpoint` | Prevent browser sessions and vendor launch payloads from changing the configured endpoint or protocol. |
| `TokenLifetimeSeconds` | `CamusDB__TokenLifetimeSeconds` | Fallback token reuse window when the server reports no expiry. |
| `BackupEndpoint` | `CamusDB__BackupEndpoint` | Optional REST endpoint for backup administration. Use it when the main protocol is gRPC, or when the main endpoint is a pool and backups must target one node. |
| `BackupTimeoutSeconds` | `CamusDB__BackupTimeoutSeconds` | Optional timeout for backup administration calls. `0` uses the client default. |

For example:

```json
{
  "CamusDB": {
    "Endpoint": "http://localhost:5095",
    "Database": "test",
    "Protocol": "rest",
    "TimeoutSeconds": 30,
    "MaxRows": 1000,
    "User": "",
    "Password": "",
    "AccessToken": "",
    "RequireAccessToken": false,
    "AllowInsecureCredentials": false,
    "LockEndpoint": false,
    "TokenLifetimeSeconds": 0,
    "BackupEndpoint": "",
    "BackupTimeoutSeconds": 0
  }
}
```

`Protocol=grpc` needs an `Endpoint` that points at the gRPC listener, usually
`http://localhost:5096`.

Set `LockEndpoint` to `true` when the console is reachable beyond localhost and
users should not be able to repoint the server process at another CamusDB
endpoint. The same lock also applies to vendor-launched sessions.

Backup administration uses CamusDB's REST backup API. If the console connects
to CamusDB through gRPC, set `BackupEndpoint` to the HTTP/REST endpoint. If the
main `Endpoint` is a comma-separated pool of nodes, set `BackupEndpoint` to the
specific node that should receive backup commands. A coordinated backup must
reach the backup coordinator, the node that currently
[leads](/docs/concepts#leader) the cluster's backup metadata.

## Network deployment

The console has no separate sign-in protecting its web interface. Anyone who
can reach it can use its configured CamusDB connection. For shared deployments,
put an authenticated reverse proxy or VPN in front, enable
[CamusDB authentication](/docs/sql-authentication), and avoid shared default
credentials when each visitor should use their own identity.

Set `CamusDB__LockEndpoint=true` or configure
[`ConsoleLaunch__AllowedEndpoints`](#endpoint-safety) to control which servers
visitors can connect to. The allowlist applies to Configure as well as vendor
launches, even when vendor launch is disabled.

Keep Docker's loopback port binding when the proxy runs on the same host.
Set total connection limits for the console process with
`Kestrel__Limits__MaxConcurrentConnections` and
`Kestrel__Limits__MaxConcurrentUpgradedConnections`. Each browser tab keeps a
long-lived connection and session state in memory; the per-client cap below
is separate from these process-wide limits.

## Security controls

The console throttles failed sign-ins and vendor launch requests, and caps
open browser connections per client address. These controls are on by default
under the `Security` section:

```json
{
  "Security": {
    "LoginThrottleEnabled": true,
    "LoginFreeAttempts": 3,
    "LoginMaxAttempts": 10,
    "LoginSprayMultiplier": 5,
    "LoginWindowSeconds": 300,
    "LoginLockoutSeconds": 300,
    "LoginMaxDelaySeconds": 8,
    "MaxTrackedClients": 20000,
    "RateLimitEnabled": true,
    "LaunchPermitLimit": 30,
    "LaunchWindowSeconds": 60,
    "MaxConnectionsPerClient": 20
  }
}
```

| Setting | Environment variable | Description |
| --- | --- | --- |
| `LoginThrottleEnabled` | `Security__LoginThrottleEnabled` | Count and slow failed sign-ins from the Configure dialog. |
| `LoginFreeAttempts` | `Security__LoginFreeAttempts` | Failed sign-ins that add no delay. |
| `LoginMaxAttempts` | `Security__LoginMaxAttempts` | Failures for one address and one user before the console refuses to try for the lockout window. |
| `LoginSprayMultiplier` | `Security__LoginSprayMultiplier` | Multiplies the per-user limit to cap one address across all user names. |
| `LoginWindowSeconds` | `Security__LoginWindowSeconds` | How long failures are remembered. |
| `LoginLockoutSeconds` | `Security__LoginLockoutSeconds` | How long a refusal lasts. |
| `LoginMaxDelaySeconds` | `Security__LoginMaxDelaySeconds` | Maximum delay added before an attempt. |
| `MaxTrackedClients` | `Security__MaxTrackedClients` | Maximum number of client addresses kept in memory. |
| `RateLimitEnabled` | `Security__RateLimitEnabled` | Rate-limit vendor launch endpoints per client address. |
| `LaunchPermitLimit` | `Security__LaunchPermitLimit` | Requests one address may make to each launch endpoint per window. |
| `LaunchWindowSeconds` | `Security__LaunchWindowSeconds` | Length of the vendor launch rate-limit window. |
| `MaxConnectionsPerClient` | `Security__MaxConnectionsPerClient` | Open browser transport connections (`/_blazor`) per client address. Defaults to `20`; excess connections receive HTTP `429`. Set `0` to disable. |

The client key is the socket peer address. The console does not trust
`X-Forwarded-For` by default, because a caller can choose that header unless
forwarded headers are configured carefully at the reverse proxy. Behind a proxy,
visitors share that proxy's address for these limits unless trusted forwarded
headers are configured. Account for that shared limit when sizing the deployment.

## Authentication

CamusDB authentication is off by default. Without a configured credential, the
Web Console sends no `Authorization` header.

When a server starts with `CAMUSDB_AUTH_ENABLED=true`, sign in through the
Configure control in the app bar with either:

- A user and password.
- An access token from another source.

The console exchanges the password once for a short-lived bearer token. Later
statements send the token, not the password.

When the console has a password, it can renew a token before it expires, and it
can sign in again if the server rejects a token early.

Session behavior:

- Credentials entered in the Configure control belong to one browser session.
- The console does not put the session password into the connection string.
- The console remembers the user name in `localStorage` to prefill the dialog.
  It never stores passwords or access tokens there.
- The identity chip in the app bar has a sign-out control. Signing out revokes a
  token that the console created, then drops the connection.
- When you sign out, the console forgets a token you supplied. It does not
  revoke that token, because it did not create it.
- The console cannot renew a token you supplied.

You can also configure `User`, `Password`, or `AccessToken` in
`appsettings.json` or in a `CamusDB__*` environment variable, and the console
then signs in automatically. Use an environment variable or a secrets store
rather than committing a password.

### Token-only consoles

Set `CamusDB__RequireAccessToken=true` when the console must never accept a
user/password sign-in. The Configure dialog then offers only the access token
field, and the session service rejects any user or password supplied by a
caller.

This pins the sign-in method, not the server's authentication policy. If the
CamusDB server has authentication disabled, the console can still connect
without an identity because the server allows it.

`RequireAccessToken` cannot be combined with configured `User` or `Password`.
Startup fails instead of silently dropping those credentials. A supplied token
is not renewable, so the browser session ends when the server expires it.

Manage users and grants with SQL from a superuser session:

```camussql
CREATE USER app IDENTIFIED BY 'app-password';
GRANT SELECT, INSERT ON app_db.* TO app;
SHOW GRANTS FOR app;
```

A user without `SELECT` on a table still sees the table name in the schema
tree, but the tree shows its columns as unavailable because the user lacks the
privilege.

### TLS

While authentication is enabled, CamusDB refuses credential-bearing requests
over plaintext, except from loopback. Local development over
`http://localhost` works without a certificate. For any deployment beyond
loopback, point the console at an `https://` CamusDB endpoint.

If TLS terminates before requests reach CamusDB, keep that plaintext hop inside
your trust boundary and configure CamusDB with
`--require-tls-when-auth-enabled false`.

The driver also refuses credentials to a non-loopback `http://` endpoint before
anything is sent. Set `CamusDB__AllowInsecureCredentials=true` only when that
plaintext hop is protected by another mechanism, such as a private network, VPN,
SSH tunnel, or a trusted TLS terminator.

### Authentication errors

Authentication failures use the codes `CADB0516` to `CADB0519`. See
[Error codes](/docs/error-codes#common-user-facing-errors) for what each one
means.

## Vendor launch

An external product can open the console with its own branding and a CamusDB
access token that the user's browser never sees. This is useful when another
application already authenticates users and wants to offer a database console
inside that workflow.

The launch surface is off by default:

```json
{
  "ConsoleLaunch": {
    "Enabled": false,
    "ApiKey": "",
    "RequireHttps": true,
    "CodeLifetimeSeconds": 60,
    "SessionLifetimeMinutes": 60,
    "DefaultBrandName": "CamusDB Web Console",
    "MaxLiveEntries": 2000,
    "AllowedEndpoints": [],
    "PublicBaseUrl": ""
  }
}
```

| Setting | Environment variable | Description |
| --- | --- | --- |
| `Enabled` | `ConsoleLaunch__Enabled` | Enables the vendor launch endpoints. Disabled endpoints answer like ordinary missing routes. |
| `ApiKey` | `ConsoleLaunch__ApiKey` | Shared key sent as `X-Console-Key`. It must be at least 32 characters when launch is enabled. |
| `RequireHttps` | `ConsoleLaunch__RequireHttps` | Refuse to mint launch links over plaintext. Keep `true` unless TLS terminates before the console. |
| `CodeLifetimeSeconds` | `ConsoleLaunch__CodeLifetimeSeconds` | Lifetime of the single-use redirect code. |
| `SessionLifetimeMinutes` | `ConsoleLaunch__SessionLifetimeMinutes` | Lifetime of the launched browser session. |
| `DefaultBrandName` | `ConsoleLaunch__DefaultBrandName` | Name shown when no vendor launch is active. |
| `MaxLiveEntries` | `ConsoleLaunch__MaxLiveEntries` | Cap for live launch codes plus sessions. Handoffs have a separate cap of the same size, with at most eight unspent per session. New entries fail with HTTP `503` at the cap. |
| `AllowedEndpoints` | `ConsoleLaunch__AllowedEndpoints` | Optional endpoint allowlist for Configure and vendor launch payloads. |
| `PublicBaseUrl` | `ConsoleLaunch__PublicBaseUrl` | Absolute public console URL used to build returned launch links. |

Generate `ConsoleLaunch__ApiKey` with a cryptographically secure source, for
example:

```bash
openssl rand -base64 32
```

The flow has two steps:

1. The vendor backend calls `POST /api/console/sessions` with `X-Console-Key`
   and a JSON payload.
2. The vendor redirects the browser to the returned `launchUrl`.

Example backend call:

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

The response contains a single-use URL:

```json
{
  "launchUrl": "https://console.example.com/console/launch?code=...",
  "expiresInSeconds": 60
}
```

The token moves only from the vendor backend to the console backend. It is not
put in the URL, page HTML, `localStorage`, or JavaScript-readable state. The
browser receives an opaque session cookie.

`brandName` is validated before it is shown. It allows common letters, digits,
spaces, and punctuation such as `-_.,&'()+`, up to 64 characters. Control
characters, path separators, angle brackets, quotes, backticks, and emoji are
rejected.

Launch codes and sessions live in the console process. Multiple instances need
sticky sessions; a code issued by one instance cannot be redeemed by another.
Launch requests accept at most 64 KB. Signing out clears the current console
connection, but the launch cookie survives until its expiry, so a reload can
restore the vendor session.

### Endpoint safety

Configure and launch payloads can change the CamusDB endpoint. The console
process opens that URL, so visitors could otherwise make it reach internal
hosts. Use one of these controls for a network deployment:

- Set `CamusDB__LockEndpoint=true` to reject endpoint overrides.
- Set `ConsoleLaunch__AllowedEndpoints` to a comma-, semicolon-, or
  whitespace-separated allowlist. It also checks backup endpoint changes.

Allowed endpoint entries can be full origins or host patterns without
wildcards:

```bash
ConsoleLaunch__AllowedEndpoints="https://db.acme.example,db.internal.example:5095"
```

There is no wildcard syntax. Invalid entries fail startup instead of being
silently skipped. Endpoints explicitly set in the console configuration remain
accepted even if absent from the allowlist.

## Features

The Web Console provides:

- A console layout with dark and light themes: an app bar, a schema sidebar, a
  SQL editor, a results grid, and a connection footer.
- A configuration dialog for the endpoint, database, protocol, backup endpoint,
  timeout, row cap, and credentials.
- A schema browser built on `SHOW DATABASES`, `SHOW TABLES`, `SHOW
  COLUMNS FROM`, `SHOW INDEXES FROM`, `SHOW CREATE TABLE`, `SHOW SEQUENCES`,
  schema comments, foreign-key metadata, sequences, and branch metadata.
- The Monaco SQL editor.
- CamusDB SQL highlighting and completion for keywords, functions, tables, and
  columns in the current schema.
- `Run statement` runs the statement at the cursor with Ctrl/Cmd+Enter, or only
  the selected SQL when there is a selection.
- `Run script` runs each statement in order with Alt+X, stops at the first
  failure, and gives each statement its own result tab.
- A multi-tab query workspace.
- Cancellable query runs.
- Execution times and a status bar.
- Searchable query history with database, duration, row count, and errors.
- A paged, sortable, and filterable result grid that knows the types, including
  exact `NUMERIC` text.
- A flow view for `EXPLAIN` and `EXPLAIN (ANALYZE)` results, beside the raw
  result table.
- Context actions to rename databases, tables, columns, indexes, and sequences,
  and to edit data, export tables, change schema, or delete objects.
- Row edit and delete actions when a result set comes from a table context.
- CSV and JSON export for tables or the rows currently loaded in any result.
- Administration panels for engine metrics, statement statistics, index usage,
  effective variables, and backup controls.
- Interface preferences remembered in the browser's `localStorage`, such as
  open SQL tabs, editor text, the active database, the user name, the schema
  drawer width, the editor/results split, and query history. The theme choice
  is remembered in a browser cookie so the correct theme is painted before the
  app connects.

Double-click a table in the schema tree to insert:

```camussql
SELECT * FROM table_name
LIMIT 100
```

Right-click a database to create, rename, or drop it. The create-table
dialog can define columns, primary keys, single-column foreign keys, and
defaults such as `nextval('sequence')` or `NUMERIC '9.99'`.

Right-click a table to view or edit data, rename it, add a column, add an index,
add a foreign key, export the table, or drop the table. Columns and indexes can
also be renamed from their context menus. The add-column dialog runs
`ALTER TABLE ... ADD COLUMN`; a `NOT NULL` column needs a constant default
because existing rows get that value. The add-foreign-key dialog can create
multi-column foreign keys and lets the server validate existing rows.

Foreign keys appear under the table. Hover one to see its columns, referenced
table, and `ON DELETE` / `ON UPDATE` actions. Right-click a foreign key to drop
the constraint.

Sequences appear after tables. Double-click a sequence to insert
`SHOW CREATE SEQUENCE ...`; right-click one to show, rename, or drop it.
Dangerous actions require confirmation. DDL run from the editor also refreshes
the schema tree and schema-aware completion.

## Query behavior

The console routes SQL by statement shape:

- Statements that return rows, such as `SELECT`, `SHOW`, `EXPLAIN`, and `WITH`,
  render into the result grid.
- `INSERT ... RETURNING`, and other write statements with a `RETURNING` clause,
  render the returned rows into the result grid and show the affected-row count.
- DML and DDL statements render affected row counts and status messages.
- Database lifecycle actions in the schema browser run through the same
  database-level operations exposed by CamusDB.

For a `SELECT` without its own `LIMIT` or `OFFSET`, `MaxRows` is the page size.
Use `Fetch more` to append the next page. Add an `ORDER BY` when page order must
be stable. Other row-returning statements are capped at `MaxRows` and report
when the result was truncated. A single result can hold at most 100,000 rows;
then `Fetch more` stops. Narrow the query or use explicit `LIMIT` and `OFFSET`
to inspect more data.

Ordinary `SELECT`, `WITH`, and parenthesized queries use the driver's streaming
reader. `SHOW`, `EXPLAIN`, and writes with `RETURNING` use a buffered reader;
`MaxRows` limits displayed rows but does not prevent those responses from
being buffered in full.

When part of the editor text is selected, `Run statement` executes only the
selection. Otherwise it finds the statement at the cursor. `Run script` splits
the selection or tab at semicolons outside strings, quoted names, and comments.

The history control records the last 200 statements in `localStorage` and can
search or reopen them in a new tab. Password literals in `CREATE USER` and
`ALTER USER` are masked before storage.

The result grid styles values by type. It distinguishes `NULL`, numbers,
booleans, timestamps, blobs, UUIDs, exact `NUMERIC` values, and ordinary
strings, and it warns when the result was truncated by `MaxRows`.

Click a column heading to sort loaded rows, and use `Filter loaded rows` for a
client-side filter. In an `Edit/View Data` tab, sorting and the `WHERE` box are
sent to the server and reflected in the tab's SQL.

## Query plan flow

When a statement returns an `EXPLAIN`, `EXPLAIN (LOGICAL)`, `EXPLAIN
(PHYSICAL)`, or `EXPLAIN (ANALYZE)` result, the toolbar above the result adds a
`Table` / `Flow` switch. `Table` shows the raw rows returned by CamusDB. `Flow`
draws the plan as a diagram, with the source operator at the top and each
operator below the one that feeds it.

<ThemedImage
  alt="CamusDB Web Console query plan flow"
  sources={{
    light: useBaseUrl('/img/screenshots/webconsole-plan-light.webp'),
    dark: useBaseUrl('/img/screenshots/webconsole-plan-dark.webp'),
  }}
/>

Each operator card shows the operator family, the server's detail text, the
table or index involved, and its share of the estimated cost. The console marks
the highest-cost operator, so you can spot expensive parts of a plan without
scanning every row of the `EXPLAIN` table.

The edges show the estimated row flow between operators. With `EXPLAIN
(ANALYZE)`, the flow also includes measured rows, rows read, KV lookups, KV scan
entries, and the measured plan time. When an operator's measured row count is
far away from the estimate, the diagram marks it as an estimate miss.

Joins have a right input that is described in the join row rather than emitted
as a separate plan row. The flow renders that input as a dashed side box beside
the join, using the alias, index, or subquery table that the detail text
contains.

`UNION`, `INTERSECT`, and `EXCEPT` show their left and right input plans as
separate branches, including nested set operations. Per-span measurements for
gathers and broadcast probes stay attached to their operator.

Rows that describe the whole plan, such as `plan-info`, `distribution`, and
`cache`, appear below the diagram as plan notes. The console remembers whether
you last used `Table` or `Flow`, so the next plan opens in the same view.

## Row editing

`Edit/View Data` on a table opens a data tab. The tab runs `SELECT *` for that
table and attaches the table schema to the result, which enables row actions.

The edit dialog is generated from the table schema:

- Primary-key fields are read-only.
- Nullable fields get a `NULL` toggle.
- Values are validated against the column type before the console builds the
  SQL statement.
- `NUMERIC` values are kept as canonical decimal text and written back as
  `NUMERIC '...'`, so large exact decimals are not rounded through .NET
  `decimal` or JavaScript `number`.
- `UPDATE` and `DELETE` use the table primary key.

If a table has no primary key, edit and delete row actions are disabled with a
`Primary key required` hint. After a successful edit or delete, the data tab
refreshes its query.

## Administration

The Administration page exposes node-local operational views:

| Panel | What it shows or does |
| --- | --- |
| Engine stats | Runs `SHOW ENGINE STATS` and displays the metrics of the node that answered. |
| Statements | Runs `SHOW STATEMENT STATS` to compare query frequency, execution time, errors, scans, spills, retries, and plan changes. |
| Index usage | Runs `SHOW INDEX USAGE` for the current database to compare index reads, constraint checks, and writes. |
| Variables | Runs `SHOW VARIABLES` and displays effective configuration values for the node that answered. |
| Backups | Takes full, incremental, and coordinated backups; lists the backup catalog; validates a chain; previews or runs retention garbage collection. |

These views are node-local: they show only the node that answered, and do not
forward to another node. To compare a cluster, point the console at each node.

When authentication is enabled, Administration requires a superuser. Engine
metrics and index usage describe node-level workload, statement statistics can
contain other users' SQL, variables describe the node's configuration, and
backups cover every database on the node.

Backups are available only when the server has backup configuration. See
[Backup And Restore](/docs/backup-and-restore) for backup setup, retention,
coordinated backups, and offline restore.

### Find expensive statements

Open **Statements** and take two readings to compare activity over an interval,
or enable the ten-second auto-refresh. Filter by SQL text or database, and sort
by total time, mean time, calls, variation, errors, or rows read. **Reset baseline**
returns to cumulative totals. Maximum duration remains a lifetime value.

[Statement statistics](/docs/statement-stats) are disabled by default. Enable
them on the node you are inspecting:

```camussql
SET CLUSTER SETTING statement_stats_enabled = true;
```

### Review index usage

Open **Index usage** to compare readings or filter to potential drop candidates:
non-unique indexes that receive writes without query reads or constraint reads.
These are candidates for review, not automatic removal. Check all nodes and a
representative workload interval before dropping an index. Counters reset when
the node restarts. See [Index usage](/docs/index-usage).

Choosing a database in this panel also changes the console's current database.
Switching administration tabs preserves each panel's readings.

## Export

A table export runs `SELECT * FROM <table>`, capped by the current session's
`MaxRows`. The result toolbar can also export the rows currently loaded by any
query, after the grid's sort and filter. For a paged result, use `Fetch more`
before exporting if you need more rows. The console downloads CSV or JSON.

CSV uses proper quoting and escaping. JSON downloads an array of objects with
dates as ISO-8601 strings, blobs as hex, UUIDs in standard textual form, and
`NUMERIC` values as strings so no digits are lost.

If the table holds more rows than `MaxRows`, the export reports that the result
was truncated.

For a full logical backup or a restorable SQL dump, use
[camus-dump](/docs/camus-dump) instead.

## Notes

- The console browses schemas with SQL `SHOW` statements.
- The console does not use metadata-only client endpoints.
- The console is an operations UI, not an authorization boundary by itself.
  Authentication and grants on the CamusDB server remain the durable
  permission boundary.
- The console sends security headers that prevent framing, reduce MIME sniffing,
  and avoid leaking referrer details.

## Related pages

- [camus-cli](/docs/camus-cli)
- [camus-dump](/docs/camus-dump)
- [Authentication And Authorization](/docs/sql-authentication)
- [Backup And Restore](/docs/backup-and-restore)
- [TypeScript](/docs/typescript-connector)
- [.NET Driver](/docs/dotnet-driver)
- [Python Driver](/docs/python-driver)
