---
sidebar_position: 7.4
description: "camusdb-py connects Python applications to CamusDB through a DB-API 2.0 interface and a native asyncio interface, with named parameters and explicit transactions."
---

# Python driver

`camusdb-py` connects Python applications to CamusDB through the familiar DB-API 2.0 interface. It also has a native
asyncio interface for services that use asynchronous I/O. The driver handles the HTTP protocol and the
transaction handles. You bind
Python values, and you don't need to know the REST message format.

Use it for Python services and scripts. The package name is
`camusdb-py`, and the import name is `camusdb`. The source and integration
examples are in [camusdb-py](https://github.com/camusdb/camusdb-py). This page
describes version 0.2.3.

## Install

The driver needs Python 3.10 or later:

```bash
pip install camusdb-py
```

For HTTP/2 over HTTPS, install `'camusdb-py[http2]'` and pass `http2=True`. The
driver doesn't support gRPC or HTTP/3.

## Create a database and query it

Start CamusDB with the [installation guide](/docs/server-installation). This
example uses its default REST port, 5095:

```python
import camusdb

with camusdb.connect("Endpoint=http://localhost:5095;Database=shop") as conn:
    # Create the database once, with an account that can create databases.
    conn.create_database(if_not_exists=True)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id OID PRIMARY KEY NOT NULL,
            name STRING NOT NULL,
            stock INT64 NOT NULL
        )
    """)
    cursor = conn.execute(
        "INSERT INTO products (id, name, stock) VALUES (GEN_ID(), @name, @stock) RETURNING id",
        {"name": "kettle", "stock": 10},
    )
    (product_id,) = cursor.fetchone()
    conn.commit()

    for name, stock in conn.execute(
        "SELECT name, stock FROM products WHERE stock > @minimum",
        {"minimum": 0},
    ):
        print(name, stock)
```

`connect()` doesn't send a request. The database must exist before its first
data statement. At the end of the `with` block, the connection commits and closes. After an
exception, it rolls back. Schema DDL executes separately,
and a rollback doesn't undo it.

## Connection settings

Pass a connection string or keyword arguments. If you combine them, a keyword
overrides the same setting in the string:

```python
conn = camusdb.connect(
    "Endpoint=http://localhost:5095;Database=shop",
    timeout=30,
    autocommit=True,
)
```

| Keyword | Connection-string key | Default and behavior |
| --- | --- | --- |
| `endpoint` | `Endpoint` | Required. One REST URL or several URLs. |
| `database` | `Database` | Required. |
| `timeout` | `Timeout` | 10 seconds for each request. |
| `autocommit` | `Autocommit` | `False`: the first data statement begins a transaction. |
| `isolation_level` | `IsolationLevel` | The server default. `Serializable` or `ReadCommitted`. |
| `read_only` | `TransactionMode` | The server default. `True`/`False` in Python, or `ReadOnly`/`ReadWrite` in the string. |
| `locking` | `Locking` | The server default. `Pessimistic` or `Optimistic`. |
| `user`, `password` | `User`, `Password` | Optional sign-in credentials. |
| `access_token` | `AccessToken` | An optional bearer token that you manage. The driver doesn't renew it. |
| `http2` | `HttpVersion` | `False`. HTTP/2 needs the optional dependency and HTTPS. `HttpVersion=3` uses HTTP/2. |
| `token_lifetime` | `TokenLifetime` | 600 seconds, if the sign-in response doesn't give a lifetime. |
| `allow_insecure_credentials` | `AllowInsecureCredentials` | `False`. See [Authentication](#authentication). |
| `backup_endpoint` | `BackupEndpoint` | An optional REST node for backup administration. |
| `backup_timeout` | `BackupTimeout` | 300 seconds for each backup request. |
| `row_factory` | — | Tuple rows by default. |

An endpoint must have a valid host and port. It can't have a user name and
password in the URL, or `.` and `..` path segments. Pass credentials with `user`
and `password`. An invalid endpoint returns an error in `connect()`.

Connection-string keys aren't case-sensitive. Quote a value with semicolons,
and double an embedded quote, for example `Password='pa;ss''word'`. A repeated
key returns `CADB0400`. Before you log a connection string, use
`camusdb.redact_connection_string(text)`.

With several endpoints, requests rotate between the nodes, and a
transaction continues on the node where it began. An endpoint that doesn't answer is skipped for
30 seconds. The failed request raises `OperationalError` (`CADB0001`).
It isn't sent to another node: it can already have executed. Connections
to the same nodes share the rotation and health state in the process.

### Authentication

With `user` and `password`, the driver signs in and sends a cached bearer token
with later requests. Connections with the same nodes and credentials share the
cache in the process.

The driver renews the token in the background at 80% of its lifetime, and
requests continue to use the old token. A request waits for a sign-in when
there is no token, or when the token reaches 95% of its lifetime. After a failed
background renewal, the driver waits at least 5 seconds. A busy sign-in
(`CADB0518`) is retried up to three times. If a managed token is no longer valid, the driver
signs in again and sends the request once more.

Credentials need HTTPS, unless the endpoint is a loopback address. A plaintext
endpoint raises `InterfaceError` (`CADB0519`) in `connect()`. Set
`allow_insecure_credentials=True` only if a trusted TLS terminator is in front
of the plaintext hop. You can also call `conn.login(user, password)` and
`conn.logout()`. For users and grants, see
[SQL authentication](/docs/sql-authentication).

## Parameters and values

Use `@name` placeholders with a mapping. A key can include or omit the `@`. You
should always bind values, and not write them into the SQL text:

```python
cursor = conn.execute(
    "SELECT name FROM products WHERE stock >= @minimum AND name = @name",
    {"minimum": 1, "@name": "kettle"},
)
```

`paramstyle` is `"named"`. The driver sends typed values:

| Python value | CamusDB type | Returned Python value |
| --- | --- | --- |
| `None` | `NULL` | `None` |
| `bool` | `BOOL` | `bool` |
| `int` | `INT64` | `int` |
| `float` | `FLOAT64` | `float` |
| `decimal.Decimal` | `NUMERIC` | `decimal.Decimal` |
| `str` | `STRING` | `str` |
| `camusdb.ObjectId` | `OID` | `str` |
| `bytes`, `bytearray`, `memoryview` | `BYTES` | `bytes` |
| `datetime.date` | `DATE` | `datetime.date` |
| `datetime.datetime` | `DATETIME` | A UTC `datetime.datetime`, with microsecond precision |
| `uuid.UUID` | `UUID` | `uuid.UUID` |
| `dict` | `JSONB` | The PostgreSQL JSON text, as a `str` |
| `list`, `tuple` | `ARRAY(T)` | `list` |
| `datetime.timedelta`, `camusdb.Interval` | Interval text, cast in SQL | `str`. Parse it with `Interval`. |

Integers must fit in 64 bits. Floats can be infinite or NaN, also in `FLOAT32`
values and arrays. A naive datetime is interpreted as UTC. A decimal is sent as
text, and it isn't converted to a float. `NUMERIC` has
[38 digits of precision and a scale of 9](/docs/data-types).

The type of an array comes from its first element that isn't `NULL`. Decimal
array elements are sent as `FLOAT64`, and they lose the exactness of a decimal.
For an empty array, or a type that Python can't express, such as `FLOAT32`, use
`Typed`:

```python
from camusdb import ColumnType, Typed

empty_ids = Typed([], ColumnType.ARRAY, element_type=ColumnType.INT64)
single_precision = Typed(9.5, ColumnType.FLOAT32)
```

`FLOAT32` results are Python floats. A string can also bind to an `OID` column.
`camusdb.ObjectId.generate()` creates an id on the client.

### Intervals

`datetime.timedelta` and `camusdb.Interval` parameters bind as ISO 8601
interval text. Cast them in SQL. Result cells are Python strings:

```python
import datetime as dt
from camusdb import Interval

cursor = conn.execute(
    "SELECT name, finished - started AS duration FROM jobs "
    "WHERE finished - started > CAST(@limit AS INTERVAL)",
    {"limit": dt.timedelta(hours=1)},
)
for name, duration in cursor:
    print(name, Interval.parse(duration).to_timedelta())
```

An `Interval` stores calendar months separately from days and microseconds.
`str(value)` returns its ISO 8601 text. If there are months, `to_timedelta()` raises
`ValueError`. Keep calendar intervals, such as `AGE` results, as `Interval`
values. `Interval` equality compares the three parts. SQL compares intervals
with 30-day months. This means that two values that SQL thinks are equal can be
different `Interval` values.

A list of timedelta values needs an explicit `STRING` element type:
`Typed(values, ColumnType.ARRAY, element_type=ColumnType.STRING)`. The server
doesn't have an interval column type. See [Intervals](/docs/data-types#intervals).

### JSON documents

A `dict` binds as [JSONB](/docs/json). A `list` binds as `ARRAY`. To send a list
as one JSON array document, or to bind raw JSON text, use `Typed`:

```python
from camusdb import ColumnType, Typed

conn.execute(
    "INSERT INTO events (id, payload) VALUES (GEN_ID(), @payload)",
    {"payload": {"kind": "login", "user": {"id": 7}}},
)
cur = conn.execute(
    "SELECT payload FROM events WHERE payload @> @filter",
    {"filter": Typed('{"kind": "login"}', ColumnType.JSONB)},
)
payload_text = cur.fetchone()[0]
```

A JSONB result is a string in the JSON text form of PostgreSQL, with the exact
digits of its numbers. A JSON null document is `"null"`, and SQL `NULL` is
`None`. To parse exact fractions, use
`json.loads(payload_text, parse_float=decimal.Decimal)`. To format JSON text,
use `camusdb.format_jsonb(text)`.

Arrays of JSONB values aren't supported. Send one JSON array document. A
document deeper than 512 levels raises `DataError` before it is sent. A
malformed server response raises `InterfaceError`.

## Read results

`execute()` returns a cursor with all its rows in memory. Iterate it, or use the DB-API fetch methods, such as `fetchmany()`. `cursor.arraysize` sets the
default size of `fetchmany()`.

The server limits a buffered result to 1,000,000 rows and 256 MiB by default.
A larger result returns `CADB0556`. For large reads, use streaming. See
[request limits](/docs/settings-reference#request-resource-limits).

`cursor.description` has DB-API column descriptions, with a
`camusdb.ColumnType` as the type code. `rowcount` is the number of returned or
affected rows, and `-1` for DDL. `lastrowid` is always `None`. To get generated
keys, use `RETURNING`, as in the first example.

For dictionary or named-tuple rows, set a row factory on the connection or the
cursor:

```python
from camusdb.rows import dict_row, namedtuple_row

conn.row_factory = dict_row
product = conn.execute("SELECT name, stock FROM products LIMIT 1").fetchone()
cursor = conn.cursor(row_factory=namedtuple_row)
```

`cursor.executemany(sql, parameter_mappings)` executes the statement once for each mapping, and `rowcount` is the total. It
isn't one bulk request.
`cursor.insert(table, row)` uses the typed HTTP insert route, and you don't
write SQL.

### Stream large results

To read a large result as a stream, use `stream()`. Read the iterator to the
end, or close it, to release its HTTP connection:

```python
from contextlib import closing

with closing(conn.cursor().stream("SELECT id, name, stock FROM products")) as rows:
    for row in rows:
        print(row)
```

The description is available when the first row arrives. Writes with
`RETURNING` can stream too. An error can be raised during the iteration. After
rows have arrived, a serialization conflict can't be replayed. The timeout
applies to each wait for data, and not to the full stream.

## Transactions and retries

Autocommit is off by default. The first data statement begins a transaction,
and `commit()` or `rollback()` ends it. A connection that closes rolls back its
open work. With `autocommit=True`, each statement is separate. To group several
statements, use `transaction()`:

```python
with camusdb.connect(
    endpoint="http://localhost:5095", database="shop", autocommit=True,
) as conn:
    with conn.transaction(isolation_level="Serializable"):
        conn.execute(
            "UPDATE products SET stock = stock - 1 WHERE name = @name AND stock > 0",
            {"name": "kettle"},
        )
```

A transaction block begins at once. It commits at the end, or rolls back after
an exception. Transactions don't nest. The transaction settings of a connection, such as the isolation level, can't
change while a transaction is open.

After a statement fails, the server discards the transaction. The driver then
raises `InternalError` for each statement or commit until you call
`rollback()`. To include supported DDL in the same transaction as your writes,
enable [transactional schema changes](/docs/sql-transactions#transactional-schema-changes).
Use autocommit for `TRUNCATE`.

To replay all the reads and writes after a serialization conflict, use
`run_transaction()`. Call it when the connection doesn't have an open
transaction:

```python
def reserve_kettle(conn):
    return conn.execute(
        "UPDATE products SET stock = stock - 1 WHERE name = @name AND stock > 0",
        {"name": "kettle"},
    ).rowcount


with camusdb.connect(
    endpoint="http://localhost:5095", database="shop", autocommit=True,
) as conn:
    changed = camusdb.run_transaction(conn, reserve_kettle, max_attempts=5)
```

A retryable conflict raises `SerializationFailure`, a subclass of
`OperationalError`. For the codes, see
[Retries and conflicts](/docs/serializable-retries#which-errors-to-retry-and-how). The helper retries them with backoff and jitter. The
callback must be safe to execute again. Put external side effects outside it.
For a custom retry loop, use `camusdb.is_retryable(exc)`.

An unresolved commit (`CADB0509`) is different. `commit()` sends the same commit again, up to 10
times. It doesn't replay the work.

## asyncio

The async interface has the same transaction and parameter behavior:

```python
import asyncio
import camusdb.aio


async def main():
    async with await camusdb.aio.connect(
        endpoint="http://localhost:5095", database="shop", autocommit=True,
    ) as conn:
        cursor = await conn.execute(
            "SELECT name, stock FROM products WHERE stock > @minimum",
            {"minimum": 0},
        )
        async for name, stock in cursor:
            print(name, stock)

        async with conn.transaction():
            await conn.execute(
                "UPDATE products SET stock = stock + 1 WHERE name = @name",
                {"name": "kettle"},
            )


asyncio.run(main())
```

Await `connect()` and the methods that send requests, such as `execute()` and
`commit()`. Don't await `cursor()` or `transaction()`. Use `async for` with
`cursor.stream(sql, parameters)`, and read the iterator to the end or close it.
`camusdb.aio.run_transaction()` takes an async callback.

## Errors and administration

Driver errors have a `code` and a `message`. They use the DB-API classes:

| Class | Errors |
| --- | --- |
| `IntegrityError` | Constraint violations. |
| `DataError` | Invalid values. |
| `ProgrammingError` | SQL and privilege errors. |
| `OperationalError` | Connection and transaction failures. |
| `InterfaceError` | Wrong use of the driver, and malformed server responses. |

`camusdb.codes` has named constants for the
[server error codes](/docs/error-codes).

Connections also have methods for administration, such as `create_database()`. To change databases, set
`conn.database` when no transaction is open. Database administration executes
outside the data transaction of the connection. See
[Database branching](/docs/database-branching).

`conn.execute()` can also execute DDL for inline functions and extensions, such as
`CREATE OR REPLACE FUNCTION`. A dollar-quoted function body is one literal. This
means that a semicolon in the body doesn't end the statement. See
[C# extensions](/docs/csharp-extensions).

### Node statistics and backups

`conn.node_stats()` returns the resource readings of the selected node, such as
the free disk space. To inspect a pool, pass each node:

```python
for endpoint in conn.endpoints:
    stats = conn.node_stats(endpoint)
    print(endpoint, stats.data_volume.available_bytes)
```

An unavailable reading is `-1`, and the reason is in `stats.errors`. With
authentication on, the server requires a superuser or `MONITOR`. See
[Node stats](/docs/node-stats).

`conn.backups` manages online backups:

```python
full = conn.backups.take_full()
incremental = conn.backups.take_incremental(full.backup_id)
chain = conn.backups.chain(incremental.backup_id)
preview = conn.backups.preview_garbage_collection()
```

It has more methods, such as `list()` and `take_coordinated()`. Backups
cover all the databases of the node, and they need the backup configuration of
the server. With authentication on, the caller must be a superuser. If
authentication is off, backups work from the same machine only. For a coordinated
cluster backup, set `backup_endpoint` to the backup coordinator. A full backup
can replace an unavailable incremental base. Check `was_substituted`. The driver
can't restore backups. See [Backup and restore](/docs/backup-and-restore).

The asyncio connection has the same administration methods, with `await`.

## Current limits

- `threadsafety` is `1`. Threads can share the module, but each thread needs a
  separate connection.
- The driver doesn't track causal tokens. Endpoint rotation alone doesn't give
  read-your-writes across nodes. See [Causal tokens](/docs/grpc-api#causal-tokens).
- The driver doesn't support gRPC or HTTP/3. Prepared statements and OpenTelemetry
  aren't available either.
- Tuning keys of the .NET driver, such as `RoutingMode`, are accepted and have no
  effect. `Protocol=grpc` raises `NotSupportedError`.
