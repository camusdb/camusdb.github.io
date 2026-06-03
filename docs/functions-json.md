---
sidebar_position: 4.4
---

# JSON Functions

JSON functions operate on JSON text stored in `STRING` values. Invalid JSON
usually returns `NULL` instead of failing the query. `json_valid` is the
exception: it returns `false` for invalid JSON and for `NULL`.

| Function | Returns | Description |
| --- | --- | --- |
| `json_valid(json)` | `BOOL` | Returns whether `json` is valid JSON text. |
| `json_type(json)` | `STRING` | Returns `object`, `array`, `string`, `number`, `boolean`, or `null`. Invalid JSON returns `NULL`. |
| `json_extract(json, path)` | `STRING` | Returns the JSON text at `path`. Missing paths and invalid JSON return `NULL`. |
| `json_value(json, path)` | typed scalar | Returns a scalar value at `path` as `STRING`, `INT64`, `FLOAT64`, `BOOL`, or `NULL`. Objects and arrays return `NULL`. |
| `json_array_length(json)` | `INT64` | Returns the length of a root JSON array, or `NULL` when the root is not an array. |
| `json_array_length(json, path)` | `INT64` | Returns the length of the array at `path`, or `NULL` when the path is missing or not an array. |
| `json_contains(value, candidate)` | `BOOL` | Returns whether `value` structurally contains `candidate`. |

## JSON Paths

Supported paths are intentionally small and predictable:

- `$` for the root value.
- `.name` for object properties made of letters, digits, and underscores.
- `[0]` for zero-based array indexes.

Examples: `$`, `$.name`, `$.meta.enabled`, and `$.tags[1]`.

Quoted property names, wildcards, recursive descent, filters, and negative
array indexes are not supported.

## Examples

```sql
SELECT json_valid(payload)
FROM robots;

SELECT json_extract(payload, "$.tags[1]")
FROM robots;
-- "\"b\"" when the JSON value is {"tags":["a","b"]}

SELECT json_value(payload, "$.meta.count")
FROM robots;
-- 3

SELECT name
FROM robots
WHERE json_valid(payload) = true
  AND json_type(payload) = "object";

SELECT json_array_length(payload, "$.tags")
FROM robots;

SELECT json_contains(
  "{\"meta\":{\"enabled\":true,\"count\":3}}",
  "{\"meta\":{\"enabled\":true}}"
);
-- true
```

## Containment Rules

`json_contains(value, candidate)` compares JSON structurally:

- Object candidates match when every candidate property is present and
  contained in the value object.
- Array candidates match when every candidate element is contained by at least
  one element in the value array.
- Scalar candidates match by value and JSON type.

If either input is invalid JSON, `json_contains` returns `NULL`.

