---
sidebar_position: 3.25
---

# Spill to disk

CamusDB streams the result of a query to the client. Some query operators must
nevertheless hold intermediate rows before they produce output.

Spill to disk lets such an operator move a large intermediate buffer into a
temporary file. The memory of the process therefore does not grow without a
bound.

Spill is off by default. While it is off, an operator uses its normal path in
memory. While it is on, an operator stays in memory until its own buffer passes
the spill threshold.

## What can spill

Spill applies to work that blocks, and to work that materializes rows:

| Operator | Why it buffers | Spill behavior |
| --- | --- | --- |
| The sort of an `ORDER BY` | It needs the rows before it emits a sorted output. | An external merge sort. |
| A hash join | It builds a hash table from one side of the join. | A grace hash join or a hybrid hash join. It divides the rows into spill files when the build side is too large. |
| A `GROUP BY` | It keeps one accumulator for each group. | It divides the rows by the key of the group. It then aggregates one partition at a time. |
| A `SELECT DISTINCT` | It records which result tuples appeared already. | It sorts the rows. It then drops each adjacent duplicate. |
| A derived table and a subquery | It materializes the rows, so the outer query can scan them. | A spill buffer that CamusDB can enumerate again. |
| The match set of a `DELETE` and of an `UPDATE` | It must collect the matching rows before the mutation. | A spill buffer that CamusDB can enumerate again. |

A streaming operator does not spill, because it needs no large intermediate
buffer. There are four examples:

- A simple scan.
- A global aggregate, such as `COUNT(*)` without a `GROUP BY`.
- A streaming `DISTINCT` over an ordered index.
- A merge join. It buffers only the current run of equal keys.

## DELETE and UPDATE

`DELETE` and `UPDATE` collect every matching row before they apply the
mutations. They cannot mutate a row safely during the scan. A change to a row
can also change the index under the scan. Rows would then be skipped, or visited
twice.

While spill is enabled, the collected match set can overflow into a temporary
file. The mutation phase then reads the sealed match set back. It applies the
same row changes that it would apply from memory.

## Temporary files

A spill file lives under `data_dir`:

```text
{data_dir}/tmp/spill/{instanceId}/{scopeId}/
```

Each process owns one `{instanceId}` directory for its whole life. Each operator
that spills receives one `{scopeId}` directory.

CamusDB deletes the spill files in three cases: the operation completes, the
operation is cancelled, or the operation fails with an exception.

A file can remain if something kills the process during a query. At startup,
CamusDB sweeps the spill root as well as it can. It uses one lock file for each
instance. It therefore separates a stale directory from a spill file that
another live process owns.

## The row format

A spill file uses a binary codec for a row, and that codec needs no schema. This
property matters, because an intermediate row can be synthetic. A row of a join,
a row of a derived table, and a projected row can match no single table schema.

Each spilled row stores five parts: its row id, the column count, the column
names, the type tag of each value, and the values. The row id matters for
`DELETE` and for `UPDATE`. The mutation phase must still target the original
row.

## Configuration

You configure spill in `config.yml`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `spill_enabled` | `false` | The main switch. While it is `false`, no query operator spills. |
| `spill_threshold_rows` | `500000` | The cap on the rows that one operator holds in memory, before the spill starts. |
| `spill_merge_fan_in` | `16` | The maximum number of spill runs that CamusDB reads at one time, during a merge pass. |

Here is an example:

```yaml
spill_enabled: true
spill_threshold_rows: 500000
spill_merge_fan_in: 16
```

See [Configuration](/docs/configuration) for the full reference of the startup
configuration.

## Behavior after a failure

An operator can need a spill while CamusDB cannot create or open a spill file.
The query then fails with `CADB0507`, which is `SpillStorageUnavailable`.
CamusDB does not fall back to unbounded memory in silence when the spill storage
is unavailable.

Three causes are typical:

- The CamusDB process cannot write to `data_dir`.
- The disk that holds `data_dir` is full.
- Somebody removed the temporary spill directories, or gave them the wrong
  permissions.

Correct the problem in the storage. Then run the query again.

## Operational notes

- Spill applies to one instance of an operator. It is not a memory budget for a
  whole query.
- An operator that stays below the threshold creates no spill file.
- Spill exchanges pressure on the memory for I/O on the disk. A large sort, a
  grouped query, a distinct query, a hash join, and a bulk update can therefore
  run longer. None of them makes the heap grow without a bound.
- A threshold in bytes could give tighter control of the memory than the current
  threshold in rows. That threshold is a possible improvement in the future.
