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
| `CADB0010` | `DatabaseDoesntExist` | An operation targets a database name that has not been explicitly created, or a name that was dropped or renamed away. |
| `CADB0011` | `TableDoesntExist` | A query, DML statement, schema change, or table rename references a table that does not exist, or the table name is empty. |
| `CADB0012` | `DatabaseAlreadyExists` | `CREATE DATABASE` targets an existing database, or `RENAME DATABASE ... TO ...` targets a name that is already registered. |
| `CADB0013` | `TableAlreadyExists` | `CREATE TABLE` tries to create a table name that already exists, or `ALTER TABLE ... RENAME TO ...` targets an existing table name. |
| `CADB0016` | `IndexDoesntExist` | Reserved for index lookups or DDL against an index that does not exist. It is defined but not commonly thrown by the current user-facing path. |
| `CADB0018` | `DatabaseNameReserved` | `CREATE DATABASE` or `RENAME DATABASE` uses a reserved name such as `_system` or `information_schema`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for an incomplete database-create recovery condition from older standalone storage layouts. It is defined in the core list but is not expected on the current shared-storage create path. |
| `CADB0300` | `DuplicateUniqueKeyValue` | An insert, update, or index backfill would violate a unique index or unique key. |
| `CADB0301` | `NotNullViolation` | An insert or update tries to store `NULL` into a `NOT NULL` column. |
| `CADB0302` | `ValueTooLong` | An insert, update, or cast tries to store a `STRING` or `BYTES` value longer than the column's configured or default maximum length. |
| `CADB0400` | `InvalidInput` | The request shape is invalid: missing names, invalid DDL/DML parameters, malformed query structure, unsupported function arguments, invalid casts, malformed UUID input, duplicate aliases, invalid index rename inputs, invalid `GROUP BY` / `HAVING` / `DISTINCT` combinations, and similar user mistakes. |
| `CADB0401` | `UnknownType` | CamusDB is asked to encode, decode, cast, or evaluate a type it does not understand in that context. |
| `CADB0402` | `DuplicatePrimaryKey` | Reserved for duplicate primary-key violations. The current storage path usually reports uniqueness failures as `CADB0300`. |
| `CADB0403` | `DuplicateColumn` | A `CREATE TABLE` or `ALTER TABLE` introduces the same column name more than once, or a column rename targets an existing column name. |
| `CADB0404` | `UnknownColumn` | A statement references or renames a column name that is not present or not currently visible in the schema state. |
| `CADB0405` | `UnknownKey` | Query planning or scanning expected a known row or index key shape but received a key it could not map correctly. This is uncommon for ordinary SQL and usually points to an internal query/storage mismatch. |
| `CADB0406` | `SqlSyntaxError` | The SQL parser cannot parse the statement text. |
| `CADB0407` | `InvalidAstStmt` | The parser succeeded, but the resulting AST shape is invalid, unsupported, or semantically unusable for the requested executor path. |
| `CADB0408` | `SchemaLimitExceeded` | A database, table, column, or index name is longer than `max_identifier_length`, or a schema operation would exceed `max_columns_per_table`, `max_indexes_per_table`, or `max_tables_per_database`. |
| `CADB0501` | `TransactionAlreadyCompleted` | The caller tries to commit or roll back a transaction that is already committed, already rolled back, or otherwise no longer active. It is also used when Kahuna returns a permanent non-retryable commit failure and the transaction is already dead. |
| `CADB0502` | `TransactionConflict` | The transaction cannot acquire the needed lock or hits a conflicting concurrent write. |
| `CADB0503` | `SchemaCatchingUp` | The node is more than one schema version behind the committed schema head for that database, so it temporarily rejects reads and DML until schema apply catches up. Retry on another node or retry later. |
| `CADB0504` | `TransactionMustRetry` | The commit path exhausted internal retries after Kahuna kept returning `MustRetry`, usually during routing or leader-transition instability. Retry the whole transaction from `BEGIN`. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction stayed open longer than the configured maximum lifetime, currently one hour by default. CamusDB aborts it explicitly instead of letting a runaway transaction continue forever. Roll it back and retry from `BEGIN`. |
| `CADB0506` | `TransactionMutationLimitExceeded` | A read-write transaction would exceed the maximum mutation count, currently 20,000 row/index mutations by default. Split the work into smaller transactions; retrying the same transaction will fail again. |
| `CADB0507` | `SpillStorageUnavailable` | A query operator needed spill-to-disk temporary storage, but CamusDB could not create the spill directory or open a spill file. Free disk space, fix permissions under `data_dir`, or run the query on a node with writable spill storage. |
| `CADB0508` | `DatabaseHasLiveDescendants` | `DROP DATABASE` targets a database that still has live branch descendants. Drop descendant branches first, then drop the parent. |
| `CADB0600` | `InvalidConfig` | Startup configuration is invalid: wrong mode, invalid listener or Raft port, malformed peer lists, invalid schema-ack settings, invalid transaction/locking settings, invalid parser-cache values, unknown config keys, or unsupported `kahuna` options. |

## Corruption And Internal-State Errors

These usually indicate storage corruption, schema metadata inconsistency, or an
unexpected engine state rather than a normal application mistake.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0014` | `SystemSpaceCorrupt` | CamusDB cannot decode or trust internal metadata, row payloads, schema blobs, index metadata, registry entries, or other persisted system structures. |
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
- `CADB0505` `TransactionLifetimeExceeded`

These codes are usually not retryable without changing the request:

- `CADB0010` `DatabaseDoesntExist`
- `CADB0012` `DatabaseAlreadyExists`
- `CADB0018` `DatabaseNameReserved`
- `CADB0400` `InvalidInput`
- `CADB0404` `UnknownColumn`
- `CADB0406` `SqlSyntaxError`
- `CADB0408` `SchemaLimitExceeded`
- `CADB0300` `DuplicateUniqueKeyValue`
- `CADB0301` `NotNullViolation`
- `CADB0302` `ValueTooLong`
- `CADB0506` `TransactionMutationLimitExceeded`
- `CADB0507` `SpillStorageUnavailable`
- `CADB0508` `DatabaseHasLiveDescendants`

These codes usually need operator investigation rather than blind retries:

- `CADB0014` `SystemSpaceCorrupt`
- `CADB0099` `InvalidInternalOperation`

## Related Pages

- [HTTP API](/docs/http-api)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Serializable Retries](/docs/serializable-retries)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Distributed Schema Changes](/docs/distributed-schema)
- [Database Branching](/docs/database-branching)
