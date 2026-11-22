---
sidebar_position: 2.15
---

# Schema comments

A schema comment is a description that is stored with the object itself. The
next developer who reads the schema doesn't have to search a wiki or ask
around. A comment can say whether `status` is free text or one of three values,
or who owns `legacy_orders` and whether you can drop it.

Comments also help AI agents. An agent that connects through the
[CamusDB MCP server](/docs/mcp-server) can read them with `SHOW CREATE TABLE`
and `SHOW DATABASE`. A clear comment tells the agent what an object is for
before it writes a query or proposes a change.

You can comment on databases, tables, columns, secondary indexes, sequences,
views, and materialized views, with the PostgreSQL `COMMENT ON ... IS` form. A comment is metadata
only. It doesn't change query results or query plans.

## COMMENT ON

Use `COMMENT ON` to set or update a comment on an existing object:

```camussql
COMMENT ON DATABASE app IS 'Primary application database';
COMMENT ON TABLE users IS 'Application users';
COMMENT ON COLUMN users.email IS 'Unique login email address';
COMMENT ON INDEX users.email_idx IS 'Lookup by login email';
COMMENT ON SEQUENCE user_no IS 'Human-facing user number';
COMMENT ON VIEW active_users IS 'Users who signed in this month';
COMMENT ON MATERIALIZED VIEW daily_signups IS 'Refreshed nightly';
```

`COMMENT ON VIEW` and `COMMENT ON MATERIALIZED VIEW` need `ALTER` on the
object. `COMMENT ON VIEW` on a materialized view returns `CADB0523`, with the
name of the statement to use.

`COMMENT ON DATABASE` names its target. The other forms apply to the current
database. This means that you can run it from a
connection to another database.

Columns and indexes belong to a table. For this reason, `COMMENT ON COLUMN` and
`COMMENT ON INDEX` need a name with the table, such as `users.email`. A name
without the table returns `CADB0400`.

## Remove a comment

`IS NULL` removes a comment:

```camussql
COMMENT ON COLUMN users.email IS NULL;
```

An empty string isn't the same as no comment:

```camussql
COMMENT ON COLUMN users.email IS '';
```

After `IS NULL`, `SHOW CREATE TABLE` doesn't show a comment clause. After
`IS ''`, it shows `COMMENT ''`.

## Inline comments

When you create a table, you can add the comments inline:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL COMMENT 'Internal user identifier',
  email STRING NOT NULL COMMENT 'Unique login email address',
  KEY email_idx (email) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

You can use the same clause in `ALTER TABLE ... ADD COLUMN`:

```camussql
ALTER TABLE users
ADD COLUMN nickname STRING NULL COMMENT 'Display name';
```

The syntax is `COMMENT '<text>'`, with no `=`.

`CREATE DATABASE` doesn't have an inline comment clause. To comment on a
database, use `COMMENT ON DATABASE`.

## Read comments

`SHOW CREATE TABLE` shows all the comments of a table:

```camussql
SHOW CREATE TABLE users;
```

The output looks like this:

```camussql
CREATE TABLE `users` (
  `id` OID NOT NULL COMMENT 'Internal user identifier',
  `email` STRING NOT NULL COMMENT 'Unique login email address',
  PRIMARY KEY (`id`),
  KEY `email_idx` (`email`) COMMENT 'Lookup by login email'
) COMMENT 'Application users';
```

If you run this DDL again, it creates the same comments.

`SHOW DATABASE` returns the name and the comment of the current database:

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

Sequence comments are in the `comment` column of
[`SHOW SEQUENCES`](/docs/sequences). View and materialized-view comments are in
the `comment` column of [`SHOW VIEWS`](/docs/views#inspect-views) and
[`SHOW MATERIALIZED VIEWS`](/docs/materialized-views#inspect-materialized-views).

Note that `SHOW COLUMNS` doesn't include comments. For column and index
comments, use `SHOW CREATE TABLE`.

## Renames

A comment remains on its object after a rename:

- A database comment, after `RENAME DATABASE` or
  `ALTER DATABASE ... RENAME TO`.
- A table comment, after `ALTER TABLE ... RENAME TO`.
- A column comment, after `ALTER TABLE ... RENAME COLUMN ... TO ...`.
- An index comment, after `ALTER TABLE ... RENAME INDEX ... TO ...`.
- A sequence comment, after `ALTER SEQUENCE ... RENAME TO`.

## Limits and escapes

A comment can be at most 65,535 UTF-16 code units long. If a comment exceeds
the limit, `CADB0511 CommentTooLong` names the object and gives the length.

A comment can contain any character, such as a quotation mark or a newline. `SHOW CREATE TABLE` writes each comment back as a valid SQL
string. It uses an `E'...'` escape string when a control character needs an
escape.

To include a single quotation mark, write it twice:

```camussql
COMMENT ON COLUMN users.email IS 'The user''s email';
```

To write a control character, use `E'...'`. In a regular string, a backslash is
a regular character:

```camussql
COMMENT ON TABLE users IS E'first line\nsecond line';
COMMENT ON TABLE users IS 'C:\Users\data';
```

A malformed escape returns `CADB0400` `InvalidInput`. For the escape rules, see
[String literals](/docs/data-types#string-literals).

## Reserved keyword and unsupported objects

`COMMENT` is a reserved keyword. If an existing schema has an object named
`comment`, quote the name with backticks:

```camussql
SELECT `comment` FROM posts;
```

You can't comment on primary key indexes, constraints, branches, or functions.
