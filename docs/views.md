---
sidebar_position: 2.7
---

# Views

A view is a stored query with a name. Reading it runs the query; nothing is
kept on disk. The SQL surface follows PostgreSQL, and the places where CamusDB
differs on purpose are listed at the end of this page.

For views that store their rows instead of recomputing them, see
[Materialized Views](/docs/materialized-views).

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer, total FROM orders WHERE status = 'open';

SELECT customer, SUM(total) AS spent
FROM open_orders
GROUP BY customer;
```

A view can publish its own column names:

```camussql
CREATE VIEW order_summary (order_id, who, amount) AS
  SELECT id, customer, total FROM orders;
```

## Why Use A View

Naming a query turns out to be worth more than the typing it saves.

- One definition, many readers. The join, the filter, and the business rule
  live in one place instead of being copy-pasted into every report and
  application that needs them. Fix the definition and every reader gets the fix.
- A slice of a table, granted safely. A view runs with the privileges of its
  owner, so you can give someone exactly the rows and columns it exposes without
  granting them the table underneath. See
  [Ownership And Security](#ownership-and-security).
- A stable contract over a moving schema. A view's shape is fixed when you
  create it and the engine keeps it that way: rename the base table or a base
  column and the view carries on unchanged, and a `DROP` that would strand it is
  refused rather than left to break the next read. Clients keep seeing the
  columns they were written against while the tables underneath stay free to
  evolve.
- Composable, and planned like a subquery. A view expands before planning, so
  it joins, aggregates, nests inside other views, and gets the same optimizer,
  index selection, and serializable locking a hand-written query would.
- Nothing to keep in sync. There is no stored copy and no refresh step, so a
  view is always as current as the tables it reads. When you would rather pay
  once and read many times, that is what
  [materialized views](/docs/materialized-views) are for.

### A Worked Example

Start by naming a rule the rest of the system keeps repeating:

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer, total
  FROM orders
  WHERE status = 'open';
```

Read it like a table, aggregate over it, join it, build on it:

```camussql
SELECT customer, SUM(total) AS outstanding
FROM open_orders
GROUP BY customer;

SELECT o.id, c.region
FROM open_orders o
INNER JOIN customers c ON o.customer = c.name;

CREATE VIEW large_open_orders AS
  SELECT id, customer FROM open_orders WHERE total > 1000;
```

Hand it to someone who has no access to `orders` at all:

```camussql
GRANT SELECT ON shop.open_orders TO reporting;
```

Then reshape the schema underneath it. Nothing written above has to change:

```camussql
ALTER TABLE orders RENAME TO sales_orders;
ALTER TABLE sales_orders RENAME COLUMN total TO amount;

SELECT customer, SUM(total) AS outstanding
FROM open_orders
GROUP BY customer;
-- unchanged: same view, same column names, same rows
```

## Reading Through A View

A view is expanded into a derived table before planning, so everything that
works on a subquery works on a view: joins, aggregation, `DISTINCT`,
`ORDER BY`, subqueries, the cost-based optimizer, spill, and serializable
range locking on the underlying base tables.

```camussql
SELECT v.id, c.region
FROM open_orders v
INNER JOIN customers c ON v.customer = c.name;
```

There is no "view scan" node in [`EXPLAIN`](/docs/explain); the plan shows what
actually runs, which is the expanded query. A view over an indexed table gets
those indexes, because by planning time there is no view left to get in the way.

For the same reason a view stores no statistics of its own. The estimates a plan
over a view uses belong to the tables its body reads, so
[`SHOW STATISTICS`](/docs/show-statistics) names the view and sends you to those
tables rather than reporting a set of numbers that do not exist.

A view may be referenced by its own name or given an alias:

```camussql
SELECT open_orders.customer FROM open_orders;   -- the view name is the default alias
SELECT o.customer FROM open_orders o;           -- an explicit alias wins
```

## The Body Is Checked At Creation

Every table, column, and function the body references is resolved when you run
`CREATE VIEW`, so a mistake is reported to the author instead of to whoever
reads the view first:

```camussql
CREATE VIEW v AS SELECT id FROM no_such_table;
-- CADB0011: table 'no_such_table' does not exist
```

### Every Output Column Needs A Name

A bare expression has no name to publish, and CamusDB refuses to invent one:

```camussql
CREATE VIEW v AS SELECT total + 1 FROM orders;
-- CADB0400: column 1 of the view body is an expression with no name; add an alias

CREATE VIEW v AS SELECT total + 1 AS total_plus_one FROM orders;  -- OK
```

PostgreSQL names such a column `?column?`. That name would appear in
`SHOW COLUMNS`, in dependent views, and in client column maps as something
nothing can select, and it would renumber itself if the projection list were
reordered.

### `SELECT *` Is Expanded Once

```camussql
CREATE VIEW all_orders AS SELECT * FROM orders;   -- orders has 4 columns
ALTER TABLE orders ADD COLUMN note STRING(64);

SELECT * FROM all_orders;                          -- still 4 columns
```

The view's shape is frozen at creation, matching PostgreSQL. Otherwise adding a
column to a base table would widen every `SELECT *` view over it, changing what
dependent views and clients see with no statement having been issued against
them.

A body may not mix `*` with other projections: the expansion order is not stable
across a base column being added, so the frozen shape could not be honored.

### What A Body May Not Contain

| Not allowed in a body | Why |
| --- | --- |
| `AS OF SYSTEM TIME` | An absolute timestamp would freeze the view to one instant forever; a relative one (`'-2h'`) would mean something different at every reference, so two readers would legitimately disagree about the contents. Use `CREATE TABLE ... AS SELECT ... AS OF SYSTEM TIME` for a point-in-time copy. |
| Index hints | A hint pins a plan choice into the stored definition, where it outlives the statistics it was chosen against. |
| Cache hints | Same reason, and a view is never cacheable anyway. See [Views And The Result Cache](#views-and-the-result-cache). |

Applying an index hint *to* a view reference is likewise refused: a view has no
indexes of its own, so the hint could only be applied to a relation the
statement does not name.

## Replacing A View

`CREATE OR REPLACE VIEW` may only append columns. Existing names, types, and
order must be preserved:

```camussql
CREATE VIEW v AS SELECT id, customer FROM orders;

CREATE OR REPLACE VIEW v AS SELECT id, customer, total FROM orders;  -- OK
CREATE OR REPLACE VIEW v AS SELECT id FROM orders;                   -- CADB0529
CREATE OR REPLACE VIEW v AS SELECT id, status FROM orders;           -- CADB0529
```

A dependent view binds to the column names it saw at its own creation, a cached
plan binds to positions, and a client binds to both. Changing any of them
silently would change what those objects mean, and the damage would surface
later and elsewhere as wrong data rather than as an error. Drop and recreate to
change the shape, which forces the dependents into the open.

The body itself may change freely, and takes effect on the next read:

```camussql
CREATE OR REPLACE VIEW v AS
  SELECT id, customer FROM orders WHERE status = 'closed';
```

## Dependencies And Schema Changes

A view records what it reads by object id, covering relations *and* the
individual columns inside them, never by name. Two things follow from that, and both work
in your favor: renaming anything a view reads is invisible to the view, and a
`DROP` that would leave a view pointing at nothing is caught at the `DROP` rather
than at whoever reads the view next.

### Renames Are Transparent

A stored body names the relations it reads by their immutable ids, so a rename
changes nothing about the view. There is no stored text to bring up to date:

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer FROM orders WHERE status = 'open';

ALTER TABLE orders RENAME TO sales;

SELECT id FROM open_orders;   -- still works

SHOW CREATE VIEW open_orders;
-- CREATE VIEW `open_orders` AS SELECT id, customer FROM sales AS orders WHERE status = 'open'
```

This applies to renaming a view that another view reads exactly as it does to a
table, and to renaming a column:

```camussql
ALTER TABLE sales RENAME COLUMN total TO amount;
SELECT id, total FROM open_orders;   -- still works, still called "total"
```

A view's output names are frozen at creation and do not follow the base column,
so a rename underneath it is invisible to anything reading it.

Names come back only when the definition is shown, and `SHOW CREATE VIEW` renders
each relation and column under its *current* name. The original relation name is
printed as an alias on purpose: qualified column references inside the body
resolve through it, so it has to stay fixed for the life of the definition. An
alias that would merely repeat the relation's current name is not printed, so an
ordinary view renders as you wrote it.

Definitions created by earlier versions name their relations directly. They keep
working and keep rendering unchanged, and the first rename that would otherwise
strand one converts it to the id form as part of the same replicated change, so
there is no window in which the rename has landed and the view has not caught up.

### Dropping A Relation

A drop that would orphan a dependent is refused:

```camussql
CREATE VIEW inner_v AS SELECT id, total FROM orders;
CREATE VIEW outer_v AS SELECT id FROM inner_v WHERE total > 10;

DROP VIEW inner_v;
-- CADB0530: cannot drop view 'inner_v' because other objects depend on it: outer_v

DROP VIEW inner_v CASCADE;   -- drops outer_v as well
```

The same rule protects tables:

```camussql
DROP TABLE orders;
-- CADB0530: cannot drop table 'orders' because other objects depend on it: open_orders
```

`DROP TABLE` has no `CASCADE` form; drop the dependent views first. This makes
`DROP TABLE` stricter than it was before views existed. The alternative is a
table drop that quietly converts every dependent view into a delayed error for
whoever reads it next.

### Dropping A Column

The same protection covers individual columns:

```camussql
ALTER TABLE orders DROP COLUMN total;
-- CADB0530: cannot drop column 'total' of table 'orders' because other objects
--           depend on it: open_orders
```

A column read only in a `WHERE` counts, as does one read inside a subquery, and a
materialized view's body protects the columns it reads on every refresh.
`DROP COLUMN` has no `CASCADE` form either; drop or replace the dependent view
first.

Two corner cases refuse a column *rename* rather than absorbing it, because the
body would be stranded rather than unaffected: a definition written before
columns were bound by id, and a reference in `ORDER BY`, `GROUP BY`, or `HAVING`
that matches one of the view's own output names. The second case is refused on
purpose: those clauses may legally name an output column rather than a base
column, so such a reference is left as written rather than guessed at.

The drop check is a lower bound rather than a guarantee: a reference the analysis
cannot attribute to exactly one relation is not recorded, so an unusually shaped
body may still let a column be dropped. It errs that way on purpose, since a
missed refusal only leaves the behavior that existed before the check, while a
wrong one would block a column change nothing actually depends on.

### Cycles

A view that would depend on itself is rejected at DDL time:

```camussql
CREATE VIEW a AS SELECT id FROM b;
CREATE OR REPLACE VIEW b AS SELECT id FROM a;
-- CADB0528: infinite recursion detected in the definition of view 'b'
```

Nesting is additionally capped at `max_view_expansion_depth` (default `32`) as a
backstop.

### Reserved Relation And Column Names

Stored bodies refer to a relation or a column by id using a reserved identifier
prefix, so nothing else may claim one. A table, view, or materialized view may
not be named with the `__camus_rel_` prefix, and a column may not be named with
the `__camus_col_` prefix:

```camussql
CREATE TABLE __camus_rel_7 (id INT64 PRIMARY KEY);
-- CADB0400: table name '__camus_rel_7' starts with '__camus_rel_', which is reserved
```

The guard applies to `CREATE`, `ALTER`, and `RENAME TO` alike.

## Ownership And Security

A view runs its body with the privileges of its owner, not of whoever queries
it. That is what makes a view a security boundary rather than a
shorthand:

```camussql
-- as alice, who can read orders
CREATE VIEW cheap_orders AS SELECT id, total FROM orders WHERE total < 25;
GRANT SELECT ON shop.cheap_orders TO bob;

-- as bob, who cannot read orders at all
SELECT * FROM cheap_orders;   -- works: exactly the rows the view exposes
SELECT * FROM orders;         -- CADB0517
```

The caller is checked on the view; the owner is checked on everything the body
reads. So a view can widen access to a slice of a table, and nothing more.

Details worth knowing:

- The owner is recorded by immutable id, not by name. Dropping a user and
  recreating the same name does not transfer ownership; the view fails closed,
  and reads refuse until it is recreated or transferred.
- `CREATE OR REPLACE VIEW` does not change the owner. Replacing rewrites the
  body; if it re-owned the object, replacing would be a way to seize a view and
  run it as yourself.
- `ALTER VIEW v OWNER TO u` transfers it. Only a superuser or the current owner
  may do so. An `ALTER` grant on the view is not enough, because ownership
  decides whose privileges the body runs with. The new owner must already exist.
- The swap is scoped to the view. A query naming the same table both through a
  view and directly gets the owner's rights only for the reference that came
  through the view.
- Each view in a chain runs as its own owner.
- Views are grantable objects. `GRANT SELECT ON db.my_view TO someone`.
  Dropping, renaming, replacing, and describing one all require a grant on the
  view, and `SHOW VIEWS` lists only what the caller can reach.

`security_invoker`, which would run a view as the caller instead of the owner, is
not supported. See [Authentication And Authorization](/docs/sql-authentication).

## Views And The Result Cache

A query that reads through a view is never served from the
[query result cache](/docs/query-result-cache). The cache fences one physical
table's row keyspace per entry, and a view expands to a derived table, which has
no keyspace of its own. This is the same limitation that makes joins
uncacheable.

A `{cache=name}` hint on a view reference is accepted rather than rejected, and
the response reports it as a bypass (`DerivedSource`), so the hint is visible
instead of silent. The rows still come from live storage every time.

Materialized views are unaffected: one is a physical relation, and the cache
treats it exactly as it treats a table.

## Introspection

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;
SHOW COLUMNS FROM open_orders;
```

`SHOW TABLES` lists tables only; it does not list views. PostgreSQL's `\dt`
behaves the same way, and changing `SHOW TABLES` output would break existing
clients.

`SHOW CREATE VIEW` prints the normalized definition, not the text you typed:

```camussql
CREATE VIEW v AS SELECT id,total FROM orders WHERE a OR b AND c;

SHOW CREATE VIEW v;
-- CREATE VIEW `v` AS SELECT id, total FROM orders WHERE a OR (b AND c)
```

Views are stored as a re-rendered definition so that references resolve by id and
`CREATE OR REPLACE` has a canonical form to compare against. PostgreSQL's
`pg_get_viewdef` also never returns the original text. The printed DDL is
guaranteed to re-parse to the same query, so it can be fed straight back to the
server.

## Renaming A View

```camussql
ALTER VIEW open_orders RENAME TO active_orders;
```

Metadata-only. The view's id is unchanged, so dependents keep resolving.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `max_view_expansion_depth` | `32` | Backstop on view-over-view nesting depth. |

See [Configuration](/docs/configuration) and
[`SHOW VARIABLES`](/docs/show-variables).

## Differences From PostgreSQL

| Area | CamusDB | Why |
| --- | --- | --- |
| Unnamed expression columns | Refused | PostgreSQL names them `?column?`, which nothing can reference. One `AS` produces a usable view. |
| Updatable views | Not implemented | All views are read-only today. |
| Rules and `INSTEAD OF` triggers | Not supported | CamusDB has neither, so there is no escape hatch to make a non-auto-updatable view writable. |
| `DROP TABLE ... CASCADE` | No `CASCADE` form | Drop the dependent views explicitly. |
| `security_invoker` views | Not supported | Only the owner's-rights model is implemented. |
| `WITH RECURSIVE` views | Not supported | CamusDB has no `WITH RECURSIVE`. |
| Cross-database views | Not supported | Matches the existing single-database restriction on `INSERT ... SELECT`. |
| Temporary views | Not supported | CamusDB has no temporary relations. |
| Mixing `*` with other projections | Refused | The expansion order is not stable across a base column being added. |
| `AS OF SYSTEM TIME` in a body | Refused | Neither an absolute nor a relative timestamp is storable coherently. |

## Not Implemented Yet

These parse and are rejected at execution, so they fail loudly rather than doing
something unexpected:

- Updatable views. `INSERT`, `UPDATE`, and `DELETE` through a view, the
  auto-updatability rules, and `WITH CHECK OPTION` enforcement. The
  `WITH [LOCAL|CASCADED] CHECK OPTION` clause parses and is stored, but nothing
  enforces it yet. All views are read-only.
- Re-checking a nested view's grant at read time. A view whose body reads
  another view has that inner reference checked when it is *created*, not on
  every read; a grant revoked afterwards does not break the outer view until it
  is replaced. The inner view still runs as its own owner, so this widens
  nothing beyond what its author could already reach.
- Absorbing a column rename into a definition written before columns were bound
  by id, or into a reference in `ORDER BY`, `GROUP BY`, or `HAVING` that matches
  one of the view's own output names. Both are refused instead. See
  [Dropping A Column](#dropping-a-column).

## Related Pages

[Materialized Views](/docs/materialized-views) for stored results,
[Inspecting The Database](/docs/sql-inspection) for the `SHOW` family,
[Authentication And Authorization](/docs/sql-authentication) for grants, and
[Error Codes](/docs/error-codes) for the `CADB05xx` codes referenced above.
