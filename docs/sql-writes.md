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

### RETURNING {#returning}

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
row for each row the statement wrote. The affected-row count is the same as the
number of returned rows.

<span id="insert-returning"></span>

#### What RETURNING can contain

The `RETURNING` list is a select list over the target table. It can contain:

- `*`, which expands to every column of the target table in schema order.
- A column name, including a qualified name such as `orders.total`.
- A scalar expression, such as arithmetic, `CASE`, a cast, or a scalar
  function.
- An alias with `AS`.
- A bound parameter.

CamusDB rejects a `RETURNING` item before it writes any row when that item
cannot be evaluated once per written row:

| Item | Error |
| --- | --- |
| An aggregate such as `COUNT(*)` or `SUM(x)` | `CADB0400` `InvalidInput` |
| A subquery | `CADB0400` `InvalidInput` |
| A sequence call such as `nextval`, `setval`, `currval`, or `lastval` | `CADB0547` `SequenceCallNotAllowedHere` |
| A name that is not a column of the target table | `CADB0404` `UnknownColumn` |

#### What values come back

`RETURNING` reports the stored row image, not just the text that appeared in the
statement:

| Statement | Row image |
| --- | --- |
| `INSERT` | The inserted row. |
| `UPDATE` | The new row, after the `SET` clause. |
| `DELETE` | The deleted row. |

- A column omitted from an `INSERT` has its default value.
- A column not changed by an `UPDATE` keeps its stored value.
- A function default, such as `gen_id()`, `gen_uuid_v7()`, or `now()`, is
  evaluated for each inserted row.
- A value is returned after coercion to the column type.
- A column with no value and no default returns `NULL`.
- A large value stored out of line returns in full.

Rows come back in insert order. For `INSERT ... SELECT`, they come back in the
order produced by the source query. The rows of an `UPDATE` or a `DELETE` come
back in the order CamusDB changes them. Do not depend on that order.

#### Transactions and retries

An autocommit write with `RETURNING` sent through a query endpoint still runs in
a writable transaction. CamusDB commits the write before it sends the schema or
any row. That means a client does not receive rows from an attempt that failed to
commit, and a Serializable conflict can retry from a new transaction before rows
are exposed.

Inside an explicit transaction, the rows come back before the final `COMMIT`,
as with any other statement. If the transaction rolls back, the writes are
removed.

#### Privileges

A write with `RETURNING` needs the matching write privilege on the target table
and `SELECT` on that same target table. The `RETURNING` list reads stored row
values, including defaults. For example, a user with `UPDATE` only can run a
plain `UPDATE`, but not an `UPDATE ... RETURNING`.

For `INSERT ... SELECT ... RETURNING`, the source tables also need `SELECT`, as
they do for a regular `INSERT ... SELECT`.

#### Size limits

The returned rows stay in server memory until the statement completes. The
number of written rows is still bounded by `max_mutations_per_transaction`.

A gRPC `ExecuteNonQuery` reply, and a gRPC `NON_QUERY` batch reply, carry all
returned rows in one message. A default gRPC client receives at most 4 MiB in
one message. If the `RETURNING` payload would exceed that limit, CamusDB fails
the statement with `CADB0550` `ReturningResultTooLarge` before commit. The
statement is rolled back.

Use one of these options for a large returned row set:

- Send the statement to `ExecuteQuery`, which streams the rows.
- Set the count-only flag.

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

## Concurrent updates and deletes

One `UPDATE` or `DELETE` statement protects itself from a concurrent commit to
the same row. CamusDB finds candidate rows, takes the exclusive row locks, reads
those rows again, evaluates the `WHERE` clause again, and then computes the
write from that locked read.

For example, `UPDATE accounts SET balance = balance + 1 WHERE id = ...` adds to
the latest committed balance for that row. If another transaction changed the
row so it no longer matches the predicate, CamusDB skips it. If another
transaction deleted the row, CamusDB skips it.

That protection is for one statement. A read in one statement followed by a
write in a later statement is still a read-then-write pattern; use Serializable
for that invariant, or express the change as one `UPDATE`.

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
