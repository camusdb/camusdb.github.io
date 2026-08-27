---
sidebar_position: 2.15
---

# Schema comments

CamusDB supports a comment on a database, on a table, on a column, and on a
secondary index. A comment is metadata only. It affects no result of a query, no
plan, no encoding of a row, no index, no constraint, and no behavior of a
transaction.

Use a comment to document four things next to the schema object itself: the
owner, the expected values, the operational intent, and the meaning for an
application.

A comment is useful when a client reaches CamusDB through the
[CamusDB MCP server](/docs/mcp-server). An AI agent can inspect the metadata of
a schema through MCP. A clear comment on a database, a table, a column, and an
index helps that agent. It then understands the purpose of each object, before
it writes a query or proposes a change.

## COMMENT ON

Use `COMMENT ON` to set a comment after the object exists. Use it also to update
a comment:

```camussql
COMMENT ON DATABASE app IS 'Primary application database';
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

`COMMENT ON TABLE`, `COMMENT ON COLUMN`, and `COMMENT ON INDEX` run inside the
context of a database.

`COMMENT ON DATABASE` names the target database in the statement. The connection
does not need to use that database already.

`COMMENT ON COLUMN` and `COMMENT ON INDEX` need a name with the table as its
qualifier:

```camussql
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

CamusDB rejects a bare name of a column, and a bare name of an index. A column
and an index both belong to one table.

## Remove a comment

`IS NULL` removes a comment:

```camussql
COMMENT ON COLUMN users.email IS NULL;
```

An empty string differs from a comment that you removed:

```camussql
COMMENT ON COLUMN users.email IS '';
```

After `IS NULL`, `SHOW CREATE TABLE` omits the clause of the comment. After
`IS ''`, the comment is present, and it renders as `COMMENT ''`.

## An inline comment

You can also declare a comment when you create a table. That rule covers a
comment on the table, on a column, and on an inline secondary index:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

`ALTER TABLE ... ADD COLUMN` accepts the same clause for a column:

```camussql
ALTER TABLE users
ADD COLUMN nickname STRING NULL COMMENT 'Display name';
```

The syntax is `COMMENT '<text>'`. It uses no `=`.

Set the comment of a database with `COMMENT ON DATABASE`. `CREATE DATABASE` has
no inline clause for a comment.

## Read a comment

`SHOW CREATE TABLE` includes the comment of the table, of a column, and of a
secondary index:

```camussql
SHOW CREATE TABLE users;
```

Here is an example of the rendered DDL:

```camussql
CREATE TABLE `users` (
  `id` OID NOT NULL COMMENT 'Internal user identifier',
  `email` STRING NOT NULL COMMENT 'Unique login email address',
  PRIMARY KEY (`id`),
  KEY `email_idx` (`email`) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

You can replay the emitted DDL. It creates the same comments again.

`SHOW DATABASE` returns the name of the current database, and its comment:

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

`SHOW COLUMNS` keeps the shape of its result. It includes no comment. Use `SHOW
CREATE TABLE` when you need the description of a table, of a column, or of an
index.

## The behavior after a rename

A comment stays with its object through a rename:

- The comment of a database survives `RENAME DATABASE` and
  `ALTER DATABASE ... RENAME TO`.
- The comment of a table survives `ALTER TABLE ... RENAME TO`.
- The comment of a column survives `ALTER TABLE ... RENAME COLUMN ... TO ...`.
- The comment of an index survives `ALTER TABLE ... RENAME INDEX ... TO ...`.

CamusDB attaches the comment to the schema object. It does not attach the
comment to the display name alone.

## Limits

A comment can hold `65,535` characters at most. A longer comment fails with
`CADB0511 CommentTooLong`.

A comment can hold a quotation mark, a backslash, a new line, a tab, a NUL, and
other characters. CamusDB renders them back as SQL that the parser accepts, in
`SHOW CREATE TABLE`. It uses a plain string literal where that is possible. It
uses an `E'...'` escape string when a control character needs a spelling.

Repeat a single quotation mark inside a comment to escape it:

```camussql
COMMENT ON COLUMN users.email IS 'The user''s email';
```

Use `E'...'` when you write a control character directly:

```camussql
COMMENT ON TABLE users IS E'first line\nsecond line';
COMMENT ON TABLE users IS 'C:\Users\data';
```

Four forms of an escape string fail with `InvalidInput`: a truncated `\x`
escape, a truncated `\u` escape, a `\U` escape outside the valid range, and a
surrogate escape without its pair.

See [String Literals](/docs/data-types#string-literals) for the full rules of a
literal.

## Notes

`COMMENT` is a reserved keyword. An existing schema can hold an object with the
literal name `comment`. Quote that name with backticks:

```camussql
SELECT `comment` FROM posts;
```

CamusDB currently supports a comment on a database, a table, a column, and a
secondary index only. Five other objects have no form of `COMMENT ON`: the index
of a primary key, a constraint, a branch, a function, and a sequence.
