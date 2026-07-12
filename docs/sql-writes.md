---
sidebar_position: 2.3
---

# Writing Data

CamusDB supports `INSERT`, `UPDATE`, and `DELETE`.

## Inserts

Insert one or more rows:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), "C-3PO", 1977),
  (GEN_ID(), "T-800", 1984);
```

Use `DEFAULT` to apply a column default:

```camussql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "K-2SO", DEFAULT);
```

If a column has a generator default such as `DEFAULT (gen_id())`,
`DEFAULT (gen_uuid_v4())`, or `DEFAULT (gen_uuid_v7())`, omitting that column
or using `DEFAULT` evaluates the function for the inserted row.

See [Tables And Schema](/docs/sql-schema#column-defaults) for default rules.

Object id helpers are available as function calls:

```camussql
GEN_ID()
STR_ID("507f1f77bcf86cd799439011")
```

See [Object Id Functions](/docs/functions-object-id) for details.

## Updates

SQL updates require a `WHERE` clause:

```camussql
UPDATE robots
SET year = 1982
WHERE name = "T-800";
```

## Deletes

SQL deletes also require a `WHERE` clause:

```camussql
DELETE FROM robots
WHERE year < 1970;
```

## Transactions

When a write request does not include a transaction id, CamusDB starts and
commits a single-operation transaction automatically. For multi-statement work,
use [SQL Transactions](/docs/sql-transactions).
