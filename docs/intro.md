---
sidebar_position: 1
---

# CamusDB Tutorial

CamusDB is an open-source NewSQL distributed database with SQL, indexes, and transactions.

This tutorial uses `camus-cli`, the interactive SQL shell. It walks through the basic workflow against a running CamusDB node or cluster: create a database, create a table, insert rows, query data, add an index, and update or delete rows.

For a higher-level overview of why CamusDB is built as a distributed SQL database, start with [Why CamusDB?](/docs/why-camusdb).

## Start CamusDB

Start CamusDB in standalone mode for local use:

```bash
docker run --rm -p 5095:5095 -v camus-data:/data --name camusdb camusdb/camusdb:latest
```

Install the SQL shell:

```bash
dotnet tool install --global CamusDB.SqlSh
```

Then open the SQL shell in another terminal:

```bash
camus-cli
```

You should see an interactive prompt:

```camussql
camus>
```

## Create A Database

Databases must be created explicitly before use. Create a database, then switch
the shell to it:

```camussql
camus> CREATE DATABASE factory;
Query OK, 0 rows affected (00:00:00.0711685)

camus> use factory;
Database changed to factory
```

If you already started the shell with `camus-cli factory`, you still need the
`CREATE DATABASE factory;` statement the first time that database name is used.

## Create A Table

Create a table for robot records:

```camussql
CREATE TABLE robots (
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

```camussql
camus> show tables
┌────────┐
│ tables │
├────────┤
│ robots │
└────────┘
1 rows in set (00:00:00.0526560)
```

Show the columns in `robots`:

```camussql
camus> show columns from robots
┌───────┬───────────┬──────┬─────┬─────────┬───────┐
│ Field │ Type      │ Null │ Key │ Default │ Extra │
├───────┼───────────┼──────┼─────┼─────────┼───────┤
│ id    │ Id        │ NO   │ PRI │ NULL    │       │
│ name  │ String    │ NO   │     │ NULL    │       │
│ kind  │ String    │ NO   │     │ NULL    │       │
│ year  │ Integer64 │ YES  │     │ 2024    │       │
└───────┴───────────┴──────┴─────┴─────────┴───────┘
4 rows in set (00:00:00.0189059)
```

Other useful inspection commands:

```camussql
DESCRIBE robots;
SHOW CREATE TABLE robots;
SHOW INDEX FROM robots;
```

Show the SQL definition for the table:

```camussql
camus> show create table robots;
┌────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Table  │ Create Table                                                                                                                       │
├────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ robots │ CREATE TABLE `robots` ( `id` OID NOT NULL, `name` STRING NOT NULL, `kind` STRING NOT NULL, `year` INT64 NULL, PRIMARY KEY (`id`)); │
└────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
1 rows in set (00:00:00.0037082)
```

## Insert Rows

Insert a single row:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "R2-D2", "utility", 1977);
```

Insert more than one row with a single statement:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES
  (GEN_ID(), "C-3PO", "protocol", 1977),
  (GEN_ID(), "T-800", "android", 1984);
```

Use `DEFAULT` when you want CamusDB to apply the column default:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "K-2SO", "security", DEFAULT);
```

## Query Rows

Select rows from the table:

```camussql
camus> SELECT id, name, kind, year FROM robots ORDER BY year ASC;
┌──────────────────────────┬───────┬──────────┬──────┐
│ id                       │ name  │ kind     │ year │
├──────────────────────────┼───────┼──────────┼──────┤
│ 6a3dd713d615ae230488d7f2 │ R2-D2 │ utility  │ 1977 │
│ 6a3dd71bd615ae230488d7f4 │ C-3PO │ protocol │ 1977 │
│ 6a3dd71bd615ae230488d7f5 │ T-800 │ android  │ 1984 │
│ 6a3dd726d615ae230488d7f8 │ K-2SO │ security │ 2024 │
└──────────────────────────┴───────┴──────────┴──────┘
4 rows in set (00:00:00.0232238)
```

Filter results with `WHERE`:

```camussql
camus> SELECT name, year FROM robots WHERE year >= 1980;
┌───────┬──────┐
│ name  │ year │
├───────┼──────┤
│ T-800 │ 1984 │
│ K-2SO │ 2024 │
└───────┴──────┘
2 rows in set (00:00:00.0298712)
```

Pattern matching is supported with `LIKE` and `ILIKE`:

```camussql
camus> SELECT id, name FROM robots WHERE name ILIKE "r%";
┌──────────────────────────┬───────┐
│ id                       │ name  │
├──────────────────────────┼───────┤
│ 6a3dd713d615ae230488d7f2 │ R2-D2 │
└──────────────────────────┴───────┘
1 rows in set (00:00:00.0254039)
```

Aggregate rows:

```camussql
SELECT COUNT(*) FROM robots;
SELECT MIN(year), MAX(year) FROM robots;
```

## Create An Index

Indexes help CamusDB avoid scanning every row for matching data.

```camussql
CREATE INDEX robots_kind_idx ON robots (kind);
```

Inspect indexes:

```camussql
SHOW INDEXES FROM robots;
```

## Rename Schema Objects

Tables and columns can be renamed without rewriting row data:

```camussql
ALTER TABLE robots RENAME COLUMN kind TO category;
ALTER TABLE robots RENAME TO machines;
```

## Update Rows

SQL updates require a `WHERE` clause.

```camussql
UPDATE machines
SET year = 1982
WHERE name = "T-800";
```

Confirm the change:

```camussql
SELECT name, year
FROM machines
WHERE name = "T-800";
```

## Delete Rows

SQL deletes also require a `WHERE` clause.

```camussql
DELETE FROM machines
WHERE name = "K-2SO";
```

## Column Types

| SQL type | Notes |
| --- | --- |
| `OID` | Native object id values. |
| `INT64` | Signed 64-bit integers. |
| `FLOAT64` | Double-precision floating point values. |
| `FLOAT32` | Single-precision floating point values. |
| `BOOL` | Boolean values. |
| `STRING`, `STRING(N)` | Text values, optionally with a maximum length. |
| `DATE`, `DATETIME` | Calendar dates and UTC instants. |
| `BYTES` | Opaque byte strings. |
| `ARRAY(T)` | Ordered lists of scalar values. |

Continue with the [SQL overview](/docs/sql), [Data Types](/docs/data-types),
[Tables And Schema](/docs/sql-schema), and [Query Features](/docs/query-features)
for joins, grouping, subqueries, and derived tables.
