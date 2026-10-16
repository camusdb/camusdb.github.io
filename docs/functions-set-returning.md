---
sidebar_position: 4.35
---

# Set-returning functions

A set-returning function produces rows instead of one scalar value. CamusDB
accepts these functions in the `FROM` clause, where they behave like a
one-column relation.

CamusDB currently provides `generate_series`:

```camussql
SELECT *
FROM generate_series(1, 5);

INSERT INTO scores (id, score)
SELECT i, i * 10
FROM generate_series(1, 10000) AS i;
```

## generate_series

```camussql
generate_series(start, stop)
generate_series(start, stop, step)
```

All arguments and the result column are `INT64`. The default step is `1`.
The stop value is included when the series lands on it exactly.

| Call | Rows |
| --- | --- |
| `generate_series(1, 5)` | `1, 2, 3, 4, 5` |
| `generate_series(5, 1, -2)` | `5, 3, 1` |
| `generate_series(1, 10, 3)` | `1, 4, 7, 10` |
| `generate_series(1, 4, 2)` | `1, 3` |
| `generate_series(7, 7)` | `7` |
| `generate_series(1, 0)` | No rows. |
| `generate_series(1, NULL)` | No rows. |
| `generate_series(1, 5, 0)` | An error, because a step cannot be zero. |

A negative step counts downward. A step pointing away from the stop value
returns no rows. When calculating the next value would overflow `INT64`, the
series ends instead of wrapping around.

Arguments can be literals, parameters, expressions, or scalar function calls:

```camussql
SELECT n
FROM generate_series(1 + 1, @last, abs(@step)) AS n;
```

CamusDB evaluates each argument once before producing the first row. A column
from another relation and a subquery are not accepted as arguments. Those forms
would require a lateral table function, which is not supported yet.

## Aliases

Without an alias, both the relation and its column are named
`generate_series`. A relation alias also becomes the default column name:

```camussql
SELECT i
FROM generate_series(1, 3) AS i;

SELECT s.value
FROM generate_series(1, 3) AS s(value);
```

A column alias list must contain exactly one name.

## Where it can be used

`generate_series` can appear anywhere a relation can appear:

- Alone, in a comma join, or in an explicit inner, outer, or cross join.
- Inside a derived table, view, materialized view, `IN`, or `EXISTS` subquery.
- As the source of `INSERT ... SELECT` or `CREATE TABLE ... AS SELECT`.
- With filtering, grouping, ordering, `DISTINCT`, `LIMIT`, and `OFFSET`.

The rows are streamed. A `LIMIT 10` over a very large series can stop after ten
rows without materializing the complete series. The function reads no table,
takes no storage lock, and requires no privilege. Tables joined to it still
require their normal privileges.

`EXPLAIN` renders the source as a `function-scan`. Literal arguments give the
planner an exact row estimate. Parameters and function-call arguments use the
default relation estimate.

The function runs on the node executing the statement. It is not sent to peers
as a distributed scan fragment. When it becomes the build side of a broadcast
join, CamusDB ships the generated rows.

## Current limits

- A set-returning function belongs in `FROM`, not in the `SELECT` list.
- Only an integer `generate_series` is currently available. Date, timestamp,
  and `NUMERIC` series are not supported.
- `LATERAL`, `WITH ORDINALITY`, and other table functions such as `unnest` are
  not supported yet.
- An `INSERT ... SELECT` from a series is one transaction and remains subject
  to the [transaction mutation limit](/docs/transaction-limits).

