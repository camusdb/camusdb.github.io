---
sidebar_position: 4.5
---

# Regex functions

Regex functions apply a regular expression to a `STRING` value to match,
extract, replace, count, or split.

You can use them anywhere a scalar function is accepted, including projections,
`WHERE` and `HAVING` clauses, derived tables, and check constraints. In a check
constraint, the expression must be deterministic.

CamusDB also supports the match operators `~`, `~*`, `!~`, and `!~*`. Use
`regexp_like` when function syntax reads more clearly, or when you need a flags
argument.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `regexp_like(text, pattern)` | `BOOL` | Whether `text` matches `pattern`. |
| `regexp_like(text, pattern, flags)` | `BOOL` | Same as `regexp_like`, with regular expression flags. |
| `regexp_match(text, pattern)` | `ARRAY<STRING>` or `NULL` | The first match, as an array. Holds the capture groups if the pattern has any, otherwise the whole match. |
| `regexp_match(text, pattern, flags)` | `ARRAY<STRING>` or `NULL` | Same as `regexp_match`, with flags. |
| `regexp_replace(text, pattern, replacement)` | `STRING` | Replaces the first match. |
| `regexp_replace(text, pattern, replacement, flags)` | `STRING` | Replaces the first match, or every match when `flags` contains `g`. |
| `regexp_count(text, pattern)` | `INT64` | Counts non-overlapping matches. |
| `regexp_count(text, pattern, start)` | `INT64` | Counts matches starting from a character position. Positions start at 1. |
| `regexp_count(text, pattern, start, flags)` | `INT64` | Same as `regexp_count`, with flags. |
| `regexp_instr(text, pattern)` | `INT64` | The start position of the first match. Positions start at 1. Returns `0` when there is no match. |
| `regexp_instr(text, pattern, start, N, endoption, flags, subexpr)` | `INT64` | The position of the Nth match, or of a capture group. |
| `regexp_substr(text, pattern)` | `STRING` or `NULL` | The first matching substring. |
| `regexp_substr(text, pattern, start, N, flags, subexpr)` | `STRING` or `NULL` | The Nth match, or a capture group. |
| `regexp_split_to_array(text, pattern)` | `ARRAY<STRING>` | Splits `text` at each match. |
| `regexp_split_to_array(text, pattern, flags)` | `ARRAY<STRING>` | Same as `regexp_split_to_array`, with flags. |

CamusDB recognizes the names `regexp_matches` and `regexp_split_to_table`, but
both return sets and are not supported yet. Use `regexp_match` and
`regexp_split_to_array` for a scalar result.

## Examples

Find rows that match a pattern:

```camussql
SELECT name
FROM customers
WHERE regexp_like(email, '^[^@]+@example\.com$', 'i');
```

Extract the capture groups of the first match:

```camussql
SELECT regexp_match('invoice-2026-0007', 'invoice-(\d{4})-(\d+)') AS parts;
-- ["2026", "0007"]
```

Replace the first match (the default):

```camussql
SELECT regexp_replace('aabbcc', 'b', 'X');
-- "aaXbcc"
```

Replace every match with the `g` flag:

```camussql
SELECT regexp_replace('aabbcc', 'b', 'X', 'g');
-- "aaXXcc"
```

Use PostgreSQL-style back references. A backslash reference such as `\1`
refers to a capture group, and `\&` refers to the whole match:

```camussql
SELECT regexp_replace(
  '2026-07-13',
  '(\d{4})-(\d{2})-(\d{2})',
  '\3/\2/\1'
);
-- "13/07/2026"
```

A dollar sign is a literal character in the replacement string:

```camussql
SELECT regexp_replace('foo', '(o)', 'x$1');
-- "fx$1o"
```

Count repeated matches:

```camussql
SELECT regexp_count('ababab', 'ab');
-- 3
```

Return the position of a match:

```camussql
SELECT regexp_instr('hello world', 'world');
-- 7
```

Extract the second word:

```camussql
SELECT regexp_substr('abc def ghi', '\w+', 1, 2);
-- "def"
```

Split the text into an array:

```camussql
SELECT regexp_split_to_array('one,two,three', ',');
-- ["one", "two", "three"]
```

## Flags

The optional `flags` argument is a `STRING` of zero or more flag characters:

| Flag | Meaning |
| --- | --- |
| `i` | Case-insensitive match. |
| `c` | Case-sensitive match. Cancels an earlier `i` in the same flags string. |
| `m` | Multiline mode. `^` and `$` can match at line boundaries. |
| `n` | Alias for multiline mode. |
| `s` | Singleline mode. `.` can match a newline character. |
| `x` | Ignores unescaped spaces in the pattern. |
| `g` | Global replacement for `regexp_replace`. Functions that already inspect every match ignore this flag. |

An unknown flag fails with `InvalidInput`.

## Matching rules

Patterns are unanchored by default, so they match anywhere in the subject
string. Use `^` and `$` when the whole value must match:

```camussql
SELECT regexp_like('abc123', '^abc\d+$');
```

CamusDB uses the .NET regular expression engine. It supports the common
constructs: character classes, quantifiers, anchors, alternation, and capture
groups. It does not support named POSIX classes such as `[[:alpha:]]`. Use
`\p{L}` or `[a-zA-Z]` instead.

`regexp_match` returns only the first match:

- Without capture groups, the result is a one-element array holding the whole
  match.
- With capture groups, the result array holds the groups.
- A capture group that did not participate returns `NULL`.
- The function returns `NULL` when there is no match.

`regexp_instr` and `regexp_substr` count positions from 1:

- `start` must be `1` or more.
- `N` must be `1` or more.
- `subexpr` selects a capture group. `0` means the whole match.
- Position arguments must fit in a signed 32-bit integer.
- For `regexp_instr`, `endoption = 0` returns the start of the match, and
  `endoption = 1` returns the position after the match.
- `regexp_instr` returns `0` when it cannot find the requested match or capture
  group.
- `regexp_substr` returns `NULL` when it cannot find the requested match or
  capture group.

When the pattern does not match, `regexp_split_to_array` returns the original
string as a one-element array. An empty pattern splits the string into its
characters.

When a function takes a `start` argument, an anchor such as `^` still refers to
the true start of the string, not to the substring beginning at the start
position. In multiline mode, `^` and `$` can match at line boundaries.

## NULLs and errors

A regex function returns `NULL` when a required input is `NULL`. Position
functions are the exception: once they evaluate non-null inputs successfully,
they return `0` when the result is not found.

These conditions fail with `InvalidInput`: a malformed pattern, an invalid flag,
an invalid argument type, an invalid number of arguments, and an invalid numeric
option.

The configured match timeout protects regular expression evaluation. See
[Configuration](/docs/configuration) for
`regex_match_timeout_ms` and `regex_cache_max_entries`.
