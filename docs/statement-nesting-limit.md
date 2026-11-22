---
sidebar_position: 2.75
---

# Statement nesting limit

A statement whose parse tree is deeper than 1,000 levels returns the error
`CADB0413` `StatementTooDeeplyNested`. The limit protects the server process. A
very deep statement could overflow the stack of the process and stop the node.
With the limit, the statement returns an error.

Hand-written SQL doesn't usually reach the limit. Generated SQL can reach it, for
example a filter that an ORM builds from a long list.

## How depth is counted

Depth is the longest path from the root of the statement to a leaf. Each nested expression or
subquery adds a level. Parentheses alone don't add a level.

Some generated shapes cost much less:

| Shape | Cost toward the limit |
| --- | --- |
| `a OR b OR c ...`, `a AND b AND c ...` | About `log2` of the number of terms. |
| `x IN (v1, v2, ...)`, `x NOT IN (...)` | About `log2` of the number of values. |
| `ARRAY[e1, e2, ...]` | About `log2` of the number of elements. |
| Rows of a multi-row `INSERT ... VALUES` | No cost for each row. |

For example, a filter with 20,000 `OR` terms, or an `IN` list with 50,000
values, is accepted. The parser balances long `OR` and `AND` chains and long
value lists. The terms stay in the order that you wrote them. This means that
the results, the parameter order, and the short-circuit behavior don't change.

The following shapes cost one level for each step:

- Arithmetic chains, such as `a + b + c + ...`
- Nested function calls, such as `f(g(h(x)))`
- Repeated `NOT`
- `CASE` expressions with many `WHEN` branches
- Very long select lists and column lists
- Nested subqueries

## CTE expansion {#cte-expansion}

Each reference to a [WITH query](/docs/sql-queries#with-queries) is expanded
into a derived table. The `WITH` queries of one statement can copy at most
250,000 parse nodes. Above that, the statement returns `CADB0413`.

A chain where each CTE reads the previous one twice doubles its size at each
step. A chain of small CTEs reaches the limit after about 13 steps. To fix it,
shorten the chain, or store an intermediate result in a table. The 1,000-level
depth limit also applies.

## Error and retry behavior

`CADB0413` is a permanent client error for that statement shape. HTTP returns
status 400, and gRPC returns `INVALID_ARGUMENT`.

A retry of the same statement fails again. Rewrite the statement with less
nesting, or split it into more than one statement.

## Rewrite guidance

- Replace a long `col = 1 OR col = 2 OR ...` expression with
  `col IN (1, 2, ...)`.
- Replace a long arithmetic chain with an aggregate, or with fewer grouped terms.
- Replace a `CASE` expression that has thousands of branches with a join to a
  mapping table.
- Split a very wide generated statement into several statements.

You can't change the limits. The safe depth depends on the stack frame sizes of
the server.
