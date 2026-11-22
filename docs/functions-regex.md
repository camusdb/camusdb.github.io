---
sidebar_position: 4.5
---

# Regex functions

Regex functions apply a regular expression to a `STRING` value. Use them to
validate a format, extract parts of a value, or clean text. You can use them where a scalar function is allowed, for
example in a `WHERE` clause or a `CHECK` constraint.

CamusDB also supports the PostgreSQL match operators, such as `~` and `~*`. Use `regexp_like` when you need a flags argument, or when a function
reads more clearly.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `regexp_like(text, pattern [, flags])` | `BOOL` | Whether `text` matches `pattern`. |
| `regexp_match(text, pattern [, flags])` | `ARRAY<STRING>` or `NULL` | The first match, as an array. It has the capture groups if the pattern has groups. Otherwise, it has the full match. |
| `regexp_replace(text, pattern, replacement [, flags])` | `STRING` | Replaces the first match. With the `g` flag, it replaces all matches. |
| `regexp_count(text, pattern [, start [, flags]])` | `INT64` | Counts matches that don't overlap, from position `start`. |
| `regexp_instr(text, pattern)` | `INT64` | The start position of the first match, or `0` if there isn't one. |
| `regexp_instr(text, pattern, start, N, endoption, flags, subexpr)` | `INT64` | The position of the Nth match, or of a capture group. |
| `regexp_substr(text, pattern)` | `STRING` or `NULL` | The first matching substring. |
| `regexp_substr(text, pattern, start, N, flags, subexpr)` | `STRING` or `NULL` | The Nth match, or a capture group. |
| `regexp_split_to_array(text, pattern [, flags])` | `ARRAY<STRING>` | Splits `text` at each match. |

Positions start at 1. `regexp_matches` and `regexp_split_to_table` return sets,
and they aren't supported yet. They return `CADB0400`. Use `regexp_match` and
`regexp_split_to_array`.

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

Replace the first match, or all matches with the `g` flag:

```camussql
SELECT regexp_replace('aabbcc', 'b', 'X');        -- "aaXbcc"
SELECT regexp_replace('aabbcc', 'b', 'X', 'g');   -- "aaXXcc"
```

In the replacement, a back reference such as `\1` refers to a capture group, as
in PostgreSQL. `\&` refers to the full match:

```camussql
SELECT regexp_replace(
  '2026-07-13',
  '(\d{4})-(\d{2})-(\d{2})',
  '\3/\2/\1'
);
-- "13/07/2026"
```

A dollar sign in the replacement is a literal character:

```camussql
SELECT regexp_replace('foo', '(o)', 'x$1');
-- "fx$1o"
```

Count matches, and find a position:

```camussql
SELECT regexp_count('ababab', 'ab');              -- 3
SELECT regexp_instr('hello world', 'world');      -- 7
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
| `i` | A case-insensitive match. |
| `c` | A case-sensitive match. It cancels an earlier `i` in the same string. |
| `m` | Multiline mode. `^` and `$` can match at line boundaries. |
| `n` | An alias for multiline mode. |
| `s` | Singleline mode. `.` can match a newline character. |
| `x` | Unescaped spaces in the pattern are ignored. |
| `g` | Global replacement for `regexp_replace`. The other functions ignore it. |

An unknown flag returns `CADB0400`.

## Matching rules

A pattern can match anywhere in the string. To match the full value, use `^`
and `$`:

```camussql
SELECT regexp_like('abc123', '^abc\d+$');
```

CamusDB uses the .NET regular expression engine, which supports the common
constructs, such as capture groups. Named POSIX
classes, such as `[[:alpha:]]`, aren't supported. Such a pattern isn't an error,
but it matches different text. Use `\p{L}` or `[a-zA-Z]`.

`regexp_match` returns the first match:

- If the pattern doesn't have capture groups, the result is a one-element
  array with the full match.
- If the pattern has capture groups, the array has the groups. A group that
  didn't match is `NULL`.
- If there is no match, the result is `NULL`.

Start arguments and returned positions count Unicode code points from 1.
However, matching uses UTF-16 units. For example, `regexp_count('🙂', '.')` returns 2. PostgreSQL
returns 1. A
result with half of a surrogate pair returns `CADB0400`. If you can, name the
character in the pattern: `regexp_replace('a🙂', '🙂', 'b')` returns `ab`.

The position arguments of `regexp_instr` and `regexp_substr` follow these rules:

- `start` and `N` must be `1` or more, and they must fit in a 32-bit integer.
- `subexpr` selects a capture group. `0` means the full match.
- With `endoption = 0`, `regexp_instr` returns the start of the match. With
  `endoption = 1`, it returns the position after the match.
- If the match or group isn't found, `regexp_instr` returns `0`. In that case,
  `regexp_substr` returns `NULL`.

If the pattern doesn't match, `regexp_split_to_array` returns the string as a
one-element array. An empty pattern splits the string into its characters.

With a `start` argument, `^` refers to the start of the string, and not to the
start position. In multiline mode, `^` and `$` can also match at line
boundaries.

## NULLs and errors

A regex function returns `NULL` if a required input is `NULL`. If the inputs
aren't `NULL`, and the match isn't found, a position function returns `0`.

A malformed pattern returns `CADB0400`. Invalid arguments, such as an unknown
flag, also return `CADB0400`.

`regex_match_timeout_ms` (default 250) limits the time of one match.
`regex_cache_max_entries` (default 1024) limits the compiled patterns in memory
on a node. See the [settings reference](/docs/settings-reference).
