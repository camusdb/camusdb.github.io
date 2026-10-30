---
sidebar_position: 2.35
---

# Copying query results

Sometimes the rows you want to write already exist in the database. You may
want to archive closed orders, backfill a new table, build a summary table, or
recover rows from before a bad `UPDATE`. Two statements do this in one step,
without sending every row to the client and back:

- `INSERT INTO ... SELECT` copies query results into an existing table.
- `CREATE TABLE ... AS SELECT` (CTAS) creates a new table from query results.

Both use the familiar PostgreSQL and MySQL forms. In CamusDB, the source can
also read the past with [time travel](#time-travel-recover-historical-data),
which turns a copy into a recovery tool.

```camussql
-- Copy rows between tables
INSERT INTO archived_orders (id, customer, total)
SELECT id, customer, total FROM orders WHERE created_at < '2026-01-01';

-- Copy every column, in schema order
INSERT INTO archived_orders SELECT * FROM orders WHERE status = 'closed';

-- Build a new table from a query's result
CREATE TABLE order_totals AS
SELECT customer, SUM(total) AS total_spent FROM orders GROUP BY customer;

-- Structure only, no rows
CREATE TABLE IF NOT EXISTS orders_empty AS SELECT * FROM orders WITH NO DATA;
```

The source is an ordinary `SELECT`. Joins, `GROUP BY`, `DISTINCT`, subqueries,
`ORDER BY`, `LIMIT`, `OFFSET`, and parameters work exactly as they do in a
standalone query.

## INSERT INTO ... SELECT

CamusDB matches columns by position, never by name. The source's k-th output
column feeds the k-th target column, whatever their names:

```camussql
-- b's values land in a, and a's in b
INSERT INTO pairs (a, b) SELECT b, a FROM pairs;
```

Both lists must have the same number of columns. CamusDB rejects a mismatch
before the query runs.

Without an explicit column list, the target is every column of the table, in
schema order. `INSERT ... VALUES` uses the same rule.

CamusDB coerces each value to the target column's declared type. Target columns
that the statement does not name take their defaults. A default that calls a
function, such as `gen_uuid_v7()`, runs once per row, so each row gets its own
value.

CamusDB enforces `NOT NULL`, `CHECK`, unique indexes, and TTL exactly as it
does for `INSERT ... VALUES`, because the rows go through the same insert path.

The statement is all-or-nothing: a violation on one row aborts the whole
statement. The result is the number of inserted rows. An empty source succeeds
with a count of `0`.

An `ORDER BY` in the source is valid but means nothing for storage. CamusDB
stores rows by a generated row id, not in insert order.

### Handle existing keys

Place `ON CONFLICT` after the source query to skip duplicates or update stored
rows. For example, import a stock snapshot while preserving other columns:

```camussql
INSERT INTO inventory (sku, quantity)
SELECT sku, quantity FROM stock_import
ON CONFLICT (sku) DO UPDATE SET quantity = excluded.quantity
RETURNING sku, quantity;
```

The target needs a matching unique index. `UPSERT INTO inventory (sku,
quantity) SELECT ...` is the primary-key shorthand. See
[conflict handling](/docs/sql-writes#on-conflict) for duplicate-input rules,
privileges, and triggers.

### Copy a table into itself

`INSERT INTO t SELECT ... FROM t` is supported and terminates. The engine reads
the whole source before it writes the first row, so the scan cannot see the rows
the statement inserts.

### Limits

A transaction cannot insert more rows than `max_mutations_per_transaction`
(default 20,000), and this statement respects that bound.

A larger copy fails with `CADB0506`. Split the copy with a `WHERE` clause or a
`LIMIT`, and run it in several transactions.

While the copy runs, CamusDB locks the rows it reads against concurrent writers
until the transaction ends. Because the source scan decides what CamusDB writes,
the scan holds exclusive locks over the entire key range it scanned. A large
copy blocks writes to that range until it commits. A time travel source is
exempt; see below.

## CREATE TABLE ... AS SELECT

The new table's columns are the source query's output columns, with the types
the query would report to a client.

Nothing else is inherited: no indexes, `CHECK` constraints, `NOT NULL`,
defaults, comments, or table settings. CamusDB uses only the shape of the
result.

Add `WITH NO DATA` to create the table without loading any rows. `WITH DATA` is
the default.

With `IF NOT EXISTS`, if the table already exists, the statement does nothing
and CamusDB never runs the source query.

### Primary key

A query result has no key of its own, but every CamusDB table needs one, so
CamusDB synthesizes one: a leading column `id oid NOT NULL DEFAULT gen_id()`.
The source does not fill that column.

If the query already outputs a column named `id`, the synthesized column
becomes `id2`, then `id3`, and so on.

CamusDB never reuses a projected column as the key. A projection does not have
to be unique; joins and projections without `DISTINCT` both repeat values, and
the copy would then fail partway through with a duplicate key.

### Rejected projections

Every output column must become a named, typed column, so CamusDB refuses these
shapes and explains why:

| Rejected | Why | Fix |
| --- | --- | --- |
| `SELECT year + 1 FROM t` | An expression without an alias has no name. CamusDB would call it `0`. | `SELECT year + 1 AS next_year` |
| `SELECT NULL AS x` | There is no type to declare. | `SELECT CAST(NULL AS INT64) AS x` |
| `SELECT * FROM a JOIN b ...` | `*` over a join produces qualified names, such as `a.id`. | List the columns, with an alias for each one. |

### Schema and data do not commit together

Creating the table commits on its own. In cluster mode, CamusDB replicates that
commit to the other nodes through [Raft](/docs/concepts#raft), the protocol the
nodes use to agree on each change. This commit happens before any rows arrive,
so the two steps are not one atomic unit:

- The rows load in your transaction and become durable when you commit. The
  table is already durable.
- If the load fails, CamusDB drops the table again as a compensating action. If
  that drop also fails, or the process stops between the two commits, an empty
  table remains. The error message says so where it can.
- Other sessions can see the empty table between the two commits.

## Time travel: recover historical data

Both statements accept `AS OF SYSTEM TIME` on the source. The source reads at a
past instant while the statement writes into the present. This is the supported
way to rebuild data from an earlier moment:

```camussql
-- Rescue a table as it looked before a bad UPDATE
CREATE TABLE orders_before_incident AS
SELECT customer, total FROM orders AS OF SYSTEM TIME '2026-08-07 14:00:00+00:00';

-- Put historical rows back into the live table
INSERT INTO orders (id, customer, total)
SELECT gen_id(), customer, total FROM orders AS OF SYSTEM TIME '-2h' WHERE customer = 'acme';
```

The snapshot can be a negative offset such as `'-2h'` or `'-500ms'`, an
absolute timestamp, a Unix epoch value in milliseconds, or a parameter. It
applies to the whole source query, so an aggregate over the source reports the
historical value.

A time travel source is cheaper and safer than a live one. History cannot
change, so the scan does not lock the range it reads and blocks no concurrent
writers. It also can never see its own statement's writes.

A plain historical `SELECT` does not work inside an explicit transaction, but
this form does. Only the source reads at the snapshot; the writes stay in your
transaction.

### What time travel can and cannot recover

Time travel reads the table as it was at the snapshot. Before you rely on it
during an incident, know what that means:

- Modified rows recover well. You undo a wrong `UPDATE` by copying the values
  from before the update.
- Deleted rows also recover. A `DELETE` writes its tombstone (a deletion
  marker) as a separate [revision](/docs/concepts#mvcc), a stored version of
  the row, so the record of the last live value survives. A snapshot from before
  the delete reads the row back. Revision retention bounds that read, like every
  other historical read; see below.
- Dropped columns cannot be recovered. CamusDB reads historical values through
  the current schema, so it cannot project a column that no longer exists.
- A table that you dropped and created again is unreachable. The new table has a
  different internal id, so the old rows are not part of its history.
- Retention bounds how far back you can go. Time travel reaches only the
  revisions that storage still keeps. An older snapshot reads as empty instead
  of failing. When a recovery returns no rows, CamusDB logs a warning that the
  history may already have been reclaimed.

While a copy runs, the engine pins the revision floor at the requested
snapshot, so reclamation cannot pass that floor during the copy. This
protection starts when the copy starts. It cannot bring back revisions that
were already gone before then.

## What the response tells you

Both statements report the number of rows CamusDB wrote, and both flag a time
travel copy that read nothing. The warning reaches the client, not just the
server log, so an empty recovery cannot look like a successful one.

The endpoints are `POST /execute-sql-ddl` for CTAS and
`POST /execute-sql-non-query` for `INSERT ... SELECT`:

```jsonc
// CREATE TABLE totals AS SELECT customer, total FROM orders
{ "status": "ok", "rows": 2, "warning": null }

// CREATE TABLE recovered AS SELECT customer FROM orders AS OF SYSTEM TIME '-1h'
{ "status": "ok", "rows": 0,
  "warning": "AS OF SYSTEM TIME copy into 'recovered' inserted no rows. The source may have been
              empty at that snapshot; the history may be older than the configured revision retention
              and already reclaimed; or the rows were deleted after the snapshot …" }
```

`rows` is 0 for every DDL statement that writes no rows. `warning` is null
unless there is something to report.

Over gRPC, the same values arrive in `DdlReply.affected_rows` and
`DdlReply.warning`, and in `NonQueryReply.affected_rows` and
`NonQueryReply.warning`. As proto3 requires, an absent warning is the empty
string.

## Privileges

`INSERT ... SELECT` needs `Insert` on the target and `Select` on every source,
including tables the query reaches only through a join or subquery.

`CREATE TABLE ... AS SELECT` needs `CreateTable` on the database and `Select`
on every source.

## RETURNING

An `INSERT ... SELECT` can end with a `RETURNING` list that sends back values
from the copied rows:

```camussql
INSERT INTO archived_orders (id, customer, total)
SELECT id, customer, total
FROM orders
WHERE total > 100
RETURNING id, customer;
```

See [RETURNING](/docs/sql-writes#returning).
