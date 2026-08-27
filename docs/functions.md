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

- [Session Functions](/docs/functions-session)
- [String Functions](/docs/functions-string)
- [Math Functions](/docs/functions-math)
- [Date/Time Functions](/docs/functions-datetime)
- [JSON Functions](/docs/functions-json)
- [Regex Functions](/docs/functions-regex)
- [Conversion Functions](/docs/functions-conversion)
- [Null Functions](/docs/functions-null)
- [UUID Functions](/docs/functions-uuid)
- [Object Id Functions](/docs/functions-object-id)
- [Vector functions](/docs/vector-search), which are `octet_length`,
  `vector_dims`, `l2_distance`, `cosine_distance`, and `inner_product`

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
