---
sidebar_position: 3.68
---

# Row-level TTL

CamusDB can expire a row automatically. A table names a column that holds an
expiry instant. A background sweep then deletes each row whose instant has
passed. No user issues a `DELETE`.

The parameter names, their values, and their defaults follow the row-level TTL
of CockroachDB. If you know that feature, you already know this one. Where
CamusDB supports less, it supports a narrower value for the same parameter. It
does not use a different parameter. See
[Differences from CockroachDB](#differences-from-cockroachdb).

## Turn it on

The node-level switch is `ttl_enabled` in `config.yml`. It is on by default. One
task therefore remains: name the column that holds the expiry instant, on the
table that you want CamusDB to sweep. Until a table names such a column, it is
not a TTL table, and the sweep ignores it completely.

`ttl_enabled: false` stops the sweep loop on the whole node. The feature then
does nothing at all. CamusDB collects no expired row, whatever the tables say.

Name the column on the table:

```camussql
ALTER TABLE sessions SET (ttl_expiration_expression = 'expires_at');
```

The column may be a `DATETIME`, a `DATE`, or an `INT64` in Unix epoch
milliseconds. The presence of this parameter is what enables TTL for the table.

A row expires when the value of its column is in the past. A `NULL` never
expires. That rule gives you an explicit value that means "keep this row
forever". You need no second flag column.

### Turn it off

```camussql
ALTER TABLE sessions SET (ttl_pause = 'true');   -- stop sweeping, keep the configuration
ALTER TABLE sessions RESET (ttl);                -- remove the configuration entirely
```

`RESET (ttl)` clears every TTL parameter at once. You therefore never leave a
tuning value behind that points at a cleared column.

`RESET` also accepts one parameter, as in `RESET (ttl_job_cron)`. That form
restores only that parameter to its node default.

## Parameters

Set a parameter with `ALTER TABLE t SET (key = value, ...)`. Clear it with
`RESET`.

| Parameter | Type | Default | What it does |
|---|---|---|---|
| `ttl_expiration_expression` | column name | (none) | The column that holds the expiry instant. It enables TTL. |
| `ttl_pause` | boolean | `false` | Stops the sweep. It keeps the configuration. |
| `ttl_job_cron` | cron macro | `'@daily'` | How often CamusDB sweeps the table. |
| `ttl_select_batch_size` | integer | `500` | The number of rows that one scan batch reads. |
| `ttl_delete_batch_size` | integer | `100` | The number of rows that one transaction deletes. |
| `ttl_select_rate_limit` | integer | `0` | The cap on the scan, in rows per second. `0` means no limit. |
| `ttl_delete_rate_limit` | integer | `100` | The cap on the deletes, in rows per second. `0` means no limit. |
| `ttl_grace_ms` | integer | `0` | An extra delay after the expiry, before a row becomes eligible. |

`ttl_job_cron` accepts `'@hourly'`, `'@daily'`, `'@weekly'`, and `'@monthly'`.
It also accepts `'@midnight'` as another spelling of `'@daily'`.

The parameter sets a cadence. It does not set a wall-clock schedule. `@daily`
means about once a day. It does not mean at midnight. CamusDB orders the sweeps
by the hybrid logical clock of the cluster. It never orders them by wall time.

You can also give the settings inline, on `CREATE TABLE ... WITH (...)`. `SHOW
CREATE TABLE` renders that form. Its output therefore creates the same table
again. It does not only describe the table:

```camussql
SHOW CREATE TABLE sessions;
-- CREATE TABLE `sessions` (...) WITH (ttl_expiration_expression = 'expires_at', ttl_grace_ms = 5000);
```

### Node defaults

Every per-table tuning parameter falls back to a node default. You can therefore
set one policy for the fleet. Override it only where one table needs a different
value.

| Config key | Default | Supplies the default for |
|---|---|---|
| `ttl_enabled` | `true` | The main switch |
| `ttl_default_job_cron` | `'@daily'` | `ttl_job_cron` |
| `ttl_default_select_batch_size` | `500` | `ttl_select_batch_size` |
| `ttl_default_delete_batch_size` | `100` | `ttl_delete_batch_size` |
| `ttl_default_select_rate_limit` | `0` | `ttl_select_rate_limit` |
| `ttl_default_delete_rate_limit` | `100` | `ttl_delete_rate_limit` |
| `ttl_spans_per_table` | `64` | The number of spans that one run divides the table into |
| `ttl_max_concurrent_spans_per_node` | `1` | The number of spans that one node works on at a time |
| `ttl_load_pause_threshold` | `16` | The number of foreground transactions in flight that pauses the sweep |
| `ttl_span_lease_ms` | `30000` | The lease of a claim on a span |
| `ttl_span_lease_renew_interval_ms` | `10000` | How often an owner renews its claim |

## The one thing to know: an expired row stays visible

An expired row stays readable until the sweep deletes it. TTL is a background
collector. It is not a filter at read time. A `SELECT` therefore returns a row
whose expiry has passed, while the sweep has not reached that row yet.

This behavior is by design. A filter at read time would add a predicate to every
read of a TTL table. It would also change an index-only scan. An index entry
does not carry the TTL column, unless you added that column as an `INCLUDE`
column. The engine would therefore have to fetch rows that it never touches
today. The cost would land on every query, forever, to hide a row for at most one
sweep interval.

Filter explicitly if your application needs exact expiry semantics:

```camussql
SELECT * FROM sessions WHERE expires_at > NOW();
```

Treat TTL as what it is. It reclaims space. It does not enforce visibility.
`ttl_job_cron` bounds the lag. A table that needs a tight bound must sweep more
often.

## Tuning

Start with the delete rate, not with the batch sizes.
`ttl_delete_rate_limit` is the throttle that governs the impact of the sweep.
The batch sizes govern the shape of a transaction. The default of 100 rows per
second is conservative by design.

The delete batches are small for a reason. Each row costs one mutation for each
index entry, plus one mutation for the row itself. A table with four indexes
therefore spends five mutations for each row. `ttl_delete_batch_size` must stay
well below the transaction limit of 20,000 mutations. A short delete transaction
also stops a foreground writer from a wait behind the locks of the sweep.

Priority orders the admission, not the execution. A sweep transaction runs at
`Background` priority. That priority decides who waits at the door, while a
ceiling on concurrency is configured. After admission, a background delete takes
ordinary exclusive locks. It blocks a foreground writer exactly like any other
transaction. Small batches and short transactions protect your latency. The
priority tag does not.

Spans divide the work. `ttl_max_concurrent_spans_per_node` decides how much of
that work runs at one time. The limit is local to a node. A cluster of N nodes
can therefore have N times that number of spans in flight.

The rate limits are also per node, and the concurrent spans of a table share
them. More concurrency therefore does not multiply the configured rate.

A worker reads only its own span. The bounds of a span are seeks into the store.
They are not a filter over everything. More spans therefore add no scan work.

The division into spans is uniform over the space of row ids today, and that
division is not balanced. A row id contains a timestamp in seconds. 64 spans are
therefore each about two years wide. Almost every row of an active table lands in
one of them.

Correctness does not depend on that distribution. CamusDB sweeps every row
exactly once in either case. Throughput does depend on it. A higher
`ttl_spans_per_table` therefore does not currently spread a table with many
appends across the workers.

Use `ttl_grace_ms` for clock skew. Do not use it as a business rule. It delays
the eligibility of a row past the expiry instant. It therefore absorbs a writer
whose clock is slow. To keep a row for 30 days, set the column 30 days ahead. Do
not set a grace period of 30 days.

## Watch it

```camussql
SHOW ENGINE STATS LIKE 'ttl.%';
```

| Metric | Meaning |
|---|---|
| `ttl.rows_expired` | Rows that the sweep deleted on this node |
| `ttl.rows_skipped_recheck` | Rows that looked expired at scan time, and that CamusDB spared at delete time |
| `ttl.rows_failed` | Rows whose delete failed, or whose outcome CamusDB could not resolve |
| `ttl.spans_completed` | Spans that this node finished |
| `ttl.spans_reclaimed` | Spans that this node took over from a worker whose lease lapsed |
| `ttl.runs_planned` | Runs that this node created as the planner |
| `ttl.runs_completed` | Runs that this node retired as finished |
| `ttl.sweep_duration_ms` | The total time that this node spent on sweeps |

There are also per-table rows. Each one carries the tags `db=…` and `table=…`:

| Metric | Meaning |
|---|---|
| `ttl.table.state` | 0 idle, 1 paused, 2 progressing, 3 waiting, 4 failing, 5 stalled |
| `ttl.table.spans_done` and `ttl.table.span_count` | The progress of the open run |
| `ttl.table.rows_deleted` and `ttl.table.rows_failed` | The totals of this run |
| `ttl.table.horizon_ms` | The instant that this run judges the rows against |
| `ttl.table.last_observed_ms` | The time when a tick last looked at this table |

Read `ttl.table.state` before you read the totals. A cumulative counter answers
one question: does TTL work at all? It cannot name the table that stopped,
because the numbers of a healthy table hide a silent one.

Four states matter most, because they look alike from the outside:

- `idle` means that there is nothing to do.
- `waiting` means that another node holds the spans.
- `stalled` means that an open run passed its own cadence without progress.
- `failing` means that CamusDB attempts the deletes, and that they do not
  succeed. Check `ttl.rows_failed` in that case.

Each counter is per node, and it accumulates from the start of the node. Sum the
counters across the nodes of a cluster. The counters need metric collection.

`ttl.rows_failed` must be zero. A value above zero means one of two things: a
delete transaction failed, or CamusDB could not resolve its outcome.

CamusDB leaves those rows before the checkpoint of the sweep, by design. The
next attempt therefore retries them. It does not step over them. No data is
lost. A value that stays above zero nevertheless means that something fails, and
that each run makes less progress than it appears to make.

The count of failures is separate from the count of skips for exactly that
reason. A skip is the system at work. A failure is not. One number for both
would look healthy while the data accumulated.

`ttl.rows_skipped_recheck` is the interesting metric. CamusDB checks a row again,
under a lock, at the moment of the delete. A row therefore survives when
something extended its expiry between the scan and the delete.

On a table of sessions, a steady trickle here is normal and healthy. It is the
renewals that win the races, exactly as they must. A value close to
`ttl.rows_expired` means that the sweep mostly fights live traffic. Look at its
cadence and at its batch sizes again in that case.

`ttl.rows_expired` can stay flat on a table that you expect to shrink. Check
four things, in this order:

1. `ttl_enabled` on the node.
2. `ttl_pause` on the table.
3. Whether `ttl_job_cron` has elapsed since the last run.
4. Whether the expiry column is `NULL` for the rows that you expected to
   disappear.

## Differences from CockroachDB

CamusDB implements a subset. Each parameter that exists behaves as it does in
CockroachDB.

Two parameters take a narrower value:

- `ttl_expiration_expression` takes a bare column name. CockroachDB accepts any
  SQL expression that returns a timestamp. CamusDB rejects an expression, with a
  message that says that expressions are not supported yet. The parameter is
  correct. Only the grammar of the value is narrower. A wider grammar later will
  need no rename.
- `ttl_job_cron` takes the `@macro` forms only. CamusDB rejects a CRON
  expression with five fields.

Three parameters are absent:

- `ttl_expire_after` needs an `INTERVAL` type and an `INTERVAL` literal, and
  CamusDB has neither. It also needs a hidden expiration column. Use
  `ttl_expiration_expression` with your own column instead. CockroachDB itself
  recommends that parameter.
- `ttl_disable_changefeed_replication` has no purpose here. CamusDB has no
  changefeed.
- `ttl_row_stats_poll_interval` and `ttl_label_metrics` are specific to
  Prometheus. Use `SHOW ENGINE STATS` instead.

One parameter is an extension of CamusDB:

- `ttl_grace_ms` has no equivalent in CockroachDB. In CockroachDB you would put
  a grace period inside the expiration expression. A bare column name cannot
  express that.

## How it works

This section matters if you operate a cluster.

A planner runs on one elected node for each database. It creates a run when the
cadence of a table has elapsed. A run is a durable manifest. The manifest records
the table, one expiry horizon from the hybrid logical clock, and a span count.
Every worker of the run tests its rows against that one horizon. Two nodes
therefore can never disagree about a row on the boundary that they share.

Workers run on every node. This is the first background job of CamusDB whose
work spreads across the cluster. Other jobs run entirely on the leader.

A worker claims a span. CamusDB does not assign a span to a worker. The worker
takes a lease on the key of the span. Because of the lease, a worker that dies
stops the block on that span. It does not stall the whole run. A claim needs no
knowledge of which nodes are alive. That is the reason for a claim instead of an
assignment.

CamusDB processes each span in four steps:

1. It scans a bounded batch.
2. It keeps the expired rows.
3. It deletes them in small transactions.
4. It writes a checkpoint after the deletes commit.

CamusDB stores the checkpoint separately from the claim, and the checkpoint does
not expire with the claim. A worker that takes over the span of a dead worker
therefore continues from the point where the other worker stopped. It does not
scan from the start again.

A delete goes through the normal delete path. A row and all of its index entries
therefore go in one transaction.

That is the reason why TTL does not use the per-key expiry of the KV layer.
Expiry of the row key alone would strand every secondary index entry
permanently. An index-only scan would then return a row that no longer exists.

CamusDB discards a run whose table id no longer matches the live schema. It does
not drive that run. A run left behind by a `DROP` therefore can never delete a
row out of a new table that reuses the name.

A manifest also records the contents generation of its plan. A
[`TRUNCATE`](/docs/truncate-table) moves the table to a new generation, and the
run becomes inert at once. The planner tests the generation again, and each span
of a worker tests it again.

No worker can therefore delete from the retired generation, which a recovery can
still get back. No worker can delete from the new generation either, because the
plan of its span never described that generation. CamusDB cleans the records of
the stale run in the background.
