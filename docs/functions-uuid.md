---
sidebar_position: 4.7
description: "Generate version 4 and version 7 UUIDs in CamusDB, store them in a native UUID column, and choose the generator that suits your insert pattern."
---

# UUID functions

A UUID function generates a native `UUID` value. Use a UUID for an identifier
that must be unique across nodes or across the services of an application.
No central counter is needed.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO events (event_name)
VALUES ('robot-created');
```

You should store UUIDs in a `UUID` column. A UUID is stored as a 128-bit value,
and its index encoding has the same sort order as the values. This means that a `UUID` column
uses less memory and disk than the same value as `STRING` text.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `gen_uuid_v4()` | `UUID` | A random version 4 UUID. |
| `gen_uuid_v7()` | `UUID` | A version 7 UUID: a Unix-millisecond timestamp prefix, followed by random bits. |

Each call returns a new value, also two calls in the same statement. As a
column default, the function is called once for each inserted row.

A `UUID` default must be a `UUID` column. On a `STRING` column, the default
returns `CADB0400`.

## Choose a generator

A version 7 UUID starts with the time. This means that new values are near each
other in an index. A version 4 UUID is random, and new values are spread over
the index. Note that values from the same millisecond aren't in insert order.

Use `gen_uuid_v7()` when insert locality matters and the insert rate is low.
Scans of recent rows then read one part of the index. With
[hash routing](/docs/concepts#hash-and-key-range-routing), the default, a table
is on one [partition](/docs/concepts#partition). Key order then doesn't create
a hotspot.

Use `gen_uuid_v4()` for tables with a high insert rate when
[key-range sharding](/docs/key-range-sharding) is on. With time-ordered keys,
all inserts go to the last [range](/docs/concepts#ranges-and-spans) of the
index, and that range becomes a hotspot. Random keys spread the inserts over
the ranges.

For more information about primary keys, see
[Best practices](/docs/best-practices#primary-keys).

```camussql
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  source_name STRING NOT NULL
);

INSERT INTO import_jobs (id, source_name)
VALUES (gen_uuid_v4(), 'external-import');
```

## Literals and casts

A `UUID` value can be written as one of the following strings:

- The canonical form with hyphens: `'550e8400-e29b-41d4-a716-446655440000'`.
- 32 hexadecimal digits: `'550e8400e29b41d4a716446655440000'`.

Uppercase digits and braces, as in `'{550E8400-E29B-41D4-A716-446655440000}'`,
are also read. `camus-cli` and the drivers show a value in the canonical form,
in lowercase. The HTTP API returns it as two 64-bit numbers. For more
information, see [HTTP API](/docs/http-api).

```camussql
CREATE TABLE integrations (
  id UUID PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);

INSERT INTO integrations (id, name)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'billing');

INSERT INTO integrations (id, name)
VALUES ('550e8400e29b41d4a716446655440001', 'warehouse');

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS UUID);
```

`GUID` is another name for `UUID`, in column definitions and in casts.
`SHOW CREATE TABLE` shows the column as `UUID`:

```camussql
CREATE TABLE sessions (
  id GUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7())
);

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS GUID);
```

Malformed text in an `INSERT` or a `CAST` returns `CADB0400 InvalidInput`.

## Filters and indexes

You can use a `UUID` column as a primary key, in unique and secondary indexes,
and in equality and range filters:

```camussql
SELECT name
FROM integrations
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

SELECT id, name
FROM integrations
WHERE id >= '550e8400-e29b-41d4-a716-446655440001';
```

When you compare a `UUID` column with a quoted string, the string is converted
to a `UUID` before the comparison and before an index is chosen. This means that
the first query above uses a primary key lookup.

Note that malformed text in a filter isn't an error. It equals no `UUID` value.
For example, `WHERE id = 'not-a-uuid'` returns no rows. Check the format of IDs
that come from user input.
