---
sidebar_position: 2.4
---

# SELECT

`SELECT` reads rows from a table, and it shapes them. You select the columns,
filter them, group them, sort them, and divide them into pages.

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC
LIMIT 25;
```

This page covers a read from one table. For a join, a subquery, and a derived
table, see [Joins And Subqueries](/docs/joins-and-subqueries). For a `SELECT`
with no table at all, such as `SELECT 1 + 1`, see
[SELECT Without FROM](/docs/sql-fromless-select).

## The order of the clauses

You must write the clauses in this order. CamusDB evaluates them in
approximately the same order:

```camussql
SELECT   [DISTINCT] projections
FROM     source [AS OF SYSTEM TIME ...] [@{hint}]
WHERE    row_filter
GROUP BY keys
HAVING   group_filter
ORDER BY sort_keys
LIMIT    n OFFSET m
```

Two consequences are practical. `WHERE` filters the input rows before the group.
`HAVING` filters the grouped rows after it.

`ORDER BY`, `LIMIT`, and `OFFSET` apply last, to the projected result. They can
therefore reference an alias of the output.

## Select the columns

```camussql
SELECT * FROM robots;
SELECT id, name FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT upper(trim(name)) AS display_name FROM robots;
```

You can project any scalar expression. That includes a call of a function, and
arithmetic.

`AS` names the output column. Without an `AS`, CamusDB derives the name of the
output from the expression itself. See [Functions](/docs/functions) for the
available scalar functions.

### DISTINCT

`DISTINCT` removes a duplicate row of the output, after the projection. Two
`NULL` values count as the same value.

```camussql
SELECT DISTINCT kind FROM robots ORDER BY kind;
SELECT DISTINCT kind, year FROM robots ORDER BY kind, year;
```

CamusDB does not support three shapes today:

| Not supported | Reason |
| --- | --- |
| `COUNT(DISTINCT column)` | CamusDB does not implement a distinct aggregate. |
| `SELECT DISTINCT ... GROUP BY ...` | A group already produces distinct keys. |
| `SELECT DISTINCT COUNT(*)` | `DISTINCT` cannot wrap the projection of an aggregate. |

A compatible `NOT NULL` index can cover the distinct columns. The planner then
streams the distinct values from that index. It builds no hash table.
[`EXPLAIN`](/docs/explain) shows the path that CamusDB used.

### A CASE expression

`CASE` selects a value under a condition. The searched form evaluates the
predicates in order:

```camussql
SELECT
  name,
  CASE
    WHEN year < 1980 THEN "classic"
    WHEN year >= 1980 THEN "modern"
    ELSE "unknown"
  END AS era
FROM robots;
```

The simple form compares one expression against the value of each `WHEN`:

```camussql
SELECT
  status,
  CASE status
    WHEN "A" THEN "active"
    WHEN "B" THEN "blocked"
    ELSE "other"
  END AS status_name
FROM users;
```

The first match wins. A `WHEN` condition that evaluates to `NULL` does not
match. Nothing can match, and the expression can have no `ELSE`. The result is
then `NULL`.

`CASE` is a scalar expression. It therefore works at any position that accepts
one. That includes the inside of an aggregate, which is the usual way to write a
conditional total:

```camussql
SELECT SUM(CASE WHEN status = "paid" THEN amount ELSE 0 END) AS paid_total
FROM orders;
```

`CASE` and `END` are reserved keywords. A column with the name `end` needs
backticks: ``SELECT `end` FROM events``.

## Filter the rows

```camussql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE enabled OR year IS NULL;

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004;
```

| Category | Operators |
| --- | --- |
| A comparison | `=`, `!=`, `<`, `>`, `<=`, `>=`, `BETWEEN ... AND ...` |
| A boolean | `AND`, `OR`, and a bare boolean column, such as `WHERE enabled` |
| A match of a pattern | `LIKE`, `ILIKE`, `~`, `~*`, `!~`, `!~*` |
| A check of a null | `IS NULL`, `IS NOT NULL` |
| A membership | `IN (...)`, `NOT IN (...)`, `IN (SELECT ...)`, `NOT IN (SELECT ...)` |
| An existence | `EXISTS (SELECT ...)` |

`BETWEEN` includes both ends. `year BETWEEN 2001 AND 2004` therefore matches
2001, 2004, and every year between them.

### A match of a pattern

`LIKE` and `ILIKE` use the wildcards `%` and `_`. `ILIKE` is the form that
ignores the case.

Use an operator of a regular expression when a wildcard is not enough:

| Operator | Matches | Case |
| --- | --- | --- |
| `~` | A regular expression | It matters. |
| `~*` | A regular expression | It does not matter. |
| `!~` | A negated regular expression | It matters. |
| `!~*` | A negated regular expression | It does not matter. |

```camussql
SELECT username
FROM users
WHERE username ~ "^[a-zA-Z][a-zA-Z0-9_]{2,29}$";

SELECT sku
FROM products
WHERE sku !~ "\\s";
```

A pattern has no anchor of its own. It matches at any position of the value,
until you write `^` and `$`.

Both operands must be strings. The result is unknown when one operand is
`NULL`. The row then does not survive a `WHERE` clause.

The engine is the engine of regular expressions of .NET. A match that ignores
the case uses the invariant culture. A character class, a quantifier, an anchor,
an alternation, and a group all work. Use `\p{L}` or `[a-zA-Z]`. Do not use a
POSIX class such as `[[:alpha:]]`.

A pattern with a wrong form raises `CADB0400 InvalidInput`. Every match runs
under an internal timeout. A pathological pattern therefore fails. It does not
hang.

To extract or to replace with a regular expression, and not to filter, see
[Regex Functions](/docs/functions-regex).

### A list of values in an IN clause

```camussql
SELECT id, name FROM robots WHERE year IN (2020, 2022, 2024);
SELECT id, name FROM robots WHERE status NOT IN ("deleted", "archived");
SELECT id, name FROM robots WHERE id IN (@id1, @id2, @id3);
```

On an indexed column, the planner turns a list of values into repeated probes of
the index. It does not use a scan. That choice pays off for a small list, and
for a list of a moderate size.

`NOT IN` follows the null semantics of SQL. A `NULL` in the list makes every
comparison that does not match evaluate to unknown. CamusDB filters those rows
out. A `NOT IN` against a set with a `NULL` therefore often returns fewer rows
than you expect.

`IN` also accepts a subquery. See
[Joins And Subqueries](/docs/joins-and-subqueries).

## Aggregate the rows

| Function | Behavior |
| --- | --- |
| `COUNT(*)` | It counts every row. |
| `COUNT(column)` | It counts the values that are not null. |
| `SUM(column)` | It adds the numeric values. It ignores a null. |
| `AVG(column)` | It returns a `FLOAT64` average. It ignores a null. |
| `MIN(column)` | It returns the smallest value that is not null. |
| `MAX(column)` | It returns the largest value that is not null. |

Without a `GROUP BY`, an aggregate reduces the whole table to one row:

```camussql
SELECT COUNT(*), SUM(year), AVG(year), MIN(year), MAX(year)
FROM robots;
```

### GROUP BY

`GROUP BY` accepts a column, and it accepts an expression:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role;

SELECT role, department, COUNT(*) AS cnt
FROM app_users
GROUP BY role, department;

SELECT year + 100 AS display_year
FROM robots
GROUP BY year + 100;
```

The standard rules of a projection apply. Every projection that is not an
aggregate must appear in the `GROUP BY`. `SELECT name, COUNT(*) FROM robots` is
therefore an error. Add `GROUP BY name` to correct it.

### HAVING

`HAVING` filters after the aggregation. It can reference the alias of an
aggregate, an expression of an aggregate, or a key of the group:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY role;

SELECT COUNT(*) AS total
FROM robots
HAVING total > 0;
```

`HAVING` needs a `GROUP BY`, or a projection of an aggregate. Use `WHERE` to
filter the input rows instead of the groups. `WHERE` runs first, and it
therefore gives the aggregate less work.

## Sort the rows, and divide them into pages

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

`ASC` is the default. `LIMIT` and `OFFSET` accept a literal integer. They also
accept a placeholder, such as `LIMIT @limit`.

In a grouped query, `ORDER BY` can reference three things: the alias of a
selected aggregate, an expression of an aggregate, and a grouped expression.

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY cnt DESC, role;
```

An index can already give the requested order. The planner then omits the sort
completely. An `ORDER BY` with a `LIMIT` on an indexed column is therefore much
cheaper than a sort of the whole table. See
[Query Planning](/docs/query-planning).

## Read a past snapshot

`AS OF SYSTEM TIME` reads a consistent historical snapshot. Write it after the
source of the `FROM` clause, and before the `WHERE` clause:

```camussql
SELECT id, name, year
FROM robots AS OF SYSTEM TIME '-10s'
WHERE year >= 1970
ORDER BY year DESC;
```

The clause applies to a read-only statement in autocommit mode. It pins the
whole statement to one timestamp. That includes each join and each subquery. See
[Time-Travel Reads](/docs/time-travel-reads) for the accepted formats, and for
the limits of the retention.

## Force an index

You can know that one index suits a predicate better than the estimate of the
planner does. Name that index:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Confirm the effect with [`EXPLAIN`](/docs/explain). Do that before you leave a
hint in production code. A hint can outlive the distribution of the data that
you tuned it for. It then does more harm than good.

## Parameters

A placeholder can take the position of a value, in a filter and in a page:

```camussql
SELECT id, name
FROM robots
WHERE id = @id
LIMIT @limit;
```

The client that submits the statement binds the values. See
[Parameters And Prepared Statements](/docs/prepared-statements).
