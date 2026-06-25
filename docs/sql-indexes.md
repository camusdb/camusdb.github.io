---
sidebar_position: 2.2
---

# Indexes

Primary keys and unique columns create indexes. Additional indexes can be added
with either `CREATE INDEX` or `ALTER TABLE`.

## Create Indexes

```camussql
CREATE INDEX robots_year_idx ON robots (year DESC);
CREATE UNIQUE INDEX robots_name_idx ON robots (name);
```

Multi-column unique indexes are supported:

```camussql
CREATE UNIQUE INDEX robots_kind_year_uq ON robots (kind, year);
```

## Alter Table Index DDL

```camussql
ALTER TABLE robots ADD INDEX robots_kind_year_idx (kind, year DESC);
ALTER TABLE robots ADD UNIQUE INDEX robots_code_year_uq (code, year);
ALTER TABLE robots DROP INDEX robots_kind_year_idx;
```

## Rename Indexes

```camussql
ALTER TABLE robots RENAME INDEX robots_name_idx TO robots_display_name_idx;
```

Index rename changes the schema name for the index and preserves the underlying
index data. The old index name is removed from schema inspection after the
rename.

Renaming a missing index or renaming to an existing index name currently fails
with `InvalidInput`.

## Query Planning

Indexes can drive point lookups, range scans, indexed `IN (...)` probes,
ordered scans, and indexed joins.

For planner behavior, see [Query Planning](/docs/query-planning). For query
syntax examples that use indexes, see [Query Features](/docs/query-features).
