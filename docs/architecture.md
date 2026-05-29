---
sidebar_position: 4
---

# Architecture

CamusDB is split into an ASP.NET Core host and a reusable core engine.

## Host

`CamusDB/Program.cs` configures the web application, registers the executor,
validator, catalog manager, and HTTP transaction coordinator, then initializes
the database system from `Config/config.yml`.

The host exposes:

- Razor pages for the default web shell.
- JSON controllers under root-level routes such as `/execute-sql-query`.
- Console logging.
- A shutdown hook that disposes the command executor.

## Core Engine

The core engine lives in `CamusDB.Core/`.

### Parser

SQL parsing is generated from `SQLParser/SQLParser.Language.grammar.y` and
`SQLParser/SQLParser.Language.analyzer.lex`. The parser builds `NodeAst` trees
and normalizes identifiers to lowercase.

### Validation And Execution

Requests become command tickets, then flow through:

1. `CommandValidator`, which validates command inputs.
2. `CommandExecutor`, which coordinates database, table, SQL, row, index, and
   transaction controllers.
3. Specific controllers such as `SqlExecutor`, `QueryExecutor`, `RowInserter`,
   `RowUpdater`, `RowDeleter`, `TableCreator`, and index/table alterers.

### Query Pipeline

SQL queries are planned and executed through composable operators:

- `QueryPlanner` chooses scan and index access paths.
- `QueryScanner` reads rows from storage.
- `QueryFilterer` evaluates predicates.
- `QuerySorter` applies `ORDER BY`.
- `QueryLimiter` applies `LIMIT` and `OFFSET`.
- `QueryProjector` shapes result columns and aliases.
- `QueryAggregator` handles `COUNT`, `SUM`, `AVG`, `MIN`, and `MAX`.

### Storage

`Storage/Kv` maps relational rows and index entries to keys in an embedded
Kahuna node:

- `EmbeddedKahuna` hosts the local KV store.
- `KvTableStore` persists rows and indexes.
- `KeyEncoder` builds deterministic storage keys.
- `RowEncoder` and the serializer convert row values to and from byte payloads.

### Transactions

`KvTransactionsManager` and `KvTransaction` coordinate transaction state using
Kahuna's transactional API. HTTP requests either reuse an explicit transaction
id or create a transaction for a single operation and commit it automatically.

### Catalog

`CatalogsManager` tracks database, table, column, and index descriptors.
Schema objects are represented by models such as `TableSchema`,
`TableColumnSchema`, and `TableIndexSchema`.

## Configuration

`CamusStartup` reads YAML through `ConfigReader` and currently applies:

| Key | Purpose |
| --- | --- |
| `data_dir` | Directory for persisted database files. |
| `buffer_pool_size` | Optional override for the engine buffer pool size. |

Example:

```yaml
data_dir: /tmp/camusdb/
buffer_pool_size: 1048576
```

## Testing

The source repository uses NUnit. Run the test suite with:

```bash
dotnet test CamusDB.sln
```

Coverage includes parser behavior, SQL execution, row operations, table and
index changes, storage encoding, embedded Kahuna integration, transactions,
serialization, config parsing, and object id utilities.
