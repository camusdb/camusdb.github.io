---
sidebar_position: 4.25
description: "Convert bytes values to hex, base64, and text, read and set single bytes and bits, and generate random bytes. Names and rules follow PostgreSQL."
---

# Bytes functions

Use these functions to work with binary data in SQL. For example, you can show a
token as hex, read a base64 payload from an API, or check a flag bit in a header.
The names and rules follow PostgreSQL, and some MySQL names are also available.
For the digest functions, such as `md5` and `sha256`, see
[Hash functions](/docs/functions-hash).

All functions return `NULL` when an argument is `NULL`. Invalid input returns
`CADB0400 InvalidInput`, for example a bad format name or an offset past the
end. No function returns a partial result.

A bytes literal is written `X'DEADBEEF'`. For the literal and text forms of `bytes`, see
[Data types](/docs/data-types).

## Convert between bytes and text

| Function | Result | Notes |
| --- | --- | --- |
| `encode(bytes, format)` | `string` | `format` is `'hex'`, `'base64'`, or `'escape'`, in any case. |
| `decode(string, format)` | `bytes` | The reverse of `encode`: `decode(encode(b, f), f) = b` for each format. |
| `hex(x)` | `string` | MySQL. Uppercase hex of `bytes`, a `string`'s UTF-8 bytes, or an `int64`. |
| `unhex(string)` | `bytes` | MySQL. Hex digits in either case. |
| `to_base64(x)` | `string` | MySQL. Base64 of `bytes`, or of a `string`'s UTF-8 bytes. |
| `from_base64(string)` | `bytes` | MySQL. |
| `convert_to(string, 'UTF8')` | `bytes` | The UTF-8 bytes of the text. |
| `convert_from(bytes, 'UTF8')` | `string` | The text that UTF-8 bytes encode. |

```camussql
SELECT encode(X'DEADBEEF', 'hex');           -- deadbeef
SELECT encode(X'616263', 'base64');          -- YWJj
SELECT encode(X'00415C80', 'escape');        -- \000A\\\200
SELECT decode('YWJj', 'base64');             -- X'616263'
SELECT hex('abc'), hex(255), hex(-1);        -- 616263, FF, FFFFFFFFFFFFFFFF
SELECT convert_from(X'C3A9', 'UTF8');        -- é
```

### Formats

- **`hex`**. `encode` writes lowercase digits, and `decode` reads either case. As in PostgreSQL,
  whitespace between digit pairs is ignored. Whitespace in a pair, or an odd number of digits, is an
  error.
- **`base64`**. The RFC 4648 alphabet with `=` padding. `decode` ignores whitespace. This means
  that text with line breaks decodes.
- **`escape`**. Zero bytes and bytes from `0x80` to `0xFF` become three-digit octal escapes
  (`\000`, `\377`). A backslash becomes two backslashes. The other bytes are written as their
  ASCII characters. `decode` reads `\\` as one backslash and `\nnn` as one byte. Any other
  backslash is an error. Non-ASCII characters are read as their UTF-8 bytes.

### UTF-8 only

`convert_to` and `convert_from` take the encoding names `UTF8` and `UTF-8`, in any case. Other
encodings return an error. CamusDB stores all text as UTF-8.

Invalid UTF-8 in `convert_from` returns an error. The function doesn't replace it with the
replacement character U+FFFD.

### Differences from PostgreSQL and MySQL

- `encode(x, 'base64')` adds no line breaks. PostgreSQL adds one after each 76 characters.
  `decode` reads both forms.
- `unhex` and `from_base64` return an error for malformed text. MySQL returns `NULL`.
- `unhex` returns an error for an odd number of digits. MySQL adds a leading zero.
- `to_base64` adds no line breaks. MySQL adds one after each 76 characters.

## Text functions that also take bytes

These functions take `string` or `bytes`, and count bytes for `bytes`. When a function takes two
values, both must have the same type. For example, `contains(bytes, string)` is an error. Use
`convert_to` or `convert_from` to convert.

| Function | Result for bytes | Notes |
| --- | --- | --- |
| `length(x)` | `int64` | The number of bytes. Same as `octet_length`. |
| `substring(x, start [, count])` | `bytes` | `start` is 1-based. |
| `strpos(x, part)` | `int64` | The 1-based position of the first `part` in `x`, or `0`. An empty `part` gives `1`. |
| `position(part IN x)` | `int64` | The SQL-standard form of `strpos(x, part)`. |
| `trim(x [, set])`, `ltrim`, `rtrim` | `bytes` | Removes `0x00` bytes from the ends. With `set`, removes the bytes in `set`. |
| `starts_with(x, part)`, `ends_with`, `contains` | `bool` | |

```camussql
SELECT substring(X'0102030405', 2, 3);       -- X'020304'
SELECT position(X'03' IN X'010203');          -- 3
SELECT trim(X'0000410000');                   -- X'41'
SELECT trim(X'0102030201', X'0102');          -- X'03'
SELECT trim('xyaxy', 'yx');                   -- a
```

`substring` and the trim functions return the type of their first argument.

The trim functions also take a set for a `string`, as PostgreSQL `btrim(text, text)` does. An
empty set doesn't remove characters. If you omit the set, a `string` loses the whitespace at its
ends.

### Limits of `position(part IN x)`

`IN` binds more tightly than the arithmetic operators. Put parentheses around a `part` that uses
an operator: `position((a + b) IN x)`.

The value `x` must be one of the following:

- A column, a literal, or a parameter.
- A function call, a `CAST`, or a `CASE`.

`x` can't start with a parenthesis. In that position, `IN (` starts an `IN` list. Such a call
returns `CADB0407`. For another expression, use `strpos(x, part)`.

## Read and change bytes and bits

| Function | Result | Notes |
| --- | --- | --- |
| `get_byte(bytes, n)` | `int64` | The byte at offset `n`, from 0 to 255. |
| `set_byte(bytes, n, value)` | `bytes` | A copy with the byte at offset `n` changed. `value` is 0 to 255. |
| `get_bit(bytes, n)` | `int64` | The bit at offset `n`, `0` or `1`. |
| `set_bit(bytes, n, value)` | `bytes` | A copy with the bit at offset `n` changed. `value` is `0` or `1`. |
| `bit_length(x)` | `int64` | Eight times the byte length of `bytes`, or of a `string`'s UTF-8 form. |
| `bit_count(bytes)` | `int64` | The number of bits set to `1`. |

Offsets are 0-based, as in PostgreSQL. Bit `n` is bit `n % 8` of byte `n / 8`, and bit 0 of a byte
is its least significant bit. For example, bit 15 is the most significant bit of the second byte.

```camussql
SELECT get_byte(X'0AFF', 1);                  -- 255
SELECT set_byte(X'0000', 1, 255);             -- X'00FF'
SELECT get_bit(X'0080', 15);                  -- 1
SELECT set_bit(X'FF', 7, 0);                  -- X'7F'
SELECT bit_count(X'FF0F');                    -- 12
```

An offset below 0 or past the last byte (or bit) is an error. An empty value has no offsets. This
means that any offset is an error.

`set_byte` and `set_bit` do not change their input. To change a stored value, write the result back:
`UPDATE t SET b = set_byte(b, 0, 1) WHERE id = 1`.

## Random bytes

`gen_random_bytes(n)` returns `n` bytes from the cryptographic random number generator. `n` can be
from 1 to 1024, the same limit as PostgreSQL's pgcrypto.

Each call returns new bytes. A query that uses the function isn't stored in the
[query result cache](/docs/query-result-cache).

The function can't be a column `DEFAULT`. A volatile default must be a call with no arguments,
such as `gen_uuid_v7()`. Other defaults return `CADB0400`.

## Sizes and large values

A result can be as large as its input. When you write a result to a `bytes(N)` column, the length
limit `N` applies as it does to any other value. A value that is too long returns
`CADB0302 ValueTooLong`.

The functions read out-of-line columns (`STORAGE EXTERNAL`, see
[Large Values](/docs/storage-layout)) the same way as any other column.
