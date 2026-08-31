---
sidebar_position: 3
---

# HTTP API

CamusDB exposes endpoints of JSON. They serve an automation, and an integration
with an application. Each property of a request, and each property of a
response, uses camel case.

For a client of HTTP/2, and for a client that uses Protobuf, see
[gRPC API](/docs/grpc-api). The API of REST with JSON, and the API of gRPC, both
reach the same engine. That engine covers the SQL, the transactions, and the
operations on a row.

## Status and errors

Successful responses use:

```json
{
  "status": "ok"
}
```

A failed response holds a code of an error of CamusDB, where one is available.

Many errors of the domain map to the HTTP status 500. Six other groups use their
matching status: an authentication, an authorization, a validation, an object
that is absent, a conflict, and a limit of a rate:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

See [Error Codes](/docs/error-codes) for the list of the reference. That page
also gives the cause of each code.

## Cancellation

If an HTTP client cancels a request or disconnects while a query is still
running, CamusDB propagates that cancellation into the query pipeline. Scans,
joins, grouping, sorting, distinct, and subquery execution stop at their next
storage read or operator boundary instead of continuing to consume work after
the caller is gone.

For long reads, prefer the streaming query endpoint when your client can consume
rows incrementally. If the client stops reading early, the server treats the
remaining work as abandoned and cleans up the query.

## Authentication

While the authentication is enabled, use `/login`. It gives you a bearer token:

```http
POST /login
Content-Type: application/json

{ "user": "admin", "password": "secret" }
```

Successful response:

```json
{
  "status": "ok",
  "token": "camus_<id>.<secret>",
  "expiresAtUnixMs": 1785270000000,
  "expiresInSeconds": 900
}
```

Send the token on later requests:

```http
Authorization: Bearer camus_<id>.<secret>
```

Use `/logout` with the same header. It revokes the current token.

`expiresAtUnixMs` is the absolute deadline of the token, in UTC.

`expiresInSeconds` is the same deadline, as a duration that the server measured.
That form helps a client that renews on a timer. Such a client does not trust
its own wall clock.

See [Authentication And Authorization](/docs/sql-authentication) for four
subjects: the environment variables, the statements of SQL for a user and a
grant, the requirements of TLS, and the enforcement of a privilege.

## Column values

Six things use a `ColumnValue` object: a row, a filter, an insert, an update, a
default, and a parameter of the SQL:

CamusDB serializes a `ColumnType` as the numeric value of its enum:

| Value | Type |
| --- | --- |
| `0` | null |
| `1` | id / object id |
| `2` | int64 |
| `3` | string |
| `4` | bool |
| `5` | float64 |
| `6` | float32 |
| `7` | bytes |
| `8` | date |
| `9` | datetime |
| `10` | array |
| `11` | uuid |

```json
{ "type": 3, "strValue": "R2-D2", "longValue": 0, "floatValue": 0, "boolValue": false }
{ "type": 2, "strValue": null, "longValue": 1977, "floatValue": 0, "boolValue": false }
{ "type": 5, "strValue": null, "longValue": 0, "floatValue": 12.5, "boolValue": false }
{ "type": 6, "strValue": null, "longValue": 0, "floatValue": 12.5, "boolValue": false }
{ "type": 4, "strValue": null, "longValue": 0, "floatValue": 0, "boolValue": true }
{ "type": 1, "strValue": "507f1f77bcf86cd799439011", "longValue": 0, "floatValue": 0, "boolValue": false }
{ "type": 7, "bytesValue": "3q2+7w==", "longValue": 0, "floatValue": 0, "boolValue": false }
{ "type": 8, "longValue": 639039456000000000, "isoValue": "2026-03-15" }
{ "type": 9, "longValue": 639039888000000000, "isoValue": "2026-03-15T12:00:00.0000000Z" }
{ "type": 10, "arrayElementType": 2, "arrayValues": [{ "type": 2, "longValue": 42 }] }
{ "type": 11, "strValue": "550e8400-e29b-41d4-a716-446655440000", "longValue": 0, "uuidHigh": 0 }
```

For a value of bytes, a literal of SQL uses the hexadecimal form `X'...'`. The
JSON uses base64 instead, in a `bytesValue`.

For a date and for a datetime, a response holds an `isoValue`. The stored value
appears as UTC ticks, in a `longValue`.

For a UUID in a request, pass the canonical text with hyphens, or a hexadecimal
text of 32 characters. Put it in the `strValue`. A response also holds a
`uuidValue`, for a reader.

## Health

### `GET /ping`

Returns server status and UTC time.

```json
{
  "status": "ok",
  "dateTime": "2026-05-28T18:30:00.0000000Z"
}
```

## Databases

You must create a database explicitly first. Only then can a DDL statement of a
table, a DML statement, and a query use the name of that database.

### `POST /create-db`

```json
{
  "databaseName": "app",
  "ifNotExists": true
}
```

### `POST /drop-db`

```json
{
  "databaseName": "app"
}
```

The direct endpoint drops an existing database. Use SQL for a drop that you can
repeat safely:

```json
{
  "sql": "DROP DATABASE IF EXISTS app"
}
```

SQL also exposes a rename of a database:

```json
{
  "sql": "RENAME DATABASE app TO app_prod"
}
```

CamusDB also accepts the equivalent form, `ALTER DATABASE ... RENAME TO`:

```json
{
  "sql": "ALTER DATABASE app RENAME TO app_prod"
}
```

### `POST /close-db`

```json
{
  "databaseName": "app"
}
```

## Tables

### `POST /create-table`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "ifNotExists": true,
  "columns": [
    { "name": "id", "type": "id", "notNull": true, "defaultValue": null },
    { "name": "name", "type": "string", "maxLength": 64, "notNull": true, "defaultValue": null },
    { "name": "payload", "type": "bytes", "notNull": false, "defaultValue": null },
    { "name": "tags", "type": "array", "arrayElementType": "string", "notNull": false, "defaultValue": null },
    {
      "name": "year",
      "type": "int64",
      "notNull": false,
      "defaultValue": {
        "type": 2,
        "strValue": null,
        "longValue": 2024,
        "floatValue": 0,
        "boolValue": false
      }
    }
  ]
}
```

The model of a creation of a table over HTTP accepts twelve types: `id`,
`int64`, `float64`, `float32`, `bool`, `string`, `date`, `datetime`, `bytes`,
`uuid`, `guid`, and `array`.

Use a `maxLength` for the limit of a `string`, and for the limit of a `bytes`
value. Use an `arrayElementType` for a column of an array.

See [Data Types](/docs/data-types) for the names of SQL, the aliases, the
formats of a literal, and the rules of a value of JSON.

## SQL execution

Use the endpoints of SQL where that is possible. They use the same parser and
the same executor as the tests of the engine.

A request of SQL in autocommit mode uses the Serializable isolation, by
default.

A request that starts a transaction in autocommit mode accepts two fields. Set
the `isolationLevel` to `"Serializable"`, or to `"ReadCommitted"`. Set the
`transactionMode` to `"ReadWrite"`, or to `"ReadOnly"`.

A request in autocommit mode that writes can also set the `locking`. Use
`"Pessimistic"`, or `"Optimistic"`.

A request that starts a transaction can set the `priority`. Use `"Background"`,
`"Low"`, `"Normal"`, `"High"`, or `"Critical"`.

CamusDB ignores these fields when the request resumes an existing transaction,
with a `txnIdPT` and a `txnIdCounter`.

A read-only request to `/execute-sql-query` also ignores the `locking`. Such a
request runs no transaction that writes. It therefore acquires no write
conflict, and it validates none.

### `POST /execute-sql-ddl`

For schema-changing SQL:

```json
{
  "databaseName": "app",
  "sql": "CREATE TABLE IF NOT EXISTS robots (id OID PRIMARY KEY NOT NULL, name STRING NOT NULL, year INT64)",
  "parameters": null
}
```

Server-level database statements can omit `databaseName`:

```json
{
  "sql": "CREATE DATABASE IF NOT EXISTS app",
  "parameters": null
}
```

A query at the level of the server, for an operation, can also omit the
`databaseName`. `SHOW ENGINE STATS` is one example.

### `POST /execute-sql-query`

For `SELECT` and `SHOW` statements:

```json
{
  "databaseName": "app",
  "sql": "SELECT id, name FROM robots WHERE year >= @year ORDER BY name ASC",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadOnly",
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

Response:

```json
{
  "status": "ok",
  "total": 1,
  "rows": [
    {
      "id": { "type": 1, "strValue": "507f1f77bcf86cd799439011", "longValue": 0, "floatValue": 0, "boolValue": false },
      "name": { "type": 3, "strValue": "R2-D2", "longValue": 0, "floatValue": 0, "boolValue": false }
    }
  ]
}
```

This endpoint supports a read with time travel, through an `AS OF SYSTEM TIME`.
The statement must be a read-only `SELECT`, in autocommit mode:

```json
{
  "databaseName": "app",
  "sql": "SELECT id, name FROM robots AS OF SYSTEM TIME '-10s' WHERE year >= @year",
  "transactionMode": "ReadOnly",
  "parameters": {
    "@year": {
      "type": 2,
      "longValue": 1970
    }
  }
}
```

The restrictions of the SQL also apply over HTTP. The clause cannot run inside
an explicit transaction. An invalid value of a time travel returns `CADB0409`
`InvalidAsOfSystemTime`. See [Time-Travel Reads](/docs/time-travel-reads).

### `POST /execute-sql-query-stream`

For a large result of a `SELECT`, and for a large result of a `SHOW`, use the
endpoint that streams:

```json
{
  "databaseName": "app",
  "sql": "SELECT id, name FROM robots ORDER BY name",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadOnly",
  "parameters": null
}
```

The body of the request has the same shape as the body of
`/execute-sql-query`. The response uses JSON with one object on each line. Its
type of the content is `application/x-ndjson`:

```json
{"status":"ok","columns":[{"name":"id","type":1},{"name":"name","type":3}]}
["507f1f77bcf86cd799439011","R2-D2"]
["507f1f77bcf86cd799439012","C-3PO"]
{"status":"ok","total":2,"serverTimeMs":3.1}
```

The first line is the header of the schema. Each row is a compact array by
position. It follows the order of the columns of that header.

The last line is a trailer. It holds four values: the final status, the total of
the rows of the stream, an optional causal token, and the time of the server.

An error can happen before the first line. CamusDB then returns an ordinary body
of an error in JSON, with the matching status of HTTP.

An error can also happen after the start of the stream. The status of HTTP can
be `200` already. CamusDB therefore reports the failure in the last trailer:

```json
{"status":"failed","total":128,"code":"CADB0502","message":"transaction conflict","serverTimeMs":12.4}
```

A stream in autocommit mode runs one attempt. A row can already be on the wire
before the commit. The server therefore cannot replay a late conflict of the
Serializable isolation without your knowledge. The endpoint that buffers can do
that.

Use `/execute-sql-query` when an automatic retry of an autocommit matters more
than a delivery in parts. You can also use an explicit transaction, and retry
from the client.

### `POST /execute-sql-non-query`

For `INSERT`, `UPDATE`, and `DELETE` statements:

```json
{
  "databaseName": "app",
  "sql": "UPDATE robots SET name = @name WHERE id = @id",
  "parameters": {
    "@name": { "type": 3, "strValue": "Artoo", "longValue": 0, "floatValue": 0, "boolValue": false },
    "@id": { "type": 1, "strValue": "507f1f77bcf86cd799439011", "longValue": 0, "floatValue": 0, "boolValue": false }
  }
}
```

Response:

```json
{
  "status": "ok",
  "rows": 1
}
```

## Prepared statements

A prepared statement lets a client register a statement of SQL one time. That
client then executes the statement many times, by its handle, with different
values by position.

A prepared statement helps with a hot statement that has parameters. It covers a
`SELECT`, an `INSERT`, an `UPDATE`, a `DELETE`, and a `SHOW`.

Register a statement:

```http
POST /prepare-sql-statement
Content-Type: application/json

{
  "databaseName": "app",
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

Execute the statement through one of three endpoints: `/execute-sql-query`,
`/execute-sql-query-stream`, or `/execute-sql-non-query`:

```json
{
  "statementId": "opaque-node-local-handle",
  "positionalParameters": [
    { "type": 2, "longValue": 1980 }
  ],
  "transactionMode": "ReadOnly"
}
```

With a `statementId` present, omit three fields: the `sql`, the `databaseName`,
and the named `parameters`.

The `positionalParameters[i]` binds to the `parameterNames[i]` of the response of
the prepare.

Close a handle:

```http
POST /close-sql-statement
Content-Type: application/json

{ "statementId": "opaque-node-local-handle" }
```

A handle of REST belongs to the node that prepared it, and to the principal that
prepared it.

An execution can return `CADB0520` `UnknownPreparedStatement`. Prepare the
statement again. Then replay the execution one time.

See [Prepared Statements](/docs/prepared-statements) for the scope of a handle,
for the behavior of the authorization, and for the limits.

## Direct row operations

A direct endpoint accepts a filter, instead of a string of SQL. A filter holds
three parts: the name of a column, an operator, and a `ColumnValue`.

An `OrderType` is also numeric. A `0` is ascending. A `1` is descending.

```json
{
  "columnName": "year",
  "op": ">=",
  "value": {
    "type": 2,
    "strValue": null,
    "longValue": 1970,
    "floatValue": 0,
    "boolValue": false
  }
}
```

### `POST /insert`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "values": {
    "id": { "type": 1, "strValue": "507f1f77bcf86cd799439011", "longValue": 0, "floatValue": 0, "boolValue": false },
    "name": { "type": 3, "strValue": "R2-D2", "longValue": 0, "floatValue": 0, "boolValue": false },
    "year": { "type": 2, "strValue": null, "longValue": 1977, "floatValue": 0, "boolValue": false }
  }
}
```

### `POST /query`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "filters": [
    {
      "columnName": "year",
      "op": ">=",
      "value": { "type": 2, "strValue": null, "longValue": 1970, "floatValue": 0, "boolValue": false }
    }
  ],
  "orderBy": [
    { "columnName": "year", "type": 1 }
  ]
}
```

### `POST /query-by-id`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "id": "507f1f77bcf86cd799439011"
}
```

### `POST /update`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "values": {
    "name": { "type": 3, "strValue": "Artoo", "longValue": 0, "floatValue": 0, "boolValue": false }
  },
  "filters": [
    {
      "columnName": "id",
      "op": "=",
      "value": { "type": 1, "strValue": "507f1f77bcf86cd799439011", "longValue": 0, "floatValue": 0, "boolValue": false }
    }
  ]
}
```

### `POST /delete`

```json
{
  "databaseName": "app",
  "tableName": "robots",
  "filters": [
    {
      "columnName": "year",
      "op": "<",
      "value": { "type": 2, "strValue": null, "longValue": 1970, "floatValue": 0, "boolValue": false }
    }
  ]
}
```

## Explicit transactions

Start a transaction:

### `POST /start-transaction`

```json
{
  "databaseName": "app",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadWrite",
  "locking": "Pessimistic",
  "priority": "Normal"
}
```

Four fields are optional: the `isolationLevel`, the `transactionMode`, the
`locking`, and the `priority`.

Without them, the transaction starts with the defaults of the server:

- The isolation level is Serializable.
- The mode of the transaction is read-write.
- The strategy of the locks is pessimistic.
- The priority of the transaction is normal.

Use a `"ReadCommitted"` only for an intentional step down from the default
Serializable behavior.

Use a `"ReadOnly"` together with a `"Serializable"` for a stable transaction of a
snapshot.

Use an `"Optimistic"` when CamusDB must detect a conflict at the commit. It then
takes no explicit lock during the transaction.

Use a priority for the order of the admission only, under a configured gate of
the concurrency.

CamusDB rejects an unknown value of a locking, and an unknown value of a
priority, with an `InvalidInput`.

See [Transaction Priority](/docs/transaction-priority) for the levels of a
priority, and for the configuration of the gate.

Response:

```json
{
  "status": "ok",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

Pass the `txnIdPT` and the `txnIdCounter` to a later request. That request can be
a request of SQL, or a direct request on a row. It then reuses the transaction:

```json
{
  "databaseName": "app",
  "txnIdPT": 123,
  "txnIdCounter": 1,
  "sql": "INSERT INTO robots (id, name) VALUES (GEN_ID(), \"K-2SO\")"
}
```

Commit or roll back:

### `POST /commit-transaction`

```json
{
  "databaseName": "app",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

### `POST /rollback-transaction`

```json
{
  "databaseName": "app",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

A `COMMIT` or a `ROLLBACK` can return `CADB0509`
`TransactionFinalizeUnresolved`. Retry the same request, with the same id of the
transaction.

Do not start a fresh transaction, and do not replay the statements. The original
commit may have succeeded already, on the server.
