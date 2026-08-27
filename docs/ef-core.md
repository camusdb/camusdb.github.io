---
sidebar_position: 7.2
---

# EF Core provider

CamusDB also ships a provider for Entity Framework Core. That provider sits on
the driver of ADO.NET. The name of the package is
`CamusDB.EntityFrameworkCore`.

It targets `net10.0`. It depends on the relational APIs of EF Core 10.

## Install

```bash
dotnet add package CamusDB.EntityFrameworkCore
```

## Configure the provider

Register the provider with `UseCamusDB(...)`:

```csharp
using CamusDB.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb;Timeout=30")
    .Options;
```

The connection string accepts the same keys as the driver of ADO.NET. Common
examples are `Protocol=grpc`, `User`, `Password`, `AccessToken`,
`MaxAutoPrepare`, `AutoPrepareMinUsages`, `IsolationLevel`, `Locking`,
`TransactionMode`, `ChannelPoolSize`, `CoalescingThreshold`, and
`CoalescingDelay`.

See [.NET Driver](/docs/dotnet-driver#connection-string) for the full reference
of a connection string. See
[.NET Driver Authentication](/docs/dotnet-driver#authentication) for a connection
with an authentication.

You can also configure it in `OnConfiguring`:

```csharp
public sealed class AppDbContext : DbContext
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder.UseCamusDB(
            "Endpoint=http://localhost:5095;Database=mydb");
}
```

## Reuse an existing connection

Pass the connection directly in two cases: you want to share a
`CamusConnection`, and you want to manage a transaction outside the context:

```csharp
CamusConnection connection = new(
    new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=mydb"));

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(connection)
    .Options;
```

You can pass an existing connection. The `DbContext` then does not own that
connection. It also disposes nothing.

## Define a model

Map an object id of a primary key with the store type `"id"`, or `"oid"`. Mark
that property as generated at an add, when the client must create the
ObjectId:

```csharp
public sealed class Robot
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public int Year { get; set; }
    public double Price { get; set; }
    public bool Enabled { get; set; }
}

public sealed class AppDbContext : DbContext
{
    public DbSet<Robot> Robots => Set<Robot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Robot>(b =>
        {
            b.ToTable("robots");
            b.HasKey(e => e.Id);

            b.Property(e => e.Id)
                .HasColumnType("id")
                .ValueGeneratedOnAdd();

            b.Property(e => e.Name).HasColumnType("string");
            b.Property(e => e.Kind).HasColumnType("string");
            b.Property(e => e.Year).HasColumnType("int64");
            b.Property(e => e.Price).HasColumnType("float64");
            b.Property(e => e.Enabled).HasColumnType("bool");
        });
    }
}
```

For a primary key of a string, with a map to `"id"` or to `"oid"`, the provider
creates a Camus ObjectId of 24 characters. It creates that id on the client.

Use a `ToTable(t => t.HasCheckConstraint(...))` for a check constraint that the
server enforces:

```csharp
modelBuilder.Entity<Robot>(b =>
{
    b.ToTable("robots", t =>
        t.HasCheckConstraint("ck_robots_price", "price >= 0"));
});
```

A check constraint can reject a row. That rejection appears as a
`DbUpdateException`. Its inner `CamusException` carries the code `CADB0303`.

## Type mapping

Supported CLR-to-store mappings:

| CLR type | Camus store type | DDL type |
| --- | --- | --- |
| `string` key | `id` or `oid` | `OID` |
| `Guid` key | `id` or `oid` | `OID` |
| `Guid` with `HasColumnType("uuid")` | `uuid` or `guid` | `UUID` |
| `string` | `string` | `STRING` |
| `string` with `HasMaxLength(n)` | `string` | `STRING(n)` |
| `bool` | `bool` | `BOOL` |
| `short`, `int`, `long` | `int64` | `INT64` |
| `float` | `float32` or `real` | `FLOAT32` |
| `double` | `float64` | `FLOAT64` |
| `byte[]` | `bytes` or `blob` | `BYTES` |
| `DateOnly` | `date` | `DATE` |
| `DateTime`, `DateTimeOffset` | `datetime` or `timestamp` | `DATETIME` |
| `long[]`, `string[]`, `double[]`, `bool[]` | `array(int64)`, `array(string)`, `array(float64)`, `array(bool)` | `ARRAY(T)` |

Practical rule:

- use `HasColumnType("id")` for CamusDB ObjectId primary keys
- use `HasColumnType("uuid")` for native UUID columns
- use `HasColumnType("string")`, `HasColumnType("int64")`,
  `HasColumnType("float32")`, `HasColumnType("float64")`,
  `HasColumnType("bytes")`, `HasColumnType("date")`,
  `HasColumnType("datetime")`, and `HasColumnType("bool")` for regular columns

A plain `Guid` property takes the map to `id` and `OID`, by default. That
default keeps the compatibility with an earlier version.

For a value of a UUID of your application, map the property explicitly as a
`uuid`:

```csharp
b.Property(e => e.ExternalRef).HasColumnType("uuid");
```

The provider normalizes a `DateTime` value, and a `DateTimeOffset` value, to
UTC. A `DateOnly` maps to a calendar date.

`long[]`, `string[]`, `double[]`, and `bool[]` properties map to native
`ARRAY(T)` columns. Arrays are read and written as whole values. They are not
indexable, have no inline SQL literal, and cannot be used in a LINQ predicate.

A vector embedding is stored as a `byte[]` in a `bytes` column. Use
`CamusVector.ToBytes(...)` from the ADO.NET package to pack a `float[]`, and use
the vector functions described below to rank rows.

## Create tables

`EnsureCreated()` is supported and idempotent:

```csharp
await using var ctx = new AppDbContext(options);
await ctx.Database.EnsureCreatedAsync();
```

An `EnsureCreated()` creates the database, with an `IF NOT EXISTS`. It then
creates the tables of the model. It continues safely when the database exists
already, and when the tables exist already.

An `EnsureDeleted()` drops the database of the connection string:

```csharp
await ctx.Database.EnsureDeletedAsync();
```

## Basic CRUD

### Insert

```csharp
await using var ctx = new AppDbContext(options);

ctx.Robots.Add(new Robot
{
    Name = "T-800",
    Kind = "cyborg",
    Year = 1984,
    Price = 10.0,
    Enabled = true
});

await ctx.SaveChangesAsync();
```

### Query

```csharp
await using var ctx = new AppDbContext(options);

Robot? robot = await ctx.Robots.FindAsync(id);

List<Robot> active = await ctx.Robots
    .Where(r => r.Enabled && r.Year > 1980)
    .ToListAsync();
```

## LINQ translation

The provider translates common relational query shapes to CamusDB SQL:

- `Where`
- `OrderBy` / `ThenBy`
- `Skip` / `Take`
- `Distinct`
- scalar aggregates: `Count`, `Sum`, `Average`, `Min`, `Max`, `Any`
- `GroupBy` with aggregates
- inner `join`
- correlated subqueries, such as `Where(o => o.Items.Any(...))`

Parameterized collection checks such as `ids.Contains(e.Id)` expand to
`IN (@p0, @p1, ...)`, which works with CamusDB's SQL dialect.

String operations run on the server when they map to CamusDB functions:

| LINQ | SQL function or predicate |
| --- | --- |
| `s.StartsWith(x)` | `starts_with(s, x)` |
| `s.EndsWith(x)` | `ends_with(s, x)` |
| `s.Contains(x)` | `contains(s, x)` |
| `s.ToUpper()` / `s.ToLower()` | `upper(s)` / `lower(s)` |
| `s.Trim()` / `s.TrimStart()` / `s.TrimEnd()` | `trim(s)` / `ltrim(s)` / `rtrim(s)` |
| `s.Replace(a, b)` | `replace(s, a, b)` |
| `s.Length` | `length(s)` |

`string.Compare(...)` and `a.CompareTo(b)` translate when the expression is
tested against zero. This is useful for keyset pagination:

```csharp
List<Item> page = await ctx.Items
    .Where(i => i.Seq > cursorSeq ||
        (i.Seq == cursorSeq &&
         string.Compare(i.Code, cursorCode, StringComparison.Ordinal) > 0))
    .OrderBy(i => i.Seq)
    .ThenBy(i => i.Code)
    .Take(100)
    .ToListAsync();
```

Regular expression helpers map to CamusDB's regex functions:

```csharp
using System.Text.RegularExpressions;

List<Person> people = await ctx.People
    .Where(p => Regex.IsMatch(p.Email, "^[^@]+@[^@]+\\.[a-z]+$",
        RegexOptions.IgnoreCase))
    .Where(p => EF.Functions.RegexpLike(p.Name, "^[A-Z]"))
    .ToListAsync();
```

Supported regex helpers include `Regex.IsMatch`, `Regex.Replace`,
`EF.Functions.RegexpLike`, `RegexpReplace`, `RegexpCount`, `RegexpSubstr`, and
`RegexpInstr`.

## Vector queries

Use a `byte[]` property for an embedding column. Pack the vector with
`CamusVector.ToBytes(...)`, and add a server-side dimension check:

```csharp
modelBuilder.Entity<Document>(b =>
{
    b.ToTable("documents", t =>
        t.HasCheckConstraint("ck_documents_embedding_768d",
            "vector_dims(embedding) = 768"));

    b.Property(d => d.Embedding).HasColumnType("bytes");
});
```

Rank rows with `EF.Functions` vector helpers:

```csharp
byte[] query = CamusVector.ToBytes(await EmbedAsync("warehouse safety"));

List<Document> nearest = await ctx.Documents
    .Where(d => d.Kind == "manual")
    .OrderBy(d => EF.Functions.L2Distance(d.Embedding, query))
    .Take(10)
    .ToListAsync();
```

Available helpers:

| Helper | SQL function | Best order |
| --- | --- | --- |
| `EF.Functions.L2Distance(a, b)` | `l2_distance(a, b)` | ascending |
| `EF.Functions.CosineDistance(a, b)` | `cosine_distance(a, b)` | ascending |
| `EF.Functions.InnerProduct(a, b)` | `inner_product(a, b)` | descending |
| `EF.Functions.VectorDims(v)` | `vector_dims(v)` | not a ranking metric |
| `EF.Functions.OctetLength(v)` | `octet_length(v)` | not a ranking metric |

Vector ranking is exact. Pair an `OrderBy` over a distance with `Take(k)` so the
server can plan it as a bounded top-k query. See [Vector Search](/docs/vector-search).

### Update

```csharp
await using var ctx = new AppDbContext(options);

Robot robot = await ctx.Robots.FindAsync(id)
    ?? throw new InvalidOperationException("Not found");

robot.Price = 99.0;
await ctx.SaveChangesAsync();
```

### Delete

```csharp
await using var ctx = new AppDbContext(options);

Robot robot = await ctx.Robots.FindAsync(id)
    ?? throw new InvalidOperationException("Not found");

ctx.Robots.Remove(robot);
await ctx.SaveChangesAsync();
```

## Transactions

The provider supports EF Core transactions:

```csharp
await using var ctx = new AppDbContext(options);
await using var tx = await ctx.Database.BeginTransactionAsync();

ctx.Robots.Add(new Robot { Name = "R2-D2", Kind = "mechanical", Year = 1977 });
await ctx.SaveChangesAsync();

await tx.CommitAsync();
```

With a pool of endpoints, a command inside a transaction stays on the same node.
It stays there for the whole life of that transaction.

## Transaction defaults

Serializable isolation is the server default. You can set default transaction
options for a context with provider options:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.UseTransactionDefaults(new CamusTransactionOptions
        {
            IsolationLevel = CamusIsolationLevel.Serializable,
            Mode = CamusTransactionMode.ReadWrite,
            Locking = CamusLocking.Optimistic,
        });
    })
    .Options;
```

For the common optimistic-locking selection, use the shortcut:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.UseOptimisticLocking();
        camus.EnableRetryOnFailure();
    })
    .Options;
```

`UsePessimisticLocking()` selects the pessimistic mode explicitly. Any option
left unset falls back to the connection string and then to the server default.

## Retry on serializable conflicts

Serializable is the default level of the isolation of CamusDB. A
`SaveChangesAsync()`, and a `CommitTransactionAsync()`, can therefore fail. A
concurrent transaction wins a conflict of the serialization.

Enable EF Core's execution strategy with `EnableRetryOnFailure()`:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.EnableRetryOnFailure();
    })
    .Options;
```

The strategy retries the retryable errors of a transaction of CamusDB only:

- `CADB0502` `TransactionConflict`
- `CADB0504` `TransactionMustRetry`
- `CADB0505` `TransactionLifetimeExceeded`

`CADB0509` `TransactionFinalizeUnresolved` is not a signal for a replay from the
start. The code can appear during the finalize of a transaction. Retry the same
commit, or the same rollback, for the same id of the transaction. Do not run the
unit of work again.

Default retry settings:

| Parameter | Default | Description |
| --- | --- | --- |
| `maxRetryCount` | `15` | Maximum retry attempts. |
| `maxRetryDelay` | `1 s` | Maximum delay between retries. |
| `retryDeadline` | `5 s` | Wall-clock deadline from first failure. |
| `medianFirstRetryDelay` | `30 ms` | Median first retry delay. |

You can override them:

```csharp
camus.EnableRetryOnFailure(
    maxRetryCount: 5,
    maxRetryDelay: TimeSpan.FromMilliseconds(500),
    retryDeadline: TimeSpan.FromSeconds(3),
    medianFirstRetryDelay: TimeSpan.FromMilliseconds(20));
```

The strategy of the execution retries the whole operation of EF. You can manage
an explicit transaction by hand. Replay that whole transaction from its start.
Do not retry the failed statement alone.

## Prepared statements

The driver of ADO.NET below prepares a query of EF Core automatically. It also
prepares a statement of a `SaveChangesAsync()`. The same shape of SQL must
execute enough times first.

You need no configuration specific to EF. You also need no call of a `Prepare()`
by hand.

That behavior suits EF. A query of LINQ, and a write from the tracking of the
changes, both usually produce deterministic SQL with parameters, for one
operation.

A prepared execution keeps the behavior of an inline execution. That includes the
transaction, the Serializable isolation, the retries, and the result cache of a
query.

Tune the policy with the ordinary keys of the connection string:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(
        "Endpoint=http://localhost:5095;Database=mydb;MaxAutoPrepare=256;AutoPrepareMinUsages=2")
    .Options;
```

Set `MaxAutoPrepare=0` to disable automatic preparation.

See [.NET Driver](/docs/dotnet-driver#prepared-statements) and
[Prepared Statements](/docs/prepared-statements) for the full behavior.

## Query result cache

Use a `WithCache(...)` to opt a query of LINQ into the result cache of a query of
CamusDB. The provider then puts the `{cache=...}` hint into the generated SQL.

```csharp
using CamusDB.EntityFrameworkCore;

List<Order> recent = await ctx.Orders
    .Where(o => o.Status == 1)
    .OrderByDescending(o => o.Total)
    .Take(20)
    .WithCache("recent_orders", ttl: TimeSpan.FromSeconds(30), strict: true)
    .ToListAsync();
```

The cache serves a read of one table, in autocommit mode, only. A query with a
join reads the live storage. A query inside an explicit transaction also reads
the live storage.

Evict an entry of the cache through the `CamusConnection` below. Use an
`EvictCacheAsync(...)`, or an `EvictAllCacheAsync()`.

## Migrations

The provider holds the services of the design time. The standard tools of EF can
therefore find it:

```bash
dotnet ef migrations add InitialCreate
dotnet ef database update
```

Supported migration operations:

| Operation | SQL shape |
| --- | --- |
| Create table | `CREATE TABLE IF NOT EXISTS ...` |
| Drop table | `DROP TABLE ...` |
| Rename table | `ALTER TABLE ... RENAME TO ...` |
| Add column | `ALTER TABLE ... ADD COLUMN ...` |
| Drop column | `ALTER TABLE ... DROP COLUMN ...` |
| Rename column | `ALTER TABLE ... RENAME COLUMN ... TO ...` |
| Alter column nullability | `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL` or `DROP NOT NULL` |
| Add check constraint | `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)` |
| Drop check constraint | `ALTER TABLE ... DROP CONSTRAINT ...` |
| Create index | `CREATE INDEX IF NOT EXISTS ...` |
| Create unique index | `CREATE UNIQUE INDEX IF NOT EXISTS ...` |
| Drop index | `ALTER TABLE ... DROP INDEX ...` |
| Rename index | `ALTER TABLE ... RENAME INDEX ... TO ...` |
| Set table comment | `COMMENT ON TABLE ... IS ...` |
| Set column comment | `COMMENT ON COLUMN ... IS ...` |
| Set index comment | `COMMENT ON INDEX ... IS ...` |
| Create view | `CREATE VIEW ... AS SELECT ...` |
| Drop view | `DROP VIEW ...` |
| Rename view | `ALTER VIEW ... RENAME TO ...` |
| Truncate table | `TRUNCATE TABLE ...` |
| Seed data | `INSERT INTO ... VALUES (...)` |
| Raw SQL | passed through as-is |

Example:

```csharp
public partial class AddStockColumn : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "Stock",
            table: "products",
            type: "int64",
            nullable: false,
            defaultValue: 0);

        migrationBuilder.CreateIndex(
            name: "idx_products_name",
            table: "products",
            column: "Name",
            unique: true);

        migrationBuilder.AddCheckConstraint(
            name: "ck_products_stock",
            table: "products",
            sql: "Stock >= 0");
    }
}
```

A change of the ability of a column to hold a null works, while the stored type
stays the same. A change of the type of a column in place does not work.

A `DropCheckConstraint` emits a `DROP CONSTRAINT`. CamusDB resolves that
statement against a named `CHECK` constraint, and against a named `NOT NULL`
constraint.

## Comments

Table and column comments use EF Core's built-in `HasComment` API. Index
comments use the provider's `HasComment` extension:

```csharp
modelBuilder.Entity<User>(b =>
{
    b.ToTable("users", t => t.HasComment("Application users"));
    b.Property(u => u.Email).HasComment("Unique login email address");
    b.HasIndex(u => u.Email, "email_idx").HasComment("Lookup by login email");
});
```

Migrations emit `COMMENT ON ...` when a comment changes. Removing a comment
emits `COMMENT ON ... IS NULL`. Database comments have no EF Core model API, so
use raw SQL:

```csharp
migrationBuilder.Sql("COMMENT ON DATABASE app IS 'Application database'");
```

Comments are useful metadata for people and for AI agents that inspect the
database through the CamusDB MCP server.

## Views

Map a read-only entity to a CamusDB view with `ToView(...)`:

```csharp
modelBuilder.Entity<OpenOrder>().HasNoKey().ToView("open_orders");
```

EF Core does not create view migrations automatically, so the provider exposes
migration helpers:

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.CreateView(
        "open_orders",
        "SELECT id, customer, total FROM orders WHERE status = 'open'");

    migrationBuilder.CreateView(
        "order_summary",
        "SELECT customer, SUM(total) AS total FROM orders GROUP BY customer",
        columns: ["customer", "total"],
        orReplace: true);

    migrationBuilder.RenameView("open_orders", "active_orders");
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropView("order_summary", ifExists: true);
    migrationBuilder.DropView("active_orders", ifExists: true);
}
```

Views are read-only. Use `HasNoKey()` for a projection type and keep it out of
`SaveChanges()`. A read through a view can use joins, aggregation, and the query
optimizer, but a result-cache hint on a view-backed query is bypassed because a
view expands to a derived source.

Materialized views are physical relations. Map them as tables for querying, but
do not write through them. Refresh them with SQL:

```csharp
await ctx.Database.ExecuteSqlRawAsync(
    "REFRESH MATERIALIZED VIEW customer_totals");
```

## Truncate tables

Use `TruncateTable(...)` when you need to empty a whole base table without
loading rows into the change tracker:

```csharp
await ctx.Database.TruncateTableAsync("staging_imports");
ctx.ChangeTracker.Clear();
```

`TRUNCATE TABLE` runs outside an explicit transaction and CamusDB rejects it
inside one. The table keeps its schema, indexes, grants, and name. Its previous
contents remain recoverable during the server retention window through the
orphan-table recovery workflow.

## Concurrency

The provider supports two EF Core optimistic-concurrency styles.

`[Timestamp]` or `IsRowVersion()` on a `byte[]` property creates a
provider-managed row-version token. The provider writes a fresh token on every
insert and update, and EF includes the original token in the update predicate:

```csharp
public sealed class Document
{
    public string Id { get; set; } = "";
    public string Body { get; set; } = "";

    [Timestamp]
    public byte[] Version { get; set; } = [];
}
```

A stale write raises `DbUpdateConcurrencyException`.

`[ConcurrencyCheck]` is also supported on numeric properties:

- `short`
- `int`
- `long`

Example:

```csharp
public sealed class Order
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";

    [ConcurrencyCheck]
    public long Version { get; set; }
}
```

Increase the column of the version in the code of your application. Do that
before a save:

```csharp
order.Status = "shipped";
order.Version++;
await ctx.SaveChangesAsync();
```

Important behavior:

- CamusDB detects write conflicts at transaction commit time.
- `SaveChangesAsync()` can succeed and the conflict can still surface later at
  `CommitTransactionAsync()`.
- For optimistic concurrency, use an explicit numeric version column with
  `[ConcurrencyCheck]`, or a provider-managed `byte[]` row version.

## Current limitations

The provider is useful today. It nevertheless does not imitate a feature of a
database that CamusDB does not support.

Unsupported or restricted operations include:

- no foreign key constraints
- no computed columns
- `ALTER COLUMN` only supports toggling nullability; changing the stored type
  requires a manual migration strategy
- no sequences
- no add/drop primary key through migrations
- no inline unique constraints in migrations; use unique indexes instead
- no LINQ predicate over an `ARRAY(T)` property; arrays can be read and written
  as whole values

Model restrictions:

- key CLR types must be `string`, `Guid`, `short`, `int`, or `long`
- `[ConcurrencyCheck]` is limited to numeric columns; use `[Timestamp]` or
  `IsRowVersion()` for provider-managed `byte[]` row versions
- plain `Guid` maps to `OID`; use `HasColumnType("uuid")` for native UUID
  storage
- vector embeddings are stored in `bytes` columns; there is no dedicated vector
  CLR/store type
- `WithCache(...)` is effective only on single-table autocommit reads

## When to use it

Use the EF provider when you want:

- LINQ over CamusDB tables
- EF Core change tracking
- `EnsureCreated()` or EF migrations for supported DDL
- application-level optimistic concurrency with version columns

See [.NET Driver](/docs/dotnet-driver) for two purposes: a direct access with
SQL first, and a finer control of a command and of a transaction.
