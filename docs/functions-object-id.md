---
sidebar_position: 4.6
---

# Object ID functions

An object id function creates or converts an `OID` value of CamusDB. These
functions are useful in a primary key, in an insert, in a filter, and in a query
with a parameter.

| Function | Returns | Description |
| --- | --- | --- |
| `gen_id()` | `OID` | It generates a new object id. The function is volatile. |
| `to_id(value)` | `OID` | It converts an `OID` to an object id. It also converts a hexadecimal string of 24 lowercase characters. |
| `str_id(value)` | `OID` | An alias of `to_id(value)`. |

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

`gen_id()` returns a string of an object id, with 24 characters.

`DEFAULT (gen_id())` on an `OID` column runs one time for each inserted row. An
omitted id and a `DEFAULT` value therefore both receive their own ObjectId.

`to_id` and `str_id` accept an existing `OID` value. They also accept a string
of exactly 24 lowercase hexadecimal characters.

For the full rules of a conversion, see
[Conversion Functions](/docs/functions-conversion).
