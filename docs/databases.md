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

You must create a database in CamusDB explicitly before you use it. Three
operations against an unknown database return `DatabaseDoesntExist`: an open, a
query, and a DDL statement of a table. With authentication enabled, CamusDB uses
the same error for a database the caller holds no grant on, so callers cannot
probe whether a hidden database exists. CamusDB does not create the storage
implicitly.

## Create a database

```camussql
CREATE DATABASE app;
```

Use `IF NOT EXISTS` when a script of a setup must be safe to repeat:

```camussql
CREATE DATABASE IF NOT EXISTS app;
```

After the creation, connect to that database in one of five ways:

- `camus-cli app`.
- A `use app;` statement.
- The connection string of a driver.
- An HTTP request whose `databaseName` is `app`.
- A gRPC request whose `database` is `app`.

## Branch a database

```camussql
CREATE DATABASE feature_checkout BRANCH FROM app;
```

A branch is an isolated copy of a database at a point in time, so you can test a
feature or rehearse a migration on realistic data without touching the source.
See [Database Branching](/docs/database-branching).

## List the databases

```camussql
SHOW DATABASES;
```

`SHOW DATABASES` is a statement at the level of the server. It needs no open
database.

When authentication is enabled, `SHOW DATABASES` lists only databases the caller
can reach. A global grant, a grant on `db.*`, or any grant on one table inside a
database makes that database visible. A database with no such grant is hidden in
the same way as a name that does not exist.

To list the branches of a database, or the parents of a branch, use
`SHOW BRANCHES FROM` and `SHOW ANCESTORS FROM`. See
[Inspect the branches](/docs/database-branching#inspect-the-branches).

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

The two forms are equivalent. `ALTER DATABASE ... RENAME TO` matches the order
of the words of a rename of a table. `RENAME DATABASE ... TO ...` also stays
supported.

A rename changes only the registry entry that maps the name to the database's
internal storage id, so no data moves: the storage id, table ids, and row,
index, and statistics keys all stay the same.

Note this behavior:

- An open of the old name fails after the rename completes.
- An open of the new name resolves to the same id of the storage.
- Work in flight can continue. The readable name is not part of a storage key of
  a row or of an index.
- A rename to a name that exists fails.
- You cannot use a reserved name as the target of a rename.
- A comment from a `COMMENT ON DATABASE` survives the rename.

## A stable identity in the storage

Each database and table gets a short internal id that is never reused, and its
stored keys use that id instead of the name. The id is not a SQL value or an
ObjectId: applications always address a database by its name. See
[Storage](/docs/storage#key-layout) for how ids are allocated and how keys are
laid out.

## Reserved names

CamusDB reserves two names:

| Name | Purpose |
| --- | --- |
| `_system` | The namespace of the internal registry of the databases, and of the metadata of the cluster. |
| `information_schema` | Reserved for a future compatibility with SQL. |

A creation of a database with either name returns `DatabaseNameReserved`. A
rename to either name returns the same code.

## Error codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | An open, a query, a drop, a rename, or a DDL statement of a table, against an unknown database. With authentication enabled, CamusDB returns the same error for a database the caller holds no grant on. |
| `CADB0012` | `DatabaseAlreadyExists` | A `CREATE DATABASE` targets a name that exists. A rename of a database also targets a name that exists. |
| `CADB0018` | `DatabaseNameReserved` | A `CREATE DATABASE`, or a rename of a database, uses `_system` or `information_schema`. |
| `CADB0019` | `DatabaseCreationIncomplete` | Reserved for an incomplete recovery of the creation of a database, from an older layout of a standalone storage. CamusDB does not expect the code on the current path of a creation in the shared storage. |
| `CADB0508` | `DatabaseHasLiveDescendants` | A `DROP DATABASE` targets a database with a live descendant branch. Drop the descendant branches first. |
| `CADB0510` | `OrphanNotFound` | A `CREATE DATABASE ... RELINK TO` references an id of an orphan that is unknown, recovered already, or reclaimed. |

## Related pages

- [Tutorial](/docs/intro)
- [Database Branching](/docs/database-branching)
- [Recover Dropped Objects](/docs/recover-dropped-objects)
- [SQL](/docs/sql)
- [Schema Comments](/docs/comment-on)
- [HTTP API](/docs/http-api)
- [gRPC API](/docs/grpc-api)
- [Error Codes](/docs/error-codes)
