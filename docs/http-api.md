---
sidebar_position: 3
---

# HTTP API

CamusDB exposes JSON endpoints for automation and application integration.
Request and response properties use camelCase.

## Status And Errors

Successful responses use:

```json
{
  "status": "ok"
}
```

Failed responses use HTTP 500 and include a CamusDB error code when available:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

See [Error Codes](/docs/error-codes) for the reference list and when each code
is generated.

## Column Values

Rows, filters, inserts, updates, defaults, and SQL parameters use `ColumnValue`
objects:

`ColumnType` is serialized as its numeric enum value:

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

For bytes, SQL literals use `0x` hexadecimal while JSON uses base64 in
`bytesValue`. For date and datetime values, responses include `isoValue`; the
stored value is represented by UTC ticks in `longValue`. For UUID request
values, pass canonical hyphenated or 32-character hexadecimal text in
`strValue`; responses include `uuidValue` for readability.

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

Databases must be created explicitly before table DDL, DML, or queries can use
their name.

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

The direct endpoint drops an existing database. For idempotent drops, use SQL:

```json
{
  "sql": "DROP DATABASE IF EXISTS app"
}
```

Database rename is also exposed through SQL:

```json
{
  "sql": "RENAME DATABASE app TO app_prod"
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

The HTTP table-creation model accepts `id`, `int64`, `float64`, `float32`,
`bool`, `string`, `date`, `datetime`, `bytes`, `uuid`, `guid`, and `array`.
Use `maxLength` for `string` and `bytes` limits, and `arrayElementType` for
array columns.

See [Data Types](/docs/data-types) for the SQL names, aliases, literal formats,
and JSON value rules.

## SQL Execution

Use the SQL endpoints when possible. They exercise the same parser and executor
used by the engine tests.

Autocommit SQL requests use Serializable isolation by default. For requests
that start an autocommit transaction, `isolationLevel` can be set to
`"Serializable"` or `"ReadCommitted"`, and `transactionMode` can be set to
`"ReadWrite"` or `"ReadOnly"`. These fields are ignored when the request
resumes an existing transaction with `txnIdPT` and `txnIdCounter`.

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

### `POST /execute-sql-query`

For `SELECT` statements:

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

## Direct Row Operations

Direct endpoints accept filters instead of SQL strings. Filters contain a
column name, an operator, and a `ColumnValue`.

`OrderType` is also numeric: `0` ascending and `1` descending.

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

## Explicit Transactions

Start a transaction:

### `POST /start-transaction`

```json
{
  "databaseName": "app",
  "isolationLevel": "Serializable",
  "transactionMode": "ReadWrite"
}
```

`isolationLevel` and `transactionMode` are optional. If omitted, the transaction
starts with the server default isolation level, which is Serializable, and the
default transaction mode, which is read-write.

Use `"ReadCommitted"` only when you intentionally opt down from the default
Serializable behavior. Use `"ReadOnly"` with `"Serializable"` for a stable
snapshot transaction.

Response:

```json
{
  "status": "ok",
  "txnIdPT": 123,
  "txnIdCounter": 1
}
```

Pass `txnIdPT` and `txnIdCounter` to subsequent SQL or direct row requests to
reuse that transaction:

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
