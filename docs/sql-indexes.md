---
sidebar_position: 2.2
---

# Indexes

Primary keys and unique columns create indexes. Additional indexes can be added
with either `CREATE INDEX` or `ALTER TABLE`.

## Create Indexes

```camussql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);
```

Multi-column unique indexes are supported:

```camussql
CREATE UNIQUE INDEX robots_kind_year_uq ON robots (kind, year);
```

Create a covering index with `INCLUDE (...)` when common queries filter by the
index key but also return a few extra columns:

```camussql
CREATE INDEX robots_kind_idx
ON robots (kind)
INCLUDE (name, year);
```

The indexed key columns drive lookup, range scanning, ordering, and uniqueness.
Included columns are stored with each index entry so covered queries can avoid a
primary-row fetch.

## Covering Indexes

Covering indexes let a secondary index store extra non-key columns with each
index entry. When a query can be answered from the index key plus those included
columns, CamusDB can return the result without fetching the primary row.

Use covering indexes for hot read paths that filter by one set of columns but
return a small, stable set of additional columns.

### Create A Covering Index

Add `INCLUDE (...)` after the indexed key columns:

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total, created_at);
```

`customer_id` is the index key. It controls ordering, range scans, and lookup
bounds. `status`, `total`, and `created_at` are stored payload columns. They do
not affect index order and they are not searchable as key columns.

Unique indexes can also include payload columns:

```camussql
CREATE UNIQUE INDEX users_email_idx
ON users (email)
INCLUDE (display_name, status);
```

`UNIQUE` applies only to the key columns. In the example above, uniqueness is
enforced on `email`; `display_name` and `status` do not participate in the
unique constraint.

### Inline And ALTER TABLE Syntax

Covering indexes can be declared inside `CREATE TABLE`:

```camussql
CREATE TABLE orders (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  customer_id INT64 NOT NULL,
  status STRING(32) NOT NULL,
  total FLOAT64 NOT NULL,
  KEY orders_customer_idx (customer_id) INCLUDE (status, total)
);
```

They can also be added with `ALTER TABLE`:

```camussql
ALTER TABLE orders
ADD INDEX orders_customer_idx (customer_id) INCLUDE (status, total);

ALTER TABLE users
ADD UNIQUE INDEX users_email_idx (email) INCLUDE (display_name, status);
```

To change the included columns of an existing index, drop and recreate the
index with the desired `INCLUDE` list.

### Covered Queries

A query is covered when every column it needs is available from the index key or
the included payload columns.

```camussql
CREATE INDEX orders_customer_idx
ON orders (customer_id)
INCLUDE (status, total);

SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

The query above can be answered from `orders_customer_idx`: `customer_id` is the
key, while `status` and `total` are included payload columns.

This query is not covered because `note` is neither a key column nor an
included column:

```camussql
SELECT customer_id, status, note
FROM orders
WHERE customer_id = 42;
```

CamusDB can still use the index to find matching rows, but it must fetch the
primary row to read `note`.

### Read With EXPLAIN

Use `EXPLAIN (ANALYZE)` to verify whether a query used the covered path:

```camussql
EXPLAIN (ANALYZE)
SELECT customer_id, status, total
FROM orders
WHERE customer_id = 42;
```

For a covered index lookup or range scan, the scan node reports
`rows_read = 0`, because no primary rows were fetched after reading the index
entry.

### Covering Index Rules And Limits

- Included columns must exist on the table.
- An included column cannot also be a key column in the same index.
- Included columns cannot specify `ASC` or `DESC`; they are unordered payload.
- Included columns can be nullable.
- Included columns can use any storable column type, including `BYTES` and
  `ARRAY(T)`, because they are stored in the index value rather than the ordered
  key.
- Predicates on included columns are filters, not index bounds. To search by a
  column, put it in the index key.
- Primary keys do not support `INCLUDE`; the primary row already contains the
  full row.
- Dropping a column used by an index key or `INCLUDE` list is rejected. Drop or
  recreate the index first.
- A single index can span up to 32 columns total, counting key columns plus
  included columns.
- Each index entry's encoded included-column payload is limited to 4 KiB.

These limits are controlled by `max_index_columns` and
`max_index_include_tuple_bytes` in [Configuration](/docs/configuration). Values
`<= 0` disable the corresponding limit.

### Schema Inspection

`SHOW INDEXES` includes the payload columns:

```camussql
SHOW INDEXES FROM orders;
```

`SHOW CREATE TABLE` renders `INCLUDE (...)` so the table definition can be
replayed:

```camussql
SHOW CREATE TABLE orders;
```

## Index Column Order

Each indexed column can specify `ASC` or `DESC`. If no direction is written,
`ASC` is used.

```camussql
CREATE INDEX robots_year_asc_idx ON robots (year ASC);
CREATE INDEX robots_year_desc_idx ON robots (year DESC);
CREATE INDEX robots_kind_year_idx ON robots (kind ASC, year DESC);
```

Index order matters for `ORDER BY`. CamusDB scans indexes forward, so the
query direction must match the indexed direction for the planner to skip a
separate sort:

```camussql
CREATE INDEX robots_year_desc_idx ON robots (year DESC);

SELECT *
FROM robots
ORDER BY year DESC;
```

The index above can satisfy `ORDER BY year DESC`. It does not satisfy
`ORDER BY year ASC`; that query needs an ascending index or a separate sort.
For composite indexes, the `ORDER BY` columns and directions must match a
left-to-right index prefix, such as `(kind ASC, year DESC)` for
`ORDER BY kind ASC, year DESC`.

Descending index columns are supported for fixed-width scalar types:
`OID`, `UUID`, `INT64`, `FLOAT64`, `FLOAT32`, `BOOL`, `DATE`, and `DATETIME`.
Descending `STRING` and `BYTES` index columns are currently rejected with
`InvalidInput`. `ARRAY(T)` columns are not indexable.

## Alter Table Index DDL

```camussql
ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_year_uq (code, year);
ALTER TABLE robots ADD INDEX robots_kind_idx (kind) INCLUDE (name, year);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Rename Indexes

```camussql
ALTER TABLE robots RENAME INDEX robots_name_idx TO robots_display_name_idx;
```

Index rename changes the schema name for the index and preserves the underlying
index data. The old index name is removed from schema inspection after the
rename.

Renaming a missing index or renaming to an existing index name currently fails
with `InvalidInput`.

## Query Planning

Indexes can drive point lookups, range scans, indexed `IN (...)` probes,
ordered scans, indexed joins, and covered index-only reads through `INCLUDE`
columns.

For planner behavior, see [Query Planning](/docs/query-planning). For query
syntax examples that use indexes, see [SELECT](/docs/sql-queries) and
[Joins And Subqueries](/docs/joins-and-subqueries).
