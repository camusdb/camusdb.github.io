---
sidebar_position: 7.3
---

# TypeScript

The `camusdb` package connects a Node.js application (a web server, an API, or a
background worker) to CamusDB, so you do not write HTTP or gRPC calls by hand.
You pass typed parameters, `transaction()` retries serializable conflicts for
you, and in a multi-node cluster learned routing can send a statement straight
to the node that leads its data. It works from TypeScript and JavaScript.

For an interactive SQL session, use [camus-cli](/docs/camus-cli). For a script
that needs no library, use the [HTTP API](/docs/http-api).

The connector also supports REST and gRPC transports, transaction pipelines,
automatic prepared statements, authentication, database branches, query result
cache metadata, online backup administration, node statistics, and
OpenTelemetry.

The connector requires Node.js 20.19 or later, or Node.js 22.12 or later on the
22 line. It ships as ECMAScript modules with TypeScript declarations.

For a model-based API, the [Prisma adapter](/docs/prisma) builds on this
connector and adds typed Prisma Client queries and a migration CLI.

## Install

```bash
npm install camusdb
```

The gRPC transport uses optional peer dependencies. Install them only when you
set `protocol: 'grpc'`:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

Install the optional OpenTelemetry API when the application collects driver
traces or metrics:

```bash
npm install @opentelemetry/api
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
| `requestFrames` | `RequestFrames` | gRPC only. Packs operations that are already waiting together into one stream message when the server supports it. Default is `true`. |
| `streamDrainTimeoutMs` | `StreamDrainTimeout` | gRPC only. How long a rotated-out stream can stay open for transactions that began on it. Default is `300000`. |
| `httpVersion` | `HttpVersion` | REST only. Node's `fetch` supports `1.1`, the default. The connector rejects `2` and `3`; gRPC always uses HTTP/2. |
| `backupEndpoint` | `BackupEndpoint` | HTTP endpoint for the backup admin API. Required when `protocol` is `grpc`. |
| `backupTimeoutSeconds` | `BackupTimeout` | Backup admin timeout in seconds. Default is `300`. |
| `allowInsecureCredentials` | `AllowInsecureCredentials` | Allows credentials over a remote plaintext endpoint. Use only behind a trusted TLS terminator or private hop. |
| `routingMode` | `RoutingMode` | `auto`, `learned`, or `off`. Default is `auto`. |
| `routingNodes` | `RoutingNodes` | Operator trust map from server node identities to endpoint pool members. |
| `routingMaxHintAgeMs` | `RoutingMaxHintAge` | Maximum reuse age for a learned route. Default is `5000`. |
| `defaultTransactionOptions` | `IsolationLevel`, `TransactionMode`, `Locking` | Defaults for transactions and autocommit statements. |
| `int64` | `Int64` | `auto`, `number`, or `bigint`. Default is `auto`. |
| `traceQueryText` | `TraceQueryText` | Adds SQL text to OpenTelemetry spans. Default is `false`, because SQL literals can contain sensitive data. |

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

If a projection repeats a column name, the connector keeps every column. The
leftmost column keeps the original name and later duplicates become `name_2`,
`name_3`, and so on.

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

`query<T>()`, `queryOne<T>()`, `scalar<T>()`, and `queryStream<T>()` also accept
an `INSERT`, `UPDATE`, or `DELETE` with a `RETURNING` clause. The returned rows
are the stored values after defaults, identity values, sequences, and coercions
have been applied. `QueryResult.affectedRows` reports the written-row count:

```ts
import { camus } from 'camusdb';

const inserted = await client.query<{ id: string; total: string }>(
  `INSERT INTO orders (id, total)
   VALUES (GEN_ID(), @total)
   RETURNING id, total`,
  { total: camus.numeric('19.99') },
);

const updated = await client.query<{ id: string; status: string }>(
  `UPDATE orders
   SET status = 'paid'
   WHERE id = @id
   RETURNING id, status`,
  { id },
);

inserted.affectedRows;
updated.rows;
```

`execute()` can run a statement with `RETURNING`, but it asks the server to
discard the returned rows and reports only the count. Use `queryStream()` for a
large `RETURNING` result; the buffered `query()` path receives all rows in one
reply.

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
  price: camus.numeric('12345678901234567890.123456789'),
  tags: camus.array([], ColumnType.String),
});
```

`INT64` values stay exact on both transports. With `int64: 'auto'`, safe values
return as `number` and larger values return as `bigint`. Set `int64: 'bigint'`
when you want one uniform type.

`NUMERIC` and `DECIMAL` values return as canonical decimal text. JavaScript has
no built-in decimal type, so the connector does not round them through
`number`. Bind exact decimal values with `camus.numeric(value)`, where `value`
is a decimal string, a `bigint`, or a finite `number`. A plain JavaScript
`number` still binds as `INT64` or `FLOAT64`; use `camus.numeric` when an exact
numeric comparison or insert matters. CamusDB does not support `ARRAY(NUMERIC)`,
so numeric arrays are rejected by the connector before the request is sent.

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

Transaction options include `isolationLevel`, `mode`, `locking`, `deferBegin`,
and, with learned routing, `affinity`. With `deferBegin: true`, the connector
sends `BEGIN` with the first statement instead of making a separate request.
The connector exports
`OPTIMISTIC_TRANSACTION_OPTIONS` and `SNAPSHOT_TRANSACTION_OPTIONS`.

Use `withRetry(...)` around your own idempotent units of work. `CADB0509`
`TransactionFinalizeUnresolved` is handled by retrying the same commit on the
same handle; it is not a signal to replay the whole transaction.

### Pipelined transactions

Use a transaction pipeline when several statements have independent inputs.
The connector queues them and, over gRPC with request frames, sends each group
in one stream message:

```ts
import { CamusLocking } from 'camusdb';

const txn = await client.beginTransaction({
  locking: CamusLocking.Optimistic,
  deferBegin: true,
});

const pipeline = txn.pipeline();
const first = pipeline.query<{ balance: number }>(
  'SELECT balance FROM accounts WHERE id = @id', { id: firstId },
);
const second = pipeline.query<{ balance: number }>(
  'SELECT balance FROM accounts WHERE id = @id', { id: secondId },
);

await pipeline.send();
console.log((await first).rows, (await second).rows);

pipeline.execute('UPDATE accounts SET balance = @balance WHERE id = @id', {
  id: firstId,
  balance: 100,
});
await pipeline.commit();
```

`pipeline.commit()` commits only after every queued statement succeeds.
`pipeline.exchanges` reports the round trips used. REST, older servers, and
gRPC clients with `requestFrames: false` preserve the same behavior by running
the queued operations sequentially. DDL and `TRUNCATE` cannot be queued in a
transaction pipeline.

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
the session's causal token between requests. The causal token is a cluster
timestamp ([HLC](/docs/concepts#hlc)) that lets a session read its own writes on
any node.

When a server announces support for gRPC request frames, the connector can pack
operations that are already waiting together into one stream message. This is on
by default and can be disabled with `requestFrames: false` for measurement or as
a kill switch.

When authentication rotates a gRPC token, new work moves to a fresh stream. A
retired stream stays open for transactions that began on it until they finish,
or until `streamDrainTimeoutMs` elapses.

For multi-node clusters, learned routing can use server routing advice to send
future executions of the same statement directly to the node that
[leads](/docs/concepts#leader) the data it touches:

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

## Administration helpers

The connector includes helpers for database administration:

```ts
await client.createDatabase('analytics', { ifNotExists: true });
await client.dropDatabase('analytics');
await client.createBranchDatabase('feature-x', 'production');
await client.showBranches('production');
await client.showAncestors('feature-x');
client.changeDatabase('analytics');
```

The connector also exports helpers for storage-strategy DDL and for rewriting
already stored large values:

```ts
import { CamusColumnStorage, setColumnStorageStatement } from 'camusdb';

await client.executeDdl(
  setColumnStorageStatement('docs', 'embedding', CamusColumnStorage.Plain),
);

await client.rewriteStorage('docs', { timeoutSeconds: 3600 });
await client.rewriteStorage('docs', { inline: true, timeoutSeconds: 3600 });
```

`rewriteStorage(table)` runs `ALTER TABLE ... REWRITE STORAGE`. With
`inline: true`, it rewrites values back into the row and uncompressed, which is
the form older servers can read before a downgrade.

Sequence helpers build valid SQL and draw the next value as a `bigint`:

```ts
import {
  createSequenceStatement,
  dropSequenceStatement,
  nextValueExpression,
} from 'camusdb';

await client.executeDdl(
  createSequenceStatement('ticket_numbers', { startWith: 1000, ifNotExists: true }),
);

await client.executeDdl(`
  CREATE TABLE tickets (
    id OID PRIMARY KEY NOT NULL,
    number INT64 DEFAULT (${nextValueExpression('ticket_numbers')}),
    subject STRING
  )
`);

const next = await client.nextSequenceValue('ticket_numbers');
await client.executeDdl(dropSequenceStatement('ticket_numbers', { ifExists: true }));
```

Sequence values are not returned by rollback. With a transaction option,
`nextSequenceValue` runs inside that transaction, but the server still never
issues the same sequence value twice.

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

### Node statistics

`nodeStats()` returns the disk, CPU, and memory reported by one node over REST
or gRPC. Call it for each configured endpoint to inspect a cluster:

```ts
for (const endpoint of client.endpoints) {
  const stats = await client.nodeStats(endpoint);
  console.log(stats.address, stats.cpu.processCpuPercent);
}
```

Each node answers only for itself. An explicitly supplied endpoint must be in
`client.endpoints`, and unavailable fields are `-1` with details in `errors`.
When authentication is enabled, this call requires a superuser or
`GRANT MONITOR ON *.*`.

## OpenTelemetry

With `@opentelemetry/api` installed and an OpenTelemetry SDK registered, the
connector emits client spans and `db.client.operation.duration` for statements,
typed inserts, transaction boundaries, and pipeline batches. It also records
retry, endpoint quarantine, and prepared-statement metrics under the `camusdb`
instrumentation scope.

Spans include the database, operation, transport, destination endpoint, and
error code. They follow the active OpenTelemetry context, so transport spans
become children of the database operation. Set `traceQueryText: true` only when
recording SQL text is acceptable; parameter values are never recorded.

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
