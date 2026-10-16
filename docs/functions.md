---
sidebar_position: 4
---

# Functions

A scalar function works at any position that accepts a value. That includes a
projection, a filter, a key of a `GROUP BY`, a default, and a check constraint.
A function also nests inside another function:

```camussql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5;
```

The name of a function is not case-sensitive.

## Categories

- [Session Functions](/docs/functions-session) report the current database,
  authenticated user, role, and superuser status.
- [String Functions](/docs/functions-string) inspect, normalize, slice, replace,
  and combine text.
- [Bytes Functions](/docs/functions-bytes) encode, decode, inspect, and modify
  binary values.
- [Math Functions](/docs/functions-math) round, truncate, compare, and calculate
  with numeric values.
- [Hash Functions](/docs/functions-hash) calculate hexadecimal and binary
  digests, HMACs, and CRC-32 checksums.
- [Date/Time Functions](/docs/functions-datetime) construct, inspect, calculate,
  format, and parse dates and timestamps.
- [Set-returning Functions](/docs/functions-set-returning) produce rows in a
  `FROM` clause, including numeric and temporal series.
- [JSON Functions](/docs/functions-json) validate JSON text and inspect or
  extract values with paths.
- [Regex Functions](/docs/functions-regex) match, extract, replace, count, and
  split text with regular expressions.
- [Conversion Functions](/docs/functions-conversion) convert scalar values with
  functions or SQL `CAST` syntax.
- [Null Functions](/docs/functions-null) select fallback values for nullable
  expressions.
- [UUID Functions](/docs/functions-uuid) generate native version 4 and version 7
  UUID values.
- [Object ID Functions](/docs/functions-object-id) generate and convert native
  `OID` values.
- [Array Functions](/docs/functions-array) inspect array length and test element
  membership.
- [Sequence Functions](/docs/sequences#use-values) allocate, inspect, and set
  values from named counters.
- [Vector Functions](/docs/vector-search) inspect vector dimensions and compare
  vectors with distance and similarity metrics.

## Two rules worth your attention

A null propagates. Most functions return `NULL` when one argument is `NULL`.
[Null Functions](/docs/functions-null) covers the exceptions, such as `coalesce`
and `nullif`. Each page of a category marks any other exception.

Some functions are volatile. Eight of them can return a different value at every
evaluation: `gen_id()`, `gen_uuid_v4()`, `gen_uuid_v7()`, `current_timestamp()`,
`now()`, `current_date()`, `unix_timestamp()`, and `random()`. That property
makes them useful as the default of a column. It also makes them unsafe in a
predicate that must stay stable across a scan.

The [session functions](/docs/functions-session) are volatile for another
reason. They vary by caller, not by row. They therefore bypass the result cache.
You cannot use one as a default.

CamusDB evaluates the arguments before the call. It validates the number of the
arguments and their types at the execution. It does not validate them at the
parse.
