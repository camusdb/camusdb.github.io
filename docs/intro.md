---
sidebar_position: 1
---

# CamusDB tutorial

CamusDB is an open-source NewSQL distributed database. It runs on one node, or
on a cluster of several nodes. It gives an application a full relational engine,
and not a thin layer of SQL over a key/value store.

CamusDB includes these capabilities:

- [Transactional SQL](/docs/sql), for a schema, a write, a read, an index, and
  an aggregation. It also supports a join, a subquery, a derived table, a view,
  and a materialized view.
- [Serializable transactions](/docs/serializable-transactions) by default, with
  the detection of a conflict. CamusDB uses two-phase commit for a write across
  two partitions.
- [Distributed storage](/docs/cluster) on the Raft consensus, with a leader for
  each partition, and with a
  [replicated schema](/docs/distributed-schema).
- A [cost-based query planner](/docs/query-planning), with
  [`EXPLAIN`](/docs/explain), statistics, an
  [automatic analyze](/docs/automatic-analyze), and a
  [cache of the results](/docs/query-result-cache).
- A [branch of a database](/docs/database-branching), with a copy at the first
  write.
- A [time travel read](/docs/time-travel-reads), which reads the data at a point
  in the past.
- [Vector search](/docs/vector-search) over an embedding, with a distance
  function that the CPU accelerates.
- A [recoverable drop](/docs/recover-dropped-objects) of a database and of a
  table.
- Several interfaces: [`camus-cli`](/docs/camus-cli), a
  [web console](/docs/web-console), an [HTTP API](/docs/http-api), a
  [gRPC API](/docs/grpc-api), a [driver for .NET](/docs/dotnet-driver), a
  [provider for EF Core](/docs/ef-core), and a
  [server for the Model Context Protocol](/docs/mcp-server).

This tutorial uses `camus-cli`, which is the interactive shell of SQL. It walks
through the basic workflow, against a CamusDB node or a cluster that runs. The
workflow has six steps:

1. Create a database.
2. Create a table.
3. Insert some rows.
4. Query the data.
5. Add an index.
6. Update a row, and delete one.

Start with [Why CamusDB?](/docs/why-camusdb) for an overview at a higher level.
That page explains the design of CamusDB as a distributed database of SQL.

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

```camussql
CamusDB SQL Shell 0.11.0

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
camus> show tables
┌────────┐
│ tables │
├────────┤
│ robots │
└────────┘
1 rows in set (00:00:00.0526560)
```

Show the columns of `robots`:

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

Three other commands of an inspection are useful:

```camussql
DESCRIBE robots;
SHOW CREATE TABLE robots;
SHOW INDEX FROM robots;
```

Show the definition in SQL of the table:

```camussql
camus> show create table robots;
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

Filter the result with a `WHERE` clause:

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

`LIKE` and `ILIKE` match a pattern:

```camussql
camus> SELECT id, name FROM robots WHERE name ILIKE "r%";
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

An `UPDATE` in SQL needs a `WHERE` clause.

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

A `DELETE` in SQL also needs a `WHERE` clause.

```camussql
DELETE FROM machines
WHERE name = "K-2SO";
```

## Column types

| SQL type | Notes |
| --- | --- |
| `OID` | Native object id values. |
| `UUID` | Native 128-bit UUID values. Prefer this over `STRING` for UUID identifiers. |
| `INT64` | Signed 64-bit integers. |
| `FLOAT64` | Double-precision floating point values. |
| `FLOAT32` | Single-precision floating point values. |
| `BOOL` | Boolean values. |
| `STRING`, `STRING(N)` | Text values, optionally with a maximum length. |
| `DATE`, `DATETIME` | Calendar dates and UTC instants. |
| `BYTES` | Opaque byte strings. |
| `ARRAY(T)` | Ordered lists of scalar values. |

Continue with three pages: the [SQL overview](/docs/sql),
[Data Types](/docs/data-types), and
[Tables And Columns](/docs/sql-schema).

Then read [SELECT](/docs/sql-queries) for a filter, a group, and an order. Read
[Joins And Subqueries](/docs/joins-and-subqueries) for a join, a subquery, and a
derived table.
