---
sidebar_position: 4.15
---

# Session functions

A session function reports the session of a statement. It reports nothing about
a row. It takes no argument.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `current_database()` | `STRING` | The database of the statement. It is `NULL` for a statement at the level of the server, such as `CREATE DATABASE` or `CREATE USER`. Such a statement has no current database. |
| `current_user()` | `STRING` | The name of the authenticated user. It is `NULL` while authentication is disabled. |
| `current_role()` | `STRING` | The same value as `current_user()`. |
| `is_superuser()` | `BOOL` | Whether the session of the caller is a superuser. It is `NULL` while authentication is disabled. |

```camussql
SELECT current_user(), current_database(), is_superuser();
```

A session function works at any position that accepts a scalar function. That
includes a [`SELECT` without a `FROM`](/docs/sql-fromless-select), a projection,
a filter, and a key of a `GROUP BY`:

```camussql
SELECT id, total
FROM orders
WHERE owner = current_user();
```

## A NULL means that there is no identity

While authentication is disabled, there is no authenticated identity to report.
`current_user()` therefore returns `NULL`. It does not return a name as a
placeholder. A name would assert an identity that the server never verified. See
[Authentication And Authorization](/docs/sql-authentication).

## current_role() and current_user() are the same

CamusDB grants a privilege to a user directly. A session therefore has no
identity of a role, separate from its user. `current_role()` exists so that SQL
still runs. That SQL comes from an engine that separates the two ideas.

## A session function bypasses the result cache

The value of a session function is fixed for one session. It differs between two
sessions. The [query result cache](/docs/query-result-cache) belongs to one
node, and every caller shares it.

A cache of `SELECT current_user()` would serve the identity of one caller to the
next caller. Any query with a session function therefore bypasses the cache
completely.

## Not in a DEFAULT, and not in a CHECK

CamusDB stores a `DEFAULT` of a column and the condition of a `CHECK`. A later
insert replays both of them. A replay carries no session for the function to
report.

The DDL therefore refuses both. It does not accept a schema element that could
only fail later:

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

A `DEFAULT` is for a generator that runs for each row, such as `gen_id()` and
`now()`. Write the value of the session from the statement instead:

```camussql
INSERT INTO orders (id, owner) VALUES (gen_id(), current_user());
```

## is_superuser() needs no privilege

The function answers for the session of the caller only. It answers for no other
session.

A caller can already learn the same fact in another way. That caller runs a
statement that needs a superuser, and it reads whether CamusDB refuses the
statement. A direct report therefore discloses nothing new. There is no form of
the function that asks about another user.

## Related pages

- [Functions](/docs/functions) for the other categories.
- [Authentication And Authorization](/docs/sql-authentication) for the users and
  the grants.
- [Views](/docs/views). The body of a view may call these functions. CamusDB
  takes the snapshot of the session from the statement of the caller, at every
  position where it expands the body.
