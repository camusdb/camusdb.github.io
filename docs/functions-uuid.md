---
sidebar_position: 4.7
---

# UUID Functions

UUID functions generate native `UUID` values. Use them with `UUID` or `GUID`
columns, especially for identifiers that need to be unique across nodes or
application services.

```camussql
CREATE TABLE events (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7()),
  event_name STRING NOT NULL
);

INSERT INTO events (event_name)
VALUES ("robot-created");
```

Prefer native `UUID` columns over `STRING` columns for UUID values. CamusDB
stores UUIDs as compact 128-bit values and uses fixed-width order-preserving
index encoding, so UUID columns use less memory and disk than UUIDs stored as
text.

## Functions

| Function | Returns | Description |
| --- | --- | --- |
| `gen_uuid_v4()` | `UUID` | Generates a random version 4 UUID. |
| `gen_uuid_v7()` | `UUID` | Generates a version 7 UUID with a Unix-millisecond time prefix and random suffix. |

Both functions are volatile. Each call can produce a different value, including
multiple calls within the same statement. When used as a column default,
CamusDB evaluates the function once per inserted row.

## Choosing A Generator

Use `gen_uuid_v7()` for primary keys and indexed identifiers when insert
locality matters. Version 7 UUIDs include a time-ordered prefix, which makes
new values friendlier to range routing and index scans than fully random UUIDs.

Use `gen_uuid_v4()` when you specifically want a random UUID and do not care
about insertion order in the primary key or secondary index.

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

`DEFAULT (gen_uuid_v4())` is also valid on `UUID` or `GUID` columns when you
want random UUIDs instead of time-ordered UUIDs:

```camussql
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v4()),
  source_name STRING NOT NULL
);
```

## Literal And Cast Support

UUID columns accept canonical hyphenated UUID strings and 32-character
unhyphenated hexadecimal strings. Values are returned in canonical lowercase
hyphenated form.

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

`GUID` is accepted as an alias for `UUID` in column definitions and casts:

```camussql
CREATE TABLE sessions (
  id GUID PRIMARY KEY NOT NULL DEFAULT (gen_uuid_v7())
);

SELECT CAST("550e8400-e29b-41d4-a716-446655440000" AS GUID);
```

## Filtering And Indexes

UUID columns can be used in primary keys, unique indexes, secondary indexes,
equality filters, and range filters.

```camussql
CREATE INDEX events_id_idx ON events (id);

SELECT event_name
FROM events
WHERE id = "550e8400-e29b-41d4-a716-446655440000";

SELECT id, event_name
FROM events
WHERE id >= "80000000-0000-0000-0000-000000000000";
```

When a quoted UUID string is compared to a UUID column, CamusDB coerces the
string to a UUID value before evaluating the comparison or selecting an index.
Malformed UUID text fails with `InvalidInput`.
