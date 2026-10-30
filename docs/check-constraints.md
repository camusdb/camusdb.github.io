---
sidebar_position: 2.15
---

# Check constraints

Validation in your application protects only the writes that go through your
application. A `CHECK` constraint puts the rule in the database, so it holds for
every client: other services, scripts, and ad hoc SQL. A negative price or an
unknown status never reaches the table, whoever writes it.

A check constraint is a boolean expression written with the same standard
`CHECK` syntax you use in PostgreSQL. CamusDB evaluates it whenever a row is
inserted or updated.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 CHECK (price > 0)
);
```

If an `INSERT` or `UPDATE` makes the expression evaluate to `false`, CamusDB
rejects the statement with `CADB0303 CheckConstraintViolation`.

## Table-level checks

Use a table-level constraint when the rule compares several columns or when you
want to choose the constraint name.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (price > discounted_price)
);
```

A table-level check is also useful for a set of allowed values:

```camussql
CREATE TABLE customers (
  id INT64 NOT NULL PRIMARY KEY,
  name STRING NOT NULL,
  telephone STRING,
  email STRING,
  status STRING,
  CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'blocked'))
);
```

A column-level check can also reference another column in the same row:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64 CHECK (price > discounted_price)
);
```

## Add or drop a check

Add a check constraint to an existing table with `ALTER TABLE ... ADD
CONSTRAINT`:

```camussql
ALTER TABLE products
ADD CONSTRAINT positive_price CHECK (price > 0);
```

CamusDB scans the existing rows before it commits the schema change. If an
existing row violates the new check, the `ALTER TABLE` fails and CamusDB adds no
constraint.

The new check is enforced before the scan begins. A concurrent `INSERT` or
`UPDATE` that commits while the scan is running must satisfy the new rule too,
so a violating row cannot appear behind the scan.

Drop a check by its name:

```camussql
ALTER TABLE products DROP CONSTRAINT positive_price;
```

After you drop the constraint, CamusDB no longer validates writes against that
rule.

## Constraint names

Constraint names are unique within a table.

| Definition | Constraint name |
| --- | --- |
| `price FLOAT64 CHECK (price > 0)` | `products_price_check` |
| `CONSTRAINT valid_discount CHECK (...)` | `valid_discount` |
| `CHECK (price > 0)` | `products_checkN` |

An unnamed table-level check gets a generated name. Use `SHOW CREATE TABLE` to
see the names CamusDB stored:

```camussql
SHOW CREATE TABLE products;
```

CamusDB does not support named column-level check syntax. Use a named
table-level check when you need a stable name.

## NULL semantics

A check uses SQL's three-valued logic. A row violates a check only when the
expression evaluates to `false`.

| Check result | Write result |
| --- | --- |
| `true` | CamusDB accepts the row. |
| `false` | CamusDB rejects the row. |
| unknown, or `NULL` | CamusDB accepts the row. |

So this table accepts a row where `price` is `NULL`, because `price > 0` is
then unknown, not false:

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

## Supported expressions

A check expression must be a deterministic predicate over a single row. It can
use:

- Comparisons, such as `=`, `<>`, `<`, `<=`, `>`, and `>=`.
- Boolean logic with `AND`, `OR`, and `NOT`.
- Arithmetic expressions.
- `BETWEEN`.
- `LIKE` and `ILIKE`.
- Regular expression operators: `~`, `~*`, `!~`, and `!~*`.
- `IS NULL` and `IS NOT NULL`.
- `IN` with a list of literals.
- `CASE ... END`.
- Deterministic scalar functions.
- `CAST`.
- Array subscripts such as `tags[1]`.

CamusDB rejects a check definition that uses a subquery, an aggregate function,
a volatile function (such as `now()`, `gen_id()`, `gen_uuid_v4()`, or
`gen_uuid_v7()`), or a reference to an unknown column.

While evaluating a check, CamusDB can coerce a string literal to a compatible
typed value, such as `UUID`, `OID`, `DATE`, or `DATETIME`. An incompatible
value fails with `CADB0303 CheckConstraintViolation`.

Regular expression operators are useful for format checks:

```camussql
CREATE TABLE users (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  username STRING NOT NULL,
  CONSTRAINT username_format
    CHECK (username ~ '^[a-zA-Z][a-zA-Z0-9_]{2,29}$')
);

CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  sku STRING NOT NULL,
  CONSTRAINT sku_has_no_whitespace CHECK (sku !~ '\s')
);
```

A regular expression check follows the same `NULL` rule as any other check. If
the subject or the pattern is `NULL`, the result is unknown and the row passes.
Another constraint, such as `NOT NULL`, can still reject it.

CamusDB rejects a malformed literal pattern at `CREATE TABLE` or
`ALTER TABLE ... ADD CONSTRAINT`. A regular expression failure while evaluating
a check appears as `CADB0303 CheckConstraintViolation`.

Checks also support `CASE ... END`. Use it when the rule depends on another
column:

```camussql
CREATE TABLE entries (
  id INT64 NOT NULL PRIMARY KEY,
  kind STRING NOT NULL,
  value INT64 NOT NULL,
  CONSTRAINT valid_value_for_kind CHECK (
    CASE
      WHEN kind = 'discount' THEN value < 0
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
array. For a length rule that must treat an empty array as length 0, use
`cardinality`, not `array_length`: `array_length(tags, 1)` returns `NULL` for an
empty array, and a check whose result is unknown passes.

`array_contains` follows `IN` semantics. If the array holds a `NULL` element and
no match, the result is unknown, so a check on `NOT array_contains(...)` passes
in that case. See [Array Functions](/docs/functions-array).

## Named NOT NULL constraints

A `NOT NULL` constraint can also have a name, which lets you drop it:

```camussql
CREATE TABLE employees (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING CONSTRAINT employees_name_not_null NOT NULL
);
```

Drop it with `ALTER TABLE ... DROP CONSTRAINT`:

```camussql
ALTER TABLE employees DROP CONSTRAINT employees_name_not_null;
```

You can also add or remove `NOT NULL` on an existing column:

```camussql
ALTER TABLE employees ALTER COLUMN name SET NOT NULL;
ALTER TABLE employees ALTER COLUMN name DROP NOT NULL;
```

You cannot drop `NOT NULL` from a column while that column belongs to the primary
key. Drop or change the primary key first.

`SET NOT NULL` scans the table before it commits the schema change. If existing
rows contain `NULL`, the statement fails and the column stays nullable.

The new `NOT NULL` rule is enforced before that scan begins, so concurrent
writes cannot insert a new `NULL` while CamusDB validates the existing rows.

When `SET NOT NULL` creates an unnamed constraint, CamusDB names it
`{table}_{column}_not_null`, for example `employees_name_not_null`.

## Error codes

| Code | Name | When CamusDB generates it |
| --- | --- | --- |
| `CADB0301` | `NotNullViolation` | A write puts `NULL` into a `NOT NULL` column, or `ALTER TABLE ... SET NOT NULL` finds an existing `NULL` value. |
| `CADB0303` | `CheckConstraintViolation` | A row violates a `CHECK` constraint, `ALTER TABLE ... ADD CONSTRAINT ... CHECK` finds an existing violating row, or check evaluation hits an incompatible value. |
| `CADB0400` | `InvalidInput` | The check definition is invalid, for example because it uses a subquery, an aggregate, a volatile function, an unknown column, or a malformed literal pattern. |

## Related pages

- [Tables And Columns](/docs/sql-schema)
- [Data Types](/docs/data-types)
- [Insert, Update, Delete](/docs/sql-writes)
- [Vector Search](/docs/vector-search), which uses a check to fix the dimension
  of an embedding
- [Error Codes](/docs/error-codes)
