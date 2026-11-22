---
sidebar_position: 1
description: "Install CamusDB and run your first SQL: create a database and a table, insert and query rows, and add an index from camus-cli, the Web Console, or the browser playground."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import CamusPlayground, {tutorialExamples} from '@site/src/components/CamusPlayground';

# CamusDB tutorial

This tutorial takes you from install to working SQL. You start a CamusDB node,
create a database and a table, and then query and change rows. You can use the
`camus-cli` terminal shell or the Web Console. You can also try the steps first
in the browser playground.

CamusDB is an open-source distributed SQL database with a full relational
engine. The SQL in this tutorial works the same on one node and on a cluster.
This means that you can start small and add nodes later. To see what CamusDB
adds to a single-node database, read [Why CamusDB?](/docs/why-camusdb).

## Try it in your browser

You can execute the tutorial commands here before you install anything. The
playground starts with a `playground` database. You can also create a database
and select it with the database selector.

Each step explains its SQL. Click **Run** to execute a step, then click
**Next**. **Next** becomes available after the current step succeeds. This
means that the steps execute in order. **Prev** goes back to an earlier step.
You can also edit the SQL before you execute it.

<CamusPlayground
  compact
  guided
  seedScript=""
  examples={tutorialExamples}
  initialSql={tutorialExamples[0].sql}
  runExampleOnSelect={false}
  title="Run the tutorial here"
  description="This is the real CamusDB engine compiled to WebAssembly, as a single in-memory node in this browser tab."
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

Each of the following tabs starts a standalone node, with HTTP on port `5095`
and gRPC on port `5096`. For service setup and updates, see
[Server installation](/docs/server-installation).

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
includes its .NET runtime. You don't need to install .NET to run it:

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

The data is stored in the `camus-data` volume, and it is kept after the
container exits. To stop the container, press Ctrl+C.

</TabItem>
</Tabs>

Keep the server running, and open another terminal for the SQL client.

## Connect with a SQL client {#connect-with-the-sql-shell}

Choose the terminal shell or the Web Console. Both connect to the node that you
started, and they execute the same SQL. To install them, you need the .NET 10
SDK, also when you installed the server with Homebrew or Docker.

<Tabs groupId="camusdb-client" defaultValue="cli">
<TabItem value="cli" label="camus-cli">

Install the [SQL shell](/docs/camus-cli) and open it in another terminal:

```bash
dotnet tool install --global CamusDB.SqlSh
camus-cli
```

The shell connects to the local server. It tries gRPC on port `5096`. If that
fails, it tries REST on port `5095`. A `camus>` prompt means that you can enter
SQL.

</TabItem>
<TabItem value="webconsole" label="Web Console">

Install the [Web Console](/docs/web-console) and point it at the local server:

```bash
dotnet tool install --global CamusDB.WebConsole
camusdb-webconsole --endpoint http://localhost:5095
```

The console opens your browser at `http://127.0.0.1:5164`. Enter SQL in the
editor and click **Run statement**, or press Ctrl/Cmd+Enter. To execute several
statements in order, use **Run script** (Alt+X). The results appear in tabs.

To change the connection, such as the endpoint or the credentials, use
**Configure**. To run the console in a container, follow the
[Docker instructions](/docs/web-console#run-it-with-docker).

</TabItem>
</Tabs>

## Create a database

Create the tutorial database at the prompt or in the editor of your client:

```camussql
CREATE DATABASE factory;
```

Then select it for the next steps:

- **camus-cli:** run `USE factory;`. In a later session, you can start the
  shell with `camus-cli factory`.
- **Web Console:** click `factory` in the database sidebar, or select it as the
  session database in **Configure**.

The database must exist before you select it.

## Create a table

Create a table for robots:

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
| `id` | `OID` | The primary key, an object id. |
| `name` | `STRING` | The robot name. Required. |
| `kind` | `STRING` | The category or model family. Required. |
| `year` | `INT64` | Optional, with a default value. |

For UUID identifiers, use the native `UUID` type. A `UUID` column stores a
compact 128-bit value, and its index keys are smaller than those of the text
form.

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
┌───────┬────────┬──────┬─────┬─────────┬───────┐
│ Field │ Type   │ Null │ Key │ Default │ Extra │
├───────┼────────┼──────┼─────┼─────────┼───────┤
│ id    │ OID    │ NO   │ PRI │ NULL    │       │
│ name  │ STRING │ NO   │     │ NULL    │       │
│ kind  │ STRING │ NO   │     │ NULL    │       │
│ year  │ INT64  │ YES  │     │ 2024    │       │
└───────┴────────┴──────┴─────┴─────────┴───────┘
4 rows in set (00:00:00.0006060)
```

`DESCRIBE robots` returns the same result.

Show the SQL definition of the table:

```camussql
SHOW CREATE TABLE robots;
```

```text
┌────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Table  │ Create Table                                                                                                                                     │
├────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ robots │ CREATE TABLE `robots` ( `id` OID NOT NULL, `name` STRING NOT NULL, `kind` STRING NOT NULL, `year` INT64 NULL DEFAULT(2024), PRIMARY KEY (`id`)); │
└────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
1 rows in set (00:00:00.0002822)
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

Use `DEFAULT` for the default value of a column:

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

`LIKE` and `ILIKE` match a pattern. `ILIKE` ignores case:

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

Aggregate the rows. An alias such as `AS robots` names the result column:

```camussql
SELECT COUNT(*) AS robots FROM robots;
```

```text
┌────────┐
│ robots │
├────────┤
│ 4      │
└────────┘
1 rows in set (00:00:00.0004500)
```

```camussql
SELECT MIN(year) AS oldest, MAX(year) AS newest FROM robots;
```

```text
┌────────┬────────┐
│ oldest │ newest │
├────────┼────────┤
│ 1977   │ 2024   │
└────────┴────────┘
1 rows in set (00:00:00.0003960)
```

## Create an index

An index lets CamusDB find the matching rows, and it doesn't need to scan the
table.

```camussql
CREATE INDEX robots_kind_idx ON robots (kind);
```

Inspect the indexes:

```camussql
SHOW INDEXES FROM robots;
```

```text
┌────────┬────────────┬─────────────────┬─────────┬─────────┬────────────┬────────────┬─────────┐
│ Table  │ Non_unique │ Key_name        │ Columns │ Include │ Index_type │ Directions │ Comment │
├────────┼────────────┼─────────────────┼─────────┼─────────┼────────────┼────────────┼─────────┤
│ robots │ 0          │ ~pk             │ id      │         │ ORDERED    │ ASC        │ null    │
│ robots │ 1          │ robots_kind_idx │ kind    │         │ ORDERED    │ ASC        │ null    │
└────────┴────────────┴─────────────────┴─────────┴─────────┴────────────┴────────────┴─────────┘
2 rows in set (00:00:00.0003500)
```

`~pk` is the unique index of the primary key.

## Rename schema objects

You can rename tables and columns. A rename doesn't rewrite the rows:

```camussql
ALTER TABLE robots RENAME COLUMN kind TO category;
ALTER TABLE robots RENAME TO machines;
```

## Update rows

CamusDB requires a `WHERE` clause on `UPDATE`. PostgreSQL and MySQL don't. To
update all the rows, write `WHERE true`.

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

```text
┌───────┬──────┐
│ name  │ year │
├───────┼──────┤
│ T-800 │ 1982 │
└───────┴──────┘
1 rows in set (00:00:00.0006807)
```

## Delete rows

`DELETE` also requires a `WHERE` clause. To delete all the rows, write
`WHERE true`.

```camussql
DELETE FROM machines
WHERE name = 'K-2SO';
```

## Next steps

To learn more SQL, read the following pages:

- [SQL overview](/docs/sql)
- [Data types](/docs/data-types)
- [Tables and columns](/docs/sql-schema)
- [SELECT](/docs/sql-queries), for filtering and grouping
- [Joins and subqueries](/docs/joins-and-subqueries)

## Connect an application

To connect an application, use a driver:

- [.NET driver](/docs/dotnet-driver)
- [TypeScript connector](/docs/typescript-connector)
- [Python driver](/docs/python-driver)

The drivers bind parameters and manage transactions. They also have helpers
for retryable conflicts.

## Explore complete sample applications

The [advanced samples](/docs/advanced-samples) are complete applications, such
as a bank and an online store. They show patterns such as retries and
idempotency.
