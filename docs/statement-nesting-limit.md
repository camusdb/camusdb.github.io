---
sidebar_position: 2.75
---

# Statement nesting limit

CamusDB refuses a statement whose parse tree is deeper than 1,000 levels. The
error code is `CADB0413` `StatementTooDeeplyNested`.

The limit protects the server process. CamusDB walks a parsed statement several
times to bind, plan, render, and evaluate it. Those walks are recursive in many
places. A statement with extreme nesting could otherwise overflow the process
stack and take a node down instead of returning an error.

## What counts

Depth is the longest path from the statement root to a leaf. Each operator,
function call, `NOT`, `CASE` branch, list element, and subquery level adds to
it. Parentheses on their own do not.

Some generated shapes are cheap by design:

| Shape | Cost toward the limit |
| --- | --- |
| `a OR b OR c ...`, `a AND b AND c ...` | About `log2` of the number of terms. |
| `x IN (v1, v2, ...)`, `x NOT IN (...)` | About `log2` of the number of values. |
| `ARRAY[e1, e2, ...]` | About `log2` of the number of elements. |
| Rows of a multi-row `INSERT ... VALUES` | No expression-depth cost per row. |

The parser balances long `OR` and `AND` chains and long value lists. The terms
stay in the order you wrote them, so results, placeholder order, and
short-circuit behavior do not change.

Shapes that still cost one level per step include:

- arithmetic chains such as `a + b + c + ...`
- nested function calls such as `f(g(h(x)))`
- repeated `NOT`
- `CASE` expressions with many `WHEN` branches
- very long select lists and column lists
- nested subqueries

## The error

`CADB0413` is a permanent client error for that statement shape. HTTP reports
status 400. gRPC reports `INVALID_ARGUMENT`.

Retrying the same statement does not help. Rewrite the statement with less
nesting, or split it into more than one statement.

## Rewrite guidance

- Replace a long `col = 1 OR col = 2 OR ...` expression with
  `col IN (1, 2, ...)`.
- Replace a long arithmetic chain with an aggregate or fewer grouped terms.
- Replace a `CASE` expression with thousands of branches with a join against a
  mapping table.
- Split a very wide generated statement into several statements.

The limit is not configurable because the safe value depends on runtime stack
frame sizes, not on workload preference.
