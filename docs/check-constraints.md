---
sidebar_position: 2.15
---

# Check Constraints

Use `CHECK` constraints to keep invalid rows out of a table. A check constraint
is a boolean expression that CamusDB evaluates when a row is inserted or
updated.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 CHECK (price > 0)
);
```

If an `INSERT` or `UPDATE` would make the expression evaluate to `false`,
CamusDB rejects the statement with `CADB0303 CheckConstraintViolation`.

## Table-Level Checks

Use a table-level constraint when the rule compares multiple columns or when
you want to choose the constraint name.

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64,
  CONSTRAINT valid_discount CHECK (price > discounted_price)
);
```

Table-level checks are also useful for enumerated values:

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

Column-level checks may also reference other columns in the same row:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64 CHECK (price > discounted_price)
);
```

## Add Or Drop Checks

Add a check constraint to an existing table with `ALTER TABLE ... ADD
CONSTRAINT`.

```camussql
ALTER TABLE products
ADD CONSTRAINT positive_price CHECK (price > 0);
```

CamusDB scans existing rows before committing the schema change. If any existing
row violates the new check, the `ALTER TABLE` fails and the constraint is not
added.

Drop a check by name:

```camussql
ALTER TABLE products DROP CONSTRAINT positive_price;
```

After the constraint is dropped, later writes are no longer validated against
that rule.

## Constraint Names

Constraint names are unique within a table.

| Definition | Constraint name |
| --- | --- |
| `price FLOAT64 CHECK (price > 0)` | `products_price_check` |
| `CONSTRAINT valid_discount CHECK (...)` | `valid_discount` |
| `CHECK (price > 0)` | `products_checkN` |

Unnamed table-level checks receive an auto-generated name. Use
`SHOW CREATE TABLE` to inspect the names CamusDB stored:

```camussql
SHOW CREATE TABLE products;
```

Column-level named check syntax is not supported. Use a table-level named check
when you need a stable name.

## Null Semantics

Checks use SQL three-valued logic. A row violates a check only when the
expression evaluates to `false`.

| Check result | Write result |
| --- | --- |
| `true` | accepted |
| `false` | rejected |
| `unknown` / `NULL` | accepted |

For example, this table accepts rows where `price` is `NULL` because
`price > 0` is unknown, not false:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 CHECK (price > 0)
);
```

To require a value and validate its range, combine `NOT NULL` and `CHECK`:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 NOT NULL CHECK (price > 0)
);
```

## Supported Expressions

Check expressions must be deterministic single-row predicates. They can use:

- comparisons such as `=`, `<>`, `<`, `<=`, `>`, and `>=`
- boolean logic with `AND`, `OR`, and `NOT`
- arithmetic expressions
- `BETWEEN`
- `LIKE` and `ILIKE`
- regex operators `~`, `~*`, `!~`, and `!~*`
- `IS NULL` and `IS NOT NULL`
- `IN` with a literal list
- deterministic scalar functions
- `CAST`

CamusDB rejects check definitions that use subqueries, aggregate functions,
volatile functions such as `now()`, `gen_id()`, `gen_uuid_v4()`, or
`gen_uuid_v7()`, or references to unknown columns.

String literals can be coerced to compatible typed values, such as `UUID`,
`OID`, `DATE`, and `DATETIME`, during check evaluation. Incompatible values fail
with `CADB0303 CheckConstraintViolation`.

Regex operators are useful for format checks:

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
  CONSTRAINT sku_has_no_whitespace CHECK (sku !~ "\\s")
);
```

Regex checks follow the same `NULL` rule as other checks: if the subject or
pattern is `NULL`, the result is unknown and the row passes unless another
constraint, such as `NOT NULL`, rejects it. Literal malformed regex patterns in
`CHECK` constraints are rejected at `CREATE TABLE` or `ALTER TABLE ... ADD
CONSTRAINT` time. Regex failures during check evaluation are surfaced as
`CADB0303 CheckConstraintViolation`.

## Named Not Null Constraints

`NOT NULL` constraints can also be named and dropped.

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

CamusDB also supports adding or removing `NOT NULL` on an existing column:

```camussql
ALTER TABLE employees ALTER COLUMN name SET NOT NULL;
ALTER TABLE employees ALTER COLUMN name DROP NOT NULL;
```

`SET NOT NULL` scans the table first. If any existing row contains `NULL` in the
target column, CamusDB rejects the schema change with `CADB0301
NotNullViolation`.

When `SET NOT NULL` creates an unnamed constraint, CamusDB stores it as
`{table}_{column}_not_null`, for example `employees_name_not_null`.

## Error Codes

| Code | Name | When it is generated |
| --- | --- | --- |
| `CADB0301` | `NotNullViolation` | A row writes `NULL` to a `NOT NULL` column, or `ALTER TABLE ... SET NOT NULL` finds existing `NULL` values. |
| `CADB0303` | `CheckConstraintViolation` | A row violates a `CHECK` constraint, `ALTER TABLE ... ADD CONSTRAINT ... CHECK` finds existing violating rows, or check evaluation hits incompatible values. |
| `CADB0400` | `InvalidInput` | The check definition is invalid, such as a subquery, aggregate, volatile function, unknown column, or malformed literal regex pattern. |

## Related Pages

- [Tables And Schema](/docs/sql-schema)
- [Data Types](/docs/data-types)
- [Writing Data](/docs/sql-writes)
- [Error Codes](/docs/error-codes)
