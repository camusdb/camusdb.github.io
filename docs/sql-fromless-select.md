---
sidebar_position: 2.45
---

# FROM-less SELECT

CamusDB supports `SELECT` statements without a `FROM` clause. The statement
evaluates the projection list against one synthetic row, so it returns exactly
one row unless `LIMIT` / `OFFSET` skips it.

This is useful for application probes, ORM-generated utility SQL, parameter
checks, scalar function calls, casts, and simple existence checks that do not
need an outer table.

## Supported Forms

Evaluate scalar expressions:

```camussql
SELECT 1 + 1;
SELECT upper("abc");
SELECT CAST("5" AS INT64);
SELECT regexp_split_to_array("one,two,three", ",");
```

Bind parameters:

```camussql
SELECT @value;
```

Return multiple projections:

```camussql
SELECT 41 + 1 AS answer, "ok" AS status;
```

When a projection is not aliased, CamusDB uses ordinal column names such as
`0`, `1`, and `2`.

Use `LIMIT` and `OFFSET` to keep or skip the single synthetic row:

```camussql
SELECT 1 LIMIT 0;
SELECT 1 LIMIT 1 OFFSET 1;
```

Both examples return zero rows.

## Projection Subqueries

A subquery inside the projection of a FROM-less `SELECT` is evaluated first and
then replaced with its scalar result:

```camussql
SELECT EXISTS (
  SELECT 1
  FROM accounts
  WHERE email = @email
);
```

`NOT EXISTS` is also supported:

```camussql
SELECT NOT EXISTS (
  SELECT 1
  FROM accounts
  WHERE email = "nobody@example.com"
);
```

Scalar subqueries can be compared or returned directly:

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

Because a FROM-less `SELECT` has no outer row, these projection subqueries are
uncorrelated. Correlated projection subqueries in table-backed `SELECT`
statements are a separate query shape.

## Rejected Shapes

FROM-less `SELECT` is intentionally limited to projection evaluation plus
optional `LIMIT` and `OFFSET`.

| Query shape | Result |
| --- | --- |
| `SELECT *` | Rejected because `*` requires a table source. |
| `SELECT COUNT(*)` | Rejected because aggregates require a table source. Use a scalar subquery such as `SELECT (SELECT COUNT(*) FROM accounts)`. |
| `SELECT 1 WHERE ...` | Rejected. Add a `FROM` clause when you need `WHERE`. |
| `SELECT 1 GROUP BY ...` | Rejected. Aggregation requires a table source. |
| `SELECT 1 HAVING ...` | Rejected. Aggregation requires a table source. |
| `SELECT 1 ORDER BY ...` | Rejected. There is only one synthetic row. |
| `SELECT missing_name` | Fails with `UnknownColumn` because the identifier cannot be resolved. |

## EXPLAIN

Plain `EXPLAIN` for a FROM-less `SELECT` returns a fixed plan shape:

```camussql
EXPLAIN SELECT 41 + 1 AS answer;
```

Typical output shape:

```text
physical  project          answer
physical  constant-source  1 row
```

When `LIMIT` or `OFFSET` is present, a `limit` node is included.

`EXPLAIN (ANALYZE)` is rejected for FROM-less `SELECT` because there is no table
access to measure. Use plain `EXPLAIN` for this query shape.
