---
sidebar_position: 4.15
---

# Session functions

Session functions return the user and the database of the statement. For
example, you can filter for the rows of the current user, or record who wrote a
row in an `INSERT`. A script can also check that it is connected to the right
database. The functions don't take arguments.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `current_database()` | `STRING` | The database of the statement. |
| `current_user()` | `STRING` | The name of the authenticated user. It is `NULL` while authentication is off. |
| `current_role()` | `STRING` | The same value as `current_user()`. |
| `is_superuser()` | `BOOL` | Whether the user of the session is a superuser. It is `NULL` while authentication is off. |

```camussql
SELECT current_user(), current_database(), is_superuser();
```

You can call a session function where a scalar function is allowed, for example
in a filter or in a [`SELECT` with no `FROM`](/docs/sql-fromless-select):

```camussql
SELECT id, total
FROM orders
WHERE owner = current_user();
```

## NULL means no identity

While authentication is off, the server doesn't verify an identity. This means
that `current_user()` returns `NULL`. For more information, see
[Authentication and authorization](/docs/sql-authentication).

`current_role()` returns the same value as `current_user()`. CamusDB grants
privileges directly to users, and a session doesn't have a separate role.
`current_role()` exists so that SQL written for other engines works.

## The result cache isn't used

The value of a session function depends on the session. The
[query result cache](/docs/query-result-cache) of a node is shared by all its
callers. If the cache stored `SELECT current_user()`, the next caller could
get the identity of another user. For this reason, a query that calls a session
function isn't cached. With a cache hint, the response has `cacheStatus`
`bypass` and the reason `non-deterministic`.

## Not allowed in DEFAULT or CHECK

A `DEFAULT` or a `CHECK` condition is evaluated again on later writes, which
don't have the session of the DDL statement. This means that the result would
be wrong later. For this reason, DDL with a session function in `DEFAULT` or
`CHECK` returns `CADB0400`:

```camussql
CREATE TABLE owners (
  id INT64 PRIMARY KEY NOT NULL,
  owner STRING(64) DEFAULT(current_user())     -- CADB0400
);

CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  owner STRING(64) NOT NULL,
  CONSTRAINT owner_is_caller CHECK (owner = current_user())   -- CADB0400
);
```

A `DEFAULT` is for generators that execute once for each row, such as
`gen_id()` and `now()`. Write the session value in the statement:

```camussql
INSERT INTO orders (id, owner) VALUES (gen_id(), current_user());
```

## is_superuser() needs no privilege

The function answers for the session of the caller only. It can't ask about
another user. A caller can already learn the same fact: a statement that needs a
superuser returns an error for other users. This means that the function
doesn't disclose new information.

## Related pages

- [Functions](/docs/functions) for the other categories.
- [Authentication and authorization](/docs/sql-authentication) for users and
  grants.
- [Views](/docs/views). A view can call these functions. The values come from
  the statement that reads the view.
