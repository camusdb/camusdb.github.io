---
sidebar_position: 7.2
---

# EF Core provider

`CamusDB.EntityFrameworkCore` lets a .NET application use CamusDB through
Entity Framework Core. Entity Framework Core (EF Core) is the .NET
object-relational mapper (ORM): you define your data as C# classes and query it
with LINQ, and EF Core writes the SQL, tracks changes to your objects, and saves
them.

Use EF Core when your application already uses it, or when you want to work
with objects instead of SQL text. The provider sits on top of the
[.NET driver](/docs/dotnet-driver), so transport, authentication, and routing
work the same way.

To compare the three .NET packages (driver, Dapper, EF Core) and their target
frameworks, see [Which .NET package to use](/docs/dotnet-driver#which-net-package-to-use).

Use the EF Core provider when:

- You want LINQ over CamusDB tables.
- You want EF Core change tracking.
- You create the schema with `EnsureCreated()`, or with EF migrations for the
  supported DDL.
- You want application-level optimistic concurrency with version columns.

Use the [.NET driver](/docs/dotnet-driver) instead when you want to write SQL
first, or need finer control over each command and transaction.

The provider depends on the EF Core 10 relational APIs.

For an Aspire application, use the [.NET Aspire integration](/docs/aspire#register-an-ef-core-context)
to register a pooled context with health checks and telemetry.

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

The connection string accepts the same keys as the ADO.NET driver. Common
examples are `Protocol=grpc`, `User`, `Password`, `AccessToken`,
`MaxAutoPrepare`, `AutoPrepareMinUsages`, `IsolationLevel`, `Locking`,
`TransactionMode`, `ChannelPoolSize`, `CoalescingThreshold`, and
`CoalescingDelay`.

See [.NET Driver](/docs/dotnet-driver#connection-string) for the full
connection string reference, and
[.NET Driver Authentication](/docs/dotnet-driver#authentication) for
authenticated connections.

EF Core commands also emit the driver's OpenTelemetry traces and metrics. See
[.NET Driver OpenTelemetry](/docs/dotnet-driver#opentelemetry) for registration
and how it interacts with EF Core's own instrumentation.

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

Pass the connection directly when you want to share a `CamusConnection` or
manage a transaction outside the context:

```csharp
CamusConnection connection = new(
    new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=mydb"));

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(connection)
    .Options;
```

When you pass an existing connection, the `DbContext` doesn't own it and
disposes nothing.

## Define a model

Map an ObjectId primary key with the `"id"` or `"oid"` store type. Mark the
property as generated on add when the client should create the ObjectId:

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

For a string primary key mapped to `"id"` or `"oid"`, the provider generates a
24-character Camus ObjectId on the client.

Use `ToTable(t => t.HasCheckConstraint(...))` for a server-enforced check
constraint:

```csharp
modelBuilder.Entity<Robot>(b =>
{
    b.ToTable("robots", t =>
        t.HasCheckConstraint("ck_robots_price", "price >= 0"));
});
```

When a check constraint rejects a row, you get a `DbUpdateException` whose
inner `CamusException` carries code `CADB0303`.

## Type mapping

Supported CLR-to-store mappings:

| CLR type | Camus store type | DDL type |
| --- | --- | --- |
| `string` key with `HasColumnType("id")` | `id` or `oid` | `OID` |
| `Guid` | `uuid` or `guid` | `UUID` |
| `string` | `string` | `STRING` |
| `string` with `HasMaxLength(n)` | `string` | `STRING(n)` |
| `bool` | `bool` | `BOOL` |
| `short`, `int`, `long` | `int64` | `INT64` |
| `float` | `float32` or `real` | `FLOAT32` |
| `double` | `float64` | `FLOAT64` |
| `decimal` | `numeric` or `decimal` | `NUMERIC` |
| `byte[]` | `bytes` or `blob` | `BYTES` |
| `DateOnly` | `date` | `DATE` |
| `DateTime`, `DateTimeOffset` | `datetime` or `timestamp` | `DATETIME` |
| `long[]`, `string[]`, `double[]`, `bool[]` | `array(int64)`, `array(string)`, `array(float64)`, `array(bool)` | `ARRAY(T)` |

For CamusDB ObjectId primary keys, use `HasColumnType("id")` on a `string`
property. A plain `Guid` property maps to native `UUID`, so
`HasColumnType("uuid")` is optional. Do not declare a `Guid` property with
`HasColumnType("id")`: CamusDB ObjectId values are 12 bytes and should be
modeled as strings or `CamusObjectIdValue`.

A `decimal` property maps to `NUMERIC`. CamusDB uses fixed precision and scale
for that type, so EF Core `HasPrecision(...)` does not change the generated
column type. A `decimal` constant in a LINQ query is emitted as a typed
`NUMERIC` literal.

The provider normalizes `DateTime` and `DateTimeOffset` values to UTC.
`DateOnly` maps to a calendar date.

`long[]`, `string[]`, `double[]`, and `bool[]` properties map to native
`ARRAY(T)` columns. Arrays are read and written as whole values. They are not
indexable, have no inline SQL literal, and cannot be used in a LINQ predicate.

Vector embeddings are stored as `byte[]` in a `bytes` column. Use
`CamusVector.ToBytes(...)` from the ADO.NET package to pack a `float[]`, and use
the vector functions described below to rank rows.

## Create tables

`EnsureCreated()` is supported and idempotent:

```csharp
await using var ctx = new AppDbContext(options);
await ctx.Database.EnsureCreatedAsync();
```

`EnsureCreated()` first checks whether the database exists. It sends
`CREATE DATABASE IF NOT EXISTS` only when the database is missing, then creates
the model's tables. It continues safely when the database or the tables already
exist, so an account with DDL grants on an existing database can run
`EnsureCreated()` or migrations without superuser rights.

`EnsureDeleted()` drops the connection string's database:

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

### Bulk update and delete

Use EF Core `ExecuteUpdateAsync()` and `ExecuteDeleteAsync()` when the change can
run as one server-side statement and you do not need to load entities into the
change tracker:

```csharp
int paid = await ctx.Orders
    .Where(o => o.Status == "open" && o.Total > 100)
    .ExecuteUpdateAsync(s => s
        .SetProperty(o => o.Status, "paid")
        .SetProperty(o => o.Total, o => o.Total * 2));

int removed = await ctx.Orders
    .Where(o => ctx.Customers.Any(c => c.Id == o.CustomerId && c.Name == "bob"))
    .ExecuteDeleteAsync();
```

CamusDB requires `UPDATE` and `DELETE` to have a `WHERE` clause, so an unfiltered
bulk operation is emitted with `WHERE TRUE`. A filter over the target table is
sent directly. A filter that uses a navigation, a join, a correlated subquery,
or `Take` / `Skip` is rewritten as `WHERE <pk> IN (SELECT ...)`, which requires
a single-column primary key.

Values passed to `SetProperty` can use constants, parameters, and columns of
the row being updated. They cannot read another table. Like all EF Core bulk
operations, these bypass the change tracker, and provider-managed row-version
tokens are not advanced unless you set them explicitly.

## LINQ translation

The provider translates common relational query shapes to CamusDB SQL:

- `Where`
- `OrderBy` / `ThenBy`
- `Skip` / `Take`
- `Distinct`
- scalar aggregates: `Count`, `Sum`, `Average`, `Min`, `Max`, `Any`
- `GroupBy` with aggregates
- inner joins, left joins, right joins, and cross joins
- correlated subqueries, such as `Where(o => o.Items.Any(...))`

Parameterized collection checks such as `ids.Contains(e.Id)` expand to
`IN (@p0, @p1, ...)`, which works with CamusDB's SQL dialect.

Join support covers the usual LINQ shapes:

| LINQ shape | SQL shape |
| --- | --- |
| `join ... on ... equals ...`, `Join(...)`, required navigation | `INNER JOIN` |
| `GroupJoin(...).SelectMany(...DefaultIfEmpty())`, `LeftJoin(...)`, optional navigation, collection `Include(...)` | `LEFT JOIN` |
| `RightJoin(...)` | `RIGHT JOIN` |
| `from a in A from b in B` with no correlation | `CROSS JOIN` |

CamusDB does not have lateral joins or window functions. A `SelectMany` whose
inner sequence refers to the outer row outside an equality key, and per-row
`Take` / `Skip` / `First` shapes such as filtered includes, are not translated.

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

## Transactions

The provider supports EF Core transactions:

```csharp
await using var ctx = new AppDbContext(options);
await using var tx = await ctx.Database.BeginTransactionAsync();

ctx.Robots.Add(new Robot { Name = "R2-D2", Kind = "mechanical", Year = 1977 });
await ctx.SaveChangesAsync();

await tx.CommitAsync();
```

With an endpoint pool, commands inside a transaction stay on the same node for
the transaction's whole lifetime.

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

Serializable is CamusDB's default isolation level, so `SaveChangesAsync()` and
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

The strategy retries only CamusDB's retryable transaction errors:

- `CADB0502` `TransactionConflict`
- `CADB0504` `TransactionMustRetry`
- `CADB0505` `TransactionLifetimeExceeded`

`CADB0509` `TransactionFinalizeUnresolved` is not a signal to replay from the
start. It can appear while a transaction is finalizing: retry the same commit
or rollback for the same transaction id, and don't run the unit of work again.

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

The execution strategy retries the whole EF operation. If you manage an
explicit transaction by hand, replay the whole transaction from the start; don't
retry the failed statement alone.

## Prepared statements

The underlying ADO.NET driver automatically prepares EF Core queries and
`SaveChangesAsync()` statements once the same SQL shape has run enough times.
You need no EF-specific configuration and no manual `Prepare()` calls.

This suits EF well: LINQ queries and change-tracking writes usually produce
deterministic, parameterized SQL for each operation.

A prepared execution behaves like an inline one, including transactions,
Serializable isolation, retries, and the query result cache.

Tune the policy with the ordinary connection string keys:

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

Use `WithCache(...)` to opt a LINQ query into the CamusDB query result cache.
The provider adds the `{cache=...}` hint to the generated SQL.

```csharp
using CamusDB.EntityFrameworkCore;

List<Order> recent = await ctx.Orders
    .Where(o => o.Status == 1)
    .OrderByDescending(o => o.Total)
    .Take(20)
    .WithCache("recent_orders", ttl: TimeSpan.FromSeconds(30), strict: true)
    .ToListAsync();
```

The cache serves only single-table autocommit reads. Queries with joins, and
queries inside an explicit transaction, read live storage.

Evict cache entries through the underlying `CamusConnection` with
`EvictCacheAsync(...)` or `EvictAllCacheAsync()`.

## Migrations

The provider includes design-time services, so the standard EF tools can find
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
| Add foreign key | `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ...` |
| Drop foreign key | `ALTER TABLE ... DROP CONSTRAINT ...` |
| Add unique constraint / alternate key | `CREATE UNIQUE INDEX ...` |
| Drop unique constraint / alternate key | `ALTER TABLE ... DROP INDEX ...` |
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

You can change a column's nullability as long as the stored type stays the
same. Changing a column's type in place is not supported.

`DropCheckConstraint` emits `DROP CONSTRAINT`, which CamusDB resolves against
named `CHECK` and named `NOT NULL` constraints.

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

## Relationships and foreign keys

Relationships in the EF model become CamusDB `FOREIGN KEY` constraints through
migrations and `EnsureCreated()`:

```csharp
modelBuilder.Entity<Customer>()
    .HasMany(c => c.Orders)
    .WithOne()
    .HasForeignKey(o => o.CustomerId);
```

The server enforces the constraint at the end of each statement, inside the
statement's transaction. A child row without a parent fails with `CADB0304`; a
delete or update of a referenced parent key fails with `CADB0305` or
`CADB0306`.

CamusDB supports `NO ACTION` and `RESTRICT` server-side. EF Core defaults a
required relationship to cascade, but the provider renders unsupported server
actions as `NO ACTION`; EF still applies cascade or set-null behavior to
dependents that are tracked in the context. If the dependents are not tracked,
delete them first or use `DeleteBehavior.Restrict`.

Foreign keys need an index whose leading columns are the referencing columns.
Migrations reuse the index EF creates for the relationship. `EnsureCreated()`
lets the server create the needed index when the model has no explicit one.

Use `UseForeignKeyConstraints(false)` when you want EF relationships for
ordering and navigation, but no database foreign-key constraints:

```csharp
optionsBuilder.UseCamusDB(connectionString, o =>
    o.UseForeignKeyConstraints(false));
```

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

Increment the version column in your application code before saving:

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

The provider is useful today, but it doesn't emulate database features that
CamusDB doesn't support.

Unsupported or restricted operations include:

- foreign keys support `NO ACTION` and `RESTRICT` server-side. `Cascade`,
  `SetNull`, and `SetDefault` apply only to dependents tracked by EF.
- foreign-key cycles of two or more tables are not supported. Self-references
  are supported.
- no computed columns
- `ALTER COLUMN` only supports toggling nullability; changing the stored type
  requires a manual migration strategy
- no add/drop primary key through migrations
- no LINQ predicate over an `ARRAY(T)` property; arrays can be read and written
  as whole values
- no lateral join, window functions, `UNION`, or `UNION ALL`
- `ExecuteUpdate` cannot set a value read from another table. Bulk
  update/delete shapes that use joins, correlated subqueries, or pagination need
  a single-column primary key.

Model restrictions:

- key CLR types must be `string`, `Guid`, `short`, `int`, or `long`
- `[ConcurrencyCheck]` is limited to numeric columns; use `[Timestamp]` or
  `IsRowVersion()` for provider-managed `byte[]` row versions
- plain `Guid` maps to native `UUID`
- vector embeddings are stored in `bytes` columns; there is no dedicated vector
  CLR/store type
- a `NUMERIC` value with more significant digits than .NET `decimal` can hold
  throws when materialized into a `decimal` property. Read it as `string` when
  exact wide values are possible.
- `WithCache(...)` is effective only on single-table autocommit reads
