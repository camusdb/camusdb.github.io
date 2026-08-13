---
sidebar_position: 2.8
---

# Materialized Views

A materialized view runs its query once, stores the rows, and answers every read
from that stored copy until you refresh it. A plain [view](/docs/views) trades
storage for freshness; a materialized view trades freshness for speed.

```camussql
CREATE MATERIALIZED VIEW customer_totals AS
  SELECT customer, SUM(total) AS total_spent
  FROM orders
  GROUP BY customer;

SELECT * FROM customer_totals WHERE customer = 'acme';  -- does not touch orders

REFRESH MATERIALIZED VIEW customer_totals;              -- re-runs the query
```

Inserting into `orders` afterwards changes nothing that `customer_totals`
returns. That is the point, and it is the one behavior to internalize: **a
materialized view is a snapshot, and only `REFRESH` moves it forward.**
`SHOW MATERIALIZED VIEWS` reports how stale each one is.

## It Is A Real Relation

A materialized view is stored as an ordinary relation, so nearly everything that
works on a table works on it:

```camussql
CREATE INDEX customer_totals_customer ON customer_totals (customer);
ANALYZE TABLE customer_totals;
COMMENT ON TABLE customer_totals IS 'nightly rollup';
SHOW COLUMNS FROM customer_totals;
```

Indexes are kept across refreshes. Backup and point-in-time recovery,
[database branching](/docs/database-branching), [TTL](/docs/row-level-ttl), and
the planner's statistics all treat it as the relation it is. It is cacheable
like a table, unlike a plain view.

The one thing you cannot do is write to it:

```camussql
INSERT INTO customer_totals (customer, total_spent) VALUES ('acme', 1);
-- 'customer_totals' is a materialized view and cannot be written to directly
```

A hand-written row would be discarded by the next refresh, so the write is
refused rather than accepted and later erased.

## Its Shape Is Fixed At Creation

The column list is derived from the query when the materialized view is created,
and a refresh reuses it rather than re-deriving it. Adding a column to a base
table therefore does not widen an existing materialized view — the same rule
plain views follow, for the same reason.

As with [`CREATE TABLE ... AS SELECT`](/docs/insert-select-and-ctas), every
output column needs a name, and the relation gets a generated `id` primary key
because a projection carries no uniqueness guarantee of its own. An explicit
column list renames the stored columns:

```camussql
CREATE MATERIALIZED VIEW open_orders (order_id, amount) AS
  SELECT id, total FROM orders WHERE status = 'open';
```

## `WITH NO DATA`

`WITH NO DATA` creates the materialized view without running the query. Reading
one that has never been populated is an **error, not an empty result** — an
empty result would make a forgotten `REFRESH` indistinguishable from a correct
answer:

```camussql
CREATE MATERIALIZED VIEW customer_totals AS SELECT ... WITH NO DATA;

SELECT * FROM customer_totals;
-- CADB0531: materialized view 'customer_totals' has not been populated

REFRESH MATERIALIZED VIEW customer_totals;   -- now it reads
```

`REFRESH MATERIALIZED VIEW ... WITH NO DATA` empties one again and returns it to
that state.

## What A Refresh Does To Readers

Nothing. A refresh builds an entirely new relation, populates it, and then moves
the materialized view's name onto it in one atomic schema change. Readers
already running keep reading the previous contents at their own snapshot;
readers that start after the switch see the new contents whole. **Nobody blocks,
and nobody ever observes a half-built materialized view** — not even briefly,
and not on any node of a cluster.

That is why `REFRESH MATERIALIZED VIEW ... CONCURRENTLY` is refused (`CADB0533`)
rather than accepted as a synonym. In PostgreSQL, `CONCURRENTLY` exists because
the ordinary form takes an exclusive lock and blocks readers; CamusDB's ordinary
form already does not. What `CONCURRENTLY` additionally buys — writing only the
rows that changed — is a genuine optimization that is not implemented, so the
statement says so instead of quietly doing something else.

The rebuild reads its source at **one pinned snapshot** for its whole duration,
so the result is always a state the database actually was in, however long the
rebuild takes. It writes in chunked transactions
(`materialized_view_refresh_chunk_rows`), which is what lets a materialized view
exceed the per-transaction mutation limit that would otherwise cap its size —
see [Transaction Limits](/docs/transaction-limits).

If a refresh fails, the materialized view is left exactly as it was. A failed
rebuild is discarded, never partially published.

## One Refresh At A Time

Only one refresh of a given materialized view runs at a time anywhere in the
cluster. A second one is refused with `CADB0532` while the first is in flight,
whichever node it was issued on.

A refresh that is **interrupted** rather than failed — the process died, or the
node lost leadership part-way — is picked up by a background sweep and run again
**from the beginning**, up to `materialized_view_refresh_takeover_attempts`
times. The sweep takes the same cluster-wide fence a `REFRESH` takes, so exactly
one node finishes the work and no rebuild is ever running twice.

It is a restart, not a resume. Continuing a half-finished scan would require the
body to yield rows in the same order on every execution, which is true of a
single-relation scan and not promised for a join or an aggregate — resuming one
of those would leave a materialized view with duplicated and missing rows.

The view keeps serving its previous contents until a restart completes. When the
attempts run out it is left stale, an error is logged naming it, and it is yours
to `REFRESH` again.

## Dependencies And Lifecycle

```camussql
ALTER MATERIALIZED VIEW customer_totals RENAME TO totals_by_customer;
DROP MATERIALIZED VIEW customer_totals;
DROP MATERIALIZED VIEW IF EXISTS customer_totals CASCADE;
```

A plain view may read a materialized view. Dropping the materialized view out
from under it is refused unless you say `CASCADE`, exactly as for a table.
Renaming one is invisible to the views that read it, since their bodies refer to
it by id — see [Renames Are Transparent](/docs/views#renames-are-transparent).

Tables, views, and materialized views share **one namespace**: a table and a
materialized view cannot have the same name, and each kind is dropped by its own
statement — `DROP TABLE` refuses a materialized view and names the statement to
use instead.

Unlike a plain view, a materialized view is not a security boundary. Its rows
were computed at refresh time, so reading one is an ordinary read of a relation,
checked against the caller.

## Introspection

```camussql
SHOW MATERIALIZED VIEWS;              -- name, whether it holds data, and its snapshot
SHOW MATERIALIZED VIEWS LIKE 'cust%';
SHOW CREATE MATERIALIZED VIEW customer_totals;
SHOW COLUMNS FROM customer_totals;
SHOW INDEXES FROM customer_totals;
```

`SHOW TABLES` lists tables only — neither views nor materialized views.
`SHOW CREATE MATERIALIZED VIEW` prints `WITH NO DATA` for an unpopulated one, so
its output recreates the same object rather than a populated lookalike.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `materialized_view_refresh_chunk_rows` | `10000` | Rows written per transaction while rebuilding. Must stay well below `max_mutations_per_transaction`. |
| `materialized_view_refresh_enabled` | `true` | Set `false` to refuse refreshes on a node that should not run bulk work. `WITH NO DATA` still works. |
| `materialized_view_refresh_takeover_attempts` | `3` | How many times a refresh interrupted by a crash or a leadership change is restarted for you. `0` restarts none of them and only reclaims the abandoned storage. |

All three appear in [`SHOW VARIABLES`](/docs/show-variables).

## Not Implemented Yet

- **Incremental refresh** (`REFRESH MATERIALIZED VIEW ... CONCURRENTLY`), which
  would write only the rows that changed instead of rebuilding. The plain form
  works and does not block readers.
- **Resuming an interrupted refresh mid-scan.** An interrupted refresh is
  restarted from the beginning rather than continued from where it stopped (see
  [One Refresh At A Time](#one-refresh-at-a-time)) — the work the dead run did is
  paid for again. The materialized view is untouched in the meantime, so nothing
  is left inconsistent.

## Related Pages

[Views](/docs/views) for plain views and the rules both kinds share,
[Copying Query Results](/docs/insert-select-and-ctas) for the one-off
alternative, and [Error Codes](/docs/error-codes) for the codes above.
