---
sidebar_position: 4
---

# Functions

CamusDB scalar functions can be used anywhere a scalar expression is accepted,
including select lists, aliases, filters, nested expressions, and grouped query
expressions.

```sql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5;
```

Function names are case-insensitive. Most functions return `NULL` when any
argument is `NULL`; the category pages call out the functions with different
null handling.

## Categories

- [String Functions](/docs/functions-string)
- [Math Functions](/docs/functions-math)
- [Date/Time Functions](/docs/functions-datetime)
- [JSON Functions](/docs/functions-json)
- [Conversion Functions](/docs/functions-conversion)
- [Object Id Functions](/docs/functions-object-id)

## General Rules

Arguments are evaluated before the function call. Functions validate their
argument count and argument types at execution time.

Volatile functions such as `gen_id()`, `current_timestamp()`, `now()`,
`current_date()`, `unix_timestamp()`, and `random()` can return a different
value on each evaluation.

String literals in CamusDB SQL are written with double quotes:

```sql
SELECT concat("robot-", to_string(year)) AS label
FROM robots;
```
