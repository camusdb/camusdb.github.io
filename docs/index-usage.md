---
sidebar_position: 3.74
---

# Index usage

Each index adds work to each write. `SHOW INDEX USAGE` shows whether an index
is worth that cost. It counts the reads and the writes of each index, like the
index statistics of PostgreSQL.

The examples on this page use this data:

<details>
<summary>Sample data for the examples on this page</summary>

```camussql
CREATE TABLE orders (
  id INT64 PRIMARY KEY NOT NULL,
  customer_id INT64 NOT NULL,
  status STRING NOT NULL,
  total FLOAT64 NOT NULL
);
CREATE INDEX orders_customer_idx ON orders (customer_id);
INSERT INTO orders (id, customer_id, status, total) VALUES
  (1, 7, 'shipped', 42.50),
  (2, 7, 'pending', 18.00),
  (3, 9, 'shipped', 99.90),
  (4, 12, 'pending', 7.25),
  (5, 9, 'cancelled', 15.00),
  (6, 14, 'shipped', 64.10);
```

</details>

```camussql
SHOW INDEX USAGE;
SHOW INDEX USAGE FROM orders;
```

The first form shows the indexes of the current database. The second form
shows the indexes of one table. Collection is on by default. The statement
needs a superuser, and a `MONITOR` grant isn't enough.

## Read the counters

Execute one lookup by customer, then read the counters of the table:

```camussql
SELECT id, status, total FROM orders WHERE customer_id = 7;
```

```camussql
SHOW INDEX USAGE FROM orders;
```

```text
┌─────────────┬──────────────┬────────┬─────────────────────┬────────┬───────┬──────────────────┬──────────────┬──────────────────────────┬────────┬──────────────────────────┐
│ node        │ database     │ table  │ index               │ unique │ reads │ constraint_reads │ entries_read │ last_read_at             │ writes │ tracked_since            │
├─────────────┼──────────────┼────────┼─────────────────────┼────────┼───────┼──────────────────┼──────────────┼──────────────────────────┼────────┼──────────────────────────┤
│ localhost:0 │ docs_inspect │ orders │ ~pk                 │ True   │ 0     │ 6                │ 6            │ 2026-11-18T21:50:44.458Z │ 6      │ 2026-11-18T21:17:59.716Z │
│ localhost:0 │ docs_inspect │ orders │ orders_customer_idx │ False  │ 1     │ 0                │ 2            │ 2026-11-18T21:50:50.646Z │ 6      │ 2026-11-18T21:50:44.440Z │
└─────────────┴──────────────┴────────┴─────────────────────┴────────┴───────┴──────────────────┴──────────────┴──────────────────────────┴────────┴──────────────────────────┘
2 rows in set (00:00:00.0010887)
```

The lookup is one read of `orders_customer_idx`, and it returned two entries.
The six `constraint_reads` of `~pk` are the primary key checks of the six
inserts.

| Column | Meaning |
| --- | --- |
| `node`, `database`, `table`, `index` | The index. `~pk` is the primary key. |
| `unique` | Whether the index is unique. The primary key is unique. |
| `reads` | Query reads through the index. An `IN` list or a batched join probe counts as one read. |
| `constraint_reads` | Index reads for unique-key and foreign-key checks. |
| `entries_read` | The entries that query reads and constraint reads returned. |
| `last_read_at` | The UTC time of the last read, or `NULL` if there wasn't one. |
| `writes` | The entries that DML inserted or removed. A changed index key counts twice: the old entry is removed, and the new entry is inserted. An unchanged key counts zero. |
| `tracked_since` | The UTC time from which this node tracks the index. |

All the readable indexes appear, also with zero counters. An index in backfill
isn't shown. It can't serve reads yet.

A full table scan doesn't read an index, and it doesn't add to `reads`.
`EXPLAIN` doesn't count reads. `EXPLAIN (ANALYZE)` executes the query, and its
reads count. Writes count when their batch is written, also if the transaction
rolls back later.

## Evaluate an unused index

An index with zero `reads`, zero `constraint_reads`, and some `writes` over a
representative period is a candidate for review. Before you drop it, check all
the nodes. Include jobs and reports that execute rarely. A primary key or a
unique index enforces a constraint, also when queries don't read it.

To measure an interval, compare two readings. An index that existed when the
node first opened its table is tracked from the start of the node. A new index
on a table that is already tracked is tracked from when the node first sees it.
Check `tracked_since` before you decide that a zero means that an index isn't
used.

For the statements behind the workload, see
[statement statistics](/docs/statement-stats). For index sizes and optimizer
statistics, see [SHOW STATISTICS](/docs/show-statistics).

## Configuration and limits

```yaml
index_usage_enabled: true
```

`index_usage_enabled` is a runtime node setting. When you turn it off, new reads
and writes aren't counted, and the existing counters are kept. A period with
collection off is a gap in the observation window.

The counters are in memory on each node, and they are reset when the node
restarts. An index that another node uses can look unused on this node. To keep
history, save the readings outside CamusDB.
