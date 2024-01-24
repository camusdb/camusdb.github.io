---
sidebar_position: 1
---

# CamusDB

This tutorial provides step-by-step instructions on key CamusDB SQL statements, utilizing an interactive SQL shell linked to a temporary, single-node CamusDB cluster.

To view a comprehensive list of all the SQL statements supported and their specifics, please refer to the 'SQL Statements' section.

## Start CamusDB

Before proceeding, ensure that CamusDB is installed on your system.

After installation, execute the command "camus test" to proceed.

```shell shell
$ camusdb test
```

## Create tables

Suppose you want to offer robot-assisted services, in addition to robot manufacturing. You'll need to add a table for the robot operators to the "test" database. To create a table, use the **CREATE TABLE** command followed by a table name, the column names, and the data type and constraints, if applicable, for each column:

```sql
camus> CREATE TABLE robots (
  id OID PRIMARY KEY,
  name STRING NULL, 
  type STRING NULL, 
  year INT64 NULL
);

Query OK, 0 rows affected (00:00:00.0100869)
```

To display all the columns from a specific table, use the command **SHOW COLUMNS FROM table.**:

```sql
camus>  show columns from robots
┌───────┬───────────┬──────┬─────┬─────────┬───────┐
│ Field │ Type      │ Null │ Key │ Default │ Extra │
├───────┼───────────┼──────┼─────┼─────────┼───────┤
│ id    │ Id        │ NO   │ KEY │ NULL    │       │
│ name  │ String    │ YES  │     │ NULL    │       │
│ type  │ String    │ YES  │     │ NULL    │       │
│ year  │ Integer64 │ YES  │     │ NULL    │       │
└───────┴───────────┴──────┴─────┴─────────┴───────┘
4 rows in set (00:00:00.0037)
```

In case it has caught your attention, the data type ID is a special type that represents a unique identifier generated at a specific node and point in time, which has the property of being sortable. If you do not wish to use the OID type for the primary key, UUIDs, STRINGs or INTs can be used instead.

## Show tables and columns

To view all tables in the currently active database, utilize the **SHOW TABLES** SQL statement:

```sql
camus> show tables
```

Following this command, the output displayed on the screen will show the list of tables.

```sql
camus>  show tables
┌────────┐
│ tables │
├────────┤
│ robots │
└────────┘
1 rows in set (00:00:00.0046)
```

## Insert rows

To add a new row to a table, use the command **INSERT INTO** followed by the table name, and then list the values for each column in the same order as they appear in the table.

```sql
camus>  insert into robots values (gen_id(), "Automaton", "humanoid machinery", 1940)
Query OK, 1 rows affected (00:00:00.0301)
```

If you want to input column values in an order different from their arrangement in the table, explicitly specify the column names first, followed by their respective values in the corresponding order.

```sql
camus>  insert into robots (id, name, type, year) values (gen_id(), "Automaton", "humanoid machinery", 1940)
Query OK, 1 rows affected (00:00:00.0207)
```
