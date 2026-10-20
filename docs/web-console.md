---
sidebar_position: 7.25
---

# Web Console

The CamusDB Web Console lets you browse, query, and administer a CamusDB node or
cluster from a browser, so you do not need a SQL client on each machine. You run
the console once, with Docker or from source, and open it in any browser.

![CamusDB Web Console](/img/webconsole.png)

In the console you can browse schemas, run SQL, inspect results, edit small
result sets, export tables, view node configuration and engine metrics, read
`EXPLAIN` plans as visual flows, and administer backups.

## Requirements

- A CamusDB server that runs.
- Docker, or the .NET 10 SDK when running from source.

CamusDB exposes REST on the port `5095` by default. It exposes the gRPC of a
client on the port `5096`. The Web Console can use either protocol.

## Run it with Docker

The Docker image contains everything needed to run the console:

```bash
docker run --rm -p 8080:8080 \
  -e CamusDB__Endpoint=http://host.docker.internal:5095 \
  -e CamusDB__Database=demo \
  camusdb/camusdb-webconsole:latest
```

Open this address:

```text
http://localhost:8080
```

`host.docker.internal` reaches CamusDB on the host machine, with Docker Desktop.
A host with Linux may not provide that name of the DNS. Use the LAN IP of the
host in that case. You can also add this option:

```bash
--add-host=host.docker.internal:host-gateway
```

At the first load, the console uses its configured defaults. Use the Configure
control of the app bar to change the endpoint, database, protocol, backup
endpoint, timeout, maximum rows, and credentials for the current browser
session.

## Configuration

The Web Console reads the `CamusDB` section of the configuration. In a
container, set the same keys as environment variables with two underscores.

| Setting | Environment variable | Description |
| --- | --- | --- |
| `Endpoint` | `CamusDB__Endpoint` | The base URL of CamusDB. Use the port of REST for `rest`. Use the port of gRPC for `grpc`. |
| `Database` | `CamusDB__Database` | The name of the database of the session. |
| `Protocol` | `CamusDB__Protocol` | It is `rest` by default. It also accepts `grpc`. |
| `TimeoutSeconds` | `CamusDB__TimeoutSeconds` | The timeout of a request. |
| `MaxRows` | `CamusDB__MaxRows` | Rows per page for pageable queries, and the cap for other results and exports. |
| `User` | `CamusDB__User` | The user of the authentication. An empty value means no authentication. |
| `Password` | `CamusDB__Password` | The password of the `User`. |
| `AccessToken` | `CamusDB__AccessToken` | A bearer token from another source. The console uses it instead of a login. |
| `RequireAccessToken` | `CamusDB__RequireAccessToken` | Refuse user/password sign-in. The console then accepts access tokens only. |
| `AllowInsecureCredentials` | `CamusDB__AllowInsecureCredentials` | Allow credentials to a non-loopback `http://` endpoint. Use only behind a trusted TLS terminator, private link, or tunnel. |
| `LockEndpoint` | `CamusDB__LockEndpoint` | Prevent browser sessions and vendor launch payloads from changing the configured endpoint or protocol. |
| `TokenLifetimeSeconds` | `CamusDB__TokenLifetimeSeconds` | The fallback window for the reuse of a token, when the server reports no expiry. |
| `BackupEndpoint` | `CamusDB__BackupEndpoint` | Optional REST endpoint for backup administration. Use it when the main protocol is gRPC, or when the main endpoint is a pool and backups must target one node. |
| `BackupTimeoutSeconds` | `CamusDB__BackupTimeoutSeconds` | Optional timeout for backup administration calls. `0` uses the client default. |

Here is an example:

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

A `Protocol=grpc` needs an `Endpoint` at the listener of gRPC. That address is
usually `http://localhost:5096`.

Set `LockEndpoint` to `true` when the console is reachable beyond localhost and
users should not be able to repoint the server process at another CamusDB
endpoint. The same lock also applies to vendor-launched sessions.

Backup administration uses CamusDB's REST backup API. If the console connects
to CamusDB through gRPC, set `BackupEndpoint` to the HTTP/REST endpoint. If the
main `Endpoint` is a comma-separated pool of nodes, set `BackupEndpoint` to the
specific node that should receive backup commands. A coordinated backup must
reach the backup coordinator, the node that currently
[leads](/docs/concepts#leader) the cluster's backup metadata.

## Security controls

The Web Console has two local throttles in front of surfaces that an
unauthenticated caller can reach: sign-in from the Configure dialog, and vendor
launch endpoints. They are on by default under the `Security` section:

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
    "LaunchWindowSeconds": 60
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

The client key is the socket peer address. The console does not trust
`X-Forwarded-For` by default, because a caller can choose that header unless
forwarded headers are configured carefully at the reverse proxy.

## Authentication

The authentication of CamusDB is off by default. Without a configured
credential, the Web Console sends no `Authorization` header.

A server can start with `CAMUSDB_AUTH_ENABLED=true`. Sign in through the
Configure control of the app bar, in one of two ways:

- With a user and a password.
- With an access token from another source.

The console exchanges the password one time, for a bearer token with a short
life. A later statement sends the token. It does not send the password.

When the console has a password, it can renew a token before it expires. It can
also sign in again if the server rejects a token early.

Note this behavior of a session:

- A credential from the Configure control belongs to one browser session.
- The console does not put the password of a session into the connection string.
- The console remembers the name of the user in `localStorage`. It uses that
  name to fill the dialog. It never stores passwords or access tokens there.
- The identity chip of the app bar holds a control to sign out. That control
  revokes a token that the console created. It then drops the connection.
- The console forgets a token that you supplied, at the sign-out. It does not
  revoke that token, because it did not create the token.
- The console cannot renew a token that you supplied.

You can also configure a `User`, a `Password`, or an `AccessToken`. Put the
value in `appsettings.json`, or in a `CamusDB__*` environment variable. The
console then signs in automatically. Prefer an environment variable, or a store
of secrets, to a password inside a commit.

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

Manage the users and the grants with SQL, from a session of a superuser:

```camussql
CREATE USER app IDENTIFIED BY 'app-password';
GRANT SELECT, INSERT ON app_db.* TO app;
SHOW GRANTS FOR app;
```

A user without a `SELECT` on a table still sees the name of that table in the
tree of the schema. The tree shows that the columns are unavailable, because
that user lacks the privilege.

### TLS

While authentication is enabled, CamusDB refuses a request with a credential
over plaintext. A request from loopback is the exception.

A local development over `http://localhost` therefore works without a
certificate. For a deployment outside loopback, point the console at a CamusDB
endpoint with `https://`.

TLS can terminate before a request reaches CamusDB. Keep that plaintext hop
inside the boundary of your trust. Then configure CamusDB with
`--require-tls-when-auth-enabled false`.

The driver also refuses credentials to a non-loopback `http://` endpoint before
anything is sent. Set `CamusDB__AllowInsecureCredentials=true` only when that
plaintext hop is protected by another mechanism, such as a private network, VPN,
SSH tunnel, or a trusted TLS terminator.

### Authentication errors

Authentication failures use the codes `CADB0516` to `CADB0519`. See
[Error codes](/docs/error-codes#common-user-facing-errors) for what each one
means.

## Vendor Launch

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
| `MaxLiveEntries` | `ConsoleLaunch__MaxLiveEntries` | Cap for live launch codes, sessions, and handoffs. At the cap, new launches fail closed. |
| `AllowedEndpoints` | `ConsoleLaunch__AllowedEndpoints` | Optional allowlist for CamusDB endpoints accepted from launch payloads. |
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

### Endpoint Safety

A launch payload may include `endpoint` and `protocol`. The console process
opens that endpoint, so allowing arbitrary values can let a caller make the
console reach internal hosts. Use one of these controls for any deployed
console:

- Set `CamusDB__LockEndpoint=true` to reject endpoint overrides.
- Set `ConsoleLaunch__AllowedEndpoints` to a comma-, semicolon-, or
  whitespace-separated allowlist.

Allowed endpoint entries can be full origins or host patterns without
wildcards:

```bash
ConsoleLaunch__AllowedEndpoints="https://db.acme.example,db.internal.example:5095"
```

There is no wildcard syntax. Invalid entries fail startup instead of being
silently skipped.

## Features

The Web Console provides these features:

- A console layout with dark and light themes. It holds an app bar, a sidebar of
  the schema, an editor of SQL, a grid of the results, and a footer of the
  connection.
- A dialog of the configuration. It covers the endpoint, the database, the
  protocol, the backup endpoint, the timeout, the cap of the rows, and the
  credentials.
- A browser of the schema. It uses `SHOW DATABASES`, `SHOW TABLES`, `SHOW
  COLUMNS FROM`, `SHOW INDEXES FROM`, `SHOW CREATE TABLE`, `SHOW SEQUENCES`,
  schema comments, foreign-key metadata, sequences, and the metadata of a branch.
- The Monaco editor of SQL.
- CamusDB SQL highlighting and completion for keywords, functions, tables, and
  columns in the current schema.
- `Run statement` runs the statement at the cursor with Ctrl/Cmd+Enter, or only
  the selected SQL when there is a selection.
- `Run script` runs each statement in order with Alt+X, stops at the first
  failure, and gives each statement its own result tab.
- A workspace of queries, with several tabs.
- A run of a query that you can cancel.
- The times of the execution, and a bar of the status.
- Searchable query history with database, duration, row count, and errors.
- A paged, sortable, and filterable result grid that knows the types, including
  exact `NUMERIC` text.
- A flow view for `EXPLAIN` and `EXPLAIN (ANALYZE)` results, beside the raw
  result table.
- Context actions to rename databases, tables, columns, indexes, and sequences,
  and to edit data, export tables, change schema, or delete objects.
- The actions of an edit and of a delete of a row, when a result set belongs to
  the context of a table.
- CSV and JSON export for tables or the rows currently loaded in any result.
- Administration pages for node-local engine metrics, effective variables, and
  backup controls.
- The preferences of the interface that the console remembers, in the
  `localStorage` of the browser. Examples include open SQL tabs, editor text,
  the active database, the user name, the schema drawer width, and the
  editor/results split and query history. The theme choice is remembered in a
  browser cookie so the correct theme is painted before the app connects.

Two clicks on a table of the tree of the schema insert this text:

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
Dangerous actions require confirmation.

## The behavior of a query

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
when the result was truncated.

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

![CamusDB Web Console query plan flow](/img/webconsole-query-plan.png)

Each operator card shows the operator family, the server's detail text, the
table or index involved, and its share of the estimated cost. The highest-cost
operator is marked so expensive parts of a plan are visible without scanning
every row of the `EXPLAIN` table.

The edges show the estimated row flow between operators. With `EXPLAIN
(ANALYZE)`, the flow also includes measured rows, rows read, KV lookups, KV scan
entries, and the measured plan time. When an operator's measured row count is
far away from the estimate, the diagram marks it as an estimate miss.

Joins have a right input that is described in the join row rather than emitted
as a separate plan row. The flow renders that input as a dashed side box beside
the join, using the alias, index, or subquery table that the detail text
contains.

Rows that describe the whole plan, such as `plan-info`, `distribution`, and
`cache`, appear below the diagram as plan notes. The console remembers whether
you last used `Table` or `Flow`, so the next plan opens in the same view.

## Row Editing

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
| Variables | Runs `SHOW VARIABLES` and displays effective configuration values for the node that answered. |
| Backups | Takes full, incremental, and coordinated backups; lists the backup catalog; validates a chain; previews or runs retention garbage collection. |

These views are node-local: they show only the node that answered, and do not
forward to another node. To compare a cluster, point the console at each node.

When authentication is enabled, Administration requires a superuser. Engine
metrics describe node-level workload, variables describe the node's security
and runtime posture, and backups cover every database on the node.

Backups are available only when the server has backup configuration. See
[Backup And Restore](/docs/backup-and-restore) for backup setup, retention,
coordinated backups, and offline restore.

## Export

An export of a table runs a `SELECT * FROM <table>`. The `MaxRows` of the
current session caps that statement. The result toolbar can also export the
rows currently loaded by any query, after the grid's sort and filter. For a
paged result, use `Fetch more` before export when more rows are needed. The
console downloads one of two formats:

- CSV.
- JSON.

CSV uses proper quoting and escaping. JSON downloads an array of objects with
dates as ISO-8601 strings, blobs as hex, UUIDs in standard textual form, and
`NUMERIC` values as strings so no digits are lost.

The table can hold more rows than `MaxRows`. The export then reports that the
result was truncated.

For a full logical backup, and for a dump of SQL that you can restore, use
[camus-dump](/docs/camus-dump) instead.

## Notes

- The console uses the `SHOW` statements of SQL to browse a schema.
- The console does not use the endpoints of a client for the metadata only.
- The console is a user interface for an operation. It is not a boundary of the
  authorization by itself. The authentication and the grants on the server of
  CamusDB remain the durable boundary of a permission.
- The console sends security headers that prevent framing, reduce MIME sniffing,
  and avoid leaking referrer details.

## Related pages

- [camus-cli](/docs/camus-cli)
- [camus-dump](/docs/camus-dump)
- [Authentication And Authorization](/docs/sql-authentication)
- [Backup And Restore](/docs/backup-and-restore)
- [TypeScript](/docs/typescript-connector)
- [.NET Driver](/docs/dotnet-driver)
