---
sidebar_position: 2.8
---

# Materialized views

A materialized view runs its query one time. It stores the rows. It then answers
every read from that stored copy, until you refresh it.

A plain [view](/docs/views) exchanges storage for freshness. A materialized view
exchanges freshness for speed.

```camussql
CREATE MATERIALIZED VIEW customer_totals AS
  SELECT customer, SUM(total) AS total_spent
  FROM orders
  GROUP BY customer;

SELECT * FROM customer_totals WHERE customer = 'acme';  -- does not touch orders

REFRESH MATERIALIZED VIEW customer_totals;              -- re-runs the query
```

A later insert into `orders` changes nothing in the result of
`customer_totals`. That behavior is the purpose of the feature, and it is the
one behavior to learn. A materialized view is a snapshot. Only a `REFRESH` moves
it forward. `SHOW MATERIALIZED VIEWS` reports the staleness of each one.

## Why you use one

A plain view runs its query again at every read. That query can be a wide join,
or an aggregate over a large table. Every reader then pays that cost every time.

A materialized view pays one time, at the refresh. It gives the answer out after
that.

- The cost of a read stops following the base table. A rollup over ten million
  orders answers from the rows of the rollup itself. Growth in `orders` makes
  the refresh longer. It does not make the dashboard slower.
- You can index it, analyze it, and cache it. The stored rows are an ordinary
  relation. An index on the column of your filter therefore turns the read into
  a lookup. A plain view has no rows of its own, and it cannot offer that.
- A refresh never blocks a reader. The rebuild happens beside the live copy, and
  it swaps in atomically. There is no period in which a read is slow, blocked by
  a lock, or aimed at a result that is half built.
- A snapshot is often what a report needs. Every panel that reads the same
  materialized view sees the same instant. A second run of a query gives the
  same answer, until you refresh. Several live queries in a race with each other
  give that consistency less easily.

### A worked example

Here is an expensive rollup that a dashboard reads constantly:

```camussql
CREATE MATERIALIZED VIEW customer_totals AS
  SELECT customer, SUM(total) AS total_spent, COUNT(*) AS orders_placed
  FROM orders
  GROUP BY customer;

CREATE INDEX customer_totals_customer ON customer_totals (customer);
```

Every read after that is a lookup in a small indexed relation. The size of
`orders` does not matter:

```camussql
SELECT total_spent FROM customer_totals WHERE customer = 'acme';
```

Move the view forward when you want that. Use a nightly job, a step after a bulk
load, or a statement by hand:

```camussql
REFRESH MATERIALIZED VIEW customer_totals;
```

### Which one do you want

| | Reads | Freshness | Storage | Indexable |
| --- | --- | --- | --- | --- |
| A [view](/docs/views) | It runs the query again | Always current | None | No. It has no row. |
| A materialized view | It reads the stored rows | The state at the last `REFRESH` | A full copy | Yes |
| A [`CREATE TABLE ... AS SELECT`](/docs/insert-select-and-ctas) | It reads the stored rows | Fixed. Nothing regenerates it. | A full copy | Yes |

Use a plain view when the query is cheap, or when the answer must be current.

Use a materialized view when the query is expensive, and when an answer of a
known age is acceptable.

Use `CREATE TABLE ... AS SELECT` when you want one copy that nothing will
regenerate. It produces a plain table. That table has no link back to the query
that filled it.

## It is a real relation

CamusDB stores a materialized view as an ordinary relation. Almost everything
that works on a table therefore works on it:

```camussql
CREATE INDEX customer_totals_customer ON customer_totals (customer);
ANALYZE TABLE customer_totals;
COMMENT ON TABLE customer_totals IS 'nightly rollup';
SHOW COLUMNS FROM customer_totals;
```

An index survives a refresh. Four other features treat it as the relation that
it is: the backup and the recovery to a point in time,
[database branching](/docs/database-branching), the [TTL](/docs/row-level-ttl),
and the statistics of the planner. It is cacheable like a table. A plain view is
not.

A refresh carries the counts that it measured onto the view. Those counts are
the number of rows and the number of index entries. The planner therefore costs
the view correctly at once.

CamusDB drops the histograms of an earlier `ANALYZE` at the same moment. Those
histograms describe the contents that the refresh replaced. The view therefore
looks stale enough for [automatic analyze](/docs/automatic-analyze) to build
them again.
[`SHOW STATISTICS FOR <view>`](/docs/show-statistics) reports the current
contents at any moment.

One operation is not available. You cannot write to a materialized view:

```camussql
INSERT INTO customer_totals (customer, total_spent) VALUES ('acme', 1);
-- 'customer_totals' is a materialized view and cannot be written to directly
```

The next refresh would discard a row that you wrote by hand. CamusDB therefore
refuses the write. It does not accept the row and erase it later.

## The shape is fixed at the creation

CamusDB derives the list of the columns from the query, at the creation of the
materialized view. A refresh reuses that list. It does not derive the list
again.

A new column on a base table therefore does not widen an existing materialized
view. A plain view follows the same rule, for the same reason.

Every output column needs a name, as with a
[`CREATE TABLE ... AS SELECT`](/docs/insert-select-and-ctas). The relation also
receives a generated primary key `id`. A projection carries no guarantee of
uniqueness of its own.

An explicit list of the columns renames the stored columns:

```camussql
CREATE MATERIALIZED VIEW open_orders (order_id, amount) AS
  SELECT id, total FROM orders WHERE status = 'open';
```

## WITH NO DATA

`WITH NO DATA` creates the materialized view without a run of the query.

A read of a view that never held data is an error. It is not an empty result. An
empty result would make a forgotten `REFRESH` look the same as a correct
answer:

```camussql
CREATE MATERIALIZED VIEW customer_totals AS SELECT ... WITH NO DATA;

SELECT * FROM customer_totals;
-- CADB0531: materialized view 'customer_totals' has not been populated

REFRESH MATERIALIZED VIEW customer_totals;   -- now it reads
```

`REFRESH MATERIALIZED VIEW ... WITH NO DATA` empties a view again. It returns
the view to that state.

## What a refresh does to a reader

It does nothing to a reader. A refresh builds a completely new relation. It
fills that relation. It then moves the name of the materialized view onto it, in
one atomic change of the schema.

A reader that already runs continues on the previous contents, at its own
snapshot. A reader that starts after the change sees the new contents complete.
Nobody waits. Nobody ever observes a materialized view that is half built. That
is true for a short moment, and it is true on every node of a cluster.

For that reason, CamusDB refuses `REFRESH MATERIALIZED VIEW ... CONCURRENTLY`
with `CADB0533`. It does not accept the word as a synonym.

In PostgreSQL, `CONCURRENTLY` exists because the ordinary form takes an
exclusive lock, and blocks a reader. The ordinary form of CamusDB does not.
`CONCURRENTLY` also buys something else: a write of only the rows that changed.
That is a real optimization, and CamusDB does not implement it. The statement
therefore says so. It does not quietly do something else.

The rebuild reads its source at one pinned snapshot, for its whole duration. The
result is therefore always a state that the database truly held, however long
the rebuild takes.

The rebuild writes in transactions of a fixed size, from
`materialized_view_refresh_chunk_rows`. A materialized view can therefore exceed
the limit on the mutations of one transaction. That limit would otherwise cap
its size. See [Transaction Limits](/docs/transaction-limits).

A refresh can fail. CamusDB then leaves the materialized view exactly as it was.
It discards a failed rebuild. It never publishes one in part.

## One refresh at a time

Only one refresh of a materialized view runs at a time, anywhere in the cluster.
CamusDB refuses a second one with `CADB0532` while the first is in flight. The
node of the second statement does not matter.

A refresh can stop without a failure, because the process died or the node lost
its leadership in the middle. A background sweep then takes that refresh, and it
runs the refresh again from the start. `materialized_view_refresh_takeover_attempts`
caps the number of those attempts.

The sweep takes the same fence across the cluster as a `REFRESH`. Exactly one
node therefore finishes the work. No rebuild ever runs twice.

The sweep restarts the refresh. It does not resume the refresh. A continuation
of a scan that stopped in the middle would need one property: the body must
yield the rows in the same order at every execution. That is true of a scan of
one relation. It is not promised for a join, and it is not promised for an
aggregate. A resume of one of those would leave the materialized view with a
duplicated row and a missing row.

The view serves its previous contents until a restart completes. After the
attempts run out, CamusDB leaves the view stale. It logs an error that names the
view. You then run a `REFRESH` yourself.

## Dependencies and the life of a view

```camussql
ALTER MATERIALIZED VIEW customer_totals RENAME TO totals_by_customer;
DROP MATERIALIZED VIEW customer_totals;
DROP MATERIALIZED VIEW IF EXISTS customer_totals CASCADE;
```

A plain view may read a materialized view. CamusDB refuses a drop of that
materialized view, unless you write `CASCADE`. The rule for a table is the same.

A rename is invisible to the views that read the materialized view. Their bodies
refer to it by an id. See
[A rename is transparent](/docs/views#a-rename-is-transparent).

A table, a view, and a materialized view share one namespace. A table and a
materialized view therefore cannot hold the same name.

Each kind of object has its own statement for a drop. `DROP TABLE` refuses a
materialized view, and it names the statement to use instead.

A materialized view is not a boundary of security. A plain view is. CamusDB
computed the rows of a materialized view at the time of the refresh. A read of
one is therefore an ordinary read of a relation. CamusDB checks it against the
caller.

## A truncate of a base table

[`TRUNCATE`](/docs/truncate-table) empties a base table. A materialized view
that reads that table keeps the rows of its last refresh, and it becomes stale.

That behavior matches the treatment of `INSERT`, `UPDATE`, and `DELETE`. No
mutation of a base table invalidates a dependent materialized view. Run a
refresh when you want the view to agree:

```camussql
TRUNCATE TABLE orders;
REFRESH MATERIALIZED VIEW orders_by_day;
```

CamusDB refuses a truncate of a materialized view itself, with `CADB0525`
`ViewNotUpdatable`. Use `REFRESH MATERIALIZED VIEW ... WITH NO DATA` to empty
one.

## Introspection

```camussql
SHOW MATERIALIZED VIEWS;              -- name, whether it holds data, and its snapshot
SHOW MATERIALIZED VIEWS LIKE 'cust%';
SHOW CREATE MATERIALIZED VIEW customer_totals;
SHOW COLUMNS FROM customer_totals;
SHOW INDEXES FROM customer_totals;
```

`SHOW TABLES` lists a table only. It lists no view, and no materialized view.

`SHOW CREATE MATERIALIZED VIEW` prints `WITH NO DATA` for a view without data.
Its output therefore creates the same object again. It does not create a
populated object that only looks the same.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `materialized_view_refresh_chunk_rows` | `10000` | The rows that CamusDB writes in one transaction during a rebuild. The value must stay well below `max_mutations_per_transaction`. |
| `materialized_view_refresh_enabled` | `true` | Set it to `false` to refuse a refresh on a node that must not run bulk work. `WITH NO DATA` still works. |
| `materialized_view_refresh_takeover_attempts` | `3` | The number of restarts of a refresh that a crash or a change of leadership interrupted. A value of `0` restarts none of them. It only reclaims the abandoned storage. |

All three settings appear in [`SHOW VARIABLES`](/docs/show-variables).

## Not implemented yet

- An incremental refresh, which is `REFRESH MATERIALIZED VIEW ...
  CONCURRENTLY`. It would write only the rows that changed, instead of a
  rebuild. The plain form works, and it blocks no reader.
- A resume of an interrupted refresh in the middle of its scan. CamusDB restarts
  such a refresh from the start. It does not continue from the point of the
  stop. See [One refresh at a time](#one-refresh-at-a-time). The work of the
  dead run is therefore paid for again. The materialized view stays untouched
  during that time. Nothing is left in an inconsistent state.

## Related pages

- [Views](/docs/views) for a plain view, and for the rules that both kinds
  share.
- [Copying Query Results](/docs/insert-select-and-ctas) for the alternative that
  runs one time.
- [Error Codes](/docs/error-codes) for the codes above.
