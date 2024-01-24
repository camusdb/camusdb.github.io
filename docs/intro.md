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
  name STRING NOT NULL, 
  type STRING NOT NULL, 
  year INT64 DEFAULT (2024)
);

Query OK, 0 rows affected (00:00:00.0100869)
```

To display all the columns from a specific table, use the command **SHOW COLUMNS FROM table.**:

```sql
camus>  show columns from robots
┌───────┬───────────┬──────┬─────┬─────────┬───────┐
│ Field │ Type      │ Null │ Key │ Default │ Extra │
├───────┼───────────┼──────┼─────┼─────────┼───────┤
│ id    │ Id        │ NO   │ PRI │ NULL    │       │
│ name  │ String    │ NO   │     │ NULL    │       │
│ type  │ String    │ NO   │     │ NULL    │       │
│ year  │ Integer64 │ YES  │     │ 2024    │       │
└───────┴───────────┴──────┴─────┴─────────┴───────┘
4 rows in set (00:00:00.0285787)
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

When you omit certain columns from your statement or explicitly opt for default values, the system uses DEFAULT settings. For instance, in the examples below, both statements result in the creation of a row where the 'year' is populated with its default value, which in this scenario is the number 2024:

```sql
camus>  insert into robots values (gen_id(), "Terminator", "killer robot", DEFAULT)
Query OK, 1 rows affected (00:00:00.0071)

camus>  insert into robots (id, name, type) values (gen_id(), "R2-D2", "utility")
Query OK, 1 rows affected (00:00:00.0059)
```

```sql
camus> select * from robots where name = "Terminator" or name = "R2-D2"
┌──────────────────────────┬────────────┬──────────────┬──────┐
│ id                       │ name       │ type         │ year │
├──────────────────────────┼────────────┼──────────────┼──────┤
│ 65b1004b2ac52b3351440895 │ Terminator │ killer robot │ 2024 │
│ 65b101e72ac52b335144089a │ R2-D2      │ utility      │ 2024 │
└──────────────────────────┴────────────┴──────────────┴──────┘
2 rows in set (00:00:00.0057802)
```

## Create indexes

Indexes facilitate the retrieval of data by allowing the system to find information without scanning each row in a table. Tables automatically generate indexes for the primary key and for columns designated as UNIQUE.

For columns that aren't unique, you can establish an index by using the CREATE INDEX command, followed optionally by a name for the index, and the ON clause to specify the table and the column(s) you want to index. Additionally, for each column, you have the option to arrange the data in ascending (ASC) or descending (DESC) order.

```sql
camus> CREATE INDEX type_idx ON robots (type DESC)
Query OK, 0 rows affected (00:00:00.013)
```

## Show indexes

To display the indexes of a table, utilize the command SHOW INDEX FROM, followed by the specific table's name:

```sql
camus> show index from robots
┌────────┬────────────┬──────────┬────────────┐
│ Table  │ Non_unique │ Key_name │ Index_type │
├────────┼────────────┼──────────┼────────────┤
│ robots │ 0          │ ~pk      │ BTREE      │
│ robots │ 1          │ type_idx │ BTREE      │
└────────┴────────────┴──────────┴────────────┘
2 rows in set (00:00:00.054)
```

## Query tables

To retrieve data from a table, use the SELECT command followed by the columns you want to return, separated by commas, and specify the table from which the data should be extracted.

```sql
camus> select name, type from robots
┌────────────┬──────────────┐
│ name       │ type         │
├────────────┼──────────────┤
│ Terminator │ killer robot │
│ R2-D2      │ utility      │
└────────────┴──────────────┘
2 rows in set (00:00:00.003)
```

To narrow down the results, incorporate a `WHERE` clause that specifies the columns and the corresponding values you wish to use as filters.

```sql
camus> select * from robots where year = 2024
┌──────────────────────────┬────────────┬──────────────┬──────┐
│ id                       │ name       │ type         │ year │
├──────────────────────────┼────────────┼──────────────┼──────┤
│ 65b1004b2ac52b3351440895 │ Terminator │ killer robot │ 2024 │
│ 65b101e72ac52b335144089a │ R2-D2      │ utility      │ 2024 │
└──────────────────────────┴────────────┴──────────────┴──────┘
2 rows in set (00:00:00.007)
```

# Update rows

To modify rows in a table, employ the `UPDATE` command followed by the name of the table, then a SET clause to specify the columns to be updated along with their new values, and finally, a `WHERE` clause to pinpoint the rows that should be updated.

```sql
camus> update robots set year = 1982 where name = "Terminator"
Query OK, 1 rows affected (00:00:00.090)
```

```sql
camus> select * from robots
┌──────────────────────────┬────────────┬──────────────┬──────┐
│ id                       │ name       │ type         │ year │
├──────────────────────────┼────────────┼──────────────┼──────┤
│ 65b1004b2ac52b3351440895 │ Terminator │ killer robot │ 1982 │
│ 65b101e72ac52b335144089a │ R2-D2      │ utility      │ 2024 │
└──────────────────────────┴────────────┴──────────────┴──────┘
2 rows in set (00:00:00.003)
```

In CamusDB, the WHERE clause is mandatory for all updates. This is to avoid massive row updates by mistake.