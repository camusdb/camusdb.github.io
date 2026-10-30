---
sidebar_position: 2.15
---

# Schema comments

Column names rarely explain themselves. Is `status` free text or one of three
values? Who owns `legacy_orders`, and can it be dropped? Schema comments keep
the answer next to the object itself, so the next developer who reads the schema
does not have to search a wiki or ask around.

Comments also help AI agents. An agent that connects through the
[CamusDB MCP server](/docs/mcp-server) can read them with `SHOW CREATE TABLE`
and `SHOW DATABASE`. Clear comments tell the agent what each database, table,
column, and index is for before it writes a query or proposes a change.

Good comments record who owns an object, which values it expects, how it is
operated, and what it means to the application. You can comment on databases,
tables, columns, secondary indexes, and sequences, with the PostgreSQL
`COMMENT ON ... IS` form.

A comment is metadata only. It never changes query results, query plans, row
encoding, indexes, constraints, or transaction behavior.

## COMMENT ON

Use `COMMENT ON` to set or update a comment on an existing object:

```camussql
COMMENT ON DATABASE app IS 'Primary application database';
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
COMMENT ON SEQUENCE user_no IS 'Human-facing user number';
```

`COMMENT ON TABLE`, `COMMENT ON COLUMN`, `COMMENT ON INDEX`, and `COMMENT ON
SEQUENCE` run in the current database.

`COMMENT ON DATABASE` names the target database in the statement, so the
connection does not need to be using that database.

`COMMENT ON COLUMN` and `COMMENT ON INDEX` need a table-qualified name:

```camussql
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
```

CamusDB rejects bare column and index names, because columns and indexes belong
to a table.

## Remove a comment

`IS NULL` removes a comment:

```camussql
COMMENT ON COLUMN users.email IS NULL;
```

An empty string is not the same as no comment:

```camussql
COMMENT ON COLUMN users.email IS '';
```

After `IS NULL`, `SHOW CREATE TABLE` omits the comment clause. After `IS ''`,
the comment is present and renders as `COMMENT ''`.

## Inline comments

You can also declare comments when you create a table, on the table itself, its
columns, and its inline secondary indexes:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

`ALTER TABLE ... ADD COLUMN` accepts the same clause:

```camussql
ALTER TABLE users
ADD COLUMN nickname STRING NULL COMMENT 'Display name';
```

The syntax is `COMMENT '<text>'`, with no `=`.

Set a database comment with `COMMENT ON DATABASE`. `CREATE DATABASE` has no
inline comment clause.

## Read comments

`SHOW CREATE TABLE` includes table, column, and secondary index comments:

```camussql
SHOW CREATE TABLE users;
```

The rendered DDL looks like this:

```camussql
CREATE TABLE `users` (
  `id` OID NOT NULL COMMENT 'Internal user identifier',
  `email` STRING NOT NULL COMMENT 'Unique login email address',
  PRIMARY KEY (`id`),
  KEY `email_idx` (`email`) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

Replaying the emitted DDL recreates the same comments.

`SHOW DATABASE` returns the current database's name and comment:

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

`SHOW COLUMNS` keeps its result shape and does not include comments. Use
`SHOW CREATE TABLE` when you need a table, column, or index description.

## Renames

A comment stays with its object through a rename:

- A database comment survives `RENAME DATABASE` and
  `ALTER DATABASE ... RENAME TO`.
- A table comment survives `ALTER TABLE ... RENAME TO`.
- A column comment survives `ALTER TABLE ... RENAME COLUMN ... TO ...`.
- An index comment survives `ALTER TABLE ... RENAME INDEX ... TO ...`.
- A sequence comment survives `ALTER SEQUENCE ... RENAME TO`.

CamusDB attaches the comment to the schema object, not just to its display
name.

## Limits

A comment can hold at most `65,535` characters. A longer comment fails with
`CADB0511 CommentTooLong`.

A comment can contain quotation marks, backslashes, newlines, tabs, NULs, and
other characters. `SHOW CREATE TABLE` renders them back as SQL the parser
accepts: a plain string literal where possible, and an `E'...'` escape string
when a control character needs escaping.

Repeat a single quotation mark inside a comment to escape it:

```camussql
COMMENT ON COLUMN users.email IS 'The user''s email';
```

Use `E'...'` when you write a control character directly:

```camussql
COMMENT ON TABLE users IS E'first line\nsecond line';
COMMENT ON TABLE users IS 'C:\Users\data';
```

A malformed escape fails with `InvalidInput`. See
[String literals](/docs/data-types#string-literals) for the escape rules and
the list of escapes that fail.

## Notes

`COMMENT` is a reserved keyword. If an existing schema has an object literally
named `comment`, quote the name with backticks:

```camussql
SELECT `comment` FROM posts;
```

CamusDB currently supports comments on databases, tables, columns, secondary
indexes, and sequences. Primary key indexes, constraints, branches, and
functions have no `COMMENT ON` form.
