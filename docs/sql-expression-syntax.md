---
sidebar_position: 2.25
---

# PostgreSQL expression syntax

CamusDB supports the PostgreSQL expression forms that are common in generated
SQL and migration scripts. You can run this SQL without rewriting it:

| Form | Example | Meaning |
| --- | --- | --- |
| Window functions | `row_number() OVER (PARTITION BY customer_id ORDER BY id)` | [Ranks rows, and each row stays in the result](/docs/sql-queries#window-functions). |
| Interval literals | `now() - INTERVAL '7 days'` | [Calendar and duration arithmetic](/docs/data-types#intervals). |
| Digit separators | `200_000` | The number `200000`. |
| `^` | `2 ^ 3` | [Power, the same as `pow(2, 3)`](#power). |
| `%` | `i % 3` | The remainder of `i / 3`, the same as `mod(i, 3)`. |
| `::` | `x::text` | The same as `CAST(x AS text)`. |
| Subscript | `tags[1]` | The first element of an array. |
| Quantified comparison | `'news' = ANY (tags)` | `true` when the array contains the value. |
| Quantified comparison | `score > ALL (limits)` | `true` when the value is greater than all array elements. |
| JSONB operators | `payload ->> 'kind'` | [Reads, tests, and changes JSON documents](#jsonb-operators). |

For example, this statement uses three of the forms:

```camussql
INSERT INTO orders
SELECT
  i,
  1 + (i % 200_000),
  (ARRAY['paid', 'shipped', 'delivered'])[1 + i % 3]
FROM series;
```

## Characters and statement boundaries

An unknown character outside a literal, a quoted identifier, or a comment
returns `CADB0406` with its line and column. For example, an unexpected
backslash or a `$` by itself is an error. Dollar-quoted C# bodies (`$$ ... $$`
or `$tag$ ... $tag$`) are allowed in
[inline function and trigger definitions](/docs/csharp-extensions#inline-functions).

Whitespace can be spaces, tabs, line breaks, form feeds, and vertical tabs. A
non-breaking space (U+00A0) or a byte-order mark (U+FEFF) isn't whitespace. If
an invisible character causes a syntax error, check SQL that you copied.

Unquoted identifiers use ASCII letters, digits, and underscores. A literal or a
quoted identifier can't contain a raw line break or tab. Use an escape string,
such as `E'line\nnext'`, for those characters.

A SQL request to the server contains one statement. Extra semicolons at the end
are allowed, but a second statement isn't. Clients that run scripts send each
statement as a separate request.

## Digit separators

A numeric literal can have one underscore between two digits to group them.
The underscores don't change the value:

```camussql
SELECT 200_000;
SELECT 1_000.000_5;
SELECT 1e1_0;
SELECT id FROM robots LIMIT 1_000;
```

The rule applies to all numbers, including values, `LIMIT`, `OFFSET`, and sizes
such as `STRING(1_0)`.

An underscore that isn't between two digits is a syntax error, for example
`200_`, `2__0`, `1_.5`, `1.5_`, and `1_e5`. A name that starts with an
underscore, such as `_000`, is an identifier. Hexadecimal integers such as
`0xFF` can't have separators.

## The `%` operator

`a % b` is the remainder of `a / b`. It has the same precedence as `*` and `/`
and groups from left to right:

```camussql
SELECT 1 + 7 % 3 * 2;
SELECT 17 % 5 % 3;
```

`%` is a call to the `mod` function, and the two forms give the same result:

- Two `INT64` operands return an `INT64`. A `NUMERIC` operand with an `INT64`
  or another `NUMERIC` returns `NUMERIC`. A float operand returns `FLOAT64`.
- The result has the sign of the dividend. `-7 % 3` is `-1`.
- A `NULL` operand gives `NULL`.
- A zero divisor is an error.

`SHOW CREATE VIEW`, `CHECK` constraints, and `EXPLAIN` can show `%` as
`mod(a, b)`.

## Power {#power}

`a ^ b` is the same as `pow(a, b)`, and it returns FLOAT64. For XOR, use `#`.
The precedence of `^` follows PostgreSQL:

| Expression | Result | Interpretation |
| --- | --- | --- |
| `2 * 3 ^ 2` | 18 | Power binds before multiplication. |
| `-2 ^ 2` | 4 | Unary minus binds before power: `(-2) ^ 2`. |
| `2 ^ 3 ^ 2` | 64 | Powers group left to right: `(2 ^ 3) ^ 2`. |

Write `-(2 ^ 2)` for -4 and `2 ^ (3 ^ 2)` for 512. NULL and numeric errors
follow [POW](/docs/functions-math).

## Operator precedence

The table lists the operators from the tightest binding to the loosest. A row
with left grouping groups from left to right. Use parentheses to make a mixed
expression clear.

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

This order follows PostgreSQL, with one difference: in CamusDB, prefix `~`
binds like unary minus. For example, `1 + 1 IS NULL` is `(1 + 1) IS NULL`, and
`6 | 1 & 3` is `(6 | 1) & 3`, which is 3. A chain of comparisons such as
`a = b = c` returns `CADB0406`. Join separate comparisons with `AND`.

A view or `CHECK` constraint created with an earlier version has its original
grouping, because its saved SQL contains parentheses. For example, an old `a = b IS NULL`
can be stored as `a = (b IS NULL)`. Check `SHOW CREATE VIEW` or
`SHOW CREATE TABLE`, and create the definition again if you want the current
grouping.

## LIKE and ILIKE patterns

`LIKE` matches the full string. `%` matches any sequence of characters,
including an empty one. `_` matches one Unicode code point, such as an emoji.
`ILIKE` ignores case. Newlines are regular characters in both forms.

A backslash escapes the next pattern character. In a regular string literal,
backslashes are literal characters. An escape string needs two backslashes:

```camussql
SELECT 'a_' LIKE 'a\_';              -- true
SELECT 'ab' LIKE 'a_';               -- true
SELECT 'a%' LIKE E'a\\%';            -- true
SELECT 'a_' LIKE 'a#_' ESCAPE '#';    -- true
SELECT 'a\b' LIKE 'a\b' ESCAPE '';    -- true; disable escaping
```

`ESCAPE` works with `LIKE`, `ILIKE`, `NOT LIKE`, and `NOT ILIKE`. Its value can
be one code point, an empty string to turn off escaping, or `NULL` for an
unknown result. It can be a parameter or a column. A longer escape string
returns `CADB0400`. `ESCAPE` can also be an identifier. `SHOW CREATE` and
`EXPLAIN` can show the clause as `like_escape(pattern, escape)`.

A pattern that ends with its escape character returns `CADB0400` only if the
match reaches that character. For example, `'b' LIKE 'a\'` is false, and
`'a\' LIKE 'a\'` returns the error. `SHOW ... LIKE` uses the same rules.

**Stored patterns use these rules from their next evaluation.** Earlier
versions treated `_` and backslash as literal characters. After an upgrade, a
`CHECK` can reject a value that it accepted before, and the results of a view
can change. A materialized view has its old rows until the next refresh. Escape
literal underscores and backslashes in stored patterns where needed. During an
upgrade, servers of different versions can give different results.

## IN-list values

`IN` and `NOT IN` lists can contain columns, as well as literals and
parameters:

```camussql
SELECT id FROM orders WHERE status IN (preferred_status, 'pending');
```

A column in the list uses the value of the current row. A list of constants
is hashed once and can use an index. A list with a column is evaluated for each
row, and it can't use an index. Other expressions in a list, such as
`IN (quantity + 1, 2)`, are syntax errors. Use a subquery or separate
comparisons for those cases.

## The `::` cast

`x::type` is a short form of `CAST(x AS type)`. It uses the same type names
as `CAST`, including aliases such as `text`, `int`, `integer`, and `double`.

```camussql
SELECT '42'::int + 1;
SELECT random()::text;
SELECT @p::int64;
SELECT '42'::text::int64;
```

`::` binds tighter than the other operators, as in PostgreSQL. In `a + b::int`,
only `b` is cast. To cast a larger expression, put it in parentheses:

```camussql
SELECT (a + b)::text FROM t;
```

`SHOW CREATE VIEW` and `CHECK` constraints show the `CAST(x AS type)` form.

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

A subscript can be used in any expression, such as a select list, `WHERE`,
`ORDER BY`, a `CHECK` constraint, or a view body.

CamusDB doesn't support array slices such as `tags[1:2]`, or updates of one
element such as `UPDATE t SET tags[1] = 'x'`.

## Array elements

Each element of `ARRAY[...]` is a full expression:

```camussql
SELECT ARRAY[n::string, 'hello'] FROM t;
SELECT ARRAY[o.name, t.n::string] FROM t JOIN o ON t.id = o.id;
SELECT ARRAY[min(n), max(n)] FROM t;
```

All elements that aren't `NULL` must have the same type. PostgreSQL finds a
common type and allows some mixed arrays, such as `ARRAY[1, 2.5]`. CamusDB
returns `CADB0400` for them. Cast the elements to one type.

See [Data Types](/docs/data-types#arrays) for array columns and literals. See
[Array Functions](/docs/functions-array) for `cardinality`, `array_length`, and
`array_contains`.

## Subqueries in expressions

Uncorrelated subqueries work in `WHERE`, select lists, `HAVING`, `JOIN ON`, and
write expressions. They can be nested in `CASE` branches, function arguments,
comparisons, and `BETWEEN` bounds. For example:

```camussql
SELECT id, EXISTS (SELECT 1 FROM stock_alerts WHERE active = true) AS has_alerts
FROM products;
```

This uncorrelated subquery is executed once. Correlated scalar, `EXISTS`,
`IN`, `NOT IN`, and quantified subqueries work in `SELECT ... WHERE`, in eligible
select lists, in `UPDATE ... SET` and `WHERE`, and in `DELETE ... WHERE`. See
[subquery positions and examples](/docs/joins-and-subqueries#subqueries-in-where).

## Quantified comparisons

A quantified comparison compares a value with each element of an array, or
with each row of a subquery. All comparison operators work with all
quantifiers:

| Form | Meaning |
| --- | --- |
| `x op ANY (a)` | `true` when `x op element` is true for at least one element of `a`. |
| `x op SOME (a)` | Synonym for `ANY`. |
| `x op ALL (a)` | `true` when `x op element` is true for all elements of `a`. |

`op` is `=`, `<>`, `<`, `<=`, `>`, or `>=`. `!=` is the same as `<>`.
`ANY`, `SOME`, and `ALL` aren't case-sensitive.

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

An uncorrelated subquery is executed once, before the outer scan starts. A
correlated subquery reads the values of each outer row, in the supported
[subquery positions](/docs/joins-and-subqueries#subqueries-in-where). CamusDB
can reuse its result for repeated values in the same statement. `IN (SELECT ...)`
follows the same rule.

A subquery on the right isn't an array. The type rules for array elements don't
apply to it, and its rows can have different types. Each row is compared with
the left operand by the same rule that the operator uses outside a quantifier.
The same mixed values in an `ARRAY[...]` literal return an error if they don't
share one element type.

### NULL rules

The result is the result of the expansion, with three-valued `OR` and `AND`:

- `x op ANY (a1, a2)` is `(x op a1) OR (x op a2)`.
- `x op ALL (a1, a2)` is `(x op a1) AND (x op a2)`.
- `ANY` is `true` when one comparison is `true`. `ALL` is `false` when one
  comparison is `false`. A decided answer applies, also when another element is
  `NULL`.
- If no comparison decides the answer, a `NULL` element makes the result `NULL`.
- A `NULL` left value gives `NULL` when the set has elements.
- An empty array, or a subquery with no rows, gives `false` for `ANY` and
  `true` for `ALL`. This is also true for a `NULL` left value, because CamusDB
  doesn't compare anything.
- A `NULL` array gives `NULL`. A `NULL` array is different from an empty array.

Each element comparison has the same meaning as the operator outside a
quantifier. Mixed numeric values compare by value. A pair that the operator
can't compare, such as a number and a string, returns the same error as outside
a quantifier.

A `WHERE` clause returns a row if the result is `true`. A `CHECK` constraint
fails if the result is `false`. This means that `CHECK ('banned' <> ALL (tags))`
allows a `NULL` array. It also allows an array that contains a `NULL` element
and no `'banned'`.

### Stored form

Some forms are membership tests. CamusDB rewrites each one as the equivalent
`IN`, `NOT IN`, or `array_contains` expression. `SHOW CREATE VIEW`,
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

`= SOME` is shown in the same way as `= ANY`.

Other pairs of operator and quantifier are shown as you wrote them. A subquery
gets an extra pair of parentheses:

| You write | CamusDB shows |
| --- | --- |
| `x < ALL (ARRAY[1, 2])` | `x < ALL (ARRAY[1, 2])` |
| `x >= ANY (tags)` | `x >= ANY (tags)` |
| `x <> ANY (SELECT y FROM u)` | `x <> ANY ((SELECT y FROM u))` |

### Index use

An `ARRAY[...]` literal becomes an `IN` list only in a membership form, when all
its elements are constants or parameters. The planner can then use an index on
`x`, as for `x IN (1, 2)`. Other array expressions become an `array_contains`
call, which is evaluated for each row.

`x = ANY (@ids)` and `x = ANY (tags)` don't use an index. The forms with `<`,
`<=`, `>`, or `>=` don't use an index either, and they are evaluated for each
row.

### Not supported

CamusDB doesn't support:

- `ANY`, `SOME`, or `ALL` with zero arguments or more than one argument.
- A quantifier on the left side, as in `ANY (tags) = x`, or in another
  position, as in `SELECT any(tags)`. These return `CADB0400`.
- An array text literal, such as `x = ANY ('{a,b}')`.

A column can be named `any`, `some`, or `all`. These words are quantifiers if an
argument in parentheses follows them on the right side of a comparison.

## JSONB operators

CamusDB supports the PostgreSQL operators for [`JSONB` documents](/docs/json#operators):
`->`, `->>`, `#>`, `#>>`, `@>`, `<@`, `?`, `?|`, `?&`, `||`, `-`, and `#-`.

```camussql
SELECT payload -> 'user' ->> 'id'
FROM events
WHERE payload @> '{"kind": "login"}'
  AND payload ->> 'deleted_at' IS NULL;
```

These operators have the same precedence as the concatenation, bitwise, and
regex operators, as in PostgreSQL. Arithmetic binds tighter. Comparisons, `IS`,
and `IN` bind looser. Put an extraction in parentheses when you concatenate it:
`'kind=' || (payload ->> 'kind')`. See
[operator precedence](#operator-precedence).

`#-` with no space between the two characters is the delete-path operator. For
XOR with a negative number, write `x # -1`, with a space.

:::caution camus-cli 0.18.4
`camus-cli` treats `#` as the start of a comment, except in `#>`, `#>>`, and
`#-`. It sends only the part of the line before the `#`, and it returns no
error. Use XOR through a driver or the HTTP API until this is fixed.
:::

`<@` is the contained-by operator if a placeholder name doesn't follow it
directly. `x <@p` means `x < @p`. Write `x <@ @p` for the operator.
