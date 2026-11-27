---
sidebar_position: 2.42
---

# Joins and subqueries

This page covers queries that read from more than one source: joins, subqueries
in a `WHERE` clause, and subqueries in a `FROM` clause.

These sources work with the clauses in [SELECT](/docs/sql-queries). After the
sources are combined, the other clauses of the query work as usual.

Most examples on this page use the sample data below.

<details>
<summary>Sample data for the examples on this page</summary>

```camussql
CREATE TABLE app_users (
  id INT64 PRIMARY KEY NOT NULL,
  email STRING NOT NULL,
  role STRING NOT NULL,
  active BOOL NOT NULL,
  post_count INT64
);

INSERT INTO app_users (id, email, role, active) VALUES
  (1, 'alice@example.com', 'admin', true),
  (2, 'bob@example.com', 'member', true),
  (3, 'carol@example.com', 'member', true),
  (4, 'dave@example.com', 'admin', false);

CREATE TABLE posts (
  id INT64 PRIMARY KEY NOT NULL,
  user_id INT64 NOT NULL,
  title STRING NOT NULL,
  published BOOL NOT NULL
);

INSERT INTO posts (id, user_id, title, published) VALUES
  (10, 1, 'Release notes', true),
  (11, 1, 'Scaling reads', true),
  (12, 1, 'Roadmap draft', false),
  (13, 2, 'Hello from Bob', true),
  (14, 2, 'Weekend plans', false),
  (15, 4, 'Ops checklist', false);

CREATE TABLE products (
  id INT64 PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  price NUMERIC NOT NULL
);

INSERT INTO products (id, name, price) VALUES
  (1, 'Desk lamp', 39.90),
  (2, 'Office chair', 189.00),
  (3, 'Monitor stand', 54.50),
  (4, 'USB-C hub', 29.99);

CREATE TABLE customers (
  id INT64 PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);

INSERT INTO customers (id, name) VALUES
  (1, 'Ana'),
  (2, 'Ben'),
  (3, 'Chen');

CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  customer_id INT64 NOT NULL,
  total NUMERIC NOT NULL
);

INSERT INTO orders (id, customer_id, total) VALUES
  (101, 1, 120.00),
  (102, 1, 45.50),
  (103, 1, 310.00),
  (104, 2, 75.25);
```

</details>

## Join forms

CamusDB supports four join forms in the `FROM` clause.

| Form | Syntax | Rows returned |
| --- | --- | --- |
| Inner | `A JOIN B ON p` or `A INNER JOIN B ON p` | Each pair of rows for which `p` is true. |
| Left outer | `A LEFT JOIN B ON p` or `A LEFT OUTER JOIN B ON p` | The inner-join pairs. Each `A` row that doesn't match also returns one row, with the `B` columns set to `NULL`. |
| Right outer | `A RIGHT JOIN B ON p` or `A RIGHT OUTER JOIN B ON p` | The same rows as `B LEFT JOIN A ON p`. |
| Cross | `A CROSS JOIN B` | All pairs of rows. An `ON` clause isn't allowed. |

Joins chain left to right, and a chain can mix forms.

```camussql
SELECT a.id, b.id, c.id
FROM a
JOIN b ON b.a_id = a.id
LEFT JOIN c ON c.b_id = b.id;
```

## Inner joins

`JOIN` and `INNER JOIN` are equivalent. This query lists the posts of each user.

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

```text
┌───────────────────┬────────────────┐
│ email             │ title          │
├───────────────────┼────────────────┤
│ alice@example.com │ Release notes  │
│ alice@example.com │ Roadmap draft  │
│ alice@example.com │ Scaling reads  │
│ bob@example.com   │ Hello from Bob │
│ bob@example.com   │ Weekend plans  │
│ dave@example.com  │ Ops checklist  │
└───────────────────┴────────────────┘
6 rows in set (00:00:00.0330492)
```

The inner join leaves out carol, who didn't write a post.

Put the join condition in the `ON` clause, and the conditions on one table in
the `WHERE` clause.

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = 'admin' AND p.published = true
ORDER BY u.email, p.title;
```

Give each source an alias, and qualify each column reference. If both sides
have a column, its bare name is ambiguous. For example, `SELECT id` in this join
returns `CADB0400` (`Ambiguous column: id`).

Joins work with grouping. This query counts the posts of each role.

```camussql
SELECT u.role, COUNT(*) AS cnt
FROM app_users u
JOIN posts p ON p.user_id = u.id
GROUP BY u.role
ORDER BY u.role;
```

```text
┌────────┬─────┐
│ role   │ cnt │
├────────┼─────┤
│ admin  │ 4   │
│ member │ 2   │
└────────┴─────┘
2 rows in set (00:00:00.0017451)
```

## Outer joins

A left outer join returns all rows of the left side, also the rows that don't
match.

```camussql
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

```text
┌───────────────────┬────────────────┐
│ email             │ title          │
├───────────────────┼────────────────┤
│ alice@example.com │ Release notes  │
│ alice@example.com │ Roadmap draft  │
│ alice@example.com │ Scaling reads  │
│ bob@example.com   │ Hello from Bob │
│ bob@example.com   │ Weekend plans  │
│ carol@example.com │ null           │
│ dave@example.com  │ Ops checklist  │
└───────────────────┴────────────────┘
7 rows in set (00:00:00.0035828)
```

A left row with matches returns one row for each match. A left row that
doesn't match returns one row, with all right-side columns set to `NULL`.

The `ON` clause decides whether a right row matches. The `WHERE` clause filters
the joined rows after the join. For outer joins, the two clauses give different
results.

```camussql
-- Users without a post.
SELECT u.email
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.id IS NULL;
```

```text
┌───────────────────┐
│ email             │
├───────────────────┤
│ carol@example.com │
└───────────────────┘
1 rows in set (00:00:00.0015867)
```

```camussql
-- Users with a published post. The right-side WHERE predicate removes padded rows.
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.published = true;
```

A `NULL` join key doesn't match another `NULL` join key. The comparison
`NULL = NULL` is unknown. A row with a `NULL` join key is padded, unless another
condition in `ON` matches it.

CamusDB executes `RIGHT JOIN` as a left join with the operands swapped.
`SELECT *` lists the columns in the order of the tables in the query, as in
PostgreSQL.

A `RIGHT JOIN` whose left operand is a join returns `CADB0533`. Rewrite the
query with the preserved table on the left side, often with a derived table.

## Cross joins

`CROSS JOIN` returns the Cartesian product, which pairs each row of one side
with each row of the other.

```camussql
SELECT r.name, c.currency
FROM robots r
CROSS JOIN currencies c;
```

It is the same as the comma form without an equality predicate. When all
sources are cross joins, CamusDB can take an equality from the `WHERE` clause and plan
it as a join predicate.

### How joins execute

For an inner or left outer join with an equality key, the planner picks one of
three strategies.

| Strategy | CamusDB picks it when | Cost |
| --- | --- | --- |
| Indexed lookup | The right side has an index on the equality column, and the outer side is small. | One probe per outer row. |
| Hash join | The right side doesn't have a usable index, or the outer side is large compared with the indexed side. | Builds a hash table from the side estimated to be smaller (the build side), then looks up each row of the other side (the probe side) in it. |
| Merge join | Two compatible indexes already return both sides in join-key order, and the outer side is large. | Streams both sides. There is no build phase. |

An equality join without an index uses a hash join. This means that the inner
table isn't scanned once per outer row. A join that doesn't have a usable
equality key, such as `ON o.total > c.credit_limit`, uses a nested loop. An equality between
columns of different declared types, or on an array column, isn't a usable key.

An index on the join column of the right side helps most when the outer side is
small. Each outer row then needs one index lookup.

A large hash join can write intermediate rows to disk, which limits its memory
use. This needs [spill to disk](/docs/spill-to-disk). With spill to disk off, a
hash join whose build side passes `hash_join_max_build_rows` changes to a nested
loop.

In a cluster with [distributed queries](/docs/distributed-queries) enabled,
CamusDB can broadcast a small hash join build side to the nodes that own the
probe table's [partitions](/docs/concepts#partition) (the units the cluster
divides its data into). Those nodes probe locally and return only the matching
rows. The output is the same either way.

CamusDB doesn't use a broadcast hash join for a left outer join. A remote probe
can return matches, but it can't produce the padded rows of the preserved side.

### Comma joins

For compatibility, CamusDB supports comma joins. An equality predicate in the
`WHERE` clause becomes a join condition. A predicate on one source is a filter.

```camussql
SELECT r.name, u.amount
FROM robots r, user_robots u
WHERE r.id = u.robots_id AND r.enabled = true
ORDER BY u.amount;
```

Prefer an explicit `JOIN ... ON` in new code. It separates the join condition
from the filters, which makes both easier to read and change.

### Serializable transactions and join indexes

In a Serializable read-write transaction, joins and subquery reads protect
matching rows and absent keys, just as single-table reads do. The locks last
until the transaction ends, including protection against new matching rows.

A join input whose filter can't use an index scans and locks the full row range
of the table, and writers must wait. Index the filtered join columns to narrow that
protection. Parameters are resolved during join planning, and an indexed
`WHERE j.key = @key` can use a bounded lookup. This applies under both
pessimistic and optimistic Serializable locking. Read-only snapshots take no
such locks. See [Transactions and isolation](/docs/serializable-transactions).

## Current join limits

`FULL JOIN` and `FULL OUTER JOIN` aren't supported yet. They return
`CADB0533`, or a syntax error when the left table has an alias. `NATURAL JOIN`
and `JOIN ... USING (...)` aren't supported either, and they return a syntax
error.

A query with an outer join uses the join order of the statement. The planner
doesn't reorder a join tree that contains an outer join.

## Subqueries {#subqueries-in-where}

A subquery uses the answer of another query in the same statement, and the
application doesn't need a separate request. An **uncorrelated** subquery
doesn't reference the outer row, and CamusDB evaluates it once before it reads
the outer rows. A **correlated** subquery references an outer column, and its
result depends on that row.

| Position | Supported subqueries |
| --- | --- |
| SELECT list of a query that doesn't group or aggregate / SELECT WHERE | Scalar / EXISTS / IN / NOT IN / quantified comparisons. Correlated or uncorrelated. |
| UPDATE SET/WHERE, DELETE WHERE | The same correlated and uncorrelated forms, using the target row as the outer scope. |
| HAVING, JOIN ON, INSERT VALUES, ON CONFLICT DO UPDATE | Uncorrelated forms only. |
| GROUP BY or ORDER BY | Subqueries return `CADB0400`. |

These rules also apply in expressions, such as a `CASE` branch or a function
argument. The rules for [CHECK definitions](/docs/check-constraints) and
[RETURNING](/docs/sql-writes#returning) also apply.

### Scalar subqueries

A scalar subquery returns one column, and it stands for a single value.

```camussql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

Zero rows give `NULL`. More than one row is an error. `SELECT *` and
`SELECT alias.*` work when they expand to exactly one column. This is true for
all subquery kinds, such as `IN` and `ANY`. More than one expanded column
returns an error.

### Subqueries in projections and writes

This statement compares each product with the highest price.

```camussql
SELECT id, price, (SELECT MAX(price) FROM products) - price AS price_gap
FROM products;
```

```text
┌────┬───────┬───────────┐
│ id │ price │ price_gap │
├────┼───────┼───────────┤
│ 1  │ 39.9  │ 149.1     │
│ 2  │ 189   │ 0         │
│ 3  │ 54.5  │ 134.5     │
│ 4  │ 29.99 │ 159.01    │
└────┴───────┴───────────┘
4 rows in set (00:00:00.0019268)
```

A subquery can supply an inserted value.

```camussql
INSERT INTO counters (name, value)
VALUES ('orders', (SELECT COUNT(*) FROM orders));
```

An `EXISTS` can also produce a boolean in the select list or a `CASE` branch.

```camussql
SELECT id,
       CASE WHEN EXISTS (SELECT 1 FROM stock_alerts WHERE active = true)
            THEN 'check stock' ELSE 'ready' END AS status
FROM products;
```

These uncorrelated subqueries are executed once for the statement. Subqueries
can also be in the select list of a derived table or a view body.

A correlated subquery returns `CADB0533` in some positions. Examples are
`HAVING` and the select list of a query that groups or aggregates. For all the
positions, see the table at the start of this section.

### Correlated values

A correlated subquery can compute a value for each outer row. Your application
doesn't need a separate request for each row.

```camussql
SELECT u.id,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
       EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id) AS has_posts
FROM app_users u;
```

```text
┌────┬────────────┬───────────┐
│ id │ post_count │ has_posts │
├────┼────────────┼───────────┤
│ 1  │ 3          │ True      │
│ 2  │ 2          │ True      │
│ 3  │ 0          │ False     │
│ 4  │ 1          │ True      │
└────┴────────────┴───────────┘
4 rows in set (00:00:00.0180690)
```

The same subquery can supply a value in an `UPDATE`.

```camussql
UPDATE app_users
SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.user_id = app_users.id)
WHERE active = true;
```

Correlated scalar subqueries return NULL for no rows and fail if more than
one row is read. IN/NOT IN and ANY/SOME/ALL also accept correlated bodies,
with their usual [NULL and empty-set rules](/docs/sql-expression-syntax#null-rules).
A scalar subquery inherits its inner output name, but an explicit alias
makes the result clearer to callers and stored definitions.

A name resolves in the nearest query, or else in an enclosing query. An inner
column or alias can hide an outer name. Qualify columns to make the scope
clear. In UPDATE and DELETE, correlated bodies read the target
and other tables at the statement timestamp. They don't see changes
made earlier by the same statement.

A value error in a correlated subquery occurs only if the surrounding
expression uses that value. An unused `CASE` branch or `COALESCE` fallback can
skip the error. Name errors and known type errors fail before rows are read.

`EXPLAIN` evaluates uncorrelated subqueries when it prepares the plan. A regular
`EXPLAIN` can therefore read data for an inner query. It doesn't execute the
outer query. See [EXPLAIN](/docs/explain).

### IN and NOT IN

`IN` and `NOT IN` take a correlated or uncorrelated subquery that returns
exactly one column.

```camussql
SELECT email
FROM app_users
WHERE id IN (
  SELECT user_id
  FROM posts
  WHERE published = true
)
ORDER BY email;
```

```text
┌───────────────────┐
│ email             │
├───────────────────┤
│ alice@example.com │
│ bob@example.com   │
└───────────────────┘
2 rows in set (00:00:00.0082250)
```

When the inner query is indexed and eligible, CamusDB uses a semi-join for `IN`.
A semi-join returns each outer row with at least one match. For `NOT IN`, it
uses an anti-join, which returns each outer row that doesn't match. It doesn't materialize
the full inner result first.

`NOT IN` follows the SQL rules for `NULL`. One `NULL` in the inner result makes
the result unknown for all rows that don't match. CamusDB drops those rows, and
the query often returns zero rows. An empty inner result makes `NOT IN` true,
also for a `NULL` outer value. Use `NOT EXISTS` when the inner column can be
`NULL`.

`IN` and `NOT IN` subqueries with more than one column return an error.
Correlated forms are evaluated for each outer row. The semi-join and anti-join
rewrite applies to eligible uncorrelated forms.

### EXISTS

`EXISTS` works with correlated and uncorrelated subqueries. Only the existence
of a row matters, so the inner select list can be `*` or any columns.

```camussql
SELECT email
FROM app_users
WHERE EXISTS (
  SELECT *
  FROM posts
  WHERE posts.user_id = app_users.id
)
ORDER BY email;
```

```text
┌───────────────────┐
│ email             │
├───────────────────┤
│ alice@example.com │
│ bob@example.com   │
│ dave@example.com  │
└───────────────────┘
3 rows in set (00:00:00.0019840)
```

This body doesn't filter on `published`. This means that Dave, whose only post
is unpublished, also matches.

In a regular `EXISTS` body, the clauses that can't change whether a row exists
are ignored. Examples are the select list and `ORDER BY`. This means that
`EXISTS (SELECT 1 / 0 FROM posts)` doesn't divide by zero. Unknown names and
known type errors in the ignored clauses return errors. Clauses that can change
whether a row exists apply as usual, such as `HAVING` and `OFFSET`. `LIMIT 0`
returns false and reads no rows.

A correlated `EXISTS` body can be a full query, with joins, aggregates, window
functions, and nested subqueries. It can also leave out `FROM` and read only
outer values. A negative `LIMIT` or `OFFSET` returns an error.

These bodies work in the correlated positions in the table at the start of this
section. They can be in a `CASE` or a comparison. An
outer name in a table-function argument isn't supported. In a join, CamusDB
evaluates the correlation where all referenced outer aliases are available.

For a correlated `EXISTS`, CamusDB uses an index on the inner table when the
inner `WHERE` clause pins the index's leading columns with equalities. The other
side of an equality can be an outer-row value, a literal, or a parameter.

```camussql
CREATE INDEX posts_user_idx ON posts (user_id);

SELECT email
FROM app_users
WHERE EXISTS (
  SELECT *
  FROM posts
  WHERE posts.user_id = app_users.id
    AND posts.published = true
);
```

For a simple `EXISTS` body on one table, the index reduces the candidate rows,
and CamusDB applies the full condition after the lookup. More complex bodies use
the full query pipeline. CamusDB can reuse results for repeated outer values in
one statement. See
[correlated subquery planning](/docs/query-planning#correlated-subqueries).

## Derived tables

A derived table is a `SELECT` in parentheses in the `FROM` clause. It needs an
alias. Without one, the query returns a syntax error.

```camussql
SELECT post_count
FROM (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d
WHERE d.post_count = 2
ORDER BY post_count;
```

A derived table joins like any other source. That is the usual way to filter a
table against per-group aggregates.

```camussql
SELECT u.email, d.post_count
FROM app_users u
JOIN (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d ON d.user_id = u.id
WHERE d.post_count >= 1
ORDER BY u.email;
```

The inner query can use subqueries in its `WHERE` clause, such as `IN` and
correlated `EXISTS`. This also works under an outer aggregate.

```camussql
SELECT COUNT(*)
FROM (
  SELECT u.id FROM app_users u
  WHERE EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id)
) AS authors;
```

These subqueries also work in the operands of set operations. They use the
caller's privileges in a direct query, and the view owner's privileges in a
stored view body.

A derived table's columns take their names from the inner projection. Give
computed columns aliases, or supply a column list after the derived-table alias.

```camussql
SELECT d.customer, d.spent
FROM (SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id)
  AS d (customer, spent);
```

```text
┌──────────┬───────┐
│ customer │ spent │
├──────────┼───────┤
│ 1        │ 475.5 │
│ 2        │ 75.25 │
└──────────┴───────┘
2 rows in set (00:00:00.0282673)
```

Column-list names replace output names by position. A shorter list renames
only the first columns, and a longer list returns `CADB0400`. Duplicate names make a
reference ambiguous. For a named query reused within a statement, see
[WITH queries](/docs/sql-queries#with-queries).

## LATERAL sources {#lateral}

`LATERAL` lets a `FROM` source read columns from sources to its left. This
query gets the two most expensive orders of each customer, with a small query
per customer.

```camussql
SELECT c.id AS customer_id, o.id AS order_id, o.total
FROM customers AS c
CROSS JOIN LATERAL (
  SELECT id, total FROM orders
  WHERE customer_id = c.id ORDER BY total DESC LIMIT 2
) AS o;
```

```text
┌─────────────┬──────────┬───────┐
│ customer_id │ order_id │ total │
├─────────────┼──────────┼───────┤
│ 1           │ 103      │ 310   │
│ 1           │ 101      │ 120   │
│ 2           │ 104      │ 75.25 │
└─────────────┴──────────┴───────┘
3 rows in set (00:00:00.0023440)
```

Customer 3 didn't place an order, and `CROSS JOIN LATERAL` returns no row for
it.

To also return left rows whose lateral query returns no rows, use
`LEFT JOIN LATERAL (...) AS o ON true`. The right columns are then `NULL`.
`LATERAL` works with a comma and with the `CROSS`, `INNER`, and `LEFT` joins.
`RIGHT JOIN LATERAL` returns `CADB0400`. `CROSS APPLY` and `OUTER APPLY` return
a syntax error.

A name resolves in the lateral query, or else in the left sources, or else in
the enclosing queries. A lateral source can't read a source to its right. A
derived table that isn't `LATERAL` can't read other items of the same `FROM`
clause. A second lateral source can read the results of the first one.

Table-function arguments can read left columns, and you don't need to write
`LATERAL`.

```camussql
SELECT t.id, n FROM tasks AS t, generate_series(1, t.repetitions) AS n;
```

This also works for JSON table functions such as `jsonb_each(t.payload)` and
extension table functions. Arguments that don't reference a column are evaluated once.
Derived tables and VALUES lists require explicit LATERAL for left references.

The planner preserves the written join order and uses nested loops for lateral
sources. `EXPLAIN` marks the join `lateral`. Repeated left values can share a
small result within the statement; volatile bodies run again per left row.
Lateral sources work in views and in the writes that read a query, such as
`INSERT ... SELECT` and `UPDATE ... FROM`. `LATERAL` is reserved; quote identifiers named `` `lateral` ``.

## VALUES sources {#values-sources}

A `VALUES` list gives you a small relation, and you don't need to create a
table. You can join inline mappings to stored rows, or use them in
[joined writes](/docs/sql-writes#joined-writes).

```camussql
SELECT p.id, v.label
FROM products AS p
JOIN (VALUES (1, 'featured'), (3, 'clearance')) AS v (id, label)
  ON v.id = p.id;
```

```text
┌────┬───────────┐
│ id │ label     │
├────┼───────────┤
│ 1  │ featured  │
│ 3  │ clearance │
└────┴───────────┘
2 rows in set (00:00:00.0011044)
```

The relation alias is required. If you don't give a column list, the columns
are named `column1`, `column2`, and so on. A shorter list renames the first
columns. Too many names, or rows of unequal width, return an error. An item
can be any expression, such as a parameter or a scalar subquery. `DEFAULT`
returns an error, and so do built-in aggregates and window calls. An extension
aggregate is evaluated over its item's single row.

Column types follow the [UNION rules](/docs/sql-queries#match-columns-and-types).
Integers and floats widen. Text and numbers in one column return an error. A
column of only `NULL` values doesn't have a type. Only `ORDER BY` guarantees
the order of the result.

`LATERAL` can expand each left row into several named values.

```camussql
SELECT p.id, v.dimension, v.size
FROM packages AS p
CROSS JOIN LATERAL (VALUES ('width', p.width), ('height', p.height))
  AS v (dimension, size);
```

A `VALUES` source works wherever a derived table works, such as in a view or a
joined write. `SHOW CREATE` shows the `VALUES` syntax of a view.

A standalone `VALUES (1), (2)` statement returns a syntax error, and so does a
`WITH c AS (VALUES ...)` body. Wrap them in `SELECT * FROM (VALUES ...) AS v`.
Clauses such as `ORDER BY` and `LIMIT` can't be in the parentheses of `VALUES`.

A list runs as a derived table of `UNION ALL` rows. For thousands of reusable
rows, use a stored table. `EXPLAIN` shows the list as a `values` node with the
detail `alias=v, rows=N`.

## Check the plan

Plan choice matters most for queries with several sources. `EXPLAIN` shows the
chosen join strategy and whether CamusDB used an index.

```camussql
EXPLAIN SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

See [EXPLAIN](/docs/explain) for the output reference and
[Query Planning](/docs/query-planning) for the rules behind the choice.
