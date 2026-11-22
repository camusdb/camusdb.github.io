---
sidebar_position: 2.45
---

# SELECT without FROM

A `SELECT` without a `FROM` clause evaluates its expressions against one
synthetic row and returns one row. You can use it for connection health
checks, for a quick test of a cast or a function, and for the utility queries
that ORMs send.

```camussql
SELECT 1 + 1;
```

It's also the shortest way to ask the database a yes-or-no question:

```camussql
SELECT EXISTS (SELECT 1 FROM accounts WHERE email = @email);
```

## Supported forms

The following queries evaluate expressions, bind a parameter, and return two
columns:

```camussql
SELECT upper('abc');
SELECT CAST('5' AS INT64);
SELECT CASE WHEN 1 = 1 THEN 'ok' ELSE 'fail' END;
SELECT @value;
SELECT 41 + 1 AS answer, 'ok' AS status;
```

An unnamed column gets an ordinal name, such as `0` or `1`.

A literal has a SQL type in the result metadata and in a table that you create
from the query. For example, `SELECT 1 AS id` returns an `INT64` column. You can
combine these queries with [set operations](/docs/sql-queries#set-operations):

```camussql
SELECT 1 AS id UNION ALL SELECT 2 ORDER BY 1;
```

Here `ORDER BY` applies to the combined result.

`LIMIT` and `OFFSET` keep or skip the synthetic row. Both of the following
queries return no rows:

```camussql
SELECT 1 LIMIT 0;
SELECT 1 LIMIT 1 OFFSET 1;
```

## Filter the synthetic row

With a `WHERE` clause, the row is returned when the condition is `TRUE`. When the condition
is `FALSE` or `NULL`, the query returns no rows. You can use this for a
conditional check, or for an insert that depends on an existence check:

```camussql
SELECT 'ready' WHERE TRUE;
SELECT 'ready' WHERE FALSE;   -- no rows
SELECT 'seed' WHERE NOT EXISTS (SELECT 1 FROM accounts);
```

The condition must be a boolean or `NULL`. `SELECT 5 WHERE 1` returns
`CADB0400`.

When the filter removes the row, the expressions in the select list aren't
evaluated. However, a constant division by zero is found before execution.
This means that `SELECT 1 / 0 WHERE FALSE` returns `CADB0400`. For more information,
see [statement checks](/docs/data-types#errors-before-reading-rows).

A sequence call such as `nextval('s')` works in this form. With a `WHERE`
clause, it returns `CADB0547`, unless the filter removes the row. In
that case, the query returns no rows, and no value is drawn.

## Subqueries in the select list

A subquery in the select list is evaluated first, and its result replaces it.
The `EXISTS` example at the top of this page works this way. You can also
compare the result of a scalar subquery, or return it:

```camussql
SELECT NOT EXISTS (SELECT 1 FROM accounts WHERE email = 'nobody@example.com');
SELECT (SELECT COUNT(*) FROM accounts) > 0;
SELECT (SELECT COUNT(*) FROM accounts);
```

At the top level, there is no outer row. This means that its subqueries
can't be correlated.

## In another statement

The query also works as a subquery, a derived table, or the body of a view:

```camussql
SELECT (SELECT 1);                         -- 1
SELECT (SELECT 1 WHERE FALSE);             -- NULL
SELECT x FROM (SELECT 5 AS x) d;           -- 5
CREATE VIEW readiness AS SELECT 'ready' AS status;
```

It can also be the source of `INSERT ... SELECT` and `CREATE TABLE ... AS`.

The `WHERE`, `LIMIT`, and `OFFSET` rules are the same. Aggregates and
`ORDER BY` aren't supported, and a sequence call returns `CADB0547`.

As a subquery, it can read a column of the outer query in the
[supported positions](/docs/joins-and-subqueries#subqueries-in-where):

```camussql
SELECT u.id FROM app_users u WHERE EXISTS (SELECT 1 WHERE u.active = true);
```

`CREATE VIEW` checks names and types, but it doesn't evaluate the body. A view
such as `CREATE VIEW v AS SELECT 1 / 0 AS x` is created, and a read from it
returns the error. An unknown column or a type error in the body makes
`CREATE VIEW` fail.

## Unsupported forms

The following forms return an error, also when the query has a `WHERE` clause:

| Query | Error |
| --- | --- |
| `SELECT *` | `CADB0400`: `*` needs a table. |
| `SELECT COUNT(*)` | `CADB0400`: an aggregate needs a table. Use a scalar subquery, such as `SELECT (SELECT COUNT(*) FROM accounts)`. |
| `SELECT 1 GROUP BY ...` or `SELECT 1 HAVING ...` | `CADB0406`, a syntax error. |
| `SELECT 1 ORDER BY ...` | `CADB0400`: there is only one row to sort. |
| `SELECT missing_name` | `CADB0404` `UnknownColumn`. |

## EXPLAIN

If the query doesn't have a `WHERE` clause, `EXPLAIN` returns a fixed plan:

```camussql
EXPLAIN SELECT 41 + 1 AS answer;
```

```text
physical  constant-source  1 row
physical  project          columns: answer
```

The plan also has a `limit` node when the query has `LIMIT` or `OFFSET`.

With a `WHERE` clause, the plan shows the one-row source as `function-scan`
(`*single_row*`), and `EXPLAIN (ANALYZE)` measures the filter and the select list.
If the query doesn't have a `WHERE` clause, `EXPLAIN (ANALYZE)` returns
`CADB0400`. There is no table access to measure.
