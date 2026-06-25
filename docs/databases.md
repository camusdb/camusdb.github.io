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

## List Databases

```camussql
SHOW DATABASES;
```

`SHOW DATABASES` is a server-level statement. It does not require an already
open database context.

## Drop A Database

```camussql
DROP DATABASE app;
DROP DATABASE IF EXISTS app;
```

`DROP DATABASE` removes the registry entry for the database name.

In standalone mode, CamusDB also disposes the per-database embedded storage node
and deletes that database's id-based directory. In cluster mode, CamusDB purges
the database's metadata, table row, index, and statistics keyspaces from the
shared distributed storage layer.

`DROP DATABASE IF EXISTS` is a no-op when the database name is absent.

## Rename A Database

```camussql
RENAME DATABASE app TO app_prod;
```

Renaming changes only the registry binding from name to internal id. The
database id, table ids, row keys, index keys, and storage directory remain the
same.

Important behavior:

- opening the old name fails after the rename completes
- opening the new name resolves to the same database id
- in-flight work can continue because the human-readable name is not part of
  row or index storage keys
- renaming to an existing name fails
- reserved names cannot be used as rename targets

## Immutable Database Ids

Every database receives an immutable 24-character object id when it is created.
CamusDB uses that id as the durable storage identity.

In standalone mode, the database directory is:

```text
{data_dir}/{database_id}/
```

The human-readable name is stored in the database registry and in a diagnostic
`name.txt` file, but the registry is the source of truth.

Using ids instead of names means a rename does not move data and does not
rewrite table or index keys.

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
| `CADB0019` | `DatabaseCreationIncomplete` | Standalone recovery found a partially initialized database directory after a crash during create. Drop and recreate the database. |

## Related Pages

- [Tutorial](/docs/intro)
- [SQL](/docs/sql)
- [HTTP API](/docs/http-api)
- [Error Codes](/docs/error-codes)
