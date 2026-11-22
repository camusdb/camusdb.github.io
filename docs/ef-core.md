---
sidebar_position: 7.2
description: "Use CamusDB with Entity Framework Core. Define your data as C# classes, query it with LINQ, and let the CamusDB.EntityFrameworkCore provider write the SQL."
---

# EF Core provider

`CamusDB.EntityFrameworkCore` lets a .NET application use CamusDB through Entity
Framework Core (EF Core), the object-relational mapper (ORM) of .NET. You define
your data as C# classes and query it with LINQ. EF Core writes the SQL and saves
the changes to your objects.

Use EF Core when your application already uses it, or when you prefer to work
with objects. The provider is built on the [.NET driver](/docs/dotnet-driver).
This means that the transport and the authentication work the same way. This page describes `CamusDB.EntityFrameworkCore` 0.19.3. To compare the
.NET packages, see
[Which .NET package to use](/docs/dotnet-driver#which-net-package-to-use).

Use the EF Core provider in these cases:

- You want LINQ over CamusDB tables.
- You want EF Core change tracking.
- You create the schema with `EnsureCreated()` or with EF migrations.
- You want optimistic concurrency with version columns.

If you prefer to write SQL, or you need control of each command and transaction,
use the [.NET driver](/docs/dotnet-driver).

For an Aspire application, use the
[.NET Aspire integration](/docs/aspire#register-an-ef-core-context) to register a
pooled context with health checks and telemetry.

## Sample application

CamusShop is a robot store that uses the EF Core provider for migrations and for
a checkout with serializable retries. See the
[CamusShop advanced sample](/docs/advanced-samples#camusshop).

## Install

```bash
dotnet add package CamusDB.EntityFrameworkCore
```

### Supported versions

The package has a build for each EF Core major version. NuGet selects the build
for your target framework:

| Target framework | EF Core major |
| --- | --- |
| `net10.0` | 10 |
| `net11.0` or later | 11 |

On .NET 11, update your direct EF Core references to 11.x too. A 10.x reference
can cause `NU1605` during restore.

`UseCamusDB` checks the loaded EF Core major version at once. A mismatch throws
`InvalidOperationException`, with both versions and their file paths. To fix it, clean the publish output. Then deploy the matching provider build,
also for copies that plugins load. The AppContext switch
`CamusDB.EntityFrameworkCore.DisableEfCoreVersionCheck` turns off the check. Use
it only for diagnosis.

## Configure the provider

Register the provider with `UseCamusDB(...)`:

```csharp
using CamusDB.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb;Timeout=30")
    .Options;
```

The connection string has the same keys as the .NET driver, for example
`Protocol=grpc` or `User` and `Password`. For the full list, see
[Connection string](/docs/dotnet-driver#connection-string). For authenticated
connections, see [Authentication](/docs/dotnet-driver#authentication).

EF Core commands also emit the OpenTelemetry traces and metrics of the driver.
For more information, see [OpenTelemetry](/docs/dotnet-driver#opentelemetry).

You can also configure the provider in `OnConfiguring`:

```csharp
public sealed class AppDbContext : DbContext
{
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
        => optionsBuilder.UseCamusDB(
            "Endpoint=http://localhost:5095;Database=mydb");
}
```

## Reuse an existing connection

To share a `CamusConnection`, or to manage a transaction outside the context,
pass the connection:

```csharp
CamusConnection connection = new(
    new CamusConnectionStringBuilder(
        "Endpoint=http://localhost:5095;Database=mydb"));

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(connection)
    .Options;
```

The `DbContext` doesn't own a connection that you pass, and it doesn't dispose
it.

## Define a model

Map an ObjectId primary key with the `"id"` or `"oid"` store type. If the client
should create the ObjectId, mark the property as generated on add:

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
24-character ObjectId on the client.

For a check constraint on the server, use
`ToTable(t => t.HasCheckConstraint(...))`:

```csharp
modelBuilder.Entity<Robot>(b =>
{
    b.ToTable("robots", t =>
        t.HasCheckConstraint("ck_robots_price", "price >= 0"));
});
```

A row that breaks the check constraint throws a `DbUpdateException`. Its inner
`CamusException` has the code `CADB0303`.

## Type mapping

The provider supports the following CLR-to-store mappings:

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
| `JsonDocument`, `JsonElement`, `JsonNode`, `JsonObject`, `JsonArray` | `jsonb` | `JSONB` |
| `string` with `HasColumnType("jsonb")` | `jsonb` | `JSONB` |
| `byte[]` | `bytes` or `blob` | `BYTES` |
| `DateOnly` | `date` | `DATE` |
| `DateTime`, `DateTimeOffset` | `datetime` or `timestamp` | `DATETIME` |
| `long[]`, `string[]`, `double[]`, `bool[]` | `array(int64)`, `array(string)`, `array(float64)`, `array(bool)` | `ARRAY(T)` |

For an ObjectId primary key, use `HasColumnType("id")` on a `string` property. A
`Guid` property maps to the native `UUID` type, and `HasColumnType("uuid")` is
optional. Don't declare a `Guid` property with `HasColumnType("id")`. ObjectId
values are 12 bytes. Model them as strings or as `CamusObjectIdValue`.

`NUMERIC` has a fixed precision and scale. This means that `HasPrecision(...)`
doesn't change the generated column type. A `decimal` constant in a LINQ query
becomes a typed `NUMERIC` literal.

The provider converts `DateTime` and `DateTimeOffset` values to UTC. `DateOnly`
maps to a calendar date.

Array properties map to native `ARRAY(T)` columns. An array is read and written
as one value, and it can't be indexed. The provider doesn't support array
defaults or seed data.

The following array members translate in a query. Other queries over array
elements aren't supported.

| LINQ | SQL |
| --- | --- |
| `a.Length` / `a.Count()` | `array_length(a)` |
| `a.Any()` | A length test |
| `a.Contains(x)` | `array_contains(a, x)` |
 From EF Core 11, you can map an array with
`Property(e => e.Tags)` or with `PrimitiveCollection(e => e.Tags)`. Both produce
the same column and support the same translations.

`TimeSpan` maps to an interval in expressions only. A `TimeSpan` property on a
table entity isn't allowed. Use `HasConversion<long>()` for ticks, or
`HasConversion<string>()` for text. Read models that use `ToView` or
`ToSqlQuery` can have `TimeSpan` results.

A vector property can be `float[]` or `byte[]` with
[`IsVector(dimensions)`](#vector-queries). It is stored as packed bytes. It
isn't a SQL array.

## Create tables

`EnsureCreated()` creates the tables of the model. If the database doesn't
exist, it creates the database first:

```csharp
await using var ctx = new AppDbContext(options);
await ctx.Database.EnsureCreatedAsync();
```

You can call it more than once. It sends `CREATE DATABASE IF NOT EXISTS` only if
the database is missing. This means that an account with DDL grants on an
existing database can run `EnsureCreated()` or migrations. A superuser isn't
necessary.

`EnsureDeleted()` drops the database of the connection string:

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

Use EF Core `ExecuteUpdateAsync()` and `ExecuteDeleteAsync()` when the change
can execute as one statement on the server. The entities aren't loaded into the
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

A filter on the target table is sent as the `WHERE` clause. CamusDB requires a
`WHERE` clause on `UPDATE` and `DELETE`. This means that an operation that doesn't have a filter is
sent with `WHERE TRUE`. Other filters, such as a join or `Take`,
select the primary keys of the target in a `WHERE <pk> IN (SELECT ...)`
subquery. A target row that the join matches twice changes once.

A `SetProperty` value can also read a joined table or a correlated subquery:

```csharp
await (from o in ctx.Orders
       join c in ctx.Customers on o.CustomerId equals c.Id
       where c.Region == "eu"
       select new { o, c })
    .ExecuteUpdateAsync(s => s.SetProperty(x => x.o.Region, x => x.c.Region));
```

For this query, the provider writes `UPDATE ... FROM` or `DELETE ... USING`. It
also uses these forms for a filter on a table that doesn't have a single-column
primary key. Note the following rules:

- These forms need CamusDB 0.18.3 or later.
- A target row that matches more than one source row returns `CADB0400`. This
  occurs before any change is written. Aggregate the source to one row for each
  target.
- An outer join, or an ordered, limited, or grouped query, throws
  `InvalidOperationException`.

For more information, see [Joined writes](/docs/sql-writes#joined-writes).

Bulk operations skip the change tracker, as in other EF Core providers. A
provider-managed row-version token doesn't change, unless you set it.

## LINQ translation

The provider translates the common relational query shapes to CamusDB SQL:

- `Where`
- `OrderBy` / `ThenBy`
- `Skip` / `Take`
- `Distinct`
- Scalar aggregates: `Count`, `Sum`, `Average`, `Min`, `Max`, `Any`
- `GroupBy` with aggregates
- Joins, as shown in the table below
- Correlated subqueries, such as `Where(o => o.Items.Any(...))`

A parameter collection check, such as `ids.Contains(e.Id)`, expands to
`IN (@p0, @p1, ...)`. A `Skip` that doesn't have a `Take` emits
`OFFSET` alone.

The LINQ join shapes translate to the following SQL:

| LINQ shape | SQL shape |
| --- | --- |
| `join ... on ... equals ...`, `Join(...)`, required navigation | `INNER JOIN` |
| `GroupJoin(...).SelectMany(...DefaultIfEmpty())`, `LeftJoin(...)`, optional navigation, collection `Include(...)` | `LEFT JOIN` |
| `RightJoin(...)` | `RIGHT JOIN` |
| `from a in A from b in B`, uncorrelated | `CROSS JOIN` |

A correlated `SelectMany` translates to `CROSS JOIN LATERAL`, or to
`LEFT JOIN LATERAL` with `DefaultIfEmpty`. A limit for each parent, such as `Take(2)`, can use `ROW_NUMBER()` in a derived
table. This is also true in a filtered include.
`LATERAL` needs CamusDB 0.18.4 or later. If the inner source doesn't have a key
or an explicit order, its first row isn't defined.

```csharp
var top = await ctx.Customers
    .Select(c => new {
        c.Name,
        Top = c.Orders.Where(o => o.Total > c.Limit)
            .OrderByDescending(o => o.Total).Take(2).ToList()
    })
    .ToListAsync();
```

### Inline and parameter collections

An inline or parameter array that you use in other ways than `Contains` becomes a
`VALUES` source. This needs CamusDB 0.18.4 or later. `Contains` expands to `IN`:

```csharp
long[] ids = [1, 2, 3];
var rows = await ctx.Customers.Where(c => ids.Any(i => i > c.Id)).ToListAsync();
```

An empty parameter array produces no source rows. `Max` or `Min` of an unfiltered inline array becomes
`GREATEST` or `LEAST`. A filtered collection can use
a subquery over `VALUES`. These collections are local to the query. They aren't
mapped `ARRAY` columns.

### String members and conversions

String operations execute on the server when they map to CamusDB functions:

| LINQ | SQL function or predicate |
| --- | --- |
| `s.StartsWith(x)` | `starts_with(s, x)` |
| `s.EndsWith(x)` | `ends_with(s, x)` |
| `s.Contains(x)` | `contains(s, x)` |
| `s.ToUpper()` / `s.ToLower()` | `upper(s)` / `lower(s)` |
| `s.Trim()` / `s.TrimStart()` / `s.TrimEnd()` | `trim(s)` / `ltrim(s)` / `rtrim(s)` |
| `s.Replace(a, b)` | `replace(s, a, b)` |
| `s.Length` | `length(s)` |
| `s.Substring(i, n)`, `s[i]` | `substring(s, i + 1, n)`, or one character |
| `s.IndexOf(x)` | `strpos(s, x) - 1` |
| `string.IsNullOrWhiteSpace(s)` | NULL test or whitespace regex |
| `int.Parse(s)`, `long.Parse`, `double.Parse`, `decimal.Parse`, `bool.Parse`, `Guid.Parse` | `CAST` to the matching SQL type |
| `Guid.NewGuid()` | `gen_uuid_v4()` |

`ToString()` and `Convert.ToString()` translate as follows:

| Value type | Translation |
| --- | --- |
| `short` / `int` / `long` / `double` / `Guid` / `char` | `CAST(x AS STRING)` |
| `bool` | `True` or `False`, as in .NET |
| `decimal` / `float` / date and time types | Not translated. The server text differs from the .NET text. |

The `Trim` methods accept constant character arrays.

A substring that goes past the end of the text returns the available text, or
an empty string. In .NET, the same call throws.

`string.Compare(...)` and `a.CompareTo(b)` translate when you compare the result
with zero. This is useful for keyset pagination:

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

The regular expression helpers map to the CamusDB regex functions:

```csharp
using System.Text.RegularExpressions;

List<Person> people = await ctx.People
    .Where(p => Regex.IsMatch(p.Email, "^[^@]+@[^@]+\\.[a-z]+$",
        RegexOptions.IgnoreCase))
    .Where(p => EF.Functions.RegexpLike(p.Name, "^[A-Z]"))
    .ToListAsync();
```

`Regex.IsMatch` and `Regex.Replace` translate. `EF.Functions` also has
`Regexp*` helpers, such as `RegexpCount` and `RegexpSubstr`.

### Math and date arithmetic

The following `Math` methods translate to server functions:

| .NET | SQL |
| --- | --- |
| `Math.Abs` / `Math.Sign` | `abs` / `sign`. `Sign` of a `decimal` isn't translated. |
| `Math.Ceiling` / `Math.Floor` / `Math.Truncate` | `ceil` / `floor` / `trunc` |
| `Math.Sqrt` / `Math.Exp` / `Math.Pow` | `sqrt` / `exp` / `pow` |
| `Math.Log(x)` / `Math.Log10(x)` | `ln(x)` / `log10(x)` |
| `Math.Log(x, b)` | `log(b, x)` |
| `Math.Sin` / `Math.Cos` / `Math.Tan` | `sin` / `cos` / `tan` |
| `Math.Asin` / `Math.Acos` / `Math.Atan` / `Math.Atan2` | `asin` / `acos` / `atan` / `atan2` |
| `Math.Max` / `Math.Min` | `GREATEST` / `LEAST`. These need CamusDB 0.18.4 or later. |

`Math.Round` translates to `round` only with `MidpointRounding.AwayFromZero`. The default banker's rounding and the
`MathF` methods aren't supported.

The following date parts execute on the server:

| Type | Parts |
| --- | --- |
| `DateTime` | `Year` / `Month` / `Day` / `DayOfWeek` / `DayOfYear` / `Hour` / `Minute` / `Second` / `Millisecond` |
| `DateOnly` | `Year` / `Month` / `Day` / `DayOfWeek` / `DayOfYear` |
| `DateTimeOffset` | Not supported. |

`Date` and `TimeOfDay` translate to truncation and subtraction. All temporal values
are in UTC.

```csharp
TimeSpan limit = TimeSpan.FromHours(1);
var slow = await ctx.Jobs
    .Where(j => j.Started > DateTime.UtcNow.AddDays(-7)
        && j.Finished - j.Started > limit)
    .Select(j => new { j.Name, Duration = j.Finished - j.Started })
    .ToListAsync();
```

Date arithmetic and `TimeSpan` arithmetic translate to
[interval expressions](/docs/data-types#intervals):

- Parameter durations are cast to `INTERVAL`, and timestamp differences are read
  as `TimeSpan`.
- `AddYears` and `AddMonths` use calendar arithmetic. `DateOnly.AddDays` uses
  date arithmetic.
- `TimeSpan.FromDays` and the related methods also accept columns.
- `DateTime.UtcNow` and `DateTimeOffset.UtcNow` use the `now()` of the
  transaction.

`DateTime.Now` and `DateTime.Today` aren't supported. The component and `Total*`
members of `TimeSpan` aren't supported either.

### String concatenation and interpolation

String `+` and `string.Concat` translate to SQL `||`. A `NULL` operand is
treated as an empty string, as in C#. Simple string interpolation also
translates:

```csharp
var people = await ctx.People
    .Where(p => $"{p.First} {p.Last}" == "Ada Lovelace")
    .ToListAsync();
```

Interpolation supports string and integer arguments in simple placeholders.
Format specifiers and alignment aren't translated. Other argument types aren't
translated either. EF
Core can format these values on the client in the final projection. In a filter
or an ordering, they raise a translation error.

### Set operations

| LINQ | SQL |
| --- | --- |
| `Union` | `UNION` |
| `Concat` | `UNION ALL` |
| `Intersect` | `INTERSECT` |
| `Except` | `EXCEPT` |

For the server behavior, see
[Set operations](/docs/sql-queries#set-operations).

## JSON documents

Document properties map to `JSONB`. A string property needs
`HasColumnType("jsonb")`. For a GIN index, use `HasMethod("gin")`:

```csharp
modelBuilder.Entity<Event>(b =>
{
    b.Property(e => e.Payload).HasColumnType("jsonb");
    b.HasIndex(e => e.Payload).HasMethod("gin");
});

var events = await ctx.Events
    .Where(e => EF.Functions.JsonContains(e.Payload, """{"kind": "login"}"""))
    .Where(e => EF.Functions.JsonExists(e.Payload, "user"))
    .ToListAsync();
```

The other `EF.Functions.Json*` helpers, such as `JsonExistAny` and `JsonTypeof`,
also translate to the matching `jsonb_*` functions. A
compatible top-level predicate can use the GIN index.

The provider compares the content of a `JsonNode` property. This means that a
change in the node is saved. To change a `JsonDocument` or `JsonElement` value, replace it. JSON
member access, such as `RootElement.GetProperty(...)`, isn't translated. The
owned or complex `ToJson()` mapping of EF Core isn't translated either. For
document operators, use raw SQL. For more information, see
[JSON documents](/docs/json).

## Vector queries

Declare a `float[]` or `byte[]` embedding with `IsVector`:

```csharp
public sealed class SearchDocument
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public float[] Embedding { get; set; } = [];
}
```

Configure the property in `OnModelCreating`:

```csharp
modelBuilder.Entity<SearchDocument>(b =>
{
    b.Property(d => d.Embedding).IsRequired().IsVector(768);
});
```

`IsVector(768)` sets the following:

- The column type `BYTES(3072)`, which is 4 bytes for each dimension.
- `STORAGE PLAIN`. A later `HasStorage` can change the storage strategy.
- A dimension check named `CK_{table}_{column}_dims`.

A `NULL` value passes the dimension check. To refuse `NULL`, add
`IsRequired()`. For
`float[]`, the provider packs the values, and it detects changes to elements of
the array.

To rank rows, use the vector helpers with a `float[]` query vector:

```csharp
float[] query = await EmbedAsync("warehouse safety");
var nearest = await ctx.Set<SearchDocument>()
    .Where(d => d.Kind == "manual")
    .OrderBy(d => EF.Functions.L2Distance(d.Embedding, query))
    .Take(10)
    .ToListAsync();
```

The query vector uses the mapping of the column, and it is sent as packed bytes.
For a `byte[]` property, pack the query vector with `CamusVector.ToBytes(...)`.

To leave an embedding out of ordinary entity loads, use
`IsVector(768, loadWithEntity: false)`. The property must be required. A `NULL`
value then means that the vector isn't loaded:

- A query reads the vector if it names the vector, for example in a filter or an
  ordering.
- `SaveChanges` doesn't replace a stored vector with the `NULL` of an unloaded
  vector. This is also true for a detached entity passed to `Update`.
- Other shapes, such as collection includes and split queries, load the vector.

The following helpers are available:

| Helper | SQL function | Best order |
| --- | --- | --- |
| `EF.Functions.L2Distance(a, b)` | `l2_distance(a, b)` | ascending |
| `EF.Functions.CosineDistance(a, b)` | `cosine_distance(a, b)` | ascending |
| `EF.Functions.InnerProduct(a, b)` | `inner_product(a, b)` | descending |
| `EF.Functions.VectorDims(v)` | `vector_dims(v)` | not a ranking metric |
| `EF.Functions.OctetLength(v)` | `octet_length(v)` | not a ranking metric |

Vector ranking is exact. Use an `OrderBy` on a distance with `Take(k)`. Then the
server can plan a bounded top-k query. For more information, see
[Vector search](/docs/vector-search).

## Transactions

The provider supports EF Core transactions:

```csharp
await using var ctx = new AppDbContext(options);
await using var tx = await ctx.Database.BeginTransactionAsync();

ctx.Robots.Add(new Robot { Name = "R2-D2", Kind = "mechanical", Year = 1977 });
await ctx.SaveChangesAsync();

await tx.CommitAsync();
```

With an endpoint pool, all the commands of a transaction go to the same node.

## Transaction defaults

Serializable isolation is the server default. To set the default transaction
options of a context, use the provider options:

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

For optimistic locking, you can use the shortcut:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.UseOptimisticLocking();
        camus.EnableRetryOnFailure();
    })
    .Options;
```

`UsePessimisticLocking()` sets the pessimistic mode explicitly. An option that
you don't set comes from the connection string. If the connection string
doesn't set it, the server default applies.

## Retry on serializable conflicts

Serializable is the default isolation level of CamusDB. This means that
`SaveChangesAsync()` and `CommitTransactionAsync()` can fail when a concurrent
transaction wins a conflict.

To turn on the EF Core execution strategy, use `EnableRetryOnFailure()`:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB("Endpoint=http://localhost:5095;Database=mydb", camus =>
    {
        camus.EnableRetryOnFailure();
    })
    .Options;
```

The strategy uses the retry rules of the driver. It retries the conflict codes, such as `CADB0502`. It
also retries some transient errors that their message identifies. For the details, see
[Serializable retries](/docs/dotnet-driver#serializable-retries).

The strategy doesn't retry `CADB0509` `TransactionFinalizeUnresolved`. This code
means that the commit or rollback doesn't have a final answer yet. Send the same
commit or rollback again for the same transaction, and don't replay the unit of
work.

The default retry settings are as follows:

| Parameter | Default | Description |
| --- | --- | --- |
| `maxRetryCount` | `15` | The maximum number of retries. |
| `maxRetryDelay` | `1 s` | The maximum delay between retries. |
| `retryDeadline` | `5 s` | The deadline, from the first failure. |
| `medianFirstRetryDelay` | `30 ms` | The median delay of the first retry. |

You can change them:

```csharp
camus.EnableRetryOnFailure(
    maxRetryCount: 5,
    maxRetryDelay: TimeSpan.FromMilliseconds(500),
    retryDeadline: TimeSpan.FromSeconds(3),
    medianFirstRetryDelay: TimeSpan.FromMilliseconds(20));
```

The execution strategy retries the complete EF operation. If you manage an
explicit transaction, replay the transaction from the start. Don't retry the
failed statement alone.

## Prepared statements

The .NET driver prepares EF Core queries and `SaveChangesAsync()` statements
automatically, after the same SQL has executed enough times. You don't need EF
configuration or `Prepare()` calls. LINQ queries and change-tracking writes
usually produce the same parameterized SQL for each operation. This means that
they benefit from preparation.

A prepared execution behaves like an inline one, also for transactions and the
query result cache.

To change the policy, use the connection string keys:

```csharp
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseCamusDB(
        "Endpoint=http://localhost:5095;Database=mydb;MaxAutoPrepare=256;AutoPrepareMinUsages=2")
    .Options;
```

`MaxAutoPrepare=0` turns off automatic preparation. For more information, see
[Prepared statements](/docs/dotnet-driver#prepared-statements) in the driver
page, and [Prepared statements](/docs/prepared-statements).

## Query result cache

To use the CamusDB query result cache for a LINQ query, add `WithCache(...)`.
The provider adds the `{cache=...}` hint to the generated SQL:

```csharp
using CamusDB.EntityFrameworkCore;

List<Order> recent = await ctx.Orders
    .Where(o => o.Status == 1)
    .OrderByDescending(o => o.Total)
    .Take(20)
    .WithCache("recent_orders", ttl: TimeSpan.FromSeconds(30), strict: true)
    .ToListAsync();
```

The cache applies to autocommit reads of one table. A query with a join, a
query through a view, and a query in an explicit transaction read live storage.

To evict cache entries, use `EvictCacheAsync(...)` or `EvictAllCacheAsync()` on
the `CamusConnection`. For more information, see
[Query result cache](/docs/query-result-cache).

## Migrations

The provider includes design-time services. This means that the standard EF
tools can find it:

```bash
dotnet ef migrations add InitialCreate
dotnet ef database update
```

The following migration operations are supported:

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
| Raw SQL | Sent as written. |

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

A migration can change the nullability of a column if the stored type doesn't
change. A change of the column type isn't supported.

`DropCheckConstraint` emits `DROP CONSTRAINT`. CamusDB finds the named `CHECK`
or named `NOT NULL` constraint.

## Comments

For table and column comments, use the `HasComment` API of EF Core. For index
comments, use the `HasComment` extension of the provider:

```csharp
modelBuilder.Entity<User>(b =>
{
    b.ToTable("users", t => t.HasComment("Application users"));
    b.Property(u => u.Email).HasComment("Unique login email address");
    b.HasIndex(u => u.Email, "email_idx").HasComment("Lookup by login email");
});
```

When a comment changes, migrations emit `COMMENT ON ...`. When you remove a
comment, they emit `COMMENT ON ... IS NULL`. EF Core doesn't have a model API for
database comments. Use raw SQL:

```csharp
migrationBuilder.Sql("COMMENT ON DATABASE app IS 'Application database'");
```

Comments help people and AI agents that inspect the database through the
CamusDB MCP server.

## Views

To map a read-only entity to a CamusDB view, use `ToView(...)`:

```csharp
modelBuilder.Entity<OpenOrder>().HasNoKey().ToView("open_orders");
```

EF Core doesn't create view migrations. The provider has migration helpers for
them:

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

Use `HasNoKey()` for a view projection type, and don't save it with
`SaveChanges()`. A read through a view can use joins and aggregation. However,
the query result cache doesn't apply to it.

A materialized view stores its rows. To query it, map it as a table, but don't
write to it. To refresh it, use SQL:

```csharp
await ctx.Database.ExecuteSqlRawAsync(
    "REFRESH MATERIALIZED VIEW customer_totals");
```

## Truncate tables

To empty a base table, and not load its rows into the change tracker, use
`TruncateTableAsync(...)`:

```csharp
await ctx.Database.TruncateTableAsync("staging_imports");
ctx.ChangeTracker.Clear();
```

`TRUNCATE TABLE` isn't allowed in an explicit transaction. The table schema and
indexes stay the same. You can recover the old contents during the retention
window. For more information, see [TRUNCATE TABLE](/docs/truncate-table).

## Relationships and foreign keys

Migrations and `EnsureCreated()` create a CamusDB `FOREIGN KEY` constraint for
each relationship of the EF model:

```csharp
modelBuilder.Entity<Customer>()
    .HasMany(c => c.Orders)
    .WithOne()
    .HasForeignKey(o => o.CustomerId);
```

The server checks the constraint at the end of each statement, in the
transaction of the statement:

- A child row that doesn't have a parent returns `CADB0304`.
- A delete of a referenced parent key returns `CADB0305`.
- An update of a referenced parent key returns `CADB0306`.

The server supports the `NO ACTION` and `RESTRICT` actions. EF Core uses cascade by default for required relationships. The
provider sends the other actions, such as `Cascade`, as `NO ACTION`. EF Core applies these actions to
the dependents that the context tracks. If the dependents aren't tracked, delete them first. You
can also use `DeleteBehavior.Restrict`.

A foreign key needs an index whose leading columns are the referencing columns.
Migrations use the index that EF creates for the relationship. If the model
doesn't have an index for it, `EnsureCreated()` lets the server create one.

To use EF relationships for ordering and navigation, but not create foreign key
constraints, use `UseForeignKeyConstraints(false)`:

```csharp
optionsBuilder.UseCamusDB(connectionString, o =>
    o.UseForeignKeyConstraints(false));
```

## Concurrency

The provider supports two EF Core optimistic-concurrency styles.

`[Timestamp]` or `IsRowVersion()` on a `byte[]` property creates a row-version
token that the provider manages. The provider writes a new token on each insert
and update. EF adds the original token to the condition of the update:

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

`[ConcurrencyCheck]` is supported on integer properties (`short`, `int`, or
`long`):

```csharp
public sealed class Order
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";

    [ConcurrencyCheck]
    public long Version { get; set; }
}
```

Increment the version in your application code before you save:

```csharp
order.Status = "shipped";
order.Version++;
await ctx.SaveChangesAsync();
```

In an explicit transaction, `SaveChangesAsync()` can succeed and a conflict can
then occur at `CommitTransactionAsync()`. With optimistic locking, conflicts are
checked at the commit. For more information, see
[Locking strategy](/docs/serializable-transactions#pessimistic-and-optimistic-locking).

## Current limitations

The provider doesn't emulate database features that CamusDB doesn't support:

- The server supports `NO ACTION` and `RESTRICT` foreign keys. EF applies the
  other actions to the dependents that it tracks.
- Foreign key cycles of two or more tables aren't supported. A table can
  reference itself.
- Computed columns aren't supported.
- `ALTER COLUMN` can only change nullability. To change the stored type, write a
  manual migration.
- Migrations can't add or drop a primary key.
- Array predicates are limited to the translations in
  [Type mapping](#type-mapping).
- Bulk writes don't support outer joins.

The model has these restrictions:

- A key must be a `string`, `Guid`, `short`, `int`, or `long` property.
- `[ConcurrencyCheck]` is for numeric columns. For a `byte[]` row version, use
  `[Timestamp]` or `IsRowVersion()`.
- Vector embeddings are stored in `BYTES` columns. There isn't a separate vector
  type.
- A `NUMERIC` value with more significant digits than a .NET `decimal` throws
  when it is read into a `decimal` property. If such values can occur, map the
  property as a `string`.
