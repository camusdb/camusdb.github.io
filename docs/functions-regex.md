---
sidebar_position: 4.5
---

# Regex functions

A regex function works on a `STRING` value with a regular expression. These
functions match, extract, replace, count, and split.

You can use one at any position that accepts a scalar function. That includes a
projection, a `WHERE` clause, a `HAVING` clause, a derived table, and a check
constraint. In a check constraint, the expression must be deterministic.

CamusDB also supports four operators of a match: `~`, `~*`, `!~`, and `!~*`. Use
`regexp_like` when the syntax of a function is clearer. Use it also when you
need an argument of flags.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `regexp_like(text, pattern)` | `BOOL` | Whether `text` matches `pattern`. |
| `regexp_like(text, pattern, flags)` | `BOOL` | The same as `regexp_like`, with flags for the regular expression. |
| `regexp_match(text, pattern)` | `ARRAY<STRING>` or `NULL` | The first match, as an array. The result holds the capture groups when the pattern has a group. Otherwise it holds the whole match. |
| `regexp_match(text, pattern, flags)` | `ARRAY<STRING>` or `NULL` | The same as `regexp_match`, with flags. |
| `regexp_replace(text, pattern, replacement)` | `STRING` | It replaces the first match. |
| `regexp_replace(text, pattern, replacement, flags)` | `STRING` | It replaces the first match. It replaces every match when `flags` holds a `g`. |
| `regexp_count(text, pattern)` | `INT64` | It counts the matches that do not overlap. |
| `regexp_count(text, pattern, start)` | `INT64` | It counts the matches from a character position. The first position is 1. |
| `regexp_count(text, pattern, start, flags)` | `INT64` | The same as `regexp_count`, with flags. |
| `regexp_instr(text, pattern)` | `INT64` | The start position of the first match. The first position is 1. It returns `0` without a match. |
| `regexp_instr(text, pattern, start, N, endoption, flags, subexpr)` | `INT64` | The position of match number N, or of a capture group. |
| `regexp_substr(text, pattern)` | `STRING` or `NULL` | The first substring that matches. |
| `regexp_substr(text, pattern, start, N, flags, subexpr)` | `STRING` or `NULL` | Match number N, or a capture group. |
| `regexp_split_to_array(text, pattern)` | `ARRAY<STRING>` | It splits `text` at each match. |
| `regexp_split_to_array(text, pattern, flags)` | `ARRAY<STRING>` | The same as `regexp_split_to_array`, with flags. |

CamusDB knows the names `regexp_matches` and `regexp_split_to_table`. Both
functions return a set, and CamusDB does not support them yet. Use
`regexp_match` and `regexp_split_to_array` for a scalar result.

## Examples

Find a row with a pattern:

```camussql
SELECT name
FROM customers
WHERE regexp_like(email, "^[^@]+@example\\.com$", "i");
```

Extract the first group that matches:

```camussql
SELECT regexp_match("invoice-2026-0007", "invoice-(\\d{4})-(\\d+)") AS parts;
-- ["2026", "0007"]
```

Replace the first match, which is the default:

```camussql
SELECT regexp_replace("aabbcc", "b", "X");
-- "aaXbcc"
```

Replace every match, with the `g` flag:

```camussql
SELECT regexp_replace("aabbcc", "b", "X", "g");
-- "aaXXcc"
```

Use a back reference in the style of PostgreSQL. A reference with a backslash,
such as `\\1`, points at a capture group. `\\&` points at the whole match:

```camussql
SELECT regexp_replace(
  "2026-07-13",
  "(\\d{4})-(\\d{2})-(\\d{2})",
  "\\3/\\2/\\1"
);
-- "13/07/2026"
```

A dollar sign is a literal character in the string of the replacement:

```camussql
SELECT regexp_replace("foo", "(o)", "x$1");
-- "fx$1o"
```

Count the repeated matches:

```camussql
SELECT regexp_count("ababab", "ab");
-- 3
```

Return the position of a match:

```camussql
SELECT regexp_instr("hello world", "world");
-- 7
```

Extract the second word:

```camussql
SELECT regexp_substr("abc def ghi", "\\w+", 1, 2);
-- "def"
```

Split the text into an array:

```camussql
SELECT regexp_split_to_array("one,two,three", ",");
-- ["one", "two", "three"]
```

## Flags

The optional argument `flags` is a `STRING`. It holds zero or more characters of
a flag:

| Flag | Meaning |
| --- | --- |
| `i` | A match that ignores the case. |
| `c` | A match that respects the case. It cancels an earlier `i` in the same string of flags. |
| `m` | Multiline mode. `^` and `$` can match the boundary of a line. |
| `n` | An alias of the multiline mode. |
| `s` | Singleline mode. A `.` can match a character of a new line. |
| `x` | It ignores a space in the pattern, unless you escape that space. |
| `g` | A global replacement, for `regexp_replace`. A function that already inspects every match ignores this flag. |

An unknown flag fails with `InvalidInput`.

## The rules of a match

A pattern has no anchor by default. It matches at any position of the subject
string. Use `^` and `$` when the whole value must match:

```camussql
SELECT regexp_like("abc123", "^abc\\d+$");
```

CamusDB uses the engine of regular expressions of .NET. It supports the common
constructs: a character class, a quantifier, an anchor, an alternation, and a
capture group. It does not support a POSIX class with a name, such as
`[[:alpha:]]`. Use `\\p{L}` or `[a-zA-Z]` instead.

`regexp_match` returns the first match only:

- The result is an array of one element with the whole match, when the pattern
  has no capture group.
- The result array holds the capture groups, when the pattern has a group.
- A capture group that did not take part returns a `NULL`.
- The function returns `NULL` without a match.

`regexp_instr` and `regexp_substr` count a position from 1:

- `start` must be `1` or more.
- `N` must be `1` or more.
- `subexpr` selects a capture group. A `0` means the whole match.
- An argument of a position must fit in the range of a signed 32-bit integer.
- For `regexp_instr`, `endoption = 0` returns the start of the match.
  `endoption = 1` returns the position after the match.
- `regexp_instr` returns `0` when it does not find the requested match or the
  requested capture group.
- `regexp_substr` returns `NULL` when it does not find the requested match or
  the requested capture group.

`regexp_split_to_array` returns the original string, as an array of one element,
when the pattern does not match. An empty pattern splits the string into its
characters.

A function can have a `start` argument. An anchor such as `^` still points at
the true start of the string. It does not point at a substring that begins at
the start position. With the multiline mode on, `^` and `$` can match the
boundary of a line.

## The behavior for a null and for an error

A regex function returns `NULL` when a necessary input value is `NULL`. A
function of a position is the exception. It returns `0` for a result that it
does not find, after a successful evaluation of inputs that are not null.

Five conditions fail with `InvalidInput`: a pattern with a wrong form, an
invalid flag, an invalid type of an argument, an invalid number of arguments,
and an invalid numeric option.

The configured timeout of a match protects the evaluation of a regular
expression. See [Configuration](/docs/configuration) for
`regex_match_timeout_ms` and `regex_cache_max_entries`.
