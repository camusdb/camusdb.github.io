---
sidebar_position: 1.5
---

# Databases

You must create a database in CamusDB explicitly before you use it. Three
operations against an unknown database return `DatabaseDoesntExist`: an open, a
query, and a DDL statement of a table. CamusDB does not create the storage
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

A branch of a database is an isolated clone of an existing database, at a point
in time. The branch starts from the schema and the view of the data of the
source database. A write and a DDL statement in the branch stay private to that
branch.

Use a branch to test a feature, to rehearse a migration, or to reproduce a
problem. You use data that is like the data of production, and you affect no
base database. See [Database Branching](/docs/database-branching) for the full
workflow, and for the notes of an operator.

## List the databases

```camussql
SHOW DATABASES;
SHOW BRANCHES FROM app;
SHOW ANCESTORS FROM feature_checkout;
```

`SHOW DATABASES` is a statement at the level of the server. It needs no open
database.

Use `SHOW BRANCHES FROM <database>` to list every descendant branch of a
database. Use `SHOW ANCESTORS FROM <database>` to inspect the chain of the
parents of a branch. See
[Database Branching](/docs/database-branching#inspect-the-branches) for the
details of the columns.

## Drop a database

```camussql
DROP DATABASE app;
DROP DATABASE IF EXISTS app;
DROP DATABASE app FORCE;
```

`DROP DATABASE` removes the entry of that name from the registry immediately.
CamusDB nevertheless keeps the data of the database as a recoverable orphan, for
the configured window of the retention.

You can use the name again. `SHOW DATABASES` no longer lists it. An open of the
dropped name returns `DatabaseDoesntExist`.

Use `SHOW ORPHAN DATABASES` to inspect a recoverable dropped database. Then
recover one under a new name, with `CREATE DATABASE ... RELINK TO`:

```camussql
SHOW ORPHAN DATABASES;
CREATE DATABASE app_recovered RELINK TO '7';
```

Use `FORCE` only when CamusDB must delete the database physically, immediately,
and permanently:

```camussql
DROP DATABASE app FORCE;
```

`DROP DATABASE IF EXISTS` does nothing when the name is absent. A forced drop
creates no orphan, and you cannot recover the database. See
[Recover Dropped Objects](/docs/recover-dropped-objects) for the workflow of the
recovery, for the settings of the retention, and for the limits.

## Rename a database

```camussql
RENAME DATABASE app TO app_prod;
ALTER DATABASE app RENAME TO app_prod;
```

The two forms are equivalent. `ALTER DATABASE ... RENAME TO` matches the order
of the words of a rename of a table. `RENAME DATABASE ... TO ...` also stays
supported.

A rename changes the binding in the registry only, from the name to the internal
id of the storage. Six things do not change:

1. The id of the storage.
2. The ids of the tables.
3. The keys of the rows.
4. The keys of the indexes.
5. The keys of the statistics.
6. The comment of the database.

Note this behavior:

- An open of the old name fails after the rename completes.
- An open of the new name resolves to the same id of the storage.
- Work in flight can continue. The readable name is not part of a storage key of
  a row or of an index.
- A rename to a name that exists fails.
- You cannot use a reserved name as the target of a rename.
- A comment from a `COMMENT ON DATABASE` survives the rename.

## A stable identity in the storage

Every database receives a stable opaque id in the storage, at its creation.
CamusDB allocates that id from a persistent monotonic sequence. It encodes the
id as a short string in base62. It does not reuse the id after a `DROP
DATABASE`.

The id is an internal identity of the storage. It is not a value of SQL, and it
is not an ObjectId. An application must address a database by its name.

CamusDB stores the readable name in the registry of the databases. The entry of
that registry nevertheless points at the stable id of the storage. The data of a
database lives in the shared key space of
[Kahuna](https://kahunakv.github.io/), under a key that starts with that id.

A table uses the same model of an identity. A new table receives a stable short
id in base62, from a persistent monotonic sequence. CamusDB uses the id of a
table inside the keys of a row, of an index, of the statistics, and of the
schema. SQL continues to address a table by its name.

CamusDB uses an id instead of a name for one reason. A rename of a database, and
a rename of a table, therefore moves no data. Neither one rewrites a key of a
table or of an index.

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
| `CADB0010` | `DatabaseDoesntExist` | An open, a query, a drop, a rename, or a DDL statement of a table, against an unknown database. |
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
