---
sidebar_position: 4.85
---

# Hash functions

CamusDB has four digest functions. Each one takes one `STRING` or `BYTES` value
and returns the digest as lowercase hexadecimal text.

| Function | Digest | Result length |
| --- | --- | --- |
| `md5(value)` | MD5 | 32 characters |
| `sha1(value)` | SHA-1 | 40 characters |
| `sha256(value)` | SHA-256 | 64 characters |
| `sha512(value)` | SHA-512 | 128 characters |

```camussql
SELECT md5('abc');
SELECT sha256(X'616263');
SELECT substring(md5('x'), 1, 12);
```

## Rules

A `STRING` is hashed as its UTF-8 bytes. A `BYTES` value is hashed as its raw
bytes.

`NULL` gives `NULL`. Any other type is an error. To hash a number or another
scalar value, cast it first:

```camussql
SELECT md5(order_id::text) FROM orders;
```

The functions are deterministic. You can use them in `WHERE`, in a `CHECK`
constraint, and in a column `DEFAULT`. The query-result cache can keep their
results.

## PostgreSQL difference

`md5` matches PostgreSQL's text behavior for the same input. PostgreSQL's
`sha1`, `sha256`, and `sha512` return `bytea`. CamusDB returns hex text, the
same shape as PostgreSQL's `encode(sha256(x), 'hex')`.

## Not for security

MD5 and SHA-1 have known collision attacks. These functions are not password
hashes: they have no salt and no work factor. Use them for checksums, change
detection, bucketing, and test data.
