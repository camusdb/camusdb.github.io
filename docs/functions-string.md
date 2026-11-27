---
sidebar_position: 4.1
---

# String functions

The string functions clean up, search, and slice `STRING` values. For example,
you can remove the spaces around a name before you compare it, or find the rows
whose code starts with a prefix. A `NULL` argument returns `NULL`. The exception
is `concat`, which skips `NULL` arguments.

| Function | Returns | Description |
| --- | --- | --- |
| `length(text)` | `INT64` | The number of characters (Unicode code points). An emoji counts as one. |
| `octet_length(text)` | `INT64` | The size of the text in UTF-8 bytes. |
| `lower(text)` | `STRING` | The text in lowercase. The result doesn't depend on a locale. |
| `upper(text)` | `STRING` | The text in uppercase. The result doesn't depend on a locale. |
| `trim(text [, characters])` | `STRING` | Removes white space, or the given characters, from both ends. |
| `ltrim(text [, characters])` | `STRING` | Removes white space, or the given characters, from the start. |
| `rtrim(text [, characters])` | `STRING` | Removes white space, or the given characters, from the end. |
| `substring(text, start [, length])` | `STRING` | The text from position `start`, or at most `length` characters from it. Positions start at 1. |
| `substr(text, start [, length])` | `STRING` | The same as `substring`. |
| `strpos(text, search)` | `INT64` | The position of the first match, or 0 if there is no match. `POSITION(search IN text)` is the same. |
| `replace(text, search, replacement)` | `STRING` | Replaces each match of `search`. An empty `search` returns the text unchanged. |
| `contains(text, search)` | `BOOL` | Whether `text` contains `search`. |
| `starts_with(text, prefix)` | `BOOL` | Whether `text` starts with `prefix`. |
| `ends_with(text, suffix)` | `BOOL` | Whether `text` ends with `suffix`. |
| `concat(value, ...)` | `STRING` | Joins one or more values as text. See [Join values as text](#join-values-as-text). |
| `like_escape(pattern, escape)` | `STRING` | Rewrites a `LIKE` pattern that uses a custom escape character to use `\`. See [LIKE patterns](/docs/sql-expression-syntax#like-and-ilike-patterns). |

An argument of another type returns `CADB0400`. Some of these functions also
take a `BYTES` value and count bytes. For more information, see
[Text functions that also take bytes](/docs/functions-bytes#text-functions-that-also-take-bytes).

## Examples

In these examples, the `robots` table has the names `'  R2-D2 '` and `'T-800'`.

```camussql
SELECT upper(trim(name)) AS normalized_name, length(name) AS name_length
FROM robots;
-- 'R2-D2', 8 and 'T-800', 5

SELECT name
FROM robots
WHERE starts_with(lower(trim(name)), 'r2');
-- '  R2-D2 '

SELECT substring('CamusDB', 2, 3);
-- 'amu'

SELECT strpos('CamusDB', 'DB');
-- 6

SELECT replace('aba', 'a', 'z');
-- 'zbz'

SELECT concat('robot-', 7, '-', true);
-- 'robot-7-true'
```

## Case and white space

The search functions compare characters exactly, and they are case-sensitive.
For example, `contains('Robot', 'robot')` returns `false`. To ignore case, apply
`lower` to both values, or use `ILIKE`. To make a case-insensitive lookup use an
index, create an [expression index](/docs/sql-indexes#expression-indexes) on
`lower(email)`.

With one argument, the trim functions remove Unicode white space, such as tabs
and line breaks. This is different from PostgreSQL, where `trim(text)` removes
spaces only. To remove spaces only, pass the set `' '`, as in `trim(name, ' ')`.

Lengths and positions count Unicode code points. For more information, see
[Characters and valid Unicode](/docs/data-types#characters-and-valid-unicode).

The SQL-standard forms `TRIM(BOTH 'x' FROM name)` and
`SUBSTRING(name FROM 2 FOR 3)` return an error. Use `trim(name, 'x')` and
`substring(name, 2, 3)`.

## substring rules

A start below 1 uses up part of the length, as in PostgreSQL.

```camussql
SELECT substr('abcde', 0, 2);     -- 'a'
SELECT substring('abcde', -1, 3); -- 'a'
SELECT substring('abcde', -5);    -- 'abcde'
SELECT substring('abcde', 9);     -- ''
```

A start past the end returns an empty string. A negative length returns
`CADB0400`, also when the start is past the end.

## Join values as text

`concat` converts each argument to text and joins the results. It uses the
same text form as `to_string`. For example, a `UUID` becomes lowercase text with
hyphens, and a `BYTES` value becomes `\x` followed by lowercase hex. An array
argument returns `CADB0400`. For the text form of each type, see
[Text form of each type](/docs/functions-conversion#text-form-of-each-type).

`concat` skips `NULL` arguments, and it returns `NULL` if all its arguments are
`NULL`. The `||` operator also joins values as text. However, `||` returns
`NULL` when an operand is `NULL`.

```camussql
SELECT concat('R2', NULL, '-D2'); -- 'R2-D2'
SELECT 'R2' || NULL || '-D2';     -- NULL
```

## Related pages

- [Regex functions](/docs/functions-regex)
- [Bytes functions](/docs/functions-bytes)
- [Conversion functions](/docs/functions-conversion)
- [String and bytes length](/docs/data-types#string-and-bytes-length)
