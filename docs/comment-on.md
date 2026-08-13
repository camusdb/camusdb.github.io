---
sidebar_position: 2.15
---

# Schema Comments

CamusDB supports descriptive comments on databases, tables, columns, and
secondary indexes. Comments are metadata only: they do not affect query results,
query planning, row encoding, indexes, constraints, or transaction behavior.

Use comments to document ownership, expected values, operational intent, and
application-facing meaning directly next to the schema object.

Comments are especially useful when CamusDB is accessed through the
[CamusDB MCP server](/docs/mcp-server). AI agents can inspect schema metadata
through MCP, and clear database, table, column, and index comments help them
understand what each object is for before they generate queries or suggest
changes.

## COMMENT ON

Use `COMMENT ON` to set or update a comment after an object exists:

```camussql
COMMENT ON DATABASE app IS 'Primary application database';
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

`COMMENT ON TABLE`, `COMMENT ON COLUMN`, and `COMMENT ON INDEX` run inside a
database context. `COMMENT ON DATABASE` names the target database in the
statement and does not require the current connection to already be using that
database.

`COMMENT ON COLUMN` and `COMMENT ON INDEX` require table-qualified names:

```camussql
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

Bare column and index names are rejected because columns and indexes are scoped
to a table.

## Remove Comments

`IS NULL` removes a comment:

```camussql
COMMENT ON COLUMN users.email IS NULL;
```

An empty string is different from a removed comment:

```camussql
COMMENT ON COLUMN users.email IS '';
```

With `IS NULL`, `SHOW CREATE TABLE` omits the comment clause. With `IS ''`,
the comment is present and renders as `COMMENT ''`.

## Inline Comments

Table, column, and inline secondary-index comments can also be declared when a
table is created:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

`ALTER TABLE ... ADD COLUMN` accepts the same column-level comment clause:

```camussql
ALTER TABLE users
ADD COLUMN nickname STRING NULL COMMENT 'Display name';
```

The syntax is `COMMENT '<text>'`, without `=`.

Database comments are set with `COMMENT ON DATABASE`; there is no inline
`CREATE DATABASE` comment clause.

## Read Comments

`SHOW CREATE TABLE` includes table, column, and secondary-index comments:

```camussql
SHOW CREATE TABLE users;
```

Example rendered DDL:

```camussql
CREATE TABLE `users` (
  `id` OID NOT NULL COMMENT 'Internal user identifier',
  `email` STRING NOT NULL COMMENT 'Unique login email address',
  PRIMARY KEY (`id`),
  KEY `email_idx` (`email`) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

The emitted DDL can be replayed to recreate the same comments.

`SHOW DATABASE` returns the current database name and its comment:

```camussql
SHOW DATABASE;
```

```text
┌──────────┬──────────────────────────────┐
│ database │ comment                      │
├──────────┼──────────────────────────────┤
│ app      │ Primary application database │
└──────────┴──────────────────────────────┘
```

`SHOW COLUMNS` keeps its existing result shape and does not include comments.
Use `SHOW CREATE TABLE` when you need table, column, or index descriptions.

## Rename Behavior

Comments stay with the object when it is renamed:

- database comments survive `RENAME DATABASE` and
  `ALTER DATABASE ... RENAME TO`
- table comments survive `ALTER TABLE ... RENAME TO`
- column comments survive `ALTER TABLE ... RENAME COLUMN ... TO ...`
- index comments survive `ALTER TABLE ... RENAME INDEX ... TO ...`

The comment is attached to the schema object, not only to the display name.

## Limits

A comment can be at most `65,535` characters. Longer comments fail with
`CADB0511 CommentTooLong`.

Comments can contain quotes, backslashes, newlines, tabs, NUL, and other
characters. CamusDB renders them back as parseable SQL in `SHOW CREATE TABLE`.
Plain string literals are used when possible, and `E'...'` escape strings are
used when a control character needs a spelling.

Single quotes inside a comment are escaped by doubling them:

```camussql
COMMENT ON COLUMN users.email IS 'The user''s email';
```

Use `E'...'` when writing control characters directly:

```camussql
COMMENT ON TABLE users IS E'first line\nsecond line';
COMMENT ON TABLE users IS 'C:\Users\data';
```

Malformed escape string literals, such as truncated `\x` or `\u` escapes,
out-of-range `\U` escapes, or unpaired surrogate escapes, fail with
`InvalidInput`.

See [String Literals](/docs/data-types#string-literals) for the full literal
rules.

## Notes

`COMMENT` is a reserved keyword. If an existing schema has an object literally
named `comment`, quote it with backticks:

```camussql
SELECT `comment` FROM posts;
```

Only databases, tables, columns, and secondary indexes are currently supported.
Primary-key index comments, constraints, branches, functions, and sequences do
not have `COMMENT ON` forms.
