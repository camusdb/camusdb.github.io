---
sidebar_position: 4
---

# gRPC API

CamusDB exposes a client-facing gRPC API in addition to the REST/JSON API.
The gRPC endpoint uses HTTP/2 on a dedicated port and reaches the same SQL,
transaction, and row-operation engine as the HTTP endpoints.

Enable it in `config.yml`:

```yaml
grpc_enabled: true
grpc_port: 5096
```

If `raft_certificate` is configured, CamusDB reuses it for TLS on the gRPC
listener. Otherwise the gRPC listener uses plaintext HTTP/2, which is suitable
for local development and private test networks.

The Protobuf contract lives in the CamusDB source tree at
`CamusDB.Grpc.Contracts/Protos/camus_sql.proto`. Generate client bindings from
that file with the standard gRPC toolchain for your language.

## Services

The protocol defines two services:

| Service | Use it for |
| --- | --- |
| `CamusSql` | SQL queries, DML, DDL, explicit transactions, ping, and duplex batching. |
| `CamusRows` | Typed row CRUD without building SQL text. |

Use `CamusSql` for most application and ORM work. Use `CamusRows` when a client
already has structured row values, filters, and ordering and wants to avoid
constructing SQL strings.

## SQL Service

`CamusSql` provides:

| RPC | Shape | Purpose |
| --- | --- | --- |
| `ExecuteQuery` | server stream | Execute `SELECT`; emits schema first, then rows. |
| `ExecuteNonQuery` | unary | Execute `INSERT`, `UPDATE`, or `DELETE`; returns affected rows. |
| `ExecuteDdl` | unary | Execute database, table, index, and schema statements. |
| `StartTransaction` | unary | Start an explicit transaction and receive a `TxnHandle`. |
| `CommitTransaction` | unary | Commit an explicit transaction by handle. |
| `RollbackTransaction` | unary | Roll back an explicit transaction by handle. |
| `BatchExecute` | bidirectional stream | Pipeline SQL operations and transaction lifecycle messages on one stream. |
| `Ping` | unary | Check liveness and round-trip connectivity. |

SQL parameters are sent as a `map<string, Value>`. Prefer parameters over SQL
string interpolation so typed values such as `DATE`, `DATETIME`, `BYTES`, and
`UUID` cross the wire without loss.

## Row Service

`CamusRows` provides typed CRUD operations:

| RPC | Purpose |
| --- | --- |
| `InsertRow` | Insert one row from a column-value map. |
| `Query` | Query rows by table, optional index name, filters, and ordering. |
| `QueryById` | Fetch one row by primary-key value. |
| `UpdateRows` | Update matching rows. |
| `UpdateById` | Update one row by primary-key value. |
| `DeleteRows` | Delete matching rows. |
| `DeleteById` | Delete one row by primary-key value. |

Filters use `QueryFilter { column_name, op, value }`, where `op` is a string
such as `"="`, `">"`, `">="`, `"<"`, `"<="`, or `"LIKE"`. Ordering uses
`OrderBy { column_name, direction }`, with ascending or descending direction.

`QueryById`, `UpdateById`, and `DeleteById` take a string key value. The server
resolves the real primary-key column from the table schema, so the primary key
does not need to be named `id`.

## Value Encoding

All parameters, row values, filters, and result cells use the Protobuf `Value`
message. It is a typed `oneof` that mirrors CamusDB's column types:

| Column type | Wire field | Encoding |
| --- | --- | --- |
| `NULL` | `null_value` | Explicit typed NULL sentinel. |
| `ID` / `OID` | `id_value` | 24 lowercase ObjectId hex characters. |
| `INT64` | `int64_value` | Signed 64-bit integer. |
| `STRING` | `string_value` | UTF-8 string. |
| `BOOL` | `bool_value` | Boolean. |
| `FLOAT64` | `float64_value` | IEEE-754 double. |
| `FLOAT32` | `float32_value` | IEEE-754 float. |
| `BYTES` | `bytes_value` | Raw bytes. |
| `DATE` | `date_value` | UTC .NET ticks, truncated to midnight. |
| `DATETIME` | `datetime_value` | UTC .NET ticks. |
| `ARRAY` | `array_value` | Element type plus nested `Value` items. |
| `UUID` / `GUID` | `uuid_value` | Exactly 16 bytes in canonical big-endian order. |

Important rules for client implementers:

- Send ObjectIds in `id_value`, not `string_value`.
- Send UUIDs as 16 bytes, not as strings.
- Send `DATE` and `DATETIME` as ticks, not ISO strings or Unix timestamps.
- Preserve `FLOAT32` and `FLOAT64` as separate wire fields.
- Include the array element type even when the array is empty.
- Treat an unset `Value` and explicit `null_value` as NULL when decoding.

To convert Unix milliseconds to ticks:

```text
ticks = 621355968000000000 + unix_millis * 10000
```

## Query Streams

`ExecuteQuery`, `CamusRows.Query`, and `CamusRows.QueryById` are
server-streaming calls with a schema-first contract:

```text
QueryStreamMessage(schema)
QueryStreamMessage(row)
QueryStreamMessage(row)
...
```

The schema message is always first and appears exactly once, even when the
result set is empty. Rows are positional: `row.values[i]` belongs to
`schema.columns[i]`. Clients should take the column type from the schema, not
from the first non-NULL row value.

## Transactions

Every SQL and row operation can run in autocommit mode or inside an explicit
transaction.

Autocommit requests omit `txn_handle`. The server starts a short transaction,
runs the operation, and commits it.

Explicit transactions use `CamusSql.StartTransaction`:

```text
StartTransaction -> TxnHandle
ExecuteQuery / ExecuteNonQuery / ExecuteDdl with txn_handle
CommitTransaction(txn_handle)
```

`StartTxnRequest` and autocommit `SqlRequest` can set:

- `isolation_level`: `READ_COMMITTED` or `SERIALIZABLE`
- `transaction_mode`: `READ_WRITE` or `READ_ONLY`
- `locking`: `PESSIMISTIC` or `OPTIMISTIC`

When a request resumes an existing `txn_handle`, these fields are ignored
because the transaction properties were fixed when the transaction started.

## Causal Tokens

Replies that advance transaction state include a causal token with three HLC
components:

- `causal_token_n`
- `causal_token_l`
- `causal_token_c`

Carry all three values into the next request in the same client session. The
`N` component is part of HLC ordering and must not be dropped. Threading the
token preserves read-your-writes behavior when a client talks to a cluster.

For explicit transactions, keep the latest causal token in the `TxnHandle` when
resuming, committing, or rolling back the transaction.

## Duplex Batching

`CamusSql.BatchExecute` lets a client pipeline many operations over one
bidirectional stream. This is useful for drivers and ORMs that would otherwise
pay one unary round trip per statement.

Each request contains:

- `request_id`: client-assigned id echoed by every response for that operation
- `kind`: `QUERY`, `NON_QUERY`, `START`, `COMMIT`, or `ROLLBACK`
- `request`: the same `SqlRequest` shape used by unary SQL calls

Responses for different `request_id` values may interleave and arrive out of
order. Clients must demultiplex by `request_id`.

A batched query emits:

```text
schema
row...
query_complete
```

`query_complete` is the terminal message for that request and carries the row
count plus causal token. Non-query, start, commit, and rollback operations each
emit one terminal success response. Failed operations emit one terminal
`BatchError { code, message }`.

Operations that share the same transaction handle are ordered per batch stream.
If a client uses multiple batch streams, pin all operations for a transaction
to the same stream. Autocommit operations can use any stream.

`grpc_batch_max_in_flight` controls how many operations one batch stream may
execute concurrently before the server applies backpressure.

## Errors And Retries

Unary and server-streaming RPCs surface domain errors as gRPC status errors
with trailing metadata:

| Trailer | Meaning |
| --- | --- |
| `camus-error-code` | CamusDB `CADBxxxx` error code. |
| `camus-error-message` | Human-readable error message. |

Batched operations use in-band `BatchError` messages because trailers are
per-call, not per operation.

Retry by `camus-error-code`, not by message text:

| Code | Retry rule |
| --- | --- |
| `CADB0502` `TransactionConflict` | Replay the whole transaction from a fresh `BEGIN`. |
| `CADB0504` `TransactionMustRetry` | Replay the whole transaction from a fresh `BEGIN`. |
| `CADB0505` `TransactionLifetimeExceeded` | Replay the whole transaction from a fresh `BEGIN`. |
| `CADB0509` `TransactionFinalizeUnresolved` | Retry the same `COMMIT` or `ROLLBACK` on the same transaction handle. |

For streaming queries, only replay automatically if no rows have been surfaced
to the caller yet. Once rows have been emitted, surface the error to the caller
instead of silently replaying the query.

## Related Pages

- [HTTP API](/docs/http-api)
- [Configuration](/docs/configuration)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Serializable Retries](/docs/serializable-retries)
- [Error Codes](/docs/error-codes)
