---
sidebar_position: 7.4
---

# Python driver

`camusdb-py` connects Python applications to CamusDB through a familiar DB-API
2.0 interface: connections, cursors, named parameters, and transactions. It
also provides a native asyncio interface for services that use asynchronous
I/O. Both interfaces use the REST API through `httpx`.

Use it for Python services, scripts, and data-processing jobs that need typed
SQL values and explicit transaction control. The package name is
`camusdb-py`; the import name is `camusdb`. Source and integration examples are
in [camusdb-py](https://github.com/camusdb/camusdb-py).

## Install

Python 3.10 or later is required:

```bash
pip install camusdb-py
```

For HTTP/2 over HTTPS, install `pip install 'camusdb-py[http2]'` and pass
`http2=True`. The driver does not support gRPC or HTTP/3.

## Create a database and query it

Start CamusDB with the [installation guide](/docs/intro). This example uses
its default REST port, 5095:

```python
import camusdb

with camusdb.connect("Endpoint=http://localhost:5095;Database=shop") as conn:
    # Run database creation once, with an account allowed to create databases.
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

`connect()` makes no network request. The database must exist before its first
data statement. The connection context commits on success, rolls back on an
exception, and closes. Schema DDL runs separately and is not undone by rollback.

## Connection settings

Pass a CamusDB connection string, keyword arguments, or both. Keywords override
the same settings in the string:

```python
conn = camusdb.connect(
    "Endpoint=http://localhost:5095;Database=shop",
    timeout=30,
    autocommit=True,
)
```

| Keyword | Connection-string key | Default and behavior |
| --- | --- | --- |
| `endpoint` | `Endpoint` | Required REST URL; accepts a sequence or comma-separated URLs. |
| `database` | `Database` | Required database name. |
| `timeout` | `Timeout` | 10 seconds per request. |
| `autocommit` | `Autocommit` | `False`: begin a transaction on the first data statement. |
| `isolation_level` | `IsolationLevel` | Server default; accepts `Serializable` or `ReadCommitted`. |
| `read_only` | `TransactionMode` | Server default; use `True`/`False` in Python or `ReadOnly`/`ReadWrite` in the string. |
| `locking` | `Locking` | Server default; accepts `Pessimistic` or `Optimistic`. |
| `user`, `password` | `User`, `Password` | Optional login credentials. |
| `access_token` | `AccessToken` | Optional externally managed bearer token; never renewed by the driver. |
| `http2` | `HttpVersion` | `False`; HTTP/2 requires the optional dependency and HTTPS. `HttpVersion=3` uses HTTP/2, not HTTP/3. |
| `token_lifetime` | `TokenLifetime` | 600 seconds when login returns no token lifetime. |
| `allow_insecure_credentials` | `AllowInsecureCredentials` | `False`; see authentication below. |
| `row_factory` | — | Tuple rows by default. |

Connection-string keys are case-insensitive. Quote values containing
semicolons and double an embedded quote, for example
`Password='pa;ss''word'`. Repeated keys are rejected. Use
`camusdb.redact_connection_string(text)` before logging a connection string.

With multiple endpoints, requests rotate between nodes and transactions stay
on the node where they began. An unreachable endpoint is skipped for 30
seconds. The failed request raises `OperationalError` (`CADB0001`) and is not
replayed on another node because it might already have run. Connections naming
the same nodes share endpoint rotation and health state within the process.

### Authentication

Use `user` and `password` to log in and send a cached bearer token with later
requests. Connections with the same nodes and credentials share the process
cache. The next request renews the token after 80% of its lifetime; if renewal
fails, the old token remains usable until 95% of its lifetime. A rejected
managed token triggers login and one resend. An `access_token` supplied by you
is never renewed.

Credentials require HTTPS unless the endpoint is loopback. Other plaintext
endpoints fail in `connect()` with `InterfaceError` (`CADB0519`). Set
`allow_insecure_credentials=True` only when the plaintext hop is inside your
trusted TLS-termination setup. You can also call `conn.login(user, password)`
and `conn.logout()`. See [SQL authentication](/docs/sql-authentication) for users
and grants.

## Parameters and values

Use `@name` placeholders with a mapping; keys may include or omit `@`.
Do not interpolate application values into SQL text:

```python
cursor = conn.execute(
    "SELECT name FROM products WHERE stock >= @minimum AND name = @name",
    {"minimum": 1, "@name": "kettle"},
)
```

The driver reports `paramstyle = "named"` and sends typed parameter values.

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
| `datetime.datetime` | `DATETIME` | UTC `datetime.datetime` with microsecond precision |
| `uuid.UUID` | `UUID` | `uuid.UUID` |
| `list`, `tuple` | `ARRAY(T)` | `list` |

Integers must fit signed 64-bit storage. NaN and infinity are rejected.
Naive datetimes are interpreted as UTC. Decimal scalars travel as text,
without a float conversion; CamusDB's `NUMERIC` still has
[38-digit precision and 9-digit scale](/docs/data-types).

Array types come from the first non-NULL element. Decimal array elements use
`FLOAT64` and lose the scalar decimal exactness. Use `Typed` for an empty array
or a type Python cannot distinguish, such as `FLOAT32`:

```python
from camusdb import ColumnType, Typed

empty_ids = Typed([], ColumnType.ARRAY, element_type=ColumnType.INT64)
single_precision = Typed(9.5, ColumnType.FLOAT32)
```

`FLOAT32` results are returned as Python floats. Strings can also bind to OID
columns; `camusdb.ObjectId.generate()` creates an ID on the client.

## Read results

The server's default buffered response caps are 1,000,000 rows and 256 MiB of
estimated memory. Excess results fail with `CADB0556`; use streaming for large
ordinary reads or reduce the result. See
[request limits](/docs/configuration#request-resource-limits).

`execute()` returns a cursor with all rows buffered in memory. Iterate it or
use `fetchone()`, `fetchmany()`, and `fetchall()`. Set `cursor.arraysize` to
choose the default `fetchmany()` size.

`cursor.description` contains DB-API seven-item column descriptions with
`camusdb.ColumnType` as the type code. `rowcount` reports returned or affected
rows and is `-1` for DDL. `lastrowid` is always `None`; use `RETURNING`, as in
the quick example, to obtain generated keys.

For dictionary or named-tuple rows, set a connection or cursor factory:

```python
from camusdb.rows import dict_row, namedtuple_row

conn.row_factory = dict_row
product = conn.execute("SELECT name, stock FROM products LIMIT 1").fetchone()
cursor = conn.cursor(row_factory=namedtuple_row)
```

`cursor.executemany(sql, parameter_mappings)` runs one statement per mapping
and reports the total row count; it is not a single bulk request.
`cursor.insert(table, row)` uses the typed HTTP insert route without SQL text.

### Stream large results

Use `stream()` when the result should not be buffered. Fully consume or close
the iterator to release its HTTP connection:

```python
from contextlib import closing

with closing(conn.cursor().stream("SELECT id, name, stock FROM products")) as rows:
    for row in rows:
        print(row)
```

The description is available when the first row arrives. Writes with
`RETURNING` can stream too. Errors can be raised during iteration; once rows
have arrived, the server cannot transparently replay a serialization conflict.
The timeout applies to each wait for data, not to the full stream duration.

## Transactions and retries

Autocommit is off by default. The first data statement begins a transaction;
`commit()` or `rollback()` ends it. Closing a connection rolls back open work.
With `autocommit=True`, statements run independently, but `transaction()` can
still group several statements:

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

A transaction block begins immediately, commits on success, and rolls back on
an exception. Transactions do not nest. Connection isolation, read-only, and
locking settings cannot change while a transaction is open; new settings
apply to future transactions and autocommit writes.

After a statement failure, the server rolls back the transaction and the driver
refuses further statements until `rollback()` clears the failed state.
Attempting to commit the failed transaction raises `InternalError`. DDL does not join that transaction, and
`TRUNCATE` is refused inside one (`CADB0538`); use autocommit for it.

Use `run_transaction()` to replay all reads and writes after a serialization
conflict. Start it with no transaction already open:

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

`CADB0502`, `CADB0504`, and `CADB0505` map to `SerializationFailure`, a subclass
of `OperationalError`. The helper replays retryable failures with bounded
exponential backoff and jitter. The callback must be safe to run repeatedly;
keep external side effects outside it. `camusdb.is_retryable(exc)` supports
custom retry loops.

An unresolved commit (`CADB0509`) is different: `commit()` retries finalizing
the same transaction, up to 10 retries, instead of replaying its work. See
[retries and conflicts](/docs/serializable-retries) and
[transaction isolation](/docs/serializable-transactions).

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

Await `connect()`, execution, fetching, commit, and rollback. `cursor()` and
`transaction()` themselves are not awaited. Use `async for` with
`cursor.stream(sql, parameters)`, and fully consume or close the async iterator.
`camusdb.aio.run_transaction()` accepts an async callback.

## Errors and administration

Driver errors expose `code` and `message`. Catch DB-API classes such as
`IntegrityError` for constraint violations, `DataError` for invalid values,
`ProgrammingError` for SQL or privilege errors, and `OperationalError` for
connectivity or transaction failures. `InterfaceError` covers driver misuse.
`camusdb.codes` provides named constants; see [server error codes](/docs/error-codes).

Connections also expose `ping()`, `create_database()`, `drop_database()`,
`create_branch()`, `show_branches()`, and `show_ancestors()`. Set `conn.database`
to change databases when no transaction is open. Database administration runs
outside the connection's data transaction. See
[database branching](/docs/database-branching) for branch behavior.

## Current limits

- `threadsafety` is `1`: threads can share the module, but each thread needs its
  own connection.
- Causal tokens are not tracked or forwarded. Multi-node round-robin access
  does not provide the explicit causal floor described in
  [causal tokens](/docs/grpc-api#causal-tokens); do not assume cross-node
  read-your-writes from endpoint rotation alone.
- gRPC, HTTP/3, prepared statements, learned routing, transaction pipelines,
  backup/node-statistics helpers, and OpenTelemetry integration are not provided.
  Shared .NET connection-string tuning keys such as `RoutingMode` and
  `MaxAutoPrepare` are accepted without effect; `Protocol=grpc` is rejected.
