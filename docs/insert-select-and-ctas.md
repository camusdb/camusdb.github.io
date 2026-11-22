---
sidebar_position: 2.35
---

# Copying query results

Two statements write the result of a query into a table in one step. The rows
stay on the server, and the client doesn't fetch and resend them:

- `INSERT INTO ... SELECT` copies query results into an existing table.
- `CREATE TABLE ... AS SELECT` (CTAS) creates a new table from query results.

Use them to archive old orders, build a summary table, or recover rows from
before a bad `UPDATE`.

Both statements use the same syntax as PostgreSQL and MySQL. In CamusDB, the
source can also read a past state of the data with
[time travel](#time-travel-recover-historical-data), which makes a copy a
recovery tool.

The examples on this page use the following data:

<details>
<summary>Sample data for the examples on this page</summary>

```camussql
CREATE TABLE orders (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  customer STRING NOT NULL,
  total NUMERIC NOT NULL,
  status STRING NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE archived_orders (
  id OID PRIMARY KEY NOT NULL,
  customer STRING NOT NULL,
  total NUMERIC NOT NULL,
  status STRING,
  created_at DATETIME
);

INSERT INTO orders (customer, total, status, created_at) VALUES
  ('acme', 45.00, 'cancelled', '2025-12-03T09:15:00Z'),
  ('globex', 75.50, 'closed', '2026-02-10T14:30:00Z'),
  ('initech', 320.00, 'open', '2026-03-15T11:00:00Z'),
  ('acme', 180.00, 'open', '2026-04-02T16:45:00Z'),
  ('umbrella', 60.00, 'open', '2026-04-20T08:05:00Z');

CREATE TABLE inventory (
  sku STRING NOT NULL,
  quantity INT64 NOT NULL DEFAULT (0),
  location STRING,
  PRIMARY KEY (sku)
);

INSERT INTO inventory (sku, quantity, location) VALUES
  ('KETTLE-01', 5, 'A1'),
  ('MUG-02', 40, 'B3');

CREATE TABLE stock_import (
  sku STRING NOT NULL,
  quantity INT64 NOT NULL,
  PRIMARY KEY (sku)
);

INSERT INTO stock_import (sku, quantity) VALUES
  ('KETTLE-01', 12),
  ('TEAPOT-03', 7);

CREATE TABLE pairs (
  id INT64 PRIMARY KEY NOT NULL,
  a INT64,
  b INT64
);

INSERT INTO pairs (id, a, b) VALUES (1, 10, 20);

CREATE TABLE payments (
  id INT64 PRIMARY KEY NOT NULL,
  amount NUMERIC NOT NULL
);
```

</details>

## Quick example

```camussql
-- Copy rows between tables
INSERT INTO archived_orders (id, customer, total)
SELECT id, customer, total FROM orders WHERE created_at < '2026-01-01';

-- Copy all columns, in schema order
INSERT INTO archived_orders SELECT * FROM orders WHERE status = 'closed';

-- Build a new table from the result of a query
CREATE TABLE order_totals AS
SELECT customer, SUM(total) AS total_spent FROM orders GROUP BY customer;

-- Copy the structure, with no rows
CREATE TABLE IF NOT EXISTS orders_empty AS SELECT * FROM orders WITH NO DATA;
```

The source query can use the same features as a standalone `SELECT`, including
joins and parameters. The source can also be a [view](/docs/views). Reading a view doesn't make the view writable.

## INSERT INTO ... SELECT

Columns match by position. The first output column of the source goes into the
first target column, whatever their names are:

```camussql
-- copies b into a, and a into b
INSERT INTO pairs (id, a, b) SELECT id + 100, b, a FROM pairs;
```

```text
┌─────┬────┬────┐
│ id  │ a  │ b  │
├─────┼────┼────┤
│ 1   │ 10 │ 20 │
│ 101 │ 20 │ 10 │
└─────┴────┴────┘
```

The two lists must have the same number of columns. A mismatch returns error
`CADB0400` before the query is executed. If you omit the column list, the target
is all columns of the table, in schema order, as with `INSERT ... VALUES`.

Each value is converted to the type of its target column. Target columns that
the statement doesn't name get their defaults. A default that calls a function,
such as `gen_uuid_v7()`, is evaluated for each row, and each row gets a
different value.

The rows go through the same insert path as `INSERT ... VALUES`. `NOT NULL`,
`CHECK`, unique indexes, and TTL apply in the same way.

The statement is atomic. If one row violates a constraint, no rows are
inserted. The result is the number of inserted rows, and an empty source
returns `0`.

An `ORDER BY` in the source is allowed, but it doesn't set the order in which
rows are stored.

### Handle existing keys

Put `ON CONFLICT` after the source query to skip or update rows that already
exist. For example, import a stock snapshot and leave the other columns as they
are:

```camussql
INSERT INTO inventory (sku, quantity)
SELECT sku, quantity FROM stock_import
ON CONFLICT (sku) DO UPDATE SET quantity = excluded.quantity
RETURNING sku, quantity;
```

```text
┌───────────┬──────────┐
│ sku       │ quantity │
├───────────┼──────────┤
│ KETTLE-01 │ 12       │
│ TEAPOT-03 │ 7        │
└───────────┴──────────┘
Query OK, 2 rows affected (00:00:00.0094279)
```

The statement updated the `KETTLE-01` row and left its location unchanged. Then
it inserted `TEAPOT-03`.

The target needs a unique index on the conflict columns.
`UPSERT INTO inventory (sku, quantity) SELECT ...` is a shorter form for the
primary key. For duplicate input rows, privileges, and triggers, see
[conflict handling](/docs/sql-writes#on-conflict).

### Copy a table into itself

`INSERT INTO t SELECT ... FROM t` reads the full source before it writes the
first row. This means that the statement doesn't read the rows it inserts, and
it always ends.

### Size limit and locks

A transaction can insert at most `max_mutations_per_transaction` rows (default
20,000). A larger copy returns `CADB0506`. Split the copy into several
transactions with a `WHERE` clause or a `LIMIT`. A value of `0` or less disables
the [mutation limit](/docs/transaction-limits#mutation-limit).

During the copy, CamusDB locks the key range that the source scan read.
Concurrent writes to that range wait until the transaction ends, and a large
copy can block writers for a long time. A
[time travel](#time-travel-recover-historical-data) source doesn't take these
locks.

## CREATE TABLE ... AS SELECT

The new table gets the output columns of the source query, with the types that
the query returns to a client. For the `order_totals` table from the quick
example:

```camussql
SHOW COLUMNS FROM order_totals;
```

```text
┌─────────────┬─────────┬──────┬─────┬──────────┬───────┐
│ Field       │ Type    │ Null │ Key │ Default  │ Extra │
├─────────────┼─────────┼──────┼─────┼──────────┼───────┤
│ id          │ OID     │ NO   │ PRI │ gen_id() │       │
│ customer    │ STRING  │ YES  │     │ NULL     │       │
│ total_spent │ NUMERIC │ YES  │     │ NULL     │       │
└─────────────┴─────────┴──────┴─────┴──────────┴───────┘
```

The new table doesn't inherit indexes, `CHECK` constraints, `NOT NULL`
constraints, defaults, comments, or table settings from the source tables.

`WITH NO DATA` creates the table and loads no rows. `WITH DATA` is the default.
With `IF NOT EXISTS`, if the table exists, the statement has no effect and the
source query isn't executed.

A parameter in the select list gives its column the type of the supplied value.
For example, a FLOAT64 `@price` in `SELECT @price AS price` creates a FLOAT64
column. A NULL parameter creates a STRING column. Write `CAST(@price AS FLOAT64)`
when the type must be fixed. `INSERT ... SELECT` uses the parameter values in
the same way to determine the types of the source expressions.

### Primary key

Each CamusDB table needs a primary key, and a query result doesn't have one.
CTAS adds a first column, `id OID NOT NULL DEFAULT gen_id()`, as the primary
key. The source doesn't fill it. If the query already returns a column named
`id`, the key column is named `id2`, then `id3`, and so on.

CamusDB doesn't use a column from the query as the key, because query results
can repeat values. To use a key of your choice, create the table first and then
fill it with `INSERT INTO ... SELECT`.

### Column names and types

Each output column must have a name and a type. These projections return error
`CADB0400`:

| Projection | Problem | Fix |
| --- | --- | --- |
| `SELECT total + 1 FROM orders` | The expression has no name. | `SELECT total + 1 AS total_plus_one` |
| `SELECT NULL AS x` | `NULL` has no type. | `SELECT CAST(NULL AS INT64) AS x` |
| `SELECT * FROM orders o JOIN archived_orders a ON o.id = a.id` | Two output columns are named `id`. | List the columns, with an alias for each duplicate name. |

A scalar subquery has its declared type, even when it returns no value. This
statement creates a NUMERIC column when `payments` is empty:

```camussql
CREATE TABLE payment_summary AS
SELECT (SELECT MAX(amount) FROM payments) AS largest_payment;
```

A scalar subquery column can take the name of its inner column. An aggregate
such as `MAX` needs an alias.

### Table creation and row loading commit separately

CTAS creates the table in a separate commit. In cluster mode, CamusDB
replicates that commit to the other nodes through [Raft](/docs/concepts#raft),
the protocol the nodes use to agree on each change. The rows load afterward, in
your transaction. The two steps aren't atomic:

- Other sessions can see the empty table before the rows commit.
- If the load fails, CamusDB drops the table. If that drop also fails, or the
  process stops between the two commits, an empty table remains. The error
  message says so when it can.

## Time travel: recover historical data

Both statements accept `AS OF SYSTEM TIME` on the source. The source reads the
data as it was at a past moment, and the statement writes into the present:

```camussql
-- Save a table as it was before a bad UPDATE
CREATE TABLE orders_before_incident AS
SELECT customer, total FROM orders AS OF SYSTEM TIME '2026-08-07 14:00:00+00:00';

-- Put historical rows back into the live table
INSERT INTO orders (id, customer, total, status, created_at)
SELECT gen_id(), customer, total, status, created_at
FROM orders AS OF SYSTEM TIME '-2h'
WHERE customer = 'acme';
```

The snapshot can be a negative offset such as `'-2h'`, an absolute timestamp, a
Unix epoch value in milliseconds, or a parameter. It applies to the full source
query, and an aggregate over the source returns the historical value.

A time travel source doesn't lock the range that it reads, because past data
can't change. It doesn't block concurrent writers, and it can't read the rows
that the statement writes.

A historical `SELECT` returns error `CADB0409` in an explicit transaction. A
copy with a time travel source works in one. The source reads at the
snapshot, and the writes are part of your transaction.

### What time travel can and cannot recover

Time travel reads the table as it was at the snapshot. Before you rely on it
during an incident, note what it can do:

- **Updated rows:** copy the values from before the update.
- **Deleted rows:** a snapshot from before the delete returns the deleted rows.
- **Dropped columns:** you can't recover them. CamusDB reads past values through
  the current schema.
- **A table that you dropped and created again:** the new table has a different
  internal ID, and its history doesn't include the old rows.
- **Old snapshots:** time travel reaches only the row versions that storage
  hasn't reclaimed. An older snapshot returns no rows, and no error. When a
  recovery returns no rows, CamusDB logs a warning.

During a copy, CamusDB stops reclamation of row versions at the snapshot of the
copy. This protection starts when the copy starts. It can't bring back versions
that were reclaimed earlier.

## Row counts and empty-copy warnings

Both statements return the number of rows written. A time travel copy that
writes no rows also returns a warning, to the client and in the server log.
This means that an empty recovery doesn't look like a successful one. The
warning text starts like this:

```text
AS OF SYSTEM TIME copy into 'recovered' inserted no rows. The source may have
been empty at that snapshot; the history may be older than the configured
revision retention and already reclaimed; or the rows were deleted after the
snapshot …
```

For the response fields, see the [HTTP API](/docs/http-api#post-execute-sql-ddl)
and [gRPC API](/docs/grpc-api#sql-service) references.

## Privileges

`INSERT ... SELECT` needs `Insert` on the target and `Select` on each source
table, including tables that the query reads through a join or a subquery.

`CREATE TABLE ... AS SELECT` needs `CreateTable` on the database and `Select`
on each source table.

## RETURNING

An `INSERT ... SELECT` can end with a `RETURNING` list that returns values from
the copied rows:

```camussql
INSERT INTO archived_orders (id, customer, total)
SELECT id, customer, total
FROM orders
WHERE total > 100
RETURNING id, customer;
```

```text
┌──────────────────────────┬──────────┐
│ id                       │ customer │
├──────────────────────────┼──────────┤
│ 6afe1def3bd8878b74cfc3f4 │ initech  │
│ 6afe1def3bd8878b74cfc3f5 │ acme     │
└──────────────────────────┴──────────┘
Query OK, 2 rows affected (00:00:00.0058727)
```

See [RETURNING](/docs/sql-writes#returning).
