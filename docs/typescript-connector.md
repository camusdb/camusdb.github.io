---
sidebar_position: 7.3
description: "The camusdb npm package connects Node.js applications to CamusDB from TypeScript or JavaScript, with typed parameters and automatic retries of serializable conflicts."
---

# TypeScript

The `camusdb` package connects a Node.js application, such as a web server or a
background worker, to CamusDB. You don't write HTTP or gRPC calls by hand. You
pass typed parameters, and `transaction()` retries serializable conflicts for
you. In a cluster, learned routing can send a statement directly to the node
that leads its data. The package works from TypeScript and JavaScript.

For an interactive SQL session, use [camus-cli](/docs/camus-cli). For a script
or an automation job, use this driver. For custom clients and diagnostics, see
the [HTTP API](/docs/http-api).

The connector needs Node.js 20.19 or later on the 20 line, or 22.12 or later.
It ships as ECMAScript modules with TypeScript declarations. For a model-based
API, the [Prisma adapter](/docs/prisma) builds on this connector and adds typed
Prisma Client queries and a migration CLI.

## Install

```bash
npm install camusdb
```

The gRPC transport uses optional peer dependencies. Install them if you set
`protocol: 'grpc'`:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

To collect driver traces or metrics, install the optional OpenTelemetry API:

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

You can also use the connection string keys of the .NET driver:

```ts
const client = CamusClient.fromConnectionString(
  'Endpoint=http://localhost:5095;Database=test;Timeout=30',
);
```

`endpoint` can be one URL or several URLs. In a connection string, separate
the URLs with commas. With several endpoints, the connector rotates through
them. It sets an endpoint that doesn't answer aside for 30 seconds.

## Connection options

| Option | Connection-string key | Description |
| --- | --- | --- |
| `endpoint` | `Endpoint` | The base URL, or several URLs to rotate through. |
| `database` | `Database` | The database sent with each request. |
| `timeoutSeconds` | `Timeout` | The REST request timeout in seconds, including the full buffered body. Default `10`. Streamed rows aren't counted. |
| `protocol` | `Protocol` | `rest` (default) or `grpc`. |
| `user` | `User` | The user to sign in as. Aliases such as `Uid` also work. |
| `password` | `Password` | The password for `user`. `Pwd` is an alias. |
| `accessToken` | `AccessToken` | A bearer token from another source. |
| `tokenLifetimeSeconds` | `TokenLifetime` | The token lifetime to use when the server doesn't give an expiry. Default `600`. |
| `maxAutoPrepare` | `MaxAutoPrepare` | The most automatic prepared statements. Default `128`. `0` turns off automatic preparation. |
| `autoPrepareMinUsages` | `AutoPrepareMinUsages` | Executions before automatic preparation. Default `2`. |
| `channelPoolSize` | `ChannelPoolSize` | gRPC streams for each endpoint. Default `8`. |
| `coalescingThreshold` | `CoalescingThreshold` | The gRPC batch coalescing threshold. Default `10`. `1` turns off coalescing. |
| `coalescingDelayMs` | `CoalescingDelay` | The gRPC coalescing delay in milliseconds. Default `0`. |
| `requestFrames` | `RequestFrames` | gRPC only. Packs waiting operations into one stream message when the server supports it. Default `true`. |
| `streamDrainTimeoutMs` | `StreamDrainTimeout` | gRPC only. How long a rotated-out stream can stay open for the transactions that began on it. Default `300000`. |
| `httpVersion` | `HttpVersion` | REST only. Node's `fetch` supports `1.1`, the default. `2` and `3` return an error. gRPC uses HTTP/2. |
| `backupEndpoint` | `BackupEndpoint` | The HTTP endpoint for the backup API. Required when `protocol` is `grpc`. |
| `backupTimeoutSeconds` | `BackupTimeout` | The backup API timeout in seconds. Default `300`. |
| `allowInsecureCredentials` | `AllowInsecureCredentials` | Send credentials to a remote `http://` endpoint. Use it only behind a trusted TLS terminator or a private link. |
| `routingMode` | `RoutingMode` | `auto` (default), `learned`, or `off`. |
| `routingNodes` | `RoutingNodes` | The map from server node identities to members of the endpoint pool. |
| `routingMaxHintAgeMs` | `RoutingMaxHintAge` | The longest time to reuse a learned route. Default `5000`. |
| `defaultTransactionOptions` | `IsolationLevel`, `TransactionMode`, `Locking` | Defaults for transactions and autocommit statements. |
| `jsonb` | `Jsonb` | `parse` (default) or `text`. See [JSON documents](#json-documents). |
| `int64` | `Int64` | `auto` (default), `number`, or `bigint`. |
| `traceQueryText` | `TraceQueryText` | Add SQL text to OpenTelemetry spans. Default `false`. SQL literals can contain sensitive data. |

Connection string keys are case-insensitive, and spaces around them are
removed. A key that is set twice returns an error. To use a semicolon or
surrounding spaces in a value, put the value in single or double quotes.

`client.toString()` masks secrets, for example
`CamusClient(Endpoint=...;User=u;Password=***)`. To log a raw connection string
safely, use `redactConnectionString(...)`.

## Queries and writes

Use `query<T>()` for a `SELECT` whose result fits in memory:

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

If a projection repeats a column name, the result has all the columns. The
leftmost column has the original name. Later duplicates get a suffix, such as
`name_2`.

Use `queryOne<T>()` for the first row, and `scalar<T>()` for the first column of
the first row.

Use `execute()` for writes:

```ts
const result = await client.execute(
  'UPDATE robots SET year = @year WHERE id = @id',
  { year: 1984, id: '507f1f77bcf86cd799439011' },
);

result.affectedRows;
```

The query methods also accept a write with a `RETURNING` clause. The returned
rows have the stored values, for example the values of defaults. `QueryResult.affectedRows` is the count of written rows:

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

`execute()` can also execute a statement with `RETURNING`. However, the server
then discards the returned rows, and you get only the count. For a large
`RETURNING` result, use `queryStream()`. The buffered `query()` gets all the
rows in one reply.

To make the route of a schema statement explicit, use `executeDdl()`. Use
`insert(table, values)` for the typed insert endpoint:

```ts
import { CamusObjectId, camus } from 'camusdb';

await client.insert('robots', {
  id: camus.id(CamusObjectId.generateAsString()),
  name: 'R2-D2',
  year: camus.int64(1977),
});
```

### WITH queries and joined writes

The connector finds the main statement after `WITH`. It handles that statement
in the same way as a statement with no `WITH`. Use `execute()` for a `WITH` followed by a
write, or `query()` and `queryStream()` when the write has `RETURNING`:

```ts
await client.execute(`
  WITH retired AS (SELECT id FROM customers WHERE closed = true)
  DELETE FROM orders AS o USING retired AS r WHERE r.id = o.customer_id
`);
```

This also works with prepared statements and pipelines. For the server rules,
see [WITH queries](/docs/sql-queries#with-queries) and
[Joined writes](/docs/sql-writes#joined-writes).

## Parameters and types

Parameters are bound by name. The leading `@` is optional in the parameter
object:

```ts
await client.query('SELECT * FROM robots WHERE year = @year', {
  year: 1977,
});
```

The connector infers the type of common values, such as strings and `Date`
objects. When inference can't give the type
that you need, use the `camus.*` helpers:

```ts
import { camus, ColumnType } from 'camusdb';

await client.query('SELECT * FROM events WHERE id = @id AND event_uuid = @uuid', {
  id: camus.id('507f1f77bcf86cd799439011'),
  uuid: camus.uuid('550e8400-e29b-41d4-a716-446655440000'),
  price: camus.numeric('12345678901234567890.123456789'),
  tags: camus.array([], ColumnType.String),
});
```

| Type | In JavaScript |
| --- | --- |
| `INT64` | Exact on both transports. With `int64: 'auto'`, safe values are a `number` and larger values are a `bigint`. Set `int64: 'bigint'` for one type. |
| `NUMERIC` | Canonical decimal text. JavaScript doesn't have a decimal type. Bind exact values with `camus.numeric(value)`, where `value` can be a decimal string, for example. A JavaScript `number` binds as `INT64` or `FLOAT64`. |
| `DATE`, `DATETIME` | UTC `Date` objects, with millisecond precision. For the raw .NET tick value, use `ticksToDate` and `dateToTicks`. |
| `BYTES` | `Uint8Array`. |

CamusDB doesn't support `ARRAY(NUMERIC)`. The connector returns `CADB0400` for
a numeric array before it sends the request.

Vectors are stored in `BYTES` columns as packed little-endian `float32` values:

```ts
import { CamusVector, camus } from 'camusdb';

await client.execute('INSERT INTO docs (id, embedding) VALUES (GEN_ID(), @embedding)', {
  embedding: camus.vector([0.1, 0.2, 0.3]),
});

const row = await client.queryOne<{ embedding: Uint8Array }>('SELECT embedding FROM docs LIMIT 1');
const values = CamusVector.toFloats(row!.embedding);
```

## Intervals

`CamusInterval` keeps the calendar parts of an interval, such as months. It
doesn't convert calendar months to a fixed number of milliseconds. Interval results are strings. Parse
them when you need their parts:

```ts
import { CamusInterval } from 'camusdb';

const rows = await client.query<{ name: string; duration: string }>(
  `SELECT name, finished - started AS duration FROM jobs
   WHERE finished - started > CAST(@limit AS INTERVAL)`,
  { limit: CamusInterval.fromMilliseconds(60 * 60_000) },
);
for (const row of rows.rows) {
  console.log(row.name, CamusInterval.parse(row.duration).toMilliseconds());
}
```

A `CamusInterval` parameter binds as ISO 8601 text, such as `PT1H`.
You can also pass ISO 8601 text to `camus.interval(text)`. In SQL, you need
`CAST(@p AS INTERVAL)`. In the helper, `microseconds` is a `bigint`, and
`toString()` returns ISO 8601 text.
`toMilliseconds()` throws a `RangeError` when the interval has months.

`equals()` compares the three parts, and SQL compares with 30 days for each
month. This means that `P1M` and `P30D` are different helper values, and SQL
treats them as equal. The server doesn't have interval array elements. To send
interval text in an array, use `camus.array(items, ColumnType.String)`. For the
calendar arithmetic and limits, see [Intervals](/docs/data-types#intervals).

## JSON documents

JavaScript objects bind as [JSONB documents](/docs/json). For other JSON
values, such as JSON text or a JSON array, use `camus.jsonb(value)`. A
JavaScript array binds as `ARRAY`, and a string binds as `STRING`.

```ts
await client.execute(
  'INSERT INTO events (id, payload) VALUES (GEN_ID(), @payload)',
  { payload: { kind: 'login', user: { id: 7 } } },
);

const payload = await client.scalar<string>(
  'SELECT payload FROM events LIMIT 1', undefined, { jsonb: 'text' },
);
```

You can choose the decoding for a client, or for one statement:

| Mode | Returned value |
| --- | --- |
| `parse` (default) | The parsed JavaScript value. Unsafe integers become `bigint`. Fractional numbers are a `number`, and they can lose precision or trailing zeros. |
| `text` | PostgreSQL JSON text, with all the digits and the scale of each number. |

To make text the default, set `jsonb: 'text'` on `CamusClient`. In a connection
string, set `Jsonb=text`. `formatJsonb(text)` formats a document in the same
way. In text mode, a JSON null document returns the string `'null'`, and SQL
`NULL` returns `null`. In parse mode, both return `null`.

The server doesn't have `ARRAY(JSONB)`. To send an array of documents, wrap it
with `camus.jsonb` to send it as one document.

## Response limits and validation

A REST response body can be at most 256 MiB, and a line of a streamed result
at most 64 Mi characters. A larger response returns a `CamusError`. For large
results, use `queryStream()` or pagination.

The REST timeout covers the body and the headers, also for sign-in and
administration calls. Streamed rows don't count against that timeout. gRPC
streaming has a separate wait timeout for each row.

Endpoints and database names can't contain control characters. In the
`callStatement()` helper, which builds a `CALL` for a
[C# procedure](/docs/csharp-extensions#procedures), a parameter name must match
`@?[A-Za-z0-9_]+`.
An invalid name returns `CADB0400` before the request is sent. Server error
messages are sanitized. A token lifetime from the server is capped at 24
hours for renewal.

## Streaming

`queryStream<T>()` reads the rows one at a time, as the iterator advances. It
works the same way on REST and gRPC. The full result isn't kept in memory:

```ts
await using stream = await client.queryStream<Robot>('SELECT * FROM robots');

for await (const robot of stream) {
  console.log(robot.name);
}
```

## Transactions and retries

Use `transaction()` for the common case. It commits when the function returns,
and it rolls back when the function throws. A serializable conflict executes the
function again in a new transaction. This means that the function must be safe
to execute more than once.

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

Use `beginTransaction()` when the unit of work doesn't fit in one function:

```ts
await using txn = await client.beginTransaction();

await client.execute(
  'UPDATE robots SET year = @year WHERE id = @id',
  { year: 1984, id },
  { transaction: txn },
);

await txn.commit();
```

The transaction options are `isolationLevel`, `mode`, `locking`, `deferBegin`,
and, with learned routing, `affinity`. With `deferBegin: true`, the connector
sends `BEGIN` with the first statement, in place of a separate request. The
connector exports two presets: `OPTIMISTIC_TRANSACTION_OPTIONS` for optimistic
locking, and `SNAPSHOT_TRANSACTION_OPTIONS` for a serializable read-only
snapshot.

Use `withRetry(...)` around your own idempotent units of work. For `CADB0509`
`TransactionFinalizeUnresolved`, the connector sends the same commit again on
the same transaction handle. This error doesn't mean that you must execute the
transaction again.

### Pipelined transactions

Use a transaction pipeline when several statements have independent inputs.
The connector queues them. Over gRPC with request frames, it sends each group in
one stream message:

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

`pipeline.commit()` commits only after all the queued statements succeed.
`pipeline.exchanges` is the count of round trips. For example, the pipeline
above takes 2 exchanges over gRPC and 5 over REST. Without request frames, for
example over REST, the queued operations are executed one after another, with
the same result. DDL and `TRUNCATE` can't be in a
transaction pipeline, and they return `CADB0538`.

## Prepared statements

The connector prepares repeated statements automatically. By default, a
statement is prepared on its second execution, and the 128 most recently used
registrations are kept. To turn off automatic preparation, set
`maxAutoPrepare: 0`.

```ts
await client.prepare('SELECT * FROM robots WHERE year = @year');

client.isPrepared('SELECT * FROM robots WHERE year = @year');
client.preparedStatementCount;
```

Prepared statements are an optimization. If the server doesn't accept a
registration, the connector sends the statement inline.

## Authentication

With authentication off, the connector sends no `Authorization` header. To sign
in, pass `user` and `password`. You can also sign in at runtime:

```ts
await client.login('app', await secrets.get('camus-password'));
await client.logout();
```

The password is exchanged for a bearer token. Clients with the same identity
and deployment share the token. The token is renewed before it expires. If the
server doesn't accept it, the token is refreshed once. Privilege errors aren't retried.

Outside loopback, use `https://` for connections with credentials. The connector
doesn't send credentials to a remote `http://` endpoint, unless
`allowInsecureCredentials` is set.

## Transport and routing

REST is the default transport. To use gRPC, set `protocol: 'grpc'`. Then point
`endpoint` at the gRPC port:

```ts
const client = new CamusClient({
  endpoint: 'http://localhost:5096',
  database: 'test',
  protocol: 'grpc',
  backupEndpoint: 'http://localhost:5095',
});
```

gRPC statements use a small pool of long-lived `BatchExecute` streams. They
send the causal token of the session between requests. The causal token is a
cluster timestamp ([HLC](/docs/concepts#hlc)). It lets a session read its
writes on any node.

When the server supports gRPC request frames, the connector packs waiting
operations into one stream message. This is on by default. Set
`requestFrames: false` to turn it off, for example to measure the difference.

When a gRPC token is renewed, new work goes to a new stream. The old stream
remains open for the transactions that began on it, until they finish or until
`streamDrainTimeoutMs` passes.

In a cluster, learned routing can use server routing advice to send later
executions of a statement directly to the node that
[leads](/docs/concepts#leader) its data:

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

The `routingNodes` map is the authority. A server response names only an opaque
node identity. The connector routes only to endpoints that the map names and
that are also in the endpoint pool. For more information, see
[SQL routing advice](/docs/sql-routing-advice).

## Administration helpers

The connector has helpers for database administration:

```ts
await client.createDatabase('analytics', { ifNotExists: true });
await client.dropDatabase('analytics');
await client.createBranchDatabase('feature-x', 'production');
await client.showBranches('production');
await client.showAncestors('feature-x');
client.changeDatabase('analytics');
```

It also has helpers for storage-strategy DDL, and for a rewrite of large values
that are already stored:

```ts
import { CamusColumnStorage, setColumnStorageStatement } from 'camusdb';

await client.executeDdl(
  setColumnStorageStatement('docs', 'embedding', CamusColumnStorage.Plain),
);

await client.rewriteStorage('docs', { timeoutSeconds: 3600 });
await client.rewriteStorage('docs', { inline: true, timeoutSeconds: 3600 });
```

`rewriteStorage(table)` executes `ALTER TABLE ... REWRITE STORAGE`. With
`inline: true`, it writes the values back into the row, uncompressed. Older
servers can read this form before a downgrade.

Sequence helpers build valid SQL and get the next value as a `bigint`:

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

A rollback doesn't return sequence values. With a transaction option,
`nextSequenceValue` executes in that transaction. However, the server doesn't
issue the same sequence value twice.

Use `cacheHint(...)` to build a query result cache hint, and read
`result.cacheMetadata` for the result:

```ts
import { cacheHint } from 'camusdb';

const hint = cacheHint('recent_orders', { ttlMs: 30_000, strict: true });
const result = await client.query(`SELECT id FROM orders ${hint}`);
// hint is "{cache=recent_orders, ttl=30000, strict}"
// result.cacheMetadata is { status: 'miss', name: 'recent_orders', isHit: false, ... }
```

The backup API is available at `client.backups`. It applies to the full node,
and it uses REST. This means that a gRPC client must set `backupEndpoint`. The
server must have a backup directory configured. For more information, see
[Backup and restore](/docs/backup-and-restore).

```ts
const full = await client.backups.takeFullBackup();
const catalog = await client.backups.listBackups();
const preview = await client.backups.previewGarbageCollection();
```

### Node statistics

`nodeStats()` returns the resource use of one node, over REST or gRPC.
To inspect a cluster, call it for each configured endpoint:

```ts
for (const endpoint of client.endpoints) {
  const stats = await client.nodeStats(endpoint);
  console.log(stats.address, stats.cpu.processCpuPercent);
}
```

Each node answers for itself only. An endpoint that you pass must be in
`client.endpoints`. A field that isn't available is `-1`, with details in
`errors`. With authentication on, this call needs a superuser or
`GRANT MONITOR ON *.*`.

## OpenTelemetry

With `@opentelemetry/api` installed and an OpenTelemetry SDK registered, the
connector emits client spans and the `db.client.operation.duration` metric for
each operation, such as a statement or a commit. It also records metrics, such
as retries, under the `camusdb` instrumentation scope.

Spans include attributes such as the database and the error code. They follow
the active OpenTelemetry context. This means that transport spans are children
of the database operation. Set `traceQueryText: true` if you can record SQL
text. Parameter values aren't recorded.

## Process lifetime

A `CamusClient` is cheap to create and safe to share. The connection state,
such as bearer tokens and prepared statements, is shared in the process for
each deployment and configuration.

When a Node.js process shuts down, close the shared gRPC channels:

```ts
import { CamusTransportPool } from 'camusdb';

await CamusTransportPool.closeAll();
```

## Sample application

CamusBooking uses the TypeScript connector in a Next.js app that reserves seats
and retries concurrent requests. For more information, see
[CamusBooking advanced sample](/docs/advanced-samples#camusbooking).
