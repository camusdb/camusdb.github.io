---
sidebar_position: 6.5
---

# Query planner internals

This page describes two steps. CamusDB turns SQL text into a physical plan. It
then executes that plan against the KV layer.

Start with [Query Planning](/docs/query-planning) for SQL examples and tuning,
and [EXPLAIN](/docs/explain) for reading a plan. This page follows the same
concepts into the implementation: representations, rewrite safety, search,
costing, cache replay, and execution.

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
the cost-based selection of predicate-driven access paths when the table has
a positive row-count estimate and analyzed statistics. A DML-maintained count
alone does not enable this single-table enumeration pass. It compares viable
index candidates with a full-scan baseline and keeps the cheapest estimate.
Ordering and DISTINCT rules can further affect the final scan.

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

### Reading fewer columns

`ProjectionPushdownPlanner` and `RequiredColumnAnalyzer` determine which
columns execution still needs. The set includes columns used by predicates,
join keys, ordering, and aggregation, not just the final SELECT list. Scan-time
decoding can then avoid building values for unrelated columns.

This is distinct from index-only execution: partial decoding saves work on a
row that was fetched, while a covering index can avoid fetching that primary
row altogether. Both optimizations must retain columns needed by later stages,
even if those columns never appear in the result.

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

An inner hash join builds a hash table from the side estimated to be smaller
and probes it with the other side. A left outer hash join always builds the
right side, leaving the preserved left input as the probe side. Unmatched
left rows receive NULL values for right-side columns.

A merge join streams two ordered inputs. It buffers only the current run of
equal keys, while both sides are ordered.

## The join predicate graph

Before choosing an order, the planner must understand which conditions connect
which sources. `JoinPredicatePushdown` separates single-source `WHERE` filters
from conditions that must run after combining sources. `JoinGraph` then builds
a graph from the remaining eligible conditions and the `ON` clauses.

A graph leaf is a table or derived table identified by its bound alias. Each
leaf occupies one bit in a mask. A conjunct stores the mask of the sources it
references. For example, `a.id = b.a_id` names `{a,b}`, while
`a.x + b.x = c.x` names `{a,b,c}`. The latter can connect `c` to `{a,b}`, but
cannot connect `a` to `b` by itself: `c` is still needed to evaluate it.

The graph splits top-level `AND`s, not arbitrary Boolean expressions. An `OR`
expression remains one conjunct. Literal `TRUE` contributes no connection.
Thus, an `ON TRUE` introduced when normalizing a comma join is an initial
syntax representation, not a commitment to executing a cross product.

### Moving a condition to the earliest eligible join

For each proposed source order, `JoinGraph.BuildTree` attaches a movable
conjunct where its last referenced source enters the tree. A constant or a
condition referring only to the first source goes on the first join. Conditions
keep their pool order: original `ON` conjuncts first, then adopted `WHERE`
conjuncts. The builder checks that it attached every pooled conjunct once.

```camussql
SELECT a.id, b.id, c.id
FROM a
JOIN b ON a.x = b.x
JOIN c ON b.y = c.y AND a.z = b.z
WHERE c.kind = 'active' AND c.code = a.code;
```

For the order `a, b, c`, predicate placement is conceptually:

| Location | Conditions |
| --- | --- |
| Input `c` | `c.kind = 'active'`, when eligible for scan pushdown. |
| Join `a` with `b` | `a.x = b.x` and `a.z = b.z`. The second condition moved from the later `ON`. |
| Join the result with `c` | `b.y = c.y` and `c.code = a.code`. The second condition moved from `WHERE`. |

This example illustrates placement, not a promise that the optimizer chooses
that order. A different order attaches the same movable conditions at different
joins. `JoinOrderChoice` carries the rebuilt tree **together with** its remaining
post-join filter, so a condition taken from `WHERE` is not evaluated again there.

### Conditions that restrict movement

A cross-table `WHERE` conjunct enters the graph only if all of its column
references resolve, it contains no subquery, and
`FragmentFilterShippability.IsShippable` accepts it. This last check preserves
eligibility for [broadcast joins](/docs/distributed-queries): moving a condition
must not silently introduce a predicate that a peer cannot execute.

An unshippable `WHERE` conjunct stays after the joins. An unshippable `ON`
conjunct is pinned and contributes no connection of its own:

- A volatile condition, such as one involving `random()`, retains its original
  join scope. All sources in that scope must join before a source outside it
  enters. This preserves the combinations of rows on which the condition runs.
- Other unshippable conditions, including parameterized expressions, remain
  attached with their original `ON` clause's source requirements. They continue
  to block broadcast at that join instead of moving that restriction elsewhere.

If an `ON` contains a subquery or a column reference that cannot resolve to one
source, the graph declines the tree and the planner uses the whole-predicate
path. It also declines outer-join trees and trees with more than 64 leaves.
The cost-based search has a tighter limit of 12 leaves.

Predicate movement is not an evaluation-order guarantee. A deterministic cast
or division can execute before a later join removes a row, and therefore can
raise an error on that row. Single-table scan pushdown has the same implication.
Do not rely on the textual order of SQL conditions to guard an unsafe expression.

## Join-order search

There are two order-selection paths. Both preserve outer-join order after
normalization; `RIGHT JOIN` has already become a left join with swapped inputs.

### Heuristic order and cross-product repair

`JoinOrderOptimizer` assigns each leaf a simple score:

| Score | Filter opportunity |
| --- | --- |
| 0 | Equality on a unique index. |
| 1 | Another indexed predicate. |
| 2 | No pushable indexed predicate. |

It tries lower scores first, keeping declared order on ties, and rebuilds a
left-deep tree from whole `ON` predicates when feasible. A volatile `ON`
predicate prevents this heuristic reordering.

`Choose` then checks for an avoidable cross product. If the heuristic tree has
a join without a connecting conjunct, but the graph admits a connected order,
it rebuilds through `JoinGraph`. The repair tries sources in heuristic score
order and adds a remaining source only when it connects to the current set.
A tree without an avoidable cross product keeps the whole-predicate plan.
A query requiring a cross product retains the heuristic fallback.

This repair does not need statistics. It remains available with the cost-based
flag off, before row counts load, above the 12-source search limit, and when
the dynamic program finds no eligible full plan.

### Dynamic programming over subsets

`JoinEnumerator` performs a bottom-up dynamic program, in the style of System R.
It remembers the cheapest plan for each subset of sources, instead of repeatedly
searching every permutation from scratch. Its candidates are left-deep:
`((A join B) join C) join D`.

```text
best[{A}] = cost of scanning A as the first input

For increasing subset sizes:
    choose a source R in subset S
    L = S without R
    require a usable best[L]
    require R to connect to L
    require the subset to respect volatile-expression boundaries
    candidate = best[L] + cost of joining R to the result of L
    retain the candidate only if it is strictly cheaper
```

The search starts when `cost_based_join_order_enabled` is true, a statistics
manager is available, and every base table has a loaded row-count estimate.
It considers at most 12 leaves. It never enumerates a cross product. If no full
connected order is available, the heuristic handles the query.

Candidates for a subset are tried from the last declared source backward.
Strict cost comparison makes ties deterministic and preserves a feasible
declared order when it ties for the best cost. The winning order is rebuilt
through the graph, so order search and cache replay use the same attachment rule.

### Costing one join step

Let `L` be the estimated rows from the current left result, `R` the right rows
after its pushed filter, and `S` the cost of scanning the right table.
`CostEstimator.JoinStepCost` uses these relative work estimates:

| Candidate | Incremental cost | Eligibility |
| --- | --- | --- |
| Index nested loop | `2 × L` | A usable index on a right-side join key. |
| Hash join | `S + L + 0.1 × min(L, R)` | A usable equality key. |
| Nested loop | `max(1, L) × S` | Fallback without an equality key. |

An available index lookup wins unless hash is strictly cheaper. Eligibility is
checked with the same key analyzers as the physical builder. For a composite
condition such as `a.x = b.x AND a.y = b.y`, an index on `b.x` can provide the
probe while the full predicate still checks both comparisons.

The distinction between `R` and `S` matters. A pushed filter can reduce the
right table to ten output rows while still requiring a scan of a million rows.
For the scan-based right-input alternatives, `S` is the unfiltered table row
count. An index on that filter does not automatically reduce the right scan's
read cost. The first input can instead use an eligible filtered range or
`IN`-list index leaf; its initial scan cost reflects the builder's actual choice.

The `L` term makes hash-only join orders meaningfully different. Every later
join processes the intermediate result produced so far. Without charging for
that result, many orders would tie merely because they read the same base tables.

For an illustrative step with `L = 100`, `R = 10`, and `S = 100000`, indexed
probes cost `200`, while hash costs `100101`. Pricing the scan as only ten rows
would incorrectly make hash appear cheaper. These are model units, not timings.

`JoinEnumerator.EstimateSteps` passes each winning step's estimates to
`JoinQueryPlanner`. The builder uses them to compare indexed probes with hash,
choose the hash build side, and apply the merge-size threshold. The builder can
still prefer merge when both inputs have usable ordering and the left estimate
exceeds 100 rows. **Merge is not costed by the dynamic program**, so the final
operator is not always the operator priced during the search.

### One cardinality estimate per subset

A cached best plan for `{A,B,C}` needs a consistent row estimate regardless of
how those sources were joined. `EstimateSubsetRows` therefore derives its
estimate from the set of tables and predicates, rather than a particular tree:

```text
rows[subset] = product of filtered leaf row counts
             × selectivity factors for predicate groups in the subset
             × factors for classes of equal columns
```

For a simple equality between two keys, the selectivity is approximately
`1 / max(NDV_left, NDV_right)`. **NDV** means number of distinct values.
A recognized unique key uses its base table's row count as its distinct count;
a composite key can use composite NDV. If neither side has a count, the
fallback selectivity is `0.1`. Other edges, including non-equalities and
expressions, also use a fallback rather than a detailed distribution model.

With 1,000 orders and 100 customers joined through the unique customer key,
matching distinct counts of 100 predict `1000 × 100 / 100 = 1000` rows.
If a filter retains ten customers, the same assumptions predict 100 rows.
This assumes a distribution; it does not establish that each customer actually
has ten orders.

Equalities can also be redundant:

```text
a.key = b.key AND b.key = c.key AND a.key = c.key
```

The third condition adds no new restriction. Multiplying three independent
selectivities would underestimate the result. The estimator groups these
columns into an equivalence class and, over `k` participating tables, uses
`k - 1` factors. It omits the smallest distinct count from the denominators.
Two-column classes between the same table pair are grouped so composite-key
statistics can account for their correlation.

These classes improve estimates; they do not synthesize new join edges.
Writing only `a.key = b.key AND b.key = c.key` does not make `a` and `c`
directly connected for enumeration. Estimates remain doubles during the search;
conversion to bounded integer row counts happens where required.

## Plan cache

`PlanCache` is a per-process, thread-safe LRU cache. It defaults to disabled,
with a default capacity of 512 entries when enabled. The key combines database
identity with the literal-independent `QueryShapeId`.

The cache stores **decisions**, not an executable tree containing old values:

| Query kind | Cached decision | Work on a hit |
| --- | --- | --- |
| Single table | Index name and scan kind, or a primary-row scan. | Rebuild predicate bounds from current values, or restore an ordering/full-index scan after validating the index. |
| Join | Alias order and `JoinBuildMode`. | Rebuild the source tree and its predicates from the current bound query. |

There are three join build modes:

- `WholePredicate` replays the heuristic order through `ReorderByAliases`.
- `Conjunct` rebuilds the repaired order through `JoinGraph`.
- `CostBased` rebuilds through the graph and recomputes the step estimates for
  physical operator selection, while skipping the search for a new order.

Recording the mode is necessary even when the alias order did not change:
a condition may have moved to an earlier join within that same order. Replaying
only the aliases would lose that decision. Rebuilding from the current query
also ensures that literals in `ON` come from this execution.

Dependencies include table identity, schema version, index-set generation, and
analyze generation. A schema or index change, or publication of refreshed
histograms/NDV, invalidates the corresponding cached decision. DML row-count
changes alone are not an analyze-generation change. This is distinct from the
freshness rules of the [query result cache](/docs/query-result-cache).

A failed replay triggers a full replan. Internally, `ReplayFailures` counts
hits that could not be rebuilt; `Hits` alone is not evidence that enumeration
was skipped. Join replay validates the graph, the alias permutation, connectivity,
and the availability of estimates needed by the recorded mode.

Literal-independent reuse trades planning time for sensitivity to skew. A
cached index choice or join order can remain valid while being less efficient
for another value. New analyzed statistics invalidate the entry, but different
literals alone do not force a fresh search.

## The nodes of a physical plan

These node types are the common ones:

| Node | Meaning |
| --- | --- |
| `TableScanNode` | A full table scan, or a forced index scan. |
| `IndexLookupNode` | A point lookup on a unique index. |
| `IndexRangeScanNode` | A range on an index, with or without bounds. |
| `IndexInListScanNode` | Multiple seeks for a literal IN list, with duplicate values removed. |
| `FilterNode` | A residual predicate. |
| `AggregateNode` | The stage of the aggregation and of the groups. |
| `HavingFilterNode` | A filter after the aggregation. |
| `SortNode` | A sort, with eligible spill support; a bounded variant renders as `topk` and retains offset + limit candidates. |
| `ProjectNode` | The projection, and the shape of the aliases. |
| `DistinctNode` | The removal of the duplicates. |
| `LimitNode` | The stage of the limit and of the offset. |
| `SemiJoinNode` | The rewrite of an indexed `IN` or `NOT IN` subquery. |
| `NestedLoopJoinNode` | A join without an indexed probe on the right side. |
| `IndexNestedLoopJoinNode` | A join with an indexed probe on the right side. |
| `HashJoinNode` | An inner or left outer equi-join using a hash table, with eligible spill support. |
| `MergeJoinNode` | An inner or left outer equi-join over ordered inputs. |
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

Join plans use the same path. A join node records the work of its right side,
because the right side is named in the join detail rather than rendered as a
separate row. The detail can also add runtime facts such as `ran=grace-hash`,
`ran=nested-loop-fallback`, `ran=broadcast`, and the join-order estimate used by
the search.

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

For a single-column equi-join that is unique on neither side, the estimator uses
both histograms when they are available. `JoinKeyDistribution` separates values
that occupy a complete equi-depth bucket from a uniform residual, then sums the
matching frequencies. This avoids the uniform-distribution underestimate when
both sides are concentrated on the same popular values. Without heavy values,
or without both histograms, estimation falls back to the distinct-value model.

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

## Cost model boundaries

The cost model is implemented, but it is an approximation with separate uses.
`PlanCost.Total` weights KV point lookups, range entries, and primary-row
fetches at 1.0 each, in-memory rows at 0.1 each, then adds `NetworkFactor`.
These units compare alternatives; they are not milliseconds or measured I/O.

A non-covering secondary scan usually pays twice per match: once for its index
entry and once for the primary row. This explains the range-versus-table-scan
breakeven near half the table. Covering access-path candidates remove the
primary-row fetch charge. Selectivity, ordering requirements, and applicable
planner rules still determine the final choice.

`CostEstimator.AnnotatePlan` fills the fields shown by `EXPLAIN` after planning.
Those annotations are separate from the subset estimates used by join-order
search and need not match them. For a join over a join, annotation resolves a
left key's base table through its alias and uses its distinct count. It does
not assume that a key unique in the base table is still unique after an earlier
join has duplicated its rows.

The two search flags default to true. Turning them off selects the heuristic
paths; it does not remove cost annotations, all cost-informed operator choices,
or the heuristic's cross-product repair.

## Metadata and distributed execution

Physical nodes carry `OutputOrdering`, `EstimatedCardinality`, `Cost`,
`DataDistribution`, and `CanDecomposeToLocalPlusMerge`. These describe ordering,
estimated work, and whether computation can split into local work plus a merge.
They do not imply that every operator executes remotely.

With distributed execution enabled, eligible primary-row scans can become
fragments on span leaders, with coordinator gathering and supported filter or
partial-aggregate pushdown. Eligible inner hash joins can broadcast a bounded
build side for remote probing. Outer joins do not use that broadcast path.
See [Distributed Queries](/docs/distributed-queries) for exact eligibility,
fallbacks, and configuration, and [Spill to Disk](/docs/spill-to-disk) for
execution-time memory limits.

## Current gaps

| Boundary | Practical consequence |
| --- | --- |
| Connected left-deep enumeration, at most 12 sources | Wider queries and queries requiring a cross product use the heuristic; there is no bushy or component-by-component search. |
| No interesting-order or distribution alternatives per subset | A more expensive intermediate plan that could avoid a later sort or exchange is not retained for that benefit. |
| Merge join is outside the DP cost comparison | The physical builder can choose a merge operator after order selection. |
| Simplified index-lookup cost | `2 × leftRows` assumes one match per probe; non-unique indexes can have much higher fan-out. |
| Incomplete selectivity modeling | Missing statistics, correlations, and expression predicates can make row estimates poor. |
| Outer join anywhere in the tree | The join-order DP is skipped for the whole tree. |
| Heuristic/repaired trees use the builder's own estimates | A joined input can still receive the fixed 10,000-row fallback instead of a subset estimate. |
| Separate EXPLAIN annotation | Displayed join cardinalities are not a trace of the DP's candidate costs. |
| LOGICAL renders the physical tree | It is not a separate view of rewrite stages. |
| Forward index ordering | An opposite requested direction cannot simply reverse an index scan. |

## Finding the implementation

In the engine repository, query controllers below are under
`CamusDB.Core/Commands/Executor/Controllers/Queries/` unless another path is given.
Read the implementation alongside its tests; comments describing older planner
stages may predate a newer behavior.

| Area | Starting points |
| --- | --- |
| Parse and logical query | `SQLParser/` and `Controllers/DML/SelectQueryCreator.cs`, under the core project and command executor respectively. |
| Bind and resolve | `QueryBinder.cs`, `Models/Queries/BoundSelectQuery.cs`. |
| Single-table scan selection | `QueryPlanner.cs`, `PredicateAnalyzer.cs`, `IndexScanSelector.cs`. |
| Predicate movement | `CommaJoinNormalizer.cs`, `JoinPredicatePushdown.cs`, `JoinGraph.cs`. |
| Join search | `JoinOrderOptimizer.cs`, `JoinEnumerator.cs`, `JoinOrderChoice.cs`. |
| Statistics and costing | `CardinalityEstimator.cs`, `CostEstimator.cs`, core `Statistics/`, and executor `Models/Plans/PlanCost.cs`. |
| Physical join selection | `JoinQueryPlanner.cs`, `JoinEquiJoinAnalyzer.cs`. |
| Cache decisions | `QueryShapeComputer.cs`, `PlanCache.cs`, replay methods in both planners. |
| Execution | `QueryJoinExecutor.cs`, `QueryScanner.cs`, `QueryPostScanPipeline.cs`, and parent `QueryExecutor.cs`. |
| Explain | `PlanRenderer.cs` and `ExplainExecutor.cs`. |
| Distributed planning | `BroadcastJoinPlanner.cs`, `FragmentFilterShippability.cs`, `PlacementReader.cs`. |

`CamusDB.Tests/CommandsExecutor/TestJoinOrderConjunctGraph.cs` covers condition
attachment, comma joins, cross-table WHERE predicates, redundant equalities,
volatile boundaries, cache replay, and agreement between costed and built
operators. `TestQueryPlanner.cs`, `TestJoinQueryPlanner.cs`, and
`TestLeftOuterJoinPlanner.cs` cover the surrounding planning contracts.
`CamusDB.Cluster.Tests/TestClusterBroadcastJoin.cs` exercises the distributed
join path. These are useful starting points for understanding a behavior before
changing the planner.

## Related pages

See [Query Planning](/docs/query-planning) for the capabilities that a user
sees. See [EXPLAIN](/docs/explain) for the inspection of a plan. See
[Architecture](/docs/architecture) for the wider layout of the system.
