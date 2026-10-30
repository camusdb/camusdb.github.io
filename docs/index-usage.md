---
sidebar_position: 3.74
---

# Index usage

`SHOW INDEX USAGE` helps you assess whether an index earns its write cost.
It reports query reads, constraint checks, and writes for each readable index,
similar to PostgreSQL's index usage statistics.

```camussql
SHOW INDEX USAGE;
SHOW INDEX USAGE FROM orders;
```

The first form covers the current database; the second covers one table.
Collection is on by default. The statement requires a superuser.

## Read the counters

| Column | Meaning |
| --- | --- |
| `node`, `database`, `table`, `index` | Object identity; `~pk` names the primary key. |
| `unique` | Whether the index is unique, including the primary key. |
| `reads` | Query access paths opened through the index. An `IN` seek set or batched join probe counts as one read, rather than one per key. |
| `constraint_reads` | Index reads used for unique-key or foreign-key checks. |
| `entries_read` | Entries returned by query and constraint reads. |
| `last_read_at` | Latest query or constraint read time in UTC, or null when none was observed. |
| `writes` | Entries inserted or removed by DML. A changed index key counts twice: old entry removed, new entry inserted. An unchanged key counts zero. |
| `tracked_since` | UTC timestamp from which this node has tracked the index. |

Every readable index appears, even with zero counters. Indexes still being
backfilled are omitted because they cannot yet serve reads. Inspection reads
the catalog without loading every table into memory.

Full table scans do not read through an index and increment no index's
`reads`. Plain `EXPLAIN` does not count accesses; `EXPLAIN (ANALYZE)` executes
the query and does. Writes count when their batch is accepted, even if the
transaction later rolls back.

## Evaluate an unused index

An index with zero `reads`, zero `constraint_reads`, and nonzero `writes` over
a representative window is a candidate for review. Check every node and include
infrequent jobs or reports before removing it. A primary key or unique index
still enforces a constraint even when queries do not read it.

Compare two readings to measure workload over an interval. An index that
existed when the node first opened its table is tracked from node startup;
a new index on an already tracked table starts when the node first observes
it. Check `tracked_since` before treating a zero as evidence of non-use.

Use [statement statistics](/docs/statement-stats) to find the statements behind
the workload and [SHOW STATISTICS](/docs/show-statistics) for index sizes and
optimizer statistics.

## Configuration and limits

```yaml
index_usage_enabled: true
```

`index_usage_enabled` is runtime-mutable and node-scoped. Turning it off stops
new counts and preserves existing counters. Periods with collection disabled
leave gaps in the observation window.

Counters are node-local, live in memory, and reset at restart. An index used on
another node can look unused here. Save readings outside CamusDB for history.
