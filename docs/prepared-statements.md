---
sidebar_position: 2.75
---

# Parameters and prepared statements

You register a prepared statement one time. You then execute it many times, with
different values. Neither the SQL text nor the names of the parameters travel
again at each execution. The larger benefit is different: the server stops a
parse of the statement at every request, which it did only to decide the route.

Both transports support a prepared statement. gRPC supports it over the duplex
`BatchExecute` stream. REST supports it over `/prepare-sql-statement`, together
with the normal SQL endpoints.

## What it saves

Every inline request pays two costs before any work of the engine starts:

1. A second send and a second deserialization of the statement. Over gRPC, that
   cost covers the `sql` string and the `database` string, plus one .NET string
   for the key of each parameter. The protobuf runtime allocates each one again
   at every request. Over REST, the cost is the same text inside the body of the
   JSON.
2. A parse of the SQL at the transport layer. Both transports parse the
   statement to answer a question about the route. Is the statement a `SHOW
   DATABASES`? Is it a statement with the scope of a database, which must open
   no transaction? That parse does not use the parser cache of the executor.
   Each request pays it in full.

A prepared statement records the parsed root node one time. It records the exact
instances of the strings one time. An execution therefore does neither.

Here are the measurements of an `INSERT` with 5 columns and parameters. See
`CamusDB.MicroBenchmarks/BENCH-RESULTS.md`:

| | Inline | Prepared |
|---|---:|---:|
| Bytes on the wire, for each execution | 198 B | 43 B |
| The prologue of the transport, which is the parse of the message plus the parse for the route | 9,304 ns / 6152 B | 136 ns / 856 B |

The execution after that point is identical. A prepared execution builds the
same ticket. It takes the same path through the engine. The isolation, the
retries, and the behavior of a hint for the cache are all the same.

## Two lifetimes, and the reason for the difference

|  | gRPC | REST |
|---|---|---|
| A handle belongs to | One `BatchExecute` stream | This node, and the principal that prepared the statement |
| The type of a handle | `int32` | An opaque string |
| CamusDB frees it at | The end of the stream, whether normal, cancelled, or in a fault | An explicit close, a timeout after an idle period, or the exit of the process |
| An unknown handle means | The client rebuilt the stream. Prepare the statement again. | The handle expired, or it belongs to another node or another principal. Prepare the statement again. |

That difference is not a preference of the design. A gRPC stream already answers
two questions: who owns a handle, and when that handle ends. Nothing else is
necessary.

HTTP has no session that the server can trust. A connection is pooled, HTTP/2
multiplexes it, and a load balancer moves it. REST therefore supplies those
answers explicitly. It uses a handle that nobody can guess, an owner that
CamusDB records at the registration, and a timeout after an idle period. That
timeout is the backstop for a client that never closes what it prepared.

A handle belongs to one node, on both transports. CamusDB never replicates a
handle. A handle is never valid at any node except the node that created it.

## The binding of a parameter is positional

`PREPARE` replies with the distinct names of the placeholders of the statement,
in the order of the binding. The first occurrence comes first. Each name is
verbatim, and it keeps its leading `@`.

An execution sends the values by ordinal. The value at index number i binds to
the name at index number i.

```camussql
UPDATE robots SET name = @name, year = @year WHERE id = @id
-- parameterNames: ["@name", "@year", "@id"]
```

A name that a statement uses more than one time occupies exactly one slot. Every
occurrence resolves to that one value. The list includes a placeholder inside a
subquery. The number of the values that you send must equal the declared number
exactly.

The names do not travel on the wire, by design. Their removal is much of the
purpose of the feature. A client that prefers a binding by name maps its own
arguments onto the ordinals locally. It uses the published names for that map.

The .NET client for gRPC does that work for you.
`ExecuteQueryAsync(new { id, name })` binds by the name of a property. It
ignores the case, and it accepts the name with or without the leading `@`. It
then sends the ordinals.

Two conditions are an error: a property that matches no parameter, and a
parameter with no property. Neither one becomes a silent `NULL`. A spelling
mistake must not become a wrong answer in silence.

## What you can prepare

You can prepare a `SELECT`, an `INSERT`, an `UPDATE`, a `DELETE`, and a `SHOW`
statement. That covers every `SHOW` statement of the grammar. It includes the
statements with the scope of a node, which run against no database at all. Three
of those are `SHOW ENGINE STATS`, `SHOW VARIABLES`, and `SHOW CLUSTER
SETTINGS`.

You cannot prepare a statement of a schema, of a database, or of the
administration of a user. Such a statement runs one time. Several of them return
no descriptor of a database. None of them gains anything from a handle.

`/execute-sql-ddl` and the unary RPCs of gRPC reject a handle directly. They do
not ignore it.

## gRPC

A prepared statement lives on the duplex `BatchExecute` stream only. A unary
call has no stream to hold a handle.

```
PREPARE (database, sql)  -> PrepareReply { statement_id, parameter_names[] }
QUERY | NON_QUERY (statement_id, positional_parameters[])
CLOSE (statement_id)     -> CloseReply
```

Wait for the `PrepareReply` before you send anything that references the id.
`START` has the same contract. The operations of a stream run at the same time.
An execution that you send before the acknowledgement of its registration may
legitimately arrive first.

An execution that names a handle must not also carry a `sql` field, a `database`
field, or the map of the named `parameters`. CamusDB refuses a request with
both. It does not resolve the two with a rule of precedence.

A repeated `CLOSE` is harmless. A close of an unknown id succeeds. A close of an
id that you closed already also succeeds.

You can skip the close safely. The stream frees everything at its end. A long
stream that prepares many different statements must nevertheless close what it
no longer needs. It then stays under `GrpcMaxPreparedStatementsPerStream`.

### The .NET client

The client hides the handles and the streams completely:

```csharp
await using CamusConnection connection = CamusConnection.Connect("https://localhost:5001");

await using CamusPreparedStatement insert = await connection.PrepareAsync(
    "productiondb", "INSERT INTO robots (id, name, year) VALUES (gen_id(), @name, @year)");

await insert.ExecuteNonQueryAsync(["optimus", 1984L]);          // by ordinal
await insert.ExecuteNonQueryAsync(new { name = "wall-e", year = 2008L });   // or by name

await using CamusPreparedStatement select = await connection.PrepareAsync(
    "productiondb", "SELECT name FROM robots WHERE year = @year");
QueryResult result = await select.ExecuteQueryAsync([2008L]);

// Inside a transaction: the statement registers itself on the session's pinned stream.
CamusTransactionSession txn = await connection.BeginTransactionAsync("productiondb");
await txn.ExecuteNonQueryAsync(insert, ["bumblebee", 1985L]);
await txn.CommitAsync();
```

A `CamusPreparedStatement` stands for the statement. It does not stand for one
handle on the server. The client multiplexes the work of autocommit across a
pool of streams. The statement therefore registers itself lazily, on the stream
that an execution reaches.

A stream can fault, and the client can rebuild it. The handles of that stream
die with it. The client notices this. It compares the transport identity of the
registration immediately before a write. It then registers the statement again,
without your help. A caller never sees an error about an unknown statement.

## REST

### Prepare

```http
POST /prepare-sql-statement
{ "databaseName": "productiondb",
  "sql": "INSERT INTO robots (id, name, year) VALUES (gen_id(), @name, @year)" }

200 { "status": "ok", "statementId": "a1b2c3.9f8e…", "parameterNames": ["@name", "@year"] }
```

A prepare parses the statement, and it registers the statement. It does no
check of a privilege. The authorization runs at the execution, against the
principal of that request. An inline statement behaves the same way.

A prepare therefore reveals nothing except one fact: whether the SQL parses. A
statement that does not parse fails here. It does not fail at some later
execution.

### Execute

Three endpoints accept a `statementId` and a `positionalParameters` array:
`/execute-sql-query`, `/execute-sql-query-stream`, and
`/execute-sql-non-query`:

```http
POST /execute-sql-non-query
{ "statementId": "a1b2c3.9f8e…",
  "positionalParameters": [
    { "type": 3, "strValue": "optimus" },
    { "type": 2, "longValue": 1984 }
  ] }
```

A value uses the same encoding as a value of the inline `parameters` map. An
existing client therefore reuses its serialization without a change.

Every other field of the request behaves exactly as it does inline. That set
covers `txnIdPT`, `txnIdCounter`, `isolationLevel`, `transactionMode`,
`locking`, and `causalToken`.

Three fields must be absent: `sql`, `databaseName`, and `parameters`.

### Close

```http
POST /close-sql-statement
{ "statementId": "a1b2c3.9f8e…" }        ->  200 { "status": "ok" }
```

A repeated close is harmless. You can skip the close safely, because the reaper
of the idle handles collects an abandoned one. A client that prepares an
unbounded number of different statements nevertheless reaches its cap.

### How to handle CADB0520

`CADB0520` is normal. It is not a defect.

An execution fails with `CADB0520` when the node does not know its handle. The
name is `UnknownPreparedStatement`, and the HTTP status is 404.

Treat that error as routine. Prepare the statement again. Then replay the
execution one time. The error occurs in four cases:

- The handle stayed unused past `prepared_statement_idle_timeout_ms`.
- The node restarted.
- A load balancer sent the request to a different node.
- The handle belongs to a different principal. CamusDB reports that case
  identically, by design. An error specific to the ownership would confirm to a
  caller that a handle exists, and that caller does not own it.

Behind a load balancer, use a sticky session. You can also accept one new
prepare for each node and each statement. The steady state after the warm-up is
still one registration for each node.

On the endpoint that streams, CamusDB resolves the handle before it writes any
byte. A 404 therefore arrives as a normal error in JSON. It does not arrive in
the middle of a stream.

## Limits

Every limit is a key of `config.yml`. See
[Configuration](/docs/configuration). CamusDB validates each one at startup. A
negative value is an error at startup. It never becomes a limit without a bound.

| Key | Default | Meaning |
|---|---:|---|
| `grpc_max_prepared_statements_per_stream` | 512 | The live statements of one `BatchExecute` stream. A `0` means no bound. |
| `rest_max_prepared_statements_per_principal` | 512 | The live REST statements of one principal, on one node. |
| `rest_max_prepared_statements` | 8192 | The live REST statements of one node, across every principal. |
| `max_prepared_statement_bytes` | 65536 | The largest single statement, on either transport. The size counts the database, the SQL, and the names of the parameters, in UTF-16. |
| `grpc_max_prepared_statement_bytes_per_stream` | 8 MiB | The text of the statements that one `BatchExecute` stream keeps. |
| `rest_max_prepared_statement_bytes_per_principal` | 8 MiB | The text of the statements that one REST principal keeps. |
| `rest_max_prepared_statement_bytes` | 64 MiB | The text of the statements that one node keeps. |
| `prepared_statement_idle_timeout_ms` | 600000 | The life of an unused REST statement. A `0` disables the reaper. |
| `prepared_statement_sweep_interval_ms` | 60000 | The interval of a sweep of the reaper. The value must be above 0. |

There are limits on a count and limits on a number of bytes, and both are
necessary. A cap on a count alone does not bound the memory. 512 statements
permit 512 times the size of the largest accepted request.

The limit on one statement bounds each term. The budgets bound the total. The
two together therefore have a meaning.

CamusDB rejects a statement above `max_prepared_statement_bytes` as invalid
input. It does not reject it as a failure of a quota. No number of closed
statements would make that statement fit.

A registration past a cap or past a budget fails with `CADB0521`. The name is
`PreparedStatementLimitExceeded`, and the HTTP status is 429.

CamusDB never evicts a live handle for that reason. A silent drop of the handle
that a client used least recently would make a correct client fail at an
unpredictable later moment. The server therefore refuses the new statement. It
asks the caller to close what that caller no longer needs.

CamusDB reclaims an expired REST entry first. A caller therefore meets a limit
only when every one of its statements is truly in use. CamusDB takes the
admission atomically. Two concurrent registrations therefore cannot both pass
through the same last free slot.

A `BatchExecute` stream also has a finite space of ids, which is 2^31
registrations. CamusDB tells a stream that uses them all to open a new stream.
It does not hand out an id that would wrap to an unusable value, and eventually
to a value that collides.

## Related

- [gRPC API](/docs/grpc-api) for the protocol on the wire. That page includes
  the frames of `BatchExecute`, and the classes of a retry.
- [.NET Driver](/docs/dotnet-driver) for the surface of the .NET client.
