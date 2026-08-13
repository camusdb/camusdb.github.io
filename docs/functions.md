---
sidebar_position: 4
---

# Functions

Scalar functions work anywhere a value is accepted — projections, filters,
`GROUP BY` keys, defaults, check constraints — and they nest freely:

```camussql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5;
```

Function names are case-insensitive.

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

## Two Rules Worth Knowing

**Nulls propagate.** Most functions return `NULL` if any argument is `NULL`. The
exceptions — `coalesce`, `nullif`, and friends — are covered in
[Null Functions](/docs/functions-null), and each category page flags any others.

**Some functions are volatile.** `gen_id()`, `gen_uuid_v4()`, `gen_uuid_v7()`,
`current_timestamp()`, `now()`, `current_date()`, `unix_timestamp()`, and
`random()` can return a different value on every evaluation. That is what makes
them useful as column defaults, and what makes them unsafe in a predicate you
expect to be stable across a scan. The
[session functions](/docs/functions-session) are volatile for a different
reason — they vary by caller, not by row — so they bypass the result cache but
cannot be used as a default.

Arguments are evaluated before the call, and argument count and types are
validated at execution time — not at parse time.
