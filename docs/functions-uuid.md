---
sidebar_position: 4.7
---

# UUID functions

A UUID function generates a native `UUID` value. Use one with a `UUID` column,
or with a `GUID` column. These functions suit an identifier that must be unique
across the nodes, or across the services of an application.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO events (event_name)
VALUES ("robot-created");
```

Prefer a native `UUID` column to a `STRING` column for a UUID value. CamusDB
stores a UUID as a compact 128-bit value. It uses an index encoding of a fixed
width that preserves the order. A `UUID` column therefore uses less memory and
less disk than a UUID in text.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `gen_uuid_v4()` | `UUID` | It generates a random UUID of version 4. |
| `gen_uuid_v7()` | `UUID` | It generates a UUID of version 7. That UUID has a prefix of the time in Unix milliseconds, and a random suffix. |

Both functions are volatile. Each call can produce a different value. Two calls
inside one statement can also produce two different values.

As the default of a column, CamusDB evaluates the function one time for each
inserted row.

## Select a generator

Use `gen_uuid_v7()` for a primary key, and for an indexed identifier, when the
locality of the inserts matters. A UUID of version 7 holds a prefix in the order
of the time. A new value is therefore better than a fully random UUID, both for
the routing of a range and for a scan of an index.

Use `gen_uuid_v4()` when you specifically want a random UUID. Use it when the
order of the inserts in the primary key, and in a secondary index, does not
matter to you.

```camussql
CREATE TABLE event_log (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO event_log (id, event_name)
VALUES (gen_uuid_v7(), "robot-created");

INSERT INTO event_log (id, event_name)
VALUES (gen_uuid_v4(), "external-import");
```

`DEFAULT (gen_uuid_v4())` is also valid on a `UUID` column and on a `GUID`
column. Use it when you want a random UUID instead of a UUID in the order of the
time:

```camussql
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  source_name STRING NOT NULL
);
```

## Support for a literal and for a cast

A `UUID` column accepts a canonical UUID string, with hyphens. It also accepts a
hexadecimal string of 32 characters, without a hyphen. CamusDB returns a value
in the canonical form: lowercase, and with hyphens.

```camussql
CREATE TABLE integrations (
  id UUID PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);

INSERT INTO integrations (id, name)
VALUES ("550e8400-e29b-41d4-a716-446655440000", "billing");

INSERT INTO integrations (id, name)
VALUES ("550e8400e29b41d4a716446655440000", "warehouse");

SELECT CAST("550e8400-e29b-41d4-a716-446655440000" AS UUID);
```

CamusDB accepts `GUID` as an alias of `UUID`. That rule covers the definition of
a column, and a cast:

```camussql
CREATE TABLE sessions (
  id GUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7())
);

SELECT CAST("550e8400-e29b-41d4-a716-446655440000" AS GUID);
```

## A filter, and an index

You can use a `UUID` column in five places: a primary key, a unique index, a
secondary index, a filter of an equality, and a filter of a range.

```camussql
CREATE INDEX events_id_idx ON events (id);

SELECT event_name
FROM events
WHERE id = "550e8400-e29b-41d4-a716-446655440000";

SELECT id, event_name
FROM events
WHERE id >= "80000000-0000-0000-0000-000000000000";
```

A comparison can put a quoted UUID string against a `UUID` column. CamusDB then
coerces the string to a UUID value first. It does that before it evaluates the
comparison, and before it selects an index. Text of a UUID with a wrong form
fails with `InvalidInput`.
