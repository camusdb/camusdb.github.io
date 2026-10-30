---
sidebar_position: 4.4
---

# JSON functions

JSON functions operate on JSON text stored in a `STRING` value. Invalid JSON
usually returns `NULL` rather than failing the query. The exception is
`json_valid`, which returns `false` for invalid JSON and for `NULL`.

| Function | Returns | Description |
| --- | --- | --- |
| `json_valid(json)` | `BOOL` | Whether `json` is valid JSON text. |
| `json_type(json)` | `STRING` | Returns `object`, `array`, `string`, `number`, `boolean`, or `null`. Invalid JSON returns `NULL`. |
| `json_extract(json, path)` | `STRING` | The JSON text at `path`. A missing path or invalid JSON returns `NULL`. |
| `json_value(json, path)` | A typed scalar | The scalar value at `path`, as `STRING`, `INT64`, `FLOAT64`, `BOOL`, or `NULL`. Objects and arrays return `NULL`. |
| `json_array_length(json)` | `INT64` | The length of the root JSON array. Returns `NULL` when the root is not an array. |
| `json_array_length(json, path)` | `INT64` | The length of the array at `path`. Returns `NULL` when the path is missing or the value is not an array. |
| `json_contains(value, candidate)` | `BOOL` | Whether `value` structurally contains `candidate`. |

## JSON paths

The supported path syntax is small and predictable by design:

- `$` is the root value.
- `.name` is an object property. The name may contain letters, digits, and
  underscores.
- `[0]` is an array index. Indexes start at 0.

For example: `$`, `$.name`, `$.meta.enabled`, and `$.tags[1]`.

CamusDB does not support quoted property names, wildcards, recursive descent,
filters, or negative array indexes.

## Examples

```camussql
SELECT json_valid(payload)
FROM robots;

SELECT json_extract(payload, '$.tags[1]')
FROM robots;
-- "\"b\"" when the JSON value is {"tags":["a","b"]}

SELECT json_value(payload, '$.meta.count')
FROM robots;
-- 3

SELECT name
FROM robots
WHERE json_valid(payload) = true
  AND json_type(payload) = 'object';

SELECT json_array_length(payload, '$.tags')
FROM robots;

SELECT json_contains(
  '{\'meta\':{\'enabled\':true,\'count\':3}}',
  '{\'meta\':{\'enabled\':true}}'
);
-- true
```

## Containment rules

`json_contains(value, candidate)` compares JSON by structure:

- An object candidate matches when the value object has every property of the
  candidate, and each property's value contains the candidate's.
- An array candidate matches when, for each candidate element, at least one
  element of the value array contains it.
- A scalar candidate matches by value and JSON type.

`json_contains` returns `NULL` when either input is invalid JSON.
