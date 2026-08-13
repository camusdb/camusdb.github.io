---
sidebar_position: 4.15
---

# Session Functions

Session functions report the session a statement runs in rather than anything
about the rows. They take no arguments.

## Functions

| Function | Returns | Description |
| --- | --- | --- |
| `current_database()` | `STRING` | The database the statement runs against. `NULL` for a server-level statement such as `CREATE DATABASE` or `CREATE USER`, which has no current database. |
| `current_user()` | `STRING` | The authenticated user name, or `NULL` when authentication is disabled. |
| `current_role()` | `STRING` | The same value as `current_user()`. |
| `is_superuser()` | `BOOL` | Whether the caller's own session is a superuser, or `NULL` when authentication is disabled. |

```camussql
SELECT current_user(), current_database(), is_superuser();
```

They work anywhere a scalar function works, including
[`SELECT` without `FROM`](/docs/sql-fromless-select), projections, filters, and
`GROUP BY` keys:

```camussql
SELECT id, total
FROM orders
WHERE owner = current_user();
```

## `NULL` Means "No Identity"

With authentication disabled there is no authenticated identity to report, and
`current_user()` returns `NULL` rather than a placeholder name. A name would
assert an identity the server never verified. See
[Authentication And Authorization](/docs/sql-authentication).

## `current_role()` And `current_user()` Are The Same

CamusDB grants privileges directly to users, so a session has no role identity
distinct from its user. `current_role()` exists so SQL written against engines
that separate the two still runs.

## They Bypass The Result Cache

A session function's value is fixed for one session but differs between
sessions, and the [query result cache](/docs/query-result-cache) is per-node and
shared across callers. Caching `SELECT current_user()` would serve one caller's
identity to the next, so any query referencing a session function bypasses the
cache entirely.

## Not In A `DEFAULT` Or A `CHECK`

A column `DEFAULT` and a `CHECK` condition are both stored and replayed by later
inserts, and a replay carries no session for the function to report. The DDL
refuses them rather than accept a schema element that could only fail later:

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

`DEFAULT` is reserved for per-row generators such as `gen_id()` and `now()`.
Write the session value in from the statement instead:

```camussql
INSERT INTO orders (id, owner) VALUES (gen_id(), current_user());
```

## `is_superuser()` Needs No Privilege

It answers for the caller's own session and no one else's. A caller can already
establish the same bit by running a superuser-only statement and reading whether
it is refused, so reporting it directly discloses nothing new. There is no form
that asks about another user.

## Related Pages

[Functions](/docs/functions) for the other categories,
[Authentication And Authorization](/docs/sql-authentication) for users and
grants, and [Views](/docs/views) — a view body may call these, and the session
snapshot is taken from the caller's statement wherever the body is expanded.
