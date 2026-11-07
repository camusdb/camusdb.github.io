---
sidebar_position: 4.1
---

# String functions

String functions operate on `STRING` values unless the table below says
otherwise. They return `NULL` when a required argument is `NULL`, except
`concat`, which handles nulls its own way.

| Function | Returns | Description |
| --- | --- | --- |
| `length(text)` | `INT64` | The number of Unicode code points in `text`; an emoji counts as one. `length(bytes)` returns the number of bytes. |
| `lower(text)` | `STRING` | The text in lowercase, using invariant casing rules. |
| `upper(text)` | `STRING` | The text in uppercase, using invariant casing rules. |
| `trim(text)` | `STRING` | Removes leading and trailing whitespace. |
| `ltrim(text)` | `STRING` | Removes leading whitespace. |
| `rtrim(text)` | `STRING` | Removes trailing whitespace. |
| `substring(text, start)` | `STRING` | Returns the text from the start position to the end. Positions start at 1. |
| `substring(text, start, length)` | `STRING` | Returns at most `length` characters from the start position. Positions start at 1. |
| `substr(text, start [, length])` | `STRING` | Alias for `substring`; both also accept BYTES and return BYTES. |
| `strpos(text, search)` | `INT64` | The 1-based code-point position of the first match, or 0 if absent. `POSITION(search IN text)` is equivalent. |
| `like_escape(pattern, escape)` | `STRING` | Converts a LIKE pattern with a custom escape to backslash-escaped form. See [LIKE patterns](/docs/sql-expression-syntax#like-and-ilike-patterns). |
| `replace(text, search, replacement)` | `STRING` | Replaces every ordinal match of `search` with `replacement`. An empty search leaves the text unchanged. |
| `contains(text, search)` | `BOOL` | Whether `text` contains `search`, using ordinal comparison. |
| `starts_with(text, prefix)` | `BOOL` | Whether `text` starts with `prefix`, using ordinal comparison. |
| `ends_with(text, suffix)` | `BOOL` | Whether `text` ends with `suffix`, using ordinal comparison. |
| `concat(value, ...)` | `STRING` | Joins one or more scalar values as text. |

## Examples

```camussql
SELECT
  upper(trim(name)) AS normalized_name,
  length(name) AS name_length
FROM robots;

SELECT name
FROM robots
WHERE starts_with(lower(trim(name)), 'r2');

SELECT substring('CamusDB', 2, 3);
-- "amu"

SELECT replace('aba', 'a', 'z');
-- "zbz"

SELECT concat('robot-', 7, '-', true);
-- "robot-7-true"
```

## substring rules

`substring` and `substr` count positions from 1. Text counts code points;
BYTES counts bytes. A start below 1 uses up that part of the requested length,
following PostgreSQL:

```camussql
SELECT substr('abcde', 0, 2);    -- 'a'
SELECT substring('abcde', -1, 3); -- 'a'
SELECT substring('x🙂y', 2, 1);   -- '🙂'
```

Without a length, a start below 1 returns the entire value. A start past the
end returns an empty value. Negative lengths fail with CADB0400, including
when the start is past the end. A NULL argument returns NULL.

TRIM, LTRIM, and RTRIM accept an optional set of characters to remove, counted
by code point: `ltrim('🙂x', '😀')` leaves `🙂x` unchanged. See
[Unicode text](/docs/data-types#characters-and-valid-unicode) for input validation
and the difference between code points and regex matching.

## concat rules

`concat` accepts `STRING`, `OID`, `UUID`, `INT64`, `FLOAT64`, `FLOAT32`,
`NUMERIC`, `BOOL`, `DATE`, `DATETIME`, and `BYTES`, using the same text form as
`to_string`. For example, a UUID becomes lowercase text with hyphens, and
`BYTES` becomes `\x` followed by lowercase hex. An array is an error.

`concat` skips `NULL` arguments. The result is `NULL` only when every argument is
`NULL`.
