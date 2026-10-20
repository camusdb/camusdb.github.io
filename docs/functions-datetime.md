---
sidebar_position: 4.3
---

# Date/time functions

Date and time functions let you answer time questions in SQL: orders placed
this month, sessions grouped by hour, days until a subscription expires, or a
timestamp formatted for a report. Clock functions such as `now()` follow
PostgreSQL rules, and CamusDB also accepts the PostgreSQL and MySQL formatting
functions (`to_char`, `date_format`) and the MySQL shortcuts (`year`,
`dayname`), so queries you port need fewer changes.

Each function returns a typed value: a `DATE`, a `DATETIME`, or an `INT64`.
`to_char`, `date_format`, `dayname`, and `monthname` return a `STRING`.

These functions accept a `DATE` column and a `DATETIME` column directly. They
also accept two forms of a string:

- A date, in the form `YYYY-MM-DD`.
- A timestamp with an explicit UTC marker, or with an offset. Two examples are
  `2024-06-15T10:30:00Z` and `2024-06-15T10:30:00+05:00`.

CamusDB rejects a local timestamp string without an offset. `2024-06-15T10:30:00`
and `2024-06-15 10:30:00` are therefore invalid. The time zone of each one is
ambiguous.

The supported units are `year`, `month`, `day`, `hour`, `minute`, `second`,
`millisecond`, `microsecond` (or `us`), `week`, `quarter`, `decade`, `century`,
and `millennium`. CamusDB also accepts a plural name, such as `days`, `months`,
and `millennia`.

Five more units name a position, so they work only in `date_part` and `EXTRACT`:
`dow` (0 = Sunday), `isodow` (1 = Monday to 7 = Sunday), `doy` (day of the year),
`isoyear`, and `epoch` (whole Unix seconds).

As a part, `week` is the ISO-8601 week. `millisecond` and `microsecond` are the
fraction of the current second only (0-999 and 0-999999).

| Function | Returns | Description |
| --- | --- | --- |
| `current_timestamp()` | `DATETIME` | The start of the current transaction, in UTC. |
| `now()` | `DATETIME` | An alias of `current_timestamp()`. |
| `transaction_timestamp()` | `DATETIME` | An alias of `current_timestamp()`. |
| `current_date()` | `DATE` | The UTC date at the start of the current transaction. |
| `statement_timestamp()` | `DATETIME` | The start of the current statement, in UTC. |
| `clock_timestamp()` | `DATETIME` | The current instant in UTC, read again at each call. |
| `sysdate()` | `DATETIME` | An alias of `clock_timestamp()`. |
| `date_add(value, amount, unit)` | `DATETIME` | It adds an `INT64` amount of the given unit. It promotes a `DATE` input to a `DATETIME`. |
| `date_diff(start, end, unit)` | `INT64` | The difference from `start` to `end`, in whole units. |
| `date_part(unit, value)` | `INT64` | It extracts a UTC component of `value`. |
| `EXTRACT(unit FROM value)` | `INT64` | The SQL-standard form of `date_part(unit, value)`. The unit is a bare word or a string. |
| `date_trunc(unit, value)` | `DATETIME` | It truncates `value` to the start of the requested unit, in UTC. |
| `unix_timestamp()` | `INT64` | The start of the current transaction, in whole Unix seconds. |
| `unix_timestamp(value)` | `INT64` | It converts a `DATE`, a `DATETIME`, or a string of a date or a time to Unix timestamp seconds. |
| `unix_timestamp_ms()` | `INT64` | Milliseconds since the Unix epoch at the start of the transaction. |
| `unix_timestamp_ms(value)` | `INT64` | Converts a temporal value to Unix epoch milliseconds, rounded down. |
| `from_unixtime(seconds)` | `DATETIME` | It converts Unix timestamp seconds, including an exact `NUMERIC` fraction, to UTC and rounds to the nearest microsecond. |
| `make_date(year, month, day)` | `DATE` | Builds a date from integer parts. |
| `make_timestamp(year, month, day, hour, minute, second)` | `DATETIME` | Builds a UTC timestamp. `second` may have a fraction. |
| `makedate(year, day_of_year)` | `DATE` | Builds a date from a MySQL-style day of year. |
| `last_day(value)` | `DATE` | Returns the final day of the UTC month containing the value. |
| `to_char(temporal, pattern)` | `STRING` | Formats a temporal value with a PostgreSQL template pattern. |
| `to_timestamp(text, pattern)` | `DATETIME` | Parses text with a PostgreSQL template pattern. |
| `to_date(text, pattern)` | `DATE` | Parses text with a PostgreSQL template pattern. |
| `date_format(temporal, pattern)` | `STRING` | Formats a temporal value with MySQL `%` specifiers. |
| `str_to_date(text, pattern)` | `DATETIME` | Parses text with MySQL `%` specifiers. |

Pattern formatting and parsing are covered in
[Pattern formatting and parsing](#pattern-formatting-and-parsing).

## Which clock?

The clock functions follow PostgreSQL:

- `now()`, `current_timestamp()`, `transaction_timestamp()`, `current_date()`,
  `unix_timestamp()`, and `unix_timestamp_ms()` return the start of the
  transaction. Every row and every statement in one transaction sees the same
  value.
- `statement_timestamp()` returns the start of the statement. The next statement
  gets a new value.
- `clock_timestamp()` and `sysdate()` read the clock at each call, so two rows of
  one statement can get different values.

Use `now()` for a consistent time across a transaction. Use `clock_timestamp()`
to measure elapsed time inside one.

## MySQL shortcuts

Each shortcut takes one temporal value and returns one UTC part of it.

| Function | Returns | Description |
| --- | --- | --- |
| `year(x)`, `month(x)`, `day(x)`, `hour(x)`, `minute(x)`, `second(x)` | `INT64` | The same part as `date_part`. |
| `dayofmonth(x)` | `INT64` | An alias of `day(x)`. |
| `quarter(x)` | `INT64` | 1 to 4. |
| `dayofyear(x)` | `INT64` | 1 to 366. |
| `dayofweek(x)` | `INT64` | 1 = Sunday to 7 = Saturday. |
| `weekday(x)` | `INT64` | 0 = Monday to 6 = Sunday. |
| `dayname(x)` | `STRING` | The English day name, such as `Sunday`. |
| `monthname(x)` | `STRING` | The English month name, such as `June`. |
| `week(x[, mode])` | `INT64` | Mode 0, the default: weeks start on Sunday, and the days before the first Sunday are week 0 (0 to 53). Mode 3: the ISO-8601 week (1 to 53). Any other mode is an error. |

`dayofweek(x)` counts from 1, but `date_part('dow', x)` counts from 0. CamusDB
has no `DATE(x)` function, because `DATE` is a type keyword. Use
`CAST(x AS DATE)`.

```camussql
SELECT EXTRACT(year FROM '2024-06-16'), dayofweek('2024-06-16'), week('2024-01-07');
-- 2024, 1, 1
```

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

SELECT make_date(2024, 2, 29);
-- 2024-02-29

SELECT make_timestamp(2026, 1, 1, 0, 0, 0.123);
-- 2026-01-01T00:00:00.1230000Z

SELECT makedate(2024, 60), last_day("2024-02-10");
-- 2024-02-29, 2024-02-29

SELECT unix_timestamp_ms("2024-06-15T10:30:00Z");
-- 1718447400000
```

The date constructors return `NULL` when an argument is `NULL`. Invalid parts
raise `CADB0400 InvalidInput` with the invalid year, month, day, hour, minute, or
second named in the message. Years must be from 1 through 9999.

`make_timestamp` rounds fractional seconds to the nearest microsecond. A value
that rounds up to 60 seconds carries into the next minute. `makedate` permits a
day beyond the end of the named year and continues into the next year, while a
day below 1 is an error.

## The rules for a null and for an overflow

These functions return `NULL` when one argument is `NULL`: `date_add`,
`date_diff`, `date_part` (and `EXTRACT`), `date_trunc`, `unix_timestamp(value)`,
`from_unixtime(seconds)`, and the MySQL shortcuts.

`unix_timestamp()` takes no argument. It returns the start of the current
transaction as a Unix timestamp, in seconds.

Five conditions make the query fail:

- An invalid unit.
- An invalid string of a date.
- An ambiguous local timestamp.
- A Unix timestamp outside the supported range of a date and a time.
- An overflow of a date or a time.

## Pattern formatting and parsing

These functions format a `DATE` or `DATETIME` value as text with a pattern, and
read text back to a value with a pattern. CamusDB accepts two pattern languages:

- **PostgreSQL template patterns**, for example `'YYYY-MM-DD HH24:MI:SS'`.
- **MySQL `%` specifiers**, for example `'%Y-%m-%d %H:%i:%s'`.

Both languages compile to the same fields, so a field formats and parses the
same way in both.

| Function | Result | Pattern language |
|----------|--------|------------------|
| `to_char(temporal, pattern)` | `STRING` | PostgreSQL |
| `to_timestamp(text, pattern)` | `DATETIME` | PostgreSQL |
| `to_date(text, pattern)` | `DATE` | PostgreSQL |
| `date_format(temporal, pattern)` | `STRING` | MySQL |
| `str_to_date(text, pattern)` | `DATETIME` | MySQL |

Two one-argument forms keep their meaning:

- `to_date(x)` is the cast to `DATE`, the same as `CAST(x AS DATE)`.
- `to_timestamp(seconds)` is the PostgreSQL spelling of
  `from_unixtime(seconds)`.

A `temporal` argument is a `DATE`, a `DATETIME`, or an ISO-8601 string with an
explicit offset. This is the same rule as the other date functions. A `NULL`
argument gives `NULL`.

```camussql
SELECT to_char(created, 'FMDay, DD Mon YYYY HH12:MI AM') FROM events;
-- Sunday, 16 Jun 2024 10:30 AM

INSERT INTO imports (id, day) VALUES (1, to_date('03/15/2026', 'MM/DD/YYYY'));

SELECT date_format(created, '%W %M %e, %Y') FROM events;
-- Sunday June 16, 2024

SELECT * FROM events WHERE created >= str_to_date('June 17, 2024', '%M %e, %Y');
```

### Rules for all patterns

- **All values are UTC.** The time zone fields print `UTC` and `+00`.
- **Names are English only.** Month and day names do not change with the server
  culture, and there is no locale setting.
- **The functions are deterministic.** They are not volatile, so a `CHECK`
  constraint, a column `DEFAULT`, and a view body can use them.
- **The year range is 1-9999.** A value outside this range is an error. It does
  not wrap.
- **The fraction has six digits.** No field prints or reads the seventh fraction
  digit (100 ns) of a `DATETIME`. `to_char` drops that digit.
- **Each pattern compiles once.** The engine keeps the compiled form of each
  distinct pattern text in a small cache. A literal pattern does not compile
  again for each row.

### PostgreSQL template patterns

A keyword is case-sensitive, as in PostgreSQL. Each numeric field has an
upper-case and a lower-case spelling (`YYYY` and `yyyy`). Each name field has
three spellings, and the spelling sets the case of the printed name.

| Pattern | Format output | Notes |
|---------|---------------|-------|
| `YYYY` | year, 4 digits (`0099`, `2026`) | |
| `YYY`, `YY`, `Y` | last 3, 2 or 1 digits of the year | Parse: the nearest year to 2020 (see below) |
| `IYYY` | ISO-8601 year, 4 digits | |
| `MM` | month, `01`-`12` | |
| `Mon`, `MON`, `mon` | `Mar`, `MAR`, `mar` | |
| `Month`, `MONTH`, `month` | `March`, `MARCH`, `march`, padded with blanks to 9 characters | |
| `DD` | day of the month, `01`-`31` | |
| `DDD` | day of the year, `001`-`366` | |
| `D` | day of the week, `1` = Sunday ... `7` = Saturday | |
| `ID` | ISO day of the week, `1` = Monday ... `7` = Sunday | |
| `Dy`, `DY`, `dy` | `Sun`, `SUN`, `sun` | |
| `Day`, `DAY`, `day` | `Sunday`, `SUNDAY`, `sunday`, padded with blanks to 9 characters | |
| `WW` | week of the year, `01`-`53`; week 1 is January 1-7 | |
| `IW` | ISO-8601 week, `01`-`53` | |
| `Q` | quarter, `1`-`4` | |
| `HH`, `HH12` | hour, `01`-`12` | |
| `HH24` | hour, `00`-`23` | |
| `MI` | minute, `00`-`59` | |
| `SS` | second, `00`-`59` | |
| `MS` | fraction of the second in milliseconds, `000`-`999` | |
| `US` | fraction of the second in microseconds, `000000`-`999999` | |
| `AM`, `PM`, `am`, `pm` | `AM` or `PM` from the hour; the case follows the pattern | `AM` and `PM` are the same field |
| `TZ`, `tz` | `UTC`, `utc` | |
| `OF` | `+00` | |
| `FM` prefix | turns off the zero and blank padding of the next field only | `FMMM` prints `3`; `FMMonth` prints `March` |
| `"text"` | the text as written | Use `\"` for a double quote |

Any other character prints as written. Put letters in double quotes, because a
letter can start a keyword. For example, write
`'YYYY-MM-DD"T"HH24:MI:SS'` for the ISO-8601 form.

### MySQL specifiers

| Specifier | Format output | Notes |
|-----------|---------------|-------|
| `%Y` | year, 4 digits | |
| `%y` | year, 2 digits | Parse: 00-69 is 2000-2069, 70-99 is 1970-1999 |
| `%m` | month, `01`-`12` | |
| `%c` | month, `1`-`12` | |
| `%d` | day of the month, `01`-`31` | |
| `%e` | day of the month, `1`-`31` | |
| `%H` | hour, `00`-`23` | |
| `%h`, `%I` | hour, `01`-`12` | |
| `%i` | minute, `00`-`59` | |
| `%s`, `%S` | second, `00`-`59` | |
| `%f` | fraction of the second in microseconds, `000000`-`999999` | |
| `%p` | `AM` or `PM` | |
| `%M` | month name, `January`-`December` | |
| `%b` | month name, 3 letters, `Jan`-`Dec` | |
| `%W` | day name, `Sunday`-`Saturday` | |
| `%a` | day name, 3 letters, `Sun`-`Sat` | |
| `%j` | day of the year, `001`-`366` | |
| `%u` | week, `00`-`53`; weeks start on Monday, the MySQL `WEEK(x, 1)` rule | Days before week 1 are week 0 |
| `%v` | ISO-8601 week, `01`-`53`, the same as `WEEK(x, 3)` | |
| `%%` | `%` | |

Any other specifier is an error. MySQL prints the letter instead, which hides a
mistake in the pattern.

### How parsing works

`to_timestamp`, `to_date`, and `str_to_date` read the text strictly. Text that
does not match the pattern gives an `InvalidInput` error. The error message
quotes the text and the pattern, and it gives the reason. For example:

```text
Function 'to_date' could not parse '02/30/2026' with pattern 'MM/DD/YYYY': day 30 is out of range for February 2026, which has 28 days
```

These are the rules:

1. A numeric field reads from 1 digit up to its full width. Thus `3/5/2026`
   matches `MM/DD/YYYY`, and `20260315` matches `YYYYMMDD`.
2. A fraction field reads the digits after the decimal point. `MS` reads `5` as
   500 ms, and `US` or `%f` reads `5` as 500000 microseconds.
3. A name field matches English names without regard to case. `Mar`, `MAR`, and
   `mar` all match `Mon`.
4. A run of spaces in the pattern matches a run of one or more spaces in the
   text. Thus the blank padding that `Month` and `Day` print reads back.
5. Any other character in the pattern, and quoted text, must match the text
   exactly.
6. The whole text must match. An extra character after the end of the pattern is
   an error.
7. Each field must be in range. For example, `MM` is 1-12, `HH24` is 0-23, and
   `SS` is 0-59.
8. The pattern must have a year field. CamusDB cannot hold a date without a year.
9. A missing month or day is 1. A missing hour, minute, second, or fraction is 0.
10. Two fields that give the same value must agree. For example, `MM` and `Mon`
    must name the same month.

The date comes from one of these sources:

- the year, the month, and the day;
- the year and `DDD` or `%j` (day of the year), when the pattern has no month and
  no day;
- `IYYY`, `IW`, and `ID` (ISO year, ISO week, and ISO day). A missing `IW` is
  week 1, and a missing `ID` is Monday.

A pattern with `IYYY` must not also have a Gregorian date field (`YYYY`, `MM`,
`DD`, `DDD`).

Some fields only repeat what the date already tells. The parse checks these
fields against the result: `D`, `ID`, `Dy`, `Day`, `%W`, `%a`, `Q`, `WW`, `IW`,
`%u`, `%v`, and `DDD` / `%j` when the pattern also has a month or a day. A
mismatch is an error, because the text then names two different dates.

The clock fields follow these rules:

- With a 12-hour field (`HH`, `HH12`, `%h`, `%I`), `AM` / `PM` sets the half of
  the day. Without `AM` / `PM`, the hour is AM, so `12` is midnight.
- `AM` / `PM` without a 12-hour field is an error.
- When a pattern has both a 12-hour and a 24-hour field, they must give the same
  hour.
- When a pattern has both `MS` and `US`, they must agree. `to_char` prints `020`
  and `020000` for 20 ms, and that text reads back as 20 ms.
- `TZ` reads `UTC` and `OF` reads `+00`. Any other time zone is an error.

`to_date` reads and checks the time fields, then keeps the date only.

#### Two-digit and three-digit years

`YYY`, `YY`, and `Y` (and `%y`) give the nearest year to 2020, with the
PostgreSQL rule:

| Value read | Year |
|------------|------|
| 0-69 | 2000-2069 |
| 70-99 | 1970-1999 |
| 100-519 | 2100-2519 |
| 520-999 | 1520-1999 |

`YYYY` and `%Y` read the year as written. Thus `26` with `YYYY` is the year 26.

### Pattern result types

`str_to_date` always returns `DATETIME`. MySQL returns a `DATE` or a `DATETIME`,
and the pattern decides which one. The CamusDB result type comes from the
argument types only, not from the pattern text.

CamusDB does not compare a `DATE` with a `DATETIME`. To compare the result of
`str_to_date` with a `DATE` column, cast the result:

```camussql
SELECT *
FROM events
WHERE day = CAST(str_to_date('June 17, 2024', '%M %e, %Y') AS DATE);
```

You can also use `to_date(text, pattern)`, which returns `DATE`.

### Differences from PostgreSQL

- **Separators.** PostgreSQL lets any separator in the pattern match any
  separator in the text, and it skips extra spaces. CamusDB requires the same
  character. Only a run of spaces matches a run of spaces of a different
  length.
- **Quoted text.** PostgreSQL skips the same number of characters without a
  check. CamusDB requires the same text.
- **Extra text.** PostgreSQL ignores some characters after the end of the
  pattern. CamusDB gives an error.
- **Checked fields.** PostgreSQL ignores `D`, `Dy`, `Day`, and `Q` in a parse,
  and it uses `WW` to find a date. CamusDB checks each of these fields against
  the date. `WW` does not set the date.
- **No year.** PostgreSQL gives a date in the year 1 BC when the pattern has no
  year field. CamusDB gives an error, because it cannot hold that year.
- **`MS` and `US` together.** PostgreSQL adds the two values. CamusDB requires
  them to agree, so the text that `to_char` prints reads back.
- **`AM` / `PM` with `HH24`.** PostgreSQL ignores the meridian. CamusDB gives an
  error.
- **`TZ` and `OF` in a parse.** CamusDB reads only `UTC` and `+00`.
- **Empty pattern.** PostgreSQL `to_char(x, '')` gives `NULL`. CamusDB gives an
  empty string.
- **Not supported.** Number formatting (`to_char(123, '999')`), the `TH` suffix,
  `FX`, `TM`, `CC`, `J`, `RM`, `A.M.` / `P.M.`, `BC` / `AD`, `TZH` / `TZM`, and
  `SSSS`.

### Differences from MySQL

- **Unknown specifiers.** MySQL prints the letter. CamusDB gives an error.
- **Strict parse.** MySQL accepts some text that does not match the pattern, and
  it can give a zero date (`0000-00-00`). CamusDB gives an error for each
  mismatch, and it requires a year.
- **Checked fields.** MySQL does not check `%W`, `%a`, `%u`, and `%v` against a
  year-month-day date. CamusDB checks each of them against the date.
- **Result type.** `str_to_date` always returns `DATETIME`.
- **Names do not pad.** `%M` and `%W` print the name without blanks, as in MySQL.
- **Not supported.** `%D`, `%k`, `%l`, `%r`, `%T`, `%U`, `%V`, `%w`, `%X`, and
  `%x`.
