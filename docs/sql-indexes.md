---
sidebar_position: 2.2
---

# Indexes

A primary key creates an index. A unique column also creates one. You can add
another index with `CREATE INDEX`, or with `ALTER TABLE`.

## Create an index

```camussql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);
```

CamusDB supports a unique index over several columns:

```camussql
CREATE UNIQUE INDEX robots_kind_year_uq ON robots (kind, year);
```

Create a covering index with `INCLUDE (...)`. Use it when a common query filters
by the key of the index, and also returns a few more columns:

```camussql
CREATE INDEX robots_kind_idx
ON robots (kind)
INCLUDE (name, year);
```

The key columns of the index drive four things: a lookup, a scan of a range, the
order, and the uniqueness. CamusDB stores an included column with each entry of
the index. A covered query can therefore avoid a fetch of the primary row.

## Covering indexes

A covering index lets a secondary index store more columns with each entry.
Those columns are not part of the key.

A query can need only the key of the index and those included columns. CamusDB
can then return the result without a fetch of the primary row.

Use a covering index for a hot path of reads. Such a path filters by one set of
columns, and it returns a small stable set of other columns.

### Create a covering index

Add `INCLUDE (...)` after the key columns of the index:

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total, created_at);
```

`customer_id` is the key of the index. It controls the order, the scans of a
range, and the bounds of a lookup.

`status`, `total`, and `created_at` are stored columns of the payload. They do
not affect the order of the index. You cannot search them as a key column.

A unique index can also include a column of the payload:

```camussql
CREATE UNIQUE INDEX users_email_idx
ON users (email)
INCLUDE (display_name, status);
```

`UNIQUE` applies to the key columns only. In the example above, CamusDB enforces
the uniqueness on `email`. `display_name` and `status` take no part in the
constraint of the uniqueness.

### The inline syntax, and the ALTER TABLE syntax

You can declare a covering index inside `CREATE TABLE`:

```camussql
CREATE TABLE orders (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  customer_id INT64 NOT NULL,
  status STRING(32) NOT NULL,
  total FLOAT64 NOT NULL,
  KEY orders_customer_idx (customer_id) INCLUDE (status, total)
);
```

You can also add one with `ALTER TABLE`:

```camussql
ALTER TABLE orders
ADD INDEX orders_customer_idx (customer_id) INCLUDE (status, total);

ALTER TABLE users
ADD UNIQUE INDEX users_email_idx (email) INCLUDE (display_name, status);
```

To change the included columns of an existing index, drop that index. Then
create it again, with the `INCLUDE` list that you want.

### A covered query

A query is covered when the index gives every column that the query needs. Those
columns come from the key of the index, or from the included columns of the
payload.

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

`orders_customer_idx` can answer the query above. `customer_id` is the key.
`status` and `total` are included columns of the payload.

The next query is not covered. `note` is not a key column, and it is not an
included column:

```camussql
SELECT customer_id, status, note
FROM orders
WHERE customer_id = 42;
```

CamusDB can still use the index to find the matching rows. It must nevertheless
fetch the primary row, to read `note`.

### Read the plan with EXPLAIN

Use `EXPLAIN (ANALYZE)` to confirm the covered path:

```camussql
EXPLAIN (ANALYZE)
SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

For a covered lookup, and for a covered scan of a range, the node of the scan
reports `rows_read = 0`. CamusDB fetched no primary row after the read of the
index entry.

### The rules and the limits of a covering index

- An included column must exist on the table.
- An included column cannot also be a key column of the same index.
- An included column cannot state `ASC` or `DESC`. It is payload without an
  order.
- An included column can hold a `NULL`.
- An included column can use any column type that CamusDB can store. That
  includes `BYTES` and `ARRAY(T)`, because CamusDB stores the column in the
  value of the index, not in the ordered key.
- A predicate on an included column is a filter. It is not a bound of the index.
  Put a column in the key of the index to search by that column.
- A primary key does not support `INCLUDE`. The primary row already holds the
  full row.
- CamusDB rejects a drop of a column that an index uses. That rule covers a key
  column, and a column of an `INCLUDE` list. Drop the index first, or create it
  again.
- One index can span 32 columns at most. That total counts the key columns and
  the included columns together.
- The encoded payload of the included columns is limited to 4 KiB, for each
  entry of the index.

Two settings control these limits: `max_index_columns` and
`max_index_include_tuple_bytes`. See [Configuration](/docs/configuration). A
value of `0` or below disables the matching limit.

### Inspection of the schema

`SHOW INDEXES` includes the columns of the payload:

```camussql
SHOW INDEXES FROM orders;
```

`SHOW CREATE TABLE` renders `INCLUDE (...)`. You can therefore replay the
definition of the table:

```camussql
SHOW CREATE TABLE orders;
```

## The order of the columns of an index

Each indexed column can state `ASC` or `DESC`. CamusDB uses `ASC` when you write
no direction.

```camussql
CREATE INDEX robots_year_asc_idx ON robots (year ASC);
CREATE INDEX robots_year_desc_idx ON robots (year DESC);
CREATE INDEX robots_kind_year_idx ON robots (kind ASC, year DESC);
```

The order of an index matters for an `ORDER BY`. CamusDB scans an index forward
only. The direction of the query must therefore agree with the direction of the
index. The planner can then omit a separate sort:

```camussql
CREATE INDEX robots_year_desc_idx ON robots (year DESC);

SELECT *
FROM robots
ORDER BY year DESC;
```

The index above can satisfy `ORDER BY year DESC`. It does not satisfy `ORDER BY
year ASC`. That query needs an ascending index, or a separate sort.

For a composite index, the columns and the directions of the `ORDER BY` must
match a prefix of the index, from left to right. One example is `(kind ASC, year
DESC)` for `ORDER BY kind ASC, year DESC`.

CamusDB supports a descending index column for a scalar type of a fixed width.
Those types are `OID`, `UUID`, `INT64`, `FLOAT64`, `FLOAT32`, `BOOL`, `DATE`,
and `DATETIME`.

CamusDB currently rejects a descending `STRING` column and a descending `BYTES`
column in an index, with `InvalidInput`. You cannot index an `ARRAY(T)` column.

## The DDL of an index in ALTER TABLE

```camussql
ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_year_uq (code, year);
ALTER TABLE robots ADD INDEX robots_kind_idx (kind) INCLUDE (name, year);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Rename an index

```camussql
ALTER TABLE robots RENAME INDEX robots_name_idx TO robots_display_name_idx;
```

A rename changes the name of the index in the schema. It preserves the data of
the index. After the rename, an inspection of the schema no longer shows the old
name.

Two operations currently fail with `InvalidInput`: a rename of an index that
does not exist, and a rename to a name that exists.

## The plan of a query

An index can drive six things:

- A point lookup.
- A scan of a range.
- A probe of an indexed `IN (...)`.
- An ordered scan.
- An indexed join.
- A read from the index alone, through the `INCLUDE` columns.

For the behavior of the planner, see [Query Planning](/docs/query-planning). For
examples of the syntax of a query that uses an index, see
[SELECT](/docs/sql-queries) and
[Joins And Subqueries](/docs/joins-and-subqueries).
