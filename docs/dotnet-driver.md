---
sidebar_position: 7.1
---

# .NET driver

`CamusDB.Client` connects a .NET application to CamusDB. It is an ADO.NET
provider. ADO.NET is the standard .NET database interface: connections,
commands, data readers, and transactions work the same way for every database,
so ADO.NET code you wrote for another database reads the same with CamusDB.

The driver is the foundation of the other .NET packages. It also gives you
direct access to CamusDB features such as the gRPC transport, learned routing,
prepared statements, serializable retries, and backups.

## Which .NET package to use

| Package | What it gives you | Choose it when | Targets |
| --- | --- | --- | --- |
| [`CamusDB.Client`](/docs/dotnet-driver) | The ADO.NET driver: connections, commands, data readers, and transactions. | You want full control of the SQL text and of each command. | `net8.0`, `net9.0`, `net10.0` |
| [`CamusDB.Dapper`](/docs/dapper) | Dapper on the same connection: you write the SQL, and Dapper maps each row to a C# object. | You write SQL yourself, but you do not want to read each column by hand. | `net8.0`, `net9.0`, `net10.0` |
| [`CamusDB.EntityFrameworkCore`](/docs/ef-core) | The EF Core provider: LINQ queries, change tracking, and migrations. | Your application uses C# classes as its data model, and EF Core writes the SQL. | `net10.0` |

All three packages share the same driver underneath, and you can use more than
one in the same application.

For integration tests, [Testcontainers](/docs/testcontainers) starts a temporary
CamusDB server in Docker and supplies connection strings for these packages.
For local application orchestration, the [.NET Aspire integrations](/docs/aspire)
connect your AppHost and services with database resources and client registration.

Use the driver directly when:

- You want full control of the SQL text.
- You use CamusDB SQL features that an ORM doesn't expose.
- You want a small dependency without EF Core.
- You want to control each transaction explicitly.

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

`ChangeDatabase("otherdb")` changes the connection's target database.
The target database must already exist; see [Database administration](#database-administration)
when the application is responsible for provisioning it.

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

`ExecuteDDLAsync()` is also the direct path for other CamusDB DDL, such as:

- `CHECK` constraints.
- Named `NOT NULL` constraints.
- Index operations.
- Table renames.
- `TRUNCATE TABLE`.
- Schema changes that have no helper method.

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

Use `ExecuteReaderAsync()` or `ExecuteScalarAsync()` when an `INSERT`, `UPDATE`,
or `DELETE` has a `RETURNING` list:

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

`ExecuteNonQueryAsync()` returns the affected-row count only. The driver tells
the server to discard the returned rows, but the server still validates the
`RETURNING` list and checks the required `SELECT` privilege on the target table.

`ExecuteReaderAsync()` and `ExecuteScalarAsync()` receive all returned rows in
one reply. On gRPC, a reply larger than the message limit fails with `CADB0550`
before the commit. For a large `INSERT ... SELECT ... RETURNING`, use
`ExecuteStreamReaderAsync()` so the query endpoint streams rows.

## Query rows

Use `ExecuteReaderAsync()` to read result rows:

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

`ExecuteReaderAsync()` materializes the result before it returns. For a large
`SELECT`, use `ExecuteStreamReaderAsync()` so rows are read incrementally from
the server's streaming endpoint:

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

The streaming path uses the same reader API. It does not expose cache metadata,
and it cannot transparently replay a serializable conflict after rows have
already been delivered. Use the buffered reader when you need automatic retry
around a single statement.

The reader exposes the standard typed getters, such as:

- `GetString`
- `GetBoolean`
- `GetInt16` / `GetInt32` / `GetInt64`
- `GetFloat` / `GetDouble`
- `GetDecimal`
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
| `ColumnType.Numeric` | `decimal`, decimal text `string`, integer values |
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
command.Parameters.Add("@total", ColumnType.Numeric, 123.45m);
command.Parameters.Add("@price", ColumnType.Float64, 19.99);
command.Parameters.Add("@payload", ColumnType.Bytes, new byte[] { 0xDE, 0xAD });
command.Parameters.Add("@day", ColumnType.Date, new DateOnly(2026, 5, 1));
command.Parameters.Add("@happened", ColumnType.DateTime, DateTimeOffset.UtcNow);
command.Parameters.Add("@note", ColumnType.Null, null);
```

For an array, pass `isArray: true`. Set the element scalar type explicitly
when the array is empty or every current value is `NULL`.

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

The driver normalizes dates and datetimes to UTC before sending them. It
stores `DATE` values at midnight UTC and reads `DATETIME` values back with
`DateTimeKind.Utc`.

## Data types

The ADO.NET driver covers CamusDB's current scalar types and its array type:

| SQL DDL type | Driver type | Typical read/write type |
| --- | --- | --- |
| `OID`, `OBJECT_ID` | `ColumnType.Id` | `string`, `Guid`, `CamusObjectIdValue` |
| `UUID`, `GUID` | `ColumnType.Uuid` | `Guid` |
| `STRING`, `STRING(N)` | `ColumnType.String` | `string` |
| `INT64`, `INT`, `INTEGER` | `ColumnType.Integer64` | `long`, `int`, `short` |
| `NUMERIC`, `DECIMAL` | `ColumnType.Numeric` | `decimal`, exact decimal `string` |
| `FLOAT64` | `ColumnType.Float64` | `double` |
| `FLOAT32`, `REAL` | `ColumnType.Float32` | `float` |
| `BOOL`, `BOOLEAN` | `ColumnType.Bool` | `bool` |
| `BYTES`, `BLOB` | `ColumnType.Bytes` | `byte[]` |
| `DATE` | `ColumnType.Date` | `DateOnly`, `DateTime` |
| `DATETIME`, `TIMESTAMP` | `ColumnType.DateTime` | `DateTime`, `DateTimeOffset` |
| `ARRAY(T)` | `ColumnType.Array` | `object?[]` on read, `IEnumerable` on write |

Store UUIDs in a native `UUID` column, not as text in a `STRING`. The native
type is more compact in memory and on disk, and it compares as a fixed-width
value.

`NUMERIC` is an exact decimal type with fixed precision and scale. A `decimal`
parameter binds as `NUMERIC`; use `ColumnType.Numeric` with a `string` when the
value has more significant digits than .NET `decimal` can hold. Read small
values with `GetDecimal()` or `GetFieldValue<decimal>()`; read every value
without rounding with `GetString()`.

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

`CamusTransactionOptions` lets you set the concurrency behavior for an explicit
transaction:

| Option | Values | Default |
| --- | --- | --- |
| `IsolationLevel` | `Serializable`, `ReadCommitted` | server default, `Serializable` |
| `Mode` | `ReadWrite`, `ReadOnly` | `ReadWrite` |
| `Locking` | `Pessimistic`, `Optimistic` | server default, `Pessimistic` |
| `Affinity` | exact SQL text of a statement with a learned route | `null` |

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

Precedence is: per-transaction options, then connection-string defaults, then
the server default.

With learned routing enabled, `BeginTransactionAsync()` can defer `BEGIN` until
the first statement. The driver then starts the transaction on that statement's
learned endpoint, and every later statement plus commit or rollback remains
pinned there. If no route has been learned, it falls back to endpoint rotation.

Use `CamusTransactionOptions.Affinity` when a later, hotter statement should
choose the transaction endpoint. The value must be the exact SQL text whose
route should be used. With `RoutingMode=Off`, `BeginTransactionAsync()` sends
`BEGIN` immediately as before.

In routed mode, `TxnIdPT`, `TxnIdCounter`, and `TransactionId` are zero until
the transaction starts. Use `IsStarted` when a diagnostic path needs to
distinguish a deferred transaction from one that already has a server handle.

## Serializable retries

Serializable is CamusDB's default isolation level. When two serializable
read-write transactions conflict, CamusDB aborts one of them, and your
application must replay that whole unit of work from the start.

The client package includes a `SerializableRetryHelper` for this retry
contract. It treats these CamusDB error codes as retryable, and no others:

| Code | Name | Meaning |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | A lock conflict aborted the transaction. |
| `CADB0504` | `TransactionMustRetry` | A transient routing, [leader](/docs/concepts#leader) change, lock-wait, storage conflict, or temporarily unservable read-range condition exhausted internal retries. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction exceeded the server lifetime cap. |

The helper intentionally leaves out `CADB0509`
`TransactionFinalizeUnresolved`. That code means a commit or rollback has no
final answer yet: retry the same finalize on the same transaction, and don't
replay the operation from the start.

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

For a multi-statement explicit transaction, don't retry the failed statement
alone. Start a new transaction and run every read and write in the unit again:

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

The helper's default backoff is a bounded exponential delay with random
jitter: `min(20 ms * 2^attempt, 400 ms)`, plus or minus 25 percent.

## Prepared statements

The driver prepares repeated SQL automatically. Once the same SQL shape has
run enough times, later executions run as a prepared statement, with no change
to your application code.

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

By default, the first execution runs inline and the second prepares the
statement. Tune that policy in the connection string:

```csharp
CamusConnectionStringBuilder eager = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=512;AutoPrepareMinUsages=1");

CamusConnectionStringBuilder off = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=0");
```

Call `Prepare()` or `PrepareAsync()` when you already know a statement is hot:

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

A prepared execution behaves like an inline one, including transactions,
isolation, locks, affected-row counts, and the query result cache.

ADO.NET still binds parameters by name. The driver maps each name to the
server's positional binding order.

`SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `SHOW` can be prepared. The driver
runs other statements inline.

If the server reports an unknown handle, the driver prepares the statement
again and replays the execution once, transparently.

`CamusConnectionStringBuilder.PreparedStatementCount` and `IsPrepared(sql)` are
available for diagnostics.

See [Prepared Statements](/docs/prepared-statements) for server-side handle
scope, handle lifetime over REST and gRPC, and limits.

## Vectors

CamusDB vector search uses a `BYTES` column that stores tightly packed
little-endian `float32` values. The driver keeps that layout in one helper:

```csharp
float[] embedding = await EmbedAsync("robot assembly manual");
byte[] packed = CamusVector.ToBytes(embedding);

command.Parameters.Add("@embedding", ColumnType.Bytes, packed);
```

Read a vector back with `GetVector(...)`:

```csharp
float[] embedding = reader.GetVector(reader.GetOrdinal("embedding"));
```

The dimension is not part of the `BYTES` type. Enforce it with a check
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

Pass the query vector as a parameter and rank with a vector function:

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

See [Vector Search](/docs/vector-search) for the SQL functions, error codes, and
query-planning behavior.

## Query result cache

The CamusDB query result cache is available from plain SQL: put a
`{cache=...}` hint after the table reference. You can also build the hint with
`CamusCacheHint`.

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

`CamusCacheMetadata` reports the server cache's decision. Its status is `Hit`,
`Miss`, `Bypass`, `StaleRevalidated`, or `EvictedBeforePublish`.

Evict cache families through the connection:

```csharp
await connection.EvictCacheAsync("recent_orders");
await connection.EvictAllCacheAsync();
```

Cache entries belong to the current database. See
[Query Result Cache](/docs/query-result-cache) for the query shape rules.

## Authentication

CamusDB authentication is off by default. A connection string without
credentials sends no `Authorization` header.

Against a server with authentication enabled, add `User` and `Password`:

```csharp
CamusConnectionStringBuilder builder = new(
    "Endpoint=https://db.example.com:7141;Database=app;User=myapp;Password=app-secret");
```

The driver exchanges the password once for a short-lived bearer token, using
the REST `/login` endpoint on REST connections and the `CamusAuth` service on
gRPC connections.

Statements then send the token, not the password. The driver caches the token
per set of credentials and renews it based on the expiry the server reports. If
a cached token is rejected because it expired or was rotated out, the driver
discards it, logs in again, and replays the statement once. Permission errors
are not retried.

You can also log in explicitly, for example when the password comes from a
secrets manager:

```csharp
await using CamusConnection connection = new(
    new CamusConnectionStringBuilder("Endpoint=https://db.example.com:7141;Database=app"));

await connection.OpenAsync();
string token = await connection.LoginAsync("myapp", passwordFromSecretManager);
await connection.LogoutAsync();
```

`AccessToken=...` uses a token obtained elsewhere. The driver doesn't renew it,
so the server returns `CADB0516` once the token expires or is revoked.

For authenticated deployments beyond loopback, use an `https://` address. The
driver refuses to send `Password` or `AccessToken` credentials to a remote
plaintext endpoint unless the connection string sets
`AllowInsecureCredentials=true`. See
[Authentication And Authorization](/docs/sql-authentication) for server
setup, grants, and TLS behavior.

## Connection string

A `CamusConnection` connection string must include:

- `Endpoint`: the base CamusDB endpoint
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
| `Endpoint` | Yes | Base URL for the CamusDB node. Use the REST port by default, or the gRPC port when `Protocol=grpc`. |
| `Database` | Yes | Database name sent on requests. |
| `Timeout` | No | Request timeout in seconds. Defaults to `10`. |
| `Protocol` | No | Wire protocol: `rest` by default, or `grpc`. |
| `User` | No | User to authenticate as. Aliases: `UserId`, `Uid`, `Username`. |
| `Password` | No | Password for `User`. Alias: `Pwd`. |
| `AccessToken` | No | Bearer token obtained elsewhere. Used directly instead of logging in. |
| `TokenLifetime` | No | Fallback seconds to reuse a token if the server does not report expiry. Defaults to `600`. |
| `MaxAutoPrepare` | No | Maximum statements the driver keeps prepared. Defaults to `128`; `0` disables automatic preparation. |
| `AutoPrepareMinUsages` | No | Executions of the same SQL before the driver prepares it. Defaults to `2`. |
| `IsolationLevel` | No | Default isolation for transactions and autocommit statements: `Serializable` or `ReadCommitted`. Server default is `Serializable`. |
| `TransactionMode` | No | Default transaction mode: `ReadWrite` or `ReadOnly`. |
| `Locking` | No | Default locking mode: `Pessimistic` or `Optimistic`. |
| `ChannelPoolSize` | No | gRPC only: long-lived `BatchExecute` streams per endpoint. Defaults to `2`. |
| `CoalescingThreshold` | No | gRPC only: operations a batch drain tries to collect before it stops waiting. Defaults to `10`; `1` disables coalescing. |
| `CoalescingDelay` | No | gRPC only: milliseconds to wait for a larger batch. Defaults to `0` (no wait). Operations that are already waiting still share a frame when `RequestFrames` is on. Set `1` or `2` when many concurrent callers on one connection send bursts. |
| `RequestFrames` | No | gRPC only: whether the client may pack waiting batch operations into negotiated stream frames. Defaults to `true`; set `false` as a compatibility or measurement switch. |
| `TraceQueryText` | No | Adds SQL text to driver spans as `db.query.text`. Defaults to `false`, because SQL literals can contain sensitive values. |
| `BackupEndpoint` | No | HTTP endpoint for the backup admin API. Defaults to `Endpoint`; required when `Protocol=grpc`. |
| `BackupTimeout` | No | Backup admin timeout in seconds. Defaults to `300`. |
| `AllowInsecureCredentials` | No | Set `true` to allow credentials over a non-loopback plaintext endpoint. Use only when another trusted layer protects that hop. |
| `RoutingMode` | No | Learned statement routing: `Auto`, `Learned`, or `Off`. Defaults to `Auto`. |
| `RoutingNodes` | No | Trust map from server node identities to addresses already listed in `Endpoint`. Quote the value because it contains `=`. |
| `RoutingMaxHintAge` | No | Maximum age, in milliseconds, for a learned route. Defaults to `5000`. |

`Endpoint` can also be a comma-separated pool:

```text
Endpoint=http://localhost:5095,http://localhost:5096,http://localhost:5097;Database=test
```

The client uses each endpoint in turn. When a transport request cannot reach an
endpoint, the driver sets that endpoint aside for 30 seconds and skips it
meanwhile. The rotation and health state are shared by every connection that
uses the same `Endpoint` value.

Connection string keys are case-insensitive and trimmed. Repeating a key is an
error. Quote a value with single or double quotes when it contains a semicolon
or surrounding spaces; double the quote character to include the quote itself.

`CamusConnectionStringBuilder.ToString()` returns the original connection string,
including credentials. Use `ToRedactedString()` or
`CamusConnectionStringBuilder.Redact(...)` for logs. They mask `Password`, `Pwd`,
and `AccessToken`. A `CamusConnection` keeps the connection string it was built
from; assigning a different value later throws `NotSupportedException`.

## Transport

The driver can use the REST endpoint or the gRPC endpoint with the same
`CamusCommand` and `CamusTransaction` APIs:

```csharp
CamusConnectionStringBuilder rest = new(
    "Endpoint=http://localhost:5095;Database=test");

CamusConnectionStringBuilder grpc = new(
    "Endpoint=http://localhost:5096;Database=test;Protocol=grpc");
```

REST and gRPC listen on separate server ports. When you set `Protocol=grpc`,
point `Endpoint` at the gRPC port. Use `http://` for local plaintext HTTP/2, or
`https://` for a TLS-terminated deployment.

Under gRPC, queries, non-queries, and transaction lifecycle messages are
multiplexed over a small pool of long-lived `BatchExecute` streams. Autocommit
statements fan out across the pool. A transaction is pinned to one stream so
the server observes its operations in order. Tune the pool with
`ChannelPoolSize`, `CoalescingThreshold`, `CoalescingDelay`, and
`RequestFrames` only when a measured workload needs it. Stream frames are
negotiated per stream and are a transport optimization only: they add no
atomicity and keep the same per-operation result contract.

## Learned routing

A CamusDB server can attach advisory routing metadata to a successful SQL
response. With learned routing enabled, the .NET driver uses that metadata to
send later executions of the same statement directly to the node that leads the
statement's data. This is a latency optimization only. The server still executes
correctly wherever the request lands.

```csharp
CamusConnectionStringBuilder builder = new(
    "Endpoint=http://a:5095,http://b:5095,http://c:5095;Database=test;RoutingMode=Learned;" +
    "RoutingNodes='camus-a:7070=http://a:5095,camus-b:7070=http://b:5095,camus-c:7070=http://c:5095'");
```

`RoutingNodes` is the routing authority. The server advertises an opaque node
identity. The driver uses it only when the connection string maps that identity
to an address that is also present in the `Endpoint` pool. It never dials an
address supplied by a server response.

`RoutingMode=Auto` is the default. It negotiates routing advice only when
`RoutingNodes` names at least two distinct endpoints. `RoutingMode=Learned`
negotiates when at least one identity is mapped. `RoutingMode=Off` disables the
feature and keeps endpoint rotation only.

The driver learns routes per database, exact SQL text, and statement kind. The
TTL is the smaller of the server's `maxAgeMs` and `RoutingMaxHintAge`. The cache
is bounded, and stale advice only costs an extra forwarding hop until it expires
or a newer response replaces it. Parameterized and prepared workloads benefit
the most because they reuse the same SQL text.

`CamusCommand.LastRoutingAdvice` exposes the most recent advice for diagnostics.
The eligible statements and the wire contract are described in
[SQL Routing Advice](/docs/sql-routing-advice).

## Ping

Use a ping command to verify connectivity:

```csharp
await using CamusCommand ping = connection.CreatePingCommand();
int result = await ping.ExecuteNonQueryAsync();
```

## Node resource stats

The client can read operational statistics over REST or gRPC. Call it without
an argument to ask the next endpoint in the rotation, or pass one of the
endpoints from the connection string:

```csharp
CamusNodeStats current = await connection.GetNodeStatsAsync();
CamusNodeStats node = await connection.GetNodeStatsAsync("http://db2.example.com:5095");
```

The endpoint must match an entry in `Endpoint` exactly. Any other value throws
`ArgumentException`, so the client never sends its credentials to an
unconfigured address.

The result covers disk volumes, CPU, memory, node identity, and uptime. With
authentication enabled, the connection must use a superuser or an account with
the global `MONITOR` privilege. See [Node resource stats](/docs/node-stats).

## Database administration

Opening a connection does not create its database. Create or drop databases
explicitly:

```csharp
await connection.CreateDatabaseAsync(ifNotExists: true);
await connection.CreateDatabaseAsync("otherdb", ifNotExists: true);

await connection.DropDatabaseAsync("old_test_db");
```

`CreateDatabaseAsync()` and `DropDatabaseAsync()` both act on the database of
the connection string. An explicit name changes that target. Database creation
retries its small set of transient schema-allocation conflicts internally.

For a copy-on-write database branch, use the branch helpers:

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

See [Database Branching](/docs/database-branching) for how the SQL behind
these helpers behaves.

## Backups

`connection.Backups` exposes the online backup administration API. You can take
full, incremental, or coordinated backups, inspect the backup catalog, validate
a restore chain, and run retention:

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

Backups are node-wide. They are not scoped to the connection's `Database`
value. The server must have `kahuna.backup_dir` configured before these calls
can succeed.

The backup admin API is REST-only. If the main connection uses `Protocol=grpc`,
set `BackupEndpoint` to the HTTP endpoint and use `BackupTimeout` for the
longer timeout a full backup may need:

```text
Endpoint=http://localhost:5096;Database=test;Protocol=grpc;BackupEndpoint=http://localhost:5095;BackupTimeout=300
```

See [Backup And Restore](/docs/backup-and-restore) for the server-side backup
model.

## OpenTelemetry

`CamusDB.Client` emits traces and metrics through the .NET `ActivitySource` and
`Meter` APIs. The driver itself has no dependency on the OpenTelemetry SDK. Both
sources use the name `CamusDB.Client`, exposed as
`CamusTelemetry.ActivitySourceName` and `CamusTelemetry.MeterName`.

Register the sources with the OpenTelemetry SDK and then configure the exporter
that your application uses:

```csharp
using CamusDB.Client;

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing =>
        tracing.AddSource(CamusTelemetry.ActivitySourceName))
    .WithMetrics(metrics =>
        metrics.AddMeter(CamusTelemetry.MeterName));
```

The optional `CamusDB.OpenTelemetry` package provides convenience extension
methods for the same registration:

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

The package depends only on `OpenTelemetry.Api`. The application still chooses
and configures its OpenTelemetry SDK and exporters.

### Traces

The driver creates an `ActivityKind.Client` span for:

- Each command execution, including queries, writes, and DDL.
- Each typed insert through `CamusInsertCommand`.
- `BEGIN`, `COMMIT`, and `ROLLBACK`. One finalize span covers all retries after
  `CADB0509 TransactionFinalizeUnresolved`.
- Each pipeline exchange, as one `BATCH` span.

Dapper and EF Core execute through the same command APIs, so their operations
receive driver spans too. A span is a child of the current application activity.
The HTTP or gRPC transport spans, when enabled, are children of the driver span.

A span name has the form `{operation} {target}`, such as `SELECT shop`. The
target is the table for a typed insert and the database for other operations.
The driver adds these attributes where they apply:

| Attribute | Value |
| --- | --- |
| `db.system.name` | `camusdb` |
| `db.namespace` | The database from the connection string. |
| `db.operation.name` | The SQL verb, or `BEGIN`, `COMMIT`, `ROLLBACK`, or `BATCH`. |
| `db.collection.name` | The table of a typed insert. |
| `db.operation.batch.size` | The number of operations in a pipeline exchange. |
| `server.address`, `server.port` | The endpoint that received the operation after routing. |
| `camusdb.transport` | `rest` or `grpc`. |
| `db.query.text` | The SQL text, only when `TraceQueryText=true`. |
| `error.type` | The `CADBxxxx` code, or the exception type for a non-CamusDB failure. |
| `db.response.status_code` | The `CADBxxxx` code of a failed CamusDB operation. |

SQL text is off by default because a literal in a statement can contain
sensitive data. Enable it for one connection with:

```text
Endpoint=http://localhost:5095;Database=app;TraceQueryText=true
```

The driver never records parameter values. A retry made while a driver span is
current also adds a `camusdb.retry` event with `camusdb.retry.kind` and
`error.type`.

A buffered query span ends when the command returns. A streaming query span
remains open until the reader reaches the end, fails while reading, or is
closed. This makes its duration include the time that the application spends
consuming the stream.

### Metrics

The `CamusDB.Client` meter emits the database operation duration and metrics for
retries, endpoint health, and automatic prepared statements:

| Metric | Type | Meaning |
| --- | --- | --- |
| `db.client.operation.duration` | Histogram, seconds | Duration of the same operations that produce spans. It includes database, operation, endpoint, and error attributes, but never SQL text. |
| `camusdb.client.operation.retries` | Counter | Operations sent again. `camusdb.retry.kind` is `finalize`, `autocommit`, `token_renewal`, or `create_database`. |
| `camusdb.client.endpoint.quarantines` | Counter | Times a transport failure caused the driver to set an endpoint aside for 30 seconds. |
| `camusdb.client.endpoint.quarantined` | Gauge | `1` while an endpoint is set aside and `0` while it can receive traffic. |
| `camusdb.client.prepared_statement.lookups` | Counter | Prepared-statement lookups by result: `hit`, `registered`, or `miss`. |
| `camusdb.client.prepared_statement.registrations` | Counter | Preparation attempts by result: `success`, `refused`, or `unsupported`. |
| `camusdb.client.prepared_statement.evictions` | Counter | Prepared statements released to make room for more recently used statements. |
| `camusdb.client.prepared_statement.count` | Up-down counter | Statements currently held in the driver's prepared-statement cache. |

The operation metrics use low-cardinality attributes such as the database,
operation name, endpoint, and error code. Prepared-statement metrics use
`db.namespace` and `camusdb.prepared_statement.result` where applicable.

Use these signals together:

- Rising endpoint quarantines identify transport failures and endpoint churn.
- Retry counts separate transaction conflicts, unresolved finalization, token
  renewal, and database-creation retries.
- A prepared-statement count that remains at `MaxAutoPrepare` while evictions
  grow indicates that the cache is too small for the active statement set.

When no listener enables the activity source or instruments, the driver creates
no spans, tags, or timestamps for an operation. `OpenAsync()` opens no physical
database connection, so the driver does not publish `db.client.connection.*`
metrics. If the application also enables
`OpenTelemetry.Instrumentation.EntityFrameworkCore`, an EF Core query produces
both an EF Core span and a CamusDB driver span.

## ADO.NET notes

- The provider can use REST/JSON or gRPC with the same ADO.NET surface. Select
  gRPC with `Protocol=grpc` and point `Endpoint` at the gRPC listener.
- `Cancel()` is cooperative through cancellation tokens.
- Concurrent reads can share a connection session.
- Transaction-scoped commands are pinned to the transaction endpoint, which is
  important when the connection string contains multiple endpoints.
