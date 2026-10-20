---
sidebar_position: 2.15
---

# Check constraints

Validation in your application protects only the writes that go through your
application. A `CHECK` constraint puts the rule in the database, so it holds for
every client: other services, scripts, and ad hoc SQL. A negative price or an
unknown status never reaches the table, whoever writes it.

A check constraint is a boolean expression, with the same standard `CHECK`
syntax you use in PostgreSQL. CamusDB evaluates it whenever a row is inserted or
updated.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 CHECK (price > 0)
);
```

An `INSERT` or an `UPDATE` can make the expression evaluate to `false`. CamusDB
then rejects the statement, with `CADB0303 CheckConstraintViolation`.

## A check at the level of a table

Use a constraint at the level of the table in two cases. The rule compares
several columns, or you want to select the name of the constraint.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (price > discounted_price)
);
```

A check at the level of a table is also useful for a set of permitted values:

```camussql
CREATE TABLE customers (
  id INT64 NOT NULL PRIMARY KEY,
  name STRING NOT NULL,
  telephone STRING,
  email STRING,
  status STRING,
  CONSTRAINT valid_status CHECK (status IN ("active", "inactive", "blocked"))
);
```

A check at the level of a column can also reference another column of the same
row:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64 CHECK (price > discounted_price)
);
```

## Add a check, or drop one

Add a check constraint to an existing table with `ALTER TABLE ... ADD
CONSTRAINT`.

```camussql
ALTER TABLE products
ADD CONSTRAINT positive_price CHECK (price > 0);
```

CamusDB scans the existing rows before it commits the schema change. The `ALTER
TABLE` fails when an existing row violates the new check. CamusDB then adds no
constraint.

The new check is enforced before the scan begins. A concurrent `INSERT` or
`UPDATE` that commits while the scan is running must satisfy the new rule too,
so a violating row cannot appear behind the scan.

Drop a check by its name:

```camussql
ALTER TABLE products DROP CONSTRAINT positive_price;
```

After the drop of the constraint, CamusDB validates no later write against that
rule.

## The name of a constraint

The name of a constraint is unique inside a table.

| Definition | Name of the constraint |
| --- | --- |
| `price FLOAT64 CHECK (price > 0)` | `products_price_check` |
| `CONSTRAINT valid_discount CHECK (...)` | `valid_discount` |
| `CHECK (price > 0)` | `products_checkN` |

A check at the level of a table, and without a name, receives a generated name.
Use `SHOW CREATE TABLE` to inspect the names that CamusDB stored:

```camussql
SHOW CREATE TABLE products;
```

CamusDB does not support the syntax of a named check at the level of a column.
Use a named check at the level of the table when you need a stable name.

## The semantics of a NULL

A check uses the logic of SQL, with three values. A row violates a check only
when the expression evaluates to `false`.

| Result of the check | Result of the write |
| --- | --- |
| `true` | CamusDB accepts the row. |
| `false` | CamusDB rejects the row. |
| unknown, or `NULL` | CamusDB accepts the row. |

This table therefore accepts a row where `price` is `NULL`. `price > 0` is
unknown in that case. It is not false:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 CHECK (price > 0)
);
```

Combine `NOT NULL` and `CHECK` to require a value and to validate its range:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 NOT NULL CHECK (price > 0)
);
```

## The supported expressions

The expression of a check must be a predicate over one row, and it must be
deterministic. It can use these forms:

- A comparison, such as `=`, `<>`, `<`, `<=`, `>`, and `>=`.
- Boolean logic, with `AND`, `OR`, and `NOT`.
- An arithmetic expression.
- `BETWEEN`.
- `LIKE` and `ILIKE`.
- An operator of a regular expression: `~`, `~*`, `!~`, and `!~*`.
- `IS NULL` and `IS NOT NULL`.
- `IN`, with a list of literals.
- `CASE ... END`.
- A deterministic scalar function.
- `CAST`.
- An array subscript such as `tags[1]`.

CamusDB rejects a definition of a check that uses one of these four forms: a
subquery, an aggregate function, a volatile function, or a reference to an
unknown column. Four volatile functions are `now()`, `gen_id()`,
`gen_uuid_v4()`, and `gen_uuid_v7()`.

CamusDB can coerce a string literal to a compatible typed value during the
evaluation of a check. Four such types are `UUID`, `OID`, `DATE`, and
`DATETIME`. An incompatible value fails with `CADB0303
CheckConstraintViolation`.

An operator of a regular expression is useful for a check of a format:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  username STRING NOT NULL,
  CONSTRAINT username_format
    CHECK (username ~ "^[a-zA-Z][a-zA-Z0-9_]{2,29}$")
);

CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  sku STRING NOT NULL,
  CONSTRAINT sku_has_no_whitespace CHECK (sku !~ "\s")
);
```

A check with a regular expression follows the same rule for a `NULL` as any
other check. The subject or the pattern can be `NULL`. The result is then
unknown, and the row passes. Another constraint, such as a `NOT NULL`, can still
reject it.

CamusDB rejects a literal pattern with a wrong form. It does so at the
`CREATE TABLE`, or at the `ALTER TABLE ... ADD CONSTRAINT`. A failure of a
regular expression during the evaluation of a check appears as `CADB0303
CheckConstraintViolation`.

A check also supports `CASE ... END`. Use it when the valid rule depends on
another column:

```camussql
CREATE TABLE entries (
  id INT64 NOT NULL PRIMARY KEY,
  kind STRING NOT NULL,
  value INT64 NOT NULL,
  CONSTRAINT valid_value_for_kind CHECK (
    CASE
      WHEN kind = "discount" THEN value < 0
      ELSE value >= 0
    END
  )
);
```

### Array columns

A check can test an `ARRAY(T)` column as a whole with `cardinality` and
`array_contains`, or test one position with a subscript:

```camussql
CREATE TABLE posts (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  tags ARRAY(STRING)
    CHECK (cardinality(tags) <= 3 AND NOT array_contains(tags, 'banned'))
);
```

Both functions return `NULL` for a `NULL` array, so the check accepts a `NULL`
array. Use `cardinality`, not `array_length`, for a length rule that must treat
an empty array as length 0. `array_length(tags, 1)` returns `NULL` for an empty
array, and a check whose result is unknown passes.

`array_contains` follows `IN` semantics. If the array holds a `NULL` element and
no match, the result is unknown. A check on `NOT array_contains(...)` therefore
passes in that case. See [Array Functions](/docs/functions-array).

## A named NOT NULL constraint

A `NOT NULL` constraint can also have a name. You can then drop it.

```camussql
CREATE TABLE employees (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING CONSTRAINT employees_name_not_null NOT NULL
);
```

Drop the named `NOT NULL` constraint with `ALTER TABLE ... DROP CONSTRAINT`:

```camussql
ALTER TABLE employees DROP CONSTRAINT employees_name_not_null;
```

CamusDB also supports the addition and the removal of a `NOT NULL` on an
existing column:

```camussql
ALTER TABLE employees ALTER COLUMN name SET NOT NULL;
ALTER TABLE employees ALTER COLUMN name DROP NOT NULL;
```

You cannot drop `NOT NULL` from a column while that column belongs to the primary
key. Drop or change the primary key first.

`SET NOT NULL` scans the table before it commits the schema change. Existing
rows with `NULL` values make the statement fail, and the column remains
nullable.

The new `NOT NULL` rule is enforced before that scan begins, so concurrent
writes cannot insert a new `NULL` while CamusDB validates the existing rows.

`SET NOT NULL` can create a constraint without a name. CamusDB then stores the
name as `{table}_{column}_not_null`. One example is `employees_name_not_null`.

## Error codes

| Code | Name | When CamusDB generates it |
| --- | --- | --- |
| `CADB0301` | `NotNullViolation` | A row writes a `NULL` into a `NOT NULL` column. `ALTER TABLE ... SET NOT NULL` also finds an existing `NULL` value. |
| `CADB0303` | `CheckConstraintViolation` | A row violates a `CHECK` constraint. `ALTER TABLE ... ADD CONSTRAINT ... CHECK` also finds an existing row in violation. The evaluation of a check also meets an incompatible value. |
| `CADB0400` | `InvalidInput` | The definition of the check is invalid. Five examples are a subquery, an aggregate, a volatile function, an unknown column, and a literal pattern with a wrong form. |

## Related pages

- [Tables And Columns](/docs/sql-schema)
- [Data Types](/docs/data-types)
- [Insert, Update, Delete](/docs/sql-writes)
- [Vector Search](/docs/vector-search), which uses a check to fix the dimension
  of an embedding
- [Error Codes](/docs/error-codes)
