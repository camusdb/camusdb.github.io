---
sidebar_position: 7.15
---

# Dapper

`CamusDB.Dapper` lets you use [Dapper](https://github.com/DapperLib/Dapper)
with the CamusDB .NET driver. Dapper is a popular .NET library that maps each
row of a query result to a C# object. You write the SQL, and you don't read each
column by hand. The adapter adds helpers for the CamusDB types that Dapper can't
infer, such as native arrays and wide `NUMERIC` values.

To compare the .NET packages and their target frameworks, see
[Which .NET package to use](/docs/dotnet-driver#which-net-package-to-use).

## How the adapter works

The package builds on `CamusDB.Client`. A `CamusConnection` is a regular ADO.NET
connection. This means that Dapper's `QueryAsync` and `ExecuteAsync` work on it
directly. The adapter adds parameter helpers and type handlers.

## Install

```bash
dotnet add package CamusDB.Dapper
```

`CamusDB.Dapper` depends on `CamusDB.Client`. You can also add a direct
reference to `CamusDB.Client`, if your project lists each database dependency.

## Register the handlers

Call `CamusDapper.Register()` once at application startup. You can call it
more than once.

```csharp
using CamusDB.Dapper;

CamusDapper.Register();
```

Each handler binds a parameter of its .NET type, and it reads a column into
that type.

| .NET type | Column type |
| --- | --- |
| `CamusObjectIdValue` | `OID` |
| `TimeSpan` / `CamusInterval` | `INTERVAL` |
| `JsonDocument` / `JsonElement` / `JsonNode` / `JsonObject` / `JsonArray` | `JSONB` |

## Open a connection

The connection string is the same as for the .NET driver.

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

For the options, such as authentication and gRPC, see
[Connection string](/docs/dotnet-driver#connection-string). Dapper commands
emit the traces and metrics of the driver. For more information, see
[OpenTelemetry](/docs/dotnet-driver#opentelemetry).

## Query rows

Dapper maps the columns of each row to the properties of your class.

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

The other Dapper methods, such as `ExecuteAsync` and `ExecuteScalarAsync`, work
the same way. An array of parameter objects executes the statement once for
each object.

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

Dapper types a parameter by its .NET type. This works for most values,
including a `string` object id, a `Guid` for a `UUID` column, and a `decimal`
for a `NUMERIC` column. Wrap a value in `CamusValue` when you want to choose the
CamusDB column type.

| Helper | Use |
| --- | --- |
| `CamusValue.Id(...)` | Binds an `OID` from a `string` or a `CamusObjectIdValue`. |
| `CamusValue.Uuid(...)` | Binds a `UUID` from a `Guid`. |
| `CamusValue.Numeric(...)` | Binds a `NUMERIC` value from a `decimal` or from decimal text. The text can be wider than .NET `decimal`. |
| `CamusValue.Jsonb(...)` | Binds one `JSONB` document from text or from a `System.Text.Json` type. |
| `CamusValue.Array(...)` | Binds one native `ARRAY(T)` value. |
| `CamusValue.Vector(...)` | Packs a `float` vector for a `BYTES` column. |

A `CamusValue` also works in `DynamicParameters`.

```csharp
DynamicParameters parameters = new();
parameters.Add("years", CamusValue.Array(new long[] { 1977, 1984 }));

IEnumerable<Robot> robots = await connection.QueryAsync<Robot>(
    "SELECT * FROM robots WHERE year = ANY(@years)",
    parameters);
```

## Intervals

After `CamusDapper.Register()`, a `TimeSpan` or `CamusInterval` parameter is
sent as ISO-8601 interval text. An interval result is read into either type.

```csharp
TimeSpan duration = await connection.ExecuteScalarAsync<TimeSpan>(
    "SELECT CAST(@duration AS INTERVAL)",
    new { duration = TimeSpan.FromHours(2) });
```

The parameter arrives as a string. Cast it to `INTERVAL` in the SQL.
Otherwise, an expression such as `created_at + @duration` returns an error. A
`TimeSpan` can't hold months, and a result with months throws a
`DataException`. Use `CamusInterval` for calendar intervals. For more
information, see [Intervals](/docs/dotnet-driver#intervals).

## JSON documents

After `CamusDapper.Register()`, you can use the `System.Text.Json` document
types as parameters, and as properties that read a `JSONB` column. To bind JSON
text, use `CamusValue.Jsonb(text)`.

```csharp
var rows = await connection.QueryAsync(
    "SELECT id, payload FROM events WHERE payload @> @filter",
    new { filter = CamusValue.Jsonb("""{"kind": "login"}""") });
```

The exact JSON text is preserved, and JSON `null` is different from SQL `NULL`.
For more information, see
[JSON documents](/docs/dotnet-driver#json-documents).

## Object ids

After `CamusDapper.Register()`, Dapper can bind and read `CamusObjectIdValue`.

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

A model can also store an object id as a `string`. The server converts a
`string` parameter when you compare it with an `OID` column, or write it to one.

## Numeric values

A `decimal` parameter binds as `NUMERIC`. A `NUMERIC` column can be read into a
`decimal` property when the value fits in .NET `decimal`. For a wider value,
bind the decimal text.

```csharp
await connection.ExecuteAsync(
    "INSERT INTO invoices (id, total) VALUES (GEN_ID(), @total)",
    new { total = CamusValue.Numeric("12345678901234567890.123456789") });
```

To read each digit of a wide value, use a `string` property. Dapper maps the
`NUMERIC` column to it.

## Arrays

By default, Dapper expands an array parameter into a list for `IN @values`.

```csharp
IEnumerable<string> names = await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE name IN @names ORDER BY name",
    new { names = new[] { "R2-D2", "T-800" } });
```

To bind one native `ARRAY(T)` value, wrap it with `CamusValue.Array(...)`. The
element type is kept for an empty array and for a typed `NULL`.

```csharp
IEnumerable<string> names = await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE year = ANY(@years) ORDER BY name",
    new { years = CamusValue.Array(new long[] { 1977, 1984 }) });

IEnumerable<string> none = await connection.QueryAsync<string>(
    "SELECT name FROM robots WHERE year = ANY(@years)",
    new { years = CamusValue.Array(Array.Empty<long>()) });
```

If your code reads or writes native arrays often, register an array type
handler. Then a `long[]` parameter binds as one `ARRAY(INT64)` value, and an
`ARRAY(INT64)` column can be read into `long[]`.

```csharp
CamusDapper.RegisterArrayTypeHandler<long>();

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

`CamusDapper.RegisterArrayTypeHandlers()` registers the handlers for arrays of
`long`, `int`, `double`, `bool`, `string`, and `Guid`.

A handler changes the behavior of Dapper for that array type. `IN @values` isn't
expanded, and it returns the syntax error `CADB0406`. Write `= ANY(@values)` for
a membership test. Note that the list includes `string`. This means that
`IN @names` with a `string[]` fails after `RegisterArrayTypeHandlers()`.

Register the array handlers at startup, before the first query. Dapper caches
how it binds the parameters of each SQL text. A statement that ran before the
registration can still expand its array.

## Transactions

Pass the `CamusTransaction` of the .NET driver to each Dapper call.

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

If a serializable transaction conflicts, run it again from `BEGIN`. The driver's
`SerializableRetryHelper` can do this for you. For more information, see
[Serializable retries](/docs/dotnet-driver#serializable-retries) and
[Retries and conflicts](/docs/serializable-retries).
