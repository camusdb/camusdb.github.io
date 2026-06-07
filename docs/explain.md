---
sidebar_position: 3.2
---

# EXPLAIN

`EXPLAIN` shows how CamusDB plans a query. It is the main user-facing tool for
understanding whether a query uses a table scan, index lookup, index range
scan, join plan, sort, aggregation stage, or limit stage.

Use it when you want to answer questions like:

- Did CamusDB use my index?
- Is this query scanning the full table?
- Did `ORDER BY` require an explicit sort?
- Is a join using indexed lookups or a broader nested loop?
- How many KV lookups or scan entries did `EXPLAIN (ANALYZE)` observe?

## Syntax

```sql
EXPLAIN SELECT ...
EXPLAIN (PHYSICAL) SELECT ...
EXPLAIN (LOGICAL) SELECT ...
EXPLAIN (ANALYZE) SELECT ...
```

Behavior:

- Plain `EXPLAIN` and `EXPLAIN (PHYSICAL)` build the plan and return plan rows.
- `EXPLAIN (LOGICAL)` currently returns the same physical tree with a different
  stage label.
- `EXPLAIN (ANALYZE)` executes the query, drains the result, and adds runtime
  counters.
- Unrecognized options such as `EXPLAIN (VERBOSE)` are rejected.

## Important Limits

- `EXPLAIN` output is diagnostic. It is useful for people, not a stable format
  for application logic.
- `EXPLAIN (ANALYZE)` is not supported for `JOIN` queries yet.
- Queries with uncorrelated subqueries can still read storage during planning,
  because CamusDB may evaluate the inner subquery before producing the final
  plan output.

## Result Columns

### Plain EXPLAIN

| Column | Type | Meaning |
| --- | --- | --- |
| `stage` | `STRING` | `physical` for plain/physical explain, `logical` for logical explain. |
| `node` | `STRING` | Canonical plan node name. |
| `detail` | `STRING` | Node-specific summary such as index name or bounds. |
| `estimated_rows` | `INT64` or `NULL` | Estimated output rows when available. |
| `estimated_cost` | `FLOAT64` or `NULL` | Estimated planner cost when available. |

These estimates come from CamusDB's lightweight planner statistics when they
exist. Different deployments can produce different numbers depending on current
row counts and observed indexed-column bounds.

### EXPLAIN ANALYZE

All plain `EXPLAIN` columns, plus:

| Column | Type | Meaning |
| --- | --- | --- |
| `actual_rows` | `INT64` or `NULL` | Rows emitted by that operator. |
| `rows_read` | `INT64` or `NULL` | Rows decoded from storage before filtering. |
| `actual_time_ms` | `FLOAT64` or `NULL` | Total wall-clock time for the root node only. |
| `kv_lookups` | `INT64` or `NULL` | KV point lookups issued. |
| `kv_scan_entries` | `INT64` or `NULL` | KV entries visited during scans. |

## Canonical Node Names

These are the main node names you will see:

| Node | Meaning |
| --- | --- |
| `table-scan` | Full table scan or forced index scan. |
| `index-lookup` | Point lookup on a unique index. |
| `index-range-scan` | Range scan on an index, including non-unique equality. |
| `filter` | Residual predicate not absorbed by the scan bounds. |
| `aggregate` | Grouped or global aggregation. |
| `having-filter` | `HAVING` filter after aggregation. |
| `sort` | Explicit in-memory sort. |
| `limit` | `LIMIT` / `OFFSET` stage. |
| `project` | Projection and alias shaping. |
| `distinct` | Duplicate elimination. |
| `semi-join` | Indexed `IN (SELECT ...)` rewrite. |
| `anti-join` | Indexed `NOT IN (SELECT ...)` rewrite over a non-null inner key. |
| `null-aware-anti-join` | `NOT IN` rewrite that preserves SQL null semantics. |
| `nested-loop-join` | Join without a usable right-side index. |
| `index-nested-loop-join` | Join that probes the right side through an index. |
| `derived-table-scan` | Scan of a derived table from `FROM (SELECT ...) alias`. |

## Reading Common Plans

### Full table scan

```sql
EXPLAIN SELECT * FROM robots;
```

Typical output shape:

```text
physical  table-scan  table=robots
```

This means CamusDB did not find a better indexed access path for the query.

### Unique primary-key lookup

```sql
EXPLAIN
SELECT *
FROM robots
WHERE id = "507f1f77bcf86cd799439011";
```

Typical output shape:

```text
physical  index-lookup  index=~pk, key="507f1f77bcf86cd799439011"
```

This is the best-case point lookup plan.

### Non-unique equality becomes a range scan

```sql
EXPLAIN
SELECT *
FROM robots
WHERE year = 2024;
```

Typical output shape:

```text
physical  index-range-scan  index=year_idx, from>=2024, to<2025
```

For non-unique indexes, equality is still a range of matching keys.

### Range scan plus residual filter

```sql
EXPLAIN
SELECT *
FROM robots
WHERE year >= 2020 AND name = "R2";
```

Typical output shape:

```text
physical  filter            name = "R2"
physical  index-range-scan  index=year_idx, from>=2020
```

The index narrows the scan on `year`, and `name = "R2"` remains a residual
filter.

### Aggregate plan

```sql
EXPLAIN
SELECT year, COUNT(*)
FROM robots
GROUP BY year;
```

Typical output shape:

```text
physical  aggregate  group=[year], aggs=[count(*)]
physical  table-scan table=robots
```

### Sort elision

```sql
EXPLAIN
SELECT *
FROM robots
ORDER BY year;
```

Typical output shape:

```text
physical  index-range-scan  index=year_idx
```

No `sort` node appears when the scan order already satisfies `ORDER BY`.

### LIMIT pushdown shape

```sql
EXPLAIN
SELECT *
FROM robots
LIMIT 10;
```

Typical output shape:

```text
physical  limit      10
physical  table-scan table=robots
```

CamusDB may also stop the scan early when the query shape allows safe pushdown.

### DISTINCT: streaming vs hash

```sql
EXPLAIN
SELECT DISTINCT code
FROM teams
ORDER BY code;
```

Typical output shape:

```text
physical  distinct          streaming: true
physical  index-range-scan  index=code_idx
```

When the distinct columns are covered by a compatible `NOT NULL` index, CamusDB
can deduplicate adjacent rows as they stream from the scan. Otherwise the
`distinct` detail reports `hash`.

### IN subquery rewritten to a semi-join

```sql
EXPLAIN
SELECT *
FROM robots
WHERE owner_id IN (SELECT id FROM owners);
```

Typical output shape:

```text
physical  semi-join   outer=owner_id, inner=owners.id, index=~pk
physical  table-scan  table=robots
```

`NOT IN` can similarly appear as `anti-join` or `null-aware-anti-join`.

## EXPLAIN ANALYZE

`EXPLAIN (ANALYZE)` runs the query and adds actual counters.

Example:

```sql
EXPLAIN (ANALYZE)
SELECT *
FROM robots
WHERE year = 2022
LIMIT 5;
```

Typical shape:

```text
analyze  limit             limit(5)                               ... actual_rows=3 actual_time_ms=14.2
analyze  index-range-scan  index=year_idx, from>=2022, to<2023   ... actual_rows=3 rows_read=3 kv_scan_entries=3
```

Interpretation:

- `actual_rows` tells you how many rows flowed out of that operator.
- `rows_read` tells you how many rows were decoded from storage.
- `kv_lookups` and `kv_scan_entries` show storage access shape.
- `actual_time_ms` is currently populated on the root node only.

For scan nodes, `actual_rows` can be less than `rows_read` when rows are read
and then filtered out.

## Using EXPLAIN Effectively

Use `EXPLAIN` when you are designing indexes or investigating slow queries.

Good questions to ask:

- Did CamusDB choose `index-lookup` instead of `table-scan`?
- Did a non-unique equality use `index-range-scan`?
- Is an unexpected `sort` node present?
- Did a join use `index-nested-loop-join`?
- Are `rows_read` and `kv_scan_entries` much larger than expected?

If the plan is not what you want, the usual fixes are:

- Add or adjust an index.
- Reorder composite index columns to match query predicates.
- Add a join-key index on the right-hand table.
- Simplify the query shape.
- Use `@{FORCE_INDEX=...}` temporarily to confirm whether a specific index helps.

## Related Pages

Read [Query Planning](/docs/query-planning) for user-facing planner behavior,
[Query Features](/docs/query-features) for the SQL surface, and
[Query Planner Internals](/docs/query-planner-internals) for the internal
pipeline and implementation model.
