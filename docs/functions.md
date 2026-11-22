---
sidebar_position: 4
---

# Functions

Built-in functions let you clean and convert values in the query, and your
application doesn't have to do that work. For example, you can normalize
text or bucket timestamps in the same statement that reads or writes the rows.
Many functions have a name that you know from PostgreSQL or MySQL, such as
`now()` and `date_trunc`.

You can use a scalar function in any place where a value is allowed, for
example in a `WHERE` filter or in a column default.
Functions can also be nested:

```camussql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5;
```

Function names aren't case-sensitive.

To add your own scalar functions in C#, see
[C# extensions](/docs/csharp-extensions). The same extension system also
supports table functions, aggregates, row triggers, and stored procedures.

## Categories

- [Session functions](/docs/functions-session) return the current database and
  user.
- [String functions](/docs/functions-string) inspect and change text.
- [Bytes functions](/docs/functions-bytes) encode and decode binary values.
- [Math functions](/docs/functions-math) round and calculate numeric values.
- [Hash functions](/docs/functions-hash) calculate digests and checksums.
- [Date/time functions](/docs/functions-datetime) calculate and format dates and
  timestamps.
- [Set-returning functions](/docs/functions-set-returning) return rows in a
  `FROM` clause, such as an integer series.
- [JSON functions](/docs/functions-json) validate JSON text and extract values
  with paths.
- [JSONB functions](/docs/json#functions) build and change `JSONB` documents,
  with the PostgreSQL function names.
- [Regex functions](/docs/functions-regex) match and replace text with regular
  expressions.
- [Conversion functions](/docs/functions-conversion) convert values, also with
  SQL `CAST` syntax.
- [Null functions](/docs/functions-null) return a fallback value for a `NULL`.
- [UUID functions](/docs/functions-uuid) generate version 4 and version 7 UUIDs.
- [Object ID functions](/docs/functions-object-id) generate and convert `OID`
  values.
- [Array functions](/docs/functions-array) return the length of an array and
  test whether it contains a value.
- [Sequence functions](/docs/sequences#use-values) get and set values of named
  counters.
- [Vector functions](/docs/vector-search) return vector dimensions and compare
  vectors.

[Window functions](/docs/sql-queries#window-functions) rank rows and calculate
running totals for each row. They use
`OVER (...)`. You can use them in the select list and in the final `ORDER BY`
only.

## Nulls and volatile functions

Most functions return `NULL` when an argument is `NULL`.
[Null functions](/docs/functions-null) covers the exceptions, such as `coalesce`
and `nullif`. Each category page shows other exceptions.

The result of a volatile function can change over time. The following table
shows when it changes:

| Changes | Functions |
| --- | --- |
| On each call | `gen_id()`, `gen_uuid_v4()`, `gen_uuid_v7()`, `random()`, `gen_random_bytes(n)`, `clock_timestamp()`, `sysdate()` |
| On each statement | `statement_timestamp()` |
| On each transaction | `now()`, `current_timestamp()`, `transaction_timestamp()`, `current_date()`, `unix_timestamp()`, `unix_timestamp_ms()` |
| On each call, with a sequence | `nextval`, `currval`, `lastval`, `setval` |

Volatile functions such as `gen_id()` and `now()` work as column defaults. Don't
use a per-call function in a filter that must return the same rows each time.

The result of a [session function](/docs/functions-session) depends on the
caller. That page also covers their use in `DEFAULT` and `CHECK`.

Most scalar functions evaluate all their arguments before the call. `IF` and
`CASE` evaluate only the selected result. For the type rules of conditional
results, see [conditional type rules](/docs/data-types#conditional-result-types).
