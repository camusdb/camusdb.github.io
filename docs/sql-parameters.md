---
sidebar_position: 2.7
---

# SQL Parameters

SQL requests can pass parameter placeholders:

```camussql
SELECT id, name FROM robots WHERE id = @id;
UPDATE robots SET name = @name WHERE id = @id;
```

Parameter values are bound by the client, shell command, HTTP request, or gRPC
request that submits the SQL.

## HTTP Example

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

See [HTTP API](/docs/http-api), [gRPC API](/docs/grpc-api), and
[.NET Driver](/docs/dotnet-driver) for client-specific binding details.
