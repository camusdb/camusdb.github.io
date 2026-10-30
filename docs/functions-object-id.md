---
sidebar_position: 4.6
---

# Object ID functions

Object id functions create or convert CamusDB `OID` values. Use them in primary
keys, inserts, filters, and parameterized queries.

| Function | Returns | Description |
| --- | --- | --- |
| `gen_id()` | `OID` | Generates a new object id. The function is volatile. |
| `to_id(value)` | `OID` | Converts an `OID`, or a 24-character lowercase hexadecimal string, to an object id. |
| `str_id(value)` | `OID` | Alias for `to_id(value)`. |

## Examples

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL
);

INSERT INTO robots (name)
VALUES ('R2-D2');

INSERT INTO robots (id, name)
VALUES (gen_id(), 'BB-8');

SELECT id, name
FROM robots
WHERE id = str_id('507f1f77bcf86cd799439011');

SELECT to_id(@id)
FROM robots
LIMIT 1;
```

`gen_id()` returns an `OID` value whose text form is 24 lowercase hexadecimal
characters.

`DEFAULT (gen_id())` on an `OID` column runs once per inserted row, so an omitted
id and an explicit `DEFAULT` each receive their own ObjectId.

`to_id` and `str_id` accept an existing `OID` value or a string of exactly 24
lowercase hexadecimal characters.

For the full conversion rules, see
[Conversion Functions](/docs/functions-conversion).
