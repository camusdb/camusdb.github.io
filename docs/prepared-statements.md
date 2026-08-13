---
sidebar_position: 2.75
---

# Parameters And Prepared Statements

Never build SQL by concatenating values into the statement text. Use
placeholders, and let the client bind the values.

## Placeholders

A placeholder is `@name`, and it can stand in for any value:

```camussql
SELECT id, name FROM robots WHERE id = @id;
UPDATE robots SET name = @name WHERE id = @id;
SELECT id, name FROM robots WHERE year >= @year LIMIT @limit;
```

Values are bound by whichever client submits the statement — `camus-cli`, an
HTTP or gRPC request, or a driver. Over HTTP, they travel in a `parameters`
object keyed by placeholder name:

```json
{
  "databaseName": "app",
  "sql": "SELECT id, name FROM robots WHERE year >= @year",
  "parameters": {
    "@year": {
      "type": 2,
      "strValue": null,
      "longValue": 1970,
      "floatValue": 0,
      "boolValue": false
    }
  }
}
```

For binding details per client, see [HTTP API](/docs/http-api),
[gRPC API](/docs/grpc-api), and [.NET Driver](/docs/dotnet-driver).

## Prepared Statements

A prepared statement registers a SQL statement once so a client can execute it
many times with different values — worth doing for a hot lookup, an insert loop,
an update by primary key, or an ORM query that runs many times per process.

The saving is at the client/protocol boundary. After registration, each
execution sends a handle and positional values instead of the full SQL text and
parameter-name map. A benchmarked five-column insert dropped from a 198-byte
inline request to a 43-byte prepared execution, and the server skipped the
repeated transport parse it would otherwise need before routing the statement.

Behavior is otherwise identical to inline execution:

- same rows and affected-row counts
- same Serializable isolation and retry behavior
- same transaction, locking, and read-only semantics
- same query result cache hints and cache metadata
- same authorization checks at execution time

### What Can Be Prepared

CamusDB can prepare:

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`
- `SHOW ...`

Schema, database, and user administration statements are one-shot operations
and cannot be prepared. `/execute-sql-ddl` and unary gRPC DDL calls reject
prepared handles.

Prepared statements are a client API feature. There is no SQL `PREPARE`
statement to type in `camus-cli`.

### Parameter Binding

Prepare replies include the parameter names found in the SQL text. The order is
the first time each distinct placeholder appears.

```camussql
SELECT id, name
FROM robots
WHERE kind = @kind OR backup_kind = @kind
  AND year >= @min_year;
```

The binding order for that statement is:

```text
["@kind", "@min_year"]
```

Prepared executions send values by ordinal:

- value `0` binds to `@kind`
- value `1` binds to `@min_year`

If the same placeholder appears more than once, it still has one slot. The
execution must send exactly the number of values returned by prepare. Parameter
names are returned verbatim, including the `@` prefix.

### REST Lifecycle

Register a statement with `/prepare-sql-statement`:

```http
POST /prepare-sql-statement
Content-Type: application/json

{
  "databaseName": "factory",
  "sql": "SELECT id, name FROM robots WHERE year >= @year"
}
```

Response:

```json
{
  "status": "ok",
  "statementId": "opaque-node-local-handle",
  "parameterNames": ["@year"]
}
```

Execute it through the normal SQL endpoints by sending `statementId` and
`positionalParameters`:

```http
POST /execute-sql-query
Content-Type: application/json

{
  "statementId": "opaque-node-local-handle",
  "positionalParameters": [
    { "type": 2, "longValue": 1980 }
  ],
  "isolationLevel": "Serializable",
  "transactionMode": "ReadOnly"
}
```

Prepared execution is accepted by:

- `/execute-sql-query`
- `/execute-sql-query-stream`
- `/execute-sql-non-query`

When `statementId` is present, omit `sql`, `databaseName`, and named
`parameters`. The database and SQL text are the ones captured by the prepared
handle.

Close a REST handle when the client no longer needs it:

```http
POST /close-sql-statement
Content-Type: application/json

{ "statementId": "opaque-node-local-handle" }
```

Close is idempotent.

### gRPC Lifecycle

Prepared statements live on `CamusSql.BatchExecute`, the bidirectional SQL
batch stream.

Use a `PREPARE` batch operation with `(database, sql)`. The terminal
`PrepareReply` returns:

- `statement_id`: an integer handle scoped to that batch stream
- `parameter_names`: the ordinal binding order

Then send a `QUERY` or `NON_QUERY` operation with:

- `statement_id`
- `positional_parameters`

Do not send `sql`, `database`, or named `parameters` on an execution that uses
`statement_id`.

Use a `CLOSE` batch operation to release a stream-local handle. Close is
idempotent.

Wait for the `PrepareReply` before sending an execution that references the new
`statement_id`. Batch operations may run concurrently, so an execution can
arrive before registration if the client pipelines both messages without
waiting.

Unary gRPC calls do not support prepared handles because they have no stream
scope for handle ownership.

### Handle Scope

Prepared handles are node-local. They are not replicated to other nodes.

REST handles are scoped to:

- the node that prepared them
- the authenticated principal, or the anonymous principal when authentication
  is disabled
- the handle's idle lifetime

gRPC handles are scoped to:

- the node that owns the `BatchExecute` stream
- the specific `BatchExecute` stream that prepared them

A gRPC handle disappears when the stream closes or is rebuilt.

### Authorization

Preparing a statement parses and registers it. Authorization runs when the
statement is executed, using the principal that executes it.

This means a statement can prepare successfully and later fail with
`CADB0517` `InsufficientPrivilege` if the executing user does not have the
required privileges for the affected database, table, or statement.

### Unknown Handles

An execution can fail with `CADB0520` `UnknownPreparedStatement` when the node
does not recognize the handle. This is a routine condition, not data loss.

Common causes include:

- the handle expired after sitting idle
- the server restarted
- a load balancer sent a REST execution to a different node
- a gRPC stream was rebuilt
- the handle was closed
- the handle belongs to another authenticated principal

Clients should prepare the statement again and replay the execution once. For a
streaming query, only replay automatically if no rows have been returned to the
caller yet.

### Limits

CamusDB refuses new registrations that exceed prepared-statement caps. It does
not silently evict an existing handle that a client may still use.

The relevant settings are:

```yaml
prepared_statement_idle_timeout_ms: 600000
prepared_statement_sweep_interval_ms: 60000
grpc_max_prepared_statements_per_stream: 512
rest_max_prepared_statements_per_principal: 512
rest_max_prepared_statements: 8192
max_prepared_statement_bytes: 65536
grpc_max_prepared_statement_bytes_per_stream: 8388608
rest_max_prepared_statement_bytes_per_principal: 8388608
rest_max_prepared_statement_bytes: 67108864
```

Exceeding a statement-count or retained-byte cap returns `CADB0521`
`PreparedStatementLimitExceeded`. Close handles you no longer need, reduce the
number of distinct statement shapes, or raise the relevant cap.

`max_prepared_statement_bytes` bounds the size of one prepared SQL text. A
statement larger than that limit is rejected at registration.

See [Configuration](/docs/configuration#prepared-statements) for the full
setting descriptions.

### .NET Driver

The .NET ADO.NET driver prepares repeated statements automatically. Once the
same SQL has been seen enough times, later executions use prepared handles
without application code changes.

You can also call `Prepare()` or `PrepareAsync()` on `CamusCommand` for a hot
statement you know should be registered immediately.

See [.NET Driver](/docs/dotnet-driver#prepared-statements) and
[EF Core Provider](/docs/ef-core) for driver-level behavior and tuning.

## Related Pages

- [SELECT](/docs/sql-queries)
- [HTTP API](/docs/http-api#prepared-statements)
- [gRPC API](/docs/grpc-api#prepared-statements)
- [Configuration](/docs/configuration#prepared-statements)
- [Error Codes](/docs/error-codes)
