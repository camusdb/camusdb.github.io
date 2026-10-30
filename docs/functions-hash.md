---
sidebar_position: 4.85
---

# Hash functions

CamusDB has four digest functions. Each takes a `string` or `bytes` value and returns the digest as
lowercase hexadecimal text.

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

## Binary digests, HMAC and CRC-32

| Function | Result | Notes |
|----------|--------|-------|
| `digest(x, algorithm)` | `bytes` | The digest as raw bytes, from PostgreSQL's pgcrypto. |
| `hmac(x, key, algorithm)` | `bytes` | The HMAC (RFC 2104) of `x` under `key`, from pgcrypto. |
| `crc32(x)` | `int64` | The CRC-32 checksum, from MySQL. The value ranges from 0 to 4 294 967 295. |

`algorithm` is `'md5'`, `'sha1'`, `'sha256'`, `'sha384'`, or `'sha512'`, in any case. `x` and `key`
are `string` or `bytes`, following the same rules as the hex functions.

```camussql
SELECT digest('abc', 'sha256') = decode(sha256('abc'), 'hex');   -- true
SELECT encode(hmac('what do ya want for nothing?', 'Jefe', 'sha256'), 'hex');
-- 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
SELECT crc32('abc');                                              -- 891568578
```

`digest` and `hmac` do not change the hex functions: `sha256(x)` still returns text. pgcrypto also
supports `sha224`; CamusDB does not.

An HMAC with a secret key can authenticate a message. The digest functions alone cannot, and the
warning in "Not for security" applies to them.

To convert `bytes` to text and back, see [Bytes Functions](/docs/functions-bytes).

## Rules

- A `string` is hashed as its UTF-8 bytes, so text digests match PostgreSQL and other tools that
  use UTF-8.
- A `bytes` value is hashed as its raw bytes.
- `NULL` gives `NULL`.
- Any other type is an error (`InvalidInput`). To hash a number, cast it first: `md5(x::text)`.
- The functions are deterministic. You can use them in `WHERE`, in `CHECK` constraints, and in
  column defaults, and the query-result cache can keep their results. The same holds for `digest`,
  `hmac`, and `crc32`.

## Difference from PostgreSQL

`md5` matches PostgreSQL. In PostgreSQL, `sha1`, `sha256`, and `sha512` return `bytea`; in CamusDB
they return hex text, equivalent to PostgreSQL's `encode(sha256(x), 'hex')`.

`md5(random()::text)` does not match PostgreSQL, because `random()` returns different values and the
float-to-text format can differ. Digests match only when the input is the same.

## Browser build

.NET on WebAssembly has no MD5. The browser build of the engine (see
[Browser Playground](/docs/browser-playground)) computes `md5`, `digest(x, 'md5')` and
`hmac(x, key, 'md5')` with its own implementation, which gives the same results.

## Not for security

MD5 and SHA-1 have known collision attacks. None of these functions is a password hash: they have no
salt and no work factor. Use them for checksums, change detection, bucketing, and test data.
