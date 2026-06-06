---
sidebar_position: 2
---

# SQL

CamusDB uses a compact SQL dialect for schema changes, writes, reads, indexes,
and transactions. SQL keywords are case-insensitive. Identifiers are normalized
to lowercase, including identifiers written with backticks.

## Data Definition

Create a table:

```sql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  year INT64 DEFAULT (2024),
  active BOOL DEFAULT (true)
);
```

Create a table only when it does not exist:

```sql
CREATE TABLE IF NOT EXISTS robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL
);
```

Declare a composite primary key after the column list:

```sql
CREATE TABLE readings (
  sensor_id STRING NOT NULL,
  ts INT64 NOT NULL,
  value FLOAT64 NOT NULL
) PRIMARY KEY (sensor_id ASC, ts DESC);
```

Drop tables:

```sql
DROP TABLE robots;
DROP TABLE IF EXISTS robots;
```

Alter tables:

```sql
ALTER TABLE robots ADD COLUMN model STRING NULL;
ALTER TABLE robots DROP COLUMN model;
ALTER TABLE robots ADD PRIMARY KEY (id);
ALTER TABLE robots DROP PRIMARY KEY;
```

## Indexes

Primary keys and unique columns create indexes. Additional indexes can be added
with either `CREATE INDEX` or `ALTER TABLE`.

```sql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);

ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_name_idx (name);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Inserts

Insert one or more rows:

```sql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

INSERT INTO robots (id, name, year)
VALUES
  (GEN_ID(), "C-3PO", 1977),
  (GEN_ID(), "T-800", 1984);
```

Use `DEFAULT` to apply a column default:

```sql
INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "K-2SO", DEFAULT);
```

Object id helpers are available as function calls:

```sql
GEN_ID()
STR_ID("507f1f77bcf86cd799439011")
```

See [Object Id Functions](/docs/functions-object-id) for details.

## Queries

Select explicit columns, all columns, qualified columns, expressions, aliases,
or aggregate expressions:

```sql
SELECT id, name FROM robots;
SELECT * FROM robots;
SELECT r.id, r.name FROM robots r;
SELECT year + 100 AS display_year FROM robots;
SELECT SUM(year) AS total_year FROM robots;
```

Supported aggregate functions are:

- `COUNT(*)` and `COUNT(column)`
- `SUM(column)`
- `AVG(column)`
- `MIN(column)`
- `MAX(column)`

Scalar functions can be used in projections, filters, aliases, and nested
expressions:

```sql
SELECT upper(trim(name)) AS display_name
FROM robots
WHERE abs(year - 2000) <= 5;
```

See [Functions](/docs/functions) for the function reference.

Filters support comparison, boolean composition, pattern matching, and null
checks. They also support subquery predicates:

```sql
SELECT id, name
FROM robots
WHERE year >= 1970 AND name ILIKE "r%";

SELECT *
FROM robots
WHERE year IS NULL OR name LIKE "%D2";

SELECT year
FROM robots
WHERE year BETWEEN 2001 AND 2004;

SELECT email
FROM app_users
WHERE id IN (SELECT user_id FROM posts WHERE published = true);

SELECT id
FROM robots
WHERE id NOT IN (SELECT robots_id FROM blocked_robots);
```

Supported filter operators include `=`, `!=`, `<`, `>`, `<=`, `>=`, `AND`,
`OR`, `LIKE`, `ILIKE`, `BETWEEN ... AND ...`, `IS NULL`, `IS NOT NULL`,
`IN (SELECT ...)`, `NOT IN (SELECT ...)`, and `EXISTS (SELECT ...)`.

Group rows by columns or expressions:

```sql
SELECT role, COUNT(*) AS cnt
FROM app_users
GROUP BY role
HAVING cnt > 1
ORDER BY cnt, role;

SELECT enabled, SUM(year) AS total, AVG(year) AS average
FROM robots
GROUP BY enabled
ORDER BY enabled;
```

Non-aggregate projections must appear in `GROUP BY`.
`HAVING` filters grouped or aggregate results after aggregation and can
reference aggregate aliases, aggregate expressions, or grouped keys.

Join tables with `JOIN`, `INNER JOIN`, or comma join syntax:

```sql
SELECT u.email, p.title
FROM app_users u
JOIN posts p ON p.user_id = u.id
WHERE u.role = "admin"
ORDER BY u.email, p.title;

SELECT r.name, ur.amount
FROM robots r, user_robots ur
WHERE r.id = ur.robots_id
ORDER BY r.name, ur.amount;
```

Use derived tables in `FROM` and join them like named sources:

```sql
SELECT u.email, d.post_count
FROM app_users u
JOIN (
  SELECT user_id, COUNT(*) AS post_count
  FROM posts
  GROUP BY user_id
) d ON d.user_id = u.id
ORDER BY u.email;
```

Scalar subqueries can be used in expressions:

```sql
SELECT id, name
FROM robots
WHERE year = (SELECT MAX(year) FROM robots)
ORDER BY name;
```

Order, limit, and offset results:

```sql
SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC, name ASC
LIMIT 25 OFFSET 50;
```

Force a specific index when reading:

```sql
SELECT id, name
FROM robots@{FORCE_INDEX=robots_year_idx}
WHERE year >= 1980;
```

See [Query Features](/docs/query-features) for the full query surface, including
join rules, grouped aggregate behavior, subqueries, derived tables, and planner
notes.

See [Query Planning](/docs/query-planning) for how CamusDB chooses scans,
indexed joins, sorts, and limit pushdown, and [EXPLAIN](/docs/explain) for plan
inspection output.

## Updates And Deletes

Updates and deletes require `WHERE` clauses in SQL:

```sql
UPDATE robots
SET year = 1982
WHERE name = "T-800";

DELETE FROM robots
WHERE year < 1970;
```

## Transactions

CamusDB supports transaction statements:

```sql
BEGIN;
START TRANSACTION;
COMMIT;
ROLLBACK;
```

Client APIs also expose explicit transaction handles. When a write or query
request does not include a transaction id, CamusDB starts and commits a
single-operation transaction automatically.

## Schema Inspection

```sql
SHOW TABLES;
SHOW COLUMNS FROM robots;
DESCRIBE robots;
DESC robots;
SHOW CREATE TABLE robots;
SHOW DATABASE;
SHOW INDEXES FROM robots;
SHOW INDEX FROM robots;
```

## Parameters

SQL requests can pass parameter placeholders:

```sql
SELECT id, name FROM robots WHERE id = @id;
UPDATE robots SET name = @name WHERE id = @id;
```

Parameter values are bound by the client or shell command that submits the SQL.
