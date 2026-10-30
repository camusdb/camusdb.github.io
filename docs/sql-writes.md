---
sidebar_position: 2.3
---

# Insert, update, delete

This page shows how to add, change, and remove rows with `INSERT`, `UPDATE`,
and `DELETE`. The statements look like the ones you use in PostgreSQL,
including [`RETURNING`](#returning), which sends the changed rows back in the
same round trip, so you get generated ids or new totals without a follow-up
`SELECT`.

CamusDB also guards against common mistakes. Each statement is atomic: all of
its rows are written, or none are. `UPDATE` and `DELETE` require a
[`WHERE` clause](#a-where-clause-is-mandatory), so a missing filter cannot
change or erase a whole table by accident.

Every write runs inside a transaction. If you do not open one, CamusDB opens a
transaction around your statement and commits it. For work that spans several
statements, see [Transactions In SQL](/docs/sql-transactions).

## INSERT

One statement can insert one row or many:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), 'R2-D2', 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), 'C-3PO', 1977),
  (GEN_ID(), 'T-800', 1984);
```

A multi-row `INSERT` is atomic: every row is inserted, or none is.

### Defaults

Write `DEFAULT` in the values list, or omit the column from the column list.
Both apply the column's default:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), 'K-2SO', DEFAULT);
```

A default can be a generator, such as `DEFAULT (gen_id())`,
`DEFAULT (gen_uuid_v4())`, or `DEFAULT (gen_uuid_v7())`. CamusDB evaluates the
function once per inserted row, so each row gets its own value. See [Tables And Columns](/docs/sql-schema#column-defaults).

You can also produce an object id inline:

```camussql
INSERT INTO robots (id, name) VALUES (GEN_ID(), 'R2-D2');
INSERT INTO robots (id, name) VALUES (STR_ID('507f1f77bcf86cd799439011'), 'C-3PO');
```

`GEN_ID()` creates a new object id. `STR_ID()` parses an existing object id from
its hexadecimal string. See
[Object Id Functions](/docs/functions-object-id).

### INSERT ... SELECT

Copy a query result into an existing table:

```camussql
INSERT INTO archived_robots (id, name, year)
SELECT id, name, year
FROM robots
WHERE year < 2000;
```

CamusDB matches columns by position, not by name. See
[Copying Query Results](/docs/insert-select-and-ctas#insert-into--select) for
the full rules, limits, and time-travel sources.

To create the target table from the query instead, see
[Copying Query Results](/docs/insert-select-and-ctas).

### Skip or update conflicting rows {#on-conflict}

Use `ON CONFLICT` to handle an existing unique key in the same statement,
without a separate existence check. For example, receive inventory repeatedly
and add each delivery to the stored quantity:

```camussql
CREATE TABLE inventory (
  sku STRING NOT NULL,
  quantity INT64 NOT NULL DEFAULT 0,
  location STRING,
  PRIMARY KEY (sku)
);

INSERT INTO inventory (sku, quantity) VALUES ('KETTLE-01', 5)
ON CONFLICT (sku) DO UPDATE
SET quantity = inventory.quantity + excluded.quantity
RETURNING sku, quantity;
```

The first run inserts quantity 5; the next adds 5 to it. In the update arm,
bare column names and `inventory.column` read the stored row, while
`excluded.column` reads the proposed row after defaults, coercion, and BEFORE
INSERT triggers. All `SET` expressions read the old stored values, so
`SET a = b, b = a` swaps them.

To ignore duplicates instead:

```camussql
INSERT INTO inventory (sku, quantity) VALUES ('KETTLE-01', 5)
ON CONFLICT (sku) DO NOTHING;
```

The clause follows `VALUES` or the source `SELECT`, before `RETURNING`.
It also works with identity override clauses.

#### Choose a conflict target

The target selects which unique indexes decide whether to skip or update:

| Target | Conflicts handled |
| --- | --- |
| `ON CONFLICT (a, b)` | Unique indexes with exactly those columns, in either order. |
| `ON CONFLICT ON CONSTRAINT index_name` | The named unique index. Use `<table>_pkey` for the primary key. |
| `ON CONFLICT DO NOTHING` | All unique indexes, including the primary key. |

`DO UPDATE` requires a target. A missing matching unique index, an index still
being built, or a CHECK/foreign-key constraint used as the target is refused.
A duplicate on another unique index remains an error. Unique keys containing
NULL do not conflict because they have no index entry.

Proposed rows must pass NOT NULL and CHECK validation before conflict
handling. `DO NOTHING` does not suppress an invalid row.

#### Conditional updates and repeated keys

Add `WHERE` after `SET` to update only selected conflicts:

```camussql
INSERT INTO inventory (sku, quantity) VALUES ('KETTLE-01', 5)
ON CONFLICT (sku) DO UPDATE SET quantity = excluded.quantity
WHERE inventory.quantity < excluded.quantity;
```

A condition that is not true skips that row. A primary-key column cannot be
assigned in the update arm. Non-correlated scalar, `IN`, or `EXISTS` subqueries
are evaluated once before writes; correlated subqueries there are refused.

One `DO UPDATE` statement cannot affect the same stored row or new key twice,
even if its condition skipped the first conflict. Duplicate proposed keys
fail with `CADB0400` (`InvalidInput`). With `DO NOTHING`, later copies are
skipped after the first insert.

#### UPSERT shorthand

`UPSERT INTO` uses the primary key as its conflict target and replaces each
listed non-key column with its proposed value:

```camussql
UPSERT INTO inventory (sku, quantity)
VALUES ('KETTLE-01', 12)
RETURNING sku, quantity;
```

This sets quantity to 12 rather than adding to it. Columns omitted from the
list keep their stored values on update and take defaults on insert. Without
a list, every column is included. Supplying only primary-key columns leaves
an existing row unchanged. Supply the key you mean to match; a generated new
primary key does not match a different unique key such as an email address.

#### Transactions, triggers, and limits

Conflicting keys are locked before checking latest committed values, including
in optimistic mode. Concurrent upserts can still raise retryable conflicts;
[replay the transaction](/docs/serializable-retries) when required. A duplicate
on an index outside the target is not a retryable upsert outcome.

BEFORE INSERT runs for every proposed row, including a skipped row. Successful
inserts then run AFTER INSERT; conflicts that update run BEFORE UPDATE and
AFTER UPDATE. Skips fire neither update nor AFTER INSERT triggers. AFTER
triggers wait until all statement writes and foreign-key checks finish.

`RETURNING` reports inserted rows and new updated rows in proposed-row order;
skips return nothing. The affected count is inserts plus updates. These writes
count against the transaction mutation limit; skipped rows do not, although
SQL issued by a BEFORE INSERT trigger still counts normally. Sequence defaults
are reserved before conflict checks, so skipped or updated proposals can still
consume sequence values.

`DO NOTHING` needs `INSERT`. `DO UPDATE` and `UPSERT` need both `INSERT` and
`UPDATE`, even when no row conflicts. `RETURNING` additionally needs `SELECT`.

On a branch, inherited keys can conflict; an update writes the branch's copy
without changing its parent. This feature is SQL-only: typed HTTP/gRPC insert
APIs have no upsert form. MySQL's `ON DUPLICATE KEY UPDATE`, `MERGE`, INSERT
target aliases, and a user-declared primary-key constraint name as a conflict
target are unsupported. Use primary-key columns or `<table>_pkey` instead.
`UPSERT`, `CONFLICT`, `DO`, `NOTHING`, and `EXCLUDED` remain usable identifiers.

## UPDATE

Change selected columns of rows that match a predicate. Columns omitted from
`SET` keep their values:

```camussql
UPDATE robots
SET name = @name, year = @year
WHERE id = @id
RETURNING id, name, year;
```

Assignments can use parameters, scalar functions, arithmetic, and existing
column values. For example, decrement inventory only when enough stock remains:

```camussql
UPDATE inventory
SET quantity = quantity - @sold
WHERE sku = @sku AND quantity >= @sold
RETURNING sku, quantity;
```

Every `SET` expression reads the row's values before the update. Assignments
are simultaneous: `SET a = b, b = a` swaps values rather than assigning the
same value twice. To set a nullable column to SQL NULL, use `SET column = NULL`.

Primary-key columns cannot be changed. Updated values must satisfy column
types, length limits, NOT NULL, CHECK, uniqueness, and foreign-key rules.
CamusDB maintains affected indexes and runs the table's UPDATE triggers.
A constraint or trigger failure rolls back the statement's changes.

### Limit updated rows

Place `LIMIT` after `WHERE`, before an optional `RETURNING` list:

```camussql
UPDATE robots
SET year = year + 1
WHERE year < 1980
LIMIT @batch_size
RETURNING id, year;
```

The limit accepts an integer literal or a bound integer parameter.
`LIMIT 0` changes no rows. It limits matching candidates selected by the scan;
a later concurrency recheck can skip a candidate, so the affected count can be
smaller. See [concurrent updates and deletes](#concurrent-updates-and-deletes).

There is no `ORDER BY` or `OFFSET` on `UPDATE`. Do not assume which matching
rows a limited update selects. `UPDATE ... FROM` and joins on the target are
also unsupported. Use a subquery for a value or filter when appropriate:

```camussql
UPDATE counters
SET n = (SELECT COUNT(*) FROM messages)
WHERE id = @id;
```

See [subquery rules](/docs/joins-and-subqueries#subqueries-in-where) for the
supported scalar, `IN`, and `EXISTS` forms.

## DELETE

Remove rows matching a predicate, along with their index entries:

```camussql
DELETE FROM robots
WHERE year < 1970
RETURNING id, name;
```

The affected-row count reports deleted target rows. `RETURNING` gives their
values before deletion; without it the statement returns only the count.
Foreign-key checks can reject deletion of a referenced parent row, and DELETE
triggers can reject the operation. See [foreign keys](/docs/foreign-keys) and
[C# triggers](/docs/csharp-extensions#triggers).

Use a subquery to select rows based on another table:

```camussql
DELETE FROM sessions
WHERE id NOT IN (
  SELECT sessionid FROM messages WHERE sessionid IS NOT NULL
);
```

Filtering NULLs in this `NOT IN` example matters: a NULL in the subquery's
result can make the predicate unknown instead of true. See
[IN and NOT IN](/docs/joins-and-subqueries#in-and-not-in).
`DELETE ... USING`, joined deletes, `ORDER BY`, and `OFFSET` are unsupported.

### Limit deleted rows

Bound a cleanup operation with a literal or parameterized `LIMIT`:

```camussql
DELETE FROM events
WHERE created_at < @cutoff
LIMIT @batch_size
RETURNING id;
```

The limit comes after `WHERE` and before `RETURNING`. It has the same candidate
selection semantics as UPDATE: `LIMIT 0` deletes nothing, concurrency can
reduce the affected count, and selection order is unspecified.

For a large cleanup, repeat bounded deletes and commit each batch separately.
For batched updates, make each batch's predicate exclude rows already
processed. Repeating `SET quantity = quantity + 1 WHERE quantity > 0 LIMIT 100`
can keep selecting rows it has already changed.

`LIMIT` does not split a statement into transactions or remove the
[transaction mutation limit](/docs/transaction-limits). Several limited writes
in one explicit transaction share that limit, including writes made by their
triggers. It also does not bound how many rows the scan must examine to find
matches. Index the filter when useful; large intermediate match sets can
[spill to disk](/docs/spill-to-disk#delete-and-update).

For ongoing expiry, consider [row-level TTL](/docs/row-level-ttl). To empty a
whole table without row-by-row deletion, use [TRUNCATE](/docs/truncate-table),
which has different transaction and trigger behavior.

## RETURNING {#returning}

`INSERT`, `UPDATE`, and `DELETE` can send values from the rows they wrote back
to the client. Add a `RETURNING` list at the end of the statement:

```camussql
INSERT INTO orders (customer, total)
VALUES ('alice', 10), ('bob', 20)
RETURNING id, total * 2 AS doubled;

INSERT INTO archived_orders
SELECT * FROM orders WHERE total > 100
RETURNING *;

UPDATE orders
SET total = total * 2
WHERE customer = 'alice'
RETURNING id, total;

DELETE FROM orders
WHERE total > 100
LIMIT 10
RETURNING *;
```

In `UPDATE` and `DELETE`, the `RETURNING` list comes after the `LIMIT`, if the
statement has one.

The result has the same shape as a `SELECT` result: a column schema, then one
row for each row the statement wrote. The affected-row count equals the number
of returned rows.

<span id="insert-returning"></span>

### What RETURNING can contain

The `RETURNING` list is a select list over the target table. It can contain:

- `*`, which expands to every column of the target table in schema order.
- A column name, including a qualified name such as `orders.total`.
- A scalar expression, such as arithmetic, `CASE`, a cast, or a scalar
  function.
- An alias with `AS`.
- A bound parameter.

If an item cannot be evaluated once per written row, CamusDB rejects it before
writing any rows:

| Item | Error |
| --- | --- |
| An aggregate such as `COUNT(*)` or `SUM(x)` | `CADB0400` `InvalidInput` |
| A subquery | `CADB0400` `InvalidInput` |
| A sequence call such as `nextval`, `setval`, `currval`, or `lastval` | `CADB0547` `SequenceCallNotAllowedHere` |
| A name that is not a column of the target table | `CADB0404` `UnknownColumn` |

### What values come back

`RETURNING` reports the stored row image, not just the text that appeared in the
statement:

| Statement | Row image |
| --- | --- |
| `INSERT` | The inserted row. |
| `INSERT ... ON CONFLICT`, `UPSERT` | Inserted rows and new updated rows; skipped rows are omitted. |
| `UPDATE` | The new row, after the `SET` clause. |
| `DELETE` | The deleted row. |

- A column omitted from an `INSERT` has its default value.
- A column not changed by an `UPDATE` keeps its stored value.
- A function default, such as `gen_id()`, `gen_uuid_v7()`, or `now()`, is
  evaluated for each inserted row.
- A value is returned after coercion to the column type.
- A column with no value and no default returns `NULL`.
- A large value stored out of line returns in full.

Rows come back in insert order; for `INSERT ... SELECT`, that is the order the
source query produces. `UPDATE` and `DELETE` rows come back in the order
CamusDB changes them. Do not depend on that order.

### Transactions and retries

An autocommit write with `RETURNING` sent through a query endpoint still runs in
a writable transaction. CamusDB commits the write before it sends the schema or
any rows, so a client never receives rows from an attempt that failed to commit,
and a Serializable conflict can retry in a new transaction before any rows are
exposed.

Inside an explicit transaction, the rows come back before the final `COMMIT`,
as with any other statement. If the transaction rolls back, the writes are
removed.

### Privileges

A write with `RETURNING` needs the matching write privilege and `SELECT` on the
target table, because the `RETURNING` list reads stored row values, including
defaults. For example, a user with only `UPDATE` can run a plain `UPDATE`, but
not `UPDATE ... RETURNING`.

For `INSERT ... SELECT ... RETURNING`, the source tables also need `SELECT`, as
they do for a regular `INSERT ... SELECT`.

### Size limits

Returned rows also obey `max_buffered_result_rows` (1,000,000) and
`max_buffered_result_bytes` (256 MiB estimated memory) when collected before
commit. Exceeding either fails with `CADB0556` and rolls back. A streaming
query endpoint avoids the single-message gRPC limit, but does not bypass these
caps when a write must buffer RETURNING rows before committing. Reduce the
batch or returned columns, or raise the caps deliberately. See
[request resource limits](/docs/configuration#request-resource-limits).

The returned rows stay in server memory until the statement completes. The
number of written rows is still bounded by `max_mutations_per_transaction`.

A gRPC `ExecuteNonQuery` reply and a gRPC `NON_QUERY` batch reply carry all
returned rows in one message, and a default gRPC client receives at most 4 MiB
per message. If the `RETURNING` payload would exceed that limit, CamusDB fails
the statement with `CADB0550` `ReturningResultTooLarge` before commit, and the
statement is rolled back.

For large returned row sets, either:

- Send the statement to `ExecuteQuery`, which streams the rows.
- Set the count-only flag: `discard_returning_rows` on a gRPC request, or
  `discardReturningRows` in the JSON body of an HTTP request. The reply then
  carries only the row count.

## Concurrent updates and deletes

A single `UPDATE` or `DELETE` statement protects itself from concurrent commits
to the same row. CamusDB finds candidate rows, takes exclusive row locks,
rereads those rows, re-evaluates the `WHERE` clause, and then computes the write
from that locked read.

For example, `UPDATE accounts SET balance = balance + 1 WHERE id = ...` adds to
the latest committed balance for that row. If another transaction changed the
row so it no longer matches the predicate, or deleted it, CamusDB skips it.

Use [SELECT FOR UPDATE](/docs/sql-queries#for-update) in an explicit transaction
when a preceding read must hold its rows against other writers.

This protection covers one statement. A read in one statement followed by a
write in a later statement is still a read-then-write pattern; use Serializable
for that invariant, or express the change as one `UPDATE`.

## A WHERE clause is mandatory

`UPDATE` and `DELETE` both need a `WHERE` clause. This is a deliberate guard
against a common mistake: accidentally omitting the filter and changing or
deleting every row. CamusDB rejects a bare `UPDATE robots SET ...` or
`DELETE FROM robots` rather than treating it as an instruction to affect the
whole table.

This requirement applies to standalone `UPDATE` and `DELETE`. An
`ON CONFLICT DO UPDATE` arm already selects its row through a unique key, so
its additional `WHERE` is optional.

To intentionally affect every row, make that choice explicit with `WHERE 1 = 1`
or another predicate that is always true:

```camussql
UPDATE robots SET year = 2000 WHERE 1 = 1;
DELETE FROM robots WHERE 1 = 1;
```

These statements still validate constraints and run row triggers. A tautology
expresses whole-table intent; it does not bypass normal write behavior.

A write over a whole table is still one transaction, so the
[transaction limits](/docs/transaction-limits) bound it. For bulk expiry, use a
[TTL policy](/docs/row-level-ttl) instead, which deletes in batches.

To empty a whole table, use [`TRUNCATE`](/docs/truncate-table). It replaces the
[key space](/docs/concepts#key-space) that holds the table's rows and reads no
rows, so it has no mutation limit to exceed.
