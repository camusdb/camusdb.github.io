---
sidebar_position: 2.3
---

# Insert, Update, Delete

Every write runs inside a transaction. If you do not open one, CamusDB opens and
commits a single-statement transaction around it. For multi-statement work, see
[Transactions In SQL](/docs/sql-transactions).

## INSERT

One row or many, in a single statement:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), "C-3PO", 1977),
  (GEN_ID(), "T-800", 1984);
```

A multi-row `INSERT` is atomic: either every row lands or none does.

### Defaults

Write `DEFAULT` in the value list, or leave the column out of the column list
entirely. Both apply the column's default:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "K-2SO", DEFAULT);
```

When the default is a generator such as `DEFAULT (gen_id())`,
`DEFAULT (gen_uuid_v4())`, or `DEFAULT (gen_uuid_v7())`, the function is
evaluated once per inserted row, so each row gets its own value. See
[Tables And Columns](/docs/sql-schema#column-defaults).

Object ids can also be produced inline:

```camussql
INSERT INTO robots (id, name) VALUES (GEN_ID(), "R2-D2");
INSERT INTO robots (id, name) VALUES (STR_ID("507f1f77bcf86cd799439011"), "C-3PO");
```

`GEN_ID()` mints a new object id; `STR_ID()` parses an existing one from its
hex string. See [Object Id Functions](/docs/functions-object-id).

### INSERT ... SELECT

Copy query results into an existing table:

```camussql
INSERT INTO archived_robots (id, name, year)
SELECT id, name, year
FROM robots
WHERE year < 2000;
```

The source is an ordinary `SELECT`: joins, subqueries, grouping, parameters, and
time-travel sources all work. Columns are matched by position, not by name, so
the projection order must line up with the target column list.

Like any insert, it is all-or-nothing, and it enforces the same defaults,
constraints, indexes, and transaction limits as `INSERT ... VALUES`. To create
the target table from the query instead, see
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

## WHERE Is Mandatory

`UPDATE` and `DELETE` both require a `WHERE` clause. A bare
`UPDATE robots SET ...` or `DELETE FROM robots` is rejected, which rules out the
most expensive category of typo.

To affect every row, state a predicate that matches all of them. Note that a
write touching a whole table is still one transaction and is bound by
[transaction limits](/docs/transaction-limits); for bulk expiry, a
[TTL policy](/docs/row-level-ttl) deletes in batches instead.
