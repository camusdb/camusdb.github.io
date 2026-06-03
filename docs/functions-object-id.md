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

```sql
INSERT INTO robots (id, name, year)
VALUES (gen_id(), "R2-D2", 1977);

SELECT id, name
FROM robots
WHERE id = str_id("507f1f77bcf86cd799439011");

SELECT to_id(@id)
FROM robots
LIMIT 1;
```

`gen_id()` returns a 24-character object id string. `to_id` and `str_id` accept
existing `OID` values and strings that are exactly 24 lowercase hexadecimal
characters.

For the full conversion rules, see [Conversion Functions](/docs/functions-conversion).
