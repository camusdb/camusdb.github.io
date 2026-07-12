---
sidebar_position: 4.6
---

# Object Id Functions

Object id functions create and convert CamusDB `OID` values. They are useful in
primary keys, inserts, filters, and parameterized queries.

| Function | Returns | Description |
| --- | --- | --- |
| `gen_id()` | `OID` | Generates a new object id. This function is volatile. |
| `to_id(value)` | `OID` | Converts an `OID` or 24-character lowercase hex string to an object id. |
| `str_id(value)` | `OID` | Alias for `to_id(value)`. |

## Examples

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL
);

INSERT INTO robots (name)
VALUES ("R2-D2");

INSERT INTO robots (id, name)
VALUES (gen_id(), "BB-8");

SELECT id, name
FROM robots
WHERE id = str_id("507f1f77bcf86cd799439011");

SELECT to_id(@id)
FROM robots
LIMIT 1;
```

`gen_id()` returns a 24-character object id string. When used as
`DEFAULT (gen_id())` on an `OID` column, CamusDB evaluates it once per inserted
row, so omitted ids and `DEFAULT` values get distinct ObjectIds.

`to_id` and `str_id` accept existing `OID` values and strings that are exactly
24 lowercase hexadecimal characters.

For the full conversion rules, see [Conversion Functions](/docs/functions-conversion).
