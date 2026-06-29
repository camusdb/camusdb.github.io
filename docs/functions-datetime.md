---
sidebar_position: 4.3
---

# Date/Time Functions

Date/time functions return typed `DATE`, `DATETIME`, or `INT64` values. They
can consume `DATE` and `DATETIME` columns directly, and they also accept
date-only strings in `YYYY-MM-DD` format and timestamp strings with an explicit
UTC marker or offset, such as `2024-06-15T10:30:00Z` or
`2024-06-15T10:30:00+05:00`.

Local timestamp strings without an offset are rejected. For example,
`2024-06-15T10:30:00` and `2024-06-15 10:30:00` are invalid because the time
zone is ambiguous.

Supported units are `year`, `month`, `day`, `hour`, `minute`, `second`, and
`millisecond`. Plural names such as `days` and `months` are also accepted.

| Function | Returns | Description |
| --- | --- | --- |
| `current_timestamp()` | `DATETIME` | Current UTC instant. |
| `now()` | `DATETIME` | Alias for `current_timestamp()`. |
| `current_date()` | `DATE` | Current UTC date. |
| `date_add(value, amount, unit)` | `DATETIME` | Adds an `INT64` amount of the given unit. `DATE` inputs are promoted to `DATETIME`. |
| `date_diff(start, end, unit)` | `INT64` | Difference from `start` to `end` in whole units. |
| `date_part(unit, value)` | `INT64` | Extracts a UTC component from `value`. |
| `date_trunc(unit, value)` | `DATETIME` | Truncates `value` to the start of the requested UTC unit. |
| `unix_timestamp()` | `INT64` | Current UTC Unix timestamp in whole seconds. |
| `unix_timestamp(value)` | `INT64` | Converts a `DATE`, `DATETIME`, or date/time string to Unix timestamp seconds. |
| `from_unixtime(seconds)` | `DATETIME` | Converts Unix timestamp seconds to a UTC datetime. |

## Typed Results

Temporal function results can be inserted into temporal columns or compared
with temporal columns without casting:

```camussql
INSERT INTO events (id, happened_at)
VALUES (GEN_ID(), now());

SELECT *
FROM events
WHERE happened_at < current_timestamp();

SELECT date_add(happened_at, 7, "days")
FROM events;
```

`date_add` always returns `DATETIME`. This means adding a day to a `DATE` value
returns a datetime at UTC midnight rather than another `DATE`.

## Examples

```camussql
SELECT current_timestamp(), now(), current_date();

SELECT date_add("2024-06-15", 1, "day");
-- 2024-06-16T00:00:00.0000000Z

SELECT date_add("2024-06-15T10:30:00Z", 2, "hours");
-- 2024-06-15T12:30:00.0000000Z

SELECT date_diff("2024-06-01", "2024-06-11", "days");
-- 10

SELECT date_part("hour", "2024-06-15T10:30:00+05:00");
-- 5

SELECT date_trunc("month", "2024-06-15T10:30:45.123Z");
-- 2024-06-01T00:00:00.0000000Z

SELECT unix_timestamp("2024-06-15T10:30:00Z");
-- 1718447400

SELECT unix_timestamp("2024-06-15");
-- 1718409600

SELECT from_unixtime(1718447400);
-- 2024-06-15T10:30:00.0000000Z

SELECT from_unixtime(unix_timestamp("2024-06-15T10:30:00+00:00"));
-- 2024-06-15T10:30:00.0000000Z
```

## Null And Overflow Rules

`date_add`, `date_diff`, `date_part`, `date_trunc`, `unix_timestamp(value)`,
and `from_unixtime(seconds)` return `NULL` when any argument is `NULL`.
`unix_timestamp()` has no arguments and returns the current UTC Unix timestamp
in seconds.

Invalid units, invalid date strings, ambiguous local timestamps, Unix timestamp
values outside the supported date/time range, and date/time overflows fail the
query.
