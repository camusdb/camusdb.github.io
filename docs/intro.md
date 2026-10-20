---
sidebar_position: 1
---

import CamusPlayground, {tutorialExamples} from '@site/src/components/CamusPlayground';

# CamusDB tutorial

This tutorial takes you from install to working SQL. You start a CamusDB node,
create a database and a table, insert and query rows, add an index, rename
objects, and update and delete data. You do it all from `camus-cli`, the
interactive SQL shell, and you can try every step in your browser first.

CamusDB is an open-source distributed SQL database with a full relational
engine, not a thin SQL layer over a key/value store. The SQL in this tutorial
runs the same on one node or on a cluster, so you can start small and add nodes
later. To see what CamusDB adds over a single-node database, read
[Why CamusDB?](/docs/why-camusdb).

## Try it in your browser

You can run the tutorial commands here before installing anything. The embedded
playground starts with a pre-created `playground` database, but you can also
create your own database and switch with the database selector. Each step
explains what its SQL does. Click **Run** to execute a step, then click
**Next**. **Next** unlocks only after the current step runs without an error,
so the steps always run in order. **Prev** goes back to an earlier step. You
can also edit the SQL before running it.

<CamusPlayground
  compact
  guided
  seedScript=""
  examples={tutorialExamples}
  initialSql={tutorialExamples[0].sql}
  runExampleOnSelect={false}
  title="Run the tutorial here"
  description="This is the real CamusDB engine compiled to WebAssembly. It runs as a single in-memory node inside this browser tab."
/>

## Video walkthrough

<div className="video-embed">
  <iframe
    src="https://www.youtube.com/embed/ZgoMD2gXaWA"
    title="CamusDB tutorial video"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  />
</div>

## Start CamusDB

CamusDB ships as a global tool of .NET. Install the
[.NET runtime](https://dotnet.microsoft.com/en-us/download/dotnet/10.0) first.
Then install the server, and start a standalone node:

```bash
$ dotnet tool install --global CamusDB.Server
$ camusdb
```

The `camusdb` command starts with its built-in defaults when no file of a
configuration exists. It stores the data under the data directory of the user.
It listens on the HTTP port `5095`, and on the gRPC port `5096`:

```bash
   ____                          ____  ____
  / ___|__ _ _ __ ___  _   _ ___|  _ \| __ )
 | |   / _` | '_ ` _ \| | | / __| | | |  _ \
 | |__| (_| | | | | | | |_| \__ \ |_| | |_) |
  \____\__,_|_| |_| |_|\__,_|___/____/|____/

Configuration: built-in defaults (no configuration file found)
Data directory: /Users/runner/.local/share/camusdb
```

Update the installed server:

```bash
$ dotnet tool update --global CamusDB.Server
```

Run this command to create a configuration of a start, under your own
ownership:

```bash
$ camusdb init
```

That command writes `~/.camusdb/config.yml`. It also creates the default data
directory. Edit the file. Then run `camusdb` again.

You can also start CamusDB with Docker:

```bash
$ docker run --rm \
        -p 5095:5095 \
        -p 5096:5096 \
        -v camus-data:/data \
        --name camusdb camusdb/camusdb:latest
```

Install the shell of SQL:

```bash
$ dotnet tool install --global CamusDB.SqlSh
```

Then open the shell of SQL, in another terminal:

```bash
$ camus-cli
```

An interactive prompt appears:

```text
CamusDB SQL Shell 0.16.0

Connected to http://localhost:5096 over gRPC, database: (none)

camus>
```

## Create a database

You must create a database explicitly before you use it. Create a database.
Then move the shell to it:

```camussql
camus> CREATE DATABASE factory;
Query OK, 0 rows affected (00:00:00.0711685)

camus> use factory;
Database changed to factory
```

You can start the shell with `camus-cli factory`. You nevertheless still need
the statement `CREATE DATABASE factory;`, at the first use of that name of a
database.

## Create a table

Create a table for the records of a robot:

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024)
);
```

The table holds four columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `OID` | Primary key object id. |
| `name` | `STRING` | Required robot name. |
| `kind` | `STRING` | Required category or model family. |
| `year` | `INT64` | Optional year with a default value. |

For an identifier of a UUID, use the native type `UUID`. Do not use a `STRING`.
A `UUID` column stores a compact value of 128 bits. It also uses a smaller key of
an index than the text of a UUID.

## Inspect the schema

Show the tables of the current database:

```camussql
SHOW TABLES;
```

```text
┌────────┐
│ tables │
├────────┤
│ robots │
└────────┘
1 rows in set (00:00:00.0526560)
```

Show the columns of `robots`:

```camussql
SHOW COLUMNS FROM robots;
```

```text
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

Three other commands of an inspection are useful:

```camussql
DESCRIBE robots;
SHOW CREATE TABLE robots;
SHOW INDEX FROM robots;
```

Show the definition in SQL of the table:

```camussql
SHOW CREATE TABLE robots;
```

```text
┌────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Table  │ Create Table                                                                                                                       │
├────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ robots │ CREATE TABLE `robots` ( `id` OID NOT NULL, `name` STRING NOT NULL, `kind` STRING NOT NULL, `year` INT64 NULL, PRIMARY KEY (`id`)); │
└────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
1 rows in set (00:00:00.0037082)
```

## Insert rows

Insert one row:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "R2-D2", "utility", 1977);
```

Insert more than one row, with one statement:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES
  (GEN_ID(), "C-3PO", "protocol", 1977),
  (GEN_ID(), "T-800", "android", 1984);
```

Use `DEFAULT` when CamusDB must apply the default of the column:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), "K-2SO", "security", DEFAULT);
```

## Query rows

Select the rows of the table:

```camussql
SELECT id, name, kind, year FROM robots ORDER BY year ASC;
```

```text
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

Filter the result with a `WHERE` clause:

```camussql
SELECT name, year FROM robots WHERE year >= 1980;
```

```text
┌───────┬──────┐
│ name  │ year │
├───────┼──────┤
│ T-800 │ 1984 │
│ K-2SO │ 2024 │
└───────┴──────┘
2 rows in set (00:00:00.0298712)
```

`LIKE` and `ILIKE` match a pattern:

```camussql
SELECT id, name FROM robots WHERE name ILIKE "r%";
```

```text
┌──────────────────────────┬───────┐
│ id                       │ name  │
├──────────────────────────┼───────┤
│ 6a3dd713d615ae230488d7f2 │ R2-D2 │
└──────────────────────────┴───────┘
1 rows in set (00:00:00.0254039)
```

Aggregate the rows:

```camussql
SELECT COUNT(*) FROM robots;
SELECT MIN(year), MAX(year) FROM robots;
```

## Create an index

An index helps CamusDB. It then does not scan every row to find the matching
data.

```camussql
CREATE INDEX robots_kind_idx ON robots (kind);
```

Inspect the indexes:

```camussql
SHOW INDEXES FROM robots;
```

## Rename schema objects

You can rename a table, and a column. CamusDB rewrites no data of a row:

```camussql
ALTER TABLE robots RENAME COLUMN kind TO category;
ALTER TABLE robots RENAME TO machines;
```

## Update rows

CamusDB requires a `WHERE` clause on every `UPDATE`. PostgreSQL and MySQL do
not. To update every row, write `WHERE true`.

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

## Delete rows

CamusDB also requires a `WHERE` clause on every `DELETE`. To delete every row,
write `WHERE true`.

```camussql
DELETE FROM machines
WHERE name = "K-2SO";
```

Continue with three pages: the [SQL overview](/docs/sql),
[Data Types](/docs/data-types), and
[Tables And Columns](/docs/sql-schema).

Then read [SELECT](/docs/sql-queries) for a filter, a group, and an order. Read
[Joins And Subqueries](/docs/joins-and-subqueries) for a join, a subquery, and a
derived table.
