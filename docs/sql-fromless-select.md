---
sidebar_position: 2.45
---

# SELECT without FROM

A `SELECT` without a `FROM` clause evaluates its list of projections against one
synthetic row. It therefore returns exactly one row:

```camussql
SELECT 1 + 1;
```

You usually use this form without a thought about it. Three examples follow:

- A probe of the health of a connection.
- A check of a cast.
- The utility SQL that an ORM emits on its own.

It is also the shortest way to ask the database a question with a yes or a no
answer:

```camussql
SELECT EXISTS (SELECT 1 FROM accounts WHERE email = @email);
```

## The supported forms

Evaluate a scalar expression:

```camussql
SELECT 1 + 1;
SELECT upper("abc");
SELECT CAST("5" AS INT64);
SELECT CASE WHEN 1 = 1 THEN "ok" ELSE "fail" END;
SELECT regexp_split_to_array("one,two,three", ",");
```

Bind a parameter:

```camussql
SELECT @value;
```

Return several projections:

```camussql
SELECT 41 + 1 AS answer, "ok" AS status;
```

A projection can have no alias. CamusDB then uses the ordinal names of the
columns, such as `0`, `1`, and `2`.

Use `LIMIT` and `OFFSET` to keep or to skip the one synthetic row:

```camussql
SELECT 1 LIMIT 0;
SELECT 1 LIMIT 1 OFFSET 1;
```

Both examples return zero rows.

## A subquery in a projection

CamusDB evaluates a subquery inside the projection of a `SELECT` without a
`FROM` clause first. It then replaces the subquery with its scalar result:

```camussql
SELECT EXISTS (
  SELECT 1
  FROM accounts
  WHERE email = @email
);
```

`NOT EXISTS` also works:

```camussql
SELECT NOT EXISTS (
  SELECT 1
  FROM accounts
  WHERE email = "nobody@example.com"
);
```

You can compare a scalar subquery. You can also return it directly:

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

A `SELECT` without a `FROM` clause has no outer row. Such a subquery in a
projection is therefore not correlated. A correlated subquery in the projection
of a `SELECT` with a table is a different shape of query.

## The rejected shapes

A `SELECT` without a `FROM` clause is limited by design. It evaluates a
projection, and it accepts an optional `LIMIT` and an optional `OFFSET`.

| Shape of the query | Result |
| --- | --- |
| `SELECT *` | CamusDB rejects it, because `*` needs a table source. |
| `SELECT COUNT(*)` | CamusDB rejects it, because an aggregate needs a table source. Use a scalar subquery instead, such as `SELECT (SELECT COUNT(*) FROM accounts)`. |
| `SELECT 1 WHERE ...` | CamusDB rejects it. Add a `FROM` clause when you need a `WHERE` clause. |
| `SELECT 1 GROUP BY ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 HAVING ...` | CamusDB rejects it. An aggregation needs a table source. |
| `SELECT 1 ORDER BY ...` | CamusDB rejects it. There is only one synthetic row. |
| `SELECT missing_name` | It fails with `UnknownColumn`, because CamusDB cannot resolve the identifier. |

## EXPLAIN

A plain `EXPLAIN` of a `SELECT` without a `FROM` clause returns a fixed shape of
plan:

```camussql
EXPLAIN SELECT 41 + 1 AS answer;
```

The output has this typical shape:

```text
physical  project          answer
physical  constant-source  1 row
```

The plan includes a `limit` node when the query has a `LIMIT` or an `OFFSET`.

CamusDB rejects `EXPLAIN (ANALYZE)` for a `SELECT` without a `FROM` clause.
There is no access to a table to measure. Use a plain `EXPLAIN` for this shape
of query.
