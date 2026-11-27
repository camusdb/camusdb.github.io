---
sidebar_position: 2.4
description: "Read and shape rows with SELECT in CamusDB: filter, sort, paginate, group, combine query results, compute window functions, and lock rows before an update."
---

# SELECT

`SELECT` reads rows and shapes the result, from a simple filter to grouped
reports and window functions.

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC
LIMIT 25;
```

This page covers queries on one table and the clauses that shape them. Other
forms have their own pages.

- [Joins and subqueries](/docs/joins-and-subqueries), including derived tables.
- [SELECT without FROM](/docs/sql-fromless-select), such as `SELECT 1 + 1`.
- [Time-travel reads](/docs/time-travel-reads), for a past snapshot.

The examples on this page use the following data:

<details>
<summary>Sample data for the examples on this page</summary>

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024),
  enabled BOOL NOT NULL,
  status STRING NOT NULL
);
CREATE INDEX robots_year_idx ON robots (year);
INSERT INTO robots (id, name, kind, year, enabled, status) VALUES
  (GEN_ID(), 'R2-D2', 'utility', 1977, true, 'active'),
  (GEN_ID(), 'C-3PO', 'protocol', 1977, true, 'active'),
  (GEN_ID(), 'T-800', 'android', 1984, false, 'archived'),
  (GEN_ID(), 'K-2SO', 'security', 2024, true, 'active'),
  (GEN_ID(), 'T-1000', 'android', 1991, false, 'archived'),
  (GEN_ID(), 'BB-8', 'utility', 2015, true, 'active');

CREATE TABLE app_users (
  id INT64 PRIMARY KEY NOT NULL,
  username STRING NOT NULL,
  role STRING NOT NULL,
  department STRING NOT NULL
);
INSERT INTO app_users (id, username, role, department) VALUES
  (1, 'alice', 'admin', 'engineering'),
  (2, 'bob', 'editor', 'marketing'),
  (3, 'carol', 'editor', 'engineering'),
  (4, 'dave', 'viewer', 'sales'),
  (5, 'erin', 'editor', 'marketing'),
  (6, 'frank', 'viewer', 'engineering');

CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  customer_id INT64 NOT NULL,
  total NUMERIC NOT NULL,
  status STRING NOT NULL
);
INSERT INTO orders (id, customer_id, total, status) VALUES
  (1, 1, 250, 'paid'),
  (2, 2, 1200, 'paid'),
  (3, 3, 80, 'pending'),
  (4, 1, 900, 'paid'),
  (5, 2, 300, 'pending'),
  (6, 3, 150, 'paid'),
  (7, 1, 400, 'paid'),
  (8, 1, 120, 'pending');

CREATE TABLE categories (
  id INT64 PRIMARY KEY NOT NULL,
  parent_id INT64,
  name STRING NOT NULL
);
INSERT INTO categories (id, parent_id, name) VALUES
  (1, NULL, 'Electronics'),
  (2, 1, 'Computers'),
  (3, 2, 'Laptops'),
  (4, 1, 'Phones'),
  (5, NULL, 'Home'),
  (6, 5, 'Kitchen');

CREATE TABLE current_orders (id INT64 PRIMARY KEY NOT NULL, customer_id INT64 NOT NULL);
CREATE TABLE archived_orders (id INT64 PRIMARY KEY NOT NULL, customer_id INT64 NOT NULL);
INSERT INTO current_orders (id, customer_id) VALUES (101, 1), (102, 2), (103, 1);
INSERT INTO archived_orders (id, customer_id) VALUES (51, 2), (52, 4), (53, 4);

CREATE TABLE campaign_members (customer_id INT64 PRIMARY KEY NOT NULL);
CREATE TABLE email_opt_outs (customer_id INT64 PRIMARY KEY NOT NULL);
INSERT INTO campaign_members (customer_id) VALUES (1), (2), (3), (5);
INSERT INTO email_opt_outs (customer_id) VALUES (2), (5);

CREATE TABLE users (id INT64 PRIMARY KEY, username STRING NOT NULL, status STRING NOT NULL);
INSERT INTO users (id, username, status) VALUES
  (1, 'alice_1', 'A'), (2, 'b', 'B'), (3, '9lives', 'X');

CREATE TABLE products (sku STRING PRIMARY KEY);
INSERT INTO products (sku) VALUES ('AB-1'), ('A B');

CREATE TABLE inventory (sku STRING PRIMARY KEY, quantity INT64 NOT NULL);
INSERT INTO inventory (sku, quantity) VALUES ('AB-1', 10);

CREATE TABLE jobs (id INT64 PRIMARY KEY, state STRING NOT NULL);
INSERT INTO jobs (id, state) VALUES (1, 'ready'), (2, 'ready'), (3, 'ready'), (4, 'done');
```

</details>

## Clause order

Write the clauses in this order.

```camussql
SELECT   [DISTINCT] projections
FROM     source [AS OF SYSTEM TIME ...] [@{hint}]
WHERE    row_filter
GROUP BY keys
HAVING   group_filter
ORDER BY sort_keys
LIMIT    n OFFSET m
```

`WHERE` filters the input rows before grouping, and `HAVING` filters the groups
after it. [Window functions](#window-functions) are computed next. After them,
the projection and `DISTINCT` are applied.

The final `ORDER BY` and the pagination apply last, to the projected result.
This means that they can use output aliases.

## Select the columns

```camussql
SELECT * FROM robots;
SELECT id, name FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT upper(trim(name)) AS display_name FROM robots;
```

You can select any scalar expression, including function calls and arithmetic.
For the functions, see [Functions](/docs/functions).

`AS` names an output column. An unnamed column gets a name from its select item.

| Select item | Output name |
| --- | --- |
| A column | The column name. |
| A scalar subquery | The name of its inner column. |
| Another expression, such as a function call or an aggregate | Its zero-based position in the select list, such as `0`. |

Note that this differs from PostgreSQL, which uses the function name or
`?column?`. Give a computed column an alias if something reads it by name, such
as a view or a client.

### DISTINCT

`DISTINCT` removes duplicate output rows after the projection. Two `NULL` values
count as equal.

```camussql
SELECT DISTINCT kind FROM robots ORDER BY kind;
```

```text
┌──────────┐
│ kind     │
├──────────┤
│ android  │
│ protocol │
│ security │
│ utility  │
└──────────┘
4 rows in set (00:00:00.0283460)
```

```camussql
SELECT DISTINCT kind, year FROM robots ORDER BY kind, year;
```

```text
┌──────────┬──────┐
│ kind     │ year │
├──────────┼──────┤
│ android  │ 1984 │
│ android  │ 1991 │
│ protocol │ 1977 │
│ security │ 2024 │
│ utility  │ 1977 │
│ utility  │ 2015 │
└──────────┴──────┘
6 rows in set (00:00:00.0012607)
```

`android` and `utility` appear twice. `DISTINCT` compares the full row.

Three forms aren't supported.

| Form | Result |
| --- | --- |
| `COUNT(DISTINCT column)` | A syntax error, `CADB0406`. |
| `SELECT DISTINCT ... GROUP BY ...` | `CADB0400`. Grouping already returns distinct keys. |
| `SELECT DISTINCT COUNT(*)` | `CADB0400`. |

When a `NOT NULL` index covers the distinct columns, the planner reads the
distinct values from that index, and it doesn't build a hash table.
[`EXPLAIN`](/docs/explain) shows which path is used.

### CASE expressions

`CASE` picks a value based on conditions. The searched form checks its
conditions in order.

```camussql
SELECT
  name,
  CASE
    WHEN year < 1980 THEN 'classic'
    WHEN year >= 1980 THEN 'modern'
    ELSE 'unknown'
  END AS era
FROM robots;
```

```text
┌────────┬─────────┐
│ name   │ era     │
├────────┼─────────┤
│ R2-D2  │ classic │
│ C-3PO  │ classic │
│ T-800  │ modern  │
│ K-2SO  │ modern  │
│ T-1000 │ modern  │
│ BB-8   │ modern  │
└────────┴─────────┘
6 rows in set (00:00:00.0023885)
```

The simple form compares one expression with each `WHEN` value.

```camussql
SELECT
  status,
  CASE status
    WHEN 'A' THEN 'active'
    WHEN 'B' THEN 'blocked'
    ELSE 'other'
  END AS status_name
FROM users;
```

The first match wins. A `WHEN` condition that is `NULL` doesn't match. If no
condition matches and there's no `ELSE`, the result is `NULL`.

`CASE` is a scalar expression. You can use it where a scalar expression is
allowed, including in an aggregate. This is the usual way to write a
conditional total.

```camussql
SELECT SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) AS paid_total
FROM orders;
```

All result branches must have a
[common type](/docs/data-types#conditional-result-types), including branches
that aren't used. Otherwise, the statement returns `CADB0400`. For a short
boolean condition, use [`IF(condition, a, b)`](/docs/functions-null#if).

`CASE` and `END` are reserved keywords. To use one as a column name, see
[Backticks](/docs/sql#backticks).

## Filter the rows

```camussql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE 'r%';

SELECT *
FROM robots
WHERE enabled OR year IS NULL;

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004;
```

| Category | Operators |
| --- | --- |
| Comparison | `=`, `!=`, `<`, `>`, `<=`, `>=`, `BETWEEN ... AND ...` |
| Boolean | `AND` / `OR` / a boolean column, such as `WHERE enabled` |
| Pattern matching | `LIKE`, `ILIKE`, `~`, `~*`, `!~`, `!~*` |
| Null checks | `IS NULL`, `IS NOT NULL` |
| Membership | `IN (...)`, `NOT IN (...)`, `IN (SELECT ...)`, `NOT IN (SELECT ...)` |
| Existence | `EXISTS (SELECT ...)` |

A condition, such as in `WHERE` or `JOIN ... ON`, must be boolean or `NULL`. A
number or a string isn't read as true or false, and it returns `CADB0400`. For
more information, see
[statement checks](/docs/data-types#errors-before-reading-rows).

`BETWEEN` includes both bounds. For example, `year BETWEEN 2001 AND 2004`
includes 2001 and 2004.

### Pattern matching

`LIKE` and `ILIKE` match the full value. `%` matches any number of characters,
and `_` matches one Unicode code point. `ILIKE` ignores case, also for
non-ASCII letters. A backslash escapes a wildcard, and `ESCAPE` selects another
escape character. For more information, see
[LIKE patterns](/docs/sql-expression-syntax#like-and-ilike-patterns).

Use a regular expression operator when wildcards aren't enough.

| Operator | Matches | Case |
| --- | --- | --- |
| `~` | A regular expression | Sensitive |
| `~*` | A regular expression | Insensitive |
| `!~` | A negated regular expression | Sensitive |
| `!~*` | A negated regular expression | Insensitive |

```camussql
SELECT username
FROM users
WHERE username ~ '^[a-zA-Z][a-zA-Z0-9_]{2,29}$';

SELECT sku
FROM products
WHERE sku !~ '\s';
```

A pattern can match at any position in the value. Use `^` and `$` to match the
full value.

Both operands must be strings. A number returns `CADB0407`. When an operand is
`NULL`, the result is unknown. The row doesn't pass a `WHERE` clause.

Patterns use the .NET regular expression syntax. Case-insensitive matching uses
the invariant culture. Note that POSIX classes such as `[[:alpha:]]` aren't
supported. They return no error, but they don't match letters. Use `\p{L}` or
`[a-zA-Z]`.

A malformed pattern returns `CADB0400 InvalidInput`. Each match has an internal
timeout. This means that a pathological pattern returns an error, and it
doesn't hang.

To extract or replace text with a regular expression, see
[Regex functions](/docs/functions-regex).

### IN lists

```camussql
SELECT id, name FROM robots WHERE year IN (2020, 2022, 2024);
SELECT id, name FROM robots WHERE status NOT IN ('deleted', 'archived');
SELECT id, name FROM robots WHERE id IN (@id1, @id2, @id3);
```

On an indexed column, the planner turns a value list into index lookups. This
is faster than a scan for small and medium lists.

`NOT IN` follows the SQL rules for `NULL`. If the list or the subquery has a
`NULL`, the comparison is unknown for each value that matches no other item.
These rows are filtered out. For example,
`SELECT name FROM categories WHERE id NOT IN (SELECT parent_id FROM categories)`
returns no rows. The `parent_id` column has `NULL` values.

`IN` also takes a subquery. For more information, see
[Joins and subqueries](/docs/joins-and-subqueries).

## Sort and paginate {#sort-the-rows-and-divide-them-into-pages}

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

`ASC` is the default. In ascending order, `NULL` values come first. In
descending order, they come last. This is the opposite of the PostgreSQL
default, and it also applies to window ordering. `NULLS FIRST` and `NULLS LAST`
aren't supported.

An output position in `ORDER BY` counts the columns that `*` expands to. For
example, in `SELECT *, year + 1 AS next_year FROM robots ORDER BY 2`, `2` is the
second column of `*`, which is `name`.

`LIMIT` and `OFFSET` take an integer literal or a placeholder, such as
`LIMIT @limit`. A negative value returns `CADB0400`. This applies to all
statements that have a `LIMIT`, such as a nested query or an `UPDATE`.

In a grouped query, `ORDER BY` can use an aggregate, by its alias or by its
expression. It can also use a grouped expression.

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY cnt DESC, role;
```

An alias in `ORDER BY` takes precedence over a table column with the same name.
If two output columns have the same name and different expressions,
`ORDER BY name` is ambiguous. It returns `CADB0400`, even with `LIMIT 0`. Use
unique aliases, or a 1-based position such as `ORDER BY 2`. The same column
selected twice isn't ambiguous.

In a query that doesn't have `GROUP BY`, `ORDER BY` can also use a column that
the select list doesn't include.

Two `ORDER BY` forms return `CADB0400`.

- A table column in a query that has an aggregate and no `GROUP BY`, such as
  `SELECT COUNT(*) AS c FROM robots ORDER BY year`. Sort by the alias or by a
  position.
- In a grouped query, an expression that is in neither the select list nor
  `GROUP BY`. The rows are sorted after the projection. Select the value, and
  sort by its alias.

If an index gives the requested order, the sort is skipped. This means that
`ORDER BY` with `LIMIT` on an indexed column is much cheaper than a sort of the
table. For more information, see [Query planning](/docs/query-planning).

## Parameters

Placeholders can stand in for values in filters and pagination.

```camussql
SELECT id, name
FROM robots
WHERE id = @id
LIMIT @limit;
```

The client that sends the statement binds the values. For more information, see
[Parameters and prepared statements](/docs/prepared-statements).

## Aggregate the rows

| Function | Result |
| --- | --- |
| `COUNT(*)` | The number of rows. |
| `COUNT(column)` | The number of non-null values. |
| `SUM(column)` | The sum of the non-null values. `NUMERIC` input returns `NUMERIC`, `INT64` returns `INT64`, and `FLOAT64` returns `FLOAT64`. |
| `AVG(column)` | The average of the non-null values. `NUMERIC` input returns `NUMERIC`. Other input returns `FLOAT64`. |
| `MIN(column)` | The smallest non-null value. |
| `MAX(column)` | The largest non-null value. |

Without `GROUP BY`, an aggregate reduces the table to one row.

```camussql
SELECT COUNT(*), SUM(year), AVG(year), MIN(year), MAX(year)
FROM robots;
```

A column that isn't in `GROUP BY` can't be selected with an aggregate. For
example, `SELECT name, COUNT(*) FROM robots` returns `CADB0400`. Add
`GROUP BY name` to fix it.

### GROUP BY

`GROUP BY` takes columns and expressions.

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role;
```

```text
┌────────┬─────┐
│ role   │ cnt │
├────────┼─────┤
│ admin  │ 1   │
│ editor │ 3   │
│ viewer │ 2   │
└────────┴─────┘
3 rows in set (00:00:00.0003195)
```

```camussql
SELECT role, department, COUNT(*) AS cnt
FROM app_users
GROUP BY role, department;

SELECT year + 100 AS display_year
FROM robots
GROUP BY year + 100;
```

### HAVING

`HAVING` filters the groups after aggregation. It can use three kinds of item.

- An aggregate, by its alias, such as `cnt`, or by its expression.
- A group key, also with a table alias, such as `u.role`.
- An `IN` or `NOT IN` check, such as `HAVING COUNT(*) IN (1, 2)`.

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY role;
```

```text
┌────────┬─────┐
│ role   │ cnt │
├────────┼─────┤
│ editor │ 3   │
│ viewer │ 2   │
└────────┴─────┘
2 rows in set (00:00:00.0019345)
```

```camussql
SELECT COUNT(*) AS total
FROM robots
HAVING total > 0;
```

`HAVING` needs a `GROUP BY` or an aggregate in the select list. Otherwise, it
returns `CADB0400`. To filter the input rows, use `WHERE`. It's applied first,
and it gives the aggregate less work.

## WITH queries {#with-queries}

A common table expression (CTE) names a query for one statement. Use `WITH` to
split a report into steps, or to use an intermediate result more than once.

```camussql
WITH totals AS (
  SELECT customer_id, SUM(total) AS spent
  FROM orders GROUP BY customer_id
), big_customers (customer_id, spent) AS (
  SELECT customer_id, spent FROM totals WHERE spent > 1000
)
SELECT customer_id, spent FROM big_customers ORDER BY spent DESC;
```

```text
┌─────────────┬───────┐
│ customer_id │ spent │
├─────────────┼───────┤
│ 1           │ 1670  │
│ 2           │ 1500  │
└─────────────┴───────┘
2 rows in set (00:00:00.0282098)
```

A definition has the form
`name [(column_names)] AS [MATERIALIZED | NOT MATERIALIZED] (query)`. The query
can be any `SELECT`, including one with a set operation or another `WITH`.

A column list renames the columns in order. A shorter list doesn't change the
remaining names. A longer list returns `CADB0400`. If two output columns have
the same name, a reference to that name is ambiguous.

A CTE is visible to the later definitions and to the statement, including its
subqueries. It hides a table or view with the same name. In the body of the CTE
and in earlier definitions, the name refers to the table. An inner `WITH` can
hide an outer CTE name.

Two forms return `CADB0400`.

- The same CTE name twice in one `WITH`.
- An index hint on a CTE reference, such as `x@{FORCE_INDEX=...}`.

### Reuse and materialization

A CTE that the statement reads once is inlined, as a derived table. A CTE that
is read more than once is computed once, and the readers share its rows. To
choose, write `MATERIALIZED` to compute it once, or `NOT MATERIALIZED` to
compute it for each reader.

This matters for volatile functions. Two readers of a computed-once CTE see the
same `random()` values.

```camussql
WITH x AS MATERIALIZED (SELECT random() AS r)
SELECT a.r = b.r AS same FROM x a, x b;   -- true; NOT MATERIALIZED gives false
```

A computed-once CTE is computed in full before a reader gets rows, even if the
reader has a `LIMIT`. Its rows can [spill to disk](/docs/spill-to-disk), and
they're released when the statement ends. `EXPLAIN` marks a reader with
`computed_once=<name>`. For a large result that a reader reads in part,
`NOT MATERIALIZED` avoids the full computation.

A `WITH` in parentheses, for example in a subquery, is always inlined, also with
`MATERIALIZED`. Its query can depend on outer rows. In a view body, CTEs are
stored as derived tables. For more information, see
[Views](/docs/views#cte-bodies).

### Supported statements and limits

`WITH` can start a query or a write statement, such as `UPSERT`. It also works
in three other places.

- `INSERT INTO ... WITH ... SELECT` and `CREATE TABLE ... AS`.
- View and materialized view bodies.
- Subqueries, derived tables, and the operands of set operations.

The target of a write is a stored table. Its sources can read CTEs, also in
[joined writes](/docs/sql-writes#joined-writes).

`WITH` has four limits.

- A write in a CTE body, such as `AS (DELETE ... RETURNING ...)`, is a syntax
  error.
- `SELECT ... FOR UPDATE` can't read a CTE.
- A CTE that the statement doesn't use isn't checked. For example, an unknown
  table in an unused definition returns no error.
- Expansion is limited by the
  [statement nesting and size limits](/docs/statement-nesting-limit#cte-expansion).

### Recursive CTEs {#recursive-ctes}

`WITH RECURSIVE` walks a hierarchy, such as product categories or a reporting
line. Start with the root rows, and join the rows of each step to their
children.

```camussql
WITH RECURSIVE tree (id, depth) AS (
  SELECT id, 0 FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, t.depth + 1
  FROM tree AS t JOIN categories AS c ON c.parent_id = t.id
)
SELECT id, depth FROM tree ORDER BY depth, id;
```

```text
┌────┬───────┐
│ id │ depth │
├────┼───────┤
│ 1  │ 0     │
│ 5  │ 0     │
│ 2  │ 1     │
│ 4  │ 1     │
│ 6  │ 1     │
│ 3  │ 2     │
└────┴───────┘
6 rows in set (00:00:00.0069275)
```

Laptops (id 3) is under Computers (id 2), which is under Electronics (id 1).
This means that its depth is 2.

The definition must have the form `seed_query UNION [ALL] recursive_query`. The
seed query is computed once. Each recursive step reads the rows of the previous
step. The recursion ends when a step returns no rows.

`UNION ALL` returns duplicates. `UNION` drops the rows that were already
returned. This can end a walk over a graph with cycles, if the full rows repeat.
A depth or path column makes each row different, and then you need a condition
that ends the recursion.

The recursive term has four rules.

- It must read the CTE once in its `FROM` sources, directly or through a
  derived table.
- It can't read the CTE in an expression subquery, on the nullable side of an
  outer join, or in the restricted operands of `INTERSECT ALL` and `EXCEPT`.
- The `SELECT` that reads the CTE can't use an aggregate, which returns
  `CADB0400`. An outer `SELECT` over a derived table can aggregate. Windows and
  the other clauses, such as `GROUP BY`, are supported.
- The `UNION` between the terms can't have trailing clauses, such as `ORDER BY`
  or `LIMIT`. A recursive term in parentheses can have them.

In `WITH RECURSIVE`, a definition can read a later CTE, and its name hides a
table with the same name. Mutual recursion between CTEs isn't supported.

The seed columns set the result types. An untyped `NULL` or a bare parameter in
the seed becomes `STRING`. Cast a seed expression to the type that the
recursive term needs.

With one reader, the rows are returned as the steps produce them, and a `LIMIT`
can stop the recursion early. With more than one reader, the full result is
computed first, and an outer `LIMIT` doesn't stop the recursion. The work
tables can spill to disk. The duplicate set of `UNION` is kept in memory.

| Setting | Default | Limit |
| --- | --- | --- |
| `max_recursive_cte_iterations` | `10000` | The recursive steps that return rows. |
| `max_recursive_cte_rows` | `10000000` | The output rows of one query, including the seed rows. |

A query over either limit returns `CADB0560 RecursiveQueryLimitExceeded`. Both
are runtime cluster settings, and `0` turns a limit off. For a graph walk, use
a condition that ends the recursion.

`EXPLAIN` shows `recursive-union` and `work-table-scan`. `EXPLAIN (ANALYZE)`
doesn't count the rows of each term separately.

The PostgreSQL `SEARCH` and `CYCLE` clauses and `CREATE RECURSIVE VIEW` aren't
supported. A view body can use `WITH RECURSIVE`.

## Combine query results {#set-operations}

Use a set operation to combine the rows of separate queries in SQL. For
example, you can combine current and archived orders, or exclude customers who
opted out.

```camussql
SELECT customer_id FROM current_orders
UNION
SELECT customer_id FROM archived_orders;
```

```text
┌─────────────┐
│ customer_id │
├─────────────┤
│ 1           │
│ 2           │
│ 4           │
└─────────────┘
3 rows in set (00:00:00.0005748)
```

`UNION` returns each customer once. Use `UNION ALL` when repeated rows matter,
or when the inputs don't overlap and you want to skip the duplicate check.

### Choose an operation

Rows match by the values at each column position. In a set operation, `NULL`
matches `NULL`. This differs from the comparison `NULL = NULL`.

| Operation | Result | Copies when the left has m matching rows and the right has n |
| --- | --- | --- |
| `UNION` | Rows from either query, each row once. | 1 if m + n is greater than 0 |
| `UNION ALL` | All rows from both queries. | m + n |
| `INTERSECT` | Rows from both queries, each row once. | 1 if both m and n are greater than 0 |
| `INTERSECT ALL` | Rows from both inputs, with the matching copies. | min(m, n) |
| `EXCEPT` | Left rows that the right doesn't have, each row once. | 1 if m is greater than 0 and n is 0 |
| `EXCEPT ALL` | Left rows minus the matching right copies. | max(m − n, 0) |

An operator that doesn't have `ALL` means `DISTINCT`. You can also write
`DISTINCT` after the operator, which doesn't change the result. If there's no
`ORDER BY`, the order of the result isn't defined.

For example, find the campaign members who didn't opt out.

```camussql
SELECT customer_id FROM campaign_members
EXCEPT
SELECT customer_id FROM email_opt_outs;
```

```text
┌─────────────┐
│ customer_id │
├─────────────┤
│ 1           │
│ 3           │
└─────────────┘
2 rows in set (00:00:00.0025822)
```

### Match columns and types

Both queries must return the same number of columns. Columns match by
position, and the output names come from the leftmost query. A different
column count or incompatible types return `CADB0400 InvalidInput` before any
rows are read.

| Input types at the same position | Output type |
| --- | --- |
| The same type | That type. |
| A `NULL` literal or a placeholder on one side | The type of the other side. |
| Two numeric types | Their common arithmetic type. For example, `INT64` and `FLOAT64` give `FLOAT64`. |
| `DATE` and `DATETIME` | `DATETIME`. |
| A string literal with `DATE` or `DATETIME` | The temporal type. An invalid literal returns an error before any rows are read. A string column isn't converted. |
| Arrays | The element types must match, or one side must be empty or untyped. |
| Other pairs | An error that names the column position and the types. |

Values are converted before they're compared. For example,
`SELECT 1 UNION SELECT 1.0` returns one row. A column with only untyped `NULL`
values has the type `STRING`, but it can take the type of the other operand in
an enclosing set operation.

### Precedence and pagination

`INTERSECT` binds more tightly than `UNION` and `EXCEPT`. `UNION` and `EXCEPT`
group from left to right. Use parentheses to choose another grouping.

```camussql
-- The intersection comes first: returns 1 and 2.
SELECT 1 AS id UNION SELECT 2 INTERSECT SELECT 2;

-- Parentheses change the grouping: returns only 2.
(SELECT 1 AS id UNION SELECT 2) INTERSECT SELECT 2;
```

Trailing clauses after the last query, such as `ORDER BY` and `LIMIT`, apply to
the combined result. To give one query separate clauses, put it in
parentheses.

```camussql
(SELECT customer_id FROM current_orders ORDER BY customer_id LIMIT 5)
UNION ALL
SELECT customer_id FROM archived_orders
ORDER BY 1 LIMIT 10 OFFSET 2;
```

The combined `ORDER BY` takes an output column name or a 1-based position. An
expression such as `ORDER BY id + 1` returns `CADB0400`. To sort by an
expression, put the operation in a derived table. A query in parentheses can't
have a second set of trailing clauses. Keep the clauses in the parentheses, or
use a derived table.

### Use combined results elsewhere

You can use a set operation wherever a query can be, such as in a derived table
or as the source of `INSERT ... SELECT`.

```camussql
SELECT COUNT(*)
FROM (
    SELECT customer_id FROM current_orders
    UNION
    SELECT customer_id FROM archived_orders
) AS customers;

CREATE TABLE campaign_audience AS
SELECT customer_id FROM campaign_members
EXCEPT
SELECT customer_id FROM email_opt_outs;
```

Each query needs `SELECT` on its tables, including the tables of a subquery in
the `WHERE` of an operand. These subqueries use the caller's privileges in a
statement, and the view owner's privileges in a view body.

All operands read the snapshot of the statement. An `AS OF SYSTEM TIME` clause
on one operand returns `CADB0409`.

#### Views

A [view](/docs/views) or a [materialized view](/docs/materialized-views) can
store a set operation as its body.

```camussql
CREATE VIEW all_order_customers AS
SELECT customer_id FROM current_orders
UNION
SELECT customer_id FROM archived_orders;
```

When the view is created, the `*` of each operand is expanded to the current
columns. Columns added later don't change the view. The output names come from
the leftmost operand. The view depends on the tables and columns of both
operands. A rename is followed, and the drop of a dependency returns an error.

For a set operation in a derived table or a subquery of a view body, list the
columns. A `*` in those operands returns `CADB0400`. `SHOW CREATE VIEW` shows
the grouping with parentheses.

### Execution and limits

`UNION ALL` returns the rows of its operands as they're read. An outer `LIMIT`
can stop the operands early. `UNION` uses the `DISTINCT` operator. `INTERSECT`
and `EXCEPT` build a hash table from the right side.

With [spill to disk](/docs/spill-to-disk) turned on, `UNION` can spill through
`DISTINCT`. `INTERSECT` and `EXCEPT` split both inputs into spill files when the
hash table reaches `spill_threshold_rows` distinct rows or
`spill_threshold_bytes`. Each pair of partitions is processed in memory, and it
isn't split again. With spill turned off, the hash tables are in memory.

`EXPLAIN` shows a node for the operation, such as `union`, followed by `operand`
rows for the left and right plans. `EXPLAIN (ANALYZE)` measures both operands, and the
row count of the operation is the combined output. The estimate of the
operation is a default derived-table estimate. It isn't an estimate of the
overlap.

The combined result isn't stored in the query result cache. Set operations can
be nested up to 64 levels. A deeper statement returns
`CADB0413 StatementTooDeeplyNested`. `CORRESPONDING BY` isn't supported.

## Compute across related rows {#window-functions}

Window functions compute a value over related rows, such as the rank of an
order among a customer's orders, or a running total. The rows aren't collapsed
into one aggregate result. Add `OVER (...)` to a supported function.

```camussql
SELECT customer_id, id, total,
       row_number() OVER (
         PARTITION BY customer_id ORDER BY total DESC, id
       ) AS position,
       sum(total) OVER (PARTITION BY customer_id) AS customer_total
FROM orders;
```

```text
┌─────────────┬────┬───────┬──────────┬────────────────┐
│ customer_id │ id │ total │ position │ customer_total │
├─────────────┼────┼───────┼──────────┼────────────────┤
│ 1           │ 4  │ 900   │ 1        │ 1670           │
│ 1           │ 7  │ 400   │ 2        │ 1670           │
│ 1           │ 1  │ 250   │ 3        │ 1670           │
│ 1           │ 8  │ 120   │ 4        │ 1670           │
│ 2           │ 2  │ 1200  │ 1        │ 1500           │
│ 2           │ 5  │ 300   │ 2        │ 1500           │
│ 3           │ 6  │ 150   │ 1        │ 230            │
│ 3           │ 3  │ 80    │ 2        │ 230            │
└─────────────┴────┴───────┴──────────┴────────────────┘
8 rows in set (00:00:00.0075674)
```

`PARTITION BY` groups the rows for the calculation. It doesn't change where the
rows are stored. If you omit it, all input rows are one partition. The window
`ORDER BY` sets the calculation order, and the final `ORDER BY` of the query
sets the output order. To number rows in a repeatable order, add a unique
column, such as `id`, to the window `ORDER BY`.

### Supported functions

| Function | Result |
| --- | --- |
| `row_number()` | The position of the row in its partition, starting at 1. |
| `rank()`, `dense_rank()` | The rank. `rank()` leaves gaps after ties, and `dense_rank()` doesn't. |
| `percent_rank()` | `(rank - 1) / (partition rows - 1)`, or 0 for one row. |
| `cume_dist()` | The fraction of partition rows up to and including the peers of the current row. |
| `ntile(k)` | Divides the rows into `k` buckets, numbered from 1. Larger buckets come first. `k` must be positive. |
| `lag(value [, offset [, default]])` | A value from an earlier row. The offset defaults to 1, and the fallback to `NULL`. |
| `lead(value [, offset [, default]])` | A value from a later row, with the same defaults as `lag`. |
| `first_value(value)`, `last_value(value)` | The value from the first or last row of the frame. |
| `nth_value(value, n)` | The value at frame position `n`, starting at 1. If the frame is shorter, the result is `NULL`. `n` must be positive. |
| `count`, `sum`, `avg`, `min`, `max` | An aggregate over the frame, with the result type and null rules of the normal aggregate. |

Ranking functions ignore the frame, and so do `lag` and `lead`. A negative offset in
`lag` or `lead` reads in the other direction. The fallback must have a
compatible type. For numbers, the common arithmetic type is used. A placeholder
fallback can be widened to that type, but it can't be narrowed. The fallback is
used when the requested row is outside the partition. A `NULL` value in an
existing row is returned as `NULL`.

### Running totals and frames

A frame selects the rows of the partition that a calculation uses.

```camussql
SELECT customer_id, id, total,
       sum(total) OVER (
         PARTITION BY customer_id ORDER BY id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
       ) AS running_total,
       total - lag(total, 1, 0) OVER (
         PARTITION BY customer_id ORDER BY id
       ) AS change_from_previous
FROM orders
ORDER BY customer_id, id;
```

```text
┌─────────────┬────┬───────┬───────────────┬──────────────────────┐
│ customer_id │ id │ total │ running_total │ change_from_previous │
├─────────────┼────┼───────┼───────────────┼──────────────────────┤
│ 1           │ 1  │ 250   │ 250           │ 250                  │
│ 1           │ 4  │ 900   │ 1150          │ 650                  │
│ 1           │ 7  │ 400   │ 1550          │ -500                 │
│ 1           │ 8  │ 120   │ 1670          │ -280                 │
│ 2           │ 2  │ 1200  │ 1200          │ 1200                 │
│ 2           │ 5  │ 300   │ 1500          │ -900                 │
│ 3           │ 3  │ 80    │ 80            │ 80                   │
│ 3           │ 6  │ 150   │ 230           │ 70                   │
└─────────────┴────┴───────┴───────────────┴──────────────────────┘
8 rows in set (00:00:00.0017953)
```

The first order of each customer doesn't have an earlier row. This means that `lag`
returns the fallback `0`, and the change is the total.

`ROWS` counts physical rows in the calculation order. A bound is
`CURRENT ROW`, or a `PRECEDING` or `FOLLOWING` bound with an offset `n` or
`UNBOUNDED`. An offset must be a non-negative integer literal or a
placeholder. For example, `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW` covers up
to three rows. A single bound, such as `ROWS 2 PRECEDING`, ends at the current
row. Frames end at the partition boundaries.

The default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. Rows
with equal window ordering values are **peers**, and this frame includes all
peers of the current row. If the window doesn't have an `ORDER BY`, all rows
are peers. The frame is then the full partition. `RANGE` takes `CURRENT ROW` and unbounded
bounds. An offset such as `1 PRECEDING` returns `CADB0400`. Use `ROWS` for an
offset.

For this reason, `last_value(total) OVER (ORDER BY id)` returns the value of
the current row when `id` is unique. To read the last value of the partition,
use `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.

`NULL` values sort first in ascending order and last in descending order, as in
other sorts. `NULLS FIRST` and `NULLS LAST` aren't supported. Rows with a `NULL`
partition key form one partition.

A window `sum` or `avg` over `FLOAT64` adds exact values and rounds once. Its
result doesn't depend on the row order. This means that it can differ in the
last binary digit from a normal aggregate.

### Filter a window result

Window functions are computed after the filters and the grouping. To filter on
a computed rank, use an outer query. This query returns the three largest
orders of each customer.

```camussql
SELECT customer_id, id, total
FROM (
  SELECT customer_id, id, total,
         row_number() OVER (
           PARTITION BY customer_id ORDER BY total DESC, id
         ) AS position
  FROM orders
) AS ranked
WHERE position <= 3
ORDER BY customer_id, total DESC, id;
```

```text
┌─────────────┬────┬───────┐
│ customer_id │ id │ total │
├─────────────┼────┼───────┤
│ 1           │ 4  │ 900   │
│ 1           │ 7  │ 400   │
│ 1           │ 1  │ 250   │
│ 2           │ 2  │ 1200  │
│ 2           │ 5  │ 300   │
│ 3           │ 6  │ 150   │
│ 3           │ 3  │ 80    │
└─────────────┴────┴───────┘
7 rows in set (00:00:00.0005590)
```

Order 8, the fourth largest order of customer 1, is filtered out.

A final `LIMIT` reduces the output. The window function reads all input rows.
For example, `SELECT id, count(*) OVER () FROM orders LIMIT 5` counts all
orders. Window functions can also use the group keys and aggregates of a
grouped query, such as `rank() OVER (ORDER BY sum(total) DESC)` with
`GROUP BY customer_id`.

### Execution and restrictions

Window functions are computed on the node that executes the statement, after
the results of distributed scans and aggregates are collected. Functions with
the same partition and ordering expressions share one sort. Sorts and partition
buffers can [spill to disk](/docs/spill-to-disk). However, the window inputs and
results need memory in proportion to the rows of the current partition. A
large partition can use a lot of memory, also with spill turned on. For the
plan, see [window plans](/docs/explain#window-functions).

A window call is allowed in the select list and in the final `ORDER BY`, also as
part of a larger expression. It isn't allowed in four places.

- In another window call.
- In a filter, a grouping, or a join condition.
- In `UPDATE ... SET`, `INSERT ... VALUES`, a column default, or a `CHECK`
  constraint.
- In `SELECT ... FOR UPDATE`.

Four features aren't supported.

- Named windows: `OVER name` and `WINDOW name AS (...)`.
- `GROUPS` frames / `EXCLUDE` / aggregate `FILTER`.
- Extension aggregates with `OVER`.
- `SELECT DISTINCT *` with a window call that is in `ORDER BY` only.

An uncorrelated subquery can read a window query, also from an outer select
list. A correlated `EXISTS` with an inner query over several sources isn't
supported. For more information, see
[subquery restrictions](/docs/joins-and-subqueries#subqueries-in-where).

`OVER` is reserved. To use it as an identifier, put it in backticks. Frame words
such as `ROWS` and `PRECEDING` are valid identifiers.

## Lock rows before updating them {#for-update}

Use `SELECT ... FOR UPDATE` when an application reads a row and then changes it
in the same transaction, based on what it read. The statement takes the
exclusive row lock that `UPDATE` and `DELETE` take. The lock is held until the
transaction commits or rolls back.

```camussql
BEGIN;
SELECT sku, quantity FROM inventory WHERE sku = @sku FOR UPDATE;
UPDATE inventory SET quantity = quantity - @sold
WHERE sku = @sku AND quantity >= @sold;
COMMIT;
```

Write the clause last, after `ORDER BY`, `LIMIT`, and `OFFSET`.

```camussql
SELECT id FROM jobs WHERE state = 'ready' ORDER BY id LIMIT 10
FOR UPDATE OF jobs NOWAIT;
```

`OF` can name the table or its alias. `FOR NO KEY UPDATE` means the same as
`FOR UPDATE`. `FOR SHARE` and `FOR KEY SHARE` aren't supported. `FOR SHARE`
returns `CADB0533`.

### Choose how to handle held rows

| Option | When another transaction has the row lock |
| --- | --- |
| `FOR UPDATE` | Uses the same [row-lock wait rules](/docs/serializable-transactions#row-lock-waits) as a pessimistic write. |
| `FOR UPDATE NOWAIT` | Returns `CADB0555 LockNotAvailable`. It isn't retried automatically. |
| `FOR UPDATE SKIP LOCKED` | Skips the locked row and looks for other rows. |

A commit that is finishing replication uses a separate wait budget. The
statement can wait for it even with `NOWAIT`.

A failed statement ends its transaction. The next statement in it returns
`Unknown transaction`. Savepoints aren't supported.

For queue workers, use Read Committed with pessimistic locking, the default
locking mode. Select free jobs, and update the returned IDs before you commit.

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT id FROM jobs WHERE state = 'ready' ORDER BY id LIMIT 1
FOR UPDATE SKIP LOCKED;
-- Bind the returned id as @job_id. If no row was returned, skip the UPDATE.
UPDATE jobs SET state = 'running' WHERE id = @job_id;
COMMIT;
```

`SKIP LOCKED` at Serializable returns `CADB0533`. The shared range locks of its
scan would make workers conflict when they update different jobs. `FOR UPDATE`
and `NOWAIT` work at both isolation levels. At Serializable, a range scan can
meet a predicate-lock conflict before it reaches a row lock. The scan can wait
for that lock even with `NOWAIT`. If it can't wait or its deadline expires,
it returns `CADB0502`.

### Returned values and lock scope

The statement scans and sorts the candidate rows, and it locks them in batches.
Then it reads their latest committed values, and it checks `WHERE` again. A
deleted row, or a row that doesn't match any more, is dropped. Skipped and
dropped rows don't count toward `LIMIT` or `OFFSET`. Later rows that match fill
the result.

The locks are released when the transaction ends. This includes the locks on
dropped rows and on rows that `OFFSET` skipped. The statement locks the
candidates that `LIMIT` and `OFFSET` need, and no more. If a concurrent change
moves a row in the sort order, the row can appear at its old position with its
new value.

Normal `SELECT` reads of these rows aren't blocked. Another writer or locking
read of these rows gets a conflict. A later `UPDATE` or `DELETE` in the same
transaction uses the locks that it already has.

### Restrictions and autocommit

The statement needs the `SELECT` and `UPDATE` privileges on one table. It
returns `CADB0400` in a read-only transaction and in an optimistic transaction.

`FOR UPDATE` reads one table, and it doesn't support three kinds of query.

- A source other than a table, such as a view, a derived table, or a CTE. Joins
  aren't supported either.
- A query that combines rows, such as with grouping, `DISTINCT`, window
  functions, or a set operation.
- Historical reads.

The clause is allowed at the top level only. It can't be in a nested query,
such as a subquery or a view body. It can't be in a statement that stores its
result either, such as `INSERT ... SELECT` or `CREATE TABLE ... AS SELECT`.

In autocommit mode, the REST and gRPC APIs execute a locking read in a writable
transaction. The transaction commits before the rows are sent, and the locks
are released when the statement ends. To protect a later write, use an explicit
transaction. For autocommit `SKIP LOCKED`, set the request isolation to Read
Committed. The server default is Serializable.

`EXPLAIN` plans a locking read and takes no locks. `EXPLAIN (ANALYZE)`
executes it and takes real locks. For more information, see
[locking-read plans](/docs/explain#locking-reads).

## Read a past snapshot

`AS OF SYSTEM TIME` reads a consistent snapshot of the past. Write it after the
`FROM` source and before `WHERE`.

```camussql
SELECT id, name, year
FROM robots AS OF SYSTEM TIME '-10s'
WHERE year >= 1970
ORDER BY year DESC;
```

The clause works on read-only statements in autocommit mode. It applies to the
full statement, including joins and subqueries. For the formats and the
retention limits, see [Time-travel reads](/docs/time-travel-reads).

## Force an index

If you know that an index suits a predicate better than the planner's estimate
suggests, name it in a hint.

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

An unknown index name returns `CADB0405`. Check the effect with
[`EXPLAIN`](/docs/explain) before you keep a hint in production code. When the
data changes, a hint can make a query slower than the planner's choice.
