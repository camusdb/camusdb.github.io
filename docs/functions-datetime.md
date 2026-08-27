---
sidebar_position: 4.3
---

# Date/time functions

A date function and a time function return a typed value. That value is a
`DATE`, a `DATETIME`, or an `INT64`.

These functions accept a `DATE` column and a `DATETIME` column directly. They
also accept two forms of a string:

- A date, in the form `YYYY-MM-DD`.
- A timestamp with an explicit UTC marker, or with an offset. Two examples are
  `2024-06-15T10:30:00Z` and `2024-06-15T10:30:00+05:00`.

CamusDB rejects a local timestamp string without an offset. `2024-06-15T10:30:00`
and `2024-06-15 10:30:00` are therefore invalid. The time zone of each one is
ambiguous.

The supported units are `year`, `month`, `day`, `hour`, `minute`, `second`, and
`millisecond`. CamusDB also accepts a plural name, such as `days` and `months`.

| Function | Returns | Description |
| --- | --- | --- |
| `current_timestamp()` | `DATETIME` | The current instant in UTC. |
| `now()` | `DATETIME` | An alias of `current_timestamp()`. |
| `current_date()` | `DATE` | The current date in UTC. |
| `date_add(value, amount, unit)` | `DATETIME` | It adds an `INT64` amount of the given unit. It promotes a `DATE` input to a `DATETIME`. |
| `date_diff(start, end, unit)` | `INT64` | The difference from `start` to `end`, in whole units. |
| `date_part(unit, value)` | `INT64` | It extracts a UTC component of `value`. |
| `date_trunc(unit, value)` | `DATETIME` | It truncates `value` to the start of the requested unit, in UTC. |
| `unix_timestamp()` | `INT64` | The current Unix timestamp in UTC, in whole seconds. |
| `unix_timestamp(value)` | `INT64` | It converts a `DATE`, a `DATETIME`, or a string of a date or a time to Unix timestamp seconds. |
| `from_unixtime(seconds)` | `DATETIME` | It converts Unix timestamp seconds to a datetime in UTC. |

## A typed result

You can insert the result of a temporal function into a temporal column. You can
also compare it with a temporal column. Neither operation needs a cast:

```camussql
INSERT INTO events (id, happened_at)
VALUES (GEN_ID(), now());

SELECT *
FROM events
WHERE happened_at < current_timestamp();

SELECT date_add(happened_at, 7, "days")
FROM events;
```

`date_add` always returns a `DATETIME`. The addition of a day to a `DATE` value
therefore returns a datetime at midnight in UTC. It does not return another
`DATE`.

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

## The rules for a null and for an overflow

Six functions return `NULL` when one argument is `NULL`: `date_add`,
`date_diff`, `date_part`, `date_trunc`, `unix_timestamp(value)`, and
`from_unixtime(seconds)`.

`unix_timestamp()` takes no argument. It returns the current Unix timestamp in
UTC, in seconds.

Five conditions make the query fail:

- An invalid unit.
- An invalid string of a date.
- An ambiguous local timestamp.
- A Unix timestamp outside the supported range of a date and a time.
- An overflow of a date or a time.
