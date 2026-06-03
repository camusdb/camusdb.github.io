---
sidebar_position: 4.1
---

# String Functions

String functions operate on `STRING` values unless otherwise noted. They return
`NULL` when any required argument is `NULL`, except for `concat`, which has its
own null handling.

| Function | Returns | Description |
| --- | --- | --- |
| `length(text)` | `INT64` | Number of characters in `text`. |
| `lower(text)` | `STRING` | Lowercase text using invariant casing. |
| `upper(text)` | `STRING` | Uppercase text using invariant casing. |
| `trim(text)` | `STRING` | Removes leading and trailing whitespace. |
| `ltrim(text)` | `STRING` | Removes leading whitespace. |
| `rtrim(text)` | `STRING` | Removes trailing whitespace. |
| `substring(text, start)` | `STRING` | Returns text from a 1-based start position through the end. |
| `substring(text, start, length)` | `STRING` | Returns up to `length` characters from a 1-based start position. |
| `replace(text, search, replacement)` | `STRING` | Replaces every ordinal match of `search` with `replacement`. |
| `contains(text, search)` | `BOOL` | Returns whether `text` contains `search`, using ordinal comparison. |
| `starts_with(text, prefix)` | `BOOL` | Returns whether `text` starts with `prefix`, using ordinal comparison. |
| `ends_with(text, suffix)` | `BOOL` | Returns whether `text` ends with `suffix`, using ordinal comparison. |
| `concat(value, ...)` | `STRING` | Concatenates one or more scalar values as text. |

## Examples

```sql
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

## Substring Rules

`substring` uses 1-based positions. A start position below `1` is invalid. A
negative length is invalid. If the start position is beyond the end of the
string, the function returns an empty string.

## Concat Rules

`concat` accepts `STRING`, `OID`, `INT64`, `FLOAT64`, and `BOOL` values. `NULL`
arguments are skipped. If every argument is `NULL`, the result is `NULL`.

