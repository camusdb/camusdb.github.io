---
sidebar_position: 6
---

# Error Codes

CamusDB surfaces structured error codes through `CamusDBException` and through
HTTP API error responses.

Example failed HTTP response:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

## How To Read Them

- `CADB00xx`: catalog, metadata, or storage-state problems
- `CADB03xx`: data integrity constraint failures
- `CADB04xx`: invalid SQL, invalid input, or unsupported expression shape
- `CADB05xx`: transaction or schema-catch-up retry conditions
- `CADB06xx`: startup or configuration validation errors

Some codes are ordinary user-facing errors. Others mainly indicate corruption,
unexpected internal state, or storage-layer inconsistencies.

## Common User-Facing Errors

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | Reserved for operations that target a database name that does not exist. It is defined in the core error list but is not commonly surfaced by the current command path. |
| `CADB0011` | `TableDoesntExist` | A query, DML statement, or schema change references a table that does not exist, or the table name is empty. |
| `CADB0012` | `DatabaseAlreadyExists` | `CREATE DATABASE` targets an existing database, or a reserved database name is used. |
| `CADB0013` | `TableAlreadyExists` | `CREATE TABLE` tries to create a table name that already exists. |
| `CADB0016` | `IndexDoesntExist` | Reserved for index lookups or DDL against an index that does not exist. It is defined but not commonly thrown by the current user-facing path. |
| `CADB0300` | `DuplicateUniqueKeyValue` | An insert, update, or index backfill would violate a unique index or unique key. |
| `CADB0301` | `NotNullViolation` | An insert or update tries to store `NULL` into a `NOT NULL` column. |
| `CADB0400` | `InvalidInput` | The request shape is invalid: missing names, invalid DDL/DML parameters, malformed query structure, unsupported function arguments, invalid casts, duplicate aliases, invalid `GROUP BY` / `HAVING` / `DISTINCT` combinations, and similar user mistakes. |
| `CADB0401` | `UnknownType` | CamusDB is asked to encode, decode, cast, or evaluate a type it does not understand in that context. |
| `CADB0402` | `DuplicatePrimaryKey` | Reserved for duplicate primary-key violations. The current storage path usually reports uniqueness failures as `CADB0300`. |
| `CADB0403` | `DuplicateColumn` | A `CREATE TABLE` or `ALTER TABLE` introduces the same column name more than once. |
| `CADB0404` | `UnknownColumn` | A statement references a column name that is not present or not currently visible in the schema state. |
| `CADB0405` | `UnknownKey` | Query planning or scanning expected a known row or index key shape but received a key it could not map correctly. This is uncommon for ordinary SQL and usually points to an internal query/storage mismatch. |
| `CADB0406` | `SqlSyntaxError` | The SQL parser cannot parse the statement text. |
| `CADB0407` | `InvalidAstStmt` | The parser succeeded, but the resulting AST shape is invalid, unsupported, or semantically unusable for the requested executor path. |
| `CADB0501` | `TransactionAlreadyCompleted` | The caller tries to commit or roll back a transaction that is already committed, already rolled back, or otherwise no longer active. It is also used when Kahuna returns a permanent non-retryable commit failure and the transaction is already dead. |
| `CADB0502` | `TransactionConflict` | The transaction cannot acquire the needed lock or hits a conflicting concurrent write. |
| `CADB0503` | `SchemaCatchingUp` | The node is more than one schema version behind the committed schema head for that database, so it temporarily rejects reads and DML until schema apply catches up. Retry on another node or retry later. |
| `CADB0504` | `TransactionMustRetry` | The commit path exhausted internal retries after Kahuna kept returning `MustRetry`, usually during routing or leader-transition instability. Retry the whole transaction from `BEGIN`. |
| `CADB0600` | `InvalidConfig` | Startup configuration is invalid: wrong mode, invalid port, invalid schema-ack settings, malformed peer lists, invalid parser-cache values, and similar config errors. |

## Corruption And Internal-State Errors

These usually indicate storage corruption, schema metadata inconsistency, or an
unexpected engine state rather than a normal application mistake.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0014` | `SystemSpaceCorrupt` | CamusDB cannot decode or trust internal metadata, row payloads, schema blobs, index metadata, or other persisted system structures. |
| `CADB0015` | `TableCorrupt` | Reserved for table-level corruption detection. It is defined in the core list but is not commonly surfaced by the current code path. |
| `CADB0017` | `InvalidIndexLayout` | Reserved for invalid persisted index layout or index metadata shape. It is defined but not commonly surfaced by the current runtime path. |
| `CADB00297` | `InvalidPageOffset` | Reserved for invalid low-level page offsets in storage structures. Not commonly surfaced by the current KV-backed runtime path. |
| `CADB0096` | `InvalidInformationSchema` | Reserved for invalid information-schema state. Defined, but not commonly thrown in the current public execution path. |
| `CADB0097` | `InvalidPageLength` | Reserved for invalid low-level page lengths in storage structures. |
| `CADB0098` | `InvalidPageChecksum` | Reserved for low-level page checksum mismatches. |
| `CADB0099` | `InvalidInternalOperation` | CamusDB reached an unexpected internal state: impossible planner state, invalid replicated index shape, row disappearance during update, unexpected forwarder response, or other invariants that should not fail in normal use. |

## Retry Guidance

These codes are usually retryable:

- `CADB0502` `TransactionConflict`
- `CADB0503` `SchemaCatchingUp`
- `CADB0504` `TransactionMustRetry`

These codes are usually not retryable without changing the request:

- `CADB0400` `InvalidInput`
- `CADB0404` `UnknownColumn`
- `CADB0406` `SqlSyntaxError`
- `CADB0300` `DuplicateUniqueKeyValue`
- `CADB0301` `NotNullViolation`

These codes usually need operator investigation rather than blind retries:

- `CADB0014` `SystemSpaceCorrupt`
- `CADB0099` `InvalidInternalOperation`

## Related Pages

- [HTTP API](/docs/http-api)
- [Serializable Transactions](/docs/serializable-transactions)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Distributed Schema Changes](/docs/distributed-schema)
