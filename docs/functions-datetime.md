---
sidebar_position: 4.3
---

# Date/Time Functions

Date/time functions use UTC-normalized string values. They accept date-only
strings in `YYYY-MM-DD` format and timestamp strings with an explicit UTC marker
or offset, such as `2024-06-15T10:30:00Z` or
`2024-06-15T10:30:00+05:00`.

Local timestamp strings without an offset are rejected. For example,
`2024-06-15T10:30:00` and `2024-06-15 10:30:00` are invalid because the time
zone is ambiguous.

Supported units are `year`, `month`, `day`, `hour`, `minute`, `second`, and
`millisecond`. Plural names such as `days` and `months` are also accepted.

| Function | Returns | Description |
| --- | --- | --- |
| `current_timestamp()` | `STRING` | Current UTC timestamp. |
| `now()` | `STRING` | Alias for `current_timestamp()`. |
| `current_date()` | `STRING` | Current UTC date in `YYYY-MM-DD` format. |
| `date_add(value, amount, unit)` | `STRING` | Adds an `INT64` amount of the given unit and returns a UTC timestamp string. |
| `date_diff(start, end, unit)` | `INT64` | Difference from `start` to `end` in whole units. |
| `date_part(unit, value)` | `INT64` | Extracts a UTC component from `value`. |
| `date_trunc(unit, value)` | `STRING` | Truncates `value` to the start of the requested UTC unit. |
| `unix_timestamp()` | `INT64` | Current UTC Unix timestamp in whole seconds. |
| `unix_timestamp(value)` | `INT64` | Converts a date/time string to Unix timestamp seconds. |
| `from_unixtime(seconds)` | `STRING` | Converts Unix timestamp seconds to a UTC timestamp string. |

## Examples

```sql
SELECT current_timestamp(), now(), current_date();

SELECT date_add("2024-06-15", 1, "day");
-- "2024-06-16T00:00:00.0000000+00:00"

SELECT date_add("2024-06-15T10:30:00Z", 2, "hours");
-- "2024-06-15T12:30:00.0000000+00:00"

SELECT date_diff("2024-06-01", "2024-06-11", "days");
-- 10

SELECT date_part("hour", "2024-06-15T10:30:00+05:00");
-- 5

SELECT date_trunc("month", "2024-06-15T10:30:45.123Z");
-- "2024-06-01T00:00:00.0000000+00:00"

SELECT unix_timestamp("2024-06-15T10:30:00Z");
-- 1718447400

SELECT unix_timestamp("2024-06-15");
-- 1718409600

SELECT from_unixtime(1718447400);
-- "2024-06-15T10:30:00.0000000+00:00"

SELECT from_unixtime(unix_timestamp("2024-06-15T10:30:00+00:00"));
-- "2024-06-15T10:30:00.0000000+00:00"
```

## Null And Overflow Rules

`date_add`, `date_diff`, `date_part`, `date_trunc`, `unix_timestamp(value)`,
and `from_unixtime(seconds)` return `NULL` when any argument is `NULL`.
`unix_timestamp()` has no arguments and returns the current UTC Unix timestamp
in seconds.

Invalid units, invalid date strings, ambiguous local timestamps, Unix timestamp
values outside the supported date/time range, and date/time overflows fail the
query.
