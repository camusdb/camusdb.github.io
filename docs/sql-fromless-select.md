---
sidebar_position: 2.45
---

# SELECT without FROM

A `SELECT` without a `FROM` clause evaluates its projection list against one
synthetic row. Without filtering or pagination, it returns one row:

```camussql
SELECT 1 + 1;
```

You probably use this form without thinking about it, for example in:

- Connection health probes.
- Cast checks.
- Utility SQL that an ORM emits on its own.

It is also the shortest way to ask the database a yes-or-no question:

```camussql
SELECT EXISTS (SELECT 1 FROM accounts WHERE email = @email);
```

## Supported forms

Evaluate a scalar expression:

```camussql
SELECT 1 + 1;
SELECT upper('abc');
SELECT CAST('5' AS INT64);
SELECT CASE WHEN 1 = 1 THEN 'ok' ELSE 'fail' END;
SELECT regexp_split_to_array('one,two,three', ',');
```

Bind a parameter:

```camussql
SELECT @value;
```

Return several projections:

```camussql
SELECT 41 + 1 AS answer, 'ok' AS status;
```

Projections without an alias get ordinal column names, such as `0`, `1`, and
`2`.

Literal projections declare their SQL type in result metadata and copied-table
schemas: `SELECT 1 AS id` has an `INT64` output column. You can combine these
queries with [set operations](/docs/sql-queries#set-operations):

```camussql
SELECT 1 AS id UNION ALL SELECT 2 ORDER BY 1;
```

Here `ORDER BY` applies to the combined result.

Use `LIMIT` and `OFFSET` to keep or skip the single synthetic row:

```camussql
SELECT 1 LIMIT 0;
SELECT 1 LIMIT 1 OFFSET 1;
```

Both examples return zero rows.

## Filter the synthetic row

A WHERE clause keeps the row when its condition is TRUE; FALSE or NULL returns
no rows. Use this for conditional probes or inserts based on an existence check:

```camussql
SELECT 'ready' WHERE TRUE;
SELECT 'ready' WHERE FALSE; -- no rows
SELECT 'seed' WHERE NOT EXISTS (SELECT 1 FROM accounts);
```

The condition must be boolean or NULL; `SELECT 5 WHERE 1` and
`SELECT 5 WHERE 'true'` fail with CADB0400. Projection expressions do not run
when the filter drops the row. However, constant division by zero is checked
before execution: `SELECT 1 / 0 WHERE FALSE` fails with CADB0400. See
[statement checks](/docs/data-types#errors-before-reading-rows).

With WHERE, the query uses a one-row source, supports EXPLAIN (ANALYZE), and
can be an INSERT ... SELECT or CTAS source or a set-operation operand.
Sequence calls in this form are refused with CADB0547 unless the filter drops
the row before the call runs; `SELECT nextval('s') WHERE FALSE` draws nothing.

## Subqueries in the projection

When a `SELECT` without a `FROM` clause has a subquery in its projection,
CamusDB evaluates the subquery first and replaces it with its scalar result.
The `EXISTS` example at the top of this page works that way, and `NOT EXISTS`
works too:

```camussql
SELECT NOT EXISTS (
  SELECT 1
  FROM accounts
  WHERE email = 'nobody@example.com'
);
```

You can compare a scalar subquery or return it directly:

```camussql
SELECT (SELECT COUNT(*) FROM accounts) > 0;

SELECT (SELECT COUNT(*) FROM accounts);
```

The subquery can also read from a derived table:

```camussql
SELECT (
  SELECT COUNT(*)
  FROM (
    SELECT 1
    FROM accounts
    WHERE email = @email
  ) AS matched
) > 0;
```

A `SELECT` without a `FROM` clause has no outer row, so these subqueries are
never correlated. A SELECT with a FROM clause also supports uncorrelated
projection subqueries. Correlated EXISTS is limited to the WHERE of a SELECT;
see [subquery positions](/docs/joins-and-subqueries#subqueries-in-where).

## Inside another statement

A SELECT without FROM also works as a scalar or IN subquery, a derived
table, or a stored view body:

```camussql
SELECT (SELECT 1);                         -- 1
SELECT (SELECT 1 WHERE FALSE);             -- NULL
SELECT x FROM (SELECT 5 AS x) d;           -- 5
CREATE VIEW readiness AS SELECT 'ready' AS status;
```

The same WHERE, LIMIT, and OFFSET rules apply. Aggregates and ORDER BY remain
unsupported, and a sequence call in a nested SELECT is refused with CADB0547.
A FROM-less subquery cannot reference an outer column yet.

CREATE VIEW binds a plain expression without evaluating it: a body such as
`SELECT 1 / 0 AS x` is accepted, and reading the view fails. A subquery in a
view body can still execute while the body is bound.

## Rejected shapes

A `SELECT` without a `FROM` clause is limited by design: it evaluates a
projection and accepts optional WHERE, LIMIT, and OFFSET clauses.

| Query shape | Result |
| --- | --- |
| `SELECT *` | CamusDB rejects it, because `*` needs a table source. |
| `SELECT COUNT(*)` | CamusDB rejects it, because an aggregate needs a table source. Use a scalar subquery instead, such as `SELECT (SELECT COUNT(*) FROM accounts)`. |
| `SELECT 1 GROUP BY ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 HAVING ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 ORDER BY ...` | CamusDB rejects it. There is only one synthetic row. |
| `SELECT * WHERE ...` or `SELECT COUNT(*) WHERE ...` | Refused for the same reasons as their unfiltered forms. |
| `SELECT missing_name` | It fails with `UnknownColumn`, because CamusDB cannot resolve the identifier. |

## EXPLAIN

Without WHERE, a plain EXPLAIN of a SELECT without FROM returns a fixed plan
shape:

```camussql
EXPLAIN SELECT 41 + 1 AS answer;
```

Typical output:

```text
physical  project          answer
physical  constant-source  1 row
```

The plan includes a `limit` node when the query has a `LIMIT` or an `OFFSET`.

Without WHERE, EXPLAIN (ANALYZE) is refused. With WHERE, the one-row source
appears as `function-scan` (`*single_row*`), and ANALYZE executes the filter and
projection.
