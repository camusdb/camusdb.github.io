---
sidebar_position: 6.5
---

# Query Planner Internals

This page is the internal companion to the user-facing
[Query Planning](/docs/query-planning) and [EXPLAIN](/docs/explain) docs. It
describes how CamusDB turns SQL text into a physical plan and then executes
that plan against the KV layer.

## Mental Model

CamusDB's planner sits between the SQL layer and the ordered transactional KV
store provided by [Kahuna](https://kahunakv.github.io/). Its job is to turn a
declarative SQL query into a concrete execution plan:

- Which scan to use.
- Which predicates can be absorbed into scan bounds.
- Whether a sort can be skipped.
- How joins should probe the right side.
- Where aggregation, `HAVING`, projection, `DISTINCT`, and limit stages belong.

CamusDB is still primarily heuristic-driven. A small cost model exists, but it
currently annotates plans and influences only a narrow scan-choice decision.

## Pipeline

Every `SELECT` follows this high-level pipeline:

1. Parse SQL text into `NodeAst`.
2. Build a typed logical query model.
3. Bind names, sources, and aliases against the catalog.
4. Produce a physical plan tree.
5. Execute the plan through either the single-table executor or the join path.

The important data structures are:

| Stage | Main type | Purpose |
| --- | --- | --- |
| Parse | `NodeAst` | Raw syntax tree. |
| Logical model | `SelectQuery` | Structured representation of source, projections, filters, grouping, ordering, limit, offset, and distinct. |
| Bound model | `BoundSelectQuery` | Logical query plus resolved tables, aliases, and name rules. |
| Physical plan | `QueryPlan` / `PhysicalPlanNode` | Chosen operator tree plus flattened step list for the legacy single-table path. |
| Results | `QueryResultRow` | Output rows emitted to the caller. |

## Logical And Physical Plans

The logical query model captures what the query asks for. The physical plan
captures how CamusDB will obtain it.

Examples:

- Logical: "rows from `robots` where `year = 2024`."
- Physical: "range scan `year_idx` from `2024` to the next key boundary."

CamusDB keeps expressions such as predicates and projection expressions as AST
subtrees deep into execution. The structured models mainly describe query shape
and source relationships.

## Two Execution Paths

CamusDB currently has two execution paths:

| Path | Used when | Main executor |
| --- | --- | --- |
| Single-table linear path | Exactly one source | `QueryExecutor` |
| Tree-based multi-source path | Joins or derived tables | `QueryJoinExecutor` |

Both paths are intended to agree on user-visible semantics. The multi-source
path uses a tree recursively and then reuses a shared post-scan pipeline for
aggregation, sorting, projection, `DISTINCT`, and limit stages.

## Parse And Build

The parser accepts:

- `SELECT [DISTINCT]`
- `WHERE`
- `GROUP BY`
- `HAVING`
- `ORDER BY`
- `LIMIT` / `OFFSET`
- `JOIN` and comma joins
- Derived tables
- Scalar / `IN` / `NOT IN` / `EXISTS` subqueries
- `IN (...)` and `NOT IN (...)` value-list membership
- `EXPLAIN (LOGICAL|PHYSICAL|ANALYZE)`

`SelectQueryCreator` turns the parsed tree into a `SelectQuery` record with:

- `Source`
- `Projections`
- `Where`
- `GroupBy`
- `Having`
- `OrderBy`
- `Limit`
- `Offset`
- `IsDistinct`

## Binding

`QueryBinder` resolves source names, opens table descriptors, detects alias
collisions, and builds the row-name resolver that determines whether a column
reference is valid, ambiguous, or must be qualified.

Binding also validates:

- Projection references.
- `GROUP BY` / projection consistency.
- `ORDER BY` references.
- Join `ON` predicates.

`EXISTS` support is also prepared here through the subquery registry used by
execution.

## Single-Table Planning

The single-table planner runs in broad phases:

### 1. Scan selection

It analyzes the predicate and tries to choose:

- Full table scan.
- Forced index scan.
- Unique index point lookup.
- Index range scan.
- Index `IN`-list scan when repeated probes beat a wider scan.

`PredicateAnalyzer` splits predicates into:

- Indexable comparisons.
- Column-to-column comparisons.
- Residual conjuncts.

`IndexScanSelector` then scores usable indexes using heuristic rules such as:

- Unique full equality beats everything else.
- Non-unique equality and equality-prefix matches are strong candidates.
- Equality prefix plus next-column range can drive composite range scans.
- Matching `ORDER BY` prefixes can win even without a filtering predicate.
- Indexed `IN (...)` lists can compete with range scans and full scans.

### 2. Filter absorption

Once scan bounds are chosen, comparisons already implied by the scan are
removed from the runtime filter. The remaining predicate becomes the residual
execution filter.

### 3. Sort elision

If the chosen scan already produces rows in the requested order, the planner
sets `OutputOrdering` and skips the explicit `SortNode`.

### 3b. DISTINCT strategy

For `SELECT DISTINCT`, the planner decides between:

- `DistinctNode` in streaming mode when the projected columns are simple
  identifiers, all `NOT NULL`, and covered by scan ordering.
- `DistinctNode` in hash mode when streaming is unsafe or impossible.

Streaming distinct can also satisfy matching `ORDER BY` without a separate
`SortNode`.

### 4. Limit pushdown

If the query shape is simple enough, the planner pushes row-count limits into
the scan so the KV read can stop early.

### 5. Operator chain construction

The planner builds a leaf-to-root operator chain. Typical patterns include:

| Query shape | Operator chain |
| --- | --- |
| Plain select | `Scan -> [Filter] -> [Sort] -> [Limit] -> [Aggregate] -> [Having] -> [Project]` |
| Grouped query | `Scan -> [Filter] -> Aggregate -> [Having] -> [Sort] -> [Project] -> [Limit]` |
| Distinct query | `Scan -> [Filter] -> [Aggregate] -> [Having] -> [Project] -> Distinct -> [Sort] -> [Limit]` |

## Join Planning

`JoinQueryPlanner` handles multi-source queries.

Its work includes:

- Optional join-order reordering.
- Predicate pushdown for single-source predicates.
- Separation of post-join predicates from scan-local predicates.
- Building either `NestedLoopJoinNode` or `IndexNestedLoopJoinNode`.
- Building `SemiJoinNode` variants for eligible indexed `IN` / `NOT IN`
  subqueries.
- Representing derived tables as `DerivedTableScanNode`.

If the right-side join key has an index, CamusDB can use indexed join probing
instead of scanning the full right side repeatedly.

## Physical Plan Nodes

Common node types include:

| Node | Meaning |
| --- | --- |
| `TableScanNode` | Full table or forced index scan. |
| `IndexLookupNode` | Unique-index point lookup. |
| `IndexRangeScanNode` | Bounded or unbounded index range. |
| `FilterNode` | Residual predicate. |
| `AggregateNode` | Aggregate/grouping stage. |
| `HavingFilterNode` | Post-aggregate filter. |
| `SortNode` | In-memory sort. |
| `ProjectNode` | Projection and alias shaping. |
| `DistinctNode` | Duplicate elimination. |
| `LimitNode` | Limit/offset stage. |
| `SemiJoinNode` | Indexed `IN` / `NOT IN` subquery rewrite. |
| `NestedLoopJoinNode` | Join without indexed right-side probe. |
| `IndexNestedLoopJoinNode` | Join with indexed right-side probe. |
| `DerivedTableScanNode` | Scan of a derived table source. |

`QueryPlan` also carries a flattened `Steps` view for the linear executor. The
tree and linear list reference the same node instances.

## Execution

### Single-table path

`QueryExecutor` walks the flattened step list and chains
`IAsyncEnumerable<QueryResultRow>` operators.

Scan operators read from `KvTableStore`, decode rows with `RowEncoder`, apply
inline filters, and honor scan row limits.

Other stages include:

- `QuerySorter`
- `QueryAggregator`
- `QueryFilterer` for `HAVING`
- `QueryProjector`
- `QueryDistincter`
- `QueryLimiter`

### Join path

`QueryJoinExecutor` walks the plan tree recursively:

- Table scans read a source with any pushed-down filter.
- Derived tables materialize the inner query once.
- Nested loop joins merge left and right rows and evaluate `ON`.
- Indexed nested loops probe the right-side index per outer row.

The merged result then passes through the shared post-scan pipeline.

## EXPLAIN Internals

`PlanRenderer` is the shared canonical renderer for planner diagnostics.

It supplies:

- Stable node names.
- Node detail strings.
- Depth-first node walking used by SQL `EXPLAIN`.
- Optional distributed-planning metadata such as `OutputOrdering` and
  decomposability.

`ExplainExecutor` uses the planned tree to return one row per plan node.

`EXPLAIN (ANALYZE)` additionally enables runtime stats collection and executes
the query to populate counters such as:

- `actual_rows`
- `rows_read`
- `kv_lookups`
- `kv_scan_entries`
- `actual_time_ms` on the root node

`EXPLAIN (ANALYZE)` is currently limited to non-join queries.

## Statistics And Costing

`StatisticsManager` keeps lightweight advisory table statistics in Kahuna:

- Row count per table.
- Per-index entry counts.
- Running min/max bounds for indexed columns.

`CostEstimator` annotates plan nodes with estimated cardinality and cost. Those
annotations are exposed through `EXPLAIN`, and the planner can use them for a
small set of decisions, especially choosing a full scan over an unselective
index range and comparing `IN (...)` probe plans against wider scans.

This is still intentionally narrow. CamusDB does not yet use a broad
cost-based search across all join orders and operator alternatives.

## Optimizations Present Today

The planner already includes several concrete passes:

- Projection pushdown with `RequiredColumns`.
- Sort elision through `OutputOrdering`.
- Limit pushdown into scans.
- Filter absorption from scan bounds.
- Join predicate pushdown.
- Heuristic join reordering.
- Small cost-based veto for low-selectivity index range scans.

## Cost Model Status

The cost model is intentionally narrow today.

It does two things:

1. Annotates plan nodes with estimated cardinality and cost.
2. Replaces some low-value index range scans with full table scans.

What it does not yet do:

- Full cost-based join ordering.
- Broad index-choice enumeration.
- Mature distributed execution costing.
- Reliable join estimates across the whole tree.

So the correct mental model is still: heuristics choose most of the plan, and
the cost model refines one part of scan selection.

## Distributed-Ready Metadata

Even though execution is not yet a full distributed query engine, physical plan
nodes carry metadata for future distributed planning:

- `OutputOrdering`
- `EstimatedCardinality`
- `Cost`
- `PartitionLocality`
- `CanDecomposeToLocalPlusMerge`

This is why the planner can already talk about sort elision, local-vs-merge
capability, and plan annotations without requiring a complete distributed query
executor yet.

## Current Gaps

Important current limitations from the source design:

- `EXPLAIN (ANALYZE)` for joins is missing.
- `EXPLAIN (LOGICAL)` is mostly cosmetic today.
- Join costs are still rough.
- Descending-order exploitation is limited.
- The planner is not yet a broad cost-based optimizer.

These are the main boundaries for future planner work.

## Related Pages

See [Query Planning](/docs/query-planning) for user-facing capabilities,
[EXPLAIN](/docs/explain) for plan inspection, and
[Architecture](/docs/architecture) for the broader system layout.
