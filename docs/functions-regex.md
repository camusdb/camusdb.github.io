---
sidebar_position: 4.5
---

# Regex Functions

Regex functions match, extract, replace, count, and split `STRING` values with
regular expressions. They can be used anywhere scalar functions are accepted,
including projections, `WHERE`, `HAVING`, derived tables, and check
constraints when the expression is deterministic.

CamusDB also supports the regex match operators `~`, `~*`, `!~`, and `!~*`.
Use `regexp_like` when function syntax is clearer or when you need a flags
argument.

## Functions

| Function | Returns | Description |
| --- | --- | --- |
| `regexp_like(text, pattern)` | `BOOL` | Returns whether `text` matches `pattern`. |
| `regexp_like(text, pattern, flags)` | `BOOL` | Same as `regexp_like`, with regex flags. |
| `regexp_match(text, pattern)` | `ARRAY<STRING>` or `NULL` | Returns the first match as an array. Capture groups are returned when the pattern contains groups; otherwise the whole match is returned. |
| `regexp_match(text, pattern, flags)` | `ARRAY<STRING>` or `NULL` | Same as `regexp_match`, with regex flags. |
| `regexp_replace(text, pattern, replacement)` | `STRING` | Replaces the first match. |
| `regexp_replace(text, pattern, replacement, flags)` | `STRING` | Replaces the first match, or every match when `flags` contains `g`. |
| `regexp_count(text, pattern)` | `INT64` | Counts non-overlapping matches. |
| `regexp_count(text, pattern, start)` | `INT64` | Counts matches starting at a 1-based character position. |
| `regexp_count(text, pattern, start, flags)` | `INT64` | Same as `regexp_count`, with regex flags. |
| `regexp_instr(text, pattern)` | `INT64` | Returns the 1-based start position of the first match, or `0` when there is no match. |
| `regexp_instr(text, pattern, start, N, endoption, flags, subexpr)` | `INT64` | Returns the position of the Nth match or capture group. |
| `regexp_substr(text, pattern)` | `STRING` or `NULL` | Returns the first matching substring. |
| `regexp_substr(text, pattern, start, N, flags, subexpr)` | `STRING` or `NULL` | Returns the Nth match or capture group. |
| `regexp_split_to_array(text, pattern)` | `ARRAY<STRING>` | Splits `text` around regex matches. |
| `regexp_split_to_array(text, pattern, flags)` | `ARRAY<STRING>` | Same as `regexp_split_to_array`, with regex flags. |

`regexp_matches` and `regexp_split_to_table` are recognized names, but they are
set-returning functions and are not supported yet. Use `regexp_match` and
`regexp_split_to_array` for scalar results.

## Examples

Find rows with a pattern:

```camussql
SELECT name
FROM customers
WHERE regexp_like(email, "^[^@]+@example\\.com$", "i");
```

Extract the first matching group:

```camussql
SELECT regexp_match("invoice-2026-0007", "invoice-(\\d{4})-(\\d+)") AS parts;
-- ["2026", "0007"]
```

Replace only the first match by default:

```camussql
SELECT regexp_replace("aabbcc", "b", "X");
-- "aaXbcc"
```

Replace every match with the `g` flag:

```camussql
SELECT regexp_replace("aabbcc", "b", "X", "g");
-- "aaXXcc"
```

Use PostgreSQL-style replacement backreferences. Backslash references such as
`\\1` refer to capture groups, and `\\&` refers to the whole match:

```camussql
SELECT regexp_replace(
  "2026-07-13",
  "(\\d{4})-(\\d{2})-(\\d{2})",
  "\\3/\\2/\\1"
);
-- "13/07/2026"
```

A dollar sign is literal in the replacement string:

```camussql
SELECT regexp_replace("foo", "(o)", "x$1");
-- "fx$1o"
```

Count repeated matches:

```camussql
SELECT regexp_count("ababab", "ab");
-- 3
```

Return a match position:

```camussql
SELECT regexp_instr("hello world", "world");
-- 7
```

Extract the second word:

```camussql
SELECT regexp_substr("abc def ghi", "\\w+", 1, 2);
-- "def"
```

Split into an array:

```camussql
SELECT regexp_split_to_array("one,two,three", ",");
-- ["one", "two", "three"]
```

## Flags

The optional `flags` argument is a `STRING` containing zero or more flag
characters:

| Flag | Meaning |
| --- | --- |
| `i` | Case-insensitive matching. |
| `c` | Case-sensitive matching. This cancels a previous `i` in the same flags string. |
| `m` | Multiline mode: `^` and `$` can match line boundaries. |
| `n` | Alias for multiline mode. |
| `s` | Singleline mode: `.` can match newline characters. |
| `x` | Ignore unescaped whitespace in the pattern. |
| `g` | Global replacement for `regexp_replace`. Ignored by functions that already inspect all matches. |

Unknown flags fail with `InvalidInput`.

## Matching Rules

Patterns are unanchored by default. A pattern matches when it occurs anywhere in
the subject string. Use `^` and `$` when the whole value must match:

```camussql
SELECT regexp_like("abc123", "^abc\\d+$");
```

CamusDB uses the .NET regular expression engine. Common regex constructs such
as character classes, quantifiers, anchors, alternation, and capture groups are
supported. POSIX named character classes such as `[[:alpha:]]` are not
supported; use `\\p{L}` or `[a-zA-Z]` instead.

`regexp_match` returns the first match only:

- If the pattern has no capture groups, the result is a one-element array
  containing the whole match.
- If the pattern has capture groups, the result array contains the capture
  groups.
- A non-participating capture group is returned as `NULL`.
- No match returns `NULL`.

`regexp_instr` and `regexp_substr` use 1-based positions:

- `start` must be `>= 1`.
- `N` must be `>= 1`.
- `subexpr` selects a capture group; `0` means the whole match.
- Position arguments must fit in the signed 32-bit integer range.
- For `regexp_instr`, `endoption = 0` returns the start position and
  `endoption = 1` returns the position after the match.
- `regexp_instr` returns `0` when the requested match or capture group is not
  found.
- `regexp_substr` returns `NULL` when the requested match or capture group is
  not found.

`regexp_split_to_array` returns the original string as a one-element array when
the pattern does not match. An empty pattern splits the string into individual
characters.

When a function has a `start` argument, anchors such as `^` still refer to the
true start of the string, not to a sliced substring created at the start
position. With multiline mode enabled, `^` and `$` can match line boundaries.

## Null And Error Behavior

Regex functions return `NULL` when a required input value is `NULL`, except for
position functions that return `0` for "not found" after successfully
evaluating non-null inputs.

Malformed patterns, invalid flags, invalid argument types, invalid argument
counts, and invalid numeric options fail with `InvalidInput`.

Regex evaluation is protected by the configured match timeout. See
[Configuration](/docs/configuration#regex-safety-settings) for
`regex_match_timeout_ms` and `regex_cache_max_entries`.
