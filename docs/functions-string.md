---
sidebar_position: 4.1
---

# String functions

A string function operates on a `STRING` value, unless the table below states
another type. It returns `NULL` when a necessary argument is `NULL`. `concat` is
the exception. It handles a null in its own way.

| Function | Returns | Description |
| --- | --- | --- |
| `length(text)` | `INT64` | The number of UTF-16 code units in `text`. A character outside the Basic Multilingual Plane, such as an emoji, counts as 2. `length(bytes)` returns the number of bytes. |
| `lower(text)` | `STRING` | The text in lowercase, with the invariant rules of the case. |
| `upper(text)` | `STRING` | The text in uppercase, with the invariant rules of the case. |
| `trim(text)` | `STRING` | It removes the space at the start and at the end. |
| `ltrim(text)` | `STRING` | It removes the space at the start. |
| `rtrim(text)` | `STRING` | It removes the space at the end. |
| `substring(text, start)` | `STRING` | It returns the text from the start position to the end. The first position is 1. |
| `substring(text, start, length)` | `STRING` | It returns at most `length` characters, from the start position. The first position is 1. |
| `replace(text, search, replacement)` | `STRING` | It replaces every ordinal match of `search` with `replacement`. |
| `contains(text, search)` | `BOOL` | Whether `text` holds `search`. It uses an ordinal comparison. |
| `starts_with(text, prefix)` | `BOOL` | Whether `text` starts with `prefix`. It uses an ordinal comparison. |
| `ends_with(text, suffix)` | `BOOL` | Whether `text` ends with `suffix`. It uses an ordinal comparison. |
| `concat(value, ...)` | `STRING` | It joins one or more scalar values as text. |

## Examples

```camussql
SELECT
  upper(trim(name)) AS normalized_name,
  length(name) AS name_length
FROM robots;

SELECT name
FROM robots
WHERE starts_with(lower(trim(name)), "r2");

SELECT substring("CamusDB", 2, 3);
-- "amu"

SELECT replace("aba", "a", "z");
-- "zbz"

SELECT concat("robot-", 7, "-", true);
-- "robot-7-true"
```

## The rules of substring

`substring` counts a position from 1. A start position below `1` is invalid. A
negative length is invalid. The start position can be past the end of the
string. The function then returns an empty string.

## The rules of concat

`concat` accepts eleven types: `STRING`, `OID`, `UUID`, `INT64`, `FLOAT64`,
`FLOAT32`, `NUMERIC`, `BOOL`, `DATE`, `DATETIME`, and `BYTES`. It uses the same
text form as `to_string`. For example, a UUID becomes lowercase text with
hyphens, and `BYTES` becomes `\x` followed by lowercase hex. An array is an
error.

`concat` skips an argument that is `NULL`. The result is `NULL` only when every
argument is `NULL`.
