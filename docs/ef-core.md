---
sidebar_position: 7.2
---

# EF Core Provider

CamusDB also ships an Entity Framework Core provider built on top of the
ADO.NET driver. The package name is `CamusDB.EntityFrameworkCore`.

It targets `net8.0` and `net9.0` and depends on EF Core 9 relational APIs.

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
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb")
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

## Type Mapping

Supported CLR-to-store mappings:

| CLR type | Camus store type | DDL type |
| --- | --- | --- |
| `string` key | `id` or `oid` | `OID` |
| `Guid` key | `id` or `oid` | `OID` |
| `string` | `string` | `STRING` |
| `bool` | `bool` | `BOOL` |
| `short`, `int`, `long` | `int64` | `INT64` |
| `float`, `double` | `float64` | `FLOAT64` |

Practical rule:

- use `HasColumnType("id")` for CamusDB ObjectId primary keys
- use `HasColumnType("string")`, `HasColumnType("int64")`, `HasColumnType("float64")`, and `HasColumnType("bool")` for regular columns

## Create Tables

`EnsureCreated()` is supported:

```csharp
await using var ctx = new AppDbContext(options);
await ctx.Database.EnsureCreatedAsync();
```

The provider treats databases as logical containers and always reports the
server as existing. `EnsureCreated()` builds `CREATE TABLE` statements from the
model and continues safely if a table already exists.

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
| Add column | `ALTER TABLE ... ADD COLUMN ...` |
| Drop column | `ALTER TABLE ... DROP COLUMN ...` |
| Create index | `CREATE INDEX IF NOT EXISTS ...` |
| Create unique index | `CREATE UNIQUE INDEX IF NOT EXISTS ...` |
| Drop index | `ALTER TABLE ... DROP INDEX ...` |
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
    }
}
```

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
- no `ALTER COLUMN`
- no `RENAME COLUMN`
- no `RENAME TABLE`
- no `RENAME INDEX`
- no check constraints
- no sequences
- no add/drop primary key through migrations
- no inline unique constraints in migrations; use unique indexes instead
- no drop-database support through the provider

Model restrictions:

- key CLR types must be `string`, `Guid`, `short`, `int`, or `long`
- `[ConcurrencyCheck]` is limited to numeric columns

## When To Use It

Use the EF provider when you want:

- LINQ over CamusDB tables
- EF Core change tracking
- `EnsureCreated()` or EF migrations for supported DDL
- application-level optimistic concurrency with version columns

For direct SQL-first access or finer control over commands and transactions, see
[.NET Driver](/docs/dotnet-driver).
