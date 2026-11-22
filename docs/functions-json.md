---
sidebar_position: 4.4
---

# JSON functions

The JSON functions read values from JSON text in a `STRING` value, for example
an event payload that an application stores as text. Invalid JSON returns
`NULL`. This means that one bad row doesn't stop the query. To find the bad
rows, use `json_valid`.

| Function | Returns | Description |
| --- | --- | --- |
| `json_valid(json)` | `BOOL` | Whether `json` is valid JSON text. `NULL` returns `false`. |
| `json_type(json)` | `STRING` | The type of the root value: `object` / `array` / `string` / `number` / `boolean` / `null`. |
| `json_extract(json, path)` | `STRING` | The JSON text at `path`. A string value is returned with its quotes. |
| `json_value(json, path)` | The type of the value | The scalar value at `path`. See [Value types](#value-types). |
| `json_array_length(json)` | `INT64` | The length of the root array. |
| `json_array_length(json, path)` | `INT64` | The length of the array at `path`. |
| `json_contains(value, candidate)` | `BOOL` | Whether `value` contains `candidate`. See [Containment rules](#containment-rules). |

A missing value returns `NULL`, and a malformed call returns `CADB0400`.

| Input | Result |
| --- | --- |
| Invalid JSON text, or a `NULL` argument | `NULL`. `json_valid` returns `false`. |
| A path that isn't in the document | `NULL` |
| `json_array_length` of a value that isn't an array | `NULL` |
| An argument that isn't `STRING` or `JSONB` | `CADB0400` |
| A path that the [path syntax](#json-paths) doesn't support | `CADB0400` |

A `STRING` argument can nest at most 64 levels. Deeper text is invalid JSON for
these functions. A `JSONB` argument can nest up to the document limit of 512
levels. For deeply nested documents, you should use `JSONB`.

:::tip
To store and query JSON documents, use a [`JSONB` column](/docs/json). It
validates documents on write, supports the PostgreSQL operators and `jsonb_*`
functions, and can use a GIN index. The functions on this page read a `JSONB`
argument as its text.
:::

## JSON paths

A path starts with `$`, the root value. Each step after it reads one level of
the document.

| Step | Meaning |
| --- | --- |
| `.name` | An object property. The name can have letters, digits, and `_`. |
| `[n]` | An array element. Indexes start at 0. |

For example, `$.meta.enabled` reads a nested property, and `$.tags[1]` reads the
second element of an array.

Other syntax, such as `$.*` or `$.tags[-1]`, returns `CADB0400`. However, a row
where an earlier step is missing returns `NULL`. A property name that has other
characters, such as `order-id`, can't be read with a path. Cast the text to
`JSONB`, and use the `->>` operator.

```camussql
SELECT CAST(payload AS JSONB) ->> 'order-id'
FROM orders;
```

## Value types

The type of a `json_value` result follows the type of the JSON value.

| JSON value | Result |
| --- | --- |
| A number that fits in `INT64` | `INT64` |
| Another number | `FLOAT64`. A number outside the `FLOAT64` range returns `NULL`. |
| A string | `STRING` |
| `true` or `false` | `BOOL` |
| `null`, an object, or an array | `NULL` |

The type can be different in each row. A `STRING` result in arithmetic returns
`CADB0400`. If a document can store a number as a string, cast the result, for
example `CAST(json_value(payload, '$.count') AS INT64)`.

## Examples

In these examples, one row of the `robots` table has the `payload`
`{"tags":["a","b"],"meta":{"count":3,"enabled":true}}`.

```camussql
SELECT name
FROM robots
WHERE json_valid(payload) = true
  AND json_type(payload) = 'object';

SELECT json_extract(payload, '$.tags[1]')
FROM robots;
-- "b", with its quotes

SELECT json_value(payload, '$.meta.count')
FROM robots;
-- 3, as INT64

SELECT json_array_length(payload, '$.tags')
FROM robots;
-- 2

SELECT json_contains(
  '{"meta":{"enabled":true,"count":3}}',
  '{"meta":{"enabled":true}}'
);
-- true
```

## Containment rules

`json_contains(value, candidate)` compares the structure of two JSON values.

- An object candidate matches when the value object has each property of the
  candidate, and each property value contains the value in the candidate.
- An array candidate matches when each candidate element is contained in at
  least one element of the value array. The order doesn't matter.
- A scalar candidate matches an equal value of the same JSON type. The numbers
  `1` and `1.0` are equal.

The candidate must have the same JSON type as the value. For example,
`json_contains('[1, 2]', '1')` returns `false`. Note that this is different from
the `@>` operator of PostgreSQL, which matches a scalar in an array.
