---
sidebar_position: 6
---

# Error codes

Each CamusDB error has a code and a message. The drivers
show the code on their error objects, for example the
[.NET](/docs/dotnet-driver) driver. Use this page to look up a code that you see
in a log or a response.

You should base application logic on the code. The message is for people, and
it can change. For example, replay a transaction with a
[retry helper](/docs/serializable-retries) on `CADB0502` or `CADB0504`. On a
`CADB03xx` constraint failure, show the user a validation error.

<details>
<summary>Error envelopes for protocol clients</summary>

A failed HTTP response looks like this:

```json
{
  "status": "failed",
  "code": "CADB0400",
  "message": "error message"
}
```

Unary and streaming gRPC calls carry the same domain code in the
`camus-error-code` trailer. A gRPC batch operation carries the code in its `BatchError` message.

</details>

## Code ranges

| Range | Area |
| --- | --- |
| `CADB00xx` | Catalog, metadata, and storage state. |
| `CADB03xx` | Data integrity constraints. |
| `CADB04xx` | Invalid SQL and invalid input. |
| `CADB05xx` | Transactions, schema, and statement limits. `CADB051x` is authentication and grants. |
| `CADB06xx` | Configuration. |
| `CADB07xx` | Backup and point-in-time recovery. |
| `CADB08xx` | C# extensions, and detected storage damage (`CADB0837`). The transaction errors `CADB0847` and `CADB0849` are also in this range. |

Most codes are errors that users see. Some codes report corruption or an
unexpected internal state. See
[Corruption and internal-state errors](#corruption-and-internal-state-errors).

## Common user-facing errors

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | The database doesn't exist, or it was dropped or renamed. With authentication on, also a database on which the caller doesn't have a grant. |
| `CADB0011` | `TableDoesntExist` | A statement references a table that doesn't exist, or the table name is empty. |
| `CADB0012` | `DatabaseAlreadyExists` | `CREATE DATABASE`, or a database rename, uses a name that exists. |
| `CADB0013` | `TableAlreadyExists` | A table already has the name of a new object, or of a renamed table. The code names the kind of the existing object: a view returns `CADB0524`, and a sequence returns `CADB0542`. |
| `CADB0016` | `IndexDoesntExist` | Reserved for an index that doesn't exist. The current user-facing paths rarely return it. |
| `CADB0018` | `DatabaseNameReserved` | `CREATE DATABASE`, or a database rename, uses a reserved name, such as `_system`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for an incomplete database creation in older storage layouts. The current create path doesn't return it. |
| `CADB0300` | `DuplicateUniqueKeyValue` | A write or an index backfill would break a unique index or unique key. |
| `CADB0301` | `NotNullViolation` | An insert or update would store `NULL` in a `NOT NULL` column. |
| `CADB0302` | `ValueTooLong` | A `STRING` or `BYTES` value is longer than the maximum length of the column. |
| `CADB0303` | `CheckConstraintViolation` | A row would break a check constraint, also when the constraint is added. An error in the check expression, such as a regex failure, also returns it. |
| `CADB0304` | `ForeignKeyViolation` | A child row doesn't have a parent row, also when the foreign key is added. |
| `CADB0305` | `ForeignKeyRestrictDelete` | A `DELETE` would remove a parent key that a child row references. |
| `CADB0306` | `ForeignKeyRestrictUpdate` | An `UPDATE` would change a parent key that a child row references. |
| `CADB0400` | `InvalidInput` | The request is invalid. For example: a missing name, an invalid parameter, an invalid cast, a constant division by zero, malformed JSON in a request, or an invalid setting. The message names the problem. |
| `CADB0401` | `UnknownType` | A type isn't known in that context. |
| `CADB0402` | `DuplicatePrimaryKey` | Reserved for duplicate primary keys. The storage path usually returns `CADB0300`. |
| `CADB0403` | `DuplicateColumn` | A column name is repeated, in any case, for example in a schema definition or an `INSERT` column list. A rename to an existing column name also returns it. HTTP 400. |
| `CADB0404` | `UnknownColumn` | A statement references a column that doesn't exist or isn't visible. |
| `CADB0405` | `UnknownKey` | A named index doesn't exist in the table, for example in a `FORCE_INDEX` hint. In other cases, it points to an internal mismatch. |
| `CADB0406` | `SqlSyntaxError` | The SQL can't be parsed. The message gives the line and column. |
| `CADB0407` | `InvalidAstStmt` | The statement parsed, but its shape isn't valid for the endpoint or the executor. For example, a non-query statement sent to the HTTP query endpoint. |
| `CADB0408` | `SchemaLimitExceeded` | A name is longer than `max_identifier_length`, or a schema change would pass a schema limit, such as `max_columns_per_table`. |
| `CADB0409` | `InvalidAsOfSystemTime` | The [historical read](/docs/time-travel-reads#syntax) has an invalid timestamp or clause placement, or the transaction can't be pinned to a historical snapshot. |
| `CADB0410` | `MalformedVector` | A `BYTES` value used as a vector has a length that isn't a multiple of 4 bytes, or it is empty. |
| `CADB0411` | `VectorDimensionMismatch` | The two vectors of a distance function have different dimensions. The message names both. |
| `CADB0412` | `InvalidVectorValue` | A vector element is `NaN` or infinite, or `cosine_distance` gets a vector of zero magnitude. |
| `CADB0413` | `StatementTooDeeplyNested` | A statement is nested too deeply, or a `WITH` expansion copies more than 250,000 parse nodes. See [statement limits](/docs/statement-nesting-limit). |
| `CADB0414` | `ColumnStorageNotApplicable` | A `STORAGE` strategy is set on a column type that doesn't have variable-length values. It applies to `STRING`, `BYTES`, `JSONB`, and `ARRAY` columns. |
| `CADB0415` | `InvalidForeignKeyDefinition` | A foreign key has an invalid target, for example a wrong column type or a view. |
| `CADB0416` | `ForeignKeyCycle` | A foreign key would create a cycle across two or more tables. A table can reference itself. |
| `CADB0417` | `NumericValueOutOfRange` | A `NUMERIC` value or result is outside the supported range, ±99999999999999999999999999999.999999999. |
| `CADB0418` | `InvalidJsonText` | The text of a `JSONB` value isn't a valid document, for example invalid JSON or a `\\u0000` escape. HTTP 400. See [JSON documents](/docs/json#write-a-document). |
| `CADB0419` | `JsonNestingTooDeep` | A `JSONB` document nests more than 512 levels. HTTP 400. |
| `CADB0420` | `IntegerValueOutOfRange` | An integer value or result is outside `INT64` or the column range. Use `NUMERIC` for wider exact values. HTTP 400; gRPC `OUT_OF_RANGE`. |
| `CADB0421` | `FloatValueOutOfRange` | A finite float value or result overflows, or underflows to zero. HTTP 400; gRPC `OUT_OF_RANGE`. |
| `CADB0422` | `JsonbValueTooLarge` | A built JSONB aggregate is larger than 268,435,455 bytes. HTTP 400; gRPC `INVALID_ARGUMENT`. |
| `CADB0423` | `InvalidIndexExpression` | The expression can't be used as an ordered index key. See [Expression indexes](/docs/sql-indexes#expression-indexes). HTTP 400. gRPC `INVALID_ARGUMENT`. |
| `CADB0501` | `TransactionAlreadyCompleted` | A commit or rollback names a transaction that isn't active. [Kahuna](/docs/concepts#kahuna), the storage layer, also returns it for a permanent commit failure of a dead transaction. |
| `CADB0502` | `TransactionConflict` | A lock conflict or a conflicting concurrent write, or a schema change since the transaction started. The message can name the table and some contended keys. Retry from `BEGIN`. |
| `CADB0503` | `SchemaCatchingUp` | The node is more than one schema version behind for the database. Retry later, or on another node. |
| `CADB0504` | `TransactionMustRetry` | A transient condition used up the internal retries, for example a [leader](/docs/concepts#leader) change or a lock-wait deadline. Retry from `BEGIN`. |
| `CADB0505` | `TransactionLifetimeExceeded` | A serializable read-write transaction was open longer than `max_serializable_transaction_lifetime_ms` (default one hour). Retry from `BEGIN`. |
| `CADB0506` | `TransactionMutationLimitExceeded` | A transaction would pass the mutation limit (default 20,000 row and index mutations). Split the work. A retry fails again. |
| `CADB0507` | `SpillStorageUnavailable` | An operator needed spill files, but the spill directory or a file couldn't be created. Free disk space, or fix the permissions under `data_dir`. |
| `CADB0508` | `DatabaseHasLiveDescendants` | `DROP DATABASE` of a database with live branches. Drop the branches first. |
| `CADB0509` | `TransactionFinalizeUnresolved` | A `COMMIT` or `ROLLBACK` doesn't have a final answer after the internal retries. Send the same request again on the same transaction. Don't replay the work. |
| `CADB0510` | `OrphanNotFound` | A `RELINK TO` or a reclamation names an orphan id that doesn't exist, or that was already recovered or reclaimed. |
| `CADB0511` | `CommentTooLong` | A comment is longer than 65,535 characters. |
| `CADB0512` | `UserAlreadyExists` | `CREATE USER` names a user that exists, and the statement doesn't have `IF NOT EXISTS`. |
| `CADB0513` | `UserDoesNotExist` | A user statement or a grant names a user that doesn't exist. `GRANT` doesn't create users. |
| `CADB0514` | `UnsupportedAuthPlugin` | `IDENTIFIED WITH` names an unsupported plugin. Only `sha256_password` is supported. |
| `CADB0515` | `InvalidPrivilege` | `GRANT` or `REVOKE` names an unknown privilege, or a privilege that isn't valid for the scope. |
| `CADB0516` | `AuthenticationFailed` | The credentials aren't valid, for example a wrong password or an expired token. Unknown users and wrong passwords get the same error. |
| `CADB0517` | `InsufficientPrivilege` | The caller doesn't have a privilege that the statement needs, also on tables that joins and subqueries read. |
| `CADB0518` | `TooManyAuthAttempts` | The sign-in rate limit, or the password-check concurrency limit, refused the attempt. |
| `CADB0519` | `InsecureTransport` | A request with credentials arrived over plaintext while authentication and TLS are required. Use `https://`, or configure a trusted TLS proxy. |
| `CADB0520` | `UnknownPreparedStatement` | A prepared statement handle isn't known, for example after a restart, or on another node. Prepare again and replay once. |
| `CADB0521` | `PreparedStatementLimitExceeded` | A prepared statement would pass a limit, such as the count limit. Close unused handles, or change the limits. |
| `CADB0522` | `AnalyzeRequiresNoPendingWrites` | `ANALYZE` executed in a transaction with uncommitted writes. Commit or roll back first. |
| `CADB0523` | `ViewDoesntExist` | A view or materialized view doesn't exist, or the statement is for the other kind, such as `DROP VIEW` on a materialized view. `SHOW STATISTICS FOR` on a view also returns it. |
| `CADB0524` | `ViewAlreadyExists` | A view or a materialized view already has the name of a new object. A table name returns `CADB0013`. |
| `CADB0525` | `ViewNotUpdatable` | DML was issued against a view that can't be written through, or against a materialized view. The message names the rule that the view breaks. See [Write through a view](/docs/views#write-through-a-view). |
| `CADB0526` | `ViewColumnNotUpdatable` | A write through a view targets a computed column. The column doesn't have a base column to write. |
| `CADB0527` | `ViewCheckOptionViolated` | A row written through a view `WITH CHECK OPTION` isn't a row of the view. A condition that is `NULL` also fails. See [WITH CHECK OPTION](/docs/views#with-check-option). |
| `CADB0528` | `ViewRecursionDetected` | The dependencies of a view form a cycle. This is detected at DDL time. |
| `CADB0529` | `CannotChangeViewShape` | `CREATE OR REPLACE VIEW` changes the existing columns of the view. Only new columns at the end are allowed. |
| `CADB0530` | `DependentObjectsExist` | A schema change would remove the target of a dependent object, for example of a view or a foreign key. Drop the dependent object first. |
| `CADB0531` | `MaterializedViewNotPopulated` | A read of a materialized view that was created `WITH NO DATA` and wasn't refreshed. This prevents an empty result by mistake. |
| `CADB0532` | `RefreshAlreadyInProgress` | A `REFRESH` of the materialized view is already in progress, on any node. |
| `CADB0533` | `FeatureNotSupported` | A statement that parses but isn't supported, such as `REFRESH MATERIALIZED VIEW ... CONCURRENTLY`. The message names the missing capability and the form that works. |
| `CADB0534` | `ConcurrentSchemaChange` | A definition changed while an operation derived a new one from it. The operation wasn't applied. Execute it again. |
| `CADB0535` | `SequenceUnavailable` | A counter, such as a table id, couldn't be reached: its [partition](/docs/concepts#partition) had no confirmed [Raft](/docs/concepts#raft) leader during `sequence_retry_budget_ms`. No value was allocated. HTTP 503. Retry. |
| `CADB0536` | `InsufficientDiskSpace` | Free space on the data volume is below `min_free_disk_bytes`, and the write was refused. Reads and DDL continue to work. HTTP 507. |
| `CADB0537` | `SnapshotPrecedesContentsGeneration` | An `AS OF SYSTEM TIME` read names a point before a [`TRUNCATE`](/docs/truncate-table) of the table. Read at or after the truncate, or recover the old contents with `RELINK TO`. |
| `CADB0538` | `StatementNotAllowedInTransaction` | A schema statement can't run in the current explicit transaction. See [Transactional schema changes](/docs/sql-transactions#transactional-schema-changes) for supported operations. |
| `CADB0539` | `BranchSnapshotProtectionLost` | A branch lost the snapshot protection of its inherited history. Create the branch again. HTTP 410. |
| `CADB0542` | `SequenceAlreadyExists` | A sequence already has the name of a new object. |
| `CADB0543` | `SequenceDoesntExist` | The sequence doesn't exist. |
| `CADB0544` | `SequenceExhausted` | The sequence doesn't have a value left before its `MAXVALUE`. |
| `CADB0545` | `InvalidSequenceDefinition` | The sequence definition is invalid, for example a negative increment or a `START` outside the range. |
| `CADB0546` | `SequenceValueNotYetDefined` | `currval` or `lastval` before the transaction drew a value. |
| `CADB0547` | `SequenceCallNotAllowedHere` | A sequence call is in a position where the number of values isn't known before the statement executes. |
| `CADB0548` | `SequenceInUse` | An identity column owns the sequence, or a column default uses it. |
| `CADB0549` | `SpillLimitExceeded` | A spill write would pass `spill_max_total_bytes` on this node. The statement fails, and its spill files are deleted. |
| `CADB0550` | `ReturningResultTooLarge` | The `RETURNING` rows of a write don't fit in one gRPC non-query reply. The statement rolls back. Use a streaming query, or ask for the row count only. |
| `CADB0551` | `QueryNotFound` | `CANCEL QUERY` didn't find a visible running query with the id. |
| `CADB0552` | `QueryNotCancellable` | `CANCEL QUERY` named a statement that can't be stopped now, for example a write. |
| `CADB0553` | `QueryOwnerUnreachable` | The node that can own the query didn't answer before the cancel timeout. The query can continue to execute. |
| `CADB0554` | `QueryCancelled` | A statement was stopped by `CANCEL QUERY`. The rows returned before the error are real rows. |
| `CADB0555` | `LockNotAvailable` | `FOR UPDATE NOWAIT` found a locked row. HTTP 409; gRPC `ABORTED`. It isn't retried automatically. |
| `CADB0556` | `ResultSetTooLarge` | A buffered result passed its row or memory limit. The statement rolls back. HTTP 400; gRPC `RESOURCE_EXHAUSTED`. |
| `CADB0557` | `StatementTooLarge` | Inline SQL was larger than `max_statement_bytes`. HTTP 413; gRPC `INVALID_ARGUMENT`. |
| `CADB0558` | `ConcurrencyLimitExceeded` | The node reached its limit of explicit transactions or of cluster activity requests. Wait, then retry. HTTP 503; gRPC `RESOURCE_EXHAUSTED`. |
| `CADB0559` | `JsonbValueCorrupt` | Stored `JSONB` bytes don't decode. This means damaged data, or a value from a newer build. HTTP 500. |
| `CADB0560` | `RecursiveQueryLimitExceeded` | A recursive CTE passed its step or row limit. Add a stopping condition, or change the [recursive query limits](/docs/sql-queries#recursive-ctes). HTTP 400. |
| `CADB0561` | `TableFunctionRowLimitExceeded` | A function in `FROM` produced more rows than `max_table_function_rows`. Narrow its arguments, or change the [row limit](/docs/functions-set-returning#row-limit). HTTP 400. |
| `CADB0562` | `StatementTimeout` | A statement executed longer than `statement_timeout_ms`, and it was stopped. An autocommit statement rolls back. In an explicit transaction, the transaction becomes rollback-only. HTTP 400. |
| `CADB0563` | `ViewComplexityLimitExceeded` | A view definition, or the view expansion of a statement, is over a view limit, such as `max_view_expanded_relations`. The message names the setting. HTTP 400. See [Size limits](/docs/views#size-limits). |
| `CADB0564` | `TooManyTablesInStatement` | A statement reads more tables than `max_tables_per_statement`, with the tables of subqueries and view bodies. HTTP 400. |
| `CADB0600` | `InvalidConfig` | The configuration is invalid, for example an unknown key or an invalid value. At runtime, a [`SET CLUSTER SETTING`](/docs/runtime-cluster-settings) value that breaks a rule between two settings also returns it. The setting isn't changed. |
| `CADB0847` | `SnapshotTooOld` | Retention removed history that a snapshot read needs. HTTP 409. Use a newer timestamp or a new transaction. |
| `CADB0849` | `ReadOnlyTransaction` | A write, or `nextval()` or `setval()`, in a read-only transaction. The statement doesn't change anything, and it aborts the transaction. HTTP 400; gRPC `FAILED_PRECONDITION`. See [Read-only transactions](/docs/sql-transactions#read-only-transactions). |

## Backup and restore errors

Only the backup and point-in-time recovery administration API raises
`CADB07xx` codes. Each code maps to a specific HTTP status. See
[Backup And Restore](/docs/backup-and-restore) for the full reference.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0700` | `BackupNotConfigured` | A backup or restore was requested but `kahuna.backup_dir` is unset. Backups are opt-in. |
| `CADB0701` | `BackupChainInvalid` | A backup chain does not start at a full backup, has a gap or broken parent link, or contains a cycle. |
| `CADB0702` | `BackupNeedsFullBackup` | An incremental backup's parent fell below the retention floor. A contiguous increment isn't possible. |
| `CADB0703` | `RestorePointOutOfWindow` | The requested restore point lies outside the chain's recoverable coverage. |
| `CADB0704` | `RestoreFailed` | A restore failed while copying the base image or replaying the [write-ahead log (WAL)](/docs/concepts#wal). |
| `CADB0705` | `BackupParentMissing` | The parent backup named by an incremental request does not exist. |
| `CADB0706` | `BackupCorruptArtifact` | An artifact doesn't match the manifest, for example a missing file or a wrong digest. |
| `CADB0707` | `RestoreTargetConflict` | The restore destination exists, or it overlaps a path in use, such as the live data root. |
| `CADB0708` | `BackupExactCheckpointUnavailable` | The storage backend cannot produce an exact as-of checkpoint at the requested cut. |
| `CADB0709` | `BackupUnsupportedFormat` | A manifest or artifact is in a legacy or unsupported format. |
| `CADB070A` | `BackupRetryableLeadershipLoss` | Partition leadership was lost mid-operation. No durable change was applied. |
| `CADB070B` | `BackupCancelled` | The caller cancelled the operation. |
| `CADB070C` | `RemoteRestoreDisabled` | No `kahuna.restore_root` is configured and the unconfined opt-in is off. |
| `CADB070D` | `BackupTopologyChanged` | Cluster topology changed during a coordinated backup. The captured partitions aren't one consistent cut, and the backup isn't published. |
| `CADB070E` | `BackupNotCoordinator` | A coordinated backup was requested on a node that does not lead the backup meta partition. |
| `CADB070F` | `BackupInsecureRoot` | The backup or restore root is a symlink, or is group- or world-writable. |
| `CADB0710` | `PitrBootstrapFailed` | A joining node could not seed itself from a restored backup chain. The restored data root may be missing, its WAL may not be empty, the chain or MAC may be invalid, or the seeded point may be outside the leader's retained log window. |

## C# extension errors

These codes cover the loading of extension assemblies, and the code that they run. See [C# Extensions](/docs/csharp-extensions)
for deployment and transaction behavior.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0800` | `ExtensionPathInvalid` | An extension path isn't valid, for example a relative path, or a path listed twice. |
| `CADB0801` | `ExtensionFileNotFound` | A configured extension file does not exist. |
| `CADB0802` | `ExtensionNotAnAssembly` | The configured file is not a loadable .NET assembly. |
| `CADB0803` | `ExtensionContractMismatch` | The extension was built against a newer contract than the server supports. |
| `CADB0804` | `ExtensionDuplicateAssembly` | Two configured files declare the same extension name and version. |
| `CADB0805` | `ExtensionDuplicateMember` | A member name collides with a built-in or is defined twice in one extension. |
| `CADB0806` | `ExtensionVerificationFailed` | A safe extension uses an API or assembly that its trust policy does not allow. |
| `CADB0807` | `ExtensionAssemblyRefused` | A safe extension attempted to load a disallowed assembly at runtime. |
| `CADB0808` | `ExtensionInvalidSignature` | An extension member has a signature that CamusDB can't bind. |
| `CADB0809` | `ExtensionFunctionFailed` | An extension function threw an exception. |
| `CADB0810` | `ExtensionValueOutOfRange` | A CamusDB `NUMERIC` does not fit a .NET `decimal`, or a returned value exceeds the CamusDB range. |
| `CADB0811` | `TriggerTypeNotFound` | `CREATE TRIGGER` names a CLR type that no installed extension provides. |
| `CADB0812` | `TriggerTypeAmbiguous` | More than one installed extension provides the named trigger type. |
| `CADB0813` | `TriggerTypeInvalid` | The named type does not implement the trigger contract. |
| `CADB0814` | `TriggerAlreadyExists` | The table already has a trigger with that name. |
| `CADB0815` | `TriggerNotFound` | `DROP TRIGGER` names a trigger the table does not have. |
| `CADB0816` | `TriggerTargetInvalid` | A trigger targets an object that isn't a table, such as a view. |
| `CADB0817` | `TriggerBindingMismatch` | The installed version of a trigger's extension does not define its CLR type. |
| `CADB0818` | `TriggerFailed` | Trigger code threw and the statement was rolled back. |
| `CADB0819` | `ExtensionNestingTooDeep` | Nested triggers and procedures exceeded 16 levels. |
| `CADB0820` | `ExtensionStatementRefused` | Extension SQL tried a statement that isn't allowed, such as DDL. |
| `CADB0821` | `ProcedureNotFound` | `CALL` names no procedure in the installed extensions. |
| `CADB0822` | `ProcedureFailed` | Procedure code threw and all changes made by the call were rolled back. |
| `CADB0823` | `ExtensionCaughtSqlError` | Extension code caught a nested SQL failure, but the transaction is rollback-only. |
| `CADB0824` | `TransactionRollbackOnly` | A statement failed and aborted the transaction. Later statements are refused; COMMIT rolls it back. See [Failed statements](/docs/sql-transactions#failed-statements). |
| `CADB0825` | `TriggerMutationConflict` | A `BEFORE` trigger changed a row that the outer statement read and is writing. |
| `CADB0826` | `TriggerQueueTooLarge` | Rows retained for `AFTER` triggers exceeded `spill_threshold_bytes`. |
| `CADB0827` | `ExtensionManifestInvalid` | An extension assembly doesn't have a valid manifest. |
| `CADB0828` | `ExtensionNotAvailable` | The requested extension or version is not loaded on this node. |
| `CADB0829` | `ExtensionAlreadyInstalled` | The extension is already installed in this database. |
| `CADB0830` | `ExtensionNotInstalled` | The extension is not installed, including a loaded extension used by `CREATE TRIGGER`. |
| `CADB0831` | `ExtensionRequirementMissing` | A required extension is not installed in the database. |
| `CADB0832` | `ExtensionMemberConflict` | Another installed extension defines a member with the same name. |
| `CADB0833` | `ExtensionHasDependents` | Dependent extensions or objects prevent a drop, or the target version lacks a member in use. |
| `CADB0834` | `ExtensionNotLoadedOnNode` | This node doesn't load the exact build of the installed extension. Statements that use the extension fail on this node. |
| `CADB0835` | `ExtensionClusterMismatch` | A responding cluster node does not load the target build for an install or update. |
| `CADB0836` | `TriggerRowMappingInvalid` | A typed trigger row class does not fit its table; the message lists the mapping problems. |

## Inline C# errors

These cover [inline functions and triggers](/docs/csharp-extensions#inline-functions).
Compilation/policy errors name the offending source positions where available.

| Code | Name | Meaning |
| --- | --- | --- |
| `CADB0838` | `InlineFunctionCompileFailed` | Compilation failed or exceeded its deadline. HTTP 400. |
| `CADB0839` | `InlineFunctionRefused` | Source or signature is outside the allowed subset. HTTP 400. |
| `CADB0840` | `InlineFunctionBudgetExceeded` | A call/fire exceeded a resource budget. HTTP 400. |
| `CADB0841` | `InlineFunctionsDisabled` | The relevant creation flag is off, or the build lacks a compiler. HTTP 400. |
| `CADB0842` | `FunctionAlreadyExists` | A function exists or a function name collides. HTTP 409. |
| `CADB0843` | `FunctionNotFound` | Function DDL or SHOW CREATE named a missing inline function. HTTP 404. |
| `CADB0844` | `FunctionHasDependents` | Dependents prevent dropping a function or changing its signature. HTTP 409. |
| `CADB0845` | `InlineFunctionUnavailableOnNode` | This node cannot compile required inline code. HTTP 503. |
| `CADB0846` | `TriggerOwnerMissing` | The trigger owner's account no longer exists. HTTP 403. |
| `CADB0848` | `InlineDefinitionRateExceeded` | A user who isn't a superuser executed more `CREATE [OR REPLACE] FUNCTION` and `CREATE TRIGGER ... LANGUAGE csharp` statements than `max_inline_definitions_per_user_per_minute` allows. The message says when the next one can execute. HTTP 429. |

## Corruption and internal-state errors

These codes usually report storage corruption or an unexpected engine state. They rarely point to an ordinary application
mistake.

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0014` | `SystemSpaceCorrupt` | Stored metadata or data can't be decoded or trusted, for example a schema record or a row. |
| `CADB0015` | `TableCorrupt` | Reserved for table-level corruption detection. It is defined in the core list but is not commonly surfaced by the current code path. |
| `CADB0017` | `InvalidIndexLayout` | Reserved for invalid persisted index layout or index metadata shape. It is defined but not commonly surfaced by the current runtime path. |
| `CADB00297` | `InvalidPageOffset` | Reserved for invalid low-level page offsets in storage structures. Not commonly surfaced by the current KV-backed runtime path. |
| `CADB0096` | `InvalidInformationSchema` | Reserved for invalid information-schema state. Defined, but not commonly thrown in the current public execution path. |
| `CADB0097` | `InvalidPageLength` | Reserved for invalid low-level page lengths in storage structures. |
| `CADB0098` | `InvalidPageChecksum` | Reserved for low-level page checksum mismatches. |
| `CADB0099` | `InvalidInternalOperation` | CamusDB reached an internal state that shouldn't occur in normal use, for example an impossible planner state. |
| `CADB0540` | `LargeValueCorrupt` | A compressed or out-of-line value failed to decompress or did not match the checksum recorded in the row. |
| `CADB0541` | `LargeValueNotResolved` | An internal read path attempted to decode an out-of-line value that was not fetched first. Report it. |
| `CADB0837` | `StorageCorrupted` | The storage engine found damage. HTTP 500; gRPC `DATA_LOSS`. Don't retry, and don't treat it as an empty result. See [storage health](/docs/cluster#check-storage-health). |

## Retry guidance

You can usually retry after these codes:

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
- `CADB0536` `InsufficientDiskSpace` after freeing disk space or lowering the
  threshold
- `CADB070A` `BackupRetryableLeadershipLoss` once a leader is elected
- `CADB070D` `BackupTopologyChanged` once cluster membership is stable

`CADB0509` `TransactionFinalizeUnresolved` needs a different kind of retry:
send the same `COMMIT` or `ROLLBACK` again for the same transaction id. Don't start a new transaction or replay the statements. The original commit can already be applied on the server.

These codes usually mean you must change the request before you retry:

- `CADB0010` `DatabaseDoesntExist`
- `CADB0012` `DatabaseAlreadyExists`
- `CADB0018` `DatabaseNameReserved`
- `CADB0400` `InvalidInput`
- `CADB0404` `UnknownColumn`
- `CADB0406` `SqlSyntaxError`
- `CADB0408` `SchemaLimitExceeded`
- `CADB0409` `InvalidAsOfSystemTime`
- `CADB0410` `MalformedVector`
- `CADB0411` `VectorDimensionMismatch`
- `CADB0412` `InvalidVectorValue`
- `CADB0413` `StatementTooDeeplyNested`
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
- `CADB0537` `SnapshotPrecedesContentsGeneration`
- `CADB0538` `StatementNotAllowedInTransaction`
- `CADB0539` `BranchSnapshotProtectionLost`
- `CADB0700` `BackupNotConfigured`
- `CADB0702` `BackupNeedsFullBackup`
- `CADB0703` `RestorePointOutOfWindow`
- `CADB0705` `BackupParentMissing`
- `CADB0707` `RestoreTargetConflict`
- `CADB070C` `RemoteRestoreDisabled`
- `CADB070E` `BackupNotCoordinator`
- `CADB0849` `ReadOnlyTransaction`

These codes usually need an operator to investigate. A retry before the investigation rarely helps:

- `CADB0014` `SystemSpaceCorrupt`
- `CADB0099` `InvalidInternalOperation`
- `CADB0701` `BackupChainInvalid`
- `CADB0704` `RestoreFailed`
- `CADB0706` `BackupCorruptArtifact`
- `CADB070F` `BackupInsecureRoot`

## Related pages

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
- [C# Extensions](/docs/csharp-extensions)
