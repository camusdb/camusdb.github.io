---
sidebar_position: 2.2
---

# Indexes

An index is a sorted copy of one or more table columns, with a pointer back to
each row. With an index, CamusDB can find the rows that match a value without
reading the whole table.

## Why add an index

Without a matching index, a query that filters on a column reads every row in
the table, and that cost grows with the table. An index makes these operations
fast:

- Looking up the rows with one value, such as `WHERE email = @email`.
- Reading a range of values, such as `WHERE created_at >= @since`.
- An `ORDER BY` with a `LIMIT`, such as the 20 newest rows. CamusDB reads the
  index in order and can stop after 20 rows.
- Enforcing that a value is unique. A unique index rejects duplicates.

Indexes have a cost. Every `INSERT`, `UPDATE`, and `DELETE` must also update
each of the table's indexes, so writes get slower and the table uses more
storage. Add indexes for queries that run often or must be fast. Do not index
every column.

Use [`EXPLAIN`](/docs/explain) to see whether a query uses an index.

## Indexes that CamusDB creates for you

A primary key creates an index, and so does a unique column. You can add more
indexes with `CREATE INDEX` or `ALTER TABLE`.

## Create an index

```camussql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);
```

A unique index can span several columns:

```camussql
CREATE UNIQUE INDEX robots_kind_year_uq ON robots (kind, year);
```

To store extra columns in the index with `INCLUDE (...)`, see
[Covering indexes](#covering-indexes).

## Covering indexes

A covering index stores extra columns with each entry of a secondary index.
Those columns are not part of the index key.

When a query needs only the index key and the included columns, CamusDB can
return the result without fetching the primary row.

Use a covering index for a hot read path that filters by one set of columns and
returns a small, stable set of other columns.

### Create a covering index

Add `INCLUDE (...)` after the index key columns:

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total, created_at);
```

`customer_id` is the index key. It controls the index order, range scans, and
lookup bounds.

`status`, `total`, and `created_at` are stored payload columns. They do not
affect the index order, and you cannot search them as key columns.

A unique index can also include payload columns:

```camussql
CREATE UNIQUE INDEX users_email_idx
ON users (email)
INCLUDE (display_name, status);
```

`UNIQUE` applies to the key columns only. In the example above, CamusDB enforces
uniqueness on `email`. `display_name` and `status` are not part of the unique
constraint.

### Inline syntax

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

You can also add one with `ALTER TABLE ... ADD INDEX`. See
[Index DDL in ALTER TABLE](#index-ddl-in-alter-table).

To change the included columns of an existing index, drop the index and create
it again with the `INCLUDE` list you want.

### Covered queries

A query is covered when the index provides every column the query needs, either
from the index key or from the included payload columns.

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

`orders_customer_idx` can answer the query above: `customer_id` is the key, and
`status` and `total` are included payload columns.

The next query is not covered, because `note` is neither a key column nor an
included column:

```camussql
SELECT customer_id, status, note
FROM orders
WHERE customer_id = 42;
```

CamusDB can still use the index to find the matching rows, but it must fetch
the primary row to read `note`.

### Read the plan with EXPLAIN

Use `EXPLAIN (ANALYZE)` to confirm the covered path:

```camussql
EXPLAIN (ANALYZE)
SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

For a covered lookup or a covered range scan, the scan node reports
`rows_read = 0`: CamusDB fetched no primary rows after reading the index
entries.

### Rules and limits

- An included column must exist on the table.
- An included column cannot also be a key column of the same index.
- An included column cannot specify `ASC` or `DESC`. It is unordered payload.
- An included column can hold `NULL`.
- An included column can use any column type CamusDB can store, including
  `BYTES` and `ARRAY(T)`, because CamusDB stores it in the index value, not in
  the ordered key.
- A predicate on an included column is a filter, not an index bound. To search
  by a column, put it in the index key.
- A primary key does not support `INCLUDE`, because the primary row already
  holds the full row.
- CamusDB rejects dropping a column that an index uses, whether it is a key
  column or in an `INCLUDE` list. Drop or recreate the index first.
- An index can span at most 32 columns, counting key columns and included
  columns together.
- The encoded payload of the included columns is limited to 4 KiB per index
  entry.

The `max_index_columns` and `max_index_include_tuple_bytes` settings control
these limits. See [Configuration](/docs/configuration). A value of `0` or below
disables the matching limit.

### Inspect the schema

`SHOW INDEXES` includes the payload columns:

```camussql
SHOW INDEXES FROM orders;
```

`SHOW CREATE TABLE` renders `INCLUDE (...)`, so you can replay the table
definition:

```camussql
SHOW CREATE TABLE orders;
```

## Index column order

Each indexed column can specify `ASC` or `DESC`. If you omit the direction,
CamusDB uses `ASC`.

```camussql
CREATE INDEX robots_year_asc_idx ON robots (year ASC);
CREATE INDEX robots_year_desc_idx ON robots (year DESC);
CREATE INDEX robots_kind_year_idx ON robots (kind ASC, year DESC);
```

Index order matters for `ORDER BY`. CamusDB scans indexes forward only, so the
query's direction must match the index direction for the planner to skip a
separate sort:

```camussql
CREATE INDEX robots_year_desc_idx ON robots (year DESC);

SELECT *
FROM robots
ORDER BY year DESC;
```

The index above can satisfy `ORDER BY year DESC`, but not `ORDER BY year ASC`.
That query needs an ascending index or a separate sort.

For a composite index, the `ORDER BY` columns and directions must match a
prefix of the index, from left to right. For example, `(kind ASC, year DESC)`
serves `ORDER BY kind ASC, year DESC`.

CamusDB supports descending index columns for fixed-width scalar types: `OID`,
`UUID`, `INT64`, `FLOAT64`, `FLOAT32`, `BOOL`, `DATE`, and `DATETIME`.

CamusDB currently rejects descending `STRING` and `BYTES` index columns with
`InvalidInput`. You cannot index an `ARRAY(T)` column.

## Index DDL in ALTER TABLE

```camussql
ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_year_uq (code, year);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_uq (code) INCLUDE (name);
ALTER TABLE robots ADD INDEX robots_kind_idx (kind) INCLUDE (name, year);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Rename an index

```camussql
ALTER TABLE robots RENAME INDEX robots_name_idx TO robots_display_name_idx;
```

A rename changes the index name in the schema and keeps the index data. After
the rename, schema inspection no longer shows the old name.

Renaming an index that does not exist, or renaming to a name that already
exists, currently fails with `InvalidInput`.

## Query plans

An index can drive:

- Point lookups.
- Range scans.
- Indexed `IN (...)` probes.
- Ordered scans.
- Indexed joins.
- Index-only reads through `INCLUDE` columns.

For planner behavior, see [Query Planning](/docs/query-planning). For query
syntax examples that use indexes, see [SELECT](/docs/sql-queries) and
[Joins And Subqueries](/docs/joins-and-subqueries).
