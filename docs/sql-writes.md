---
sidebar_position: 2.3
---

# Insert, update, delete

Every write runs inside a transaction. CamusDB opens a transaction around your
statement if you do not open one. It then commits that transaction. For work of
several statements, see [Transactions In SQL](/docs/sql-transactions).

## INSERT

One statement inserts one row, or many rows:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), "C-3PO", 1977),
  (GEN_ID(), "T-800", 1984);
```

An `INSERT` of several rows is atomic. Every row arrives, or no row arrives.

### Defaults

You can write `DEFAULT` in the list of the values. You can also omit the column
from the list of the columns. Both forms apply the default of that column:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "K-2SO", DEFAULT);
```

A default can be a generator, such as `DEFAULT (gen_id())`,
`DEFAULT (gen_uuid_v4())`, or `DEFAULT (gen_uuid_v7())`. CamusDB then evaluates
the function one time for each inserted row. Each row therefore receives its own
value. See [Tables And Columns](/docs/sql-schema#column-defaults).

You can also produce an object id inline:

```camussql
INSERT INTO robots (id, name) VALUES (GEN_ID(), "R2-D2");
INSERT INTO robots (id, name) VALUES (STR_ID("507f1f77bcf86cd799439011"), "C-3PO");
```

`GEN_ID()` creates a new object id. `STR_ID()` parses an existing object id from
its hexadecimal string. See
[Object Id Functions](/docs/functions-object-id).

### INSERT ... SELECT

Copy the result of a query into an existing table:

```camussql
INSERT INTO archived_robots (id, name, year)
SELECT id, name, year
FROM robots
WHERE year < 2000;
```

The source is an ordinary `SELECT`. A join, a subquery, a group, a parameter,
and a time-travel source all work.

CamusDB matches the columns by position. It does not match them by name. The
order of the projection must therefore agree with the list of the target
columns.

The statement is all-or-nothing, like any insert. It enforces the same defaults,
the same constraints, the same indexes, and the same transaction limits as an
`INSERT ... VALUES`.

To create the target table from the query instead, see
[Copying Query Results](/docs/insert-select-and-ctas).

## UPDATE

```camussql
UPDATE robots
SET year = 1982
WHERE name = "T-800";
```

## DELETE

```camussql
DELETE FROM robots
WHERE year < 1970;
```

## A WHERE clause is mandatory

`UPDATE` and `DELETE` both need a `WHERE` clause. CamusDB rejects a bare
`UPDATE robots SET ...`, and it rejects a bare `DELETE FROM robots`. That rule
excludes the most expensive kind of mistake.

To affect every row, write a predicate that matches every row.

A write over a whole table is still one transaction. The
[transaction limits](/docs/transaction-limits) therefore bound it. For a bulk
expiry, use a [TTL policy](/docs/row-level-ttl) instead. That policy deletes in
batches.

To empty a whole table, use [`TRUNCATE`](/docs/truncate-table). That statement
replaces the key space of the table. It reads no row, and it therefore has no
limit on the mutations to exceed.
