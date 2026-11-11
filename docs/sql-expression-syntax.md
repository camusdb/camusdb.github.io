---
sidebar_position: 2.25
---

# PostgreSQL expression syntax

CamusDB accepts several PostgreSQL expression forms that are common in generated
SQL and migration scripts:

| Form | Example | Meaning |
| --- | --- | --- |
| Window functions | `row_number() OVER (PARTITION BY customer_id ORDER BY id)` | [Ranks rows without grouping them into one result](/docs/sql-queries#window-functions). |
| Digit separators | `200_000` | The number `200000`. |
| `^` | `2 ^ 3` | [Power, the same as `pow(2, 3)`](#power). |
| `%` | `i % 3` | The remainder of `i / 3`, the same as `mod(i, 3)`. |
| `::` | `x::text` | The same as `CAST(x AS text)`. |
| Subscript | `tags[1]` | The first element of an array. |
| Quantified comparison | `'news' = ANY (tags)` | `true` when the array holds the value. |
| Quantified comparison | `score > ALL (limits)` | `true` when the value is greater than every array element. |
| JSONB operators | `payload ->> 'kind'` | [Reads, tests, and changes JSON documents](#jsonb-operators). |

Together they allow statements such as this:

```camussql
INSERT INTO orders
SELECT
  i,
  1 + (i % 200_000),
  (ARRAY['paid', 'shipped', 'delivered'])[1 + i % 3]
FROM series;
```

## Characters and statement boundaries

Unknown characters outside a literal, quoted identifier, or comment fail with
CADB0406, including their line and column. They are no longer silently ignored.
For example, an unexpected backslash or a bare `$` is an error. Dollar-quoted
C# bodies (`$$ ... $$` or `$tag$ ... $tag$`) are accepted in
[inline function and trigger definitions](/docs/csharp-extensions#inline-functions). A non-breaking space
(U+00A0) or byte-order mark (U+FEFF) is not SQL whitespace; check copied SQL
when an invisible character causes a syntax error.

Whitespace accepts spaces, tabs, line breaks, form feeds, and vertical tabs.
Unquoted identifiers use ASCII letters, digits, and underscores. Raw line
breaks and tabs inside a literal or quoted identifier are refused; use an
escape string such as `E'line\nnext'` for those characters.

A server SQL request contains one statement. Repeated trailing semicolons are
accepted, but not a second statement after them. Clients that run scripts
split them into separate requests.

## Digit separators

A numeric literal can use a single underscore between two digits to group
them. The underscores do not change the value:

```camussql
SELECT 200_000;
SELECT 1_000.000_5;
SELECT 1e1_0;
SELECT id FROM robots LIMIT 1_000;
```

The rule applies wherever CamusDB parses a number, including values, `LIMIT`,
`OFFSET`, and sizes such as `STRING(1_0)`.

An underscore that is not between two digits is a syntax error, for example
`200_`, `2__0`, `1_.5`, `1.5_`, and `1_e5`. A name that starts with an
underscore, such as `_000`, is still an identifier.

Hexadecimal integers such as `0xFF` do not accept separators.

## The `%` operator

`a % b` is the remainder of `a / b`. It has the same precedence as `*` and `/`
and groups from left to right:

```camussql
SELECT 1 + 7 % 3 * 2;
SELECT 17 % 5 % 3;
```

`%` is a call to the `mod` function, so the two spellings always agree:

- Two `INT64` operands return an `INT64`. A `NUMERIC` operand with an `INT64`
  or another `NUMERIC` returns `NUMERIC`. A float operand returns `FLOAT64`.
- The result has the sign of the dividend. `-7 % 3` is `-1`.
- A `NULL` operand gives `NULL`.
- A zero divisor is an error.

Because `%` is stored as a call, `SHOW CREATE VIEW`, `CHECK` constraints, and
`EXPLAIN` can render it as `mod(a, b)`. The two forms are equivalent.

## Power {#power}

`a ^ b` is the same as `pow(a, b)` and returns FLOAT64. It means power,
not XOR; use `#` for XOR. Its precedence follows PostgreSQL:

| Expression | Result | Interpretation |
| --- | --- | --- |
| `2 * 3 ^ 2` | 18 | Power binds before multiplication. |
| `-2 ^ 2` | 4 | Unary minus binds before power: `(-2) ^ 2`. |
| `2 ^ 3 ^ 2` | 64 | Powers group left to right: `(2 ^ 3) ^ 2`. |

Write `-(2 ^ 2)` for -4 and `2 ^ (3 ^ 2)` for 512. NULL and numeric errors
follow [POW](/docs/functions-math).

## Operator precedence

Operators bind from tightest to loosest as follows. Each left-associative row
groups from left to right; use parentheses to make a mixed expression clear.

| Operators | Grouping |
| --- | --- |
| `::`, array subscripts | Left |
| Unary `-`, prefix `~` | Right |
| `^` | Left |
| `*`, `/`, `%` | Left |
| `+`, `-` | Left |
| Concatenation, bitwise, regex, and JSONB operators | Left, all at one level |
| BETWEEN, IN, LIKE, ILIKE, and their NOT forms | Non-associative |
| `<`, `>`, `<=`, `>=`, `=`, `<>`, `!=` | Non-associative |
| IS | Non-associative |
| NOT | Right |
| AND | Left |
| OR | Left |

This follows PostgreSQL, except prefix `~` binds like unary minus in CamusDB.
For example, `1 + 1 IS NULL` is `(1 + 1) IS NULL`, and
`6 | 1 & 3` is `(6 | 1) & 3`, yielding 3. Comparison chains such as
`a = b = c` fail with CADB0406; write explicit comparisons joined by AND.

Stored views and CHECK constraints retain their earlier grouping because
their saved SQL contains parentheses. Inspect SHOW CREATE VIEW or SHOW CREATE
TABLE, and recreate a definition if you want the new grouping. For example,
an old `a = b IS NULL` can remain `a = (b IS NULL)`.

## LIKE and ILIKE patterns

LIKE matches the entire string. `%` matches any run of characters, including
none; `_` matches one Unicode code point, including an emoji. ILIKE uses
case-insensitive matching. Newlines are ordinary characters in either form.

Backslash escapes the next pattern character. Plain string literals retain
backslashes; escape strings need a doubled backslash:

```camussql
SELECT 'a_' LIKE 'a\_';              -- true
SELECT 'ab' LIKE 'a_';               -- true
SELECT 'a%' LIKE E'a\\%';            -- true
SELECT 'a_' LIKE 'a#_' ESCAPE '#';    -- true
SELECT 'a\b' LIKE 'a\b' ESCAPE '';    -- true; disable escaping
```

ESCAPE works with LIKE, ILIKE, NOT LIKE, and NOT ILIKE. It accepts one code
point, an empty string to disable escaping, or NULL for an unknown result.
It can be a parameter or column; a longer escape string fails with CADB0400.
ESCAPE remains usable as an identifier. The parser represents this clause
as `like_escape(pattern, escape)`, which SHOW CREATE and EXPLAIN can display.

A pattern ending with its escape character fails with CADB0400 only if
matching reaches that character. For example, `'b' LIKE 'a\'` is false, while
`'a\' LIKE 'a\'` fails. SHOW ... LIKE uses the same matching rules.

**Existing stored patterns take the new rules on their next evaluation.**
Older builds treated `_` and backslash as literals. A CHECK can now reject a
previously accepted value, and a view's results can change. Materialized views
keep their rows until refreshed. Escape literal underscores and backslashes
in stored patterns where needed; mixed server versions can disagree during
an upgrade.

## IN-list values

IN and NOT IN lists can contain columns as well as literals and parameters:

```camussql
SELECT id FROM orders WHERE status IN (preferred_status, 'pending');
```

Each column item uses the current row. Constant lists can be hashed once and
used for index probes; a row-dependent list is evaluated per row and is not
converted into an index seek. General expressions inside a list, such as
`IN (quantity + 1, 2)`, remain syntax errors. Use a subquery or explicit
comparisons for those shapes.

## The `::` cast

`x::type` is a shorter way to write `CAST(x AS type)`. It accepts the same type
names as `CAST`, including aliases such as `text`, `int`, `integer`, and
`double`.

```camussql
SELECT '42'::int + 1;
SELECT random()::text;
SELECT @p::int64;
SELECT '42'::text::int64;
```

`::` binds tighter than other operators, as in PostgreSQL. In `a + b::int`,
only `b` is cast. To cast a larger expression, wrap it:

```camussql
SELECT (a + b)::text FROM t;
```

`SHOW CREATE VIEW` and `CHECK` constraints render the equivalent
`CAST(x AS type)` form.

## Array subscripts

`value[n]` reads element `n` of an array. The first element is `1`.

```camussql
SELECT tags[1] FROM posts;
SELECT (ARRAY['paid', 'shipped', 'delivered'])[1 + i % 3] FROM series;
SELECT ARRAY['a', 'b'][2];
```

These rules follow PostgreSQL:

- An index below 1 or above the array length gives `NULL`.
- A `NULL` array or a `NULL` index gives `NULL`.
- A non-integer index is an error.
- Subscripting a non-array value is an error.

A subscript can appear anywhere an expression can: a select list, `WHERE`,
`ORDER BY`, a `CHECK` constraint, or a view body.

CamusDB does not support array slices such as `tags[1:2]`, or assigning a single
element with `UPDATE t SET tags[1] = 'x'`.

## Array elements

Each element of `ARRAY[...]` is a full expression:

```camussql
SELECT ARRAY[n::string, 'hello'] FROM t;
SELECT ARRAY[o.name, t.n::string] FROM t JOIN o ON t.id = o.id;
SELECT ARRAY[min(n), max(n)] FROM t;
```

All non-`NULL` elements must have the same type. PostgreSQL finds a common type,
so it accepts some mixed arrays such as `ARRAY[1, 2.5]`. CamusDB rejects them;
cast the elements to one type.

See [Data Types](/docs/data-types#arrays) for array columns and literals. See
[Array Functions](/docs/functions-array) for `cardinality`, `array_length`, and
`array_contains`.

## Subqueries in expressions

Uncorrelated subqueries work in SELECT lists, HAVING, JOIN ON, and write
expressions as well as WHERE. They can be nested inside CASE branches,
function arguments, comparisons, and BETWEEN bounds. For example:

```camussql
SELECT id, EXISTS (SELECT 1 FROM stock_alerts WHERE active = true) AS has_alerts
FROM products;
```

This uncorrelated query runs once. Correlated scalar, EXISTS, IN/NOT IN, and
quantified subqueries also work in SELECT WHERE, eligible SELECT lists,
UPDATE SET/WHERE, and DELETE WHERE. See
[subquery positions and examples](/docs/joins-and-subqueries#subqueries-in-where).

## Quantified comparisons

A quantified comparison compares a value with each element of an array or each
row of a subquery. CamusDB accepts every comparison operator with every
quantifier:

| Form | Meaning |
| --- | --- |
| `x op ANY (a)` | `true` when `x op element` holds for at least one element of `a`. |
| `x op SOME (a)` | Synonym for `ANY`. |
| `x op ALL (a)` | `true` when `x op element` holds for every element of `a`. |

`op` is `=`, `<>`, `<`, `<=`, `>`, or `>=`. `!=` is the same as `<>`.
`ANY`, `SOME`, and `ALL` are not case-sensitive.

The right operand can be an array literal, an array column, an array parameter,
another expression that returns an array, or a subquery:

```camussql
SELECT * FROM posts WHERE 'news' = ANY (tags);
SELECT * FROM users WHERE id = ANY (ARRAY[1, 2, 3]);
SELECT * FROM users WHERE id = ANY (@ids);
SELECT * FROM t WHERE x = ANY (SELECT y FROM u);
SELECT * FROM t WHERE x <> ALL (SELECT y FROM u);
SELECT * FROM runs WHERE duration > ALL (ARRAY[10, 20]);
SELECT * FROM runs WHERE duration <= ANY (SELECT budget FROM limits);

CREATE TABLE posts (
  id INT64 PRIMARY KEY,
  tags ARRAY(STRING) CHECK ('banned' <> ALL (tags))
);

CREATE TABLE runs (
  id INT64 PRIMARY KEY,
  scores ARRAY(INT64) CHECK (0 < ALL (scores))
);
```

An uncorrelated subquery runs once before the outer scan starts. A correlated
subquery reads each outer row's values, with possible reuse for repeated values
within the same statement, in the supported [subquery positions](/docs/joins-and-subqueries#subqueries-in-where). `IN (SELECT ...)` already follows the same rule.

A subquery on the right is not an array, so array element-type rules do not
apply to it, and the rows it returns can hold more than one type. Each row is
compared to the left operand by the same rule the operator uses outside a
quantifier. The same mixed values written as an `ARRAY[...]` literal are still
rejected when they do not share one array element type.

### NULL rules

The result is that of the expansion the form stands for, using three-valued `OR`
and `AND`:

- `x op ANY (a1, a2)` is `(x op a1) OR (x op a2)`.
- `x op ALL (a1, a2)` is `(x op a1) AND (x op a2)`.
- `ANY` is `true` when one comparison is `true`. `ALL` is `false` when one
  comparison is `false`. A decided answer wins, even when another element is
  `NULL`.
- With no decided answer, a `NULL` element makes the result `NULL`.
- A `NULL` left value gives `NULL` when the set is not empty.
- An empty array, or a subquery with no rows, gives `false` for `ANY` and
  `true` for `ALL`. This is also true for a `NULL` left value, because no
  comparison runs.
- A `NULL` array gives `NULL`. A `NULL` array is not an empty array.

Each element comparison means exactly what the operator means outside a
quantifier. Mixed numeric values compare by value. A pair the operator cannot
compare, such as a number against a string, raises the same error it would
outside a quantifier.

A `WHERE` clause keeps a row only when the result is `true`. A `CHECK`
constraint rejects a row only when the result is `false`. So
`CHECK ('banned' <> ALL (tags))` accepts a `NULL` array, and it also accepts an
array that holds a `NULL` element and no `'banned'`.

### Stored form

Three forms are membership tests, and CamusDB rewrites each one into the
equivalent `IN`, `NOT IN`, or `array_contains` expression. `SHOW CREATE VIEW`,
`SHOW CREATE TABLE` for a `CHECK` constraint, and `EXPLAIN` show the rewritten
form:

| You write | CamusDB shows |
| --- | --- |
| `x = ANY (ARRAY[1, 2])` | `x IN (1, 2)` |
| `x <> ALL (ARRAY[1, 2])` | `x NOT IN (1, 2)` |
| `x = ANY (tags)` | `array_contains(tags, x)` |
| `x <> ALL (tags)` | `NOT array_contains(tags, x)` |
| `x = ANY (SELECT y FROM u)` | `x IN (SELECT y FROM u)` |
| `x <> ALL (SELECT y FROM u)` | `x NOT IN (SELECT y FROM u)` |

`= SOME` is shown the same way as `= ANY`, because the two are one form.

Every other operator and quantifier pair keeps its own form and is shown as you
wrote it, except that a subquery gains a pair of parentheses:

| You write | CamusDB shows |
| --- | --- |
| `x < ALL (ARRAY[1, 2])` | `x < ALL (ARRAY[1, 2])` |
| `x >= ANY (tags)` | `x >= ANY (tags)` |
| `x <> ANY (SELECT y FROM u)` | `x <> ANY ((SELECT y FROM u))` |

### Index use

An `ARRAY[...]` literal becomes an `IN` list only in a membership form, and only
when every element is a constant or a parameter. The planner can then use an
index on `x`, as it does for `x IN (1, 2)`. Other array expressions become an
`array_contains` call evaluated for each row.

`x = ANY (@ids)` and `x = ANY (tags)` do not use an index. No form with an
ordered operator uses an index; each is evaluated for each row.

### Not supported

CamusDB does not support `ANY`, `SOME`, or `ALL` with zero arguments or more
than one argument. It also does not support a quantifier on the left side, as in
`ANY (tags) = x`, or in any other position, as in `SELECT any(tags)`.

CamusDB has no array text literal, so an expression such as
`x = ANY ('{a,b}')` is not supported.

A column can still be named `any`, `some`, or `all`. These words act as a
quantifier only when a parenthesized argument follows them on the right side of
a comparison.

## JSONB operators

CamusDB supports the PostgreSQL operators for [`JSONB` documents](/docs/json#operators):
`->`, `->>`, `#>`, `#>>`, `@>`, `<@`, `?`, `?|`, `?&`, `||`, `-`, and `#-`.

```camussql
SELECT payload -> 'user' ->> 'id'
FROM events
WHERE payload @> '{"kind": "login"}'
  AND payload ->> 'deleted_at' IS NULL;
```

These operators share the precedence of concatenation, bitwise, and regex
operators, following PostgreSQL. Arithmetic binds more tightly; comparisons,
IS, and IN bind less tightly. Parenthesize an extraction when concatenating
it: `'kind=' || (payload ->> 'kind')`. See [operator precedence](#operator-precedence).

`#-` with no space between the two characters is the delete-path operator.
Before `JSONB`, `x #-1` meant `x XOR -1`. It now deletes a path. For XOR, write
`x # -1`, with a space.

`<@` is the contained-by operator only when no placeholder name follows it
directly. `x <@p` still means `x < @p`. Write `x <@ @p` for the operator.
