---
sidebar_position: 7.1
description: "CamusDB.Client is the ADO.NET provider for CamusDB. Connect .NET applications with standard connections, commands, data readers, and transactions over HTTP/JSON or gRPC."
---

# .NET driver

`CamusDB.Client` connects a .NET application to CamusDB. It is an ADO.NET
provider. ADO.NET is the standard database interface of .NET, and it works the same way
for each database. This means that
ADO.NET code that you wrote for another database reads the same with CamusDB.

The other .NET packages are built on the driver. The driver also gives you
direct access to CamusDB features, such as the gRPC transport and prepared
statements. You use ADO.NET methods and .NET values, and the driver handles the wire
protocol and the transaction handles. This page
describes `CamusDB.Client` 0.19.3.

## Which .NET package to use

| Package | What it gives you | Choose it when | Targets |
| --- | --- | --- | --- |
| [`CamusDB.Client`](/docs/dotnet-driver) | The ADO.NET driver. | You want full control of the SQL text and of each command. | `net8.0`, `net9.0`, `net10.0` |
| [`CamusDB.Dapper`](/docs/dapper) | Dapper on the same connection. You write the SQL, and Dapper maps each row to a C# object. | You write SQL, but you don't want to read each column by hand. | `net8.0`, `net9.0`, `net10.0` |
| [`CamusDB.EntityFrameworkCore`](/docs/ef-core) | The EF Core provider, with LINQ queries and migrations. | Your data model is C# classes, and EF Core writes the SQL. | `net10.0`, `net11.0` |

The three packages share the same driver, and you can use more than one in an
application.

For integration tests, [Testcontainers](/docs/testcontainers) starts a temporary
CamusDB server in Docker, and gives connection strings for these packages. For
local orchestration, the [.NET Aspire integrations](/docs/aspire) connect your
AppHost and services to database resources.

Use the driver directly in these cases:

- You want full control of the SQL text.
- You use CamusDB SQL features that an ORM doesn't expose.
- You want a small dependency, and you don't need EF Core.
- You want to control each transaction explicitly.

## Sample application

CamusBank uses `CamusDB.Client` directly for transfers and their retries. See the [CamusBank advanced sample](/docs/advanced-samples#camusbank).

## Install

```bash
dotnet add package CamusDB.Client
```

## Open a connection

```csharp
using CamusDB.Client;

await using CamusConnection connection =
    new(new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=test"));

await connection.OpenAsync();
```

`ChangeDatabase("otherdb")` changes the target database of the connection. The
database must exist. If the application creates it, see
[Database administration](#database-administration).

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

`ExecuteDDLAsync()` is also the path for other CamusDB DDL, for example:

- Constraints, such as `CHECK` and named `NOT NULL` constraints.
- Index operations and table renames.
- `TRUNCATE TABLE`.
- Inline function and extension DDL, also with dollar-quoted bodies.
- Schema changes that don't have a helper method.

## Insert rows

To insert rows, use the insert helper or parameterized SQL.

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

### RETURNING

For a write with a `RETURNING` list, use `ExecuteReaderAsync()` or
`ExecuteScalarAsync()`:

```csharp
await using CamusCommand update = connection.CreateCamusCommand("""
    UPDATE robots
    SET year = @year
    WHERE name = @name
    RETURNING id, name, year
    """);

update.Parameters.Add("@name", ColumnType.String, "R2-D2");
update.Parameters.Add("@year", ColumnType.Integer64, 1977);

await using CamusDataReader returned = await update.ExecuteReaderAsync();
while (await returned.ReadAsync())
{
    string id = returned.GetString(0);
    long year = returned.GetInt64(2);
}

int affected = returned.RecordsAffected;
```

`ExecuteNonQueryAsync()` returns the affected-row count. The driver tells the
server to discard the returned rows. However, the server validates the
`RETURNING` list, and it checks the `SELECT` privilege on the table.

`ExecuteReaderAsync()` and `ExecuteScalarAsync()` receive all the returned rows
in one reply. On gRPC, a reply larger than the message limit returns `CADB0550`
before the commit. For a large `INSERT ... SELECT ... RETURNING`, use
`ExecuteStreamReaderAsync()`. Then the rows are streamed.

## Query rows

Use `ExecuteReaderAsync()` to read rows:

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

`ExecuteReaderAsync()` reads the full result before it returns. For a large
`SELECT`, use `ExecuteStreamReaderAsync()`. It reads the rows as they arrive
from the streaming endpoint of the server:

```csharp
await using CamusCommand select = connection.CreateSelectCommand(
    "SELECT id, name, year FROM robots WHERE year > @year");

select.Parameters.Add("@year", ColumnType.Integer64, 1900);

await using CamusDataReader reader =
    await select.ExecuteStreamReaderAsync();

while (await reader.ReadAsync())
{
    string name = reader.GetString(1);
    long year = reader.GetInt64(2);
}
```

The streaming path uses the same reader API. It doesn't show cache metadata.
After rows were delivered, it can't replay a serializable conflict. If you need
automatic retry of a statement, use the buffered reader.

The reader has the standard typed getters, such as `GetString` or `GetInt64`.
`GetFieldValue<T>` reads other provider-supported types, such as `DateOnly`. `IsDBNull` checks for `NULL`.

### WITH queries and writes

Use the normal query and execute APIs for
[WITH queries](/docs/sql-queries#with-queries), also with a write after the
`WITH` clause. The driver finds the main statement after the CTE definitions.
This means that `WITH ... UPDATE ... RETURNING` is treated as a write that
returns rows. Leading comments and dollar-quoted bodies are handled, and `WITH`
statements can be prepared. Joined writes follow the rules of
[UPDATE FROM and DELETE USING](/docs/sql-writes#joined-writes).

## Parameters

Parameters are input only. The following value mappings are supported:

| Camus type | Typical .NET values |
| --- | --- |
| `ColumnType.Id` | `string`, `Guid`, `CamusObjectIdValue` |
| `ColumnType.Uuid` | `Guid`, canonical UUID `string` |
| `ColumnType.String` | `string` |
| `ColumnType.Integer64` | `short`, `int`, `long`, and other integer values |
| `ColumnType.Numeric` | `decimal`, decimal text `string`, integer values |
| `ColumnType.Float64` | `double`, `decimal`, and other floating values |
| `ColumnType.Float32` | `float`, and other floating values |
| `ColumnType.Bool` | `bool` |
| `ColumnType.Bytes` | `byte[]`, `ReadOnlyMemory<byte>`, `Memory<byte>`, `ArraySegment<byte>`, `IEnumerable<byte>` |
| `ColumnType.Date` | `DateOnly`, `DateTime`, `DateTimeOffset`, ISO date/time `string` |
| `ColumnType.DateTime` | `DateTime`, `DateTimeOffset`, ISO date/time `string` |
| `ColumnType.Array` | `IEnumerable` of a supported scalar type |
| `ColumnType.Null` | `null`, `DBNull.Value` |

Examples:

```csharp
command.Parameters.Add("@id", ColumnType.Id, Guid.NewGuid());
command.Parameters.Add("@ref", ColumnType.Uuid, Guid.NewGuid());
command.Parameters.Add("@count", ColumnType.Integer64, 5);
command.Parameters.Add("@total", ColumnType.Numeric, 123.45m);
command.Parameters.Add("@price", ColumnType.Float64, 19.99);
command.Parameters.Add("@payload", ColumnType.Bytes, new byte[] { 0xDE, 0xAD });
command.Parameters.Add("@day", ColumnType.Date, new DateOnly(2026, 5, 1));
command.Parameters.Add("@happened", ColumnType.DateTime, DateTimeOffset.UtcNow);
command.Parameters.Add("@note", ColumnType.Null, null);
```

For an array, pass `isArray: true`. Set the element type explicitly when the
array is empty or all its values are `NULL`:

```csharp
command.Parameters.Add(
    "@tags",
    ColumnType.Integer64,
    new long[] { 1, 2, 3 },
    isArray: true);

command.Parameters.Add(
    "@empty_tags",
    ColumnType.String,
    Array.Empty<string>(),
    isArray: true);
```

The driver converts dates and datetimes to UTC before it sends them. `DATE`
values are stored at midnight UTC, and `DATETIME` values are read with
`DateTimeKind.Utc`.

## Data types

| SQL DDL type | Driver type | Typical read/write type |
| --- | --- | --- |
| `OID`, `OBJECT_ID` | `ColumnType.Id` | `string`, `Guid`, `CamusObjectIdValue` |
| `UUID`, `GUID` | `ColumnType.Uuid` | `Guid` |
| `STRING`, `STRING(N)` | `ColumnType.String` | `string` |
| `INT64`, `BIGINT`, `INT`, `INTEGER`, `SMALLINT` | `ColumnType.Integer64` | `long`, `int`, `short` |
| `NUMERIC`, `DECIMAL` | `ColumnType.Numeric` | `decimal`, exact decimal `string` |
| `FLOAT64` | `ColumnType.Float64` | `double` |
| `FLOAT32`, `REAL` | `ColumnType.Float32` | `float` |
| `BOOL`, `BOOLEAN` | `ColumnType.Bool` | `bool` |
| `BYTES`, `BLOB` | `ColumnType.Bytes` | `byte[]` |
| `DATE` | `ColumnType.Date` | `DateOnly`, `DateTime` |
| `DATETIME`, `TIMESTAMP` | `ColumnType.DateTime` | `DateTime`, `DateTimeOffset` |
| `JSONB`, `JSON` | `ColumnType.Jsonb` | JSON text on read. `JsonDocument`, `JsonElement`, `JsonNode`, or typed text on write. |
| `ARRAY(T)` | `ColumnType.Array` | `object?[]` on read, `IEnumerable` on write |

The integer declarations share `ColumnType.Integer64` and the same wire values.
The server checks the [declared column range](/docs/data-types#integer-type-names).

Store UUIDs in a native `UUID` column, and not as text in a `STRING`. The native
type is more compact, and it compares as a fixed-width value.

`NUMERIC` is an exact decimal type with fixed precision and scale. A `decimal`
parameter binds as `NUMERIC`. For a value with more digits than a .NET `decimal`
can hold, use `ColumnType.Numeric` with a `string`. Read small values with
`GetDecimal()` or `GetFieldValue<decimal>()`. To read any value
exactly, use `GetString()`.

### Intervals

Use `TimeSpan` parameters for fixed durations, and `CamusInterval` for calendar
intervals. Both bind as ISO 8601 text. Cast the parameter in SQL. Then the
server treats it as an interval:

```csharp
await using CamusCommand command = connection.CreateCamusCommand("""
    SELECT finished - started AS duration FROM jobs
    WHERE finished - started > CAST(@limit AS INTERVAL)
    """);
command.Parameters.Add("limit", ColumnType.Null, TimeSpan.FromHours(1));
await using CamusDataReader reader = await command.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    CamusInterval duration = reader.GetInterval(0);
    Console.WriteLine(duration);
}
```

Interval results have `STRING` metadata. `GetString()` returns their ISO 8601
text, and `GetInterval()` or `GetFieldValue<CamusInterval>()` parses the three
parts. `GetTimeSpan()` and `GetFieldValue<TimeSpan>()` read intervals that don't have
months. A month part raises `InvalidCastException`. `CamusInterval.Parse()` and
`ToTimeSpan()` give the same conversion outside a reader.

Months can't be converted to a fixed duration, because the length of a month
varies.
Intervals are [expression values](/docs/data-types#intervals), and table
columns and array elements can't be intervals. To send an array of interval
texts, set `ArrayElementType = ColumnType.String`.

### JSON documents

Use JSONB parameters to store and query [JSON documents](/docs/json).
`System.Text.Json` values, such as `JsonElement`, are `ColumnType.Jsonb`. For
raw text, set the type explicitly:

```csharp
using System.Text.Json;

await using CamusCommand command = connection.CreateCamusCommand(
    "SELECT payload FROM events WHERE payload @> @filter");
command.Parameters.Add("filter", ColumnType.Jsonb, """{"kind": "login"}""");
await using CamusDataReader reader = await command.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    JsonElement payload = reader.GetFieldValue<JsonElement>(0);
}
```

`GetString()` and `GetValue()` return the JSON text form of PostgreSQL, with the
exact digits of numbers. `GetFieldValue<T>()` can parse a JSON type, such as
`JsonElement` or `JsonNode`. `CamusJsonb.Format(text)` produces the same text
form.

A JSON `null` document reads as the string `"null"`, and SQL `NULL` reads as
`DBNull`. Over REST, an older server that doesn't support the `jsonbAsText`
option can't tell the two apart. Arrays of JSONB documents aren't supported.
Bind one JSON array document.

### Infinity and NaN

The driver reads and binds infinity and NaN, on REST and gRPC. Use the special `double` values, such as `double.NaN`, with `ColumnType.Float64`.
Use the `float` values for `Float32`. The reader returns
native .NET floats, also in float arrays. See
[float behavior](/docs/data-types#floating-point-values).

## Transactions

To start a transaction, use `BeginTransactionAsync()`:

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

To abort the transaction, use `await tx.RollbackAsync()`.

After a commit, `tx.CommitTimestamp` has the HLC commit timestamp of the
transaction. It is `null` before the commit, after a rollback or a failed
commit, and for a transaction that didn't write. Two transactions that write the
same row are in commit-timestamp order. For the other ordering rules, see
[Commit timestamp](/docs/grpc-api#commit-timestamp).

`CamusTransactionOptions` sets the concurrency behavior of an explicit
transaction:

| Option | Values | Default |
| --- | --- | --- |
| `IsolationLevel` | `Serializable`, `ReadCommitted` | The server default, `Serializable`. |
| `Mode` | `ReadWrite`, `ReadOnly` | `ReadWrite` |
| `Locking` | `Pessimistic`, `Optimistic` | The server default, `Pessimistic`. |
| `Affinity` | The exact SQL text of a statement with a learned route. | `null` |

```csharp
CamusTransaction tx = await connection.BeginTransactionAsync(
    new CamusTransactionOptions
    {
        IsolationLevel = CamusIsolationLevel.Serializable,
        Mode = CamusTransactionMode.ReadWrite,
        Locking = CamusLocking.Optimistic,
    });
```

For a read-only serializable snapshot, use the built-in snapshot options:

```csharp
CamusTransaction snapshot =
    await connection.BeginTransactionAsync(CamusTransactionOptions.Snapshot);
```

Connection-string defaults apply to transactions and autocommit statements:

```text
Endpoint=http://localhost:5095;Database=test;IsolationLevel=Serializable;Locking=Optimistic;TransactionMode=ReadWrite
```

The per-transaction options win over the connection-string defaults, and those
win over the server default.

With learned routing on, `BeginTransactionAsync()` can wait to send `BEGIN`
until the first statement. The driver then starts the transaction on the
learned endpoint of that statement. The later statements, and the commit or
rollback, go to the same endpoint. If no route is known, the driver uses
endpoint rotation.

Use `CamusTransactionOptions.Affinity` when a later statement should choose the
endpoint of the transaction. The value is the exact SQL text of that statement.
With `RoutingMode=Off`, `BeginTransactionAsync()` sends `BEGIN` at once.

In routed mode, the transaction ids, such as `TransactionId`, are zero until the
transaction starts. To tell a deferred transaction from a started one, use
`IsStarted`.

## Serializable retries

Serializable is the default isolation level. When two serializable read-write
transactions conflict, CamusDB aborts one of them. Your application must then
replay that unit of work from the start.

`SerializableRetryHelper` handles this. It treats the following codes as
retryable:

| Code | Name | Meaning |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | A lock conflict aborted the transaction. |
| `CADB0504` | `TransactionMustRetry` | A transient condition, such as a [leader](/docs/concepts#leader) change, used up the internal retries. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction was open longer than the lifetime limit. |

It also retries a transient error whose message has a marker, such as
`MustRetry` or `AlreadyLocked`. Some schema and sequence contention has no code
of its own, and only the message identifies it.

The helper doesn't retry `CADB0509` `TransactionFinalizeUnresolved`. This code
means that a commit or rollback doesn't have a final answer yet. Retry the same
finalize on the same transaction, and don't replay the work.

If you write the retry loop, use `SerializableRetryHelper.IsRetryable(...)`:

```csharp
catch (CamusException ex) when (SerializableRetryHelper.IsRetryable(ex))
{
    // Replay the whole transaction from the beginning.
}
```

To wrap a unit of work, use `SerializableRetryHelper.ExecuteAutocommitAsync(...)`:

```csharp
await SerializableRetryHelper.ExecuteAutocommitAsync(async ct =>
{
    CamusTransaction tx = await connection.BeginTransactionAsync(ct);
    try
    {
        await using CamusCommand update = connection.CreateCamusCommand("""
            UPDATE robots SET price = @price WHERE name = @name
            """);

        update.Transaction = tx;
        update.Parameters.Add("@price", ColumnType.Float64, 99.0);
        update.Parameters.Add("@name", ColumnType.String, "T-800");

        await update.ExecuteNonQueryAsync(ct);
        await tx.CommitAsync(ct);
    }
    catch
    {
        await tx.RollbackAsync(ct);
        throw;
    }
}, maxAttempts: 5, cancellationToken);
```

For a multi-statement transaction, don't retry the failed statement alone.
Start a new transaction, and execute all the reads and writes of the unit again:

```csharp
const int MaxAttempts = 5;

for (int attempt = 1; ; attempt++)
{
    CamusTransaction tx = await connection.BeginTransactionAsync();
    try
    {
        long balance = await ReadBalance(tx, accountId);
        if (balance < amount)
            throw new InvalidOperationException("Insufficient funds");

        await Debit(tx, accountId, balance - amount);
        await tx.CommitAsync();
        break;
    }
    catch (CamusException ex) when (SerializableRetryHelper.IsRetryable(ex))
    {
        await tx.RollbackAsync();
        if (attempt >= MaxAttempts)
            throw;

        await Task.Delay(20 * (1 << attempt));
    }
    catch
    {
        await tx.RollbackAsync();
        throw;
    }
}
```

The default backoff of the helper is `min(20 ms * 2^attempt, 400 ms)`, with 25%
random jitter.

## Prepared statements

The driver prepares repeated SQL automatically. When the same SQL has executed
enough times, later executions use a prepared statement. Your application code
doesn't change:

```csharp
for (int i = 0; i < 100; i++)
{
    await using CamusCommand select = connection.CreateSelectCommand(
        "SELECT name FROM robots WHERE year = @year");

    select.Parameters.Add("@year", ColumnType.Integer64, 1984);

    await using CamusDataReader reader = await select.ExecuteReaderAsync();
    while (await reader.ReadAsync())
        Console.WriteLine(reader.GetString(0));
}
```

By default, the first execution is inline, and the second prepares the
statement. To change that policy, use the connection string:

```csharp
CamusConnectionStringBuilder eager = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=512;AutoPrepareMinUsages=1");

CamusConnectionStringBuilder off = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=0");
```

When you know that a statement is frequent, call `Prepare()` or
`PrepareAsync()`:

```csharp
await using CamusCommand insert = connection.CreateCamusCommand("""
    INSERT INTO robots (id, name, year)
    VALUES (GEN_ID(), @name, @year)
    """);

await insert.PrepareAsync();

foreach (Robot robot in robots)
{
    insert.Parameters.Clear();
    insert.Parameters.Add("@name", ColumnType.String, robot.Name);
    insert.Parameters.Add("@year", ColumnType.Integer64, robot.Year);

    await insert.ExecuteNonQueryAsync();
}
```

A prepared execution behaves like an inline one, also for transactions and the
query result cache. ADO.NET binds parameters by
name, and the driver maps each name to the positional order of the server.

DML and queries can be prepared. Other statements execute inline. If the server
returns an unknown handle, the driver prepares the
statement again, and it replays the execution once.

For diagnostics, use `CamusConnectionStringBuilder.PreparedStatementCount` and
`IsPrepared(sql)`. For the handle scope and the limits of the server, see
[Prepared statements](/docs/prepared-statements).

## Vectors

CamusDB vector search uses a `BYTES` column with packed little-endian `float32`
values. The driver has a helper for that layout:

```csharp
float[] embedding = await EmbedAsync("robot assembly manual");
byte[] packed = CamusVector.ToBytes(embedding);

command.Parameters.Add("@embedding", ColumnType.Bytes, packed);
```

To read a vector, use `GetVector(...)`:

```csharp
float[] embedding = reader.GetVector(reader.GetOrdinal("embedding"));
```

The dimension isn't part of the `BYTES` type. To enforce it, use a check
constraint:

```csharp
await connection.CreateCamusCommand("""
    CREATE TABLE documents (
        id OID PRIMARY KEY NOT NULL DEFAULT(gen_id()),
        body STRING NOT NULL,
        embedding BYTES NOT NULL,
        CONSTRAINT embedding_768d CHECK (vector_dims(embedding) = 768)
    )
    """).ExecuteDDLAsync();
```

Pass the query vector as a parameter, and rank with a vector function:

```csharp
byte[] query = CamusVector.ToBytes(await EmbedAsync("warranty claims"));

await using CamusCommand search = connection.CreateSelectCommand("""
    SELECT id, l2_distance(embedding, @query) AS distance
    FROM documents
    ORDER BY distance ASC
    LIMIT 10
    """);

search.Parameters.Add("@query", ColumnType.Bytes, query);
```

See [Vector search](/docs/vector-search).

## Query result cache

The query result cache uses a `{cache=...}` hint after the table reference. You
can also build the hint with `CamusCacheHint`:

```csharp
string hint = CamusCacheHint.Build(
    "recent_orders",
    ttl: TimeSpan.FromSeconds(30),
    strict: true);

await using CamusCommand select = connection.CreateSelectCommand(
    $"SELECT id, total FROM orders {hint} WHERE status = @status");

select.Parameters.Add("@status", ColumnType.Integer64, 1);

await using CamusDataReader reader = await select.ExecuteReaderAsync();

CamusCacheMetadata? cache = reader.CacheMetadata;
CamusCacheMetadata? lastCache = select.LastCacheMetadata;
```

`CamusCacheMetadata` gives the decision of the server cache, for example `Hit`. To evict cache families, use the connection:

```csharp
await connection.EvictCacheAsync("recent_orders");
await connection.EvictAllCacheAsync();
```

Cache entries belong to the current database. See
[Query result cache](/docs/query-result-cache).

## Authentication

CamusDB authentication is off by default. If the connection string doesn't have credentials,
the driver doesn't send an `Authorization` header.

For a server with authentication on, add `User` and `Password`:

```csharp
CamusConnectionStringBuilder builder = new(
    "Endpoint=https://db.example.com:7141;Database=app;User=myapp;Password=app-secret");
```

The driver exchanges the password for a short-lived bearer token, with the REST
`/login` endpoint or the gRPC `CamusAuth` service. Statements then send the
token, and not the password. The driver caches the token for each set of credentials, and it renews the token
before the expiry that the server gives. If a cached token expired or was
rotated, the driver
signs in again and sends the statement once more. Permission errors aren't
retried.

You can also sign in explicitly, for example with a password from a secrets
manager:

```csharp
await using CamusConnection connection = new(
    new CamusConnectionStringBuilder("Endpoint=https://db.example.com:7141;Database=app"));

await connection.OpenAsync();
string token = await connection.LoginAsync("myapp", passwordFromSecretManager);
await connection.LogoutAsync();
```

`AccessToken=...` uses a token from another source. The driver doesn't renew it.
When the token expires or is revoked, the server returns `CADB0516`.

For an authenticated deployment that isn't on loopback, use an `https://`
address. The driver doesn't send `Password` or `AccessToken` credentials to a
remote plaintext endpoint, unless the connection string sets
`AllowInsecureCredentials=true`. See
[Authentication and authorization](/docs/sql-authentication).

## Connection string

A connection string must have `Endpoint` (the base CamusDB endpoint) and
`Database`:

```csharp
using CamusDB.Client;

CamusConnectionStringBuilder builder =
    new("Endpoint=http://localhost:5095;Database=test");

await using CamusConnection connection = new(builder);
await connection.OpenAsync();
```

| Key | Required | Description |
| --- | --- | --- |
| `Endpoint` | Yes | The base URL of the node. Use the REST port, or the gRPC port with `Protocol=grpc`. |
| `Database` | Yes | The database name of the requests. |
| `Timeout` | No | The request timeout in seconds. Default `10`. |
| `Protocol` | No | `rest` (default) or `grpc`. |
| `User` | No | The user to sign in as. Aliases: `UserId`, `Uid`, `Username`. |
| `Password` | No | The password of `User`. Alias: `Pwd`. |
| `AccessToken` | No | A bearer token from another source. The driver doesn't sign in. |
| `TokenLifetime` | No | The fallback lifetime of a token in seconds, if the server doesn't report an expiry. Default `600`. |
| `MaxAutoPrepare` | No | The maximum number of prepared statements of the driver. Default `128`. `0` turns off automatic preparation. |
| `AutoPrepareMinUsages` | No | The executions of the same SQL before the driver prepares it. Default `2`. |
| `IsolationLevel` | No | The default isolation for transactions and autocommit statements: `Serializable` or `ReadCommitted`. |
| `TransactionMode` | No | The default transaction mode: `ReadWrite` or `ReadOnly`. |
| `Locking` | No | The default locking mode: `Pessimistic` or `Optimistic`. |
| `ChannelPoolSize` | No | gRPC only. The long-lived `BatchExecute` streams for each endpoint. Default `8`. |
| `CoalescingThreshold` | No | gRPC only. The operations that a batch drain tries to collect before it stops waiting. Default `10`. `1` turns off coalescing. |
| `CoalescingDelay` | No | gRPC only. Milliseconds to wait for a larger batch. Default `0`. Waiting operations can share a frame when `RequestFrames` is on. Set `1` or `2` when many callers on one connection send bursts. |
| `RequestFrames` | No | gRPC only. Whether the client can pack waiting operations into negotiated stream frames. Default `true`. |
| `TraceQueryText` | No | Adds the SQL text to driver spans as `db.query.text`. Default `false`. SQL literals can contain sensitive values. |
| `BackupEndpoint` | No | The HTTP endpoint of the backup admin API. Defaults to `Endpoint`. Required with `Protocol=grpc`. |
| `BackupTimeout` | No | The backup admin timeout in seconds. Default `300`. |
| `AllowInsecureCredentials` | No | `true` allows credentials over a plaintext endpoint that isn't loopback. Use it if another trusted layer protects that hop. |
| `RoutingMode` | No | Learned statement routing: `Auto` (default), `Learned`, or `Off`. |
| `RoutingNodes` | No | A map from server node identities to addresses in `Endpoint`. Quote the value. It contains `=`. |
| `RoutingMaxHintAge` | No | The maximum age of a learned route, in milliseconds. Default `5000`. |

`Endpoint` can also be a comma-separated pool:

```text
Endpoint=http://localhost:5095,http://localhost:5096,http://localhost:5097;Database=test
```

The client uses each endpoint in turn. When a request can't reach an endpoint,
the driver skips that endpoint for 30 seconds. All connections with the same
`Endpoint` value share the rotation and the health state.

Connection string keys aren't case-sensitive, and they are trimmed. A repeated
key is an error. Quote a value that has a semicolon or surrounding spaces, with
single or double quotes. To include the quote character, double it.

`CamusConnectionStringBuilder.ToString()` returns the original connection
string, with the credentials. For logs, use `ToRedactedString()` or
`CamusConnectionStringBuilder.Redact(...)`. They mask the credential keys. A `CamusConnection` uses the connection string that it was built
from. If you assign a different value later, it throws
`NotSupportedException`.

## Transport

The driver can use the REST endpoint or the gRPC endpoint, with the same
`CamusCommand` and `CamusTransaction` APIs:

```csharp
CamusConnectionStringBuilder rest = new(
    "Endpoint=http://localhost:5095;Database=test");

CamusConnectionStringBuilder grpc = new(
    "Endpoint=http://localhost:5096;Database=test;Protocol=grpc");
```

REST and gRPC use separate server ports. With `Protocol=grpc`, point `Endpoint`
at the gRPC port. Use `http://` for local plaintext HTTP/2, or `https://` for a
TLS deployment.

With gRPC, the driver multiplexes all operations over a small pool of
long-lived `BatchExecute` streams. Autocommit statements use the full pool. The operations of a transaction use one stream. Then the server sees them in
order. Change the pool settings if a measured workload needs it. Stream frames
are a transport optimization. They don't make operations atomic, and each
operation gets a separate result.

## Learned routing

A CamusDB server can add routing metadata to a successful SQL response. With
learned routing on, the driver uses that metadata to send later executions of
the same statement to the node that leads the data of the statement. This is a
latency optimization. The server returns the correct result on any node.

```csharp
CamusConnectionStringBuilder builder = new(
    "Endpoint=http://a:5095,http://b:5095,http://c:5095;Database=test;RoutingMode=Learned;" +
    "RoutingNodes='camus-a:7070=http://a:5095,camus-b:7070=http://b:5095,camus-c:7070=http://c:5095'");
```

`RoutingNodes` is the routing authority. The server gives an opaque node
identity. The driver uses it if the connection string maps that identity to an
address in the `Endpoint` pool. It doesn't connect to an address from a server
response.

`RoutingMode=Auto` (the default) asks for routing advice when `RoutingNodes`
names at least two distinct endpoints. `RoutingMode=Learned` asks when at least
one identity is mapped. `RoutingMode=Off` turns off the feature, and the driver
uses endpoint rotation.

The driver learns a route for each database and exact SQL text. A
route lasts for the shorter of the server's `maxAgeMs` and `RoutingMaxHintAge`.
The cache has a fixed size. A stale route costs an extra forwarding hop until it
expires or a newer response replaces it. Parameterized and prepared workloads benefit
most. They reuse the same SQL text.

`CamusCommand.LastRoutingAdvice` shows the last advice, for diagnostics. For the
eligible statements and the wire contract, see
[SQL routing advice](/docs/sql-routing-advice).

## Ping

To check connectivity, use a ping command:

```csharp
await using CamusCommand ping = connection.CreatePingCommand();
int result = await ping.ExecuteNonQueryAsync();
```

## Node resource stats

The client can read operational statistics over REST or gRPC. If you don't pass an
argument, the call asks the next endpoint of the rotation. You can also pass one
of the endpoints of the connection string:

```csharp
CamusNodeStats current = await connection.GetNodeStatsAsync();
CamusNodeStats node = await connection.GetNodeStatsAsync("http://db2.example.com:5095");
```

The endpoint must match an entry in `Endpoint` exactly. Another value throws
`ArgumentException`. This means that the client doesn't send its credentials to
an unknown address.

The result has the resource use and the identity of the node. With
authentication on, the connection needs a superuser, or an account with the
global `MONITOR` privilege. See [Node resource stats](/docs/node-stats).

## Database administration

Opening a connection doesn't create its database. Create or drop databases
explicitly:

```csharp
await connection.CreateDatabaseAsync(ifNotExists: true);
await connection.CreateDatabaseAsync("otherdb", ifNotExists: true);

await connection.DropDatabaseAsync("old_test_db");
```

`CreateDatabaseAsync()` and `DropDatabaseAsync()` act on the database of the
connection string, or on the name that you pass. Database creation retries a
small set of transient schema conflicts.

For a copy-on-write branch, use the branch helpers:

```csharp
await connection.CreateBranchDatabaseAsync(
    branchName: "factory_test",
    sourceDatabaseName: "factory",
    ifNotExists: true);

IReadOnlyList<CamusBranchRow> branches =
    await connection.ShowBranchesAsync("factory");

IReadOnlyList<CamusBranchRow> ancestors =
    await connection.ShowAncestorsAsync("factory_test");
```

See [Database branching](/docs/database-branching).

## Backups

`connection.Backups` is the online backup admin API. You can take backups,
read the backup catalog, and apply retention:

```csharp
CamusBackupInfo full = await connection.Backups.TakeFullBackupAsync();
CamusBackupInfo incremental =
    await connection.Backups.TakeIncrementalBackupAsync(full.BackupId);

IReadOnlyList<CamusBackupInfo> chain =
    await connection.Backups.GetChainAsync(incremental.BackupId);

IReadOnlyList<CamusBackupInfo> catalog =
    await connection.Backups.ListBackupsAsync();

CamusBackupGcResult preview =
    await connection.Backups.PreviewGarbageCollectionAsync();

CamusBackupGcResult applied =
    await connection.Backups.CollectGarbageAsync();
```

Backups cover the full node, and not only the `Database` of the connection. The
server must have `kahuna.backup_dir` configured.

The backup admin API is REST only. If the connection uses `Protocol=grpc`, set
`BackupEndpoint` to the HTTP endpoint. A full backup can take time, and
`BackupTimeout` sets its timeout:

```text
Endpoint=http://localhost:5096;Database=test;Protocol=grpc;BackupEndpoint=http://localhost:5095;BackupTimeout=300
```

See [Backup and restore](/docs/backup-and-restore).

## OpenTelemetry

`CamusDB.Client` emits traces and metrics through the .NET `ActivitySource` and
`Meter` APIs. The driver doesn't depend on the OpenTelemetry SDK. Both sources
have the name `CamusDB.Client`, as `CamusTelemetry.ActivitySourceName` and
`CamusTelemetry.MeterName`.

Register the sources with the OpenTelemetry SDK, and configure the exporter of
your application:

```csharp
using CamusDB.Client;

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing =>
        tracing.AddSource(CamusTelemetry.ActivitySourceName))
    .WithMetrics(metrics =>
        metrics.AddMeter(CamusTelemetry.MeterName));
```

The optional `CamusDB.OpenTelemetry` package has extension methods for the same
registration:

```bash
dotnet add package CamusDB.OpenTelemetry
```

```csharp
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing.AddCamusDBInstrumentation())
    .WithMetrics(metrics => metrics.AddCamusDBInstrumentation());
```

The package depends only on `OpenTelemetry.Api`. The application chooses and
configures the OpenTelemetry SDK and the exporters.

### Traces

The driver creates an `ActivityKind.Client` span for these operations:

- Each command execution.
- Each typed insert through `CamusInsertCommand`.
- `BEGIN`, `COMMIT`, and `ROLLBACK`. One finalize span covers all the retries
  after `CADB0509 TransactionFinalizeUnresolved`.
- Each pipeline exchange, as one `BATCH` span.

Dapper and EF Core use the same command APIs, and their operations also get
driver spans. A span is a child of the current application activity. The HTTP
or gRPC transport spans, when they are on, are children of the driver span.

A span name has the form `{operation} {target}`, such as `SELECT shop`. The
target is the table of a typed insert, and the database for other operations.
The driver adds these attributes:

| Attribute | Value |
| --- | --- |
| `db.system.name` | `camusdb` |
| `db.namespace` | The database of the connection string. |
| `db.operation.name` | The SQL verb, or `BEGIN`, `COMMIT`, `ROLLBACK`, or `BATCH`. |
| `db.collection.name` | The table of a typed insert. |
| `db.operation.batch.size` | The number of operations in a pipeline exchange. |
| `server.address`, `server.port` | The endpoint that received the operation, after routing. |
| `camusdb.transport` | `rest` or `grpc`. |
| `db.query.text` | The SQL text, if `TraceQueryText=true`. |
| `error.type` | The `CADBxxxx` code, or the exception type of a failure outside CamusDB. |
| `db.response.status_code` | The `CADBxxxx` code of a failed CamusDB operation. |

The SQL text is off by default. A literal can contain sensitive data. To
turn it on for one connection, use:

```text
Endpoint=http://localhost:5095;Database=app;TraceQueryText=true
```

The driver doesn't record parameter values. A retry during a driver span adds a
`camusdb.retry` event, with `camusdb.retry.kind` and `error.type`.

A buffered query span ends when the command returns. A streaming query span is open until the reader finishes or is closed. This means that its
duration includes the time that the application takes to read the stream.

### Metrics

The `CamusDB.Client` meter emits the following metrics:

| Metric | Type | Meaning |
| --- | --- | --- |
| `db.client.operation.duration` | Histogram, seconds | The duration of the operations that produce spans. Its attributes don't include SQL text. |
| `camusdb.client.operation.retries` | Counter | Operations sent again. `camusdb.retry.kind` is `finalize`, `autocommit`, `token_renewal`, or `create_database`. |
| `camusdb.client.auth.logins` | Counter | Sign-ins that the driver sent for a bearer token, by whether a statement waited for them. |
| `camusdb.client.endpoint.quarantines` | Counter | The times that a transport failure made the driver skip an endpoint for 30 seconds. |
| `camusdb.client.endpoint.quarantined` | Gauge | `1` while an endpoint is skipped, and `0` while it can receive traffic. |
| `camusdb.client.prepared_statement.lookups` | Counter | Prepared-statement lookups by result: `hit`, `registered`, or `miss`. |
| `camusdb.client.prepared_statement.registrations` | Counter | Preparation attempts by result: `success`, `refused`, or `unsupported`. |
| `camusdb.client.prepared_statement.evictions` | Counter | Prepared statements released for more recently used statements. |
| `camusdb.client.prepared_statement.count` | Up-down counter | The statements in the prepared-statement cache of the driver. |

The operation metrics use low-cardinality attributes, such as the database and
the error code. The prepared-statement metrics use `db.namespace` and
`camusdb.prepared_statement.result`.

Use these signals together:

- More endpoint quarantines show transport failures.
- Retry counts separate the retry kinds, such as conflicts and token renewals.
- A prepared-statement count at `MaxAutoPrepare`, with growing evictions, shows
  that the cache is too small for the active statements.

When no listener is on, the driver doesn't create spans or tags for an
operation. `OpenAsync()` doesn't open a physical database connection. This
means that the driver doesn't publish `db.client.connection.*` metrics. If the
application also uses `OpenTelemetry.Instrumentation.EntityFrameworkCore`, an EF
Core query produces an EF Core span and a CamusDB driver span.

## ADO.NET notes

- The provider can use REST/JSON or gRPC with the same ADO.NET surface. See
  [Transport](#transport).
- `Cancel()` works through cancellation tokens.
- Concurrent reads can share a connection session.
- The commands of a transaction go to the endpoint of the transaction. This
  matters when the connection string has several endpoints.
