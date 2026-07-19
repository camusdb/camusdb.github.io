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
- .NET 10 SDK when building or running the server from source.
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

You can also let the MCP client launch it through `dotnet run`.

## Configuration

The server reads configuration from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `CAMUS_MCP_CONNECTION_STRING` | none | Full CamusDB connection string, for example `Endpoint=http://localhost:7141;Database=mydb;Timeout=30`. Takes precedence over `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_ENDPOINT` | `http://localhost:7141` | CamusDB endpoint when not using a full connection string. Multiple endpoints can be comma-separated for client-side round-robin. |
| `CAMUS_MCP_DEFAULT_DATABASE` | none | Database used when a tool call omits its `database` argument. Also inferred from `CAMUS_MCP_CONNECTION_STRING` when it contains `Database=...`. |
| `CAMUS_MCP_TIMEOUT_SECONDS` | client default, currently `10` | Per-command timeout when the server assembles a connection string from `CAMUS_MCP_ENDPOINT`. |
| `CAMUS_MCP_MAX_ROWS` | `1000` | Hard cap for rows returned by `select_query`. |

A tool's explicit `database` argument wins over `CAMUS_MCP_DEFAULT_DATABASE`.
Context-free statements such as `SHOW DATABASES` can run without a selected
database. Table-scoped statements need one.

## MCP Client Configuration

Most MCP clients use a JSON configuration block. Point `command` either at the
built executable or at `dotnet` with `run --project`.

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

Launching from source:

```json
{
  "mcpServers": {
    "camusdb": {
      "command": "dotnet",
      "args": ["run", "--project", "/path/to/camusdb-mcp/CamusDB.Mcp"],
      "env": {
        "CAMUS_MCP_CONNECTION_STRING": "Endpoint=http://localhost:7141;Database=mydb;Timeout=30"
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

CamusDB currently does not provide per-request authentication. The MCP server
inherits that posture: anyone who can launch the MCP process and reach the
configured CamusDB endpoint can use the exposed tools.

For agent workflows:

- Point the MCP server at a database or branch the agent is allowed to inspect
  or modify.
- Use `CAMUS_MCP_DEFAULT_DATABASE` to keep the agent scoped to the expected
  database by default.
- Prefer database branches when experimenting with schema or data changes.

See [Database Branching](/docs/database-branching) for isolated copy-on-write
workspaces.
