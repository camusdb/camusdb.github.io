---
sidebar_position: 2.05
---

# SQL Comments

CamusDB accepts SQL comments in both common forms:

```camussql
-- This comment runs to the end of the line.
SELECT id, name
FROM robots;

SELECT id, name
FROM robots /* inline block comment */
WHERE year >= 1980;

/*
  Block comments can span multiple lines.
*/
SELECT COUNT(*) FROM robots;
```

Comments are ignored by the parser anywhere whitespace would be valid. This
means you can place comments before a statement, between clauses, or at the end
of a line.

## Line Comments

Line comments start with `--` and continue to the end of the line:

```camussql
SELECT id, name
FROM robots
WHERE year >= 1980; -- only newer robots
```

A comment-only input is not a valid SQL statement, but it is handled as a
normal parse error rather than a lexer failure.

## Block Comments

Block comments start with `/*` and end with `*/`:

```camussql
SELECT id, name
FROM robots
/* keep this filter aligned with the dashboard */
WHERE active = true;
```

Block comments can span multiple lines:

```camussql
/*
  Report all active robots
  visible to the current query.
*/
SELECT id, name
FROM robots
WHERE active = true;
```

Block comments are not nested. The first `*/` closes the comment. An
unterminated block comment raises a parse error.

## Comments In Strings

Comment markers inside quoted string literals are treated as string content,
not as comments:

```camussql
SELECT "not -- a comment" AS value;
SELECT "not /* a comment */" AS value;
```

## Operators

Comment parsing does not change arithmetic operator behavior:

```camussql
SELECT 10 - -5 FROM numbers;
SELECT a / b FROM metrics;
SELECT a * b FROM metrics;
```

The sequence `--` starts a line comment. For example, `SELECT 10 FROM t --5`
parses as `SELECT 10 FROM t` with `--5` treated as a comment.
