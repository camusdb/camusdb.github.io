---
sidebar_position: 2.35
---

# Copying query results

Two statements let a query supply the rows. A client does not supply them.

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

The source is an ordinary `SELECT`. Eight features work exactly as they work in
a query on its own: a join, a `GROUP BY`, a `DISTINCT`, a subquery, an `ORDER
BY`, a `LIMIT`, an `OFFSET`, and a parameter.

## INSERT INTO ... SELECT

CamusDB matches the columns by position. It never matches them by name. Output
column number k of the source feeds target column number k. The names of the two
columns do not matter:

```camussql
-- b's values land in a, and a's in b
INSERT INTO pairs (a, b) SELECT b, a FROM pairs;
```

The two lists must hold the same number of columns. CamusDB rejects a mismatch
before the query runs.

The statement can have no explicit list of columns. The target is then every
column of the table, in the order of the schema. `INSERT ... VALUES` uses the
same rule.

CamusDB coerces a value to the declared type of the target column. A target
column that the statement does not name takes the default of that column. A
default that calls a function, such as `gen_uuid_v7()`, runs one time for each
row. Each row therefore receives its own value.

CamusDB enforces a `NOT NULL`, a `CHECK`, a unique index, and a TTL exactly as
it does for an `INSERT ... VALUES`. The same path of the insert writes the rows.

The statement is all-or-nothing. A violation on one row aborts the whole
statement. The result is the number of inserted rows. An empty source is a
success, with a count of `0`.

An `ORDER BY` in the source is valid. It nevertheless carries no meaning for the
storage. CamusDB stores a row by a generated row id. It does not store the rows
in the order of the insert.

### Copy a table into itself

`INSERT INTO t SELECT ... FROM t` is supported, and it terminates. The engine
reads the whole source before it writes the first row. The scan therefore cannot
observe the rows that the statement inserts.

### Limits

One transaction may not insert more rows than `max_mutations_per_transaction`.
The default is 20,000. This statement respects that bound.

A larger copy fails with `CADB0506`. Divide the copy with a `WHERE` clause or a
`LIMIT`. Then run it in several transactions.

While the copy runs, CamusDB locks the rows that it reads against a concurrent
writer. That lock lasts to the end of the transaction. The scan of the source
decides what CamusDB writes. It therefore holds exclusive range locks over the
range that it scanned. A large copy blocks a write to that range until it
commits. A source with time travel is exempt. See below.

## CREATE TABLE ... AS SELECT

The columns of the new table are the output columns of the source query. They
take the types that the query would report to a client.

CamusDB inherits nothing else. It copies no index, no `CHECK` constraint, no
`NOT NULL`, no default, no comment, and no setting of the table. It uses the
shape of the result only.

Add `WITH NO DATA` to create the table without a load of the rows. `WITH DATA`
is the default.

With `IF NOT EXISTS`, an existing table makes the statement do nothing. CamusDB
then never executes the source query.

### The primary key

The result of a query has no key of its own. Every CamusDB table needs one.
CamusDB therefore synthesizes a key. It adds a leading column `id oid NOT NULL
DEFAULT gen_id()`. The source does not fill that column.

The query can already output a column with the name `id`. The synthesized column
then becomes `id2`, and after that `id3`.

CamusDB never reuses a projected column as the key. A projection has no
obligation to be unique. A join, and a projection without `DISTINCT`, both
repeat a value. The copy would then fail in the middle, with a duplicate key.

### The rejected projections

Every output column must become a named column with a type. CamusDB therefore
refuses three shapes, and it explains each one:

| Rejected | Why | Fix |
| --- | --- | --- |
| `SELECT year + 1 FROM t` | An expression without an alias has no name. CamusDB would call it `0`. | `SELECT year + 1 AS next_year` |
| `SELECT NULL AS x` | There is no type to declare. | `SELECT CAST(NULL AS INT64) AS x` |
| `SELECT * FROM a JOIN b ...` | A `*` over a join gives qualified names, such as `a.id`. | List the columns, with an alias for each one. |

### The schema and the data do not commit together

The creation of the table commits on its own. In cluster mode, CamusDB
replicates that commit through Raft. The commit happens before any row arrives.
The two steps are therefore not one atomic unit:

- The rows load in your transaction. They become durable when you commit. The
  table is durable already.
- CamusDB drops the table again when the load fails. That drop is a compensating
  action. The drop can also fail, or the process can stop between the two
  commits. An empty table then remains. The error message says so where it can.
- Another session can see the empty table, between the two commits.

## Time travel: recover historical data

Both statements accept `AS OF SYSTEM TIME` on the source. The source then reads
at a past instant, while the statement writes into the present. That is the
supported way to rebuild the data of an earlier moment:

```camussql
-- Rescue a table as it looked before a bad UPDATE
CREATE TABLE orders_before_incident AS
SELECT customer, total FROM orders AS OF SYSTEM TIME '2026-08-07 14:00:00+00:00';

-- Put historical rows back into the live table
INSERT INTO orders (id, customer, total)
SELECT gen_id(), customer, total FROM orders AS OF SYSTEM TIME '-2h' WHERE customer = 'acme';
```

The snapshot accepts four forms: a negative offset such as `'-2h'` or
`'-500ms'`, an absolute timestamp, a value in Unix epoch milliseconds, and a
parameter. It applies to the whole source query. An aggregate over that source
therefore reports the historical value.

A source with time travel is cheaper and safer than a live source. History
cannot change. The scan therefore takes no range lock, and it blocks no
concurrent writer. It also can never observe the writes of its own statement.

A plain historical `SELECT` does not work inside an explicit transaction. This
form does. Only the source reads at the snapshot. The writes stay in your
transaction.

### What time travel can recover, and what it cannot

Time travel reads the rows that exist now, as they were then. Five consequences
matter before you depend on it during an incident:

- A modified row recovers well. You undo a wrong `UPDATE` with a copy of the
  values from before that update.
- A deleted row also recovers. A `DELETE` writes its tombstone as a revision of
  its own. The history record of the last live value therefore survives. A
  snapshot from before the delete reads the row back. The retention of the
  revisions bounds that read, like every other historical read. See below.
- A dropped column cannot recover. CamusDB reads a historical value through the
  current schema. It therefore cannot project a column that no longer exists.
- A table that you dropped and created again is unreachable. It holds a
  different internal id. Its old rows are therefore not part of the history of
  the new table.
- The retention bounds how far back you can go. Time travel reaches only the
  revisions that Kahuna still keeps. An older snapshot reads as empty. It does
  not fail. CamusDB logs a warning for a recovery that returns no row. The
  warning says that it may have reclaimed the history already.

While a copy runs, the engine pins the floor of the revisions at the requested
snapshot. The reclamation therefore cannot pass that floor during the copy. That
protection starts at the start of the copy. It cannot return a revision that
disappeared before that moment.

## What the response tells you

Both statements report the number of rows that CamusDB wrote. Both also mark a
copy with time travel that read nothing. The warning reaches the client, and not
only the log of the server. An empty recovery therefore cannot look like a
successful one.

The endpoints are `POST /execute-sql-ddl` for CTAS, and
`POST /execute-sql-non-query` for an `INSERT ... SELECT`:

```jsonc
// CREATE TABLE totals AS SELECT customer, total FROM orders
{ "status": "ok", "rows": 2, "warning": null }

// CREATE TABLE recovered AS SELECT customer FROM orders AS OF SYSTEM TIME '-1h'
{ "status": "ok", "rows": 0,
  "warning": "AS OF SYSTEM TIME copy into 'recovered' inserted no rows. The source may have been
              empty at that snapshot; the history may be older than the configured revision retention
              and already reclaimed; or the rows were deleted after the snapshot …" }
```

`rows` is 0 for every DDL statement that writes no row. `warning` is null unless
there is something to report.

Over gRPC, the same values arrive in two fields of each reply:
`DdlReply.affected_rows` and `DdlReply.warning`, and
`NonQueryReply.affected_rows` and `NonQueryReply.warning`. An absent warning is
the empty string, as proto3 requires.

## Privileges

`INSERT ... SELECT` needs `Insert` on the target. It also needs `Select` on
every source. That rule covers a table that the query reaches only through a
join or a subquery.

`CREATE TABLE ... AS SELECT` needs `CreateTable` on the database. It also needs
`Select` on every source.
