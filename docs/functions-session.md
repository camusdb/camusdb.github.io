---
sidebar_position: 4.15
---

# Session functions

Session functions tell a statement who is running it, and in which database.
For example, you can filter for the rows that belong to the current user, record
who wrote a row in an `INSERT`, or have a script check that it is connected to
the right database.

A session function describes the session running the statement. None of them
take arguments.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `current_database()` | `STRING` | The statement's database. It is `NULL` for server-level statements such as `CREATE DATABASE` or `CREATE USER`, which have no current database. |
| `current_user()` | `STRING` | The authenticated user's name. It is `NULL` while authentication is disabled. |
| `current_role()` | `STRING` | The same value as `current_user()`. |
| `is_superuser()` | `BOOL` | Whether the caller's session is a superuser. It is `NULL` while authentication is disabled. |

```camussql
SELECT current_user(), current_database(), is_superuser();
```

You can call a session function anywhere a scalar function is accepted,
including a [`SELECT` without a `FROM`](/docs/sql-fromless-select), a
projection, a filter, and a `GROUP BY` key:

```camussql
SELECT id, total
FROM orders
WHERE owner = current_user();
```

## NULL means no identity

While authentication is disabled, the server has verified no identity, so
`current_user()` returns `NULL`. See
[Authentication And Authorization](/docs/sql-authentication).

## current_role() and current_user() are the same

CamusDB grants privileges directly to users, so a session has no role identity
separate from its user. `current_role()` exists so that SQL written for engines
that separate the two still runs.

## Session functions bypass the result cache

A session function's value is fixed within a session but differs between
sessions. The [query result cache](/docs/query-result-cache) belongs to a single
node, and every caller shares it.

Caching `SELECT current_user()` would serve one caller's identity to the next
caller, so any query that calls a session function bypasses the cache
completely.

## Not allowed in DEFAULT or CHECK

CamusDB stores a column's `DEFAULT` and a `CHECK` condition, and replays them on
later inserts. A replay carries no session for the function to report.

Such a schema element could only fail later, so the DDL refuses both:

```camussql
CREATE TABLE owners (
  id INT64 PRIMARY KEY NOT NULL,
  owner STRING(64) DEFAULT(current_user())     -- refused
);

CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  owner STRING(64) NOT NULL,
  CONSTRAINT owner_is_caller CHECK (owner = current_user())   -- refused
);
```

A `DEFAULT` is for generators that run once per row, such as `gen_id()` and
`now()`. Write the session value in the statement instead:

```camussql
INSERT INTO orders (id, owner) VALUES (gen_id(), current_user());
```

## is_superuser() needs no privilege

The function answers only for the caller's own session.

A caller could already learn the same fact another way: run a statement that
requires a superuser and see whether CamusDB refuses it. So reporting it
directly discloses nothing new. No form of the function asks about another
user.

## Related pages

- [Functions](/docs/functions) for the other categories.
- [Authentication And Authorization](/docs/sql-authentication) for users and
  grants.
- [Views](/docs/views). A view's body may call these functions. Wherever
  CamusDB expands the body, it takes the session snapshot from the caller's
  statement.
