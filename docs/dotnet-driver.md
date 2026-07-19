---
sidebar_position: 7.1
---

# .NET Driver

CamusDB ships an ADO.NET provider for direct access from .NET applications.
The package name is `CamusDB.Client`.

It targets `net8.0`, `net9.0`, and `net10.0`.

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
| `Timeout` | No | HTTP request timeout in seconds. Defaults to `10`. |

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

Opening a connection does not create the database. Create databases explicitly
before running table DDL, DML, or queries.

```csharp
await connection.CreateDatabaseAsync(ifNotExists: true);
await connection.CreateDatabaseAsync("otherdb", ifNotExists: true);

await connection.DropDatabaseAsync("old_test_db");
```

`CreateDatabaseAsync()` and `DropDatabaseAsync()` operate on the database in the
connection string unless you pass an explicit name. Database creation retries a
small set of transient schema-allocation conflicts internally.

For copy-on-write database branches, use the branching helpers:

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

See [Database Branching](/docs/database-branching) for the SQL behavior behind
these helpers.

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

`ExecuteDDLAsync()` is also the direct path for CamusDB-specific DDL such as
`CHECK` constraints, named `NOT NULL`, index operations, table renames, and raw
schema changes not wrapped by a helper method.

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
- `GetDateTime`
- `GetFieldValue<T>` for `DateOnly`, `DateTimeOffset`, `byte[]`, `float`,
  `Guid`, and other provider-supported values
- `IsDBNull`

## Parameters

Parameters are input-only. Supported value mappings include:

| Camus type | Typical .NET values |
| --- | --- |
| `ColumnType.Id` | `string`, `Guid`, `CamusObjectIdValue` |
| `ColumnType.Uuid` | `Guid`, canonical UUID `string` |
| `ColumnType.String` | `string` |
| `ColumnType.Integer64` | `short`, `int`, `long`, other integer-convertible values |
| `ColumnType.Float64` | `double`, `decimal`, other floating-convertible values |
| `ColumnType.Float32` | `float`, other floating-convertible values |
| `ColumnType.Bool` | `bool` |
| `ColumnType.Bytes` | `byte[]`, `ReadOnlyMemory<byte>`, `Memory<byte>`, `ArraySegment<byte>`, `IEnumerable<byte>` |
| `ColumnType.Date` | `DateOnly`, `DateTime`, `DateTimeOffset`, ISO date/time `string` |
| `ColumnType.DateTime` | `DateTime`, `DateTimeOffset`, ISO date/time `string` |
| `ColumnType.Array` | `IEnumerable` of a scalar supported type |
| `ColumnType.Null` | `null`, `DBNull.Value` |

Examples:

```csharp
command.Parameters.Add("@id", ColumnType.Id, Guid.NewGuid());
command.Parameters.Add("@ref", ColumnType.Uuid, Guid.NewGuid());
command.Parameters.Add("@count", ColumnType.Integer64, 5);
command.Parameters.Add("@price", ColumnType.Float64, 19.99);
command.Parameters.Add("@payload", ColumnType.Bytes, new byte[] { 0xDE, 0xAD });
command.Parameters.Add("@day", ColumnType.Date, new DateOnly(2026, 5, 1));
command.Parameters.Add("@happened", ColumnType.DateTime, DateTimeOffset.UtcNow);
command.Parameters.Add("@note", ColumnType.Null, null);
```

For arrays, pass `isArray: true`. Set the scalar element type explicitly for
empty arrays or arrays where all current values are `NULL`.

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

Dates and datetimes are normalized to UTC before they are sent. `DATE` values
are stored at midnight UTC. `DATETIME` values are read back with
`DateTimeKind.Utc`.

## Data Types

The ADO.NET driver covers CamusDB's current scalar and array type surface:

| SQL DDL type | Driver type | Typical read/write type |
| --- | --- | --- |
| `OID`, `OBJECT_ID` | `ColumnType.Id` | `string`, `Guid`, `CamusObjectIdValue` |
| `UUID`, `GUID` | `ColumnType.Uuid` | `Guid` |
| `STRING`, `STRING(N)` | `ColumnType.String` | `string` |
| `INT64`, `INT`, `INTEGER` | `ColumnType.Integer64` | `long`, `int`, `short` |
| `FLOAT64` | `ColumnType.Float64` | `double` |
| `FLOAT32`, `REAL` | `ColumnType.Float32` | `float` |
| `BOOL`, `BOOLEAN` | `ColumnType.Bool` | `bool` |
| `BYTES`, `BLOB` | `ColumnType.Bytes` | `byte[]` |
| `DATE` | `ColumnType.Date` | `DateOnly`, `DateTime` |
| `DATETIME`, `TIMESTAMP` | `ColumnType.DateTime` | `DateTime`, `DateTimeOffset` |
| `ARRAY(T)` | `ColumnType.Array` | `object?[]` on read, `IEnumerable` on write |

Use native `UUID` columns for UUID values instead of storing UUID text in
`STRING`; the native type is more efficient on memory and disk and compares as a
fixed-width value.

## Query Result Cache

CamusDB's query result cache is available from raw SQL. Put a `{cache=...}` hint
after the table reference, or build the hint with `CamusCacheHint`.

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

`CamusCacheMetadata` reports the server cache decision, including statuses such
as `Hit`, `Miss`, `Bypass`, `StaleRevalidated`, and `EvictedBeforePublish`.

Evict cache families through the connection:

```csharp
await connection.EvictCacheAsync("recent_orders");
await connection.EvictAllCacheAsync();
```

Cache entries are scoped to the current database. See
[Query Result Cache](/docs/query-result-cache) for query-shape rules.

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
Unspecified transactions inherit CamusDB's server default, which is
Serializable.

The current ADO.NET driver does not expose a Read Committed transaction option.
Use SQL, the HTTP API, or the gRPC API directly if you need to opt a
transaction down to Read Committed.

## Serializable Retries

Serializable is the default isolation level in CamusDB. When two serializable
read-write transactions conflict, one transaction is aborted and the whole unit
of work must be replayed from the beginning.

The client package includes `SerializableRetryHelper` for that retry contract.
Only these CamusDB error codes are treated as retryable:

| Code | Name | Meaning |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | A lock conflict aborted the transaction. |
| `CADB0504` | `TransactionMustRetry` | A pre-write transient routing, leader-transition, lock-wait, or storage conflict condition exhausted internal retries. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction exceeded the server lifetime cap. |

`CADB0509` `TransactionFinalizeUnresolved` is intentionally not part of this
replay helper. It means a commit or rollback has not reached a terminal answer;
retry the same finalize on the same transaction instead of replaying the
operation from the beginning.

Use `SerializableRetryHelper.IsRetryable(...)` when you own the retry loop:

```csharp
catch (CamusException ex) when (SerializableRetryHelper.IsRetryable(ex))
{
    // Replay the whole transaction from the beginning.
}
```

For single-statement autocommit work, use
`SerializableRetryHelper.ExecuteAutocommitAsync(...)`:

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

For explicit multi-statement transactions, do not retry only the failed
statement. Start a new transaction and rerun every read and write in the unit:

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

The helper's default backoff is bounded exponential delay with jitter:
`min(20 ms * 2^attempt, 400 ms)` plus or minus 25 percent.

## ADO.NET Notes

- The provider uses HTTP under the hood. CamusDB also exposes a separate
  [gRPC API](/docs/grpc-api) for protocol-level clients.
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
