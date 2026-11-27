---
sidebar_position: 2.2
---

# Indexes

An index is a sorted copy of one or more columns of a table, with a pointer to
each row. With an index, CamusDB can find the rows that match a value, and it
doesn't need to read the table.

## What an index speeds up, and what it costs

If no index matches, a query that filters on a column reads all the rows of the
table. This cost grows with the table. An index can speed up lookups and
enforce uniqueness.

- A lookup of the rows with one value, such as `WHERE email = @email`.
- A range of values, such as `WHERE created_at >= @since`.
- An `ORDER BY` with a `LIMIT`, such as the 20 newest rows. CamusDB reads the
  index in order, and it can stop after 20 rows.
- A uniqueness check. A unique index returns an error for a duplicate.

However, each write must also update the indexes of the table. This means that
writes are slower, and the table uses more storage. You should add indexes for
queries that execute often or must be fast.

To see whether a query uses an index, use [`EXPLAIN`](/docs/explain). To find
the indexes that queries don't use, see [Index usage](/docs/index-usage).

## Indexes that CamusDB creates for you

A primary key creates an index, and a unique column creates one too. You can
add more indexes with `CREATE INDEX` or `ALTER TABLE`.

## Create an index

```camussql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);
```

A unique index on several columns enforces uniqueness of their combined values.

```camussql
CREATE UNIQUE INDEX robots_kind_year_uq ON robots (kind, year);
```

On a populated table, an ordered index build reads existing rows before the index is
available to queries. In standalone and cluster mode, schema changes on other
tables can proceed during that scan. Schema changes on the indexed table wait.
For more information, see [Backfill](/docs/distributed-schema#backfill).

## Index column order

Each index column can have `ASC` or `DESC`. The default is `ASC`.

```camussql
CREATE INDEX robots_year_asc_idx ON robots (year ASC);
CREATE INDEX robots_year_desc_idx ON robots (year DESC);
CREATE INDEX robots_kind_year_idx ON robots (kind ASC, year DESC);
```

The order matters for `ORDER BY`. CamusDB scans an index forward. This means
that the direction of the query must match the direction of the index. Then the
planner can return rows in index order.

```camussql
CREATE INDEX robots_year_desc_idx ON robots (year DESC);

SELECT *
FROM robots
ORDER BY year DESC;
```

This index serves `ORDER BY year DESC`. For `ORDER BY year ASC`, the query needs
an ascending index or a sort.

For a composite index, the `ORDER BY` columns and directions must match a prefix
of the index, from left to right. For example, `(kind ASC, year DESC)` serves
`ORDER BY kind ASC, year DESC`.

Descending columns are supported for fixed-width types, such as `INT64`,
`DATETIME`, and `UUID`. A descending `STRING` or `BYTES` column returns
`CADB0400`. An `ARRAY(T)` column can't be an index key.

## Index DDL in ALTER TABLE

```camussql
ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_year_uq (code, year);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_uq (code) INCLUDE (name);
ALTER TABLE robots ADD INDEX robots_kind_idx (kind) INCLUDE (name, year);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Drop an index

Dropping a secondary index preserves its table and rows.

```camussql
DROP INDEX robots_year_idx ON robots;
DROP INDEX IF EXISTS robots.robots_year_idx;
ALTER TABLE robots DROP INDEX IF EXISTS robots_year_idx;
```

The three forms do the same thing. Index names are unique in a table. This means
that `DROP INDEX` needs the table, and `DROP INDEX robots_year_idx` returns
`CADB0400`. If the table name has a dot, use the `ON` form.

`IF EXISTS` skips a missing index or table, but it doesn't skip dependencies. An
index that a foreign key uses can't be dropped. It returns `CADB0530` until you
drop the constraint. For a primary key, use `ALTER TABLE ... DROP PRIMARY KEY`.

## Rename an index

```camussql
ALTER TABLE robots RENAME INDEX robots_name_idx TO robots_display_name_idx;
```

A rename changes the name in the schema, and it keeps the index data. It needs
the `ALTER` privilege. A rename of an index that doesn't exist, or to a name
that exists, returns `CADB0400`.

## Expression indexes

Index a computed value to speed up queries that filter or sort by that value.
For example, use `lower(email)` to look up an email address regardless of case.
A unique index also prevents two rows from storing the same normalized address.

```camussql
CREATE UNIQUE INDEX users_lower_email ON users ((lower(email)));

SELECT id FROM users WHERE lower(email) = 'alice@example.com';
```

An ordered index can mix expressions and columns in its key. Wrap each
expression in parentheses. A function call can also be written directly as a
key part, as in `CREATE INDEX users_lower_email ON users (lower(email))`.
You can use expressions in `ALTER TABLE ... ADD INDEX` and inline `KEY` or
`UNIQUE KEY` definitions.

An expression must use values from the indexed row and return a type with an
ordered key encoding. Its function calls must be immutable built-ins. For
example, `doc ->> 'email'` can be indexed as text. A clock function or a
subquery returns `CADB0423`. The same applies to
[time-zone arguments](/docs/functions-datetime#time-zones). Primary and GIN
keys take column names. The `INCLUDE` list also takes column names.

Use the same expression in the query as in the index definition. The planner
can match it in `WHERE` comparisons and `ORDER BY`. Check the
[EXPLAIN](/docs/explain) detail for `expressions=[...]`. Expression keys lack
statistics. Join lookups and streaming `GROUP BY` or `DISTINCT` use column
keys.

A unique expression index allows multiple NULL results. To target it in an
upsert, use `ON CONFLICT ON CONSTRAINT index_name`.
`ON CONFLICT DO NOTHING` also checks it when you omit the conflict target.

`SHOW INDEXES` returns the SQL key list in its `Key` column. Use that field
when rebuilding an index, as expressions can contain commas. `SHOW CREATE TABLE`
includes expression indexes in the table definition. Drop an affected index
before dropping a column that its expression reads.

You can index a [sized cast](/docs/data-types#casting-to-a-length). Use the
same target length in the query to let the planner match the expression.

During a rolling upgrade, wait until all nodes support expression indexes
before creating one. An older node cannot write to an expression index.

Rebuild expression indexes created by an earlier build if they use a
[common result type](/docs/data-types#conditional-result-types) across columns
of different types. The old index can contain keys computed from the values
of individual rows. For example, when `i` is an integer and `f` is a float,
`COALESCE(i, f) / 4` gives `0.5` for `i = 2, f = NULL`. An older index can
store `0` for that row. Use `DROP INDEX` and `CREATE INDEX` to rebuild it.

## Covering indexes

A covering index stores extra columns with each entry of a secondary index.
Those columns aren't part of the index key. When a query needs only the key and
the included columns, CamusDB returns the result from the index, and it doesn't
fetch the row.

Use a covering index for a frequent read that filters on some columns and
returns a few other columns.

### Create a covering index

Add `INCLUDE (...)` after the key columns.

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total, created_at);
```

`customer_id` is the index key. It controls the order of the index and the
bounds of a scan. The included columns are stored values. They don't change the
order, and a search can't use them as key columns.

A unique index can also include columns.

```camussql
CREATE UNIQUE INDEX users_email_idx
ON users (email)
INCLUDE (display_name, status);
```

`UNIQUE` applies to the key columns. In this example, `email` must be unique,
and the included columns aren't part of the constraint.

### Inline syntax

To declare a covering index in `CREATE TABLE`, add `INCLUDE (...)` to the key.

```camussql
CREATE TABLE orders (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  customer_id INT64 NOT NULL,
  status STRING(32) NOT NULL,
  total FLOAT64 NOT NULL,
  KEY orders_customer_idx (customer_id) INCLUDE (status, total)
);
```

You can also add one with `ALTER TABLE ... ADD INDEX`. See
[Index DDL in ALTER TABLE](#index-ddl-in-alter-table). To change the included
columns of an index, drop the index and create it again.

### Covered queries

A query is covered when the index has all the columns that the query needs, in
its key or in its included columns.

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 17;
```

`orders_customer_idx` covers this query. Selecting `note` requires a row
fetch.

```camussql
SELECT customer_id, status, note
FROM orders
WHERE customer_id = 17;
```

CamusDB can use the index to find the matching rows. However, it must fetch
each row to read `note`.

### Rules and limits

- An included column must exist in the table.
- An included column can't also be a key column of the same index.
- An included column can't have `ASC` or `DESC`. It isn't ordered.
- An included column can be `NULL`.
- An included column can have any column type, also `BYTES` and `ARRAY(T)`. It
  is stored in the value of the entry, and it isn't encoded in the key.
- A condition on an included column filters the entries, and it doesn't bound
  the scan. To search by a column, put it in the key.
- A primary key doesn't support `INCLUDE`. The row already has all the columns.
- A column that an index uses can't be dropped, also an included column. Drop
  or change the index first.
- An index can have at most 32 columns, key and included columns together
  (`max_index_columns`).
- The encoded included values of one entry are limited to 4 KiB
  (`max_index_include_tuple_bytes`).

For these settings, see the [settings reference](/docs/settings-reference). A
value of `0` or less turns off the limit.

### Inspect the schema

`SHOW INDEXES` shows the included columns, and `SHOW CREATE TABLE` shows the
`INCLUDE (...)` clause.

```camussql
SHOW INDEXES FROM orders;
SHOW CREATE TABLE orders;
```

### Read the plan with EXPLAIN

`EXPLAIN` shows `index-only=true` on a covered scan. `EXPLAIN (ANALYZE)` also
shows `rows_read = 0` on the scan when it fetches zero rows from the table.

```camussql
EXPLAIN (ANALYZE)
SELECT customer_id, status, total
FROM orders
WHERE customer_id = 17;
```

## GIN indexes for JSON documents

An ordered index can't index a `JSONB` column. To search in JSON documents,
create a GIN index (generalized inverted index). It maps each key and value of
each document to the rows that have it.

```camussql
CREATE INDEX events_payload_gin ON events USING GIN (payload);

SELECT id FROM events WHERE payload @> '{"kind": "login"}';
```

The planner uses a GIN index for containment (`@>`), key tests such as `?`, and
equality on one field, such as `payload ->> 'kind' = 'login'`. A GIN index has
exactly one `JSONB` column. It can't have `INCLUDE` columns or `DESC`.
`SHOW INDEXES` shows the index type `GIN`.

For the other forms and the write cost, see [GIN indexes](/docs/json#gin-indexes).

## Query plans

An index scan can serve a single lookup or drive more of the query plan.

- Point lookups.
- Range scans.
- Indexed `IN (...)` probes.
- Ordered scans.
- Indexed joins.
- Index-only reads through `INCLUDE` columns.
- Searches in `JSONB` documents, through a
  [GIN index](#gin-indexes-for-json-documents).

For planner behavior, see [Query planning](/docs/query-planning). For query
examples that use indexes, see [SELECT](/docs/sql-queries) and
[Joins and subqueries](/docs/joins-and-subqueries).

## Permissions

To create or drop an index, you need the `INDEX` privilege on the table.
