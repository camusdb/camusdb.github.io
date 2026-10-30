---
sidebar_position: 2.4
---

# SELECT

`SELECT` reads rows from a table and shapes them: you choose the columns, then
filter, group, sort, and paginate the rows.

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC
LIMIT 25;
```

This page covers reading from a single table and combining query results.
For joins, subqueries, and
derived tables, see [Joins And Subqueries](/docs/joins-and-subqueries). For a
`SELECT` with no table at all, such as `SELECT 1 + 1`, see
[SELECT Without FROM](/docs/sql-fromless-select). To combine query results with
`UNION`, `INTERSECT`, or `EXCEPT`, see
[Combine query results](/docs/sql-queries#set-operations).

## Clause order

You must write the clauses in this order, and CamusDB evaluates them in roughly
the same order:

```camussql
SELECT   [DISTINCT] projections
FROM     source [AS OF SYSTEM TIME ...] [@{hint}]
WHERE    row_filter
GROUP BY keys
HAVING   group_filter
ORDER BY sort_keys
LIMIT    n OFFSET m
```

In practice, `WHERE` filters input rows before grouping, and `HAVING` filters
the grouped rows after it.

`ORDER BY`, `LIMIT`, and `OFFSET` apply last, to the projected result, so they
can reference output aliases.

## Select the columns

```camussql
SELECT * FROM robots;
SELECT id, name FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT upper(trim(name)) AS display_name FROM robots;
```

You can project any scalar expression, including function calls and
arithmetic.

`AS` names the output column. Without `AS`, CamusDB derives the output name from
the expression itself. See [Functions](/docs/functions) for the
available scalar functions.

### DISTINCT

`DISTINCT` removes duplicate output rows after projection. Two `NULL` values
count as equal.

```camussql
SELECT DISTINCT kind FROM robots ORDER BY kind;
SELECT DISTINCT kind, year FROM robots ORDER BY kind, year;
```

CamusDB does not support these shapes today:

| Not supported | Reason |
| --- | --- |
| `COUNT(DISTINCT column)` | CamusDB does not implement distinct aggregates. |
| `SELECT DISTINCT ... GROUP BY ...` | Grouping already produces distinct keys. |
| `SELECT DISTINCT COUNT(*)` | `DISTINCT` cannot wrap an aggregate projection. |

When a compatible `NOT NULL` index covers the distinct columns, the planner
streams the distinct values from that index without building a hash table.
[`EXPLAIN`](/docs/explain) shows which path CamusDB used.

### CASE expressions

`CASE` picks a value based on conditions. The searched form evaluates its
predicates in order:

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

The simple form compares one expression against each `WHEN` value:

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

The first match wins. A `WHEN` condition that evaluates to `NULL` does not
match. If nothing matches and there is no `ELSE`, the result is `NULL`.

`CASE` is a scalar expression, so it works anywhere a scalar expression does,
including inside an aggregate. That is the usual way to write a conditional
total:

```camussql
SELECT SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS paid_total
FROM orders;
```

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
| Boolean | `AND`, `OR`, and a bare boolean column, such as `WHERE enabled` |
| Pattern matching | `LIKE`, `ILIKE`, `~`, `~*`, `!~`, `!~*` |
| Null checks | `IS NULL`, `IS NOT NULL` |
| Membership | `IN (...)`, `NOT IN (...)`, `IN (SELECT ...)`, `NOT IN (SELECT ...)` |
| Existence | `EXISTS (SELECT ...)` |

`BETWEEN` is inclusive, so `year BETWEEN 2001 AND 2004` matches 2001, 2004, and
every year in between.

### Pattern matching

`LIKE` and `ILIKE` use the wildcards `%` and `_`. `ILIKE` is case-insensitive.

Use a regular expression operator when wildcards are not enough:

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

Patterns are unanchored: they match anywhere in the value unless you write `^`
and `$`.

Both operands must be strings. When either operand is `NULL`, the result is
unknown, so the row does not pass a `WHERE` clause.

The engine is the .NET regular expression engine. Case-insensitive matching uses
the invariant culture. Character classes, quantifiers, anchors, alternation, and
groups all work. Use `\p{L}` or `[a-zA-Z]`, not POSIX classes such as
`[[:alpha:]]`.

A malformed pattern raises `CADB0400 InvalidInput`. Every match runs under an
internal timeout, so a pathological pattern fails instead of hanging.

To extract or replace with a regular expression rather than filter, see
[Regex Functions](/docs/functions-regex).

### IN lists

```camussql
SELECT id, name FROM robots WHERE year IN (2020, 2022, 2024);
SELECT id, name FROM robots WHERE status NOT IN ('deleted', 'archived');
SELECT id, name FROM robots WHERE id IN (@id1, @id2, @id3);
```

On an indexed column, the planner turns a value list into repeated index probes
instead of a scan. That pays off for small and moderate-sized lists.

`NOT IN` follows SQL null semantics. A `NULL` in the list makes every
non-matching comparison evaluate to unknown, and CamusDB filters those rows out.
So `NOT IN` against a set containing `NULL` often returns fewer rows than you
expect.

`IN` also accepts a subquery. See
[Joins And Subqueries](/docs/joins-and-subqueries).

## Aggregate the rows

| Function | Behavior |
| --- | --- |
| `COUNT(*)` | Counts every row. |
| `COUNT(column)` | Counts non-null values. |
| `SUM(column)` | Adds numeric values, ignoring nulls. `NUMERIC` input returns `NUMERIC`; `INT64` input returns `INT64`; `FLOAT64` input returns `FLOAT64`. |
| `AVG(column)` | Returns a `NUMERIC` average for `NUMERIC` input, otherwise `FLOAT64`. Ignores nulls. |
| `MIN(column)` | Returns the smallest non-null value. |
| `MAX(column)` | Returns the largest non-null value. |

Without `GROUP BY`, an aggregate reduces the whole table to one row:

```camussql
SELECT COUNT(*), SUM(year), AVG(year), MIN(year), MAX(year)
FROM robots;
```

### GROUP BY

`GROUP BY` accepts columns and expressions:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role;

SELECT role, department, COUNT(*) AS cnt
FROM app_users
GROUP BY role, department;

SELECT year + 100 AS display_year
FROM robots
GROUP BY year + 100;
```

Standard projection rules apply: every non-aggregate projection must appear in
the `GROUP BY`. So `SELECT name, COUNT(*) FROM robots` is an error; add
`GROUP BY name` to fix it.

### HAVING

`HAVING` filters after aggregation. It can reference an aggregate alias, an
aggregate expression, or a group key:

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY role;

SELECT COUNT(*) AS total
FROM robots
HAVING total > 0;
```

`HAVING` needs a `GROUP BY` or an aggregate projection. To filter input rows
rather than groups, use `WHERE`. It runs first, so it gives the aggregate less
work.

## Sort and paginate {#sort-the-rows-and-divide-them-into-pages}

```camussql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

`ASC` is the default. `LIMIT` and `OFFSET` accept a literal integer or a
placeholder, such as `LIMIT @limit`.

In a grouped query, `ORDER BY` can reference a selected aggregate's alias, an
aggregate expression, or a grouped expression.

```camussql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
ORDER BY cnt DESC, role;
```

An alias in `ORDER BY` takes precedence over a base column with the same name.
In a query without `GROUP BY`, an `ORDER BY` expression can also read a column
that the `SELECT` list does not project.

CamusDB refuses two `ORDER BY` shapes with `CADB0400 InvalidInput`:

- An aggregate function in `ORDER BY` without a `GROUP BY` clause.
- In a grouped query, a computed expression that is in neither the `SELECT` list
  nor the `GROUP BY` clause. A grouped query sorts after projection, so the base
  columns the expression names no longer exist at that point. Project the value
  first, then sort by its alias.

When an index already provides the requested order, the planner skips the sort
entirely. So `ORDER BY` with `LIMIT` on an indexed column is much cheaper than
sorting the whole table. See
[Query Planning](/docs/query-planning).

## Lock rows before updating them {#for-update}

Use `SELECT ... FOR UPDATE` when an application reads a row, decides what to
change, and writes it in the same transaction. It takes the exclusive row lock
used by UPDATE and DELETE, and holds it until commit or rollback:

```camussql
BEGIN;
SELECT sku, quantity FROM inventory WHERE sku = @sku FOR UPDATE;
UPDATE inventory SET quantity = quantity - @sold
WHERE sku = @sku AND quantity >= @sold;
COMMIT;
```

Place the clause last, after `ORDER BY`, `LIMIT`, and `OFFSET`:

```camussql
SELECT id FROM jobs WHERE state = 'ready' ORDER BY id LIMIT 10
FOR UPDATE OF jobs NOWAIT;
```

`OF` optionally names the table or its alias. `FOR NO KEY UPDATE` is a synonym;
`FOR SHARE` and `FOR KEY SHARE` are unsupported.

### Choose how to handle held rows

| Option | When another transaction holds the row |
| --- | --- |
| `FOR UPDATE` | Fails with retryable `CADB0502` (`TransactionConflict`), as an UPDATE would. |
| `FOR UPDATE NOWAIT` | Fails with `CADB0555` (`LockNotAvailable`), which is not automatically retried. |
| `FOR UPDATE SKIP LOCKED` | Omits the held row and continues looking for eligible rows. |

A commit already finishing replication or settlement is treated differently
from an actively held lock: the statement can briefly wait for that commit,
even with `NOWAIT`. Any statement failure ends its transaction; there are no
savepoints.

For queue workers, use Read Committed and pessimistic locking. Select free
jobs, then update the returned ids before committing:

```camussql
BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT id FROM jobs WHERE state = 'ready' ORDER BY id LIMIT 1
FOR UPDATE SKIP LOCKED;
-- Bind the returned id as @job_id; if no row was returned, skip the UPDATE.
UPDATE jobs SET state = 'running' WHERE id = @job_id;
COMMIT;
```

`SKIP LOCKED` is refused at Serializable (`CADB0533`): its scan's shared range
locks would make workers conflict when updating their separate jobs. Plain
`FOR UPDATE` and `NOWAIT` work at both isolation levels. At Serializable a
range scan can hit a predicate-lock conflict before reaching the row-lock
step, producing `CADB0502` even with `NOWAIT`.

### Returned values and lock scope

CamusDB scans and sorts candidates, locks them in pages, then reads their
latest committed values and checks `WHERE` again. Deleted or no-longer-matching
rows are dropped. Skipped held rows and dropped rows do not consume `LIMIT`
or `OFFSET`; later eligible rows fill the result.

Locks already acquired remain until the transaction ends, including locks on
rows dropped by the recheck or skipped by `OFFSET`. Paging avoids locking
candidates beyond what `LIMIT` plus `OFFSET` requires. A concurrent change to
an ordering column can leave a row in its earlier sort position even though
its returned value is newer.

Ordinary SELECT reads remain available; another writer or locking read must
respect these row locks. A later UPDATE or DELETE in the same transaction
can use the locks it already owns.

### Restrictions and autocommit

The statement requires `SELECT` and `UPDATE` privileges on one ordinary table.
Read-only or optimistic transactions are refused with `CADB0400`. Joins,
views, materialized views, derived tables, table functions, grouping,
aggregates, `DISTINCT`, set operations, and historical reads are unsupported.
The clause is top-level only: it cannot appear inside subqueries, view bodies,
`INSERT ... SELECT`, or `CREATE TABLE ... AS SELECT`.

In autocommit, REST and gRPC run a locking read in a writable transaction,
commit before sending rows, and release its locks when the statement ends.
Use an explicit transaction to protect a later write. For autocommit
`SKIP LOCKED`, set the request isolation to Read Committed; the server default
is Serializable.

Plain `EXPLAIN` plans a locking read without taking locks. `EXPLAIN (ANALYZE)`
executes it and takes real locks. See [locking-read plans](/docs/explain#locking-reads).

## Combine query results {#set-operations}

Use `UNION`, `INTERSECT`, and `EXCEPT` to combine rows from separate queries
without merging them in application code. For example, combine current and
archived orders, find customers in both campaigns, or exclude customers who
already received an offer.

```camussql
SELECT customer_id FROM current_orders
UNION
SELECT customer_id FROM archived_orders;
```

`UNION` returns each customer once. Use `UNION ALL` when repeated rows matter
or when you know the inputs do not overlap and want to avoid deduplication.

### Choose an operation

Rows match by their values at each column position. For set operations,
NULL matches NULL, unlike the comparison `NULL = NULL`.

| Operation | Result | Copies when the left has m matching rows and the right has n |
| --- | --- | --- |
| `UNION` | Rows found in either query, without duplicates. | 1 if m + n is greater than 0 |
| `UNION ALL` | Every row from both queries. | m + n |
| `INTERSECT` | Rows found in both queries, without duplicates. | 1 if both m and n are greater than 0 |
| `INTERSECT ALL` | Rows shared by both inputs, preserving matching copies. | min(m, n) |
| `EXCEPT` | Left rows absent from the right, without duplicates. | 1 if m is greater than 0 and n is 0 |
| `EXCEPT ALL` | Left rows after subtracting matching right copies. | max(m − n, 0) |

Plain operators default to `DISTINCT`. An explicit `UNION DISTINCT`,
`INTERSECT DISTINCT`, or `EXCEPT DISTINCT` has the same meaning as the plain
form. Without `ORDER BY`, result order is undefined.

For example, find customers eligible for a campaign who have not opted out:

```camussql
SELECT customer_id FROM campaign_members
EXCEPT
SELECT customer_id FROM email_opt_outs;
```

### Match columns and types

Both queries must return the same number of columns. Columns match by
**position**, and output names come from the leftmost query. Incompatible
column counts or types fail with `CADB0400` (`InvalidInput`) before reading rows.

| Input types at the same position | Output type |
| --- | --- |
| Same type | That type. |
| NULL literal or placeholder on one side | The other side's type. |
| Two numeric types | Their common arithmetic type; for example, `INT64` plus `FLOAT64` becomes `FLOAT64`. |
| `DATE` and `DATETIME` | `DATETIME`. |
| Other incompatible pairs | Error naming the column position and types. |

Values are converted before comparison. `SELECT 1 UNION SELECT 1.0` therefore
returns one row. A column containing only untyped NULLs is exposed as `STRING`,
but can still take the other operand's type in an enclosing set operation.

### Precedence and pagination

`INTERSECT` binds more tightly than `UNION` and `EXCEPT`. `UNION` and `EXCEPT`
group from left to right. Use parentheses to make another grouping explicit:

```camussql
-- Intersection first: returns 1 and 2.
SELECT 1 AS id UNION SELECT 2 INTERSECT SELECT 2;

-- Parentheses change the grouping: returns only 2.
(SELECT 1 AS id UNION SELECT 2) INTERSECT SELECT 2;
```

An `ORDER BY`, `LIMIT`, or `OFFSET` after the last query applies to the combined
result. Parenthesize a query to give it its own clauses:

```camussql
(SELECT customer_id FROM current_orders ORDER BY customer_id LIMIT 5)
UNION ALL
SELECT customer_id FROM archived_orders
ORDER BY 1 LIMIT 10 OFFSET 2;
```

The combined `ORDER BY` accepts an output column name or a 1-based position.
Expressions such as `ORDER BY id + 1` are refused; wrap the operation in a
derived table to sort by an expression. A parenthesized query cannot take a
second set of trailing clauses: keep them inside the parentheses or use a
derived table.

### Use combined results elsewhere

Set operations work as statements, derived tables, subqueries, `INSERT ...
SELECT` sources, and `CREATE TABLE ... AS SELECT` sources:

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

Each query needs `SELECT` on its own tables, including tables read by a
subquery in an operand's `WHERE`. These nested subqueries use the caller's
privileges in a statement and the owner's in a view body. All operands share
the statement's snapshot; an operand with its own `AS OF SYSTEM TIME` is refused.

#### Views

A [view](/docs/views) or [materialized view](/docs/materialized-views) can store
a set operation as its body:

```camussql
CREATE VIEW all_order_customers AS
SELECT customer_id FROM current_orders
UNION
SELECT customer_id FROM archived_orders;
```

At creation, each operand's `*` expands to its current columns. Later columns
do not change the stored output. Names are pinned on the leftmost operand;
dependencies include the tables and columns of both operands. Renames follow
their stored identities, while dropping a dependency is refused.

For a set operation nested inside a derived table or subquery of a view body,
write explicit columns: `*` in those operands is refused because it cannot be
frozen safely. `SHOW CREATE VIEW` preserves grouping with parentheses.

### Execution and limits

`UNION ALL` streams its operands without a deduplication buffer; an outer
`LIMIT` can stop them early. `UNION` uses the `DISTINCT` operator. `INTERSECT`
and `EXCEPT` build a hash table of right-side row counts, then read the left
side using the copy rules above. Distinct `EXCEPT` also tracks emitted rows.

With [spill to disk](/docs/spill-to-disk) enabled, `UNION` can spill through
`DISTINCT`. `INTERSECT` and `EXCEPT` partition both inputs into spill files when
the right-side hash table reaches `spill_threshold_rows` distinct rows or
`spill_threshold_bytes`. Each partition pair is processed in memory and is
not subdivided further. With spill off, hash tables stay in memory.

`EXPLAIN` shows `union`, `intersect`, or `except`, followed by `operand` rows
for the left and right plans. `EXPLAIN (ANALYZE)` measures both operand plans;
the operation's row count is the combined output. The operation's estimate is
a default derived-table estimate, rather than an estimate of overlap.

The plan cache includes both operands, the operator, and the `ALL` flag. The
combined result is not stored in the query-result cache.

Long chains of the same associative operator (`UNION`, `UNION ALL`,
`INTERSECT`, or `INTERSECT ALL`) are rebalanced. `EXCEPT` and mixed-operator
chains cannot use that optimization. Set-operation nesting is limited to 64
levels; deeper statements fail with `CADB0413` (`StatementTooDeeplyNested`).
Common table expressions (`WITH`) and `CORRESPONDING BY` are unsupported.

## Read a past snapshot

`AS OF SYSTEM TIME` reads a consistent historical snapshot. Write it after the
`FROM` source and before the `WHERE` clause:

```camussql
SELECT id, name, year
FROM robots AS OF SYSTEM TIME '-10s'
WHERE year >= 1970
ORDER BY year DESC;
```

The clause applies to read-only statements in autocommit mode. It pins the
whole statement, including every join and subquery, to one timestamp. See
[Time-Travel Reads](/docs/time-travel-reads) for the accepted formats and
retention limits.

## Force an index

If you know an index suits a predicate better than the planner's estimate
suggests, name it:

```camussql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

Confirm the effect with [`EXPLAIN`](/docs/explain) before you leave a hint in
production code. A hint can outlive the data distribution you tuned it for, and
then it does more harm than good.

## Parameters

Placeholders can stand in for values in filters and pagination:

```camussql
SELECT id, name
FROM robots
WHERE id = @id
LIMIT @limit;
```

The client that submits the statement binds the values. See
[Parameters And Prepared Statements](/docs/prepared-statements).
