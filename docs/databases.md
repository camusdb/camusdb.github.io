---
sidebar_position: 1.5
---

# Databases

A database keeps one set of tables apart from another. You can run several
applications, environments, or customers on one CamusDB node or cluster, and
each database keeps its own tables, schema objects, and grants. As in
PostgreSQL or MySQL, a client selects a database before it works with tables.

## Why use more than one database

Use a separate database to keep one set of data apart from another set:

- One database for each application or service that shares the same server.
- One database for each environment, such as development, staging, and tests.
- One database for each customer, when each customer must have a separate set
  of tables.

The database is also the unit of several operations. You can
[branch](/docs/database-branching) a database to get an isolated copy for a
feature or a test. You can drop a whole database, and
[recover](/docs/recover-dropped-objects) it during the retention window. You can
grant a user access to one database only. A [backup](/docs/backup-and-restore)
is different: it always covers every database on the node.

## Create a database before you use it

You must create a database explicitly before you use it. Opening, querying, or
running table DDL against an unknown database returns `DatabaseDoesntExist`.
With authentication enabled, CamusDB returns the same error for a database the
caller has no grant on, so callers cannot probe whether a hidden database exists.
CamusDB never creates storage implicitly.

## Create a database

```camussql
CREATE DATABASE app;
```

Use `IF NOT EXISTS` when a setup script must be safe to repeat:

```camussql
CREATE DATABASE IF NOT EXISTS app;
```

Then connect to it in any of these ways:

- `camus-cli app`.
- A `use app;` statement.
- A driver connection string.
- An HTTP request whose `databaseName` is `app`.
- A gRPC request whose `database` is `app`.

## Branch a database

```camussql
CREATE DATABASE feature_checkout BRANCH FROM app;
```

A branch is an isolated copy of a database at a point in time, so you can test a
feature or rehearse a migration on realistic data without touching the source.
See [Database Branching](/docs/database-branching).

## List databases

```camussql
SHOW DATABASES;
```

`SHOW DATABASES` is a server-level statement, so it needs no open database.

When authentication is enabled, `SHOW DATABASES` lists only databases the caller
can reach. A global grant, a grant on `db.*`, or any grant on one table inside a
database makes that database visible. A database with no such grant is hidden,
just like a name that does not exist.

To list a database's branches, or a branch's parents, use
`SHOW BRANCHES FROM` and `SHOW ANCESTORS FROM`. See
[Inspect branches](/docs/database-branching#inspect-the-branches).

## Drop a database

```camussql
DROP DATABASE IF EXISTS app;
```

`DROP DATABASE IF EXISTS` does nothing when the name is absent. A plain drop
frees the name immediately but keeps the data as a recoverable orphan for the
retention window; `DROP DATABASE ... FORCE` deletes it permanently. See
[Recover Dropped Objects](/docs/recover-dropped-objects) to restore a dropped
database with `CREATE DATABASE ... RELINK TO`.

## Rename a database

```camussql
RENAME DATABASE app TO app_prod;
ALTER DATABASE app RENAME TO app_prod;
```

The two forms are equivalent. `ALTER DATABASE ... RENAME TO` matches the word
order of a table rename, and `RENAME DATABASE ... TO ...` remains supported.

A rename changes only the registry entry that maps the name to the database's
internal storage id, so no data moves: the storage id, table ids, and row,
index, and statistics keys all stay the same.

After a rename:

- Opening the old name fails once the rename completes.
- Opening the new name resolves to the same storage id.
- In-flight work can continue, because the readable name is not part of any row
  or index storage key.
- Renaming to a name that already exists fails.
- You cannot rename a database to a reserved name.
- A `COMMENT ON DATABASE` comment survives the rename.

## Stable storage identity

Each database and table gets a short internal id that is never reused, and its
stored keys use that id instead of the name. The id is not a SQL value or an
ObjectId: applications always address a database by its name. See
[Storage](/docs/storage#key-layout) for how ids are allocated and how keys are
laid out.

## Reserved names

CamusDB reserves two names:

| Name | Purpose |
| --- | --- |
| `_system` | The namespace for the internal database registry and cluster metadata. |
| `information_schema` | Reserved for future SQL compatibility. |

Creating a database with either name, or renaming one to either name, returns
`DatabaseNameReserved`.

## Error codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | An open, query, drop, rename, or table DDL statement targets an unknown database. With authentication enabled, CamusDB returns the same error for a database the caller has no grant on. |
| `CADB0012` | `DatabaseAlreadyExists` | A `CREATE DATABASE` or a database rename targets a name that already exists. |
| `CADB0018` | `DatabaseNameReserved` | A `CREATE DATABASE` or a database rename uses `_system` or `information_schema`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for recovering an incomplete database creation from an older standalone storage layout. CamusDB does not expect this code on the current shared-storage creation path. |
| `CADB0508` | `DatabaseHasLiveDescendants` | A `DROP DATABASE` targets a database with a live descendant branch. Drop the descendant branches first. |
| `CADB0510` | `OrphanNotFound` | A `CREATE DATABASE ... RELINK TO` references an orphan id that is unknown, already recovered, or reclaimed. |

## Related pages

- [Tutorial](/docs/intro)
- [Database Branching](/docs/database-branching)
- [Recover Dropped Objects](/docs/recover-dropped-objects)
- [SQL](/docs/sql)
- [Schema Comments](/docs/comment-on)
- [HTTP API](/docs/http-api)
- [gRPC API](/docs/grpc-api)
- [Error Codes](/docs/error-codes)
