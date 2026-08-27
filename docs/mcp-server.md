---
sidebar_position: 7.2
---

# MCP server

CamusDB provides an MCP server, for an AI agent and for a client that speaks
MCP. MCP is the Model Context Protocol.

The server exposes a CamusDB node, or a cluster, through a typed surface of MCP
tools. An assistant can therefore inspect a database, explain a query, run
read-only SQL, and perform a controlled task of a setup of a database. It writes
no request of the API of the database by hand.

The MCP server speaks MCP over `stdio`. The MCP client starts it. The server
connects to CamusDB through the published provider `CamusDB.Client`.

## Prerequisites

- A CamusDB server that runs, and that the machine of the MCP client can reach.
- The SDK of .NET 10, for a build of the MCP server.
- The source of `camusdb-mcp`, from
  `https://github.com/camusdb/camusdb-mcp`.

The project `CamusDB.Mcp` holds the implementation of the server.

## Build

Clone the repository of the MCP server:

```bash
git clone https://github.com/camusdb/camusdb-mcp
cd camusdb-mcp
```

Build it:

```bash
dotnet build camusdb-mcp.sln
```

The built executable is at this path:

```text
CamusDB.Mcp/bin/Debug/net10.0/CamusDB.Mcp
```

## Configuration

The server reads its configuration from the environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `CAMUS_MCP_CONNECTION_STRING` | none | The full connection string of CamusDB, such as `Endpoint=http://localhost:7141;Database=mydb;Timeout=30`. It takes precedence over `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_ENDPOINT` | `http://localhost:7141` | The endpoint of CamusDB, when you use no full connection string. Separate several endpoints with a comma. The client then uses them in turn. |
| `CAMUS_MCP_DEFAULT_DATABASE` | none | The database that a call of a tool uses, when that call omits its `database` argument. CamusDB also takes the value from a `CAMUS_MCP_CONNECTION_STRING` that holds a `Database=...`. |
| `CAMUS_MCP_TIMEOUT_SECONDS` | The default of the client, at present `10` | The timeout of one command. It applies when the server builds a connection string from `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_MAX_ROWS` | `1000` | The hard cap of the rows that a `select_query` returns. |
| `CAMUS_MCP_USER` | none | The CamusDB user of the authentication. |
| `CAMUS_MCP_PASSWORD` | none | The password of the `CAMUS_MCP_USER`. The client exchanges it for a bearer token. A statement does not send the password again. |
| `CAMUS_MCP_ACCESS_TOKEN` | none | A bearer token from another source. The server uses it directly, instead of a login with a password. |
| `CAMUS_MCP_TOKEN_LIFETIME_SECONDS` | The default of the client, at present `600` | The fallback lifetime of a token, when the server reports no expiry. |

An explicit `database` argument of a tool wins over
`CAMUS_MCP_DEFAULT_DATABASE`.

A statement without a context can run without a selected database. `SHOW
DATABASES` is one example. A statement with the scope of a table needs a
database.

You can also supply a credential through `CAMUS_MCP_CONNECTION_STRING`. Use the
keys `User=...`, `Password=...`, `AccessToken=...`, and `TokenLifetime=...`.

A dedicated variable `CAMUS_MCP_*` for a credential wins over a key of a
credential of the connection string. It also wins over an alias of such a key.
Four aliases are `Uid`, `UserId`, `Username`, and `Pwd`.

## Authentication

The authentication of CamusDB is off by default. Leave the variables of the
credentials unset, against a server without authentication.

A server can start with `CAMUSDB_AUTH_ENABLED=true`. Give the MCP server a user
of CamusDB in that case:

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

`CamusDB.Client` handles the flow of the password. It exchanges the password for
a bearer token with a short life. A later call of a tool sends the token.

The cache of the tokens covers the whole process, for each set of credentials.
The MCP server therefore does not log in again for every short connection that a
call of a tool opens.

The client handles the renewal of a token. It also authenticates again after a
revoked token. Both actions need an available password.

Use `CAMUS_MCP_ACCESS_TOKEN` when another process created a bearer token
already:

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

The server uses an access token verbatim. It cannot renew that token. The call
of a tool fails with `CADB0516` after the token expires, and after somebody
revokes it. Prefer a `CAMUS_MCP_USER` with a `CAMUS_MCP_PASSWORD`, for a long
process of MCP.

### Privileges

Grant the user of MCP the privileges of the assistant only. A grant must cover
every table that a statement touches. That rule includes a table that the
statement reaches through a join, and through a subquery:

```camussql
CREATE USER mcp IDENTIFIED BY 'app-secret';
GRANT SELECT ON analytics.* TO mcp;
```

A read-only grant suits an assistant that must inspect a database, and must
modify nothing.

The MCP server still exposes a tool that mutates data. Three examples are
`create_database`, `create_table`, and `insert_rows`. CamusDB nevertheless
rejects such an operation on the server, when the user of MCP lacks the
necessary privilege.

The administration of a user and of a grant is not an MCP tool. Manage a user
and a grant elsewhere, with a connection of a superuser.

`select_query` can read a `SHOW GRANTS`, like any other `SHOW` statement. The
authorization on the server still applies.

### The errors of the authentication

| Code | Meaning |
| --- | --- |
| `CADB0516` | The credentials are absent, wrong, expired, or revoked. Correct the environment of MCP, and restart. You can also supply a fresh token. |
| `CADB0517` | The caller is authenticated. It lacks a necessary privilege. Grant the user of MCP an access to the affected database, or to the affected table. |
| `CADB0518` | There are too many attempts of a login, for that account. Wait for the window of the rate limit of the server. |
| `CADB0519` | A client sent a credential over plaintext, where CamusDB requires TLS. Use an endpoint with `https://`. You can also configure a trusted proxy that terminates TLS. |

### TLS

While authentication is enabled, CamusDB refuses a request with a credential
over plaintext. A request from loopback is the exception. A local development
over `http://localhost` therefore works without a certificate. For a deployment
outside loopback, use `https://`.

TLS can terminate before a request reaches CamusDB. Keep that plaintext hop
inside the boundary of your trust. Then configure CamusDB with
`require_tls_when_auth_enabled: false`, or with
`--require-tls-when-auth-enabled false`.

## The configuration of an MCP client

Most MCP clients use a block of a configuration in JSON. Point the `command` at
the built executable.

Here is an example with the built executable:

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

Here is an example with the authentication:

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

## The tools

### The tools of a read

These tools mutate no data:

| Tool | Description |
| --- | --- |
| `list_databases` | It lists the databases of the CamusDB cluster. |
| `list_tables` | It lists the tables of a database. |
| `list_branches` | It lists the branches of a root database. |
| `list_indexes` | It lists the readable indexes of a table. It omits an index that CamusDB still backfills. |
| `get_table_schema` | It returns the schema of the columns, from a `SHOW COLUMNS FROM`. The result holds the names, the types, the ability to hold a null, the keys, and the defaults. |

### The tools of a query

| Tool | Description |
| --- | --- |
| `select_query` | It runs a `SELECT` or a `SHOW` statement. It rejects SQL that mutates data, before the execution. `CAMUS_MCP_MAX_ROWS` caps the result. |
| `explain_query` | It runs an `EXPLAIN`. It adds the word `EXPLAIN` at the start, when the input is a bare `SELECT`. The argument `mode` accepts `plan`, `logical`, and `physical`. |

`select_query` accepts a named parameter. The SQL references that parameter as
an `@name` placeholder. The tool maps five kinds of JSON value to a parameter
value of CamusDB: a string, an integer, a number in floating point, a boolean,
and a `null`.

### The tools that mutate data

These tools build SQL from structured inputs. They then execute that SQL:

| Tool | Description |
| --- | --- |
| `create_database` | It creates a database. It supports an `IF NOT EXISTS`. |
| `create_table` | It creates a table, from a list of the definitions of the typed columns. |
| `insert_rows` | It inserts one row or more, with values in parameters. It divides a large batch into statements of 500 rows. |

`create_table` accepts these types of a column: `oid`, `int64`, `float64`,
`float32`, `string(N)`, `bool`, `bytes`, `date`, `datetime`, and `uuid`.

## The boundary of the safety

The MCP server separates the tools of a read from the tools that mutate data.

`select_query` accepts a statement whose first true keyword of SQL is a `SELECT`
or a `SHOW`. It accepts no other statement. `explain_query` accepts an `EXPLAIN`
only, or a bare `SELECT`.

The server removes the comments of the SQL before it checks the first keyword. A
statement therefore cannot hide a command that mutates data, behind a comment at
its start.

A tool that mutates data validates the names of the database, of the table, and
of the columns, before it builds the SQL. It passes each value through a
parameter of CamusDB. It puts no value inside the text of the SQL.

## Notes on the security

CamusDB supports authentication and authorization on the server. The MCP server
acts as the CamusDB principal of its own environment.

The MCP server is nevertheless a local capability, and an MCP client starts it.
Any person who can start that process, or reconfigure it, can use the access to
CamusDB that the process holds. Treat the file of the configuration of an MCP
client as a secret, while it holds a `CAMUS_MCP_PASSWORD` or a
`CAMUS_MCP_ACCESS_TOKEN`.

For a workflow of an agent, follow five rules:

- Point the MCP server at a database, or at a branch, that the agent may inspect
  or modify.
- Use `CAMUS_MCP_DEFAULT_DATABASE` to keep the agent inside the expected
  database, by default.
- Prefer a branch of a database for an experiment with a schema, and for an
  experiment with the data.
- Give the user of MCP the narrowest useful grants. The enforcement on the
  server is the durable boundary, after an MCP client asks for an operation that
  mutates data.
- Prefer a `CAMUS_MCP_USER` with a `CAMUS_MCP_PASSWORD` for a long session. The
  client can then renew a token. Use a `CAMUS_MCP_ACCESS_TOKEN` for a short
  session, and for a session that another system manages.

See [Database Branching](/docs/database-branching) for an isolated workspace
with a copy at the first write. See
[Authentication And Authorization](/docs/sql-authentication) for the users, the
grants, and the bearer tokens.
