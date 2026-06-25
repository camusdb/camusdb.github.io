---
sidebar_position: 2.6
---

# Schema Inspection

CamusDB supports SQL inspection commands for databases, tables, columns,
indexes, and query plans.

## Databases

```camussql
SHOW DATABASES;
SHOW DATABASE;
```

`SHOW DATABASES` lists registered databases. `SHOW DATABASE` reports the current
database context.

## Tables And Columns

```camussql
SHOW TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
```

## Indexes

```camussql
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

## Explain

Inspect a plan with `EXPLAIN`:

```camussql
EXPLAIN SELECT * FROM robots WHERE year = 2024;
EXPLAIN (LOGICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (PHYSICAL) SELECT * FROM robots WHERE year = 2024;
EXPLAIN (ANALYZE) SELECT * FROM robots WHERE year = 2024 LIMIT 5;
```

See [Explaining Queries And Commands](/docs/explain) for output details.
