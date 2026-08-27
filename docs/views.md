---
sidebar_position: 2.7
---

# Views

A view is a stored query with a name. A read of the view runs the query. CamusDB
keeps nothing on disk. The SQL surface follows PostgreSQL. The end of this page
lists the places where CamusDB differs by design.

For a view that stores its rows instead of a recomputation, see
[Materialized Views](/docs/materialized-views).

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer, total FROM orders WHERE status = 'open';

SELECT customer, SUM(total) AS spent
FROM open_orders
GROUP BY customer;
```

A view can publish its own names for the columns:

```camussql
CREATE VIEW order_summary (order_id, who, amount) AS
  SELECT id, customer, total FROM orders;
```

## Why you use a view

A name for a query is worth more than the text that it saves.

- One definition serves many readers. The join, the filter, and the rule of the
  business live in one place. You do not copy them into every report and every
  application that needs them. Correct the definition, and every reader receives
  that correction.
- A slice of a table, granted safely. A view runs with the privileges of its
  owner. You can therefore give a user exactly the rows and the columns that the
  view exposes. You grant no access to the table below it. See
  [Ownership and security](#ownership-and-security).
- A stable contract over a schema that moves. CamusDB fixes the shape of a view
  at its creation, and it keeps that shape. You can rename the base table, and
  you can rename a base column. The view continues without a change. CamusDB
  also refuses a `DROP` that would strand the view. A client therefore keeps the
  columns that it was written against, while the tables below stay free to
  change.
- A view composes, and CamusDB plans it like a subquery. A view expands before
  the plan. It therefore joins, aggregates, and nests inside another view. It
  receives the same optimizer, the same choice of an index, and the same
  serializable locks as a query that you write by hand.
- There is nothing to keep in agreement. There is no stored copy, and there is
  no step of a refresh. A view is therefore always as current as the tables that
  it reads. Use a [materialized view](/docs/materialized-views) when you prefer
  to pay one time and to read many times.

### A worked example

Start with a name for a rule that the rest of the system repeats:

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer, total
  FROM orders
  WHERE status = 'open';
```

Read it like a table. Aggregate over it. Join it. Build on it:

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

Give it to a user with no access at all to `orders`:

```camussql
GRANT SELECT ON shop.open_orders TO reporting;
```

Then change the schema below the view. Nothing above needs a change:

```camussql
ALTER TABLE orders RENAME TO sales_orders;
ALTER TABLE sales_orders RENAME COLUMN total TO amount;

SELECT customer, SUM(total) AS outstanding
FROM open_orders
GROUP BY customer;
-- unchanged: same view, same column names, same rows
```

## Read through a view

CamusDB expands a view into a derived table before the plan. Everything that
works on a subquery therefore works on a view. Eight examples follow:

- A join.
- An aggregation.
- A `DISTINCT`.
- An `ORDER BY`.
- A subquery.
- The cost-based optimizer.
- The spill to disk.
- A serializable range lock on a base table.

```camussql
SELECT v.id, c.region
FROM open_orders v
INNER JOIN customers c ON v.customer = c.name;
```

There is no node for a scan of a view in [`EXPLAIN`](/docs/explain). The plan
shows the query that runs, which is the expanded form. A view over an indexed
table receives those indexes. At the time of the plan, no view remains in the
way.

For the same reason, a view stores no statistics of its own. A plan over a view
uses the estimates of the tables that its body reads.
[`SHOW STATISTICS`](/docs/show-statistics) therefore names the view, and it
sends you to those tables. It does not report numbers that do not exist.

You can reference a view by its own name. You can also give it an alias:

```camussql
SELECT open_orders.customer FROM open_orders;   -- the view name is the default alias
SELECT o.customer FROM open_orders o;           -- an explicit alias wins
```

## CamusDB checks the body at the creation

CamusDB resolves every table, every column, and every function of the body when
you run `CREATE VIEW`. It therefore reports a mistake to the author. It does not
report that mistake to the first reader of the view:

```camussql
CREATE VIEW v AS SELECT id FROM no_such_table;
-- CADB0011: table 'no_such_table' does not exist
```

### Every output column needs a name

A bare expression has no name to publish. CamusDB refuses to invent one:

```camussql
CREATE VIEW v AS SELECT total + 1 FROM orders;
-- CADB0400: column 1 of the view body is an expression with no name; add an alias

CREATE VIEW v AS SELECT total + 1 AS total_plus_one FROM orders;  -- OK
```

PostgreSQL names such a column `?column?`. That name would appear in `SHOW
COLUMNS`, in a dependent view, and in the map of the columns of a client.
Nothing can select it. It would also change its own number if you reordered the
list of the projections.

### CamusDB expands a SELECT * one time

```camussql
CREATE VIEW all_orders AS SELECT * FROM orders;   -- orders has 4 columns
ALTER TABLE orders ADD COLUMN note STRING(64);

SELECT * FROM all_orders;                          -- still 4 columns
```

CamusDB fixes the shape of the view at its creation, as PostgreSQL does.
Otherwise a new column on a base table would widen every `SELECT *` view over
it. That change would alter what a dependent view and a client see, and nobody
issued a statement against them.

A body may not mix a `*` with another projection. The order of the expansion is
not stable when somebody adds a base column. CamusDB could therefore not hold
the fixed shape.

### What a body may not hold

| Not allowed in a body | Why |
| --- | --- |
| `AS OF SYSTEM TIME` | An absolute timestamp would fix the view to one instant forever. A relative one, such as `'-2h'`, would mean something different at each reference. Two readers would then disagree about the contents, and both would be correct. Use `CREATE TABLE ... AS SELECT ... AS OF SYSTEM TIME` for a copy at a point in time. |
| A hint for an index | A hint fixes the choice of a plan inside the stored definition. That choice then outlives the statistics that produced it. |
| A hint for the cache | The reason is the same. A view is also never cacheable. See [Views and the result cache](#views-and-the-result-cache). |

CamusDB also refuses a hint for an index on a reference to a view. A view has no
index of its own. The hint could therefore apply only to a relation that the
statement does not name.

## Replace a view

`CREATE OR REPLACE VIEW` may only add a column at the end. It must preserve the
existing names, the existing types, and the existing order:

```camussql
CREATE VIEW v AS SELECT id, customer FROM orders;

CREATE OR REPLACE VIEW v AS SELECT id, customer, total FROM orders;  -- OK
CREATE OR REPLACE VIEW v AS SELECT id FROM orders;                   -- CADB0529
CREATE OR REPLACE VIEW v AS SELECT id, status FROM orders;           -- CADB0529
```

A dependent view binds to the names of the columns at its own creation. A cached
plan binds to the positions. A client binds to both. A silent change of any of
them would change the meaning of those objects. The damage would appear later,
and elsewhere, as wrong data. It would not appear as an error.

Drop the view and create it again to change the shape. That path forces the
dependents into the open.

The body itself may change freely. The change takes effect at the next read:

```camussql
CREATE OR REPLACE VIEW v AS
  SELECT id, customer FROM orders WHERE status = 'closed';
```

## Dependencies and schema changes

A view records what it reads by the id of the object. It records the relations,
and the individual columns inside them. It never records a name.

Two results follow, and both help you. A rename of anything that a view reads is
invisible to the view. A `DROP` that would leave a view with nothing to read
fails at the `DROP`. It does not fail at the next reader of the view.

### A rename is transparent

A stored body names each relation by an immutable id. A rename therefore changes
nothing about the view. There is no stored text to update:

```camussql
CREATE VIEW open_orders AS
  SELECT id, customer FROM orders WHERE status = 'open';

ALTER TABLE orders RENAME TO sales;

SELECT id FROM open_orders;   -- still works

SHOW CREATE VIEW open_orders;
-- CREATE VIEW `open_orders` AS SELECT id, customer FROM sales AS orders WHERE status = 'open'
```

The rule covers three cases in the same way: a rename of a table, a rename of a
view that another view reads, and a rename of a column:

```camussql
ALTER TABLE sales RENAME COLUMN total TO amount;
SELECT id, total FROM open_orders;   -- still works, still called "total"
```

CamusDB fixes the output names of a view at its creation. They do not follow the
base column. A rename below the view is therefore invisible to every reader of
it.

A name returns only in the display of the definition. `SHOW CREATE VIEW` renders
each relation and each column under its current name.

That output prints the original name of a relation as an alias, by design. A
qualified reference to a column inside the body resolves through that alias. The
alias must therefore stay fixed for the life of the definition. CamusDB does not
print an alias that would only repeat the current name of the relation. An
ordinary view therefore renders as you wrote it.

A definition from an earlier version names its relations directly. It continues
to work, and it continues to render without a change. The first rename that
would otherwise strand such a definition converts it to the form with ids. That
conversion is part of the same replicated change. There is therefore no period
in which the rename landed and the view did not catch up.

### Drop a relation

CamusDB refuses a drop that would leave a dependent with nothing to read:

```camussql
CREATE VIEW inner_v AS SELECT id, total FROM orders;
CREATE VIEW outer_v AS SELECT id FROM inner_v WHERE total > 10;

DROP VIEW inner_v;
-- CADB0530: cannot drop view 'inner_v' because other objects depend on it: outer_v

DROP VIEW inner_v CASCADE;   -- drops outer_v as well
```

The same rule protects a table:

```camussql
DROP TABLE orders;
-- CADB0530: cannot drop table 'orders' because other objects depend on it: open_orders
```

`DROP TABLE` has no `CASCADE` form. Drop the dependent views first. That rule
makes `DROP TABLE` stricter than it was before views existed. The alternative is
a drop of a table that quietly converts every dependent view into a later error,
for the next reader.

### Drop a column

The same protection covers one column:

```camussql
ALTER TABLE orders DROP COLUMN total;
-- CADB0530: cannot drop column 'total' of table 'orders' because other objects
--           depend on it: open_orders
```

A column that a body reads only in a `WHERE` clause counts. A column that a body
reads inside a subquery also counts. The body of a materialized view protects
the columns that it reads, at every refresh.

`DROP COLUMN` has no `CASCADE` form either. Drop the dependent view first, or
replace it.

Two corner cases refuse a rename of a column, instead of an absorption of that
rename. The body would be stranded, and not merely unaffected:

1. A definition from before the time when CamusDB bound a column by its id.
2. A reference in an `ORDER BY`, a `GROUP BY`, or a `HAVING` clause that matches
   one of the output names of the view itself.

CamusDB refuses the second case by design. Those clauses may legally name an
output column, and not a base column. CamusDB therefore leaves such a reference
as you wrote it. It does not guess at the meaning.

The check of a drop is a lower bound. It is not a guarantee. CamusDB does not
record a reference that its analysis cannot attribute to exactly one relation. A
body with an unusual shape can therefore still permit a drop of a column.

That behavior errs in the safe direction by design. A refusal that CamusDB
misses only leaves the behavior from before the check. A wrong refusal would
block a change of a column that nothing depends on.

### Cycles

CamusDB rejects a view that would depend on itself. It does so at the time of
the DDL statement:

```camussql
CREATE VIEW a AS SELECT id FROM b;
CREATE OR REPLACE VIEW b AS SELECT id FROM a;
-- CADB0528: infinite recursion detected in the definition of view 'b'
```

`max_view_expansion_depth` caps the depth of the nest as a backstop. The default
is `32`.

### Reserved names of a relation and of a column

A stored body refers to a relation or a column by its id. It uses a reserved
prefix of an identifier for that purpose. Nothing else may claim such a prefix.

A table, a view, and a materialized view may not take a name with the prefix
`__camus_rel_`. A column may not take a name with the prefix `__camus_col_`:

```camussql
CREATE TABLE __camus_rel_7 (id INT64 PRIMARY KEY);
-- CADB0400: table name '__camus_rel_7' starts with '__camus_rel_', which is reserved
```

The guard applies to `CREATE`, to `ALTER`, and to `RENAME TO`.

## Ownership and security

A view runs its body with the privileges of its owner. It does not use the
privileges of the caller. That property makes a view a boundary of security. It
is not only a short form of a query:

```camussql
-- as alice, who can read orders
CREATE VIEW cheap_orders AS SELECT id, total FROM orders WHERE total < 25;
GRANT SELECT ON shop.cheap_orders TO bob;

-- as bob, who cannot read orders at all
SELECT * FROM cheap_orders;   -- works: exactly the rows the view exposes
SELECT * FROM orders;         -- CADB0517
```

CamusDB checks the caller on the view. It checks the owner on everything that
the body reads. A view can therefore widen the access to a slice of a table. It
widens nothing more.

These details are worth your attention:

- CamusDB records the owner by an immutable id. It does not record a name. A
  drop of a user, and a creation of the same name again, therefore transfers no
  ownership. The view fails closed, and a read refuses until you create the view
  again, or transfer it.
- `CREATE OR REPLACE VIEW` does not change the owner. A replacement rewrites the
  body. A change of the owner would make a replacement into a way to take a view
  and to run it as yourself.
- `ALTER VIEW v OWNER TO u` transfers the view. Only a superuser and the current
  owner may do that. A grant of `ALTER` on the view is not enough. The ownership
  decides whose privileges the body uses. The new owner must exist already.
- The change of the privileges belongs to the view alone. A query can name the
  same table twice: one time through a view, and one time directly. It receives
  the rights of the owner for the reference through the view only.
- Each view of a chain runs as its own owner.
- A view is an object that you can grant. Use `GRANT SELECT ON db.my_view TO
  someone`. A drop, a rename, a replacement, and a description of a view all
  need a grant on the view. `SHOW VIEWS` lists only what the caller can reach.

CamusDB does not support `security_invoker`. That option would run a view as the
caller, and not as the owner. See
[Authentication And Authorization](/docs/sql-authentication).

## Views and the result cache

CamusDB never serves a query through a view from the
[query result cache](/docs/query-result-cache). Each entry of the cache fences
the key space of the rows of one physical table. A view expands to a derived
table, and such a table has no key space of its own. The same limit makes a join
uncacheable.

CamusDB accepts a `{cache=name}` hint on a reference to a view. It does not
reject that hint. The response reports the hint as a bypass, with the reason
`DerivedSource`. The hint is therefore visible, and not silent. The rows still
come from live storage at every read.

A materialized view is not affected. It is a physical relation. The cache treats
it exactly as it treats a table.

## Introspection

```camussql
SHOW VIEWS;
SHOW VIEWS LIKE 'open%';
SHOW CREATE VIEW open_orders;
SHOW COLUMNS FROM open_orders;
```

`SHOW TABLES` lists a table only. It does not list a view. The `\dt` command of
PostgreSQL behaves the same way. A change to the output of `SHOW TABLES` would
break an existing client.

`SHOW CREATE VIEW` prints the normalized definition. It does not print the text
that you typed:

```camussql
CREATE VIEW v AS SELECT id,total FROM orders WHERE a OR b AND c;

SHOW CREATE VIEW v;
-- CREATE VIEW `v` AS SELECT id, total FROM orders WHERE a OR (b AND c)
```

CamusDB stores a view as a definition that it rendered again. Two reasons drive
that choice. A reference then resolves by an id. A `CREATE OR REPLACE` also has
a canonical form for the comparison.

The `pg_get_viewdef` function of PostgreSQL also never returns the original
text. The printed DDL is guaranteed to parse again into the same query. You can
therefore send it straight back to the server.

## Rename a view

```camussql
ALTER VIEW open_orders RENAME TO active_orders;
```

The change touches the metadata only. The id of the view does not change. Every
dependent therefore continues to resolve.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `max_view_expansion_depth` | `32` | A backstop on the depth of a view inside a view. |

See [Configuration](/docs/configuration) and
[`SHOW VARIABLES`](/docs/show-variables).

## Differences from PostgreSQL

| Area | CamusDB | Why |
| --- | --- | --- |
| A column of an expression without a name | Refused | PostgreSQL names such a column `?column?`, and nothing can reference that name. One `AS` produces a usable view. |
| An updatable view | Not implemented | Every view is read-only today. |
| A rule, and an `INSTEAD OF` trigger | Not supported | CamusDB has neither. There is therefore no path to a writable view that CamusDB cannot update on its own. |
| `DROP TABLE ... CASCADE` | There is no `CASCADE` form | Drop the dependent views explicitly. |
| A `security_invoker` view | Not supported | CamusDB implements the model of the rights of the owner only. |
| A `WITH RECURSIVE` view | Not supported | CamusDB has no `WITH RECURSIVE`. |
| A view across two databases | Not supported | The rule matches the existing restriction of `INSERT ... SELECT` to one database. |
| A temporary view | Not supported | CamusDB has no temporary relation. |
| A mix of a `*` with another projection | Refused | The order of the expansion is not stable when somebody adds a base column. |
| An `AS OF SYSTEM TIME` in a body | Refused | CamusDB can store neither an absolute timestamp nor a relative one in a coherent way. |

## Not implemented yet

These three forms parse, and CamusDB rejects them at the execution. They
therefore fail loudly. They do nothing unexpected:

- An updatable view. That set covers an `INSERT`, an `UPDATE`, and a `DELETE`
  through a view. It also covers the rules of automatic updatability, and the
  enforcement of a `WITH CHECK OPTION`. The clause `WITH [LOCAL|CASCADED] CHECK
  OPTION` parses, and CamusDB stores it. Nothing enforces it yet. Every view is
  read-only.
- A second check of the grant of a nested view at the read. A body can read
  another view. CamusDB checks that inner reference at the creation, not at
  every read. A grant that you revoke later does not break the outer view until
  you replace it. The inner view still runs as its own owner. This behavior
  therefore widens nothing past the reach of its author.
- The absorption of a rename of a column, in two cases. The first case is a
  definition from before the time when CamusDB bound a column by its id. The
  second case is a reference in an `ORDER BY`, a `GROUP BY`, or a `HAVING`
  clause that matches an output name of the view. CamusDB refuses both. See
  [Drop a column](#drop-a-column).

## Related pages

- [Materialized Views](/docs/materialized-views) for a stored result.
- [Inspecting The Database](/docs/sql-inspection) for the family of `SHOW`
  statements.
- [Authentication And Authorization](/docs/sql-authentication) for the grants.
- [Error Codes](/docs/error-codes) for the `CADB05xx` codes above.
