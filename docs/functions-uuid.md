---
sidebar_position: 4.7
---

# UUID functions

A UUID function generates a native `UUID` value for a `UUID` or `GUID` column.
Use them for identifiers that must be unique across nodes or across an
application's services.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO events (event_name)
VALUES ('robot-created');
```

Store UUIDs in a native `UUID` column rather than a `STRING` column. CamusDB
stores a UUID as a compact 128-bit value with a fixed-width, order-preserving
index encoding, so a `UUID` column uses less memory and disk than UUID text.

## The functions

| Function | Returns | Description |
| --- | --- | --- |
| `gen_uuid_v4()` | `UUID` | Generates a random version 4 UUID. |
| `gen_uuid_v7()` | `UUID` | Generates a version 7 UUID: a Unix-millisecond timestamp prefix followed by a random suffix. |

Both functions are volatile: each call can produce a different value, even two
calls in the same statement.

As a column default, CamusDB evaluates the function once per inserted row.

## Choosing a generator

A version 7 UUID starts with a time-ordered prefix, so new values land near each
other in an index. A version 4 UUID is fully random, so new values spread across
the whole index.

Use `gen_uuid_v7()` when insert locality matters and the insert rate is low.
Scans of recent rows then read one part of the index. With
[hash routing](/docs/concepts#hash-and-key-range-routing) (the default), the
whole table is on one [partition](/docs/concepts#partition), so key order causes
no hotspot.

Use `gen_uuid_v4()` for tables with a high insert rate when
[key-range sharding](/docs/key-range-sharding) is on. Time-ordered keys send
every insert to the index's last [range](/docs/concepts#ranges-and-spans) (a
contiguous slice of keys), and that range becomes a hotspot. Random keys spread
inserts across all ranges.

See [Best practices](/docs/best-practices#primary-keys) for choosing a primary
key.

```camussql
CREATE TABLE event_log (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO event_log (id, event_name)
VALUES (gen_uuid_v7(), 'robot-created');

INSERT INTO event_log (id, event_name)
VALUES (gen_uuid_v4(), 'external-import');
```

`DEFAULT (gen_uuid_v4())` is also valid on `UUID` and `GUID` columns. Use it
when you want random UUIDs instead of time-ordered ones:

```camussql
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  source_name STRING NOT NULL
);
```

## Literals and casts

A `UUID` column accepts a canonical UUID string with hyphens, or a 32-character
hexadecimal string without hyphens. CamusDB returns values in canonical form:
lowercase, with hyphens.

```camussql
CREATE TABLE integrations (
  id UUID PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);

INSERT INTO integrations (id, name)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'billing');

INSERT INTO integrations (id, name)
VALUES ('550e8400e29b41d4a716446655440000', 'warehouse');

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS UUID);
```

CamusDB accepts `GUID` as an alias for `UUID`, both in column definitions and in
casts:

```camussql
CREATE TABLE sessions (
  id GUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7())
);

SELECT CAST('550e8400-e29b-41d4-a716-446655440000' AS GUID);
```

## Filters and indexes

You can use a `UUID` column as a primary key, in unique and secondary indexes,
and in equality and range filters.

```camussql
CREATE INDEX events_id_idx ON events (id);

SELECT event_name
FROM events
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

SELECT id, event_name
FROM events
WHERE id >= '80000000-0000-0000-0000-000000000000';
```

When you compare a `UUID` column with a quoted UUID string, CamusDB coerces the
string to a UUID value before it evaluates the comparison and before it selects
an index. Malformed UUID text fails with `InvalidInput`.
