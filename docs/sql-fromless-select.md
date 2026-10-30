---
sidebar_position: 2.45
---

# SELECT without FROM

A `SELECT` without a `FROM` clause evaluates its projection list against one
synthetic row, so it returns exactly one row:

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
never correlated. A correlated subquery in the projection of a `SELECT` that
reads a table is a different query shape.

## Rejected shapes

A `SELECT` without a `FROM` clause is limited by design: it evaluates a
projection and accepts an optional `LIMIT` and `OFFSET`.

| Query shape | Result |
| --- | --- |
| `SELECT *` | CamusDB rejects it, because `*` needs a table source. |
| `SELECT COUNT(*)` | CamusDB rejects it, because an aggregate needs a table source. Use a scalar subquery instead, such as `SELECT (SELECT COUNT(*) FROM accounts)`. |
| `SELECT 1 WHERE ...` | CamusDB rejects it. Add a `FROM` clause when you need a `WHERE` clause. |
| `SELECT 1 GROUP BY ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 HAVING ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 ORDER BY ...` | CamusDB rejects it. There is only one synthetic row. |
| `SELECT missing_name` | It fails with `UnknownColumn`, because CamusDB cannot resolve the identifier. |

## EXPLAIN

A plain `EXPLAIN` of a `SELECT` without a `FROM` clause returns a fixed plan
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

CamusDB rejects `EXPLAIN (ANALYZE)` for a `SELECT` without a `FROM` clause,
because there is no table access to measure. Use a plain `EXPLAIN` for these
queries.
