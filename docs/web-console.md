---
sidebar_position: 7.25
---

# Web Console

CamusDB Web Console is a browser UI for CamusDB. It is built with Blazor
Interactive Server and MudBlazor, and connects to CamusDB through the published
`CamusDB.Client` ADO.NET provider.

Use it when you want a graphical workspace for browsing schema, running SQL,
viewing results, editing small result sets, exporting table data, and managing a
development or operations database from a browser.

## Requirements

- A running CamusDB server.
- Docker.

CamusDB exposes REST on port `5095` by default and client gRPC on port `5096`.
The Web Console can use either protocol.

## Run With Docker

No local .NET install is required:

```bash
docker run --rm -p 8080:8080 \
  -e CamusDB__Endpoint=http://host.docker.internal:5095 \
  -e CamusDB__Database=demo \
  camusdb/camusdb-webconsole:latest
```

Open:

```text
http://localhost:8080
```

`host.docker.internal` reaches CamusDB on the host machine when using Docker
Desktop. On Linux hosts that do not provide that DNS name, use the host's LAN
IP or add:

```bash
--add-host=host.docker.internal:host-gateway
```

On first load, the console uses its configured defaults. Use **Configure** in
the app bar to change endpoint, database, protocol, timeout, max rows, or
credentials for the current browser session.

## Configuration

The Web Console reads the `CamusDB` configuration section. In containers, use
ASP.NET-style double-underscore environment variables.

| Setting | Environment variable | Description |
| --- | --- | --- |
| `Endpoint` | `CamusDB__Endpoint` | CamusDB base URL. Use the REST port for `rest` and the gRPC port for `grpc`. |
| `Database` | `CamusDB__Database` | Database name for the session. |
| `Protocol` | `CamusDB__Protocol` | `rest` by default, or `grpc`. |
| `TimeoutSeconds` | `CamusDB__TimeoutSeconds` | Request timeout. |
| `MaxRows` | `CamusDB__MaxRows` | Maximum rows materialized into the results grid. |
| `User` | `CamusDB__User` | User to authenticate as. Empty means unauthenticated. |
| `Password` | `CamusDB__Password` | Password for `User`. |
| `AccessToken` | `CamusDB__AccessToken` | Bearer token obtained elsewhere, used instead of logging in. |
| `TokenLifetimeSeconds` | `CamusDB__TokenLifetimeSeconds` | Fallback token reuse window when the server reports no expiry. |

Example:

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
    "TokenLifetimeSeconds": 0
  }
}
```

`Protocol=grpc` must point `Endpoint` at the gRPC listener, usually
`http://localhost:5096`.

## Authentication

CamusDB authentication is off by default. With no credentials configured, the
Web Console sends no `Authorization` header.

Against a server started with `CAMUSDB_AUTH_ENABLED=true`, sign in through
**Configure** in the app bar with either:

- a user and password
- an access token minted elsewhere

The password is exchanged once for a short-lived bearer token. Later statements
send the token, not the password. When the console has a password, the
underlying driver can renew tokens and re-authenticate if the server rejects a
token early.

Session behavior:

- Credentials entered in **Configure** are per browser session and live in that
  Blazor circuit's memory.
- The console does not put per-session passwords into the connection string.
- Only the user name is remembered in `localStorage` to prefill the dialog.
- The password is not stored in `localStorage`.
- **Sign out** from the identity chip in the app bar revokes a token minted by
  the console and drops the connection.
- A supplied access token is forgotten on sign out but is not revoked, because
  the console did not mint it.
- A supplied access token cannot be renewed by the console.

You can also configure `User`, `Password`, or `AccessToken` in
`appsettings.json` or `CamusDB__*` environment variables for automatic sign-in.
Prefer environment variables or a secret store over committing a password.

Manage users and grants with SQL from a superuser session:

```camussql
CREATE USER app IDENTIFIED BY 'app-password';
GRANT SELECT, INSERT ON app_db.* TO app;
SHOW GRANTS FOR app;
```

A user without `SELECT` on a table can still see the table name in the schema
tree. Expanding it shows that columns are unavailable because the user lacks
privilege.

### TLS

When authentication is enabled, CamusDB refuses credential-bearing requests over
plaintext except from loopback. Local development over `http://localhost` works
without certificates. For non-loopback deployments, point the console at an
`https://` CamusDB endpoint.

If TLS terminates before the request reaches CamusDB, keep that plaintext hop
inside the trust boundary and configure CamusDB with
`--require-tls-when-auth-enabled false`.

### Authentication Errors

| Code | Meaning |
| --- | --- |
| `CADB0516` | Authentication failed: missing, invalid, expired, or rejected credentials. |
| `CADB0517` | Authenticated, but missing a required privilege for a statement. |
| `CADB0518` | Too many login attempts for the account. |
| `CADB0519` | Credentials were sent over plaintext where CamusDB requires TLS. |

## Features

The Web Console provides:

- dark console layout with app bar, schema sidebar, SQL editor, results grid,
  and connection footer
- **Configure** dialog for endpoint, database, protocol, timeout, row cap, and
  credentials
- schema browser using `SHOW DATABASES`, `SHOW TABLES`, `SHOW COLUMNS FROM`,
  `SHOW INDEXES FROM`, and branch metadata
- Monaco SQL editor
- CamusDB-specific SQL highlighting and keyword/function completion
- **Run query** button and Ctrl/Cmd+Enter execution
- multi-tab query workspace
- cancellable query runs
- execution timings and status bar
- type-aware results grid with row-cap warnings
- table context actions such as edit/view data, export table, and delete table
- row edit and delete actions when a result set is tied to a table context
- CSV and JSON table export, capped by `MaxRows`
- remembered UI preferences such as editor content, editor height, and console
  layout settings in browser `localStorage`

Double-clicking a table in the schema tree inserts:

```camussql
SELECT * FROM table_name
LIMIT 100
```

## Query Behavior

The console sends SQL through `CamusDB.Client`:

- reader execution for result sets such as `SELECT`, `SHOW`, `EXPLAIN`, and
  `WITH`
- non-query execution for DML and DDL
- client helper paths for database create/drop and branch database creation
  where the client exposes dedicated methods

The results grid materializes at most `MaxRows` rows. Keep this value reasonable
for large tables; the client buffers full query responses before the grid
renders them.

## Export

Table export runs a `SELECT * FROM <table>` capped by the current session's
`MaxRows` and downloads either:

- CSV
- JSON

If the table contains more rows than `MaxRows`, the export reports that it was
truncated.

For full logical backups and restoreable SQL dumps, use
[camus-dump](/docs/camus-dump) instead.

## Notes

- The console uses SQL `SHOW` statements for schema browsing.
- Metadata-only client endpoints are not used by the console.
- The console is an operational UI, not an authorization boundary by itself.
  CamusDB server-side authentication and grants remain the durable permission
  boundary.

## Related Pages

- [camus-cli](/docs/camus-cli)
- [camus-dump](/docs/camus-dump)
- [Authentication And Authorization](/docs/sql-authentication)
- [.NET Driver](/docs/dotnet-driver)
