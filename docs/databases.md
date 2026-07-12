---
sidebar_position: 1.5
---

# Databases

Databases in CamusDB must be created explicitly before use. Opening, querying,
or running table DDL against an unknown database returns `DatabaseDoesntExist`
instead of creating storage implicitly.

## Create A Database

```camussql
CREATE DATABASE app;
```

Use `IF NOT EXISTS` when setup scripts should be idempotent:

```camussql
CREATE DATABASE IF NOT EXISTS app;
```

After creation, connect to that database with `camus-cli app`, `use app;`, a
driver connection string, or an HTTP request whose `databaseName` is `app`.

## Branch A Database

```camussql
CREATE DATABASE feature_checkout BRANCH FROM app;
```

Database branching creates an isolated point-in-time clone of an existing
database. The branch starts from the source database's schema and data view, but
writes and DDL in the branch stay private to that branch.

Use branches to test features, rehearse migrations, or reproduce issues against
production-like data without affecting the base database. See
[Database Branching](/docs/database-branching) for the full workflow and
operational notes.

## List Databases

```camussql
SHOW DATABASES;
SHOW BRANCHES FROM app;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW DATABASES` is a server-level statement. It does not require an already
open database context.

Use `SHOW BRANCHES FROM <database>` to list every descendant branch of a
database. Use `SHOW ANCESTORS FROM <database>` to inspect the parent chain of a
branch. See [Database Branching](/docs/database-branching#inspect-branches) for
column details.

## Drop A Database

```camussql
DROP DATABASE app;
DROP DATABASE IF EXISTS app;
```

`DROP DATABASE` removes the registry entry for the database name.

CamusDB then drains in-flight operations for the database descriptor and purges
that database's metadata, table row, index, and statistics keyspaces from the
shared storage layer. Both standalone and cluster modes use a shared storage
node; a drop does not remove a separate per-database RocksDB or WAL directory.

`DROP DATABASE IF EXISTS` is a no-op when the database name is absent.

## Rename A Database

```camussql
RENAME DATABASE app TO app_prod;
```

Renaming changes only the registry binding from name to internal storage id.
The storage id, table ids, row keys, index keys, and statistics keys remain the
same.

Important behavior:

- opening the old name fails after the rename completes
- opening the new name resolves to the same storage id
- in-flight work can continue because the human-readable name is not part of
  row or index storage keys
- renaming to an existing name fails
- reserved names cannot be used as rename targets

## Stable Storage Identity

Every database receives a stable opaque storage id when it is created. The id is
allocated from a persistent monotonic sequence, encoded as a short base62
string, and is not reused after `DROP DATABASE`.

The id is an internal storage identity, not a SQL value and not an ObjectId.
Applications should address databases by name.

The human-readable name is stored in the database registry, but the registry
entry points at the stable storage id. Database data lives in the shared
[Kahuna](https://kahunakv.github.io/) keyspace under keys that begin with that
database id.

Tables use the same identity model. A newly created table receives a stable
short base62 table id from a persistent monotonic sequence. Table ids are used
inside row, index, statistics, and schema keys; SQL continues to address tables
by name.

Using ids instead of names means a database or table rename does not move data
and does not rewrite table or index keys.

## Reserved Names

These names are reserved:

| Name | Purpose |
| --- | --- |
| `_system` | Internal database registry and cluster metadata namespace. |
| `information_schema` | Reserved for future SQL compatibility. |

Creating or renaming a database to either name returns `DatabaseNameReserved`.

## Error Codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | Opening, querying, dropping, renaming, or running table DDL against an unknown database. |
| `CADB0012` | `DatabaseAlreadyExists` | `CREATE DATABASE` targets an existing name, or `RENAME DATABASE ... TO ...` targets an existing name. |
| `CADB0018` | `DatabaseNameReserved` | `CREATE DATABASE` or `RENAME DATABASE` uses `_system` or `information_schema`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for an incomplete database-create recovery condition from older standalone storage layouts. It is not expected on the current shared-storage create path. |
| `CADB0508` | `DatabaseHasLiveDescendants` | `DROP DATABASE` targets a database that still has live branch descendants. Drop descendant branches first. |

## Related Pages

- [Tutorial](/docs/intro)
- [Database Branching](/docs/database-branching)
- [SQL](/docs/sql)
- [HTTP API](/docs/http-api)
- [Error Codes](/docs/error-codes)
