---
sidebar_position: 2.35
---

# Copying Query Results

CamusDB can use a `SELECT` statement as the source of rows for another table.
Use `INSERT INTO ... SELECT` when the target table already exists, or
`CREATE TABLE ... AS SELECT` when you want CamusDB to create a new table from a
query result.

```camussql
INSERT INTO archived_orders (id, customer, total)
SELECT id, customer, total
FROM orders
WHERE created_at < '2026-01-01';

CREATE TABLE order_totals AS
SELECT customer, SUM(total) AS total_spent
FROM orders
GROUP BY customer;
```

The source is a normal `SELECT`. Joins, subqueries, derived tables, grouping,
`DISTINCT`, `ORDER BY`, `LIMIT`, `OFFSET`, parameters, and
`AS OF SYSTEM TIME` work the same way they do in standalone queries.

## INSERT INTO ... SELECT

`INSERT INTO ... SELECT` copies the result of a query into an existing table.

```camussql
INSERT INTO archived_orders
SELECT *
FROM orders
WHERE status = "closed";
```

With an explicit target column list, source columns are matched by position, not
by name:

```camussql
INSERT INTO pairs (a, b)
SELECT b, a
FROM pairs;
```

The source query must return the same number of columns as the target list. If
there is no target list, the target is every table column in schema order, the
same rule used by `INSERT ... VALUES`.

Columns omitted from the target list receive their defaults. Generator defaults
such as `DEFAULT (gen_id())`, `DEFAULT (gen_uuid_v4())`, and
`DEFAULT (gen_uuid_v7())` are evaluated once per inserted row.

CamusDB coerces copied values to the target column types and enforces the same
constraints as ordinary inserts: `NOT NULL`, `CHECK`, unique indexes, primary
keys, string and byte length limits, and row-level TTL settings.

The statement is all-or-nothing. If one row violates a constraint or the copy
would exceed the transaction mutation limit, no rows from that statement are
inserted. An empty source succeeds with `0` rows inserted.

### Self-Copy

Copying from a table into itself is supported:

```camussql
INSERT INTO audit_events (id, message)
SELECT gen_id(), message
FROM audit_events
WHERE message LIKE "legacy:%";
```

The source is read before the new rows are written, so the scan does not keep
seeing rows inserted by the same statement.

## CREATE TABLE ... AS SELECT

`CREATE TABLE ... AS SELECT`, often called CTAS, creates a table whose user
columns come from the query output.

```camussql
CREATE TABLE active_customers AS
SELECT id AS customer_id, name, status
FROM customers
WHERE status = "active";
```

Use `WITH NO DATA` when you only want the schema:

```camussql
CREATE TABLE IF NOT EXISTS archived_orders_empty AS
SELECT *
FROM orders
WITH NO DATA;
```

`WITH DATA` is the default. With `IF NOT EXISTS`, an existing table makes the
statement a no-op and the source query is not executed.

The new table receives columns with the names and types reported by the source
query. It does not inherit indexes, check constraints, `NOT NULL` constraints,
defaults, comments, or table settings from source tables.

Every CamusDB table needs a primary key, but a query result does not have one.
CTAS therefore adds a generated key column before the query result columns:

```camussql
id OID NOT NULL DEFAULT (gen_id())
```

If the query already returns a column named `id`, CamusDB uses `id2`, then
`id3`, and so on until it finds an available generated-key name. Projected
columns are not reused as the primary key because query output is not guaranteed
to be unique.

### Projection Rules

Every CTAS output column must have a stable name and type.

| Query shape | Result | Fix |
| --- | --- | --- |
| `SELECT year + 1 FROM robots` | Rejected because the expression has no column name. | Use `SELECT year + 1 AS next_year FROM robots`. |
| `SELECT NULL AS value FROM robots` | Rejected because bare `NULL` has no type. | Use `SELECT CAST(NULL AS INT64) AS value FROM robots`. |
| `SELECT * FROM a JOIN b ON ...` | Rejected because joined `*` output can contain qualified or duplicate names. | List the columns and aliases explicitly. |

## Time-Travel Copy

Both statements can copy from a historical snapshot:

```camussql
CREATE TABLE orders_before_incident AS
SELECT customer, total
FROM orders AS OF SYSTEM TIME '2026-08-07 14:00:00+00:00';

INSERT INTO orders (id, customer, total)
SELECT gen_id(), customer, total
FROM orders AS OF SYSTEM TIME '-2h'
WHERE customer = "acme";
```

The source query reads the past, while the destination writes to the current
database state. This makes the feature useful after bad updates, accidental
deletes, reporting mistakes, or other incident-response workflows where you
need to rebuild rows from retained history.

A historical source does not block current writers because retained history
cannot change. While the copy runs, CamusDB pins the requested revision floor so
retention cannot remove the snapshot in the middle of the operation.

If a historical copy writes zero rows, CamusDB returns the zero-row result with
a warning. The source may really have been empty at that time, or the requested
history may already be older than the retained revisions.

See [Time-Travel Reads](/docs/time-travel-reads) for accepted timestamp forms
and retention limits.

## Transactions And Limits

`INSERT INTO ... SELECT` and the data-loading part of CTAS run through the same
transactional insert path as ordinary writes.

- A successful statement commits all inserted rows together.
- A failed statement inserts no rows.
- Explicit transactions can include query-driven inserts.
- Source rows read by a live copy are locked against concurrent writers until
  the transaction commits.
- Historical sources use retained versions and do not take live source-range
  locks.

One transaction may write up to `max_mutations_per_transaction` row or index
mutations. The default is `20000`. Larger migrations should be split into
batches with `WHERE` or `LIMIT`.

CTAS creates the table before loading data. If the data load fails, CamusDB
drops the new table as a compensating action. If the process stops before that
cleanup finishes, an empty table can remain and should be dropped or reused
manually.

## Permissions

When authentication is enabled:

- `INSERT INTO ... SELECT` requires `Insert` on the target table and `Select` on
  every source table used by the query, including joins and subqueries.
- `CREATE TABLE ... AS SELECT` requires `CreateTable` on the database and
  `Select` on every source table used by the query.

## Related Pages

- [Insert, Update, Delete](/docs/sql-writes)
- [Tables And Columns](/docs/sql-schema)
- [Querying Data](/docs/sql-queries)
- [Time-Travel Reads](/docs/time-travel-reads)
- [Transaction Limits](/docs/transaction-limits)
