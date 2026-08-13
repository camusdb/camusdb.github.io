---
sidebar_position: 3.6
---

# Automatic Analyze

CamusDB can refresh optimizer statistics in the background when table data has
changed enough for existing statistics to become stale.

The cost-based optimizer uses statistics such as row counts, histograms, and
distinct-value counts to estimate how many rows a filter or join will return.
Manual `ANALYZE TABLE` is still available when you want to force a refresh, but
automatic analyze lets the engine keep those statistics fresh between manual
maintenance runs.

```camussql
ANALYZE TABLE orders;

EXPLAIN
SELECT *
FROM orders
WHERE status = "paid"
ORDER BY created_at DESC
LIMIT 20;
```

## Current Status

Automatic analyze is on by default. Manual `ANALYZE TABLE <name>` remains
available when you want to force fresh statistics after loading or materially
changing data. Set `auto_analyze_enabled` to `false` for manual-only
statistics maintenance.

```yaml
auto_analyze_enabled: true
```

## When A Table Becomes Stale

CamusDB tracks how many row mutations have committed since a table was last
analyzed. Inserts, updates, and deletes all count as churn.

A table is considered stale when:

```text
mutations_since_analyze >= fraction_stale_rows * row_count + min_stale_rows
```

With the current engine defaults, that means:

- `fraction_stale_rows = 0.20`
- `min_stale_rows = 500`

For example, a table with 10,000 rows becomes stale after roughly
`0.20 * 10000 + 500`, or 2,500 committed row mutations since the last analyze.

A table with tracked data that has never been analyzed is eligible immediately.
An empty table with no mutations is not analyzed.

Manual `ANALYZE TABLE` is valid for empty tables. It records an empty
statistics snapshot instead of failing, so a deployment can analyze freshly
created tables as part of setup or migration scripts before data is loaded.

## What It Refreshes

Automatic analyze refreshes the same optimizer-facing statistics used by manual
`ANALYZE`:

- table row counts
- per-index entry counts
- per-column min/max values
- equi-depth histograms
- distinct-value counts for columns
- distinct-value counts for composite index prefixes

These statistics are advisory. Missing or stale statistics do not change query
correctness; they only affect how accurately CamusDB can estimate costs.

## How It Avoids Interference

Automatic analyze is designed as background maintenance:

- It runs with a read-only snapshot, so it does not take write locks.
- It does not block foreground reads or writes.
- It backs off when foreground request load is high.
- It limits concurrent background analyses.
- It throttles scan speed so a refresh does not monopolize CPU or storage IO.
- It uses bounded sampling for histograms and distinct-value estimates, so peak
  memory does not grow with table size.

If a scan is interrupted by shutdown, load backoff, or leadership changes, the
table remains stale and can be retried later.

If a background analyze sees an empty table, it publishes empty statistics and
completes normally. That keeps optimizer metadata consistent even when a table
temporarily has no rows.

## Per-Table Control

Automatic analyze can be disabled for a specific table while leaving the global
scheduler enabled:

```camussql
ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = false);
```

Enable it again with:

```camussql
ALTER TABLE application_logs
SET (sql_stats_automatic_collection_enabled = true);
```

This setting affects only the background scheduler. A manual
`ANALYZE TABLE application_logs` still runs. The setting is stored with the
table schema, survives restarts, and is preserved if a dropped table is
relinked while it is still recoverable.

## Cluster Behavior

In cluster mode, only the node that owns the database-registry leadership runs
the automatic analyze sweep. That prevents every node from analyzing the same
table independently.

Before publishing refreshed statistics, CamusDB uses a per-table publish fence
and confirms ownership again. This prevents two nodes from publishing competing
statistics for the same table during leadership changes.

Publication is atomic. The planner never sees a partial mix of old and new
statistics.

## Configuration

Automatic analyze and statistics settings are configured in `config.yml`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `stats_analyze_sample_rows` | `100000` | Manual `ANALYZE` full-scans tables up to this row count and samples the first N rows above it. `0` means always full scan. |
| `stats_histogram_buckets` | `100` | Equi-depth histogram buckets built per column. |
| `auto_analyze_enabled` | `true` | Master switch for the background scheduler. |
| `auto_analyze_check_interval_ms` | `60000` | Staleness sweep interval. Values `<= 0` disable the loop. |
| `auto_analyze_fraction_stale_rows` | `0.20` | Proportional staleness threshold. |
| `auto_analyze_min_stale_rows` | `500` | Minimum mutation count before a table is stale. |
| `auto_analyze_max_concurrent` | `1` | Maximum background analyses running at once on a node. |
| `auto_analyze_max_rows_per_second` | `50000` | Scan-rate throttle. Values `<= 0` disable throttling. |
| `auto_analyze_histogram_sample_rows` | `10000` | Reservoir sample size per column for background histograms. |
| `auto_analyze_hll_precision` | `11` | HyperLogLog precision for approximate distinct-value counts. |
| `auto_analyze_load_pause_threshold` | `16` | Foreground in-flight work above which the scheduler backs off. Values `<= 0` disable load-based backoff. |
| `auto_analyze_ownership_check_rows` | `1000` | Rows scanned between ownership and load re-checks. |

Manual `ANALYZE TABLE` is exact for distinct-value counting. The background path
uses bounded sketches for predictable resource usage.

## How It Helps Query Plans

Fresh statistics help CamusDB make better choices for:

- range scan versus full table scan
- which index to use when multiple indexes match
- indexed nested-loop join versus hash join or merge join
- join order when cost-based join-order enumeration is enabled
- estimated row and cost values shown by `EXPLAIN`

See [Query Planning](/docs/query-planning) and
[EXPLAIN](/docs/explain) for how these estimates affect
plans.
