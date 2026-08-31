---
sidebar_position: 7.1
---

# .NET driver

CamusDB ships a provider of ADO.NET. It gives a direct access from an
application of .NET. The name of the package is `CamusDB.Client`.

It targets `net8.0`, `net9.0`, and `net10.0`.

## Install

```bash
dotnet add package CamusDB.Client
```

## Connection string

Create a `CamusConnection`. Its connection string must hold these parts:

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
| `CoalescingDelay` | No | gRPC only: milliseconds to wait for a larger batch. Defaults to `2`; `0` disables coalescing. |
| `BackupEndpoint` | No | HTTP endpoint for the backup admin API. Defaults to `Endpoint`; required when `Protocol=grpc`. |
| `BackupTimeout` | No | Backup admin timeout in seconds. Defaults to `300`. |

`Endpoint` can also be a comma-separated pool:

```text
Endpoint=http://localhost:5095,http://localhost:5096,http://localhost:5097;Database=test
```

The client uses each endpoint in turn. When a transport request cannot reach an
endpoint, the driver sets that endpoint aside for 30 seconds and skips it
meanwhile. The rotation and health state are shared by every connection that
uses the same `Endpoint` value.

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
`ChannelPoolSize`, `CoalescingThreshold`, and `CoalescingDelay` only when a
measured workload needs it.

## Authentication

The authentication of CamusDB is off by default. A connection string without a
credential sends no `Authorization` header.

Against a server with the authentication enabled, add a `User` and a
`Password`:

```csharp
CamusConnectionStringBuilder builder = new(
    "Endpoint=https://db.example.com:7141;Database=app;User=myapp;Password=app-secret");
```

The driver exchanges the password one time, for a bearer token with a short
life. It uses the REST endpoint `/login` on a connection of REST. It uses the
service `CamusAuth` on a connection of gRPC.

A statement then sends the token. It does not send the password. The driver
caches the token for that set of credentials. It renews the token from the expiry
that the server reports. If a cached token is rejected because it expired or was
rotated out, the driver discards it, logs in again, and replays the statement
one time. Permission errors are not retried.

You can also log in explicitly, when the password comes from a manager of
secrets:

```csharp
await using CamusConnection connection = new(
    new CamusConnectionStringBuilder("Endpoint=https://db.example.com:7141;Database=app"));

await connection.OpenAsync();
string token = await connection.LoginAsync("myapp", passwordFromSecretManager);
await connection.LogoutAsync();
```

An `AccessToken=...` uses a token from another source. The driver does not renew
that token. The server returns a `CADB0516` after the token expires, and after
somebody revokes it.

Use an `https://` address for a deployment with authentication, outside
loopback. See [Authentication And Authorization](/docs/sql-authentication) for
the setup of the server, for the grants, and for the behavior of TLS.

## Open a connection

```csharp
await using CamusConnection connection =
    new(new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=test"));

await connection.OpenAsync();
```

`ChangeDatabase("otherdb")` changes the target database of the connection.

An open of a connection creates no database. Create a database explicitly first.
Only then run a DDL statement of a table, a DML statement, or a query.

```csharp
await connection.CreateDatabaseAsync(ifNotExists: true);
await connection.CreateDatabaseAsync("otherdb", ifNotExists: true);

await connection.DropDatabaseAsync("old_test_db");
```

`CreateDatabaseAsync()` and `DropDatabaseAsync()` both act on the database of
the connection string. An explicit name changes that target.

The creation of a database retries a small set of transient conflicts. Those
conflicts come from the allocation of a schema. The driver handles them
internally.

For a branch of a database, with a copy at the first write, use the helpers of
the branch:

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

See [Database Branching](/docs/database-branching) for the behavior of the SQL
behind these helpers.

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

`ExecuteDDLAsync()` is also the direct path for a DDL statement of CamusDB. Six
examples follow:

- A `CHECK` constraint.
- A named `NOT NULL`.
- An operation on an index.
- A rename of a table.
- A `TRUNCATE TABLE`.
- A change of a schema without a helper method.

## Insert rows

For an insert, use the helper of the insert. You can also use SQL with a
parameter.

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

The reader exposes the standard typed methods of a get, such as these:

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

For an array, pass an `isArray: true`. Set the scalar type of the elements
explicitly in two cases: an empty array, and an array whose every current value
is a `NULL`.

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

The driver normalizes a date and a datetime to UTC before it sends them. It
stores a `DATE` value at midnight in UTC. It reads a `DATETIME` value back with
a `DateTimeKind.Utc`.

## Prepared statements

The driver prepares a repeated statement of SQL automatically. The same shape of
SQL must execute enough times first. A later execution then runs as a prepared
statement. You change no code of your application.

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

By default, the first execution runs inline. The second execution prepares the
statement. Tune that policy in the connection string:

```csharp
CamusConnectionStringBuilder eager = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=512;AutoPrepareMinUsages=1");

CamusConnectionStringBuilder off = new(
    "Endpoint=http://localhost:5095;Database=test;MaxAutoPrepare=0");
```

Call a `Prepare()`, or a `PrepareAsync()`, when you know that a statement is hot
already:

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

A prepared execution keeps the behavior of an inline execution. That includes the
transaction, the isolation, the locks, the count of the affected rows, and the
result cache of a query.

The API of ADO.NET still binds a parameter by its name. The driver maps that name
onto the order of the binding by position of the server.

Five statements accept a prepare: a `SELECT`, an `INSERT`, an `UPDATE`, a
`DELETE`, and a `SHOW`. The driver runs another statement inline.

The server can report an unknown handle. The driver then prepares the statement
again, and it replays the execution one time. You see none of that work.

`CamusConnectionStringBuilder.PreparedStatementCount` and `IsPrepared(sql)` are
available for diagnostics.

See [Prepared Statements](/docs/prepared-statements) for three subjects: the
scope of a handle on the server, the life of a handle over REST and over gRPC,
and the limits.

## Data types

The driver of ADO.NET covers the current scalar types of CamusDB, and its type
of an array:

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

Use a native `UUID` column for a value of a UUID. Do not store the text of a
UUID in a `STRING`. The native type is more efficient in the memory, and on the
disk. It also compares as a value of a fixed width.

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

The result cache of a query of CamusDB is available from plain SQL. Put a
`{cache=...}` hint after the reference to the table. You can also build that hint
with a `CamusCacheHint`.

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

A `CamusCacheMetadata` reports the decision of the cache of the server. Its
status is a `Hit`, a `Miss`, a `Bypass`, a `StaleRevalidated`, or an
`EvictedBeforePublish`.

Evict cache families through the connection:

```csharp
await connection.EvictCacheAsync("recent_orders");
await connection.EvictAllCacheAsync();
```

An entry of the cache belongs to the current database. See
[Query Result Cache](/docs/query-result-cache) for the rules of the shape of a
query.

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

## Serializable retries

Serializable is the default level of the isolation in CamusDB. Two serializable
read-write transactions can conflict. CamusDB then aborts one of them. Your
application must replay that whole unit of work, from its start.

The package of the client holds a `SerializableRetryHelper`, for that contract of
a retry. It treats these codes of an error of CamusDB as retryable, and no
other:

| Code | Name | Meaning |
| --- | --- | --- |
| `CADB0502` | `TransactionConflict` | A lock conflict aborted the transaction. |
| `CADB0504` | `TransactionMustRetry` | A transient routing, leader-transition, lock-wait, storage conflict, or temporarily unservable read-range condition exhausted internal retries. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction exceeded the server lifetime cap. |

`CADB0509` `TransactionFinalizeUnresolved` is not part of this helper of a
replay. That absence is intentional.

The code means one thing: a commit or a rollback has no final answer yet. Retry
the same finalize, on the same transaction. Do not replay the operation from its
start.

Use a `SerializableRetryHelper.IsRetryable(...)` when you own the loop of the
retry:

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

For an explicit transaction of several statements, do not retry the failed
statement alone. Start a new transaction. Then run every read and every write of
the unit again:

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

The default backoff of the helper is a bounded exponential delay, with a random
variation. The formula is `min(20 ms * 2^attempt, 400 ms)`, plus or minus 25
percent.

## ADO.NET notes

- The provider can use REST/JSON or gRPC with the same ADO.NET surface. Select
  gRPC with `Protocol=grpc` and point `Endpoint` at the gRPC listener.
- `Cancel()` is cooperative through cancellation tokens.
- Concurrent reads can share a connection session.
- Transaction-scoped commands are pinned to the transaction endpoint, which is
  important when the connection string contains multiple endpoints.

## When to use it

Use the ADO.NET provider when you want:

- full control over SQL text
- direct use of CamusDB-specific SQL features
- lightweight integration without EF Core
- explicit transaction handling

For the use of an ORM at a higher level, see
[EF Core Provider](/docs/ef-core).
