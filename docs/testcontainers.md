---
sidebar_position: 7.25
---

# Testcontainers

Test CamusDB queries and application code against a temporary database server
without maintaining a shared test instance. The CamusDB [Testcontainers](https://testcontainers.com/) packages
start a standalone server in Docker, wait for it to be ready, and let you remove
it when the test or fixture ends.

Use a container per test for isolation, or share one through an xUnit fixture
to reduce startup time. Shared fixtures also share database state; reset data
or use separate databases when tests must be independent.

## Choose a package

All three packages target .NET 8, .NET 9, and .NET 10. You need a running Docker
host that Testcontainers can discover, locally or in CI.

| Package | Use |
| --- | --- |
| `CamusDB.Testcontainers` | `CamusDbBuilder` and `CamusDbContainer`, usable with any test framework. |
| `CamusDB.Testcontainers.Xunit` | `CamusDbFixture` and `CamusDbAdoNetFixture` for xUnit.net v2. |
| `CamusDB.Testcontainers.XunitV3` | The same fixtures for xUnit.net v3. |

Install the fixture package that matches your xUnit version. Both fixture
packages use the namespace `CamusDB.Testcontainers.Xunit` and include the base
module as a dependency.

Source and integration tests are in
[camusdb-testcontainers](https://github.com/camusdb/camusdb-testcontainers).

## Start a test database

```bash
dotnet add package CamusDB.Testcontainers
```

This example creates a database, inserts a product, and queries it through the
container's HTTP helpers:

```csharp
using CamusDB.Testcontainers;

await using CamusDbContainer database = new CamusDbBuilder().Build();
await database.StartAsync();

await database.CreateDatabaseAsync("shop");
await database.ExecuteDdlAsync("shop",
    "CREATE TABLE products (id INT64 PRIMARY KEY NOT NULL, name STRING NOT NULL)");
await database.ExecuteNonQueryAsync("shop",
    "INSERT INTO products (id, name) VALUES (1, 'kettle')");

string json = await database.ExecuteQueryAsync("shop",
    "SELECT name FROM products WHERE id = 1");
```

`await using` disposes the container at the end of the scope. With the default
wait strategy, `StartAsync` waits for a successful `SHOW DATABASES`, or a login
when authentication is enabled. Checking `/health` alone is insufficient:
the HTTP listener starts before storage is ready.

## Connect with the .NET driver

The module does not depend on `CamusDB.Client`. Add the driver separately when
you want typed results, parameters, or transactions:

```bash
dotnet add package CamusDB.Client
```

After starting the container and creating `shop`, open a connection:

```csharp
using CamusDB.Client;

await using CamusConnection connection = new(
    new CamusConnectionStringBuilder(database.GetConnectionString("shop")));
await connection.OpenAsync();

await using CamusCommand command = connection.CreateCamusCommand(
    "SELECT name FROM products WHERE id = 1");
string? name = (string?)await command.ExecuteScalarAsync();
```

The container maps the HTTP and gRPC ports to random host ports. Read addresses
and connection strings **after** `StartAsync`; do not hard-code host ports.

| Method | Result |
| --- | --- |
| `GetConnectionString()` | HTTP connection string without a database. |
| `GetConnectionString("shop")` | HTTP connection string with `Database=shop`. |
| `GetGrpcConnectionString("shop")` | gRPC connection string with `Protocol=grpc`, the database, and an HTTP `BackupEndpoint`. The database argument is optional. |
| `GetHttpAddress()` | HTTP API address. |
| `GetGrpcAddress()` | gRPC address using plaintext HTTP/2. |

The gRPC string includes `BackupEndpoint` because backup administration uses
the REST API. [Dapper](/docs/dapper) and [EF Core](/docs/ef-core) use the same
driver connection strings; the module repository's transport tests exercise
`CamusDB.Client` directly.

## Configure the server

```csharp
await using CamusDbContainer database = new CamusDbBuilder()
    .WithMemoryProfile("dev")
    .WithPartitions(1)
    .WithSetting("query_result_cache_enabled", "false")
    .Build();
await database.StartAsync();
```

| Builder option | Behavior |
| --- | --- |
| `new CamusDbBuilder(image)` | Selects a Docker image. The module's default is pinned to `camusdb/camusdb:0.15.3`. |
| `WithMemoryProfile("dev")` | Sets the development profile, with approximately 96 MiB of server caches; this is not a limit on total process memory. |
| `WithPartitions(n)` | Sets the number of Raft partitions, the server's data partitions. The image default is 4. |
| `WithSetting(key, value)` | Writes a setting to the container's `config.yml`. |
| `WithAuthentication(user, password)` | Enables authentication and seeds a bootstrap superuser. |

Choose an image version that supports the features under test. Standard
Testcontainers builder options, such as `WithEnvironment`, are also available.

`WithSetting` writes raw YAML scalar values to `/etc/camusdb/config.yml` and
sets `CAMUS_CONFIG_PATH`. Dotted keys produce nested mappings, for example
`.WithSetting("kahuna.backup_dir", "/data/backups")`. The image's command line
overrides the configured HTTP port, data directory, and partition count;
use `WithPartitions` for the latter. See [configuration](/docs/configuration)
for server settings.

### Authentication

```csharp
await using CamusDbContainer database = new CamusDbBuilder()
    .WithAuthentication("admin", "test-password")
    .Build();
await database.StartAsync();
```

The module generates a random access-token signing key. HTTP helpers log in
with the bootstrap credentials and renew the cached token shortly before it
expires. `GetAccessTokenAsync()` exposes that token when authentication is on.

Connection strings include `User`, `Password`, and
`AllowInsecureCredentials=true`. The module also sets
`require_tls_when_auth_enabled: false` so the test host can authenticate over
Docker's plaintext connection. These settings support the test environment;
they do not configure TLS.

## Share a container with xUnit

For xUnit.net v3:

```bash
dotnet add package CamusDB.Testcontainers.XunitV3
```

For xUnit.net v2, install `CamusDB.Testcontainers.Xunit` instead. This v3 example
seeds inventory data before the first test:

```csharp
using System.Threading;
using System.Threading.Tasks;
using CamusDB.Testcontainers;
using CamusDB.Testcontainers.Xunit;
using Xunit;
using Xunit.Sdk;

public sealed class InventoryFixture(IMessageSink messageSink)
    : CamusDbFixture(messageSink)
{
    protected override CamusDbBuilder Configure()
        => new CamusDbBuilder().WithMemoryProfile("dev");

    protected override async Task InitializeDatabaseAsync(
        CamusDbContainer container, CancellationToken ct)
    {
        await container.CreateDatabaseAsync("inventory", ct);
        await container.ExecuteDdlAsync("inventory",
            "CREATE TABLE items (id INT64 PRIMARY KEY NOT NULL, name STRING NOT NULL)", ct);
        await container.ExecuteNonQueryAsync("inventory",
            "INSERT INTO items (id, name) VALUES (1, 'bolt')", ct);
    }
}

public sealed class InventoryTests(InventoryFixture fixture)
    : IClassFixture<InventoryFixture>
{
    [Fact]
    public async Task ReadsSeededItem()
    {
        string json = await fixture.Container.ExecuteQueryAsync("inventory",
            "SELECT name FROM items WHERE id = 1");
        Assert.Contains("bolt", json);
    }
}
```

For v2, import `Xunit.Abstractions` for `IMessageSink` instead of `Xunit.Sdk`.
The fixture starts one container for the class and disposes it after the tests.
It exposes `Container`, `HttpAddress`, and `GrpcAddress`. Override
`InitializeDatabaseAsync` to create databases and seed data after startup.

To share the fixture across classes, declare a collection in your test project
and annotate each participating class:

```csharp
[CollectionDefinition("Inventory")]
public sealed class InventoryCollection : ICollectionFixture<InventoryFixture>
{
}

[Collection("Inventory")]
public sealed class OrderTests(InventoryFixture fixture)
{
    [Fact]
    public async Task CanReadInventory()
    {
        string json = await fixture.Container.ExecuteQueryAsync("inventory",
            "SELECT name FROM items WHERE id = 1");
        Assert.Contains("bolt", json);
    }
}
```

### ADO.NET fixture

`CamusDbAdoNetFixture` provides `OpenConnectionAsync()`, `CreateConnection()`,
and `CreateCommand(sql)` through Testcontainers' `DbContainerFixture`. Your
derived fixture must supply a `DbProviderFactory`; the package leaves the
client version to your test project.

`CamusProviderFactory` is absent from `CamusDB.Client` 0.16.0. Use a client
version that provides it, or supply a compatible factory yourself. You can use
`CamusDbFixture` with manually opened `CamusConnection` instances without that
factory.

The ADO.NET fixture creates `DatabaseName` (default `test`) before calling
`InitializeDatabaseAsync`. Its connection string selects that database over
HTTP. To use gRPC, override:

```csharp
public override string ConnectionString
    => Container.GetGrpcConnectionString(DatabaseName);
```

## HTTP helpers

Helpers accept an optional cancellation token. SQL execution helpers return
the JSON response body, rather than typed rows or a changed-row count. A
non-2xx HTTP response throws `InvalidOperationException`.

| Method | Purpose |
| --- | --- |
| `CreateDatabaseAsync(name)` | Creates a database if it does not exist; returns no response body. |
| `ExecuteDdlAsync(database, sql)` | Runs schema DDL. |
| `ExecuteNonQueryAsync(database, sql)` | Runs `INSERT`, `UPDATE`, or `DELETE`. |
| `ExecuteQueryAsync(database, sql)` | Runs a query. |
| `GetAccessTokenAsync()` | Returns the cached or renewed bearer token; requires authentication. |

For typed assertions and parameterized SQL, use the
[.NET driver](/docs/dotnet-driver) with the container's connection string.
