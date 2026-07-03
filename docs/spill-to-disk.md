---
sidebar_position: 3.25
---

# Spill To Disk

CamusDB streams query results to the client, but some query operators must hold
intermediate rows before they can produce output. Spill to disk lets those
operators move large intermediate buffers into temporary files instead of
growing process memory without bound.

Spill is off by default. When it is off, operators use their normal in-memory
paths. When it is on, an operator still stays in memory until its own buffer
crosses the spill threshold.

## What Can Spill

Spill applies to blocking or materializing work:

| Operator | Why it buffers | Spill behavior |
| --- | --- | --- |
| `ORDER BY` sort | Needs rows before emitting sorted output. | External merge sort. |
| Hash join | Builds a hash table from one join side. | Grace/hybrid hash join partitions rows to spill files when the build side is too large. |
| `GROUP BY` | Keeps one accumulator per group. | Partitions rows by group key, then aggregates one partition at a time. |
| `SELECT DISTINCT` | Tracks which result tuples have appeared. | Sorts rows, then drops adjacent duplicates. |
| Derived tables and subqueries | Materializes rows so they can be scanned by the outer query. | Re-enumerable spill buffer. |
| `DELETE` and `UPDATE` match sets | Must collect matching rows before mutating. | Re-enumerable spill buffer. |

Streaming operators do not spill because they do not need large intermediate
buffers. Examples include simple scans, global aggregates such as `COUNT(*)`
without `GROUP BY`, streaming `DISTINCT` over an ordered index, and merge joins
that only buffer the current equal-key run.

## DELETE And UPDATE

`DELETE` and `UPDATE` collect all matching rows before applying mutations. They
cannot safely mutate rows while scanning, because changing a row may also
change the index being scanned. That can cause rows to be skipped or visited
twice.

When spill is enabled, the collected match set can overflow to temporary files.
The mutation phase then reads the sealed match set back and applies the same
row changes it would have applied from memory.

## Temporary Files

Spill files live under `data_dir`:

```text
{data_dir}/tmp/spill/{instanceId}/{scopeId}/
```

Each process owns one `{instanceId}` directory for its lifetime. Each spilling
operator gets a `{scopeId}` directory. Spill files are deleted when the
operation completes, is cancelled, or fails with an exception.

If the process is killed mid-query, files can be orphaned. On startup, CamusDB
runs a best-effort sweep of the spill root. It uses per-instance lock files to
distinguish stale directories from spill files owned by another live process.

## Row Format

Spill files use a schema-less binary row codec. This matters because
intermediate rows may be synthetic: a joined row, derived-table row, or
projected row may not match any single table schema.

Each spilled row stores its row id, column count, column names, value type tags,
and values. Preserving the row id is important for `DELETE` and `UPDATE`, where
the mutation phase must still target the original row.

## Runtime Knobs

The current spill controls are runtime `CamusDBConfig` settings:

| Setting | Default | Meaning |
| --- | --- | --- |
| `SpillEnabled` | `false` | Master switch. When `false`, no query operator spills. |
| `SpillThresholdRows` | `500000` | Per-operator in-memory row cap before spilling starts. |
| `SpillMergeFanIn` | `16` | Maximum spill runs read at once during merge passes. |

These are not currently accepted as `config.yml` keys. See
[Configuration](/docs/configuration) for the supported startup YAML options.

## Failure Behavior

If an operator needs to spill but CamusDB cannot create or open spill files, the
query fails with `CADB0507` (`SpillStorageUnavailable`). CamusDB does not
silently fall back to unbounded memory when spill storage is unavailable.

Typical causes:

- `data_dir` is not writable by the CamusDB process.
- The disk containing `data_dir` is full.
- Temporary spill directories were removed or permissioned incorrectly.

Fix the storage problem and retry the query.

## Operational Notes

- Spill is per operator instance, not a global query memory budget.
- Operators that stay below the threshold create no spill files.
- Spill trades memory pressure for disk I/O, so large sorts, grouped queries,
  distinct queries, hash joins, and bulk updates may run longer but avoid
  unbounded heap growth.
- A future byte-based threshold may provide tighter memory control than the
  current row-count threshold.
