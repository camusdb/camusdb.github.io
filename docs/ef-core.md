---
sidebar_position: 7.2
---

# EF Core Provider

CamusDB also ships an Entity Framework Core provider built on top of the
ADO.NET driver. The package name is `CamusDB.EntityFrameworkCore`.

It targets `net10.0` and depends on EF Core 10 relational APIs.

## Install

```bash
dotnet add package CamusDB.EntityFrameworkCore
```

## Configure The Provider

Register the provider with `UseCamusDB(...)`:

```csharp
using CamusDB.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb;Timeout=30")
    .Options;
```

You can also configure it in `OnConfiguring`:

```csharp
public sealed class AppDbContext : DbContext
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder.UseCamusDB(
            "Endpoint=http://localhost:5095;Database=mydb");
}
```

## Reuse An Existing Connection

If you want to share a `CamusConnection` or manage transactions outside the
context, pass the connection directly:

```csharp
CamusConnection connection = new(
    new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=mydb"));

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(connection)
    .Options;
```

When you pass an existing connection, the `DbContext` does not own it and will
not dispose it.

## Define A Model

Map primary-key object ids with store type `"id"` or `"oid"`, and mark them as
generated on add if you want client-side ObjectId generation:

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

For string primary keys mapped to `"id"` or `"oid"`, the provider generates a
24-character Camus ObjectId on the client side.

Use `ToTable(t => t.HasCheckConstraint(...))` for server-enforced check
constraints:

```csharp
modelBuilder.Entity<Robot>(b =>
{
    b.ToTable("robots", t =>
        t.HasCheckConstraint("ck_robots_price", "price >= 0"));
});
```

Rows rejected by a check constraint surface as `DbUpdateException` with an inner
`CamusException` carrying `CADB0303`.

## Type Mapping

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

Practical rule:

- use `HasColumnType("id")` for CamusDB ObjectId primary keys
- use `HasColumnType("uuid")` for native UUID columns
- use `HasColumnType("string")`, `HasColumnType("int64")`,
  `HasColumnType("float32")`, `HasColumnType("float64")`,
  `HasColumnType("bytes")`, `HasColumnType("date")`,
  `HasColumnType("datetime")`, and `HasColumnType("bool")` for regular columns

A plain `Guid` property defaults to the `id` / `OID` mapping for backward
compatibility. For UUID application values, explicitly map the property as
`uuid`:

```csharp
b.Property(e => e.ExternalRef).HasColumnType("uuid");
```

`DateTime` and `DateTimeOffset` values are normalized to UTC. `DateOnly` maps to
calendar dates. The EF provider does not map `ARRAY(T)` columns; use the ADO.NET
driver when you need array parameters.

## Create Tables

`EnsureCreated()` is supported and idempotent:

```csharp
await using var ctx = new AppDbContext(options);
await ctx.Database.EnsureCreatedAsync();
```

`EnsureCreated()` creates the database with `IF NOT EXISTS` and then creates the
model tables. It continues safely if the database or tables already exist.

`EnsureDeleted()` drops the database named in the connection string:

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

With pooled endpoints, transaction-scoped commands stay pinned to the same node
for the lifetime of the transaction.

## Retry On Serializable Conflicts

Serializable is CamusDB's default isolation level. `SaveChangesAsync()` or
`CommitTransactionAsync()` can fail when a concurrent transaction wins a
serialization conflict.

Enable EF Core's execution strategy with `EnableRetryOnFailure()`:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.EnableRetryOnFailure();
    })
    .Options;
```

Only the retryable CamusDB transaction errors are retried:

- `CADB0502` `TransactionConflict`
- `CADB0504` `TransactionMustRetry`
- `CADB0505` `TransactionLifetimeExceeded`

`CADB0509` `TransactionFinalizeUnresolved` is not a replay-from-beginning
signal. If it surfaces while finalizing a transaction, retry the same commit or
rollback for the same transaction id instead of rerunning the unit of work.

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

The execution strategy retries the entire EF operation. If you manage explicit
transactions manually, replay the whole transaction from the beginning instead
of retrying only the failed statement.

## Query Result Cache

Use `WithCache(...)` to opt a LINQ query into CamusDB's query result cache. The
provider injects the `{cache=...}` hint into generated SQL.

```csharp
using CamusDB.EntityFrameworkCore;

List<Order> recent = await ctx.Orders
    .Where(o => o.Status == 1)
    .OrderByDescending(o => o.Total)
    .Take(20)
    .WithCache("recent_orders", ttl: TimeSpan.FromSeconds(30), strict: true)
    .ToListAsync();
```

The cache only serves single-table, autocommit reads. Queries with joins or
queries inside explicit transactions read live storage. Evict cache entries
through the underlying `CamusConnection` with `EvictCacheAsync(...)` or
`EvictAllCacheAsync()`.

## Migrations

The provider includes design-time services, so standard EF tooling can discover
it:

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

Changing a column's nullability is supported when the stored type does not
change. Changing a column's type is not supported in place.

`DropCheckConstraint` emits `DROP CONSTRAINT`; CamusDB resolves that against
both named `CHECK` constraints and named `NOT NULL` constraints.

## Concurrency

`[ConcurrencyCheck]` is supported on numeric properties:

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

You must increment the version column in application code before saving:

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
  `[ConcurrencyCheck]`.

`[Timestamp]` is not supported.

## Current Limitations

The provider is useful today, but it does not try to emulate unsupported
database features.

Unsupported or restricted operations include:

- no foreign key constraints
- no computed columns
- `ALTER COLUMN` only supports toggling nullability; changing the stored type
  requires a manual migration strategy
- no sequences
- no add/drop primary key through migrations
- no inline unique constraints in migrations; use unique indexes instead
- no `ARRAY(T)` property mapping; use the ADO.NET driver for array parameters

Model restrictions:

- key CLR types must be `string`, `Guid`, `short`, `int`, or `long`
- `[ConcurrencyCheck]` is limited to numeric columns
- plain `Guid` maps to `OID`; use `HasColumnType("uuid")` for native UUID
  storage
- `WithCache(...)` is effective only on single-table autocommit reads

## When To Use It

Use the EF provider when you want:

- LINQ over CamusDB tables
- EF Core change tracking
- `EnsureCreated()` or EF migrations for supported DDL
- application-level optimistic concurrency with version columns

For direct SQL-first access or finer control over commands and transactions, see
[.NET Driver](/docs/dotnet-driver).
