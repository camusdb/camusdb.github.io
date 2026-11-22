---
sidebar_position: 4.3
---

# Date/time functions

Date and time functions answer time questions in SQL, for example the orders of
this month or the days until a subscription expires. The clock functions, such
as `now()`, follow PostgreSQL. CamusDB also has the PostgreSQL and MySQL formatting
functions. It also has MySQL shortcuts, such as `year`. This means that
queries that you port need fewer changes.

The functions take `DATE` and `DATETIME` values, and two string forms:

- A date, such as `2024-06-15`.
- A timestamp with a UTC marker or an offset, such as `2024-06-15T10:30:00Z` or
  `2024-06-15T10:30:00+05:00`.

A timestamp string that doesn't have an offset, such as `2024-06-15 10:30:00`,
returns `CADB0400`. Its time zone is ambiguous. You can also write
[typed literals](/docs/data-types#typed-datetime-literals), such as
`DATE '2024-06-15'`.

## Units

| Units | Where |
| --- | --- |
| `year`, `quarter`, `month`, `week`, `day`, `hour`, `minute`, `second` | All functions that take a unit. |
| `millisecond`, `microsecond` (or `us`), `decade`, `century`, `millennium` | All functions that take a unit. |
| `dow` (0 = Sunday), `isodow` (1 = Monday to 7 = Sunday), `doy` (day of the year), `isoyear`, `epoch` (Unix seconds) | `date_part` and `EXTRACT` only. |

Plural names, such as `days` and `millennia`, also work. As a part, `week` is the
ISO 8601 week. `millisecond` and `microsecond` are the fraction of the second
(0 to 999, and 0 to 999999).

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `current_timestamp()` | `DATETIME` | The start of the current transaction, in UTC. |
| `now()`, `transaction_timestamp()` | `DATETIME` | Aliases for `current_timestamp()`. |
| `current_date()` | `DATE` | The UTC date at the start of the current transaction. |
| `statement_timestamp()` | `DATETIME` | The start of the current statement, in UTC. |
| `clock_timestamp()` | `DATETIME` | The current instant in UTC, read at each call. |
| `sysdate()` | `DATETIME` | An alias for `clock_timestamp()`. |
| `date_add(value, amount, unit)` | `DATETIME` | Adds an `INT64` amount of the unit. A `DATE` becomes a `DATETIME`. |
| `date_add(value, interval)`, `date_sub(value, interval)` | `DATETIME` | Adds or subtracts an interval, with calendar months. |
| `date_diff(start, end, unit)` | `INT64` | The difference from `start` to `end`, as a count of units. |
| `date_part(unit, value [, zone])` | `INT64` | A part of a temporal value in UTC or the supplied zone, or a field of an interval. |
| `EXTRACT(unit FROM value)` | `INT64` | The SQL-standard form of `date_part`. The unit is a word or a string. |
| `date_trunc(unit, value [, zone])` | `DATETIME` | The UTC instant at the start of the unit in UTC or the supplied zone. |
| `unix_timestamp([value])` | `INT64` | Unix seconds of `value`, or of the start of the transaction. |
| `unix_timestamp_ms([value])` | `INT64` | As `unix_timestamp`, in milliseconds. A fraction is rounded down. |
| `from_unixtime(seconds)` | `DATETIME` | Unix seconds to UTC, rounded to the microsecond. A `NUMERIC` fraction is exact. |
| `make_date(year, month, day)` | `DATE` | A date from integer parts. |
| `make_timestamp(year, month, day, hour, minute, second)` | `DATETIME` | A UTC timestamp. `second` can have a fraction. |
| `makedate(year, day_of_year)` | `DATE` | A date from a MySQL-style day of the year. |
| `last_day(value)` | `DATE` | The last day of the UTC month of `value`. |
| `to_char`, `to_timestamp`, `to_date`, `date_format`, `str_to_date` | | See [Pattern formatting and parsing](#pattern-formatting-and-parsing). |

## Time zones

Use a time zone to group orders by local business day or show an event in a
user's local time. `date_trunc`, `date_part`, and `to_char` accept an optional
last argument and use UTC by default.

```camussql
SELECT date_trunc('day', created, 'America/Bogota') AS local_day, count(*)
FROM orders
GROUP BY date_trunc('day', created, 'America/Bogota');

SELECT to_char('2026-11-01T06:30:00Z', 'YYYY-MM-DD HH24:MI TZ OF', 'America/New_York');
-- 2026-11-01 01:30 EST -05
```

Use a case-insensitive IANA name or alias such as `America/New_York` or
`US/Eastern`. Unknown names and numeric offsets such as `'+05:30'` return
`CADB0400`. A NULL zone returns NULL.

`date_trunc` returns the UTC instant that begins the local unit. During a
spring-forward gap, a unit whose start was skipped begins at the transition.
During a fall-back overlap, a day or larger unit starts at the first
occurrence of its boundary. A shorter unit truncates within the occurrence
that contains the input, using the transition if the clock skipped its start.

`date_part` returns the requested part of the local time. The `epoch` part
is independent of the zone. An interval argument uses the two-argument form.
A `DATE` input represents midnight UTC before conversion to the local time.

Zone rules ship with the server and can change between releases. During a
rolling upgrade, the coordinator evaluates fragments that use a zone when
their target node has a different version of the zone data. An
[expression index](/docs/sql-indexes#expression-indexes) cannot use these
three-argument forms.

## Transaction, statement, and clock time

The clock functions follow PostgreSQL:

- `now()` and the other transaction-time functions return the start of the
  transaction. All rows and statements of a transaction get the same value. The
  `unix_timestamp` functions use this time when you don't pass a value.
- `statement_timestamp()` returns the start of the statement. Each statement
  gets a new value.
- `clock_timestamp()` and `sysdate()` read the clock at each call. Two rows of
  one statement can get different values.

Use `now()` for one time across a transaction. To measure elapsed time in a
transaction, use `clock_timestamp()`.

## MySQL shortcuts

Each shortcut takes a temporal value and returns one of its UTC parts:

| Function | Returns | Description |
| --- | --- | --- |
| `year(x)`, `month(x)`, `day(x)` | `INT64` | The same part as `date_part`. `dayofmonth(x)` is an alias for `day(x)`. |
| `hour(x)`, `minute(x)`, `second(x)` | `INT64` | The same part as `date_part`. |
| `quarter(x)` | `INT64` | 1 to 4. |
| `dayofyear(x)` | `INT64` | 1 to 366. |
| `dayofweek(x)` | `INT64` | 1 = Sunday to 7 = Saturday. |
| `weekday(x)` | `INT64` | 0 = Monday to 6 = Sunday. |
| `dayname(x)` | `STRING` | The English day name, such as `Sunday`. |
| `monthname(x)` | `STRING` | The English month name, such as `June`. |
| `week(x[, mode])` | `INT64` | Mode 0 (default): weeks start on Sunday, and the days before the first Sunday are week 0. Mode 3: the ISO 8601 week. Other modes return `CADB0400`. |

`dayofweek(x)` counts from 1, and `date_part('dow', x)` counts from 0. `DATE` is
a type keyword, and there is no `DATE(x)` function. Use `CAST(x AS DATE)`.

```camussql
SELECT EXTRACT(year FROM '2024-06-16'), dayofweek('2024-06-16'), week('2024-01-07');
-- 2024, 1, 1
```

## Typed results

You can insert the result of a temporal function into a temporal column, or
compare it with one, and you don't need a cast:

```camussql
INSERT INTO events (id, happened_at)
VALUES (GEN_ID(), now());

SELECT *
FROM events
WHERE happened_at < current_timestamp();

SELECT date_add(happened_at, 7, 'days')
FROM events;
```

`date_add` returns a `DATETIME`. This means that a day added to a `DATE` gives a
datetime at UTC midnight. A `DATE` and a `DATETIME` can be compared.

## Examples

```camussql
SELECT current_timestamp(), now(), current_date();

SELECT date_add('2024-06-15', 1, 'day');
-- 2024-06-16T00:00:00.0000000Z

SELECT date_add('2024-06-15T10:30:00Z', 2, 'hours');
-- 2024-06-15T12:30:00.0000000Z

SELECT date_diff('2024-06-01', '2024-06-11', 'days');
-- 10

SELECT date_part('hour', '2024-06-15T10:30:00+05:00');
-- 5

SELECT date_trunc('month', '2024-06-15T10:30:45.123Z');
-- 2024-06-01T00:00:00.0000000Z

SELECT unix_timestamp('2024-06-15T10:30:00Z');
-- 1718447400

SELECT unix_timestamp('2024-06-15');
-- 1718409600

SELECT from_unixtime(1718447400);
-- 2024-06-15T10:30:00.0000000Z

SELECT make_date(2024, 2, 29);
-- 2024-02-29

SELECT make_timestamp(2026, 1, 1, 0, 0, 0.123);
-- 2026-01-01T00:00:00.1230000Z

SELECT makedate(2024, 60), last_day('2024-02-10');
-- 2024-02-29, 2024-02-29

SELECT unix_timestamp_ms('2024-06-15T10:30:00Z');
-- 1718447400000
```

The date constructors return `NULL` if an argument is `NULL`. An invalid part
returns `CADB0400`, and the message names the part. Years must be from 1 to
9999.

`make_timestamp` rounds a fractional second to the microsecond. A value that
rounds up to 60 seconds goes to the next minute. A `makedate` day after the end
of the year continues into the next year. A day below 1 returns `CADB0400`.

## Interval functions

Use [intervals](/docs/data-types#intervals) to compute calendar ages or to
group timestamps into buckets:

| Function | Returns | Behavior |
| --- | --- | --- |
| `age(a, b)` | `INTERVAL` | The calendar difference `a - b`, with calendar parts and time. |
| `age(a)` | `INTERVAL` | The same as `age(current_date(), a)`, with the UTC date of the transaction at midnight. |
| `make_interval(years, months, weeks, days, hours, mins, secs)` | `INTERVAL` | An interval from positional parts. Trailing parts that you omit are zero. |
| `justify_days(i)` | `INTERVAL` | Converts each 30 days to a month, and aligns the signs of months and days. |
| `justify_hours(i)` | `INTERVAL` | Converts each 24 hours to a day, and aligns the signs of days and time. |
| `justify_interval(i)` | `INTERVAL` | Applies both conversions. |
| `date_bin(stride, source, origin)` | `DATETIME` | The start of the bucket that has `source`, aligned to `origin`. |

```camussql
SELECT age(DATE '2001-04-10', DATE '1957-06-13');
-- P43Y9M27D

SELECT make_interval(0, 0, 0, 1, 2);
-- P1DT2H

SELECT justify_interval(INTERVAL '1 month -1 hour');
-- P29DT23H

SELECT date_bin(INTERVAL '15 minutes',
  TIMESTAMP '2024-06-15T15:44:17Z',
  TIMESTAMP '2024-06-15T00:00:00Z');
-- 2024-06-15T15:30:00Z

SELECT DATE_ADD(DATE '2024-01-31', INTERVAL 1 MONTH);
-- 2024-02-29T00:00:00Z
```

`age` borrows days with the month length of the earlier date, as in PostgreSQL.
Both forms of `age` are volatile in CamusDB. A `CHECK` constraint can't use
them, and a query that calls them doesn't use the result cache. In PostgreSQL,
the two-argument form is immutable.

`make_interval` takes up to seven positional arguments. Named arguments aren't
supported. All the parts except seconds must be `INT64`. Seconds can have a
fraction, which is rounded to the microsecond. A part out of range returns
`CADB0400`.

`date_bin` needs a positive stride that doesn't use months, and an explicit
origin. A
value before the origin goes to the bucket before it. A `NULL` argument of an
interval function returns `NULL`.

### Extracting interval fields

`EXTRACT` and `date_part` read the parts of an interval, and they don't
normalize them:

```camussql
SELECT EXTRACT(hour FROM INTERVAL '36 hours'),
       date_part('day', INTERVAL '36 hours');
-- 36, 0
```

The year is the total months divided by 12, and the month is the remainder. Each
field has the sign of its part. The results are `INT64`, and PostgreSQL returns
a fractional `NUMERIC`. Seconds are integers, and milliseconds and microseconds are the fraction of
the second. For an interval, `epoch` returns seconds, rounded down, with 365.25 days for each year and 30 days for each
remaining month.

The calendar positions, such as `dow`, can't be extracted from an interval. They return `CADB0400`.

## NULLs and errors

The functions return `NULL` if an argument is `NULL`. This also applies to
`EXTRACT` and the MySQL shortcuts.

The following conditions return `CADB0400`:

- An invalid unit.
- An invalid date string, or a timestamp that doesn't have an offset.
- A Unix timestamp outside the supported range.
- A date or time overflow.

## Pattern formatting and parsing

These functions format a `DATE` or `DATETIME` as text with a pattern, or parse
text into a value. There are two pattern languages:

- **PostgreSQL template patterns**, for example `'YYYY-MM-DD HH24:MI:SS'`.
- **MySQL `%` specifiers**, for example `'%Y-%m-%d %H:%i:%s'`.

Both languages compile to the same fields. This means that a field formats and
parses in the same way in both.

| Function | Result | Pattern language |
|----------|--------|------------------|
| `to_char(temporal, pattern [, zone])` | `STRING` | PostgreSQL |
| `to_timestamp(text, pattern)` | `DATETIME` | PostgreSQL |
| `to_date(text, pattern)` | `DATE` | PostgreSQL |
| `date_format(temporal, pattern)` | `STRING` | MySQL |
| `str_to_date(text, pattern)` | `DATETIME` | MySQL |

Two one-argument forms have a different meaning:

- `to_date(x)` is the cast to `DATE`, the same as `CAST(x AS DATE)`.
- `to_timestamp(seconds)` is the PostgreSQL name of `from_unixtime(seconds)`.

A `temporal` argument follows the input rules at the start of this page. A
`NULL` argument returns `NULL`.

```camussql
SELECT to_char(created, 'FMDay, DD Mon YYYY HH12:MI AM') FROM events;
-- Sunday, 16 Jun 2024 10:30 AM

INSERT INTO imports (id, day) VALUES (1, to_date('03/15/2026', 'MM/DD/YYYY'));

SELECT date_format(created, '%W %M %e, %Y') FROM events;
-- Sunday June 16, 2024

SELECT * FROM events WHERE created >= str_to_date('June 17, 2024', '%M %e, %Y');
```

### Rules for all patterns

- **UTC is the default.** Pass a [time zone](#time-zones) to `to_char` to format the local time.
- **Names are English.** Month and day names don't change with the server
  culture, and there is no locale setting.
- **The functions are deterministic.** Stored definitions can
  use them, such as a `CHECK` constraint or a view body.
- **The year range is 1 to 9999.** A value outside this range returns an error.
- **The fraction has six digits.** No field prints or reads the seventh digit
  (100 ns) of a `DATETIME`.
- **Each pattern compiles once.** The compiled form of each pattern
  text is cached. This means that a literal pattern isn't compiled again for each
  row.

### PostgreSQL template patterns

Keywords are case-sensitive, as in PostgreSQL. A numeric field has an upper-case
and a lower-case spelling, such as `YYYY` and `yyyy`. A name field has three
spellings, and the spelling sets the case of the printed name.

| Pattern | Format output | Notes |
|---------|---------------|-------|
| `YYYY` | The year, 4 digits (`0099`, `2026`). | |
| `YYY`, `YY`, `Y` | The last 3, 2, or 1 digits of the year. | Parse: the nearest year to 2020 (see below). |
| `IYYY` | The ISO 8601 year, 4 digits. | |
| `MM` | The month, `01`-`12`. | |
| `Mon`, `MON`, `mon` | `Mar`, `MAR`, `mar`. | |
| `Month`, `MONTH`, `month` | `March`, `MARCH`, `march`, padded with blanks to 9 characters. | |
| `DD` | The day of the month, `01`-`31`. | |
| `DDD` | The day of the year, `001`-`366`. | |
| `D` | The day of the week, `1` = Sunday to `7` = Saturday. | |
| `ID` | The ISO day of the week, `1` = Monday to `7` = Sunday. | |
| `Dy`, `DY`, `dy` | `Sun`, `SUN`, `sun`. | |
| `Day`, `DAY`, `day` | `Sunday`, `SUNDAY`, `sunday`, padded with blanks to 9 characters. | |
| `WW` | The week of the year, `01`-`53`. Week 1 is January 1-7. | |
| `IW` | The ISO 8601 week, `01`-`53`. | |
| `Q` | The quarter, `1`-`4`. | |
| `HH`, `HH12` | The hour, `01`-`12`. | |
| `HH24` | The hour, `00`-`23`. | |
| `MI` | The minute, `00`-`59`. | |
| `SS` | The second, `00`-`59`. | |
| `MS` | The fraction of the second in milliseconds, `000`-`999`. | |
| `US` | The fraction of the second in microseconds, `000000`-`999999`. | |
| `AM`, `PM`, `am`, `pm` | `AM` or `PM` from the hour. The case follows the pattern. | `AM` and `PM` are the same field. |
| `TZ`, `tz` | The abbreviation at the input instant, such as `EST` or `est`. | The default is `UTC` or `utc`. |
| `OF` | The offset at the input instant, such as `-05` or `+05:30`. | The default is `+00`. `FMOF` removes hour padding, as in `+5:30`. |
| `FM` prefix | Turns off the padding of the next field. | `FMMM` prints `3`, and `FMMonth` prints `March`. |
| `"text"` | The text as written. | Use `\"` for a double quote. |

Other characters print as written. Put letters in double quotes. A letter can start a keyword. For example, write `'YYYY-MM-DD"T"HH24:MI:SS'` for
the ISO 8601 form.

### MySQL specifiers

| Specifier | Format output | Notes |
|-----------|---------------|-------|
| `%Y` | The year, 4 digits. | |
| `%y` | The year, 2 digits. | Parse: 00-69 is 2000-2069, and 70-99 is 1970-1999. |
| `%m` | The month, `01`-`12`. | |
| `%c` | The month, `1`-`12`. | |
| `%d` | The day of the month, `01`-`31`. | |
| `%e` | The day of the month, `1`-`31`. | |
| `%H` | The hour, `00`-`23`. | |
| `%h`, `%I` | The hour, `01`-`12`. | |
| `%i` | The minute, `00`-`59`. | |
| `%s`, `%S` | The second, `00`-`59`. | |
| `%f` | The fraction of the second in microseconds, `000000`-`999999`. | |
| `%p` | `AM` or `PM`. | |
| `%M` | The month name, `January`-`December`. | |
| `%b` | The month name, 3 letters, `Jan`-`Dec`. | |
| `%W` | The day name, `Sunday`-`Saturday`. | |
| `%a` | The day name, 3 letters, `Sun`-`Sat`. | |
| `%j` | The day of the year, `001`-`366`. | |
| `%u` | The week, `00`-`53`. Weeks start on Monday, as in MySQL `WEEK(x, 1)`. | The days before week 1 are week 0. |
| `%v` | The ISO 8601 week, `01`-`53`, as in `WEEK(x, 3)`. | |
| `%%` | `%`. | |

Another specifier returns `CADB0400`. MySQL prints the letter, which hides
mistakes in the pattern.

### How parsing works

The parse functions are strict. Text that doesn't
match the pattern returns `CADB0400`. The message quotes the text and the
pattern, and it gives the reason:

```text
Function 'to_date' could not parse '02/30/2026' with pattern 'MM/DD/YYYY': day 30 is out of range for February 2026, which has 28 days
```

The parser follows these rules:

1. A numeric field reads from 1 digit up to its full width. For example, `3/5/2026` matches `MM/DD/YYYY`.
   `20260315` matches `YYYYMMDD`.
2. A fraction field reads the digits after the decimal point. `MS` reads `5` as
   500 ms. `US` and `%f` read `5` as 500000 microseconds.
3. A name field matches English names in any case. For example, `MAR` matches
   `Mon`.
4. A run of spaces in the pattern matches one or more spaces in the text. This
   means that the padding that `Month` and `Day` print reads back.
5. Other pattern characters, and quoted text, must match exactly.
6. The full text must match. Extra characters after the pattern return an error.
7. Each field must be in range. For example, `MM` must be 1-12.
8. The pattern must have a year field. Each date needs a year.
9. A missing month or day is 1. A missing time field is 0.
10. Two fields that give the same value must agree. For example, `MM` and `Mon`
    must name the same month.

The date comes from one of these sources:

- The year, the month, and the day.
- The year and `DDD` or `%j` (the day of the year), if the pattern doesn't have
  a month or a day.
- `IYYY`, `IW`, and `ID` (the ISO year, week, and day). A missing `IW` is week
  1, and a missing `ID` is Monday.

A pattern with `IYYY` can't also have a Gregorian date field, such as `YYYY`.

Some fields repeat what the date says, for example `Day` or `%W`. The parser checks these fields against the date. A day of the year (`DDD`
or `%j`) is also checked, if the pattern has a month or a day. A mismatch returns an error. The text names two different
dates.

The clock fields follow these rules:

- With a 12-hour field (`HH`, `HH12`, `%h`, `%I`), `AM` or `PM` sets the half of
  the day. If there is no `AM` or `PM` field, the hour is AM. Then `12` means
  midnight.
- An `AM` or `PM` field needs a 12-hour field. Otherwise, it returns an error.
- A 12-hour and a 24-hour field in one pattern must give the same hour.
- `MS` and `US` in one pattern must agree. `to_char` prints `020` and `020000`
  for 20 ms, and that text reads back as 20 ms.
- `TZ` reads `UTC`, and `OF` reads `+00`. Another time zone returns an error.

`to_date` reads and checks the time fields, and then it returns the date only.

#### Two-digit and three-digit years

The short year fields, such as `YY` and `%y`, give the nearest year to 2020, as
in PostgreSQL:

| Value read | Year |
|------------|------|
| 0-69 | 2000-2069 |
| 70-99 | 1970-1999 |
| 100-519 | 2100-2519 |
| 520-999 | 1520-1999 |

`YYYY` and `%Y` read the year as written. For example, `26` with `YYYY` is the
year 26.

### Pattern result types

`str_to_date` returns `DATETIME`. In MySQL, the pattern decides whether it
returns `DATE` or `DATETIME`. In CamusDB, the result type comes from the
argument types. For a `DATE`, use `to_date(text, pattern)`.

### Differences from PostgreSQL

- **Separators.** PostgreSQL lets any separator in the pattern match any
  separator in the text, and it skips extra spaces. CamusDB requires the same
  character. A run of spaces can match a run of a different length.
- **Quoted text.** PostgreSQL skips the same number of characters, and it
  doesn't check them. CamusDB requires the same text.
- **Extra text.** PostgreSQL ignores some characters after the end of the
  pattern. CamusDB returns an error.
- **Checked fields.** PostgreSQL ignores the day-of-week fields and `Q` when it
  parses, and it uses `WW` to find a date. CamusDB checks these fields against
  the date, and `WW` doesn't set the date.
- **No year.** PostgreSQL gives a date in the year 1 BC if the pattern doesn't
  have a year field. CamusDB returns an error. It can't store that year.
- **`MS` and `US` together.** PostgreSQL adds the two values. CamusDB requires
  them to agree. This means that the text that `to_char` prints reads back.
- **`AM` or `PM` with `HH24`.** PostgreSQL ignores the meridian. CamusDB returns
  an error.
- **`TZ` and `OF` in a parse.** CamusDB reads UTC markers. Use `UTC` for `TZ`, `+00` for `OF`, or `+0` for `FMOF`.
- **Empty pattern.** PostgreSQL `to_char(x, '')` returns `NULL`. CamusDB returns
  an empty string.
- **Not supported.** Number formatting, such as `to_char(123, '999')`. These template keywords aren't supported either:
  `TH FX TM CC J RM A.M. P.M. BC AD TZH TZM SSSS`.

### Differences from MySQL

- **Unknown specifiers.** MySQL prints the letter. CamusDB returns an error.
- **Strict parse.** MySQL allows some text that doesn't match the pattern, and
  it can give a zero date (`0000-00-00`). CamusDB returns an error for each
  mismatch, and it requires a year.
- **Checked fields.** MySQL doesn't check the day-name and week fields, such as
  `%W`, against a year-month-day date. CamusDB checks them.
- **Result type.** `str_to_date` returns `DATETIME`.
- **Names aren't padded.** `%M` and `%W` don't pad the name, as in MySQL.
- **Not supported.** These specifiers aren't supported:
  `%D %k %l %r %T %U %V %w %X %x`.
