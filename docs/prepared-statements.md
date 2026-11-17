---
sidebar_position: 2.75
toc_max_heading_level: 2
---

# Parameters and prepared statements

Bind values as parameters to keep SQL separate from application data and reuse
the same statement with different inputs. Use the [.NET](/docs/dotnet-driver),
[TypeScript](/docs/typescript-connector), or [Python](/docs/python-driver)
driver; each binds named parameters and handles value encoding.

## Use parameters through your driver

### The .NET client

With an open `CamusConnection`:

```csharp
await using var command = connection.CreateCamusCommand(
    "SELECT name FROM robots WHERE year = @year");
command.Parameters.Add("@year", ColumnType.Integer64, 1977L);
await using var reader = await command.ExecuteReaderAsync();
```

### The TypeScript connector

With a configured client:

```ts
const rows = await client.query(
  'SELECT name FROM robots WHERE year = @year', { year: 1977 },
);
```

### The Python driver

With an open Python connection:

```python
rows = conn.execute(
    "SELECT name FROM robots WHERE year = @year", {"year": 1977},
).fetchall()
```

The .NET and TypeScript drivers automatically prepare repeated statements,
manage their server handles, and recover expired registrations. Explicit
preparation is optional: use `CamusCommand.PrepareAsync()` or
`client.prepare(sql)` when you want to prepare before the first execution.
See the [.NET](/docs/dotnet-driver#prepared-statements) and
[TypeScript](/docs/typescript-connector#prepared-statements) APIs for tuning.

Python currently binds parameters without server-side prepared statements.
Its query API stays the same; it does not expose prepared handles.

A prepared statement belongs to the node that prepared it. CamusDB never
replicates it to other nodes. Behind a load balancer, a driver prepares each
statement once on each node it reaches.

## What preparing saves

An inline request sends the full statement text every time, and the server
parses it again before the engine starts any work. A prepared statement is
parsed and registered once, so each later execution skips both steps.

These are the measurements for an `INSERT` with 5 parameterized columns (see
`CamusDB.MicroBenchmarks/BENCH-RESULTS.md`):

| | Inline | Prepared |
|---|---:|---:|
| Bytes on the wire, per execution | 198 B | 43 B |
| Transport prologue (message parse plus routing parse) | 9,040.5 ns / 6152 B | 134.5 ns / 856 B |

From that point on, execution is identical. Isolation, retries, and cache hint
behavior are all the same. Parameters do not replace transaction
[retry helpers](/docs/serializable-retries).

## What you can prepare

You can prepare `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `SHOW` statements.
This includes [SELECT FOR UPDATE](/docs/sql-queries#for-update): preparing it
takes no row lock; executing it uses the locking-read transaction rules.
That covers every `SHOW` statement in the grammar, including the node-scoped
ones that run against no database at all, such as `SHOW ENGINE STATS`,
`SHOW VARIABLES`, and `SHOW CLUSTER SETTINGS`.

You cannot prepare schema, database, or user administration statements. These
run once, several of them return no database descriptor, and none of them
gains anything from a handle.

Preparing a statement checks no privileges. CamusDB checks privileges when the
statement executes, against the user of that request, as it does for an inline
statement.

## Parameter names

A name that appears more than once in a statement binds one value, and every
occurrence uses that value. This includes placeholders inside subqueries:

```camussql
SELECT id FROM orders WHERE created_at >= @since OR updated_at >= @since
```

The .NET and TypeScript drivers accept a name with or without the leading `@`.
A named argument that matches no parameter is an error, and so is a parameter
with no argument. Neither one silently becomes `NULL`, because a spelling
mistake must not silently become a wrong answer.

## Limits

Every limit is a `config.yml` key (see [Configuration](/docs/configuration)).
CamusDB validates each one at startup, and a negative value is a startup error.
It never becomes an unbounded limit.

| Key | Default | Meaning |
|---|---:|---|
| `grpc_max_prepared_statements_per_stream` | 512 | Live statements on one `BatchExecute` stream. `0` means no bound. |
| `rest_max_prepared_statements_per_principal` | 512 | Live REST statements for one principal, on one node. |
| `rest_max_prepared_statements` | 8192 | Live REST statements on one node, across all principals. |
| `max_prepared_statement_bytes` | 65536 | The largest single statement, on either transport. The size counts the database, the SQL, and the parameter names, in UTF-16. |
| `grpc_max_prepared_statement_bytes_per_stream` | 8 MiB | Statement text kept by one `BatchExecute` stream. |
| `rest_max_prepared_statement_bytes_per_principal` | 8 MiB | Statement text kept by one REST principal. |
| `rest_max_prepared_statement_bytes` | 64 MiB | Statement text kept by one node. |
| `prepared_statement_idle_timeout_ms` | 600000 | How long an unused REST statement lives. `0` disables the reaper. |
| `prepared_statement_sweep_interval_ms` | 60000 | How often the reaper sweeps. The value must be above 0. |

You need both count limits and byte limits. A count cap alone does not bound
memory: 512 statements permit 512 times the size of the largest accepted
request.

Inline SQL is also checked against
[max_statement_bytes](/docs/settings-reference#request-resource-limits) in UTF-8
before parsing, including PREPARE. This does not replace the smaller retained
prepared-statement limit or its UTF-16 accounting.

The per-statement limit bounds each term and the budgets bound the total, so
together they are meaningful.

CamusDB rejects a statement above `max_prepared_statement_bytes` as invalid
input, not as a quota failure, because no number of closed statements would
make it fit.

A registration past a cap or budget fails with `CADB0521`
(`PreparedStatementLimitExceeded`, HTTP 429).

CamusDB never evicts a live handle to make room. Silently dropping the least
recently used handle would make a correct client fail at an unpredictable
later moment. Instead, the server refuses the new statement and asks the
caller to close what it no longer needs.

CamusDB reclaims expired REST entries first, so a caller hits a limit only when
all of its statements are truly in use. Admission is atomic, so two concurrent
registrations cannot both take the last free slot.

## Related

- [.NET driver](/docs/dotnet-driver) for the .NET client API.
- [TypeScript](/docs/typescript-connector) for the Node.js client.
- [Python driver](/docs/python-driver) for DB-API and asyncio parameters.
- [HTTP API](/docs/http-api#prepared-statements) and
  [gRPC API](/docs/grpc-api#prepared-statements) for the prepare, execute, and
  close messages, handle ownership, and recovery, when you write your own
  client.
