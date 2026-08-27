---
sidebar_position: 4.4
---

# JSON functions

A JSON function operates on JSON text inside a `STRING` value. Invalid JSON
usually returns `NULL`. It usually does not make the query fail. `json_valid` is
the exception. It returns `false` for invalid JSON, and for a `NULL`.

| Function | Returns | Description |
| --- | --- | --- |
| `json_valid(json)` | `BOOL` | Whether `json` is valid JSON text. |
| `json_type(json)` | `STRING` | It returns `object`, `array`, `string`, `number`, `boolean`, or `null`. Invalid JSON returns `NULL`. |
| `json_extract(json, path)` | `STRING` | The JSON text at `path`. A path that is absent returns `NULL`. Invalid JSON also returns `NULL`. |
| `json_value(json, path)` | A typed scalar | The scalar value at `path`, as a `STRING`, an `INT64`, a `FLOAT64`, a `BOOL`, or a `NULL`. An object and an array both return `NULL`. |
| `json_array_length(json)` | `INT64` | The length of the JSON array at the root. It returns `NULL` when the root is not an array. |
| `json_array_length(json, path)` | `INT64` | The length of the array at `path`. It returns `NULL` when the path is absent, and when the value is not an array. |
| `json_contains(value, candidate)` | `BOOL` | Whether `value` holds `candidate`, by structure. |

## The paths of JSON

The supported paths are small and predictable, by design:

- `$` is the value at the root.
- `.name` is a property of an object. The name holds a letter, a digit, and an
  underscore.
- `[0]` is an index of an array. The first index is 0.

Four examples are `$`, `$.name`, `$.meta.enabled`, and `$.tags[1]`.

CamusDB does not support five other forms: a quoted name of a property, a
wildcard, a recursive descent, a filter, and a negative index of an array.

## Examples

```camussql
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

## The rules of containment

`json_contains(value, candidate)` compares the JSON by its structure:

- A candidate that is an object matches when the value object holds every
  property of the candidate, and contains each one.
- A candidate that is an array matches when at least one element of the value
  array contains each element of the candidate.
- A candidate that is a scalar matches by its value and by its JSON type.

`json_contains` returns `NULL` when either input is invalid JSON.
