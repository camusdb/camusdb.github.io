---
sidebar_position: 4.1
---

# String functions

String functions operate on `STRING` values unless the table below says
otherwise. They return `NULL` when a required argument is `NULL`, except
`concat`, which handles nulls its own way.

| Function | Returns | Description |
| --- | --- | --- |
| `length(text)` | `INT64` | The number of UTF-16 code units in `text`. A character outside the Basic Multilingual Plane, such as an emoji, counts as 2. `length(bytes)` returns the number of bytes. |
| `lower(text)` | `STRING` | The text in lowercase, using invariant casing rules. |
| `upper(text)` | `STRING` | The text in uppercase, using invariant casing rules. |
| `trim(text)` | `STRING` | Removes leading and trailing whitespace. |
| `ltrim(text)` | `STRING` | Removes leading whitespace. |
| `rtrim(text)` | `STRING` | Removes trailing whitespace. |
| `substring(text, start)` | `STRING` | Returns the text from the start position to the end. Positions start at 1. |
| `substring(text, start, length)` | `STRING` | Returns at most `length` characters from the start position. Positions start at 1. |
| `replace(text, search, replacement)` | `STRING` | Replaces every ordinal match of `search` with `replacement`. |
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

`substring` counts positions from 1. A start position below `1` or a negative
length is invalid. If the start position is past the end of the string, the
function returns an empty string.

## concat rules

`concat` accepts `STRING`, `OID`, `UUID`, `INT64`, `FLOAT64`, `FLOAT32`,
`NUMERIC`, `BOOL`, `DATE`, `DATETIME`, and `BYTES`, using the same text form as
`to_string`. For example, a UUID becomes lowercase text with hyphens, and
`BYTES` becomes `\x` followed by lowercase hex. An array is an error.

`concat` skips `NULL` arguments. The result is `NULL` only when every argument is
`NULL`.
