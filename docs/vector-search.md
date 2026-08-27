---
sidebar_position: 2.44
---

# Vector search

A vector is a list of float32 numbers. A machine learning model produces one for
each document, image, or sentence. The model puts related items close together,
so distance between two vectors is a measure of similarity.

CamusDB stores a vector in a `BYTES` column. It ranks vectors with distance
functions. A nearest neighbor query is an ordinary `SELECT` with an `ORDER BY`
and a `LIMIT`:

```camussql
SELECT id
FROM docs
WHERE tenant_id = @tenant
ORDER BY l2_distance(embedding, @q)
LIMIT 10;
```

The search is exact. CamusDB reads every row that the `WHERE` clause admits. It
returns the true nearest rows. There is no approximation, and there is no recall
parameter to tune.

The cost grows in a straight line with the number of rows. Read
[Cost](#cost) before you run this against a very large table.

## How a vector is stored

A vector is a `BYTES` value with this layout:

1. The elements are IEEE-754 float32 numbers.
2. The byte order of each element is little-endian.
3. The elements are packed together. There is no header, and there is no
   padding.

The dimension is the byte count divided by four. A 768-dimension embedding
occupies 3,072 bytes.

This layout is the full contract. The schema does not record it. A value that
one client writes and another client reads is readable only because both clients
follow the same layout. The float32 value `1.0` is `0x3F800000`. On the wire it
is the four bytes `00 00 80 3F`, with the low byte first.

```camussql
CREATE TABLE docs (
  id OID PRIMARY KEY NOT NULL,
  tenant_id INT64,
  embedding BYTES(3072) NOT NULL,
  CONSTRAINT embedding_is_768d CHECK (vector_dims(embedding) = 768)
);
```

### BYTES(N) is a maximum, not a fixed width

`BYTES(N)` declares that a value must not exceed `N` bytes. It does not declare
that a value must be exactly `N` bytes. A 767-element embedding therefore fits a
`BYTES(3072)` column without complaint.

A value that exceeds the bound fails with `CADB0302 ValueTooLong`. A bare
`BYTES` column uses the default maximum of 10,485,760 bytes. See
[Data types](/docs/data-types) for the full length rules.

The `CHECK` constraint is what fixes the dimension. Without a `CHECK`, CamusDB
stores a short vector, and it compares that vector against full-length vectors.
The mismatch appears later, as an error in some query.

Two functions support such a check:

| Function | Returns |
| --- | --- |
| `octet_length(bytes or string)` | The byte count. For a string, this is the UTF-8 byte count. `octet_length('áé')` is 4, but `length('áé')` is 2. |
| `vector_dims(bytes)` | The element count, which is `octet_length / 4`. |

`vector_dims` rejects a byte count that is not a multiple of four. It does not
round the value down. A 3,070-byte value would otherwise report 767 dimensions.
That value would then satisfy a check written for 767 dimensions. The check
exists to catch exactly this corruption.

A `NULL` embedding passes `CHECK (vector_dims(embedding) = 768)`. SQL violates a
check only when the condition is `false`, and `vector_dims(NULL)` is `NULL`. Use
`NOT NULL` to forbid a missing vector. The check cannot do it. See
[Check constraints](/docs/check-constraints).

Both functions are deterministic, and neither is an aggregate. That is what
makes them legal inside a `CHECK` condition.

## Distance functions

All three functions take two vectors of equal dimension. All three return
`FLOAT64`.

| Function | Meaning | Nearest is | Sort with |
| --- | --- | --- | --- |
| `l2_distance(a, b)` | Euclidean distance | smaller | `ASC`, the default |
| `cosine_distance(a, b)` | `1 - cosine_similarity` | smaller | `ASC` |
| `inner_product(a, b)` | Dot product | larger | `DESC` |

`inner_product` runs in the opposite direction from the other two functions. An
ascending sort over `inner_product` returns the least similar rows. CamusDB
raises no error for this, so the mistake looks like a working query.

```camussql
-- Cosine distance: nearest row first.
SELECT id FROM docs ORDER BY cosine_distance(embedding, @q) LIMIT 10;

-- Inner product: most similar row first.
SELECT id FROM docs ORDER BY inner_product(embedding, @q) DESC LIMIT 10;
```

`l2_distance` returns the true distance. It applies the square root. The squared
form gives the same rank order, but it is not a distance. A projected column that
shows 9.4 where the answer is 3.07 reads as a defect.

`cosine_distance` returns 0 for two identical directions. It returns 2 for two
opposite directions. It never returns a negative value. CamusDB clamps the
similarity to the range `[-1, 1]` before the subtraction. Rounding therefore
cannot push an exact match below zero and sort it in front of itself.

CamusDB widens every element to `double` before any arithmetic. A `float`
accumulator loses the order between two near neighbors at 768 dimensions. It can
also overflow on values that a `double` handles.

### SIMD execution

The three functions use SIMD instructions on hardware that accelerates them.
SIMD is a processor feature that applies one operation to several numbers at
once.

The vectorized loop keeps the same behavior as the plain loop:

1. It widens each element to `double` before any arithmetic.
2. It rejects `NaN` and infinity with the same error.
3. It names the same element in the error message.

Only the order of the summation differs. That order can change the last bits of
a result. A big-endian host uses the plain loop. A vector shorter than one SIMD
lane group also uses the plain loop.

### Return the distance as a column

Sort by an alias when you also want the distance value:

```camussql
SELECT id, l2_distance(embedding, @q) AS distance
FROM docs
ORDER BY distance
LIMIT 10;
```

An alias in `ORDER BY` outranks a base column of the same name. An expression in
`ORDER BY` can also read a column that the `SELECT` list does not project.

Two `ORDER BY` shapes are refused with `CADB0400 InvalidInput`:

- An aggregate function in `ORDER BY` without a `GROUP BY` clause.
- A computed expression in `ORDER BY` together with a `GROUP BY` clause. A
  grouped query sorts after the projection, so a base column that the expression
  names no longer exists at that point. Project the value first, then sort by the
  alias.

## Send the query vector as a parameter

Send the query vector as a bind parameter. A 768-dimension vector written as a
hexadecimal literal adds about 6 KB of text to every statement. It also gives
every query a different statement text, which prevents plan reuse.

| Transport | Encoding |
| --- | --- |
| SQL text | Hexadecimal, with an `X'...'` literal |
| REST (JSON) | Base64, under `bytesValue`, with `type` 7 |
| gRPC | Raw bytes, in `Value.bytes_value` |

```json
{
  "databaseName": "app",
  "sql": "SELECT id FROM docs ORDER BY l2_distance(embedding, @q) LIMIT 10",
  "parameters": {
    "@q": { "type": 7, "bytesValue": "AAAAAAAAgD8=" }
  }
}
```

The value above is the two-element vector `[0.0, 1.0]`. A real embedding is
4,096 base64 characters at 768 dimensions.

The statement text never changes, so a thousand different query vectors share
one cached plan. Prepared statements work the same way. Prepare the statement
once, then execute it with a different vector each time. See
[Parameters and prepared statements](/docs/prepared-statements).

The server logs the statement text. It never logs the parameter values, so an
embedding does not reach a log file.

A 3,072-byte vector is far below both transport limits. The gRPC message default
is 4 MB. The request body default is 30 MB. Neither limit is narrower for
vectors.

`LIMIT` also accepts a parameter. CamusDB binds the value before it builds the
plan, so a parameterized limit still bounds the sort.

## What the plan shows

Use `EXPLAIN` to see how CamusDB ranks the query. With a `LIMIT`, the sort is
bounded, and the plan shows a `topk` node:

```text
topk(k: 10, l2_distance(…) ASC)
```

Without a `LIMIT`, the plan shows a `sort` node instead. That node ranks and
materializes every matching row.

The two names distinguish two different operators. A `sort` node holds the whole
input, and it can spill to disk. A `topk` node holds at most `k` rows, and it
never spills. This is what lets an exact nearest neighbor query over a large
table finish at all.

`EXPLAIN (ANALYZE)` reports the work of each node. The scan node reports every
row that it examined. The `topk` node reports only the rows that it retained.

### When the bound applies

CamusDB bounds the sort to `offset + limit` rows, not to `limit` rows. The rows
that `OFFSET` skips must still be ranked before CamusDB can skip them.

CamusDB keeps the full sort in these cases:

- The `LIMIT` value is unknown or negative.
- The `OFFSET` value is negative.
- The sum of `OFFSET` and `LIMIT` overflows, or it exceeds the maximum 32-bit
  integer.
- Spill to disk is enabled, and the bound exceeds the spill threshold. At that
  size the external sort is the operator designed to hold the rows. See
  [Spill to disk](/docs/spill-to-disk).
- A node between the sort and the limit changes the row count. A projection
  preserves rows, so a bound above it is safe. An aggregate does not.
  `SELECT count(*) FROM t ORDER BY x LIMIT 1` must count every row. A bound of
  one row would answer with a count of 1.

`LIMIT 0` returns no rows. CamusDB never reads the input, so it never evaluates
the ordering expression.

### Order among equal keys

The `topk` node and the full sort return the same rows. They place `NULL` values
in the same position.

They can disagree on the sequence of rows with equal keys. The `topk` node keeps
the row that arrived first. SQL leaves this order unspecified. Add a
tie-breaking key to `ORDER BY` when you need a fixed order among equal rows.

## Errors

| Condition | Error |
| --- | --- |
| The byte count is not divisible by four | `CADB0410` malformed vector |
| A vector has zero elements | `CADB0410` malformed vector |
| The two operands have different dimensions | `CADB0411` dimension mismatch, with both dimensions named |
| An element is `NaN` or an infinity | `CADB0412` invalid vector value |
| `cosine_distance` receives a zero-magnitude vector | `CADB0412` invalid vector value |

All five conditions map to HTTP 400. See [Error codes](/docs/error-codes).

CamusDB refuses a dimension mismatch. It does not truncate the longer operand.
Truncation would return a plausible rank order computed from mismatched data.

CamusDB rejects a non-finite element when a vector function reads it, not when
the row is written. The schema cannot tell an embedding from a file, so no write
path may reject a `BYTES` value for a vector rule.

A zero-element vector is a corrupt row, not a distance of zero. Every metric
over zero elements is meaningless or degenerate.

## Transactions and time travel

A nearest neighbor query is an ordinary read. It obeys the ordinary visibility
rules:

- It ranks the uncommitted rows of its own transaction.
- It ignores the rows of a transaction that rolled back.
- It ranks the rows of a past snapshot under `AS OF SYSTEM TIME`.

See [Transactions and isolation](/docs/serializable-transactions) and
[Time travel reads](/docs/time-travel-reads).

## Cluster behavior

Every node ranks the whole table, not only the spans that it leads. The answer
is the same on every node.

The coordinator performs the rank. A query can therefore ship every qualifying
row across the network to the node that runs it. There is no distributed top-k
operator that bounds this traffic. See
[Distributed queries](/docs/distributed-queries).

## Cost

These figures come from an Apple M3, with 10,000 rows and 768 dimensions, and
with the SIMD distance kernels active:

| Query | Time |
| --- | ---: |
| `ORDER BY l2_distance(...) LIMIT 10` | 12 ms |
| `ORDER BY l2_distance(...)` with no limit | 50 ms |
| `SELECT id FROM docs` with no sort | 6 ms |

The `LIMIT` cuts the query to about one quarter of the full sort. The value of
`k` itself changes little. A limit of 10 and a limit of 100 measure the same,
because the cost comes from the read and the rank of every row.

One distance evaluation costs this much on the same hardware:

| Dimensions | `l2_distance` | `inner_product` | `cosine_distance` |
| ---: | ---: | ---: | ---: |
| 128 | 53 ns | 50 ns | 67 ns |
| 768 | 240 ns | 214 ns | 320 ns |
| 1536 | 459 ns | 405 ns | 607 ns |

The cost grows in a straight line with rows multiplied by dimensions. The
figures above give about 1.2 s for the same query over one million rows on the
same hardware.

Two rules follow:

1. Always pair a vector `ORDER BY` with a `LIMIT`.
2. Narrow the candidate rows with a `WHERE` clause where you can. The filter
   runs before the rank, so a selective predicate reduces the rows that CamusDB
   measures.

## Limits

CamusDB does not support these features yet:

- No approximate index. There is no HNSW index, no IVF index, and no
  quantization. Every query is an exact scan.
- No vector index type. An ordinary index cannot help a distance sort, because
  distance is not an order-preserving function of the stored bytes.
- No native vector type. The dimension lives in a `CHECK` constraint, not in the
  catalog. The element type is a convention, not a fact that the schema records.
- No distributed top-k. See [Cluster behavior](#cluster-behavior) above.

## Related

- [Data types](/docs/data-types)
- [Check constraints](/docs/check-constraints)
- [Functions](/docs/functions)
- [EXPLAIN](/docs/explain)
- [Parameters and prepared statements](/docs/prepared-statements)
- [Error codes](/docs/error-codes)
