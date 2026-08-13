---
sidebar_position: 3.68
---

# Row-Level TTL

Row-level TTL deletes expired rows in the background. A table names one column
that stores the expiry instant, and CamusDB periodically sweeps rows whose
expiry has passed.

TTL is for reclamation. It is not a read-time visibility rule: an expired row
remains readable until the sweep deletes it.

## Enable TTL

The node-level sweep loop is enabled by default:

```yaml
ttl_enabled: true
```

A table is swept only after it names the expiration column:

```camussql
ALTER TABLE sessions
SET (ttl_expiration_expression = 'expires_at');
```

The expiration column must be one of:

- `DATETIME`
- `DATE`
- `INT64`, interpreted as Unix epoch milliseconds

The expiration column cannot be part of the primary key. The setting accepts a
bare column name, not a SQL expression.

Set `ttl_enabled: false` only when you want to stop the sweep loop node-wide.
Tables can still store TTL settings while the node switch is off, but expired
rows are not collected.

## Example

```camussql
CREATE TABLE sessions (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  user_id UUID NOT NULL,
  token STRING NOT NULL,
  expires_at DATETIME
);

ALTER TABLE sessions
SET (
  ttl_expiration_expression = 'expires_at',
  ttl_job_cron = '@hourly',
  ttl_delete_rate_limit = 200
);
```

Rows with `expires_at` in the past become eligible for deletion. Rows with
`expires_at IS NULL` never expire, which gives applications an explicit
"keep forever" value.

If an application needs exact visibility rules, filter explicitly:

```camussql
SELECT *
FROM sessions
WHERE expires_at IS NULL OR expires_at > NOW();
```

## Table Parameters

Set table TTL parameters with `ALTER TABLE ... SET (...)`:

```camussql
ALTER TABLE sessions
SET (
  ttl_expiration_expression = 'expires_at',
  ttl_job_cron = '@daily',
  ttl_select_batch_size = 500,
  ttl_delete_batch_size = 100,
  ttl_select_rate_limit = 0,
  ttl_delete_rate_limit = 100,
  ttl_grace_ms = 0
);
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `ttl_expiration_expression` | none | Column holding the expiry instant. This enables TTL for the table. |
| `ttl_pause` | `false` | Pauses sweeping while keeping the TTL configuration. |
| `ttl_job_cron` | `@daily` | Sweep cadence for this table. |
| `ttl_select_batch_size` | `500` | Rows read per scan batch. Must be at least `1`. |
| `ttl_delete_batch_size` | `100` | Rows deleted per transaction. Must be at least `1`. |
| `ttl_select_rate_limit` | `0` | Scan cap in rows per second. `0` means unlimited. |
| `ttl_delete_rate_limit` | `100` | Delete cap in rows per second. `0` means unlimited. |
| `ttl_grace_ms` | `0` | Extra delay after expiry before a row is eligible. |

`ttl_job_cron` accepts these macro values:

- `@hourly`
- `@daily`
- `@midnight`, equivalent to `@daily`
- `@weekly`
- `@monthly`

These values define a cadence, not a wall-clock schedule. For example,
`@daily` means about once per day, not necessarily midnight.

## Pause Or Disable TTL

Pause a table without discarding its configuration:

```camussql
ALTER TABLE sessions
SET (ttl_pause = true);
```

Resume sweeping:

```camussql
ALTER TABLE sessions
SET (ttl_pause = false);
```

Remove the full TTL configuration:

```camussql
ALTER TABLE sessions
RESET (ttl);
```

`RESET (ttl)` clears every TTL parameter on the table. You can also reset one
parameter at a time:

```camussql
ALTER TABLE sessions
RESET (ttl_job_cron);
```

Resetting an unset parameter is a no-op.

## Inspect TTL Settings

`SHOW CREATE TABLE` renders table TTL settings:

```camussql
SHOW CREATE TABLE sessions;
```

Example output includes a trailing `SET (...)` clause:

```camussql
CREATE TABLE `sessions` (
  `id` OID NOT NULL DEFAULT(gen_id()),
  `user_id` UUID NOT NULL,
  `token` STRING NOT NULL,
  `expires_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) SET (ttl_expiration_expression = 'expires_at', ttl_job_cron = '@hourly');
```

## Column Changes

CamusDB validates TTL settings when you apply them:

- unknown TTL columns are rejected
- unsupported column types are rejected
- primary-key TTL columns are rejected
- unsupported table-setting names are rejected
- unsupported cron expressions are rejected

Renaming the TTL column updates `ttl_expiration_expression` to the new column
name. Dropping the TTL column is rejected until TTL is reset:

```camussql
ALTER TABLE sessions
RESET (ttl);

ALTER TABLE sessions
DROP COLUMN expires_at;
```

## Sweep Behavior

TTL sweeps delete rows through the normal SQL delete path. That means row data
and secondary-index entries are removed in the same transaction, preserving
index consistency.

Before deleting a row, CamusDB re-checks the expiration value under lock. If an
application extended the row's expiry between the scan and the delete, the row
survives. This is important for session tables where renewals can race with the
sweep.

Delete batches are intentionally small. A deleted row consumes one mutation for
the row plus one mutation per affected index entry, so large batches can hit
the transaction mutation limit or hold locks too long.

TTL delete transactions run at `Background` priority. Priority affects
admission ordering when a concurrency ceiling is configured; it does not make a
running delete cheaper or prevent lock conflicts. Use delete rate limits and
small batches to control foreground impact.

## Node Defaults

Table parameters fall back to node defaults:

```yaml
ttl_enabled: true
ttl_default_job_cron: '@daily'
ttl_default_select_batch_size: 500
ttl_default_delete_batch_size: 100
ttl_default_select_rate_limit: 0
ttl_default_delete_rate_limit: 100
ttl_spans_per_table: 64
ttl_max_concurrent_spans_per_node: 1
ttl_load_pause_threshold: 16
ttl_span_lease_ms: 30000
ttl_span_lease_renew_interval_ms: 10000
```

Use table-level overrides for tables that need a different cadence or
different resource limits.

`ttl_grace_ms` is table-level only. Use it for clock-skew tolerance or short
renewal races, not as the main retention rule. If rows should live for 30 days,
write the expiration column 30 days ahead.

## Cluster Operation

For each database, one elected planner creates TTL runs for tables whose
cadence has elapsed. A run records the table identity, one HLC-based expiry
horizon, and a set of keyspace spans.

Workers on any node can claim spans. Claims use leases, so if a worker stops,
another worker can take over after the lease expires. Span progress is
checkpointed after committed deletes, allowing resumed work to continue without
rescanning from the beginning.

If a table is dropped and later recreated with the same name, old TTL runs do
not affect the new table. Runs are tied to the table identity, not only the
table name.

## Monitoring

Use `SHOW ENGINE STATS` to inspect TTL counters:

```camussql
SHOW ENGINE STATS LIKE 'ttl.%';
```

| Metric | Meaning |
| --- | --- |
| `ttl.rows_expired` | Rows deleted by TTL on this node. |
| `ttl.rows_skipped_recheck` | Candidate rows spared because they no longer expired at delete time. |
| `ttl.rows_failed` | Rows whose delete failed or could not be resolved. |
| `ttl.spans_completed` | TTL spans completed on this node. |
| `ttl.spans_reclaimed` | Spans this node took over after another worker's lease lapsed. |
| `ttl.runs_planned` | TTL runs planned on this node. |
| `ttl.runs_completed` | TTL runs completed by this node. |
| `ttl.sweep_duration_ms` | Cumulative time this node spent sweeping TTL spans. |

Per-table gauges are tagged with the database and table:

| Metric | Meaning |
| --- | --- |
| `ttl.table.state` | Current table state: `0` idle, `1` paused, `2` progressing, `3` waiting, `4` failing, `5` stalled. |
| `ttl.table.spans_done` | Spans completed in the current run. |
| `ttl.table.span_count` | Total spans in the current run. |
| `ttl.table.rows_deleted` | Rows deleted in the current run. |
| `ttl.table.rows_failed` | Rows that failed in the current run. |
| `ttl.table.horizon_ms` | HLC physical time used as the run's expiration horizon. |
| `ttl.table.last_observed_ms` | Last time the scheduler observed this table. |

Counters are node-local and cumulative since process start. In a cluster, query
each node and sum the counters when you need a cluster-wide view.

If `ttl.rows_expired` stays flat for a table that should be shrinking, check:

- `ttl_enabled` on the node
- `ttl_pause` on the table
- whether `ttl_job_cron` has elapsed since the last run
- whether the expiration column is `NULL`
- whether the expiration values are still in the future or inside `ttl_grace_ms`

## Related Pages

- [Tables And Columns](/docs/sql-schema)
- [Configuration](/docs/configuration)
- [Engine Stats](/docs/engine-stats)
- [Transaction Priority](/docs/transaction-priority)
