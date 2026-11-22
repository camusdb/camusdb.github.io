---
sidebar_position: 4.85
description: "Compute MD5, SHA-1, SHA-256, and SHA-512 digests, HMACs, and CRC-32 checksums in CamusDB SQL, with results that match PostgreSQL and MySQL."
---

# Hash functions

Use the hash functions for checksums and change detection in SQL.
For example, you can find changed rows by comparing a digest of their content.
Each digest function takes a `string` or `bytes` value and returns the digest
as lowercase hexadecimal text.

| Function | Digest | Result length |
|----------|--------|---------------|
| `md5(x)` | MD5 | 32 characters |
| `sha1(x)` | SHA-1 | 40 characters |
| `sha256(x)` | SHA-256 | 64 characters |
| `sha512(x)` | SHA-512 | 128 characters |

```camussql
SELECT md5('abc');                      -- 900150983cd24fb0d6963f7d28e17f72
SELECT sha256(X'616263');               -- ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
SELECT substring(md5('x'), 1, 12);      -- 9dd4e461268c
```

## Binary digests, HMAC, and CRC-32

| Function | Result | Notes |
|----------|--------|-------|
| `digest(x, algorithm)` | `bytes` | The digest as raw bytes, from PostgreSQL's pgcrypto. |
| `hmac(x, key, algorithm)` | `bytes` | The HMAC (RFC 2104) of `x` with `key`, from pgcrypto. |
| `crc32(x)` | `int64` | The CRC-32 checksum, from MySQL. The value is from 0 to 4,294,967,295. |

The `algorithm` can be `'md5'`, `'sha1'`, `'sha256'`, `'sha384'`, or
`'sha512'`, in any case. Another name, such as `'sha224'`, returns `CADB0400`.
`x` and `key` can be a `string` or `bytes` value.

```camussql
SELECT digest('abc', 'sha256') = decode(sha256('abc'), 'hex');   -- true
SELECT encode(hmac('what do ya want for nothing?', 'Jefe', 'sha256'), 'hex');
-- 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
SELECT crc32('abc');                                              -- 891568578
```

`sha256(x)` returns hex text. To get the raw bytes, use `digest(x, 'sha256')`.
For more information about `bytes` and text, see
[Bytes functions](/docs/functions-bytes).

An HMAC with a secret key can authenticate a message. A digest alone can't.
See [Not for security](#not-for-security).

## Rules

- A `string` is hashed as its UTF-8 bytes. This means that text digests match
  PostgreSQL and other tools that use UTF-8.
- A `bytes` value is hashed as its raw bytes.
- `NULL` gives `NULL`.
- Another type returns `CADB0400 InvalidInput`. To hash a number, cast it to a
  string first: `md5(x::text)`.
- The functions are deterministic. You can use them in `WHERE` and in `CHECK`
  constraints. A column default can use them with constant arguments. The
  [query result cache](/docs/query-result-cache) can store their results.

## Differences from PostgreSQL

`md5` returns the same text as in PostgreSQL. In PostgreSQL, `sha1`, `sha256`,
and `sha512` return `bytea`. In CamusDB, they return hex text, the same as
PostgreSQL's `encode(sha256(x), 'hex')`. pgcrypto also supports `sha224`, but
CamusDB doesn't.

A digest is the same in both databases if the input is the same. For example,
`md5(random()::text)` differs. The values and the text format of `random()`
differ.

## Browser build

.NET on WebAssembly doesn't include MD5. The browser build of the engine, used in the
[Browser playground](/docs/browser-playground), computes the MD5
forms of these functions with a separate implementation. The results are the
same.

## Not for security

MD5 and SHA-1 have known collision attacks. Note that these functions aren't
password hashes: they use no salt and no work factor. Use them for checksums
and change detection.
