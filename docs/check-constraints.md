---
sidebar_position: 2.15
---

# Check constraints

A `CHECK` constraint stops invalid values, such as a negative price or an
unknown status, from getting into a table. The rule is stored in the database.
This means that it applies to all clients, including other services and ad hoc
SQL. Validation in application code protects only the writes that go
through that application.

A check constraint is a boolean expression, with the same `CHECK` syntax as in
PostgreSQL. It's evaluated each time a row is inserted or updated:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING NOT NULL,
  price FLOAT64 CHECK (price > 0)
);
```

If an `INSERT` or an `UPDATE` makes the expression `false`, the statement
returns `CADB0303 CheckConstraintViolation`:

```text
new row violates check constraint "products_price_check"
```

## Table-level checks

Use a table-level constraint when the rule compares several columns, or when you
want to choose the constraint name:

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

A column-level check can also refer to another column of the same row:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64,
  discounted_price FLOAT64 CHECK (price > discounted_price)
);
```

## Add or drop a check

To add a check constraint to a table, use `ALTER TABLE ... ADD CONSTRAINT`:

```camussql
ALTER TABLE products
ADD CONSTRAINT positive_price CHECK (price > 0);
```

The existing rows are scanned before the schema change commits. If a row
violates the new check, the `ALTER TABLE` returns `CADB0303`. The
constraint isn't added.

The new check applies to writes before the scan starts. This means that an
`INSERT` or an `UPDATE` that commits during the scan must also satisfy the new
rule. A violating row can't get in behind the scan.

To drop a check, use its name:

```camussql
ALTER TABLE products DROP CONSTRAINT positive_price;
```

## Constraint names

Constraint names are unique in a table. A second constraint with the same name
returns `CADB0400`.

| Definition | Constraint name |
| --- | --- |
| `price FLOAT64 CHECK (price > 0)` | `products_price_check` |
| `CONSTRAINT valid_discount CHECK (...)` | `valid_discount` |
| `CHECK (price > 0)` | `products_checkN`, for example `products_check1` |

To see the stored names, use `SHOW CREATE TABLE`:

```camussql
SHOW CREATE TABLE products;
```

```text
┌──────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Table    │ Create Table                                                                                                                                                                           │
├──────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ products │ CREATE TABLE `products` ( `id` OID NOT NULL DEFAULT(gen_id()), `name` STRING NOT NULL, `price` FLOAT64 NULL, PRIMARY KEY (`id`), CONSTRAINT `products_price_check` CHECK (price > 0)); │
└──────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
1 rows in set (00:00:00.0197653)
```

A column-level check can't have a name of your choice. The syntax
`price FLOAT64 CONSTRAINT positive_price CHECK (...)` returns a syntax error. If
you need a stable name, use a named table-level check.

## NULL values

A check uses the three-valued logic of SQL. A row violates a check only if the
expression is `false`:

| Check result | Write result |
| --- | --- |
| `true` | The row is accepted. |
| `false` | The row is rejected. |
| unknown (`NULL`) | The row is accepted. |

For example, a row where `price` is `NULL` is allowed in the following table.
The check `price > 0` is then unknown:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 CHECK (price > 0)
);
```

To require a value and also check its range, use `NOT NULL` and `CHECK`
together:

```camussql
CREATE TABLE products (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  price FLOAT64 NOT NULL CHECK (price > 0)
);
```

## Supported expressions

A check expression must be a deterministic condition on one row. It can use the
following:

- Comparisons, such as `=` and `<=`.
- `AND`, `OR`, and `NOT`.
- Arithmetic.
- `BETWEEN`.
- `LIKE` and `ILIKE`.
- Regular expression operators, such as `~` and `!~*`.
- `IS NULL` and `IS NOT NULL`.
- `IN` with a list of literals.
- `CASE ... END`.
- Deterministic scalar functions, and `CAST`.
- Array subscripts, such as `tags[1]`.

`CREATE TABLE` and `ADD CONSTRAINT` check the definition before they scan any
rows. An invalid definition returns `CADB0400`. For example, these definitions
are invalid:

- A subquery or an aggregate function.
- A volatile function, such as `now()` or `gen_id()`.
- An unknown column.
- A condition that isn't boolean, such as `CHECK (v + 1)`.
- A function call with the wrong number of arguments.
- Operands of types that can't be compared, such as a `STRING` column and a
  number.

An unknown function returns `CADB0407`. For more information, see
[Errors before reading rows](/docs/data-types#errors-before-reading-rows).

A string literal is converted to the type of the column for types such as
`UUID` and `DATE`. For example, `CHECK (d > '2020-01-01')`
on a `DATE` column compares dates. Note that a literal that isn't a valid value
of that type is unequal to all values. This means that `CHECK (u <> 'zzz')` on
a `UUID` column doesn't reject any row.

### Regular expressions

Regular expressions are useful for format checks:

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

A regular expression check follows the same `NULL` rule as other checks. If the
value or the pattern is `NULL`, the result is unknown. The row is then accepted.
A `NOT NULL` constraint can reject it.

A malformed pattern returns `CADB0400` at `CREATE TABLE` or `ADD CONSTRAINT`.
A regular expression error during a write, such as a match timeout, returns
`CADB0303`.

### CASE expressions

Use `CASE ... END` when the rule depends on another column:

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

A check can test a full `ARRAY(T)` column with `cardinality` and
`array_contains`, or one position with a subscript:

```camussql
CREATE TABLE posts (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  tags ARRAY(STRING)
    CHECK (cardinality(tags) <= 3 AND NOT array_contains(tags, 'banned'))
);
```

Both functions return `NULL` for a `NULL` array. This means that a `NULL`
array passes the check.

For a length rule, use `cardinality`. It returns `0` for an empty array.
`array_length(tags, 1)` returns `NULL` for an empty array, and an unknown result
doesn't reject the row.

`array_contains` follows the rules of `IN`. If the array has a `NULL` element
and no match, the result is unknown. In that case, a check on
`NOT array_contains(...)` doesn't reject the row. For more information, see
[Array functions](/docs/functions-array).

## Named NOT NULL constraints

A `NOT NULL` constraint can also have a name. You can then drop it by name:

```camussql
CREATE TABLE employees (
  id OID PRIMARY KEY NOT NULL DEFAULT (gen_id()),
  name STRING CONSTRAINT employees_name_not_null NOT NULL
);

ALTER TABLE employees DROP CONSTRAINT employees_name_not_null;
```

You can also add or remove `NOT NULL` on a column:

```camussql
ALTER TABLE employees ALTER COLUMN name SET NOT NULL;
ALTER TABLE employees ALTER COLUMN name DROP NOT NULL;
```

`SET NOT NULL` scans the table before the schema change commits. If a row has a
`NULL` value, the statement returns `CADB0301`. The column doesn't change.
As with a check, the new rule applies to writes before the scan starts.

If `SET NOT NULL` creates an unnamed constraint, the name is
`{table}_{column}_not_null`, for example `employees_name_not_null`.

A column of the primary key is always `NOT NULL`. `DROP NOT NULL` on such a
column returns `CADB0400`.

## Error codes

| Code | Name | Cause |
| --- | --- | --- |
| `CADB0301` | `NotNullViolation` | A write puts `NULL` in a `NOT NULL` column, or `SET NOT NULL` finds a `NULL` value. |
| `CADB0303` | `CheckConstraintViolation` | A row violates a `CHECK` constraint, or `ADD CONSTRAINT ... CHECK` finds a violating row. |
| `CADB0400` | `InvalidInput` | The check definition is invalid, or the constraint name exists. |

## Related pages

- [Tables and columns](/docs/sql-schema)
- [Data types](/docs/data-types)
- [Insert, update, delete](/docs/sql-writes)
- [Vector search](/docs/vector-search), which uses a check to set the dimension
  of an embedding
- [Error codes](/docs/error-codes)
