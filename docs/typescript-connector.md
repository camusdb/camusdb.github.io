---
sidebar_position: 7.3
---

# TypeScript

CamusDB ships a Node.js connector for TypeScript and JavaScript applications.
The package name is `camusdb`.

It supports REST and gRPC transports, typed parameters, transactions, automatic
prepared statements, authentication, learned routing, database branches, query
result cache metadata, and online backup administration.

The connector requires Node.js 20.19 or later, or Node.js 22.12 or later on the
22 line. It ships as ECMAScript modules with TypeScript declarations.

## Install

```bash
npm install camusdb
```

The gRPC transport uses optional peer dependencies. Install them only when you
set `protocol: 'grpc'`:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## Create a client

Build a client from an options object:

```ts
import { CamusClient } from 'camusdb';

const client = new CamusClient({
  endpoint: 'http://localhost:5095',
  database: 'test',
});
```

You can also use the same connection string keys as the .NET driver:

```ts
const client = CamusClient.fromConnectionString(
  'Endpoint=http://localhost:5095;Database=test;Timeout=30',
);
```

`endpoint` can be a single URL, an array of URLs, or a comma-separated
connection-string value. With several endpoints, the connector rotates through
them and sets aside an unreachable endpoint for 30 seconds.

## Connection options

| Option | Connection-string key | Description |
| --- | --- | --- |
| `endpoint` | `Endpoint` | Base URL, or several URLs to rotate through. |
| `database` | `Database` | Database sent with each request. |
| `timeoutSeconds` | `Timeout` | Request timeout in seconds. Default is `10`. |
| `protocol` | `Protocol` | `rest`, the default, or `grpc`. |
| `user` | `User` | User to authenticate as. Aliases include `UserId`, `Uid`, and `Username`. |
| `password` | `Password` | Password for `user`. Alias: `Pwd`. |
| `accessToken` | `AccessToken` | Bearer token obtained elsewhere. |
| `tokenLifetimeSeconds` | `TokenLifetime` | Fallback token lifetime when the server reports no expiry. Default is `600`. |
| `maxAutoPrepare` | `MaxAutoPrepare` | Maximum automatic prepared statements. Default is `128`; `0` disables automatic preparation. |
| `autoPrepareMinUsages` | `AutoPrepareMinUsages` | Executions before automatic preparation. Default is `2`. |
| `channelPoolSize` | `ChannelPoolSize` | gRPC streams per endpoint. Default is `2`. |
| `coalescingThreshold` | `CoalescingThreshold` | gRPC batch coalescing threshold. Default is `10`; `1` disables coalescing. |
| `coalescingDelayMs` | `CoalescingDelay` | gRPC coalescing delay in milliseconds. Default is `0`. |
| `backupEndpoint` | `BackupEndpoint` | HTTP endpoint for the backup admin API. Required when `protocol` is `grpc`. |
| `backupTimeoutSeconds` | `BackupTimeout` | Backup admin timeout in seconds. Default is `300`. |
| `allowInsecureCredentials` | `AllowInsecureCredentials` | Allows credentials over a remote plaintext endpoint. Use only behind a trusted TLS terminator or private hop. |
| `routingMode` | `RoutingMode` | `auto`, `learned`, or `off`. Default is `auto`. |
| `routingNodes` | `RoutingNodes` | Operator trust map from server node identities to endpoint pool members. |
| `routingMaxHintAgeMs` | `RoutingMaxHintAge` | Maximum reuse age for a learned route. Default is `5000`. |
| `defaultTransactionOptions` | `IsolationLevel`, `TransactionMode`, `Locking` | Defaults for transactions and autocommit statements. |
| `int64` | `Int64` | `auto`, `number`, or `bigint`. Default is `auto`. |

Connection string keys are case-insensitive and trimmed. Repeating a key is an
error. Quote a value with single or double quotes when it contains a semicolon
or surrounding spaces.

`client.toString()` masks secrets. Use `redactConnectionString(...)` when you
need to log a raw connection string safely.

## Queries and writes

Use `query<T>()` for a `SELECT` that fits in memory:

```ts
interface Robot {
  id: string;
  name: string;
  year: number;
}

const result = await client.query<Robot>(
  'SELECT id, name, year FROM robots WHERE year = @year',
  { year: 1974 },
);

result.rows;
result.columns;
result.rowCount;
```

Use `queryOne<T>()` for the first row, and `scalar<T>()` for the first column of
the first row.

Use `execute()` for `INSERT`, `UPDATE`, and `DELETE`:

```ts
const result = await client.execute(
  'UPDATE robots SET year = @year WHERE id = @id',
  { year: 1984, id: '507f1f77bcf86cd799439011' },
);

result.affectedRows;
```

Use `executeDdl()` for schema statements when you want to make that route
explicit. Use `insert(table, values)` for the row-level insert endpoint:

```ts
import { CamusObjectId, camus } from 'camusdb';

await client.insert('robots', {
  id: camus.id(CamusObjectId.generateAsString()),
  name: 'R2-D2',
  year: camus.int64(1977),
});
```

## Parameters and types

Parameters are bound by name. The leading `@` is optional in the parameter
object:

```ts
await client.query('SELECT * FROM robots WHERE year = @year', {
  year: 1977,
});
```

The connector infers common values: strings, booleans, numbers, bigints,
`Date`, byte arrays, `Float32Array` vectors, arrays, `null`, and
`CamusObjectId`. Use `camus.*` helpers when inference cannot express the type
you need:

```ts
import { camus, ColumnType } from 'camusdb';

await client.query('SELECT * FROM events WHERE id = @id AND event_uuid = @uuid', {
  id: camus.id('507f1f77bcf86cd799439011'),
  uuid: camus.uuid('550e8400-e29b-41d4-a716-446655440000'),
  tags: camus.array([], ColumnType.String),
});
```

`INT64` values stay exact on both transports. With `int64: 'auto'`, safe values
return as `number` and larger values return as `bigint`. Set `int64: 'bigint'`
when you want one uniform type.

`DATE` and `DATETIME` values return as UTC `Date` objects. JavaScript dates have
millisecond precision; use `ticksToDate` and `dateToTicks` when you need to
work with the raw .NET tick value.

Vectors are stored in `BYTES` columns as packed little-endian `float32` values:

```ts
import { CamusVector, camus } from 'camusdb';

await client.execute('INSERT INTO docs (id, embedding) VALUES (GEN_ID(), @embedding)', {
  embedding: camus.vector([0.1, 0.2, 0.3]),
});

const row = await client.queryOne<{ embedding: Uint8Array }>('SELECT embedding FROM docs LIMIT 1');
const values = CamusVector.toFloats(row!.embedding);
```

## Streaming

`queryStream<T>()` reads rows incrementally:

```ts
await using stream = await client.queryStream<Robot>('SELECT * FROM robots');

for await (const robot of stream) {
  console.log(robot.name);
}
```

The REST transport streams rows from the server as the iterator advances. The
gRPC transport uses the same API, but buffers the result internally before
replaying it to the iterator.

## Transactions and retries

Use `transaction()` for the common case. It commits when the function returns
and rolls back when the function throws. Serializable conflicts retry the whole
function on a fresh transaction, so the function must be safe to run more than
once.

```ts
await client.transaction(async (txn) => {
  await client.execute(
    'UPDATE accounts SET balance = balance - @amount WHERE id = @id',
    { amount, id: from },
    { transaction: txn },
  );

  await client.execute(
    'UPDATE accounts SET balance = balance + @amount WHERE id = @id',
    { amount, id: to },
    { transaction: txn },
  );
});
```

Use `beginTransaction()` when the unit of work does not fit in one function:

```ts
await using txn = await client.beginTransaction();

await client.execute(
  'UPDATE robots SET year = @year WHERE id = @id',
  { year: 1984, id },
  { transaction: txn },
);

await txn.commit();
```

Transaction options include `isolationLevel`, `mode`, `locking`, and, with
learned routing, `affinity`. The connector exports
`OPTIMISTIC_TRANSACTION_OPTIONS` and `SNAPSHOT_TRANSACTION_OPTIONS`.

Use `withRetry(...)` around your own idempotent units of work. `CADB0509`
`TransactionFinalizeUnresolved` is handled by retrying the same commit on the
same handle; it is not a signal to replay the whole transaction.

## Prepared statements

The connector prepares repeated statements automatically. The default policy
prepares a statement on its second execution and keeps the 128 most recently
used registrations. Set `maxAutoPrepare: 0` to disable automatic preparation.

```ts
await client.prepare('SELECT * FROM robots WHERE year = @year');

client.isPrepared('SELECT * FROM robots WHERE year = @year');
client.preparedStatementCount;
```

Prepared statements are an optimization. If the server refuses a registration,
the connector keeps running the statement inline.

## Authentication

With authentication disabled, the connector sends no `Authorization` header. To
authenticate, pass `user` and `password`, or log in explicitly at runtime:

```ts
await client.login('app', await secrets.get('camus-password'));
await client.logout();
```

The password is exchanged for a bearer token. Tokens are shared across clients
with the same identity and deployment, renewed before expiry, and refreshed once
after a token rejection. Privilege errors are not retried.

Use `https://` for credential-bearing connections outside loopback. The
connector refuses credentials over remote plaintext unless
`allowInsecureCredentials` is set.

## Transport and routing

REST is the default transport. Set `protocol: 'grpc'` and point `endpoint` at
the gRPC port to use gRPC:

```ts
const client = new CamusClient({
  endpoint: 'http://localhost:5096',
  database: 'test',
  protocol: 'grpc',
  backupEndpoint: 'http://localhost:5095',
});
```

gRPC statements ride a small pool of long-lived `BatchExecute` streams and carry
the session causal token between requests.

For multi-node clusters, learned routing can use server routing advice to send
future executions of the same statement directly to the data leader:

```ts
const client = new CamusClient({
  endpoint: ['http://a:5095', 'http://b:5095', 'http://c:5095'],
  database: 'test',
  routingMode: 'learned',
  routingNodes: {
    'camus-a:7070': 'http://a:5095',
    'camus-b:7070': 'http://b:5095',
    'camus-c:7070': 'http://c:5095',
  },
});
```

The `routingNodes` map is the authority. A server response can name only an
opaque node identity, and the connector routes only to endpoints that the
operator mapped and also listed in the endpoint pool. See
[SQL Routing Advice](/docs/sql-routing-advice).

## Databases, branches, cache, and backups

The connector includes helpers for database administration:

```ts
await client.createDatabase('analytics', { ifNotExists: true });
await client.dropDatabase('analytics');
await client.createBranchDatabase('feature-x', 'production');
await client.showBranches('production');
await client.showAncestors('feature-x');
client.changeDatabase('analytics');
```

Use `cacheHint(...)` to build query result cache hints and inspect
`result.cacheMetadata` for the verdict:

```ts
import { cacheHint } from 'camusdb';

const hint = cacheHint('recent_orders', { ttlMs: 30_000, strict: true });
const result = await client.query(`SELECT id FROM orders ${hint}`);
```

The online backup administration API is available at `client.backups`. It is
node-wide and uses REST, so a gRPC client must set `backupEndpoint`.

```ts
const full = await client.backups.takeFullBackup();
const catalog = await client.backups.listBackups();
const preview = await client.backups.previewGarbageCollection();
```

## Process lifetime

A `CamusClient` is cheap to create and safe to share. Endpoint rotation, bearer
tokens, transports, prepared-statement registrations, and learned routes are
shared process-wide by the deployment and configuration they depend on.

When a Node.js process is shutting down, close shared gRPC channels explicitly:

```ts
import { CamusTransportPool } from 'camusdb';

await CamusTransportPool.closeAll();
```

## Sample application

For a complete Next.js app built on this connector, see
[Advanced Samples](/docs/advanced-samples#camusbooking).
