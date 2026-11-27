---
sidebar_position: 7.25
---

# Testcontainers

The CamusDB [Testcontainers](https://testcontainers.com/) packages let you test
queries and application code against a temporary database server. A test starts
a standalone CamusDB server in Docker, and the container is removed when the
test or the fixture ends. This means that you don't need a shared test instance.

Use a container for each test for isolation, or share one through an xUnit
fixture to reduce startup time. Note that tests that share a fixture also share
its data. When tests must be independent, reset the data or use a separate
database for each test class.

## Choose a package

The packages support .NET 8 and later. You need a Docker host that
Testcontainers can find, on your machine or in CI.

| Package | Use |
| --- | --- |
| `CamusDB.Testcontainers` | `CamusDbBuilder` and `CamusDbContainer`, for any test framework. |
| `CamusDB.Testcontainers.Xunit` | `CamusDbFixture` and `CamusDbAdoNetFixture` for xUnit.net v2. |
| `CamusDB.Testcontainers.XunitV3` | The same fixtures for xUnit.net v3. |

Install the fixture package that matches your xUnit version. Both fixture
packages use the namespace `CamusDB.Testcontainers.Xunit`, and they include the
base package as a dependency.

The packages (version 0.17.0) start the server image `camusdb/camusdb:0.15.3` by
default. Newer server images, such as `0.18.5`, are available. To use one, pass
the image to the builder, as shown in [Configure the server](#configure-the-server).

The source and the integration tests are in
[camusdb-testcontainers](https://github.com/camusdb/camusdb-testcontainers).

## Start a test database

```bash
dotnet add package CamusDB.Testcontainers
```

This example creates a `shop` database with a `products` table. It inserts a
product and reads it back with the HTTP helpers of the container.

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

`await using` disposes the container at the end of the scope. `StartAsync`
returns when the server can run statements. By default, it waits until a
`SHOW DATABASES` statement succeeds, or until a login succeeds when
authentication is on.

If you add your own wait strategy, it replaces the default one. Don't use
`/health` alone as the condition. The HTTP listener answers `/health` before
storage is ready.

### HTTP helpers

The container has helpers that send SQL over the HTTP API. They don't need a
driver.

| Method | Purpose |
| --- | --- |
| `CreateDatabaseAsync(name)` | Creates a database if it doesn't exist. It returns no response body. |
| `ExecuteDdlAsync(database, sql)` | Sends a schema change, such as `CREATE TABLE`. |
| `ExecuteNonQueryAsync(database, sql)` | Sends a data change, such as `INSERT`. |
| `ExecuteQueryAsync(database, sql)` | Sends a query. |
| `GetAccessTokenAsync()` | Returns the bearer token. Authentication must be on. |

Use the helper that matches the statement. For example, an `INSERT` sent with
`ExecuteDdlAsync` returns `CADB0407`.

The SQL helpers return the JSON response body as a string. For example, the body
of an `INSERT` has the changed-row count in `rows`. A response with an error
status throws `InvalidOperationException`. The exception message includes the
response body, with the CamusDB error code. Each helper also takes an optional
cancellation token.

For typed results and parameters, use the
[.NET driver](/docs/dotnet-driver) with the connection string of the container.

## Connect with the .NET driver

The packages don't depend on `CamusDB.Client`. Add the driver when you need
parameters or transactions.

```bash
dotnet add package CamusDB.Client
```

This example opens a connection to the `shop` database from the first example,
and it reads the product name.

```csharp
using CamusDB.Client;

await using CamusConnection connection = new(
    new CamusConnectionStringBuilder(database.GetConnectionString("shop")));
await connection.OpenAsync();

await using CamusCommand command = connection.CreateCamusCommand(
    "SELECT name FROM products WHERE id = 1");
string? name = (string?)await command.ExecuteScalarAsync();
```

The container maps the HTTP and gRPC ports to random host ports. Read the
addresses and the connection strings after `StartAsync`, and don't hard-code
host ports.

| Method | Result |
| --- | --- |
| `GetConnectionString()` | An HTTP connection string. It doesn't select a database. |
| `GetConnectionString("shop")` | An HTTP connection string with `Database=shop`. |
| `GetGrpcConnectionString("shop")` | A gRPC connection string with `Protocol=grpc` and `Database=shop`. The database argument is optional. |
| `GetHttpAddress()` | The address of the HTTP API. |
| `GetGrpcAddress()` | The address of the gRPC API, over plaintext HTTP/2. |

The gRPC connection string also sets `BackupEndpoint` to the HTTP address. The
backup commands of the driver use the HTTP API. [Dapper](/docs/dapper) and
[EF Core](/docs/ef-core) use the same connection strings as the driver.

## Share a container with xUnit

The fixture package for xUnit.net v3 is `CamusDB.Testcontainers.XunitV3`, and
the package for v2 is `CamusDB.Testcontainers.Xunit`. The examples in this
section use v3.

```bash
dotnet add package CamusDB.Testcontainers.XunitV3
```

This fixture creates an `inventory` database and adds a row before the first
test.

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
            "SELECT name FROM items WHERE id = 1",
            TestContext.Current.CancellationToken);
        Assert.Contains("bolt", json);
    }
}
```

For xUnit.net v2, change two things in these examples. Import
`Xunit.Abstractions` for `IMessageSink`, and remove the
`TestContext.Current.CancellationToken` argument.

The fixture starts one container for the test class, and it disposes the
container after the last test. Use its `Container` property in the tests.
`HttpAddress` and `GrpcAddress` give the addresses of the two APIs.
`InitializeDatabaseAsync` runs after the container starts. Override it to
create databases and add data.

To share one container across test classes, use an xUnit collection. Each class
with the `[Collection("Inventory")]` attribute gets the same fixture.

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
            "SELECT name FROM items WHERE id = 1",
            TestContext.Current.CancellationToken);
        Assert.Contains("bolt", json);
    }
}
```

### ADO.NET fixture

`CamusDbAdoNetFixture` gives the tests ADO.NET connections and commands. Its
methods, such as `OpenConnectionAsync()` and `CreateCommand(sql)`, come from
the `DbContainerFixture` class of Testcontainers. The fixture creates the
database `DatabaseName` (default `test`) before it calls
`InitializeDatabaseAsync`. `ConnectionString` selects that database over HTTP.

Your fixture supplies the `DbProviderFactory`. This means that your test project
chooses the version of `CamusDB.Client`. `CamusProviderFactory.Instance` is in
`CamusDB.Client` 0.16.1 and later.

```csharp
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;
using CamusDB.Client;
using CamusDB.Testcontainers;
using CamusDB.Testcontainers.Xunit;
using Xunit.Sdk;

public sealed class RobotsFixture(IMessageSink messageSink)
    : CamusDbAdoNetFixture(messageSink)
{
    public override DbProviderFactory DbProviderFactory
        => CamusProviderFactory.Instance;

    protected override async Task InitializeDatabaseAsync(
        CamusDbContainer container, CancellationToken ct)
    {
        await using DbCommand command = CreateCommand(
            "CREATE TABLE robots (id INT64 PRIMARY KEY NOT NULL, name STRING NOT NULL)");
        await command.ExecuteNonQueryAsync(ct);
    }
}
```

To use gRPC, override `ConnectionString` in your fixture with the gRPC
connection string.

```csharp
public override string ConnectionString
    => Container.GetGrpcConnectionString(DatabaseName);
```

## Configure the server

This example selects a newer image and changes three server options.

```csharp
await using CamusDbContainer database = new CamusDbBuilder("camusdb/camusdb:0.18.5")
    .WithMemoryProfile("dev")
    .WithPartitions(1)
    .WithSetting("query_result_cache_enabled", "false")
    .Build();
await database.StartAsync();
```

| Builder option | Behavior |
| --- | --- |
| `new CamusDbBuilder(image)` | Selects the Docker image. The default is `camusdb/camusdb:0.15.3`. |
| `WithMemoryProfile("dev")` | Selects the `dev` [memory profile](/docs/configuration#memory-profile), with about 96 MiB of server caches. It doesn't limit the total memory of the process. |
| `WithPartitions(n)` | Sets the number of [partitions](/docs/concepts#partition). The image default is `4`. |
| `WithSetting(key, value)` | Writes a setting to the `config.yml` file of the container. |
| `WithAuthentication(user, password)` | Turns on authentication, and creates a superuser with these credentials. |

The standard Testcontainers builder options, such as `WithEnvironment`, also
work.

`WithSetting` writes the value to `/etc/camusdb/config.yml` as a raw YAML
scalar. For example, `"false"` becomes a boolean. A key with dots becomes a
nested mapping, as in `.WithSetting("kahuna.backup_dir", "/data/backups")`. A
misspelled key stops the server at startup with `Unknown config option`. For
the keys, see the [settings reference](/docs/settings-reference).

The command line of the image sets the HTTP port and the data directory. It
also sets the partition count from `WithPartitions`. A `WithSetting` value for
one of these settings has no effect.

### Authentication

```csharp
await using CamusDbContainer database = new CamusDbBuilder()
    .WithAuthentication("admin", "test-password")
    .Build();
await database.StartAsync();
```

The module generates a random key to sign access tokens. The HTTP helpers log
in with the superuser credentials, and they get a new token about 30 seconds
before the current one expires. `GetAccessTokenAsync()` returns the current
token. With authentication off, it throws `InvalidOperationException`.

The connection strings include `User` and `Password`, with
`AllowInsecureCredentials=true`. The module also sets
`require_tls_when_auth_enabled: false`. These two settings let the test host
log in over the plaintext connection to the container. They don't set up TLS.
