---
sidebar_position: 2.75
toc_max_heading_level: 2
---

# Parameters and prepared statements

Parameters keep SQL separate from application data. They prevent SQL injection,
and you can run the same statement again with different values. The
[.NET](/docs/dotnet-driver), [TypeScript](/docs/typescript-connector), and
[Python](/docs/python-driver) drivers bind named parameters and encode the
values for you.

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

The .NET and TypeScript drivers prepare repeated statements automatically. They
manage the server handles, and they register a statement again when its handle
expires. You can also prepare a statement before its first execution, with
`CamusCommand.PrepareAsync()` or `client.prepare(sql)`. For the tuning options,
see the [.NET](/docs/dotnet-driver#prepared-statements) and
[TypeScript](/docs/typescript-connector#prepared-statements) APIs.

The Python driver binds parameters, but it doesn't use server-side prepared
statements.

A prepared statement belongs to the node that prepared it. It isn't replicated.
Behind a load balancer, a driver prepares each statement once on each node that
it reaches.

## What preparing saves

An inline request sends the full statement text each time, and the server parses
it again. A prepared statement is parsed and registered once. This means that
each later execution skips the transfer of the text and the parse.

The following measurements are for an `INSERT` with 5 parameterized columns (see
`CamusDB.MicroBenchmarks/BENCH-RESULTS.md`):

| | Inline | Prepared |
|---|---:|---:|
| Bytes on the wire, per execution | 198 B | 43 B |
| Transport prologue (message parse plus routing parse) | 9,040.5 ns / 6152 B | 134.5 ns / 856 B |

After that, the execution is the same, for example the isolation and the
retries. You need [retry helpers](/docs/serializable-retries) for transactions
as usual.

## What you can prepare

You can prepare `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `SHOW` statements.
This includes node-level statements such as `SHOW VARIABLES`, and
[SELECT FOR UPDATE](/docs/sql-queries#for-update). A prepared
`SELECT FOR UPDATE` takes row locks at execution time.

Schema, database, and user administration statements return `CADB0400` when
you try to prepare them.

The privileges aren't checked when you prepare a statement. They're checked
at each execution, for the user of that request.

## Parameter names

A name that appears more than once binds one value, and all its occurrences use
that value. This also applies to names in subqueries:

```camussql
SELECT id FROM orders WHERE created_at >= @since OR updated_at >= @since
```

The .NET and TypeScript drivers accept a name with or without the leading `@`.
A named argument that matches no parameter is an error. A parameter that
gets no argument is also an error, and it doesn't become `NULL`. This means that a
spelling mistake can't give a wrong result.

## Limits

Each limit is a `config.yml` key (see [Configuration](/docs/configuration)).
For all keys except `prepared_statement_sweep_interval_ms`, `0` means no limit.
A negative value stops the startup.

| Key | Default | Meaning |
|---|---:|---|
| `grpc_max_prepared_statements_per_stream` | 512 | Statements on one `BatchExecute` stream. |
| `rest_max_prepared_statements_per_principal` | 512 | REST statements of one user, on one node. |
| `rest_max_prepared_statements` | 8192 | REST statements on one node, for all users. |
| `max_prepared_statement_bytes` | 65536 | The largest statement, on both transports. The size includes the database name, the SQL, and the parameter names, in UTF-16. |
| `grpc_max_prepared_statement_bytes_per_stream` | 8 MiB | The statement text of one `BatchExecute` stream. |
| `rest_max_prepared_statement_bytes_per_principal` | 8 MiB | The statement text of one REST user. |
| `rest_max_prepared_statement_bytes` | 64 MiB | The statement text on one node. |
| `prepared_statement_idle_timeout_ms` | 600000 | How long an unused REST statement is kept. `0` turns off the cleanup. |
| `prepared_statement_sweep_interval_ms` | 60000 | The interval of the cleanup. The value must be greater than 0. |

The count limits and the byte limits work together. A count limit alone doesn't
limit memory, because each statement can be as large as
`max_prepared_statement_bytes`.

Inline SQL, including a statement that you prepare, is also checked against
[max_statement_bytes](/docs/settings-reference#request-resource-limits), in
UTF-8, before the parse.

A statement larger than `max_prepared_statement_bytes` returns `CADB0400`. A
registration over a count or byte limit returns `CADB0521`
`PreparedStatementLimitExceeded`, with HTTP 429.

A live handle isn't removed to make room. The new statement returns an
error, and the client must close the statements that it no longer needs.
Expired REST statements are removed first. This means that you reach a limit
when all your statements are in use.

## Related pages

- [.NET driver](/docs/dotnet-driver)
- [TypeScript connector](/docs/typescript-connector)
- [Python driver](/docs/python-driver)
- [HTTP API](/docs/http-api#prepared-statements) and
  [gRPC API](/docs/grpc-api#prepared-statements), for the messages that a custom
  client sends.
