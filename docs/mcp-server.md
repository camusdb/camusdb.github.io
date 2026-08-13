---
sidebar_position: 7.2
---

# MCP Server

CamusDB provides an MCP server for AI agents and MCP-capable clients. The server
exposes a running CamusDB node or cluster through a typed Model Context Protocol
tool surface, so an assistant can inspect databases, explain queries, run
read-only SQL, and perform controlled database setup tasks without hand-writing
database API requests.

The MCP server speaks MCP over `stdio` and is launched by the MCP client. It
connects to CamusDB through the published `CamusDB.Client` provider.

## Prerequisites

- A running CamusDB server reachable from the machine running the MCP client.
- .NET 10 SDK when building the MCP server.
- The `camusdb-mcp` source checkout from
  `https://github.com/camusdb/camusdb-mcp`.

The server is implemented in the `CamusDB.Mcp` project.

## Build

Clone the MCP server repository:

```bash
git clone https://github.com/camusdb/camusdb-mcp
cd camusdb-mcp
```

Build it:

```bash
dotnet build camusdb-mcp.sln
```

The built executable is:

```text
CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp
```

## Configuration

The server reads configuration from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `CAMUS_MCP_CONNECTION_STRING` | none | Full CamusDB connection string, for example `Endpoint=http://localhost:7141;Database=mydb;Timeout=30`. Takes precedence over `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_ENDPOINT` | `http://localhost:7141` | CamusDB endpoint when not using a full connection string. Multiple endpoints can be comma-separated for client-side round-robin. |
| `CAMUS_MCP_DEFAULT_DATABASE` | none | Database used when a tool call omits its `database` argument. Also inferred from `CAMUS_MCP_CONNECTION_STRING` when it contains `Database=...`. |
| `CAMUS_MCP_TIMEOUT_SECONDS` | client default, currently `10` | Per-command timeout when the server assembles a connection string from `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_MAX_ROWS` | `1000` | Hard cap for rows returned by `select_query`. |
| `CAMUS_MCP_USER` | none | CamusDB user to authenticate as. |
| `CAMUS_MCP_PASSWORD` | none | Password for `CAMUS_MCP_USER`. The client exchanges it for a bearer token; statements do not resend the password. |
| `CAMUS_MCP_ACCESS_TOKEN` | none | Bearer token obtained elsewhere, used directly instead of logging in with a password. |
| `CAMUS_MCP_TOKEN_LIFETIME_SECONDS` | client default, currently `600` | Fallback token lifetime when the server does not report an expiry. |

A tool's explicit `database` argument wins over `CAMUS_MCP_DEFAULT_DATABASE`.
Context-free statements such as `SHOW DATABASES` can run without a selected
database. Table-scoped statements need one.

Credentials can also be supplied through `CAMUS_MCP_CONNECTION_STRING` with
`User=...`, `Password=...`, `AccessToken=...`, and `TokenLifetime=...`.
Dedicated `CAMUS_MCP_*` credential variables win over connection-string
credential keys and aliases such as `Uid`, `UserId`, `Username`, and `Pwd`.

## Authentication

CamusDB authentication is off by default. Against an unauthenticated server,
leave the credential variables unset.

Against a server started with `CAMUSDB_AUTH_ENABLED=true`, give the MCP server
a CamusDB user:

```json
{
  "mcpServers": {
    "camusdb": {
      "command": "/path/to/camusdb-mcp/CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp",
      "env": {
        "CAMUS_MCP_ENDPOINT": "https://camus.internal:5095",
        "CAMUS_MCP_DEFAULT_DATABASE": "analytics",
        "CAMUS_MCP_USER": "mcp",
        "CAMUS_MCP_PASSWORD": "app-secret"
      }
    }
  }
}
```

The password flow is handled by `CamusDB.Client`: the password is exchanged for
a short-lived bearer token, and later tool calls send the token. The token cache
is process-wide per credential set, so the MCP server does not log in again for
every short-lived connection opened by a tool call. Token renewal and
re-authentication after a revoked token are handled by the client when a
password is available.

Use `CAMUS_MCP_ACCESS_TOKEN` when another process already minted a bearer
token:

```json
{
  "mcpServers": {
    "camusdb": {
      "command": "/path/to/camusdb-mcp/CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp",
      "env": {
        "CAMUS_MCP_ENDPOINT": "https://camus.internal:5095",
        "CAMUS_MCP_DEFAULT_DATABASE": "analytics",
        "CAMUS_MCP_ACCESS_TOKEN": "camus_..."
      }
    }
  }
}
```

An access token is used verbatim and cannot be renewed by the MCP server. If it
expires or is revoked, the tool call fails with `CADB0516`. Prefer
`CAMUS_MCP_USER` plus `CAMUS_MCP_PASSWORD` for a long-running MCP process.

### Privileges

Grant the MCP user only the privileges the assistant should have. Every table a
statement touches must be covered by a grant, including tables reached through
joins and subqueries:

```camussql
CREATE USER mcp IDENTIFIED BY 'app-secret';
GRANT SELECT ON analytics.* TO mcp;
```

A read-only grant is appropriate when the assistant should inspect databases
but not modify them. The MCP server still exposes mutating tools such as
`create_database`, `create_table`, and `insert_rows`, but CamusDB rejects those
operations server-side when the MCP user lacks the required privileges.

User and grant administration is not exposed as MCP tools. Manage users and
grants out of band with a superuser connection. `SHOW GRANTS` can be read
through `select_query` like other `SHOW` statements, subject to server-side
authorization.

### Authentication Errors

| Code | Meaning |
| --- | --- |
| `CADB0516` | Missing, wrong, expired, or revoked credentials. Fix the MCP environment and restart, or provide a fresh token. |
| `CADB0517` | Authenticated, but missing a required privilege. Grant the MCP user access to the affected database or table. |
| `CADB0518` | Too many login attempts for the account. Wait for the server-side rate-limit window. |
| `CADB0519` | Credentials were sent over plaintext where CamusDB requires TLS. Use an `https://` endpoint or configure a trusted TLS-terminating proxy. |

### TLS

When authentication is enabled, CamusDB refuses credential-bearing requests
over plaintext except from loopback. Local development over `http://localhost`
works without certificates. For non-loopback deployments, use `https://`.

If TLS terminates before the request reaches CamusDB, keep that plaintext hop
inside the trust boundary and configure CamusDB with
`require_tls_when_auth_enabled: false` or
`--require-tls-when-auth-enabled false`.

## MCP Client Configuration

Most MCP clients use a JSON configuration block. Point `command` at the built
executable.

Using the built executable:

```json
{
  "mcpServers": {
    "camusdb": {
      "command": "/path/to/camusdb-mcp/CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp",
      "env": {
        "CAMUS_MCP_ENDPOINT": "http://localhost:7141",
        "CAMUS_MCP_DEFAULT_DATABASE": "mydb"
      }
    }
  }
}
```

Authenticated example:

```json
{
  "mcpServers": {
    "camusdb": {
      "command": "/path/to/camusdb-mcp/CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp",
      "env": {
        "CAMUS_MCP_ENDPOINT": "https://camus.internal:5095",
        "CAMUS_MCP_DEFAULT_DATABASE": "mydb",
        "CAMUS_MCP_USER": "mcp",
        "CAMUS_MCP_PASSWORD": "app-secret"
      }
    }
  }
}
```

## Tools

### Read Tools

These tools do not mutate data:

| Tool | Description |
| --- | --- |
| `list_databases` | Lists databases in the CamusDB cluster. |
| `list_tables` | Lists tables in a database. |
| `list_branches` | Lists branches of a root database. |
| `list_indexes` | Lists readable indexes on a table. Indexes still being backfilled are omitted. |
| `get_table_schema` | Returns column schema from `SHOW COLUMNS FROM`, including names, types, nullability, keys, and defaults. |

### Query Tools

| Tool | Description |
| --- | --- |
| `select_query` | Runs a `SELECT` or `SHOW` statement. Mutating SQL is rejected before execution. Results are capped by `CAMUS_MCP_MAX_ROWS`. |
| `explain_query` | Runs `EXPLAIN`. If the input is a bare `SELECT`, the tool prepends `EXPLAIN`. The `mode` argument supports `plan`, `logical`, and `physical`. |

`select_query` accepts named parameters referenced as `@name` placeholders.
JSON strings, integers, floating-point numbers, booleans, and `null` are mapped
to CamusDB parameter values.

### Mutating Tools

These tools compose SQL from structured inputs and execute it:

| Tool | Description |
| --- | --- |
| `create_database` | Creates a database and supports `IF NOT EXISTS`. |
| `create_table` | Creates a table from a typed column definition list. |
| `insert_rows` | Inserts one or more rows with parameterized values. Large batches are chunked at 500 rows per statement. |

`create_table` accepts column types such as `oid`, `int64`, `float64`,
`float32`, `string(N)`, `bool`, `bytes`, `date`, `datetime`, and `uuid`.

## Safety Boundary

The MCP server separates read tools from mutating tools.

`select_query` accepts only statements whose first real SQL keyword is `SELECT`
or `SHOW`. `explain_query` accepts only `EXPLAIN` or a bare `SELECT`. The server
strips SQL comments before checking the first keyword, so a statement cannot
hide a mutating command behind a leading comment.

Mutating tools validate database, table, and column names before composing SQL.
Values are passed through CamusDB parameters, not interpolated into SQL text.

## Security Notes

CamusDB supports server-side authentication and authorization. The MCP server
acts as the CamusDB principal configured in its environment.

The MCP server is still a local capability launched by an MCP client: anyone
who can start or reconfigure that process can use the CamusDB access available
to it. Treat MCP client config files as secrets when they contain
`CAMUS_MCP_PASSWORD` or `CAMUS_MCP_ACCESS_TOKEN`.

For agent workflows:

- Point the MCP server at a database or branch the agent is allowed to inspect
  or modify.
- Use `CAMUS_MCP_DEFAULT_DATABASE` to keep the agent scoped to the expected
  database by default.
- Prefer database branches when experimenting with schema or data changes.
- Give the MCP user the narrowest useful grants. Server-side enforcement is the
  durable boundary if an MCP client asks for a mutating operation.
- Prefer `CAMUS_MCP_USER` and `CAMUS_MCP_PASSWORD` for long-running sessions so
  the client can renew tokens; use `CAMUS_MCP_ACCESS_TOKEN` for short-lived or
  externally managed sessions.

See [Database Branching](/docs/database-branching) for isolated copy-on-write
workspaces and [Authentication And Authorization](/docs/sql-authentication) for
users, grants, and bearer tokens.
