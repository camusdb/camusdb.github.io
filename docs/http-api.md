---
sidebar_position: 3
---

# HTTP/JSON protocol reference

For application code, start with the [.NET driver](/docs/dotnet-driver),
[TypeScript driver](/docs/typescript-connector), or
[Python driver](/docs/python-driver). Bind parameters and read results through
the library; it handles request serialization, response decoding, and
transaction handles. Use its [retry helpers](/docs/serializable-retries) for
repeatable units of work.

This reference is for authors of drivers and integrations, direct HTTP
clients in languages without a driver, and endpoint-level diagnostics.
Application developers can use CamusDB without reading the request formats
below. For interactive SQL and scripts, use [camus-cli](/docs/camus-cli) or
the [Web Console](/docs/web-console).

## When to use the HTTP API

Direct requests are useful for health probes, testing an endpoint with curl,
or implementing a client. The examples below describe that protocol-level
work. A .NET, TypeScript, or Python script can use its driver just like a
service does.

The HTTP API carries JSON on port 5095 by default. It reaches the same engine
as gRPC, with the same SQL and transactional behavior. The .NET and TypeScript
drivers support both transports; Python currently uses REST. All JSON request
and response properties use camel case.

## Transport

The HTTP API serves JSON over HTTP/1.1 and HTTP/2. The HTTPS port can also serve
HTTP/3 over QUIC when `http3_enabled: true` is set and the node has an HTTPS
certificate.

HTTP/3 uses the same endpoints, request bodies, responses, authentication
headers, and error format as the HTTP/1.1 and HTTP/2 API. It changes only the
transport used between the client and the node.

See [Configuration](/docs/configuration#http3-on-the-https-port) for the
certificate, UDP, and platform QUIC library requirements.

## Status and errors

The SQL query, streaming-query, non-query, and DDL endpoints return CADB0400
for malformed JSON bodies, including escaped lone surrogate halves. The
message gives the JSON path and byte position. This behavior does not yet
cover every administrative endpoint. Valid JSON containing invalid SQL text
or parameters follows the [engine's validation rules](/docs/data-types#characters-and-valid-unicode).

Successful responses use:

```json
{
  "status": "ok"
}
```

A failed response includes a CamusDB error code when one is available.

Many domain errors map to HTTP 500. Authentication, authorization, validation,
not-found, conflict, and rate-limit errors use their matching status:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

Foreign-key violations map to HTTP 409. Invalid foreign-key definitions map to
HTTP 400.

See [Error Codes](/docs/error-codes) for the full list and the cause of each
code.

## Request limits

Inline SQL defaults to an 8 MiB UTF-8 limit (`max_statement_bytes`); larger
text fails before parsing with `CADB0557` and HTTP 413. Bound parameter values
do not count toward that text limit. Buffered `/execute-sql-query` and `/query`
responses default to 1,000,000 rows or 256 MiB of estimated memory. Exceeding
either returns `CADB0556` before commit and rolls back the statement.

For large ordinary reads, use `/execute-sql-query-stream` or pagination.
Writes with RETURNING and other writable reads can still buffer before commit,
so changing transport does not always remove the result cap. These limits,
client-connection caps, and transaction caps are described in
[configuration](/docs/settings-reference#request-resource-limits). They are node
resource bounds, not per-client rate limits or statement timeouts.

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

Driver users configure credentials in the library. A direct HTTP client
exchanges them for a bearer token through `/login`:

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

Call `/logout` with the same header to revoke the current token.

`expiresAtUnixMs` is the token's absolute deadline, in UTC.

`expiresInSeconds` is the same deadline as a duration the server measured. It
helps clients that renew on a timer without trusting their own wall clock.

See [Authentication And Authorization](/docs/sql-authentication) for the
environment variables, the SQL statements for users and grants, TLS
requirements, and privilege enforcement.

## Column values

Request bodies send values as `ColumnValue` objects: SQL parameters, filters,
inserted and updated values, and column defaults. Result rows use a more compact
form, with plain JSON values in column order; see
[`POST /execute-sql-query`](#post-execute-sql-query).

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
| `12` | numeric |
| `13` | jsonb |

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
{ "type": 12, "strValue": "12345678901234567890.123456789" }
{ "type": 13, "strValue": "{\"kind\": \"login\", \"user\": {\"id\": 7}}" }
```

SQL literals write bytes in hexadecimal form, `X'...'`. JSON uses base64
instead, in `bytesValue`.

A vector parameter is a `BYTES` value. Send the packed float32 elements as
base64 in `bytesValue`, with `type` 7. For example, the two-element vector
`[0.0, 1.0]` is `{"type": 7, "bytesValue": "AAAAAAAAgD8="}`. See
[Vector search](/docs/vector-search#how-a-vector-is-stored) for the byte layout.

For dates and datetimes, responses include an `isoValue`, and `longValue`
carries the stored value as UTC ticks.

For a UUID in a request, pass the canonical hyphenated text or a 32-character
hexadecimal string in `strValue`. Responses also include a `uuidValue` for
human readers.

For a numeric value in a request, pass decimal text in `strValue`. CamusDB parses
it as `NUMERIC`, rounds to nine fractional digits when necessary, and rejects a
value outside the supported range. A response exposes the canonical decimal text
as `numericValue`.

Non-finite float cells use JSON strings `"Infinity"`, `"-Infinity"`, and
`"NaN"` while retaining their float column type. Typed float parameters accept
the same spellings in `floatValue`. See
[Floating-point values](/docs/data-types#floating-point-values).

### JSONB values

For a `JSONB` parameter, pass the JSON text in `strValue` with `type` 13:
`{"type": 13, "strValue": "<json text>"}`. A plain string written to a `JSONB`
column also works.

In result rows, a `JSONB` column has type `13`. By default, each cell is the
document itself as native JSON in the row, and numbers keep all their digits.

In this default form, a JSON `null` document and a SQL `NULL` cell are both the
token `null`. A client cannot tell them apart. If the client writes the value
back, it can store SQL `NULL` in place of the document.

To keep the two values apart, set `"jsonbAsText": true` in the request body. The
option applies to `/execute-sql-query`, `/execute-sql-query-stream`, and the
`RETURNING` rows of `/execute-sql-non-query`. Each `JSONB` cell is then a JSON
string that holds the document text. SQL `NULL` stays the token `null`.

| Value | Default form | Text form |
| --- | --- | --- |
| SQL `NULL` | `null` | `null` |
| JSON `null` | `null` | `"null"` |
| `"abc"` | `"abc"` | `"\"abc\""` |
| `{"a": 1}` | `{"a": 1}` | `"{\"a\": 1}"` |

The response marks each `JSONB` column that uses the text form:

```json
{"name": "payload", "type": 13, "jsonbAsText": true}
```

Decode a cell as text only when its column has this mark. A server that does not
know the option ignores it and sends the default form. A string document such
as `"abc"` is valid in both forms, so the mark is the only safe test.

See [JSON documents](/docs/json) for the `JSONB` type and its operators.

## Health

### `GET /ping`

Returns server status and UTC time. `GET /health` is an alias that returns the
same response. Both answer without a credential.

```json
{
  "status": "ok",
  "dateTime": "2026-05-28T18:30:00.0000000Z"
}
```

## Databases

Create a database explicitly before table DDL, DML, or queries can use its
name.

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

This endpoint drops an existing database. For a drop you can safely repeat,
use SQL:

```json
{
  "sql": "DROP DATABASE IF EXISTS app"
}
```

SQL can also rename a database:

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
    { "name": "id", "type": "id", "primary": true, "notNull": true, "defaultValue": null },
    { "name": "parent_id", "type": "id", "notNull": false, "defaultValue": null },
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
  ],
  "foreignKeys": [
    {
      "name": "robots_parent_fk",
      "columns": ["parent_id"],
      "referencedTable": "robots",
      "referencedColumns": ["id"],
      "onDelete": "restrict",
      "onUpdate": "no action"
    }
  ]
}
```

The HTTP create-table model accepts these types: `id`,
`int64`, `float64`, `float32`, `bool`, `string`, `date`, `datetime`, `bytes`,
`uuid`, `numeric`, and `array`. It also accepts the aliases `int`, `integer`,
`char`, `varchar`, `text`, `real`, `timestamp`, `blob`, `guid`, and `decimal`.
Type names are not case sensitive.

Use `maxLength` to limit `string` and `bytes` values, and `arrayElementType`
for array columns.

Use `foreignKeys` to declare table-level foreign keys. Each entry needs a
`name`, the child `columns`, and a `referencedTable`. `referencedColumns` can be
empty to reference the parent primary key. `onDelete` and `onUpdate` accept
`"no action"` and `"restrict"` today. Any other action, such as `cascade`,
`set null`, or `set default`, returns `CADB0533`. See
[Foreign Keys](/docs/foreign-keys).

See [Data Types](/docs/data-types) for SQL type names, aliases, literal
formats, and JSON value rules.

## SQL execution

Prefer the SQL endpoints when you can. They use the same parser and executor
as the engine's tests.

Autocommit SQL requests use Serializable isolation by default.

An autocommit request that starts a transaction accepts `isolationLevel`
(`"Serializable"` or `"ReadCommitted"`) and `transactionMode` (`"ReadWrite"` or
`"ReadOnly"`).

An autocommit request that writes can also set `locking` to `"Pessimistic"` or
`"Optimistic"`.

A request that starts a transaction can set `priority` to `"Background"`,
`"Low"`, `"Normal"`, `"High"`, or `"Critical"`.

CamusDB ignores these fields when the request resumes an existing transaction
through `txnIdPT` and `txnIdCounter`.

A read-only request to `/execute-sql-query` also ignores `locking`. It runs no
write transaction, so it neither acquires nor validates write conflicts.

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

Server-level operational queries, such as `SHOW ENGINE STATS`, can also omit
`databaseName`.

Response:

```json
{ "status": "ok", "rows": 2, "warning": null }
```

`rows` is the number of rows the statement wrote, such as the rows that
`CREATE TABLE ... AS SELECT` copied. It is `0` for every DDL statement that
writes no rows. `warning` is `null` unless there is something to report. For
example, a time-travel copy that reads no rows returns a warning. See
[Copying query results](/docs/insert-select-and-ctas#row-counts-and-empty-copy-warnings).

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
  "columns": [
    { "name": "id", "type": 1 },
    { "name": "name", "type": 3 }
  ],
  "rows": [
    ["507f1f77bcf86cd799439011", "R2-D2"]
  ],
  "code": null,
  "message": null,
  "causalToken": { "n": 1, "l": 1792500000000, "c": 0 },
  "serverTimeMs": 2.4,
  "cacheStatus": null,
  "cacheBypassReason": null,
  "cachedAtHlc": null,
  "ageMs": null,
  "cacheName": null
}
```

`columns` lists the output columns in order, with the numeric `ColumnType` of
each one. It is present even when `rows` is empty. Each entry in `rows` is an
array by position: `rows[r][c]` is the value of `columns[c]`. Values use plain
JSON, not `ColumnValue` objects:

| Column type | JSON value |
| --- | --- |
| id, string | string |
| int64, float64, float32 | number |
| bool | `true` or `false` |
| bytes | base64 string |
| date, datetime | number of UTC ticks |
| uuid | array of two int64 numbers, `[high, low]` |
| numeric | decimal text, such as `"19.99"` |
| array | JSON array of element values. The column also has an `elementType` |

A SQL `NULL` is JSON `null`. The cache fields are `null` unless the query
carries a cache hint. See [Query Result Cache](/docs/query-result-cache).

`causalToken` is a cluster timestamp: the `n`, `l`, and `c` parts of a
[hybrid logical clock (HLC)](/docs/concepts#hlc) value. Send it back as
`causalToken` on the next autocommit query or `/start-transaction` request
so the read observes your earlier writes on another node. An explicit
transaction's floor is fixed at its start; tokens on later statements do not
advance it.

This endpoint also accepts `INSERT`, `UPDATE`, and `DELETE` statements with a
`RETURNING` list. The response is the same query result shape: `columns`, then
`rows`.

Set `routingAcceptVersion: 1` on the request to opt in to advisory routing
metadata. An eligible response then includes an optional `routing` object. See
[SQL Routing Advice](/docs/sql-routing-advice).

This endpoint supports time-travel reads with `AS OF SYSTEM TIME`. The
statement must be a read-only `SELECT` in autocommit mode:

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

The SQL restrictions also apply over HTTP: the clause cannot run inside an
explicit transaction, and an invalid time-travel value returns `CADB0409`
`InvalidAsOfSystemTime`. See [Time-Travel Reads](/docs/time-travel-reads).

### `POST /execute-sql-query-stream`

For large `SELECT` or `SHOW` results, use the streaming endpoint:

```json
{
  "databaseName": "app",
  "sql": "SELECT id, name FROM robots ORDER BY name",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadOnly",
  "parameters": null
}
```

The request body has the same shape as for `/execute-sql-query`. The response
is one JSON value per line, with content type `application/x-ndjson`:

```json
{"status":"ok","columns":[{"name":"id","type":1},{"name":"name","type":3}]}
["507f1f77bcf86cd799439011","R2-D2"]
["507f1f77bcf86cd799439012","C-3PO"]
{"status":"ok","total":2,"serverTimeMs":3.1}
```

The first line is the schema header. Each row is a compact positional array in
the header's column order.

The last line is a trailer with the final status, the total number of streamed
rows, an optional causal token, and the server time.

If an error happens before the first line, CamusDB returns an ordinary JSON
error body with the matching HTTP status.

If an error happens after the stream starts, the HTTP status may already be
`200`, so CamusDB reports the failure in the final trailer:

```json
{"status":"failed","total":128,"code":"CADB0502","message":"transaction conflict","serverTimeMs":12.4}
```

An autocommit stream runs a single attempt. Rows can already be on the wire
before the commit, so the server cannot silently replay a late Serializable
conflict. The buffered endpoint can.

Use `/execute-sql-query` when automatic autocommit retries matter more than
incremental delivery, or use an explicit transaction and retry from the client.

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

The response can also carry a `warning`, with the same meaning as on
`/execute-sql-ddl`. An `INSERT ... SELECT` time-travel copy that reads no rows
uses it.

A write statement with a `RETURNING` list can also run through this endpoint.
The response keeps `rows` as the affected-row count and adds `columns` and
`returningRows`:

```json
{
  "status": "ok",
  "rows": 1,
  "columns": [{ "name": "id", "type": 1 }],
  "returningRows": [["507f1f77bcf86cd799439011"]]
}
```

Set `discardReturningRows: true` in the request body when the caller needs only
the affected-row count. CamusDB still validates the `RETURNING` list and checks
the required privileges.

Set `routingAcceptVersion: 1` on the request to opt in to advisory routing
metadata. An eligible response then includes an optional `routing` object. See
[SQL Routing Advice](/docs/sql-routing-advice).

### Locking reads

`SELECT ... FOR UPDATE` uses the query endpoints but needs a writable
transaction. Autocommit locking reads commit and release their locks before
sending rows; use an explicit transaction if a later UPDATE depends on the
lock. Pass `"isolationLevel": "ReadCommitted"` for autocommit SKIP LOCKED.
See [locking reads](/docs/sql-queries#for-update) for restrictions and error codes.

## Prepared statements

A prepared statement lets a client register SQL once and then execute it many
times by handle, with different positional values. It helps with hot
parameterized statements and covers `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and
`SHOW`. `/execute-sql-ddl` rejects a handle rather than ignoring it.

### `POST /prepare-sql-statement`

```json
{
  "databaseName": "app",
  "sql": "UPDATE robots SET name = @name, year = @year WHERE id = @id"
}
```

Response:

```json
{
  "status": "ok",
  "statementId": "opaque-node-local-handle",
  "parameterNames": ["@name", "@year", "@id"]
}
```

`parameterNames` lists the distinct placeholder names in binding order, first
occurrence first. Each name keeps its leading `@`. A name that appears more
than once occupies one slot. The list includes placeholders inside subqueries.

Preparing a statement parses and registers it, but checks no privileges.
Authorization runs at execution time, against the principal of that request,
as it does for an inline statement. So a prepare reveals only one fact: whether
the SQL parses. A statement that does not parse fails here, not at a later
execution.

### Execute a prepared statement

Send `statementId` and `positionalParameters` to `/execute-sql-query`,
`/execute-sql-query-stream`, or `/execute-sql-non-query`:

```json
{
  "statementId": "opaque-node-local-handle",
  "positionalParameters": [
    { "type": 3, "strValue": "Artoo" },
    { "type": 2, "longValue": 1977 },
    { "type": 1, "strValue": "507f1f77bcf86cd799439011" }
  ]
}
```

`positionalParameters[i]` binds to `parameterNames[i]` from the prepare
response. The number of values must equal the number of names. Each value uses
the same encoding as the inline `parameters` map. The names do not travel on
the wire, so a client that binds by name maps its arguments to the ordinals
locally.

When you send `statementId`, omit `sql`, `databaseName`, and the named
`parameters`. Every other request field behaves as it does inline, including
`txnIdPT`, `txnIdCounter`, `isolationLevel`, `transactionMode`, `locking`, and
`causalToken`.

### `POST /close-sql-statement`

```json
{ "statementId": "opaque-node-local-handle" }
```

Repeating a close is harmless. You can skip the close, because the idle handle
reaper collects abandoned handles. However, a client that prepares an unbounded
number of different statements reaches its cap.

### Handle lifetime

A REST handle is an opaque string. It belongs to the node and to the principal
that prepared it. CamusDB frees it at an explicit close, at the idle timeout,
or at process exit. CamusDB never replicates a handle to another node.

HTTP has no session the server can trust. Connections are pooled, multiplexed
by HTTP/2, and moved by load balancers. So the handle cannot be guessed,
CamusDB records its owner at registration, and an idle timeout frees a handle
that a client never closes.

### Recover from `CADB0520`

An execution fails with `CADB0520` (`UnknownPreparedStatement`, HTTP 404) when
the node does not know its handle. Treat it as routine: prepare the statement
again, then replay the execution once. The error occurs when:

- The handle stayed unused past `prepared_statement_idle_timeout_ms`.
- The node restarted.
- A load balancer sent the request to a different node.
- The handle belongs to a different principal. CamusDB reports this case the
  same way by design. An ownership-specific error would confirm to a caller
  that a handle exists that the caller does not own.

```mermaid
sequenceDiagram
    participant C as Client
    participant N as CamusDB node
    C->>N: POST /prepare-sql-statement (database, sql)
    N-->>C: statementId, parameterNames
    C->>N: POST /execute-sql-non-query (statementId, positionalParameters)
    N-->>C: Result
    Note over N: The handle idles out, the node restarts, or the request reaches another node
    C->>N: Execute with the old statementId
    N-->>C: 404 CADB0520
    C->>N: Prepare the statement again
    N-->>C: New statementId
    C->>N: Replay the execution once
    C->>N: POST /close-sql-statement
```

Behind a load balancer, use sticky sessions, or accept one new prepare per node
per statement. Either way, the steady state after warm-up is one registration
per node.

On the streaming endpoint, CamusDB resolves the handle before it writes any
bytes, so a 404 arrives as a normal JSON error, not in the middle of a stream.

See [Prepared Statements](/docs/prepared-statements) for the statements you can
prepare and the configuration limits.

## Direct row operations

Direct endpoints take filters instead of a SQL string. A filter has a column
name, an operator, and a `ColumnValue`.

`OrderType` is also numeric: `0` is ascending and `1` is descending.

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

The `values` objects of `/insert` and `/update` must target each column once.
Repeated JSON keys, including names differing only in case, fail with HTTP 400
and `CADB0403` before writes begin.

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

Both `/update` and `/delete` require at least one filter. Missing or empty
filters fail with HTTP 400 and `CADB0400`; an explicit transaction is aborted
too. Use SQL with `WHERE TRUE` when changing every row is intentional.

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

`isolationLevel`, `transactionMode`, `locking`, and `priority` are all
optional. Without them, the transaction starts with the server defaults:

- Isolation level: Serializable.
- Transaction mode: read-write.
- Locking: pessimistic.
- Priority: normal.

The optional `causalToken` carries the last commit's timestamp into `BEGIN`:

```json
{
  "databaseName": "app",
  "isolationLevel": "ReadCommitted",
  "causalToken": { "n": 1, "l": 1792500000000, "c": 0 }
}
```

Use the actual token returned by your last commit, including all three fields.
Read Committed statement snapshots are at least that timestamp, preventing a
read on a node with a slower clock from missing the earlier commit.

Use `"ReadCommitted"` only when you intend to step down from the default
Serializable behavior.

Use `"ReadOnly"` with `"Serializable"` for a stable snapshot transaction.

Use `"Optimistic"` when CamusDB should detect conflicts at commit instead of
taking explicit locks during the transaction.

Use priority only to order admission under a configured concurrency gate.

CamusDB rejects unknown locking or priority values with `InvalidInput`.

See [Transaction Priority](/docs/transaction-priority) for the priority levels
and gate configuration.

Response:

```json
{
  "status": "ok",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

Pass `txnIdPT` and `txnIdCounter` on later SQL or direct row requests to reuse
the transaction:

```json
{
  "databaseName": "app",
  "txnIdPT": 123,
  "txnIdCounter": 1,
  "sql": "INSERT INTO robots (id, name) VALUES (GEN_ID(), 'K-2SO')"
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

A successful commit returns its causal token when it has a commit timestamp:

```json
{
  "status": "ok",
  "causalToken": { "n": 1, "l": 1792500000000, "c": 0 }
}
```

The token can be null for a transaction that never opened a session. Carry the
returned token into the next `/start-transaction` or autocommit
`/execute-sql-query` request to observe the commit across nodes. An existing
transaction's causal floor is fixed at its start.

### `POST /rollback-transaction`

```json
{
  "databaseName": "app",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

If a `COMMIT` or `ROLLBACK` returns `CADB0509` `TransactionFinalizeUnresolved`,
retry the same request with the same transaction id.

Do not start a fresh transaction or replay the statements. The original commit
may already have succeeded on the server.

```mermaid
sequenceDiagram
    participant C as Client
    participant N as CamusDB node
    C->>N: POST /start-transaction
    N-->>C: txnIdPT and txnIdCounter
    C->>N: POST /execute-sql-non-query with the ids
    N-->>C: status ok and rows
    C->>N: POST /commit-transaction with the ids
    N-->>C: CADB0509
    Note over C: Keep the same ids. Do not replay the statements.
    C->>N: POST /commit-transaction with the same ids
    N-->>C: Final outcome of the commit
```

`ROLLBACK` is idempotent by transaction id. If the transaction was already
rolled back and the server no longer tracks it, the rollback request succeeds as
a no-op. If a commit or rollback is still in progress for the same id, CamusDB
returns `CADB0501` `TransactionAlreadyCompleted` instead of guessing the
outcome.
