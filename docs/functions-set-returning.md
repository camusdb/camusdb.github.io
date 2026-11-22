---
sidebar_position: 4.35
---

# Set-returning functions

A set-returning function returns rows. You use it in the `FROM` clause, where it
works like a table with one column. For example, you can generate test data, or
create one row for each number in a range.

CamusDB provides `generate_series`:

```camussql
SELECT *
FROM generate_series(1, 5);
```

```text
┌─────────────────┐
│ generate_series │
├─────────────────┤
│ 1               │
│ 2               │
│ 3               │
│ 4               │
│ 5               │
└─────────────────┘
5 rows in set (00:00:00.0305745)
```

The following statement inserts 10,000 rows:

```camussql
INSERT INTO scores (id, score)
SELECT i, i * 10
FROM generate_series(1, 10000) AS i;
```

## generate_series

```camussql
generate_series(start, stop)
generate_series(start, stop, step)
```

The arguments and the result column are `INT64`. The default step is `1`. The
series includes the stop value when it lands on it exactly.

| Call | Rows |
| --- | --- |
| `generate_series(1, 5)` | `1, 2, 3, 4, 5` |
| `generate_series(5, 1, -2)` | `5, 3, 1` |
| `generate_series(1, 10, 3)` | `1, 4, 7, 10` |
| `generate_series(1, 4, 2)` | `1, 3` |
| `generate_series(7, 7)` | `7` |
| `generate_series(1, 0)` | No rows. |
| `generate_series(1, NULL)` | No rows. |
| `generate_series(1, 5, 0)` | `CADB0400`. The step can't be zero. |

A negative step counts down. If the step points away from the stop value, the
function returns no rows. If the next value would overflow `INT64`, the series
ends there.

An argument can be any integer expression, including a parameter:

```camussql
SELECT n
FROM generate_series(1 + 1, @last, abs(@step)) AS n;
```

An argument can also read the columns of a table to its left in `FROM`. The
function is then called once for each row of that table, with or without the
`LATERAL` keyword. The following example uses a `tasks` table:

<details>
<summary>Sample data for this example</summary>

```camussql
CREATE TABLE tasks (
  id INT64 PRIMARY KEY,
  name STRING NOT NULL,
  repetitions INT64 NOT NULL
);

INSERT INTO tasks (id, name, repetitions) VALUES
  (1, 'Send reminder email', 3),
  (2, 'Rotate API key', 1),
  (3, 'Archive old logs', 0);
```

</details>

```camussql
SELECT t.id, n FROM tasks AS t, generate_series(1, t.repetitions) AS n;
```

```text
┌────┬───┐
│ id │ n │
├────┼───┤
│ 1  │ 1 │
│ 1  │ 2 │
│ 1  │ 3 │
│ 2  │ 1 │
└────┴───┘
4 rows in set (00:00:00.0086141)
```

Task 3 has zero repetitions. Its series is empty, and the result doesn't
include task 3.

In a subquery, an argument can also read a column of the outer query, as in
`EXISTS (SELECT 1 FROM generate_series(1, t.n) AS g WHERE g = 2)`. For the scope
and join rules, see [LATERAL sources](/docs/joins-and-subqueries#lateral).

## Aliases

If you don't give an alias, the relation and its column are both named
`generate_series`. A
relation alias is also the default column name:

```camussql
SELECT i
FROM generate_series(1, 3) AS i;
```

```text
┌───┐
│ i │
├───┤
│ 1 │
│ 2 │
│ 3 │
└───┘
3 rows in set (00:00:00.0010521)
```

To name the column, add a column alias:

```camussql
SELECT s.value
FROM generate_series(1, 3) AS s(value);
```

```text
┌───────┐
│ value │
├───────┤
│ 1     │
│ 2     │
│ 3     │
└───────┘
3 rows in set (00:00:00.0014245)
```

The column alias list must have exactly one name.

## Where you can use it

You can use `generate_series` in any place where a table can be:

- Alone, or in any join.
- In a derived table, a view, a materialized view, or an `IN` or `EXISTS`
  subquery.
- As the source of `INSERT ... SELECT` or `CREATE TABLE ... AS SELECT`.
- With `WHERE`, `GROUP BY`, `ORDER BY`, `DISTINCT`, `LIMIT`, and `OFFSET`.

The rows are streamed. A `LIMIT 10` over a very large series stops after ten
rows. The function doesn't read a table or take locks, and it doesn't need a
privilege. A table that you join to it needs its usual privileges.

`EXPLAIN` shows the function as a `function-scan`. With literal arguments, the
row estimate is exact. With a parameter or a function call as an argument, the
planner uses its default estimate.

In a cluster, the series is generated on the node that executes the statement.

## Row limit {#row-limit}

One read of a function in `FROM` can return at most `max_table_function_rows`
rows (default `5000000`). The count includes the rows that `WHERE` removes
later. A join that reads the function again starts a new count. The limit
applies to `generate_series`, the JSON table functions, and extension table
functions.

The next row after the limit returns `CADB0561 TableFunctionRowLimitExceeded`.
A retry with the same input will fail again. Make the range smaller, or change
this [runtime cluster setting](/docs/runtime-cluster-settings). A value of `0`
or less turns off the limit.

A `LIMIT` that stops the read early prevents the error. However, a `LIMIT`
after a sort or an aggregate can't stop the read, because the sort or
the aggregate needs all the input rows. For example,
`SELECT n FROM generate_series(1, 1000000000) AS n LIMIT 10` returns ten rows,
but a `COUNT(*)` of that series reaches the limit.

## Current limits

- A set-returning function must be in `FROM`. In the `SELECT` list, it returns
  `CADB0533`.
- Only integer series are available. A date argument returns `CADB0400`.
- `WITH ORDINALITY` and `unnest` aren't supported. The JSON and extension table
  functions have their own reference pages.
- An `INSERT ... SELECT` from a series is one transaction, and the
  [transaction mutation limit](/docs/transaction-limits) applies to it.
