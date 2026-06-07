---
sidebar_position: 7.1
---

# .NET Driver

CamusDB ships an ADO.NET provider for direct access from .NET applications.
The package name is `CamusDB.Client`.

It targets `net8.0` and `net9.0`.

## Install

```bash
dotnet add package CamusDB.Client
```

## Connection String

Create a `CamusConnection` with a connection string containing:

- `Endpoint`: the base CamusDB HTTP endpoint
- `Database`: the database name to use

```csharp
using CamusDB.Client;

CamusConnectionStringBuilder builder =
    new("Endpoint=http://localhost:5095;Database=test");

await using CamusConnection connection = new(builder);
await connection.OpenAsync();
```

Supported keys:

| Key | Required | Description |
| --- | --- | --- |
| `Endpoint` | Yes | Base URL for the CamusDB node. |
| `Database` | Yes | Database name sent on requests. |

`Endpoint` can also be a comma-separated pool:

```text
Endpoint=http://localhost:5095,http://localhost:5096,http://localhost:5097;Database=test
```

The client uses round-robin routing across endpoints. If one endpoint becomes
unreachable, it is marked unhealthy and skipped by later requests that use the
same connection-string builder.

## Open A Connection

```csharp
await using CamusConnection connection =
    new(new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=test"));

await connection.OpenAsync();
```

`ChangeDatabase("otherdb")` updates the target database on the connection.

## Ping

Use a ping command to verify connectivity:

```csharp
await using CamusCommand ping = connection.CreatePingCommand();
int result = await ping.ExecuteNonQueryAsync();
```

## Run DDL

Use `CreateCamusCommand(...)` for SQL statements:

```csharp
await using CamusCommand ddl = connection.CreateCamusCommand("""
    CREATE TABLE robots (
        id OID PRIMARY KEY NOT NULL,
        name STRING NOT NULL,
        kind STRING,
        year INT64,
        price FLOAT64,
        enabled BOOL
    )
    """);

bool created = await ddl.ExecuteDDLAsync();
```

## Insert Rows

For inserts, you can either use the insert helper or parameterized SQL.

### Insert helper

```csharp
using CamusDB.Core.Util.ObjectIds;

await using CamusInsertCommand insert = connection.CreateInsertCommand("robots");

insert.Parameters.Add("id", ColumnType.Id, CamusObjectIdGenerator.Generate());
insert.Parameters.Add("name", ColumnType.String, "T-800");
insert.Parameters.Add("kind", ColumnType.String, "cyborg");
insert.Parameters.Add("year", ColumnType.Integer64, 1984);
insert.Parameters.Add("price", ColumnType.Float64, 10.0);
insert.Parameters.Add("enabled", ColumnType.Bool, true);

int inserted = await insert.ExecuteNonQueryAsync();
```

### Parameterized SQL

```csharp
await using CamusCommand insert = connection.CreateCamusCommand("""
    INSERT INTO robots (id, name, year, kind, price, enabled)
    VALUES (GEN_ID(), @name, @year, @kind, @price, @enabled)
    """);

insert.Parameters.Add("@name", ColumnType.String, "R2-D2");
insert.Parameters.Add("@year", ColumnType.Integer64, 1977);
insert.Parameters.Add("@kind", ColumnType.String, "mechanical");
insert.Parameters.Add("@price", ColumnType.Float64, 25.5);
insert.Parameters.Add("@enabled", ColumnType.Bool, true);

int inserted = await insert.ExecuteNonQueryAsync();
```

## Query Rows

Use `ExecuteReaderAsync()` to stream result rows:

```csharp
await using CamusCommand select = connection.CreateSelectCommand(
    "SELECT id, name, year FROM robots WHERE year = @year");

select.Parameters.Add("@year", ColumnType.Integer64, 1977);

await using CamusDataReader reader = await select.ExecuteReaderAsync();

while (await reader.ReadAsync())
{
    string id = reader.GetString(0);
    string name = reader.GetString(1);
    long year = reader.GetInt64(2);
}
```

The reader exposes standard typed getters such as:

- `GetString`
- `GetBoolean`
- `GetInt16` / `GetInt32` / `GetInt64`
- `GetFloat` / `GetDouble`
- `GetGuid`
- `IsDBNull`

## Parameters

Parameters are input-only. Supported value mappings include:

| Camus type | Typical .NET values |
| --- | --- |
| `ColumnType.Id` | `string`, `Guid`, Camus object id values |
| `ColumnType.String` | `string` |
| `ColumnType.Integer64` | `short`, `int`, `long`, other integer-convertible values |
| `ColumnType.Float64` | `float`, `double` |
| `ColumnType.Bool` | `bool` |
| `ColumnType.Null` | `null`, `DBNull.Value` |

Examples:

```csharp
command.Parameters.Add("@id", ColumnType.Id, Guid.NewGuid());
command.Parameters.Add("@count", ColumnType.Integer64, 5);
command.Parameters.Add("@price", ColumnType.Float64, 19.99);
command.Parameters.Add("@note", ColumnType.Null, null);
```

## Transactions

CamusDB transactions are exposed through `BeginTransactionAsync()`:

```csharp
CamusTransaction tx = await connection.BeginTransactionAsync();

await using CamusCommand insert = connection.CreateCamusCommand("""
    INSERT INTO robots (id, name, year)
    VALUES (GEN_ID(), @name, @year)
    """);

insert.Transaction = tx;
insert.Parameters.Add("@name", ColumnType.String, "HAL 9000");
insert.Parameters.Add("@year", ColumnType.Integer64, 1968);

await insert.ExecuteNonQueryAsync();
await tx.CommitAsync();
```

Use `await tx.RollbackAsync()` to abort the transaction.

The driver only accepts `IsolationLevel.Serializable` and
`IsolationLevel.Unspecified`, which matches CamusDB's transaction model.

## ADO.NET Notes

- The provider uses HTTP under the hood.
- `Cancel()` is cooperative through cancellation tokens.
- Concurrent reads can share a connection session.
- Transaction-scoped commands are pinned to the transaction endpoint, which is
  important when the connection string contains multiple endpoints.

## When To Use It

Use the ADO.NET provider when you want:

- full control over SQL text
- direct use of CamusDB-specific SQL features
- lightweight integration without EF Core
- explicit transaction handling

For higher-level ORM usage, see [EF Core Provider](/docs/ef-core).
