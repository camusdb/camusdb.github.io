---
sidebar_position: 2
---

# SQL

CamusDB uses a compact SQL dialect for database lifecycle, schema changes,
writes, reads, indexes, and transactions.

SQL keywords are case-insensitive. Unquoted identifiers and backtick identifiers
are normalized to lowercase.

## Statement Reference

| Area | Page |
| --- | --- |
| Database lifecycle | [Databases](/docs/databases) |
| Database branching | [Database Branching](/docs/database-branching) |
| SQL comments | [SQL Comments](/docs/sql-comments) |
| Tables, columns, and schema changes | [Tables And Schema](/docs/sql-schema) |
| Column types and literal formats | [Data Types](/docs/data-types) |
| Indexes and index DDL | [Indexes](/docs/sql-indexes) |
| Inserts, updates, and deletes | [Writing Data](/docs/sql-writes) |
| SELECT, filters, grouping, and ordering | [Querying Data](/docs/sql-queries) |
| Query result caching | [Query Result Cache](/docs/query-result-cache) |
| Transactions | [SQL Transactions](/docs/sql-transactions) |
| SHOW, DESCRIBE, and EXPLAIN | [Schema Inspection](/docs/sql-inspection) |
| Parameter placeholders | [SQL Parameters](/docs/sql-parameters) |

## Common Workflow

```camussql
CREATE DATABASE IF NOT EXISTS app;

CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  year INT64 DEFAULT (2024)
);

CREATE INDEX robots_year_idx ON robots (year DESC);

INSERT INTO robots (id, name, year)
VALUES (GEN_ID(), "R2-D2", 1977);

SELECT id, name, year
FROM robots
WHERE year >= 1970
ORDER BY year DESC;
```

## Query Features

For joins, subqueries, derived tables, grouped aggregate behavior, table hints,
and planner notes, see [Query Features](/docs/query-features).

For plan selection and plan inspection, see [Query Planning](/docs/query-planning)
and [Explaining Queries And Commands](/docs/explain). For opt-in caching of
repeated single-table reads, see [Query Result Cache](/docs/query-result-cache).
