---
sidebar_position: 6.5
---

# Query planner internals

This page describes two steps. CamusDB turns SQL text into a physical plan. It
then executes that plan against the KV layer.

For the view that a user needs, read [Query Planning](/docs/query-planning) and
[EXPLAIN](/docs/explain) instead.

## The mental model

The planner of CamusDB sits between the SQL layer and the ordered transactional
KV store. [Kahuna](https://kahunakv.github.io/) provides that store.

The planner turns a declarative SQL query into a concrete plan of execution. It
answers five questions:

1. Which scan does the query use?
2. Which predicates can become bounds of that scan?
3. Can the plan omit a sort?
4. Which join algorithm suits the query?
5. Where do the stages belong for the aggregation, the `HAVING`, the projection,
   the `DISTINCT`, and the limit?

CamusDB has a planner with rules, and a stack of cost-based optimizers. The cost
model annotates a plan. It drives some decisions at all times. It can also take
over a broader search, of the access paths and of the join order. It does that
while the matching flags in the configuration are on. Those broad cost-based
flags are on by default.

The stack of the optimizer has four levels:

1. The statistics of a table, from live DML and from `ANALYZE`.
2. The estimate of the cardinality, from the row counts, the histograms, the
   counts of distinct values, and the bounds of the minimum and the maximum.
3. A weighted cost model. It covers a KV lookup, a range entry, a fetch of a
   primary row, work in memory, and the cost of the network.
4. A search of the plans, for the access paths and for the join order. The
   cost-based flags control that search, and they are on by default.

## The pipeline

Every `SELECT` follows this pipeline at a high level:

1. CamusDB parses the SQL text into a `NodeAst`.
2. It builds a typed logical model of the query.
3. It binds the names, the sources, and the aliases against the catalog.
4. It produces a tree for the physical plan.
5. It executes the plan. It uses either the executor for one table, or the path
   for a join.

These are the important data structures:

| Stage | Main type | Purpose |
| --- | --- | --- |
| Parse | `NodeAst` | The raw tree of the syntax. |
| Logical model | `SelectQuery` | A structured form of the source, the projections, the filters, the groups, the order, the limit, the offset, and the distinct flag. |
| Bound model | `BoundSelectQuery` | The logical query, plus the resolved tables, the aliases, and the rules for the names. |
| Physical plan | `QueryPlan` and `PhysicalPlanNode` | The selected tree of operators, plus a flat list of steps for the older path of one table. |
| Results | `QueryResultRow` | The output rows for the caller. |

## Logical plans and physical plans

The logical model of a query records what the query asks for. The physical plan
records how CamusDB obtains that result.

Here are two examples:

- The logical form is "the rows of `robots` where `year = 2024`".
- The physical form is "a range scan of `year_idx`, from `2024` to the next
  boundary of a key".

CamusDB keeps an expression as a subtree of the AST, deep into the execution.
That rule covers a predicate and a projection expression. The structured models
mostly describe the shape of the query, and the relations between the sources.

## Two paths of execution

CamusDB has two paths of execution today:

| Path | CamusDB uses it when | Main executor |
| --- | --- | --- |
| The linear path for one table | The query has exactly one source | `QueryExecutor` |
| The tree path for several sources | The query has a join or a derived table | `QueryJoinExecutor` |

The two paths must agree on every behavior that a user sees. The path for
several sources walks a tree recursively. It then uses the shared pipeline after
the scan, for the aggregation, the sort, the projection, the `DISTINCT`, and the
limit.

## Parse and build

The parser accepts these forms:

- `SELECT [DISTINCT]`
- `WHERE`
- `GROUP BY`
- `HAVING`
- `ORDER BY`
- `LIMIT` and `OFFSET`
- `JOIN`, and a join with a comma
- A derived table
- A scalar subquery, and an `IN`, `NOT IN`, or `EXISTS` subquery
- Membership of a value list, with `IN (...)` and `NOT IN (...)`
- `EXPLAIN (LOGICAL|PHYSICAL|ANALYZE)`

`SelectQueryCreator` turns the parsed tree into a `SelectQuery` record. That
record holds nine fields:

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

`QueryBinder` resolves the names of the sources. It opens the descriptors of the
tables. It detects a collision between two aliases. It builds the resolver for
the row names. That resolver decides whether a reference to a column is valid,
ambiguous, or in need of a qualifier.

The binder also validates four things:

- The references of the projections.
- The agreement between the `GROUP BY` and the projections.
- The references of the `ORDER BY`.
- The `ON` predicates of a join.

The binder also prepares the support for `EXISTS`. It uses the registry of the
subqueries, which the execution then uses.

## The plan for one table

The planner for one table runs in broad phases.

### 1. Selection of the scan

The planner analyzes the predicate. It then tries to select one of five scans:

- A full table scan.
- A forced index scan.
- A point lookup on a unique index.
- A range scan on an index.
- An index scan over an `IN` list, when repeated probes beat a wider scan.

`PredicateAnalyzer` divides the predicates into three groups:

- The comparisons that an index can serve.
- The comparisons between two columns.
- The residual conjuncts.

`IndexScanSelector` operates in two modes. The heuristic mode scores each usable
index with rules such as these:

- A full equality on a unique index beats every other candidate.
- An equality on a non-unique index, and a match on a prefix of equalities, are
  strong candidates.
- A prefix of equalities, plus a range on the next column, can drive a composite
  range scan.
- A match on the prefix of an `ORDER BY` can win, even without a predicate that
  filters.
- An `IN (...)` list on an indexed column can compete with a range scan and with
  a full scan.

`cost_based_access_path_enabled` defaults to `true`. The planner therefore uses
the cost-based selection of an access path when the statistics of the table are
available. It enumerates every viable candidate scan, plus the baseline of a
full scan. It estimates the cost of each candidate. It keeps the cheapest one.

The scans that locate the rows of an `UPDATE` and of a `DELETE` keep the
heuristic path. That rule prevents an unexpected growth of the ranges of the
exclusive locks.

### 2. Absorption of the filters

The planner selects the bounds of the scan first. It then removes from the
runtime filter every comparison that those bounds already imply. The remaining
predicate becomes the residual filter of the execution.

### 3. Elision of the sort

The selected scan can already produce the rows in the requested order. The
planner then sets `OutputOrdering`. It omits the explicit `SortNode`.

The order of an index has a direction. A scan over `(year ASC)` can satisfy
`ORDER BY year ASC`. A scan over `(year DESC)` can satisfy `ORDER BY year DESC`.
A difference in the direction keeps the `SortNode`. CamusDB does not invert a
forward index scan into the opposite order.

### 4. The strategy for DISTINCT

For a `SELECT DISTINCT`, the planner selects between two forms:

- A `DistinctNode` in streaming mode. It needs three conditions: the projected
  columns are simple identifiers, every one of them is `NOT NULL`, and the order
  of the scan covers them.
- A `DistinctNode` in hash mode. The planner uses it when the streaming mode is
  unsafe or impossible.

A distinct in streaming mode can also satisfy a matching `ORDER BY`. The plan
then needs no separate `SortNode`.

### 5. Pushdown of the limit

The shape of the query can be simple enough. The planner then pushes the limit
on the row count into the scan. The KV read can therefore stop early.

### 6. Construction of the chain of operators

The planner builds a chain of operators, from the leaf to the root. These
patterns are typical:

| Shape of the query | Chain of operators |
| --- | --- |
| A plain select | `Scan -> [Filter] -> [Sort] -> [Limit] -> [Aggregate] -> [Having] -> [Project]` |
| A grouped query | `Scan -> [Filter] -> Aggregate -> [Having] -> [Sort] -> [Project] -> [Limit]` |
| A distinct query | `Scan -> [Filter] -> [Aggregate] -> [Having] -> [Project] -> Distinct -> [Sort] -> [Limit]` |

## The plan for a join

`JoinQueryPlanner` handles a query with several sources.

Its work includes six tasks:

- An optional change of the join order.
- A pushdown of a predicate that belongs to one source.
- A separation of the predicates after the join from the predicates local to a
  scan.
- The construction of a `NestedLoopJoinNode`, an `IndexNestedLoopJoinNode`, a
  `HashJoinNode`, or a `MergeJoinNode`.
- The construction of a variant of `SemiJoinNode`, for an eligible indexed `IN`
  or `NOT IN` subquery.
- The representation of a derived table as a `DerivedTableScanNode`.

For an inner equi-join, the planner extracts the pairs of join keys. It does so
even when no index is available. A hash join and a merge join therefore become
possible, together with an indexed nested-loop join.

The main rules of the selection are these:

- Use an `IndexNestedLoopJoinNode` when the join key of the right side has a
  good index, and when the estimate makes repeated probes cheaper.
- Use a `MergeJoinNode` when CamusDB can read both sides in the order of the
  join key, and when the outer side is large enough.
- Use a `HashJoinNode` when a plan that builds and probes is cheaper for an
  equi-join. Use it also when the right side has no usable index on the join
  key.
- Use a `NestedLoopJoinNode` when the join fits none of those shapes.

A hash join builds a hash table in memory, from the side that the estimate calls
smaller. It then probes that table with the other side.

A merge join streams two ordered inputs. It buffers only the current run of
equal keys, while both sides are ordered.

## The nodes of a physical plan

These node types are the common ones:

| Node | Meaning |
| --- | --- |
| `TableScanNode` | A full table scan, or a forced index scan. |
| `IndexLookupNode` | A point lookup on a unique index. |
| `IndexRangeScanNode` | A range on an index, with or without bounds. |
| `FilterNode` | A residual predicate. |
| `AggregateNode` | The stage of the aggregation and of the groups. |
| `HavingFilterNode` | A filter after the aggregation. |
| `SortNode` | A sort in memory. |
| `ProjectNode` | The projection, and the shape of the aliases. |
| `DistinctNode` | The removal of the duplicates. |
| `LimitNode` | The stage of the limit and of the offset. |
| `SemiJoinNode` | The rewrite of an indexed `IN` or `NOT IN` subquery. |
| `NestedLoopJoinNode` | A join without an indexed probe on the right side. |
| `IndexNestedLoopJoinNode` | A join with an indexed probe on the right side. |
| `HashJoinNode` | An inner equi-join with a hash table in memory. |
| `MergeJoinNode` | An inner equi-join over two ordered inputs. |
| `DerivedTableScanNode` | A scan of a derived table as a source. |

`QueryPlan` also carries a flat `Steps` view, for the linear executor. The tree
and the linear list reference the same instances of the nodes.

## Execution

### The path for one table

`QueryExecutor` walks the flat list of steps. It chains the operators of type
`IAsyncEnumerable<QueryResultRow>`.

A scan operator reads from `KvTableStore`. It decodes a row with `RowEncoder`.
It applies the inline filters. It respects the limits on the rows of a scan.

These are the other stages:

- `QuerySorter`
- `QueryAggregator`
- `QueryFilterer`, for the `HAVING`
- `QueryProjector`
- `QueryDistincter`
- `QueryLimiter`

### The path for a join

`QueryJoinExecutor` walks the tree of the plan recursively:

- A table scan reads a source, with any filter that the planner pushed down.
- A derived table materializes the inner query one time.
- A nested loop join merges the rows of the left side and of the right side. It
  then evaluates the `ON` predicate.
- An indexed nested loop probes the index of the right side, once for each outer
  row.
- A hash join materializes the build side into a hash table in memory. The keys
  of that table are the columns of the equi-join. The executor then streams the
  other side, and it probes the table. The build side can exceed
  `HashJoinMaxBuildRows` while spill is enabled. `GraceHashJoinAsync` then
  divides both inputs into spill files. It joins one partition at a time. While
  spill is disabled, the execution of that query falls back to the behavior of a
  nested loop.
- A merge join advances the ordered left input and the ordered right input
  together. The two sides can be ordered by the join key already, and the
  executor then streams them. Otherwise the executor can materialize the
  unordered side, and sort it first.

The merged result then passes through the shared pipeline after the scan.

## The internals of EXPLAIN

`PlanRenderer` is the one canonical renderer for the diagnostics of the planner.

It supplies four things:

- Stable names for the nodes.
- The detail string of a node.
- A depth-first walk of the nodes, which the SQL statement `EXPLAIN` uses.
- Optional metadata for a distributed plan, such as `OutputOrdering` and the
  ability to decompose a node.

`ExplainExecutor` uses the planned tree. It returns one row for each node of the
plan.

`EXPLAIN (ANALYZE)` also enables the collection of the runtime statistics. It
executes the query, and it fills counters such as these:

- `actual_rows`
- `rows_read`
- `kv_lookups`
- `kv_scan_entries`
- `actual_time_ms`, on the root node

`EXPLAIN (ANALYZE)` supports a query without a join only, at present.

## Statistics and cost

`StatisticsManager` keeps advisory statistics of a table in Kahuna:

- The row count of each table.
- The count of the entries of each index.
- The running bounds of the minimum and the maximum, for an indexed column.
- Equi-depth histograms. A manual `ANALYZE` builds them, and an automatic
  `ANALYZE` builds them.
- The counts of the distinct values, for a column and for the prefix of a
  composite index. A manual `ANALYZE` builds them, and an automatic `ANALYZE`
  builds them.

`ANALYZE TABLE <name>` scans the table. For a larger table, it samples the
configured number of rows instead. It then rebuilds the histograms and the
counts of the distinct values, in one pass.

Three statistics that DML maintains stay advisory: the row count, the counts of
the index entries, and the bounds of the minimum and the maximum. An absent
statistic falls back to a default. It does not make a query fail.

Automatic analyze uses the same path of publication. It nevertheless runs from a
background scheduler, against a read-only snapshot that takes no lock. It
detects a stale table from the count of the mutations since the last analyze. It
bounds the memory with a reservoir sketch and a HyperLogLog sketch. It throttles
the rate of the scan. It publishes the refreshed statistics atomically, after it
confirms the ownership in the cluster.

`CostEstimator` annotates a node of a plan with an estimated cardinality and an
estimated cost. `EXPLAIN` exposes those annotations. The planner uses them for
five decisions:

- A broad choice between an index range and a full scan.
- A choice between a plan of seeks for an indexed `IN (...)` and a wider scan.
- The selection of a join algorithm, among the indexed nested loop, the hash
  join, and the merge join.
- The enumeration of the access paths by cost, while
  `cost_based_access_path_enabled` is on.
- The enumeration of the join orders by cost, while
  `cost_based_join_order_enabled` is on.

The cost is a weighted sum of five quantities:

1. The point lookups in the KV layer.
2. The range entries.
3. The fetches of a row after an index hit.
4. The rows in memory.
5. The `NetworkFactor`.

The `NetworkFactor` comes from three inputs: the estimate of the remote rows,
the width of a row, and the configured count of the partitions in the cluster.
It is zero for a plan on one node, and for a plan without shards.

## The optimizations of today

The planner already includes several concrete passes:

- A pushdown of the projection, with `RequiredColumns`.
- An elision of the sort, through `OutputOrdering`.
- A pushdown of the limit into a scan.
- An absorption of a filter into the bounds of a scan.
- A pushdown of a predicate of a join.
- A heuristic change of the join order.
- A veto by cost, for an index range scan with a low selectivity.
- A selection of the join algorithm with the help of the cost, for an eligible
  equi-join.
- An enumeration of the access paths by cost, through
  `cost_based_access_path_enabled`.
- An enumeration of the join orders by cost, through
  `cost_based_join_order_enabled`.

## The status of the cost model

The cost model is complete. CamusDB uses it in five layers:

1. Always on: it annotates a node of a plan with an estimated cardinality and an
   estimated cost.
2. Always on: it replaces an index range scan of low value with a full scan,
   when the estimate passes the point of equal cost.
3. Always on: it compares the shapes of an indexed nested loop, of a hash join,
   and of a merge join, for an eligible equi-join.
4. Opt-in: it enumerates every viable access path of a table, and it costs each
   one.
5. Opt-in: it enumerates the connected left-deep orders of an inner join, and it
   costs each one.

The current limits are intentional boundaries around the search space. They are
not the absence of a cost model.

The enumeration of the join order is left-deep. CamusDB caps it for a very wide
join. It falls back for a shape that it cannot reorder safely. The dynamic
program does not keep several alternatives of an interesting order yet, for the
same set of tables.

## Metadata for a distributed plan

The execution is not a complete distributed query engine yet. A node of a
physical plan nevertheless carries metadata for a distributed plan in the
future:

- `OutputOrdering`
- `EstimatedCardinality`
- `Cost`
- `DataDistribution`
- `CanDecomposeToLocalPlusMerge`

For that reason, the planner can already describe three things: an elision of a
sort, the ability to divide work into a local part and a merge, and the
annotations of a plan. It needs no complete distributed executor.

## Current gaps

These limits come from the design of the source:

- `EXPLAIN (ANALYZE)` does not support a join.
- `EXPLAIN (LOGICAL)` is mostly cosmetic today.
- The use of a descending order is limited.
- The search of the access paths by cost, and the search of the join order by
  cost, are on by default.
- The dynamic program for the join order is left-deep. It does not keep several
  alternatives of an interesting order or of a distribution, for each subset.

These are the main boundaries for future work on the planner.

## Related pages

See [Query Planning](/docs/query-planning) for the capabilities that a user
sees. See [EXPLAIN](/docs/explain) for the inspection of a plan. See
[Architecture](/docs/architecture) for the wider layout of the system.
