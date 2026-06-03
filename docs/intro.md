---
sidebar_position: 1
---

# CamusDB Tutorial

CamusDB is an open-source NewSQL distributed database with SQL, indexes, and
transactions.

CamusDB is alpha-quality software. Interfaces and storage formats may change
between versions, and it should not be used in production.

This tutorial uses `camus-cli`, the interactive SQL shell. It walks through the
basic workflow against a running CamusDB node or cluster: create a table, insert
rows, query data, add an index, and update or delete rows.

For a higher-level overview of why CamusDB is built as a distributed NewSQL
database, start with [Why CamusDB?](/docs/why-camusdb).

## Start CamusDB

Install the SQL shell:

```bash
dotnet tool install --global CamusDB.SqlSh
```

Start CamusDB in standalone mode for local use, or run a cluster when you want
to try distributed storage. Then open the SQL shell:

```bash
camus-cli
```

You should see an interactive prompt:

```text
camus>
```

## Create A Table

Create a table for robot records:

```sql
CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024)
);
```

The table has:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `OID` | Primary key object id. |
| `name` | `STRING` | Required robot name. |
| `kind` | `STRING` | Required category or model family. |
| `year` | `INT64` | Optional year with a default value. |

## Inspect The Schema

Show the tables in the current database:

```sql
SHOW TABLES;
```

Show the columns in `robots`:

```sql
SHOW COLUMNS FROM robots;
```

Other useful inspection commands:

```sql
DESCRIBE robots;
SHOW CREATE TABLE robots;
SHOW INDEX FROM robots;
```

## Insert Rows

Insert a single row:

```sql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "R2-D2", "utility", 1977);
```

Insert more than one row with a single statement:

```sql
INSERT INTO robots (id, name, kind, year)
VALUES
  (GEN_ID(), "C-3PO", "protocol", 1977),
  (GEN_ID(), "T-800", "android", 1984);
```

Use `DEFAULT` when you want CamusDB to apply the column default:

```sql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "K-2SO", "security", DEFAULT);
```

## Query Rows

Select rows from the table:

```sql
SELECT id, name, kind, year
FROM robots
ORDER BY year ASC;
```

Filter results with `WHERE`:

```sql
SELECT name, year
FROM robots
WHERE year >= 1980;
```

Pattern matching is supported with `LIKE` and `ILIKE`:

```sql
SELECT id, name
FROM robots
WHERE name ILIKE "r%";
```

Aggregate rows:

```sql
SELECT COUNT(*) FROM robots;
SELECT MIN(year), MAX(year) FROM robots;
```

## Create An Index

Indexes help CamusDB avoid scanning every row for matching data.

```sql
CREATE INDEX robots_kind_idx ON robots (kind);
```

Inspect indexes:

```sql
SHOW INDEXES FROM robots;
```

## Update Rows

SQL updates require a `WHERE` clause.

```sql
UPDATE robots
SET year = 1982
WHERE name = "T-800";
```

Confirm the change:

```sql
SELECT name, year
FROM robots
WHERE name = "T-800";
```

## Delete Rows

SQL deletes also require a `WHERE` clause.

```sql
DELETE FROM robots
WHERE name = "K-2SO";
```

## Column Types

| SQL type | Notes |
| --- | --- |
| `STRING` | Text values. |
| `INT64` | Signed 64-bit integers. |
| `FLOAT64` | Double-precision floating point values. |
| `BOOL` | Boolean values. |
| `OID` | 24-character object id values. |

Continue with the SQL reference for the full statement list and
[Query Features](/docs/query-features) for joins, grouping, subqueries, and derived
tables.
