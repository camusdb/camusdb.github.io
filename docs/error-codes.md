---
sidebar_position: 6
---

# Error Codes

CamusDB surfaces structured error codes through `CamusDBException`, HTTP API
error responses, and gRPC error metadata.

Example failed HTTP response:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

gRPC unary and streaming calls include the same domain code in the
`camus-error-code` trailer. Batched gRPC operations carry it in the in-band
`BatchError` message.

## How To Read Them

- `CADB00xx`: catalog, metadata, or storage-state problems
- `CADB03xx`: data integrity constraint failures
- `CADB04xx`: invalid SQL, invalid input, or unsupported expression shape
- `CADB05xx`: transaction, schema-catch-up, prepared-statement, and auth conditions
- `CADB051x`: authentication, authorization, users, and grants
- `CADB06xx`: startup or configuration validation errors
- `CADB07xx`: backup and point-in-time-recovery operations

Some codes are ordinary user-facing errors. Others mainly indicate corruption,
unexpected internal state, or storage-layer inconsistencies.

## Common User-Facing Errors

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | An operation targets a database name that has not been explicitly created, or a name that was dropped or renamed away. |
| `CADB0011` | `TableDoesntExist` | A query, DML statement, schema change, or table rename references a table that does not exist, or the table name is empty. |
| `CADB0012` | `DatabaseAlreadyExists` | `CREATE DATABASE` targets an existing database, or a database rename targets a name that is already registered. |
| `CADB0013` | `TableAlreadyExists` | `CREATE TABLE` tries to create a table name that already exists, or `ALTER TABLE ... RENAME TO ...` targets an existing table name. |
| `CADB0016` | `IndexDoesntExist` | Reserved for index lookups or DDL against an index that does not exist. It is defined but not commonly thrown by the current user-facing path. |
| `CADB0018` | `DatabaseNameReserved` | `CREATE DATABASE` or a database rename uses a reserved name such as `_system` or `information_schema`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for an incomplete database-create recovery condition from older standalone storage layouts. It is defined in the core list but is not expected on the current shared-storage create path. |
| `CADB0300` | `DuplicateUniqueKeyValue` | An insert, update, or index backfill would violate a unique index or unique key. |
| `CADB0301` | `NotNullViolation` | An insert or update tries to store `NULL` into a `NOT NULL` column. |
| `CADB0302` | `ValueTooLong` | An insert, update, or cast tries to store a `STRING` or `BYTES` value longer than the column's configured or default maximum length. |
| `CADB0303` | `CheckConstraintViolation` | An insert, update, or `ALTER TABLE ... ADD CONSTRAINT ... CHECK` would make a row violate a check constraint, or check evaluation hits incompatible values or a regex failure inside the check. |
| `CADB0400` | `InvalidInput` | The request shape is invalid: missing names, invalid DDL/DML parameters, malformed query structure, invalid check definitions, invalid regex patterns, unsupported function arguments, invalid casts, malformed UUID input, duplicate aliases, invalid transaction priority, invalid table settings such as row-level TTL options, invalid index rename inputs, invalid `INSERT INTO ... SELECT` column counts, invalid CTAS projections, invalid `GROUP BY` / `HAVING` / `DISTINCT` combinations, and similar user mistakes. |
| `CADB0401` | `UnknownType` | CamusDB is asked to encode, decode, cast, or evaluate a type it does not understand in that context. |
| `CADB0402` | `DuplicatePrimaryKey` | Reserved for duplicate primary-key violations. The current storage path usually reports uniqueness failures as `CADB0300`. |
| `CADB0403` | `DuplicateColumn` | A `CREATE TABLE` or `ALTER TABLE` introduces the same column name more than once, or a column rename targets an existing column name. |
| `CADB0404` | `UnknownColumn` | A statement references or renames a column name that is not present or not currently visible in the schema state. |
| `CADB0405` | `UnknownKey` | Query planning or scanning expected a known row or index key shape but received a key it could not map correctly. This is uncommon for ordinary SQL and usually points to an internal query/storage mismatch. |
| `CADB0406` | `SqlSyntaxError` | The SQL parser cannot parse the statement text. |
| `CADB0407` | `InvalidAstStmt` | The parser succeeded, but the resulting AST shape is invalid, unsupported, or semantically unusable for the requested executor path. |
| `CADB0408` | `SchemaLimitExceeded` | A database, table, column, or index name is longer than `max_identifier_length`, or a schema operation would exceed `max_columns_per_table`, `max_indexes_per_table`, or `max_tables_per_database`. |
| `CADB0409` | `InvalidAsOfSystemTime` | An `AS OF SYSTEM TIME` query uses a malformed value, a future or non-positive timestamp, an incompatible parameter, or a transaction shape that cannot be pinned to an arbitrary historical snapshot. |
| `CADB0501` | `TransactionAlreadyCompleted` | The caller tries to commit or roll back a transaction that is already committed, already rolled back, or otherwise no longer active. It is also used when Kahuna returns a permanent non-retryable commit failure and the transaction is already dead. |
| `CADB0502` | `TransactionConflict` | The transaction cannot acquire the needed lock or hits a conflicting concurrent write. Conflict messages include bounded diagnostic context such as the table/database, a small sample of contended keys, and the waiting transaction mode when available. |
| `CADB0503` | `SchemaCatchingUp` | The node is more than one schema version behind the committed schema head for that database, so it temporarily rejects reads and DML until schema apply catches up. Retry on another node or retry later. |
| `CADB0504` | `TransactionMustRetry` | A pre-write transient condition exhausted internal retries, usually during transaction start, admission, routing, leader transition, lock-wait deadline, or a storage write conflict before the affected write was applied. Retry the whole transaction from `BEGIN`. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction stayed open longer than the configured maximum lifetime, currently one hour by default. CamusDB aborts it explicitly instead of letting a runaway transaction continue forever. Roll it back and retry from `BEGIN`. |
| `CADB0506` | `TransactionMutationLimitExceeded` | A read-write transaction would exceed the maximum mutation count, currently 20,000 row/index mutations by default. Split the work into smaller transactions; retrying the same transaction will fail again. |
| `CADB0507` | `SpillStorageUnavailable` | A query operator needed spill-to-disk temporary storage, but CamusDB could not create the spill directory or open a spill file. Free disk space, fix permissions under `data_dir`, or run the query on a node with writable spill storage. |
| `CADB0508` | `DatabaseHasLiveDescendants` | `DROP DATABASE` targets a database that still has live branch descendants. Drop descendant branches first, then drop the parent. |
| `CADB0509` | `TransactionFinalizeUnresolved` | A `COMMIT` or `ROLLBACK` could not reach a terminal answer after bounded same-handle retries. The final outcome is not known yet, so retry the same finalize request on the same transaction id; do not replay the business operation from `BEGIN`. |
| `CADB0510` | `OrphanNotFound` | `CREATE DATABASE ... RELINK TO`, `CREATE TABLE ... RELINK TO`, or orphan reclamation references an orphan id that does not exist, was already recovered, or was already reclaimed. |
| `CADB0511` | `CommentTooLong` | A `COMMENT ON` statement or inline `COMMENT` clause exceeds the maximum comment length of `65,535` characters. Shorten the comment and retry. |
| `CADB0512` | `UserAlreadyExists` | `CREATE USER` targets an existing user without `IF NOT EXISTS`. |
| `CADB0513` | `UserDoesNotExist` | `ALTER USER`, `DROP USER`, `GRANT`, or `REVOKE` targets a user that does not exist. `GRANT` never creates users implicitly. |
| `CADB0514` | `UnsupportedAuthPlugin` | `IDENTIFIED WITH <plugin>` names an unsupported authentication plugin. Only `sha256_password` is accepted. |
| `CADB0515` | `InvalidPrivilege` | `GRANT` or `REVOKE` names an unknown privilege or a privilege that is invalid for the target scope. |
| `CADB0516` | `AuthenticationFailed` | Authentication failed because credentials are missing, invalid, expired, revoked, or rejected. Login failures intentionally use the same error shape for unknown users and wrong passwords. |
| `CADB0517` | `InsufficientPrivilege` | The caller is authenticated but lacks the privilege required by the statement. |
| `CADB0518` | `TooManyAuthAttempts` | Login rate limit or password-verification concurrency protection rejected the attempt. |
| `CADB0519` | `InsecureTransport` | A credential-bearing request arrived over plaintext while authentication is enabled and TLS is required. |
| `CADB0520` | `UnknownPreparedStatement` | A prepared statement handle is not registered on this node, stream, or principal. It may have expired, been closed, belonged to another gRPC stream, been prepared on another node, or disappeared during restart. Prepare again and replay once. |
| `CADB0521` | `PreparedStatementLimitExceeded` | A prepared-statement registration would exceed a configured count cap, retained-byte budget, or maximum statement size. Close unused handles, reduce distinct SQL shapes, shorten the SQL, or tune the prepared-statement limits. |
| `CADB0522` | `AnalyzeRequiresNoPendingWrites` | `ANALYZE` was issued inside a transaction that has already written rows it has not committed. `ANALYZE` scans under its own read-only snapshot so the statistics it publishes describe committed data only, and that snapshot cannot read past the caller's own unresolved write intents. Commit or roll back first, then run `ANALYZE`. |
| `CADB0523` | `ViewDoesntExist` | A statement references a view or materialized view that does not exist. |
| `CADB0524` | `ViewAlreadyExists` | The name is already taken by a view or a materialized view. A name taken by an ordinary table raises `CADB0013` instead, so the error names the kind of object actually in the way. |
| `CADB0525` | `ViewNotUpdatable` | DML was issued against a view that is not auto-updatable, or against a materialized view. All views are currently read-only. The message names the specific rule that was violated. |
| `CADB0526` | `ViewColumnNotUpdatable` | An `UPDATE` or `INSERT` through a view targeted a column that is computed rather than a direct base-column reference, so there is no base column to write. |
| `CADB0527` | `ViewCheckOptionViolated` | A row written through a view with `WITH CHECK OPTION` does not satisfy the view's predicate. Evaluated with the same three-valued logic as a `CHECK` constraint, so a predicate returning `NULL` passes. |
| `CADB0528` | `ViewRecursionDetected` | A view's dependencies form a cycle. Detected at DDL time by walking the stored dependency ids; `max_view_expansion_depth` is a runtime backstop, not the defense. |
| `CADB0529` | `CannotChangeViewShape` | `CREATE OR REPLACE VIEW` tried to change the view's existing column names, types, or order. Only appending columns is allowed. Drop and recreate to change the shape. |
| `CADB0530` | `DependentObjectsExist` | A `DROP` would have orphaned an object that depends on the target, and the statement did not say `CASCADE`. The message lists the dependents. Raised for a dropped *column* a view reads as well as a dropped relation. Neither `DROP TABLE` nor `DROP COLUMN` has a `CASCADE` form; drop the dependent views first. |
| `CADB0531` | `MaterializedViewNotPopulated` | A materialized view created `WITH NO DATA`, and never refreshed, was read. Deliberately an error rather than an empty result, which would make a forgotten `REFRESH` indistinguishable from a correct empty answer. |
| `CADB0532` | `RefreshAlreadyInProgress` | A `REFRESH` of this materialized view is already running, on this node or another. Refused rather than queued: two concurrent refreshes would both succeed and the later swap would silently discard the earlier one's work. |
| `CADB0533` | `FeatureNotSupported` | A statement CamusDB parses but has not implemented, such as `REFRESH MATERIALIZED VIEW ... CONCURRENTLY`. Distinct from a syntax error: the statement is well-formed, and the message names the missing capability and the form that works today. |
| `CADB0534` | `ConcurrentSchemaChange` | An operation that derives a new definition from one it read found that definition changed underneath it, and refused to publish over the change. Nothing was applied; run it again against the current definition. |
| `CADB0535` | `SequenceUnavailable` | A monotonic counter — a database id, a table id, or the registry generation stamp — could not be reached: its Raft partition reported no confirmed leader for the whole `sequence_retry_budget_ms` window, because a node is still joining or an election is in flight. Nothing was allocated and nothing was written, so it is deliberately not a corruption error. Maps to HTTP 503; run the statement again. |
| `CADB0600` | `InvalidConfig` | Startup configuration is invalid: an explicit `--config` or `CAMUS_CONFIG_PATH` file does not exist, the mode is wrong, a listener or Raft port is invalid, peer lists are malformed, schema-ack settings are invalid, transaction/locking/priority settings are invalid, prepared-statement settings are invalid, statistics, automatic-analyze, row-level TTL, spill, diagnostics, parser-cache, or regex settings are invalid, config keys are unknown, or `kahuna` options are unsupported. |

## Backup And Restore Errors

The `CADB07xx` family is raised only by the backup and point-in-time-recovery
admin API. Each one maps to a specific HTTP status; see
[Backup And Restore](/docs/backup-and-restore) for the full reference.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0700` | `BackupNotConfigured` | A backup or restore was requested but `kahuna.backup_dir` is unset. Backups are opt-in. |
| `CADB0701` | `BackupChainInvalid` | A backup chain does not start at a full backup, has a gap or broken parent link, or contains a cycle. |
| `CADB0702` | `BackupNeedsFullBackup` | An incremental backup's parent fell below the retention floor, so no contiguous increment is possible. |
| `CADB0703` | `RestorePointOutOfWindow` | The requested restore point lies outside the chain's recoverable coverage. |
| `CADB0704` | `RestoreFailed` | A restore failed while copying the base image or replaying WAL. |
| `CADB0705` | `BackupParentMissing` | The parent backup named by an incremental request does not exist. |
| `CADB0706` | `BackupCorruptArtifact` | An artifact is missing, truncated, extra, duplicated, or fails its recorded digest. |
| `CADB0707` | `RestoreTargetConflict` | The restore destination already exists or overlaps the live data root, the backup root, or another job's target. |
| `CADB0708` | `BackupExactCheckpointUnavailable` | The storage backend cannot produce an exact as-of checkpoint at the requested cut. |
| `CADB0709` | `BackupUnsupportedFormat` | A manifest or artifact is in a legacy or unsupported format. |
| `CADB070A` | `BackupRetryableLeadershipLoss` | Partition leadership was lost mid-operation. Nothing durable was applied. |
| `CADB070B` | `BackupCancelled` | The caller cancelled the operation. |
| `CADB070C` | `RemoteRestoreDisabled` | No `kahuna.restore_root` is configured and the unconfined opt-in is off. |
| `CADB070D` | `BackupTopologyChanged` | Cluster topology changed during a coordinated backup, so the captured partition set is not one consistent cut. Nothing was published. |
| `CADB070E` | `BackupNotCoordinator` | A coordinated backup was requested on a node that does not lead the backup meta partition. |
| `CADB070F` | `BackupInsecureRoot` | The backup or restore root is a symlink, or is group- or world-writable. |

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
- `CADB0516` `AuthenticationFailed` after obtaining fresh credentials
- `CADB0518` `TooManyAuthAttempts` after waiting for the rate-limit window
- `CADB0520` `UnknownPreparedStatement` after preparing the statement again
- `CADB0532` `RefreshAlreadyInProgress` once the running refresh finishes
- `CADB0534` `ConcurrentSchemaChange` after re-reading the current definition
- `CADB0535` `SequenceUnavailable` once the partition's election settles
- `CADB070A` `BackupRetryableLeadershipLoss` once a leader is elected
- `CADB070D` `BackupTopologyChanged` once cluster membership is stable

`CADB0509` `TransactionFinalizeUnresolved` is a different kind of retry: resend
the same `COMMIT` or `ROLLBACK` for the same transaction id. Do not start a new
transaction and replay the statements, because the original commit may already
have succeeded server-side.

These codes are usually not retryable without changing the request:

- `CADB0010` `DatabaseDoesntExist`
- `CADB0012` `DatabaseAlreadyExists`
- `CADB0018` `DatabaseNameReserved`
- `CADB0400` `InvalidInput`
- `CADB0404` `UnknownColumn`
- `CADB0406` `SqlSyntaxError`
- `CADB0408` `SchemaLimitExceeded`
- `CADB0409` `InvalidAsOfSystemTime`
- `CADB0300` `DuplicateUniqueKeyValue`
- `CADB0301` `NotNullViolation`
- `CADB0302` `ValueTooLong`
- `CADB0303` `CheckConstraintViolation`
- `CADB0506` `TransactionMutationLimitExceeded`
- `CADB0507` `SpillStorageUnavailable`
- `CADB0508` `DatabaseHasLiveDescendants`
- `CADB0510` `OrphanNotFound`
- `CADB0511` `CommentTooLong`
- `CADB0512` `UserAlreadyExists`
- `CADB0513` `UserDoesNotExist`
- `CADB0514` `UnsupportedAuthPlugin`
- `CADB0515` `InvalidPrivilege`
- `CADB0517` `InsufficientPrivilege`
- `CADB0519` `InsecureTransport`
- `CADB0521` `PreparedStatementLimitExceeded`
- `CADB0522` `AnalyzeRequiresNoPendingWrites`
- `CADB0523` `ViewDoesntExist`
- `CADB0524` `ViewAlreadyExists`
- `CADB0525` `ViewNotUpdatable`
- `CADB0526` `ViewColumnNotUpdatable`
- `CADB0527` `ViewCheckOptionViolated`
- `CADB0528` `ViewRecursionDetected`
- `CADB0529` `CannotChangeViewShape`
- `CADB0530` `DependentObjectsExist`
- `CADB0531` `MaterializedViewNotPopulated`
- `CADB0533` `FeatureNotSupported`
- `CADB0700` `BackupNotConfigured`
- `CADB0702` `BackupNeedsFullBackup`
- `CADB0703` `RestorePointOutOfWindow`
- `CADB0705` `BackupParentMissing`
- `CADB0707` `RestoreTargetConflict`
- `CADB070C` `RemoteRestoreDisabled`
- `CADB070E` `BackupNotCoordinator`

These codes usually need operator investigation rather than blind retries:

- `CADB0014` `SystemSpaceCorrupt`
- `CADB0099` `InvalidInternalOperation`
- `CADB0701` `BackupChainInvalid`
- `CADB0704` `RestoreFailed`
- `CADB0706` `BackupCorruptArtifact`
- `CADB070F` `BackupInsecureRoot`

## Related Pages

- [HTTP API](/docs/http-api)
- [gRPC API](/docs/grpc-api)
- [Transactions And Isolation](/docs/serializable-transactions)
- [Transaction Limits](/docs/transaction-limits)
- [Retries And Conflicts](/docs/serializable-retries)
- [Distributed Transactions And HLC](/docs/distributed-transactions)
- [Distributed Schema Changes](/docs/distributed-schema)
- [Database Branching](/docs/database-branching)
- [Recover Dropped Objects](/docs/recover-dropped-objects)
- [Time-Travel Reads](/docs/time-travel-reads)
- [Schema Comments](/docs/comment-on)
- [Authentication And Authorization](/docs/sql-authentication)
