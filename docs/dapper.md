---
sidebar_position: 7.15
---

# Dapper

CamusDB ships `CamusDB.Dapper`, a small adapter for using
[Dapper](https://github.com/DapperLib/Dapper) with the .NET driver. Dapper is a
popular .NET library that runs a SQL query and maps each result row to a C#
object. You keep full control of the SQL, and you do not read each column by
hand.

To compare the three .NET packages (driver, Dapper, EF Core) and their target
frameworks, see [Which .NET package to use](/docs/dotnet-driver#which-net-package-to-use).

Use `CamusDB.Dapper` when:

- You want direct SQL with lightweight object mapping.
- You use CamusDB SQL features but don't want a full ORM model.
- You already know Dapper's `QueryAsync` and `ExecuteAsync` APIs.
- You need parameters of the native `OID`, `UUID`, `ARRAY(T)`, and vector
  types.

## How the adapter works

The package builds on `CamusDB.Client`. A `CamusConnection` is a regular
ADO.NET connection, so Dapper can run SQL through it directly. The adapter adds
CamusDB-specific parameter helpers and type handlers for the values Dapper
cannot infer on its own.

## Install

```bash
dotnet add package CamusDB.Dapper
```

`CamusDB.Dapper` depends on `CamusDB.Client`. If your project keeps direct
database dependencies explicit, you can reference the base driver too:

```bash
dotnet add package CamusDB.Client
```

## Register the handlers

Call `CamusDapper.Register()` once during application startup:

```csharp
using CamusDB.Dapper;

CamusDapper.Register();
```

This registers the handler for `CamusObjectIdValue`. It is safe to call more
than once.

## Open a connection

Use the same connection string as the .NET driver:

```csharp
using CamusDB.Client;
using CamusDB.Dapper;
using Dapper;

CamusDapper.Register();

await using CamusConnection connection = new(
    new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=app"));

await connection.OpenAsync();
```

See [.NET Driver](/docs/dotnet-driver#connection-string) for the full
connection string reference, including authentication, gRPC, endpoint pools,
and learned routing.

Dapper commands also emit the driver's OpenTelemetry traces and metrics. See
[.NET Driver OpenTelemetry](/docs/dotnet-driver#opentelemetry) for registration,
attributes, metrics, and SQL-text privacy.

## Query rows

Dapper maps rows to your classes as usual:

```csharp
public sealed class Robot
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Kind { get; set; }
    public long? Year { get; set; }
    public decimal? Price { get; set; }
    public bool? Enabled { get; set; }
}

IReadOnlyList<Robot> robots = (await connection.QueryAsync<Robot>(
    """
    SELECT id, name, kind, year, price, enabled
    FROM robots
    WHERE year >= @from
    ORDER BY year
    """,
    new { from = 1977 })).ToList();
```

Use `ExecuteAsync`, `QuerySingleAsync`, `QuerySingleOrDefaultAsync`, and
`ExecuteScalarAsync` the same way:

```csharp
int inserted = await connection.ExecuteAsync(
    """
    INSERT INTO robots (id, name, kind, year, price, enabled)
    VALUES (GEN_ID(), @Name, @Kind, @Year, @Price, @Enabled)
    """,
    new[]
    {
        new { Name = "R2-D2", Kind = "mechanical", Year = 1977, Price = 25.5, Enabled = true },
        new { Name = "T-800", Kind = "cyborg", Year = 1984, Price = 99.0, Enabled = false },
    });

long count = await connection.ExecuteScalarAsync<long>(
    "SELECT COUNT(*) FROM robots");
```

## CamusDB values

Dapper infers common scalar values from their .NET types. Use
`CamusValue` when a value needs an explicit CamusDB column type:

```csharp
Robot robot = await connection.QuerySingleAsync<Robot>(
    "SELECT * FROM robots WHERE id = @id",
    new { id = CamusValue.Id("66f31f0a0c715b91d8c90311") });
```

`CamusValue` covers:

| Helper | Use |
| --- | --- |
| `CamusValue.Id(...)` | Bind an `OID`, including an object id stored as a string. |
| `CamusValue.Uuid(...)` | Bind a native `UUID`. |
| `CamusValue.Numeric(...)` | Bind a `NUMERIC` value, including exact decimal text too wide for .NET `decimal`. |
| `CamusValue.Array(...)` | Bind one native `ARRAY(T)` value. |
| `CamusValue.Vector(...)` | Pack a `float` vector for a `BYTES` column. |

`DynamicParameters` can carry `CamusValue` too:

```csharp
DynamicParameters parameters = new();
parameters.Add("id", CamusValue.Id(robotId));

Robot robot = await connection.QuerySingleAsync<Robot>(
    "SELECT * FROM robots WHERE id = @id",
    parameters);
```

## Object ids

After `CamusDapper.Register()`, Dapper can bind and read
`CamusObjectIdValue` directly:

```csharp
using CamusDB.Core.Util.ObjectIds;

public sealed class EventRow
{
    public CamusObjectIdValue Id { get; set; }
    public string Name { get; set; } = "";
}

CamusObjectIdValue id = CamusObjectIdGenerator.Generate();

await connection.ExecuteAsync(
    "INSERT INTO events (id, name) VALUES (@id, @name)",
    new { id, name = "opened" });
```

If your model stores an object id as a `string`, wrap it with
`CamusValue.Id(...)` when writing or filtering by that value.

## Numeric values

A plain `decimal` parameter binds as CamusDB `NUMERIC`, and a `NUMERIC` column
can be read into a `decimal` property when the value fits .NET `decimal`.

For exact values that may exceed .NET `decimal` precision, bind the canonical
decimal text explicitly:

```csharp
await connection.ExecuteAsync(
    "INSERT INTO invoices (id, total) VALUES (GEN_ID(), @total)",
    new { total = CamusValue.Numeric("12345678901234567890.123456789") });
```

Dapper maps a `NUMERIC` column to `string` when your model property is `string`,
which preserves every digit.

## Arrays

Dapper normally expands an enumerable parameter for an `IN @values` predicate:

```csharp
IEnumerable<string> names = await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE name IN @names ORDER BY name",
    new { names = new[] { "R2-D2", "T-800" } });
```

That remains the default. To bind a single native CamusDB `ARRAY(T)` value,
wrap it with `CamusValue.Array(...)`:

```csharp
IEnumerable<string> names = await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE year = ANY(@years) ORDER BY name",
    new { years = CamusValue.Array(new long[] { 1977, 1984 }) });
```

`CamusValue.Array<T>(...)` preserves the element type for an empty array and for
a typed `NULL`:

```csharp
await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE year = ANY(@years)",
    new { years = CamusValue.Array(Array.Empty<long>()) });
```

For code that frequently reads or writes native arrays, opt in to array type
handlers:

```csharp
CamusDapper.RegisterArrayTypeHandler<long>();
```

Then a `long[]` parameter is bound as one `ARRAY(INT64)` value and an
`ARRAY(INT64)` column can be read into `long[]`:

```csharp
public sealed class TaggedRobot
{
    public string Id { get; set; } = "";
    public long[]? Tags { get; set; }
}

await connection.ExecuteAsync(
    "INSERT INTO tagged_robots (id, tags) VALUES (GEN_ID(), @tags)",
    new { tags = new long[] { 1, 2, 3 } });

TaggedRobot row = await connection.QuerySingleAsync<TaggedRobot>(
    "SELECT id, tags FROM tagged_robots WHERE 1 = ANY(tags)");
```

`CamusDapper.RegisterArrayTypeHandlers()` registers handlers for `long`, `int`,
`double`, `bool`, `string`, and `Guid` arrays.

This registration changes Dapper's behavior for that array type. After a
handler is registered, write `= ANY(@values)` for a membership test. The
`IN @values` expansion no longer applies to that array type.

## Transactions

Use the `CamusTransaction` returned by the .NET driver and pass it to Dapper:

```csharp
await using CamusTransaction tx = await connection.BeginTransactionAsync();

try
{
    await connection.ExecuteAsync(
        "INSERT INTO robots (id, name) VALUES (GEN_ID(), @name)",
        new { name = "R2-D2" },
        transaction: tx);

    long count = await connection.ExecuteScalarAsync<long>(
        "SELECT COUNT(*) FROM robots",
        transaction: tx);

    await tx.CommitAsync();
}
catch
{
    await tx.RollbackAsync();
    throw;
}
```

For serializable conflicts in a multi-statement transaction, retry the whole
transaction from `BEGIN`. See
[Retries And Conflicts](/docs/serializable-retries).
