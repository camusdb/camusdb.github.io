---
sidebar_position: 7.3
---

# camus-dump

`camus-dump` is a logical backup utility for CamusDB.

It connects to a CamusDB database, reads every table, and writes a SQL dump
that can be replayed later to rebuild the schema and table data.

From the current source code, the tool:

- dumps the whole database
- emits `CREATE TABLE` statements
- emits `INSERT INTO` statements for every row
- writes the dump to standard output

## Install

Install the global tool:

```bash
dotnet tool install --global CamusDB.Dump
```

The executable name is:

```bash
camus-dump
```

## Basic Usage

Run with the built-in default connection:

```bash
camus-dump
```

From the current source code, the default connection string is:

```text
Endpoint=https://localhost:7141;Database=test
```

Use an explicit connection string with `-c` when your node or database differs:

```bash
camus-dump -c "Endpoint=http://localhost:5095;Database=northwind"
```

## Command Line Options

Current options from source:

| Option | Description |
| --- | --- |
| `-c`, `--connection-source` | Full connection string. |

There is no separate `--database`, `--table`, or output-file option in the
current implementation.

## Save A Dump To A File

Because the tool writes SQL to standard output, redirect it in the shell:

```bash
camus-dump -c "Endpoint=http://localhost:5095;Database=mydb" > mydb.sql
```

## What The Dump Contains

For each table returned by `SHOW TABLES`, the tool does two things:

1. runs `SHOW CREATE TABLE <table>`
2. runs `SELECT * FROM <table>`

The output is a SQL stream with:

- one `CREATE TABLE` statement per table
- one `INSERT INTO` statement per row

Typical shape:

```sql
CREATE TABLE `robots` (
  `id` OID PRIMARY KEY NOT NULL,
  `name` STRING NOT NULL,
  `year` INT64
);

INSERT INTO `robots` (`id`, `name`, `year`) VALUES (STR_ID("507f1f77bcf86cd799439011"), "R2-D2", 1977);
INSERT INTO `robots` (`id`, `name`, `year`) VALUES (STR_ID("507f1f77bcf86cd799439012"), "C-3PO", 1977);
```

## Value Encoding

From the current implementation:

- `OID` values are emitted as `STR_ID("...")`
- strings are double-quoted
- double quotes inside strings are escaped
- `INT64` values are emitted as integers
- `FLOAT64` values are emitted as numeric literals
- `BOOL` values are emitted as `True` or `False` from the .NET boolean string
  conversion
- unknown or unsupported values fall back to `null`

## Restore A Dump

The utility does not include a restore command. To restore a dump, run the SQL
through `camus-cli`:

```bash
camus-cli -c "Endpoint=http://localhost:5095;Database=mydb"
```

Then load the generated file:

```sql
source ./mydb.sql
```

See [camus-cli](/docs/camus-cli) for shell usage.

## Connection Behavior

Before dumping, the tool:

- builds a `CamusConnection`
- opens it
- runs a ping command

If the target is unreachable or the connection string is wrong, the dump fails
before any output is produced.

## Current Limitations

Documenting the current source behavior:

- no table filter
- no schema-only mode
- no data-only mode
- no output-file flag
- no compression
- no parallel dump
- no restore command

So while it is useful for straightforward logical backups, it is still a narrow
utility.

## When To Use It

Use `camus-dump` when you want:

- a quick logical backup of a CamusDB database
- SQL output that is easy to inspect
- a dump you can replay with `camus-cli`

For interactive restore and manual replay, use [camus-cli](/docs/camus-cli).
