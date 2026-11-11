---
sidebar_position: 1
description: "Install CamusDB and run your first SQL: create a database and a table, insert and query rows, and add an index from camus-cli, the Web Console, or the browser playground."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import CamusPlayground, {tutorialExamples} from '@site/src/components/CamusPlayground';

# CamusDB tutorial

This tutorial takes you from install to working SQL. You start a CamusDB node,
create a database and a table, insert and query rows, add an index, rename
objects, and update and delete data. Use the `camus-cli` terminal shell or
the Web Console, or try every step in the embedded browser playground first.

CamusDB is an open-source distributed SQL database with a full relational
engine, not a thin SQL layer over a key/value store. The SQL in this tutorial
runs the same on one node or on a cluster, so you can start small and add nodes
later. To see what CamusDB adds over a single-node database, read
[Why CamusDB?](/docs/why-camusdb).

## Try it in your browser

You can run the tutorial commands here before installing anything. The embedded
playground starts with a pre-created `playground` database, but you can also
create your own and switch to it with the database selector. Each step
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

Choose one installation method. Each starts a standalone node with the HTTP
API on port `5095` and gRPC on `5096`. For service setup, data locations, and
updates, see [Server installation](/docs/server-installation).

<Tabs groupId="camusdb-install" defaultValue="nuget">
<TabItem value="nuget" label="NuGet tool">

Install the [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
then install the server as a global tool and start it:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

</TabItem>
<TabItem value="homebrew" label="Homebrew">

On macOS or Linux, install with [Homebrew](https://brew.sh). The server package
includes its .NET runtime; no separate .NET installation is needed to run it:

```bash
brew install camusdb/tap/camusdb
camusdb
```

</TabItem>
<TabItem value="docker" label="Docker">

With Docker running, start the published image:

```bash
docker run --rm \
  -p 5095:5095 \
  -p 5096:5096 \
  -v camus-data:/data \
  --name camusdb camusdb/camusdb:latest
```

The named `camus-data` volume preserves data after the container exits.
Stop it with Ctrl+C.

</TabItem>
</Tabs>

## Connect with a SQL client {#connect-with-the-sql-shell}

Choose the terminal shell or the browser-based Web Console. Both connect to
the node you started above and run the same SQL. The tool installation commands
below require the .NET 10 SDK, including when the server runs through Homebrew
or Docker.

<Tabs groupId="camusdb-client" defaultValue="cli">
<TabItem value="cli" label="camus-cli">

Install the [SQL shell](/docs/camus-cli) and open it in another terminal:

```bash
dotnet tool install --global CamusDB.SqlSh
camus-cli
```

The shell connects to the local server, trying gRPC on port `5096` first and
REST on `5095` as a fallback. A `camus>` prompt means you can enter SQL.

</TabItem>
<TabItem value="webconsole" label="Web Console">

Install the [Web Console](/docs/web-console) and point it at the local server:

```bash
dotnet tool install --global CamusDB.WebConsole
camusdb-webconsole --endpoint http://localhost:5095
```

The console opens your browser at `http://127.0.0.1:5164`. Enter SQL in the
editor and click **Run statement**, or press Ctrl/Cmd+Enter. Use **Run script**
(Alt+X) to execute several statements in order. Results appear in tabs.

Use **Configure** to change the endpoint, protocol, database, or credentials.
If you prefer to run the console without installing .NET, follow the
[Docker instructions](/docs/web-console#run-it-with-docker).

</TabItem>
</Tabs>

## Create a database

Create the tutorial database in your chosen client's SQL editor or prompt:

```camussql
CREATE DATABASE factory;
```

Then select it for the remaining steps:

- **camus-cli:** run `USE factory;`. For later sessions, you can start the
  shell with `camus-cli factory`.
- **Web Console:** click `factory` in the database sidebar, or select it in
  **Configure** as the session database.

The database must exist before you select it. The statements below run in
`factory` in either client.

## Create a table

Create a table to store robots:

```camussql
CREATE TABLE robots (
  id OID PRIMARY KEY NOT NULL,
  name STRING NOT NULL,
  kind STRING NOT NULL,
  year INT64 DEFAULT (2024)
);
```

The table has four columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `OID` | Primary key object id. |
| `name` | `STRING` | Required robot name. |
| `kind` | `STRING` | Required category or model family. |
| `year` | `INT64` | Optional year with a default value. |

For UUID identifiers, use the native `UUID` type instead of `STRING`. A `UUID`
column stores a compact 128-bit value and produces smaller index keys than the
UUID's text form.

## Inspect the schema

Show the tables in the current database:

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

These commands are also useful for inspecting a table:

```camussql
DESCRIBE robots;
SHOW CREATE TABLE robots;
SHOW INDEX FROM robots;
```

Show the table's SQL definition:

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
VALUES (GEN_ID(), 'R2-D2', 'utility', 1977);
```

Insert several rows with one statement:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES
  (GEN_ID(), 'C-3PO', 'protocol', 1977),
  (GEN_ID(), 'T-800', 'android', 1984);
```

Use `DEFAULT` to have CamusDB apply the column's default value:

```camussql
INSERT INTO robots (id, name, kind, year)
VALUES (GEN_ID(), 'K-2SO', 'security', DEFAULT);
```

## Query rows

Select the rows in the table:

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
SELECT id, name FROM robots WHERE name ILIKE 'r%';
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

An index lets CamusDB find matching rows without scanning every row in the
table.

```camussql
CREATE INDEX robots_kind_idx ON robots (kind);
```

Inspect the indexes:

```camussql
SHOW INDEXES FROM robots;
```

## Rename schema objects

You can rename tables and columns. CamusDB does not rewrite any row data:

```camussql
ALTER TABLE robots RENAME COLUMN kind TO category;
ALTER TABLE robots RENAME TO machines;
```

## Update rows

Unlike PostgreSQL and MySQL, CamusDB requires a `WHERE` clause on every
`UPDATE`. To update every row, write `WHERE true`.

```camussql
UPDATE machines
SET year = 1982
WHERE name = 'T-800';
```

Confirm the change:

```camussql
SELECT name, year
FROM machines
WHERE name = 'T-800';
```

## Delete rows

CamusDB also requires a `WHERE` clause on every `DELETE`. To delete every row,
write `WHERE true`.

```camussql
DELETE FROM machines
WHERE name = 'K-2SO';
```

Next, read the [SQL overview](/docs/sql), [Data Types](/docs/data-types), and
[Tables And Columns](/docs/sql-schema).

Then read [SELECT](/docs/sql-queries) to learn filtering, grouping, and
ordering, and [Joins And Subqueries](/docs/joins-and-subqueries) for joins,
subqueries, and derived tables.

## Connect an application

Use the [.NET driver](/docs/dotnet-driver),
[TypeScript connector](/docs/typescript-connector), or
[Python driver](/docs/python-driver). They provide parameter binding, query
results, and transaction APIs, with helpers for retryable conflicts. The
libraries handle the HTTP/JSON or gRPC messages behind those APIs.

## Ready for more?

Explore the [advanced samples](/docs/advanced-samples) to see CamusDB in
complete ecommerce, banking, and booking applications. They demonstrate
transactions, retries, idempotency, concurrency, database branching, and
failure handling through .NET, EF Core, and TypeScript.
