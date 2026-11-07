---
sidebar_position: 7.3
---

# .NET Aspire

The CamusDB [Aspire](https://aspire.dev/) integrations let you run a database alongside your services
and pass its connection details through the application model. The AppHost
starts a standalone container or a local CamusDB cluster and creates the
databases you declare.
Service integrations register the .NET driver or EF Core context, with health
checks, tracing, and metrics.

Use these packages to give your local application a repeatable database setup
without manually coordinating ports, connection strings, and startup order.
Source, tests, and runnable standalone and cluster examples are in
[camusdb-aspire](https://github.com/camusdb/camusdb-aspire).

## Choose a package

| Package | Install in | Purpose | Target frameworks |
| --- | --- | --- | --- |
| `CamusDB.Aspire.Hosting` | AppHost | Runs a standalone server or cluster, creates databases, and supplies connection strings. | .NET 8 |
| `CamusDB.Aspire.Client` | Service | Registers ADO.NET connections, health checks, and driver telemetry. | .NET 8, 9, 10 |
| `CamusDB.Aspire.EntityFrameworkCore` | Service | Registers a pooled EF Core context with retries, health checks, and telemetry. | .NET 10 |

The repository uses Aspire 13.6.4 and CamusDB client libraries 0.17.2. Its
AppHost example needs the .NET 10 SDK and a container runtime. The hosting
package defaults to server image `docker.io/camusdb/camusdb:0.17.0`; select
another image tag when your application needs a different server version.

## Add CamusDB to the AppHost

Install in your AppHost project:

```bash
dotnet add package CamusDB.Aspire.Hosting
```

In `AppHost.cs`, declare the server and database, then reference the database
from your service:

```csharp
using Aspire.Hosting;

var builder = DistributedApplication.CreateBuilder(args);

var camus = builder.AddCamusDB("camus")
    .WithDataVolume();
var appDb = camus.AddDatabase("appdb");

builder.AddProject<Projects.ApiService>("api")
    .WithReference(appDb)
    .WaitFor(appDb);

builder.Build().Run();
```

Replace `Projects.ApiService` with the generated project type for your service.
`WithDataVolume()` keeps database files in a named volume across container
recreation. Omit it for a disposable container, or use
`WithDataBindMount(path)` to store data in a host folder.

For a standalone server, the AppHost checks the HTTP `/health` endpoint, then
creates each `AddDatabase` database if it does not exist. A database resource becomes
healthy only after creation succeeds. `WaitFor(appDb)` therefore waits for the
database, while `WithReference(appDb)` supplies the service's connection string.

```mermaid
flowchart TD
    A["AppHost starts CamusDB"] --> H["Server HTTP health check passes"]
    H --> D["Create database if it does not exist"]
    D --> R["Database resource becomes healthy"]
    R --> S["Start service waiting for the database"]
    D -.-> C["Database connection string"]
    C -.-> S
```

This creates the database, not application tables or migrations. Manage those
through your application or migration workflow.

## Run a local cluster

Use `AddCamusDBCluster` to develop against replication and try node failures
without configuring peers or exporting certificates yourself. It defaults to
three nodes. Replace the standalone resource in your AppHost with:

```csharp
var camus = builder.AddCamusDBCluster("camus", nodes: 3)
    .WithDataVolume();
var appDb = camus.AddDatabase("appdb");

builder.AddProject<Projects.ApiService>("api")
    .WithReference(appDb)
    .WaitFor(appDb);
```

The dashboard shows a cluster resource and three containers: `camus-1`,
`camus-2`, and `camus-3`. Each node gets its own data volume. Alternatively,
`WithDataBindMount(path)` uses a subfolder per node, such as `path/camus-1`.
The AppHost generates a cluster CA and node certificates on each run; Raft
uses TLS on the container network, without publishing its port to the host.
Client HTTP and gRPC endpoints remain plaintext, so this setup is for local
development. Stopping your machine stops every node.

### Readiness and connections

Each node checks `/v1/cluster/health`. On first startup, all nodes must be
healthy before the AppHost creates databases and releases services waiting
for them. After startup, the cluster resource stays healthy while a majority
is healthy, allowing dependent services to restart with one of three nodes
down. The health description reports the count. Without a majority it is
unhealthy; after all nodes stop, startup again requires every node.

A database connection string lists every node's endpoint. The .NET client
rotates requests across the pool and skips an unreachable node for 30 seconds.
The request that discovers the failure can still fail; endpoint rotation does
not replay it. Follow the [driver's retry rules](/docs/dotnet-driver) for your
operation. With gRPC, `BackupEndpoint` points to the first node's HTTP endpoint.

`WithProtocol(CamusDBProtocol.Grpc)` and `WithAuthentication()` also work on
clusters. Authentication shares the token key and node secret across nodes
and enables mutual TLS between Raft peers. Cluster connection properties
provide endpoint lists in `Uri` and `GrpcUri`, plus `Database` for a database
resource; there is no single `Host`, `Port`, or `GrpcPort`.

### Configure every node

Apply common image or environment settings through `ConfigureNodes`:

```csharp
builder.AddCamusDBCluster("camus", nodes: 3)
    .ConfigureNodes(node => node
        .WithImageTag("0.17.0")
        .WithEnvironment("CAMUS_INITIAL_PARTITIONS", "8"));
```

Keep the image and settings consistent across nodes. Nodes default to the
`dev` memory profile. Prefer an odd node count: three tolerate one unavailable
node, and five tolerate two. `nodes: 1` runs in cluster mode but offers no
redundancy; see [growing a one-node cluster](/docs/growing-a-one-node-cluster).

## Register the ADO.NET client

Install in the service project:

```bash
dotnet add package CamusDB.Aspire.Client
```

Register the same connection name used by `AddDatabase`:

```csharp
using CamusDB.Client;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);
builder.AddCamusDBClient("appdb");

var app = builder.Build();

app.MapGet("/database-status", async (CamusConnection connection) =>
{
    await connection.OpenAsync();
    await using CamusCommand command = connection.CreateCamusCommand(
        "SELECT 'ready' AS status");
    return (string?)await command.ExecuteScalarAsync();
});

app.Run();
```

The integration registers a singleton `CamusConnectionStringBuilder` that
shares endpoint health and access-token state, and a transient
`CamusConnection`. Open injected connections before running commands. See the
[.NET driver](/docs/dotnet-driver) for parameters, transactions, and readers.

### Multiple databases

Reference each database resource from the service in the AppHost, then use
keyed registrations to choose a connection explicitly:

```csharp
builder.AddKeyedCamusDBClient("orders");
builder.AddKeyedCamusDBClient("users");
```

For example, resolve the orders connection in an endpoint with
`[FromKeyedServices("orders")] CamusConnection connection`, importing
`Microsoft.Extensions.DependencyInjection` for the attribute.

## Register an EF Core context

Install in the service project:

```bash
dotnet add package CamusDB.Aspire.EntityFrameworkCore
```

Register your context instead of the ADO.NET client when the service uses EF
Core:

```csharp
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);
builder.AddCamusDBDbContext<AppDbContext>("appdb");

var app = builder.Build();
app.Run();

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : DbContext(options)
{
}
```

The integration calls `AddDbContextPool` and `UseCamusDB`. Your context must
accept `DbContextOptions<AppDbContext>` in its constructor. Transient-failure
retries are enabled through `EnableRetryOnFailure()` by default. To customize
registration, pass `configureSettings` or `configureDbContextOptions`:

```csharp
builder.AddCamusDBDbContext<AppDbContext>("appdb",
    configureSettings: settings => settings.DisableRetry = true);
```

See the [EF Core provider](/docs/ef-core) for entity mapping, migrations, and
transaction behavior.

## Connection strings and protocols

The AppHost exposes `http` on container port 5095 and `grpc` on 5096. Host ports
are assigned dynamically unless passed as `httpPort` and `grpcPort` to
`AddCamusDB`.

Reference a **database resource**, such as `appDb`, when opening a driver
connection. A server resource's connection string has no `Database` key,
which `CamusConnection` requires.

HTTP is the default. To use gRPC, configure the server before building the
application:

```csharp
using Aspire.Hosting.ApplicationModel;

var camus = builder.AddCamusDB("camus")
    .WithProtocol(CamusDBProtocol.Grpc);
var appDb = camus.AddDatabase("appdb");
```

The generated connection string selects the gRPC endpoint, sets
`Protocol=grpc`, and includes the HTTP endpoint as `BackupEndpoint` for REST
backup administration. The gRPC endpoint uses plaintext HTTP/2.

Standalone resources also expose connection properties such as `Host`,
`Port`, `GrpcPort`, `Uri`, `GrpcUri`, and `Database` as environment variables
(for example, `APPDB_HOST`). Authentication adds `Username` and `Password`.

## Authentication and server options

Authentication is off by default. Enable it with a secret parameter:

```csharp
var password = builder.AddParameter("camus-password", secret: true);
var camus = builder.AddCamusDB("camus")
    .WithAuthentication(password: password)
    .WithDataVolume();
```

The default bootstrap user is `admin`. Calling `WithAuthentication()` without
a password parameter generates a password. The integration also generates the
access-token signing key and includes credentials in connection strings.

This authentication setup is for local development: the container serves
plaintext HTTP, starts with `--require-tls-when-auth-enabled=false`, and supplies
`AllowInsecureCredentials=true` to clients. The password must not contain a
single quote (`'`).

Bootstrap credentials apply only when the server's user catalog is empty.
Changing the password parameter does not change an existing account in a
persisted data volume; manage that account through
[SQL authentication](/docs/sql-authentication).

Standard Aspire container options let you select an image tag and set server
environment variables:

```csharp
builder.AddCamusDB("camus")
    .WithImageTag("0.17.0")
    .WithEnvironment("CAMUS_LOG_LEVEL", "Debug")
    .WithEnvironment("CAMUS_INITIAL_PARTITIONS", "8");
```

## Client configuration and observability

Both service integrations read `ConnectionStrings:{connectionName}`, normally
supplied by `WithReference`. You can also set a `ConnectionString` in their
settings sections to run a service without the AppHost.

Settings apply in this order, with later values taking precedence:

1. Shared section: `Aspire:CamusDB:Client` or
   `Aspire:CamusDB:EntityFrameworkCore`.
2. Named section: `Aspire:CamusDB:Client:{name}` for a keyed client, or
   `Aspire:CamusDB:EntityFrameworkCore:{context type name}` for EF Core.
3. `ConnectionStrings:{connectionName}` for the connection string.
4. The `configureSettings` callback.

For example, to disable tracing for the client integration:

```json
{
  "Aspire": {
    "CamusDB": {
      "Client": {
        "DisableTracing": true
      }
    }
  }
}
```

All disable flags default to `false`:

| Setting | Enabled behavior |
| --- | --- |
| `DisableHealthChecks` | Client: server ping named `CamusDB` or `CamusDB_{name}`. EF Core: `CanConnectAsync` check named after the context type. |
| `DisableTracing` | Registers the `CamusDB.Client` activity source. |
| `DisableMetrics` | Registers the `CamusDB.Client` meter; EF Core also registers `Microsoft.EntityFrameworkCore`. |
| `DisableRetry` | EF Core only: enables provider retries for transient failures. |

Configure health endpoints and OpenTelemetry exporters in your service,
usually through Aspire service defaults. Registering the integration does not
itself expose a health endpoint or configure an exporter.

## Run the sample application

The repository's `playground` directory includes an AppHost and a minimal API
with `GET /todos` and `POST /todos`:

```bash
git clone https://github.com/camusdb/camusdb-aspire.git
cd camusdb-aspire
dotnet run --project playground/CamusDB.AppHost
```

The playground accepts `Playground:Authentication`, `Playground:Grpc`,
`Playground:Ephemeral` (omit data volumes), and `Playground:ClusterNodes`.
The node count defaults to 0 for standalone mode; set it to 3 for a cluster:

```bash
dotnet run --project playground/CamusDB.AppHost -- --Playground:Authentication=true
dotnet run --project playground/CamusDB.AppHost -- --Playground:ClusterNodes=3
```

### Try the three-node Notes example

The repository also includes a
[cluster example](https://github.com/camusdb/camusdb-aspire/tree/main/examples/ClusterExample)
with a page that adds notes and reads the note count through each node.
With Docker and the .NET 10 SDK installed, run this from the repository root:

```bash
dotnet run --project examples/ClusterExample/ClusterExample.AppHost
```

In the Aspire dashboard, wait for healthy resources and open the API's
**Notes** URL. Stop `camus-3`, reload the page, and add a note: two nodes still
form a majority. Restart the node to watch it catch up. Stopping a second
node removes the majority, making the cluster unhealthy.

The example keeps data in three volumes across runs. Stop the AppHost and
wait for its containers to exit before running it again, so two containers
do not try to open the same node's data.
