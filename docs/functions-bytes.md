---
sidebar_position: 4.25
---

# Bytes functions

These functions read, change, and convert `bytes` values. Names and rules follow PostgreSQL, and
some MySQL names are also available. The digest functions (`md5`, `sha256`, `digest`, `hmac`,
`crc32`) are in [Hash Functions](/docs/functions-hash).

All functions return `NULL` when an argument is `NULL`. A wrong argument type, a bad format name,
malformed text, or an out-of-range offset fails with `InvalidInput`. No function returns a partial
result.

A bytes literal is written `X'DEADBEEF'`. See [Data Types](/docs/data-types) for the literal and text
forms of `bytes`.

## Convert between bytes and text

| Function | Result | Notes |
| --- | --- | --- |
| `encode(bytes, format)` | `string` | `format` is `'hex'`, `'base64'`, or `'escape'`, in any case. |
| `decode(string, format)` | `bytes` | The reverse of `encode`: `decode(encode(b, f), f) = b` for every format. |
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

- **`hex`**. `encode` writes lowercase digits; `decode` reads either case. As in PostgreSQL,
  whitespace between digit pairs is ignored. An odd number of digits is an error.
- **`base64`**. The RFC 4648 alphabet with `=` padding. `decode` ignores whitespace, so text with
  line breaks decodes.
- **`escape`**. Zero bytes and bytes from `0x80` to `0xFF` become three-digit octal escapes
  (`\000`, `\377`). A backslash becomes two backslashes. Every other byte is its ASCII character.
  `decode` reads `\\` as one backslash and `\nnn` as one byte; any other backslash is an error.
  Non-ASCII characters are read as their UTF-8 bytes.

### UTF-8 only

`convert_to` and `convert_from` accept the encoding names `UTF8` and `UTF-8`, in any case. Other
encodings are an error, because CamusDB stores all text as UTF-8. `convert_from` rejects invalid
UTF-8 rather than substituting the replacement character U+FFFD.

### Differences from PostgreSQL and MySQL

- `encode(x, 'base64')` adds no line breaks. PostgreSQL adds one every 76 characters. Text
  without line breaks is easier to compare and store, and `decode` accepts both forms.
- `unhex` and `from_base64` fail on malformed text. MySQL returns `NULL`.
- `unhex` rejects an odd number of digits. MySQL adds a leading zero.
- `to_base64` adds no line breaks. MySQL adds one every 76 characters.

## Text functions that also take bytes

These functions take `string` or `bytes`, and count bytes for `bytes`. When a function takes two
values, both must have the same type, so `contains(bytes, string)` is an error. Use `convert_to` or
`convert_from` to convert.

| Function | Result for bytes | Notes |
| --- | --- | --- |
| `length(x)` | `int64` | The number of bytes. Same as `octet_length`. |
| `substring(x, start [, count])` | `bytes` | `start` is 1-based. |
| `strpos(x, part)` | `int64` | The 1-based position of the first `part` in `x`, or `0`. An empty `part` gives `1`. |
| `position(part IN x)` | `int64` | The SQL-standard form of `strpos(x, part)`. |
| `trim(x [, set])`, `ltrim`, `rtrim` | `bytes` | Without `set`, removes `0x00` bytes. With `set`, removes every byte in `set`. |
| `starts_with(x, part)`, `ends_with`, `contains` | `bool` | |

```camussql
SELECT substring(X'0102030405', 2, 3);       -- X'020304'
SELECT position(X'03' IN X'010203');          -- 3
SELECT trim(X'0000410000');                   -- X'41'
SELECT trim(X'0102030201', X'0102');          -- X'03'
SELECT trim('xyaxy', 'yx');                   -- a
```

`substring` and the trim functions return the type of their first argument, so the query planner
knows the result type before it runs the query.

The trim functions also take a set for a `string` (PostgreSQL `btrim(text, text)`). An empty set
removes nothing. Without a set, a `string` loses its whitespace, as before.

### Limits of `position(part IN x)`

`IN` binds more tightly than the arithmetic operators, so put parentheses around a `part` that uses
an operator: `position((a + b) IN x)`. The value `x` can be a column, a literal, a parameter, a
function call, a `CAST`, or a `CASE`. It cannot start with a parenthesis, because `IN (` starts an
`IN` list. For any other expression, use `strpos(x, part)`.

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
is its least significant bit. So bit 15 is the most significant bit of the second byte.

```camussql
SELECT get_byte(X'0AFF', 1);                  -- 255
SELECT set_byte(X'0000', 1, 255);             -- X'00FF'
SELECT get_bit(X'0080', 15);                  -- 1
SELECT set_bit(X'FF', 7, 0);                  -- X'7F'
SELECT bit_count(X'FF0F');                    -- 12
```

An offset below 0 or past the last byte (or bit) is an error. An empty value has no offsets, so any
offset is an error.

`set_byte` and `set_bit` do not change their input. To change a stored value, write the result back:
`UPDATE t SET b = set_byte(b, 0, 1) WHERE id = 1`.

## Random bytes

`gen_random_bytes(n)` returns `n` bytes from the cryptographic random number generator. `n` ranges
from 1 to 1024, the same limit as PostgreSQL's pgcrypto.

The function is volatile: each call returns new bytes, and queries that use it bypass the
query-result cache. You cannot use it as a column `DEFAULT`, because a per-row default must be a
call with no arguments, such as `gen_uuid_v4()`.

## Sizes and large values

A result can be as large as its input. When you write a result to a `bytes(N)` column, the length
limit `N` applies as it does to any other value, and a value that is too long fails with
`ValueTooLong`.

The functions read out-of-line columns (`STORAGE EXTERNAL`, see
[Large Values](/docs/storage-layout)) the same way as any other column.
