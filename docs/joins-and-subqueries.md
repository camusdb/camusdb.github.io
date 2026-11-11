---
sidebar_position: 2.42
---

# Joins and subqueries

This page covers queries that read from more than one source: joins, subqueries
in a `WHERE` clause, and subqueries in a `FROM` clause.

Everything here composes with the clauses in [SELECT](/docs/sql-queries).
Filtering, grouping, sorting, and pagination behave the same way after CamusDB
combines the sources.

## Join forms

CamusDB supports these joins in the `FROM` clause:

| Form | Syntax | Rows returned |
| --- | --- | --- |
| Inner | `A JOIN B ON p` or `A INNER JOIN B ON p` | Every pair of rows for which `p` is true. |
| Left outer | `A LEFT JOIN B ON p` or `A LEFT OUTER JOIN B ON p` | Every inner-join pair, plus one row for each `A` row with no match, with the `B` columns set to `NULL`. |
| Right outer | `A RIGHT JOIN B ON p` or `A RIGHT OUTER JOIN B ON p` | The same rows as `B LEFT JOIN A ON p`. |
| Cross | `A CROSS JOIN B` | Every pair of rows. No `ON` clause is allowed. |

Joins chain left to right, and a chain can mix forms:

```camussql
SELECT a.id, b.id, c.id
FROM a
JOIN b ON b.a_id = a.id
LEFT JOIN c ON c.b_id = b.id;
```

## Inner joins

`JOIN` and `INNER JOIN` are equivalent:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

Put the join condition in the `ON` clause, and single-table conditions in the
`WHERE` clause:

```camussql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = 'admin' AND p.published = true
ORDER BY u.email, p.title;
```

Give every source an alias and qualify every column reference. With more than
one table in scope, a bare `name` is ambiguous when both sides define it.

Joins compose freely with grouping:

```camussql
SELECT u.role, COUNT(*) AS cnt
FROM app_users u
JOIN posts p ON p.user_id = u.id
GROUP BY u.role
ORDER BY u.role;
```

## Outer joins

A left outer join preserves every row from the left side:

```camussql
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
ORDER BY u.email, p.title;
```

If a left row has one or more matches, CamusDB returns one row for each match.
If it has no match, CamusDB returns one row with every right-side column set to
`NULL`.

The `ON` clause decides whether a right row matches. The `WHERE` clause filters
after CamusDB has produced the joined rows. This distinction matters for outer
joins:

```camussql
-- Users without a post.
SELECT u.email
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.id IS NULL;

-- Users with a published post. The right-side WHERE predicate removes padded rows.
SELECT u.email, p.title
FROM app_users u
LEFT JOIN posts p ON p.user_id = u.id
WHERE p.published = true;
```

A `NULL` join key does not match another `NULL` join key. The comparison
`NULL = NULL` is unknown, so a row with a `NULL` join key is padded unless
another condition in `ON` matches it.

`RIGHT JOIN` runs as a left join with the operands swapped. Prefer an explicit
column list with `RIGHT JOIN`: `SELECT *` follows the executed order, so the
preserved table's columns come first.

A `RIGHT JOIN` whose left operand is itself a join is not supported. Rewrite the
query with the preserved table on the left side, often through a derived
table.

## Cross joins

`CROSS JOIN` returns the Cartesian product:

```camussql
SELECT r.name, c.currency
FROM robots r
CROSS JOIN currencies c;
```

It is equivalent to the comma form without an equality predicate. When every
source is a cross join, CamusDB can still lift an equality from the `WHERE`
clause and plan it as a join predicate.

### How joins execute

For an inner or left outer join with an equality key, the planner picks one of
three strategies:

| Strategy | CamusDB picks it when | Cost |
| --- | --- | --- |
| Indexed lookup | The right side has an index on the equality column, and the outer side is small. | One probe per outer row. |
| Hash join | The right side has no usable index, or the outer side is large compared with the indexed side. | Builds a hash table from the side estimated to be smaller (the build side), then looks up each row of the other side (the probe side) in it. |
| Merge join | Two compatible indexes already return both sides in join-key order, and the outer side is large. | Streams both sides, with no build phase. |

An equality join without an index uses a hash join rather than scanning the
inner table once per outer row. CamusDB plans a nested loop only when the join
has no usable equality key, for example `ON o.total > c.credit_limit`. An
equality between columns of different declared types, or on an array column, is
not a usable key.

An index on the right side's join column helps most when the outer side is
small, because each outer row becomes one index probe.

When a hash join grows too large, it can spill intermediate rows to disk instead
of growing memory without bound. That requires
[spill to disk](/docs/spill-to-disk). With spill to disk off, a hash join whose
build side exceeds `hash_join_max_build_rows` falls back to a nested loop.

In a cluster with [distributed queries](/docs/distributed-queries) enabled,
CamusDB can broadcast a small hash join build side to the nodes that own the
probe table's [partitions](/docs/concepts#partition) (the units the cluster
divides its data into). Those nodes probe locally and return only the matching
rows. The output is the same either way.

For a left outer join, the preserved side must remain the probe side. So
CamusDB does not use a broadcast hash join for left outer joins: a remote probe
can return matches but cannot produce the padded rows for the preserved side.

### Comma joins

For compatibility, CamusDB supports comma joins. It lifts equality predicates out
of the `WHERE` clause and treats them as join conditions. Predicates on a single
source stay filters:

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

A join input whose filter cannot use an index scans and locks the whole table's
row range, holding back writers. Index the filtered join columns to narrow that
protection. Parameters are resolved during join planning, so an indexed
`WHERE j.key = @key` can use a bounded lookup. This applies under both
pessimistic and optimistic Serializable locking. Read-only snapshots take no
such locks. See [Transactions and isolation](/docs/serializable-transactions).

## Current join limits

CamusDB does not support `FULL JOIN`, `FULL OUTER JOIN`, `NATURAL JOIN`, or
`JOIN ... USING (...)` yet. `FULL JOIN` is rejected as not supported; the other
forms are syntax errors.

A query with an outer join keeps the join order the statement declares. Neither
the heuristic planner nor the cost-based join-order search reorders a tree that
contains an outer join.

## Subqueries {#subqueries-in-where}

A subquery lets SQL use another query's answer without a separate application
request. An **uncorrelated** subquery does not reference the enclosing row;
CamusDB evaluates it once before reading the outer rows. A **correlated**
subquery references an outer column and depends on that row.

| Position | Supported subqueries |
| --- | --- |
| SELECT list (without grouping, aggregates, or window functions), SELECT WHERE | Scalar, EXISTS, IN/NOT IN, and quantified comparisons; correlated or uncorrelated. |
| UPDATE SET/WHERE, DELETE WHERE | The same correlated and uncorrelated forms, using the target row as the outer scope. |
| HAVING, JOIN ON, INSERT VALUES, ON CONFLICT DO UPDATE | Uncorrelated forms only. |
| GROUP BY or ORDER BY | Subqueries are refused with `CADB0400`. |

These rules also apply inside expressions: a `CASE` branch, function argument,
comparison, `IS NULL` test, or `BETWEEN` bound. Existing restrictions on
[CHECK definitions](/docs/check-constraints) and
[RETURNING](/docs/sql-writes#returning) still apply.

### Scalar subqueries

A scalar subquery returns one column and stands in for a single value:

```camussql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

Zero rows give `NULL`. More than one row is an error.

### Subqueries in projections and writes

Compare each product with the highest price using one statement:

```camussql
SELECT id, price, (SELECT MAX(price) FROM products) - price AS price_gap
FROM products;
```

Use a subquery to supply an inserted value:

```camussql
INSERT INTO counters (name, value)
VALUES ('orders', (SELECT COUNT(*) FROM orders));
```

An `EXISTS` can also produce a boolean in the select list or a `CASE` branch:

```camussql
SELECT id,
       CASE WHEN EXISTS (SELECT 1 FROM stock_alerts WHERE active = true)
            THEN 'check stock' ELSE 'ready' END AS status
FROM products;
```

These uncorrelated queries run once, not once per product. Subqueries can
also appear in a derived table's projection or a view body. Correlated
subqueries in HAVING, JOIN ON, ON CONFLICT DO UPDATE, or a grouped,
aggregate, or windowed SELECT list are refused with CADB0533.

### Correlated values

A correlated subquery can compute a value for each outer row without a
separate request from your application:

```camussql
SELECT u.id,
       (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count,
       EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id) AS has_posts
FROM app_users u;

UPDATE app_users
SET post_count = (SELECT COUNT(*) FROM posts p WHERE p.user_id = app_users.id)
WHERE active = true;
```

Correlated scalar subqueries return NULL for no rows and fail if more than
one row is read. IN/NOT IN and ANY/SOME/ALL also accept correlated bodies,
with their usual [NULL and empty-set rules](/docs/sql-expression-syntax#null-rules).
A scalar subquery inherits its inner output name, but an explicit alias
makes the result clearer to callers and stored definitions.

Names resolve in the nearest query first, then in enclosing queries. An
inner column or alias can hide an outer name; qualify columns to make the
intended scope clear. In UPDATE and DELETE, correlated bodies read the target
and other tables at the statement timestamp, so they do not observe changes
made earlier by the same statement.

A correlated subquery's value error is raised only if the surrounding
expression uses that value. An unused CASE branch or COALESCE fallback can
therefore skip that error. Name and known type errors still fail before rows
are read.

`EXPLAIN` evaluates uncorrelated subqueries while preparing the plan, so even
plain `EXPLAIN` can read data for an inner query. It does not run the outer
query. See [EXPLAIN](/docs/explain).

### IN and NOT IN

`IN` and `NOT IN` accept a correlated or uncorrelated subquery that returns
exactly one column:

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

When the inner query is indexed and eligible, CamusDB runs a semi-join for `IN`
(keeping each outer row with at least one match) and an anti-join for `NOT IN`
(keeping each outer row with no match), instead of materializing the full inner
result first.

`NOT IN` follows SQL null semantics. A single `NULL` in the inner result makes
every non-matching row evaluate to unknown. CamusDB drops those rows, and the
query commonly returns zero rows. An empty inner result makes NOT IN true,
even for a NULL outer value; the inner WHERE determines whether that result
is empty. Use `NOT EXISTS` when the inner column accepts
`NULL`.

CamusDB rejects multi-column IN or NOT IN subqueries. Correlated forms run
against each outer row; the semi-/anti-join rewrite above is for eligible
uncorrelated forms.

### EXISTS

`EXISTS` works with or without correlation. Only whether a row exists matters, so
the inner projection can be `*`, one column, or several columns:

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

For an ordinary EXISTS body, the select list, DISTINCT, GROUP BY, and ORDER BY
are discarded because only row existence matters. For example,
`EXISTS (SELECT 1 / 0 FROM posts)` does not divide by zero. Unknown names and
known type mistakes in discarded clauses still fail. Aggregates, HAVING,
OFFSET, and LIMIT 0 can change whether a row exists, so they retain their
meaning; LIMIT 0 returns false without reading rows.

A correlated EXISTS body can use joins, views, derived tables, set operations,
aggregates, GROUP BY, HAVING, window functions, OFFSET, and nested subqueries.
It can also omit FROM and read only outer values. LIMIT 0 is false; negative
LIMIT or OFFSET is an error.

These bodies work in SELECT WHERE and eligible SELECT lists, UPDATE SET/WHERE,
and DELETE WHERE. They can appear inside a CASE or comparison. An outer name
inside a table-function argument is not supported. In a join, correlation is
evaluated where all referenced outer aliases are available.

For a correlated `EXISTS`, CamusDB uses an index on the inner table when the
inner `WHERE` clause pins the index's leading columns with equalities. The other
side of each equality can be an outer-row value, a literal, or a parameter:

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

For a simple one-table EXISTS body, the index narrows candidate rows and the
full predicate still runs after the seek. More complex bodies use the full
query pipeline. Results may be reused for repeated outer values within one
statement; see [correlated subquery planning](/docs/query-planning#correlated-subqueries).

## Derived tables

A derived table is a parenthesized `SELECT` inside the `FROM` clause. It needs an
alias:

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
table against per-group aggregates:

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

The inner query can use `IN`, `NOT IN`, scalar subqueries in its `WHERE`, and
correlated or uncorrelated `EXISTS`/`NOT EXISTS`, including under an outer
aggregate:

```camussql
SELECT COUNT(*)
FROM (
  SELECT u.id FROM app_users u
  WHERE EXISTS (SELECT 1 FROM posts p WHERE p.user_id = u.id)
) AS authors;
```

These subqueries also work inside set-operation operands. They use the
caller's privileges in a direct query, or the view owner's privileges inside
a stored view body.

A derived table's columns take their names from the inner projection. Give
every computed column an alias, as in `COUNT(*) AS post_count`, or the outer
query has no usable name to reference.

## Check the plan

Plan choice matters most for queries with several sources. `EXPLAIN` shows the
chosen join strategy and whether CamusDB used an index:

```camussql
EXPLAIN SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id;
```

See [EXPLAIN](/docs/explain) for the output reference and
[Query Planning](/docs/query-planning) for the rules behind the choice.
