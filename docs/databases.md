---
sidebar_position: 1.5
description: "Keep applications, environments, or customers apart on one CamusDB node or cluster. Each database has its own tables, schema objects, and grants."
---

# Databases

A database separates one set of tables from another. You can run several
applications or customers on one CamusDB node or cluster. Each database has
separate tables and grants. As in PostgreSQL or
MySQL, a client selects a database before it works with tables.

## When to use a separate database

Use a separate database to keep one set of data apart from another:

- One database for each application or service on the same server.
- One database for each environment, such as development and staging.
- One database for each customer, when each customer must have a separate set
  of tables.

Several operations work on a full database. You can
[branch](/docs/database-branching) a database to get an isolated copy for a
test. You can [recover](/docs/recover-dropped-objects) a dropped database during
the retention window. You can also grant a user access to one database only.
However, a [backup](/docs/backup-and-restore) always covers all databases on the
node.

## Create a database

You must create a database before you use it:

```camussql
CREATE DATABASE app;
```

To make a setup script safe to run again, use `IF NOT EXISTS`:

```camussql
CREATE DATABASE IF NOT EXISTS app;
```

A query or a table statement for a database that doesn't exist returns
`CADB0010 DatabaseDoesntExist`. A database isn't created when you first use its
name.

With authentication enabled, a database on which you have no grant returns the
same error. This means that a user can't find out whether a hidden database
exists.

## Connect to a database

You can select the database in the following ways:

- `camus-cli app`, or a `use app;` statement in camus-cli.
- The database in a driver connection string.
- The database name in a request to the [HTTP API](/docs/http-api) or the
  [gRPC API](/docs/grpc-api).

## Branch a database

```camussql
CREATE DATABASE feature_checkout BRANCH FROM app;
```

A branch is an isolated copy of a database at a point in time. You can use it
to test a feature or a migration on realistic data. The source database doesn't
change. For more information, see
[Database branching](/docs/database-branching).

## List databases

```camussql
SHOW DATABASES;
```

`SHOW DATABASES` works when no database is selected.

With authentication enabled, `SHOW DATABASES` lists only the databases that you
can reach. One of the following grants makes a database visible:

- A global grant.
- A grant on `db.*`.
- A grant on one table in the database.

To list the branches of a database, or the parents of a branch, use
`SHOW BRANCHES FROM` and `SHOW ANCESTORS FROM`. For more information, see
[Inspect the branches](/docs/database-branching#inspect-the-branches).

## Drop a database

```camussql
DROP DATABASE IF EXISTS app;
```

With `IF EXISTS`, a database that doesn't exist isn't an error.

After a drop, you can use the name again at once. The data is kept as a
recoverable orphan for the retention window, which is seven days by default.
To recover it, use `CREATE DATABASE ... RELINK TO`. For more information, see
[Recover dropped objects](/docs/recover-dropped-objects).

`DROP DATABASE ... FORCE` deletes the data, and you can't recover it.

A database with a branch can't be dropped. Drop the branches first.

## Rename a database

The following two statements are the same:

```camussql
RENAME DATABASE app TO app_prod;
ALTER DATABASE app RENAME TO app_prod;
```

Storage keys use an internal database ID. The name isn't part of any key. This
means that a rename doesn't move or copy data. For the key layout, see
[Storage](/docs/storage#key-layout).

After a rename:

- The old name returns `CADB0010`.
- The new name opens the same tables and data.
- The comment from `COMMENT ON DATABASE` doesn't change.

You should rename a database when no application uses it. An open transaction
that sends its next statement with the old name gets `CADB0010`, and the
transaction is rolled back.

A rename to a name that exists returns `CADB0012`. A rename to a reserved name
returns `CADB0018`.

## Reserved names

The following names are reserved:

| Name | Purpose |
| --- | --- |
| `_system` | The internal database registry and the cluster metadata. |
| `information_schema` | Reserved for SQL compatibility in a later release. |

A `CREATE DATABASE` or a rename to one of these names returns
`CADB0018 DatabaseNameReserved`. The check ignores case.

## Error codes

| Code | Name | Typical cause |
| --- | --- | --- |
| `CADB0010` | `DatabaseDoesntExist` | The database doesn't exist. With authentication enabled, you have no grant on it. |
| `CADB0012` | `DatabaseAlreadyExists` | A `CREATE DATABASE` or a rename uses a name that exists. |
| `CADB0018` | `DatabaseNameReserved` | A `CREATE DATABASE` or a rename uses `_system` or `information_schema`. |
| `CADB0508` | `DatabaseHasLiveDescendants` | A `DROP DATABASE` on a database that has branches. Drop the branches first. |
| `CADB0510` | `OrphanNotFound` | A `CREATE DATABASE ... RELINK TO` uses an orphan ID that doesn't exist, was recovered, or was deleted. |

## Related pages

- [Tutorial](/docs/intro)
- [Database branching](/docs/database-branching)
- [Recover dropped objects](/docs/recover-dropped-objects)
- [SQL overview](/docs/sql)
- [Schema comments](/docs/comment-on)
- [HTTP API](/docs/http-api)
- [gRPC API](/docs/grpc-api)
- [Error codes](/docs/error-codes)
