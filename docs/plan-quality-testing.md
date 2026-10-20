---
sidebar_position: 6.55
---

# Plan quality testing

`CamusDB.PlanQuality.Tests` detects planner regressions that ordinary
correctness tests can miss. A query may return the right rows while reading far
more data than before. The suite runs a stable query corpus against deterministic
data and compares the result and execution work with committed baselines.

- [Test project](https://github.com/camusdb/camusdb/tree/main/CamusDB.PlanQuality.Tests)
- [Nightly workflow](https://github.com/camusdb/camusdb/actions/workflows/plan-quality-nightly.yml)

## What it checks

Each query runs through `EXPLAIN (ANALYZE)` and as an ordinary query.

| Check | What it catches |
| --- | --- |
| Result hash | Wrong or missing result rows. Rows and columns are normalized before hashing. |
| Work | Plans that read more data. Work is `rows_read + kv_lookups + kv_scan_entries` across the plan. |
| Statement rows read | Reads that are not represented by a rendered plan node, such as materialized subqueries. |
| Join steps costed | Unexpected growth in join-order planning work. |
| Plan fingerprint | Changes to operators and important plan details. |
| Cardinality error | Large differences between estimated and actual rows. |
| Planning and execution time | Diagnostic timing; it does not fail the gate because CI machines vary. |

The gate fails when a query errors, times out, changes its result, or performs a
significant amount of additional work. A per-query work counter must grow by
more than 1.5 times and by more than 100 units to fail. The gate also limits the
geometric-mean work increase across the complete corpus to 5%.

A different plan is not automatically a regression. It passes when it returns
the same result without exceeding the work limits. Lower work and changed
cardinality estimates are reported for review.

## Test suites

| Suite | Coverage | When it runs |
| --- | --- | --- |
| Small retail | Scans, indexes, joins, outer joins, subqueries, skew, correlated columns, duplicate keys, and `NULL` values. | Pull requests and pushes. |
| Larger retail | The same query corpus with more rows, exposing choices hidden at the smaller scale. | Nightly. |
| [Join Order Benchmark](https://www.vldb.org/pvldb/vol9/p204-leis.pdf) | A wider join corpus over synthetic IMDB data. SQLite runs against the same generated rows as an independent result oracle. | Nightly. |

The data generators use fixed seeds and load rows in a stable order. The suite
runs `ANALYZE` explicitly and disables caches and background jobs that would
make counters vary between runs.

## Comparison with SQLite and PostgreSQL

The Join Order Benchmark also provides a reference comparison with SQLite and
PostgreSQL. All three databases receive the same generated rows and indexes,
run `ANALYZE`, and execute the same 113 queries. They return the same results.

| Measurement | CamusDB | SQLite | PostgreSQL |
| --- | ---: | ---: | ---: |
| Total execution time | 1.5 s | 7.2 s | 0.74 s |
| Total planning time | 0.09 s | Not reported separately | 0.72 s |
| Median query | 2.8 ms | 0.4 ms | 0.7 ms |

CamusDB runs as an embedded single node inside the test process, SQLite as an
in-process library, and PostgreSQL as a local server. Each query is warmed up
and the best repeated execution is used. CamusDB timing includes the counters
collected by `EXPLAIN (ANALYZE)`.

This comparison is a reference, not a pass/fail gate. The databases have
different storage and execution architectures, and aggregate time can be
dominated by a few difficult queries. The plan-quality gate therefore grades
repeatable work counters and result hashes instead of relative wall-clock
speed.

## Nightly job

The nightly workflow runs the larger retail and Join Order Benchmark suites. It
can also be started manually for a selected Git ref.

Each job uploads Markdown and JSON reports even when the gate fails. A failed
run should be investigated through the work counters and changed plan
fingerprints; wall-clock variation by itself does not make the job fail.

The nightly suite helps answer three questions:

1. Does every query still return the expected result?
2. Did a planner change make any query read substantially more data?
3. Did join-order planning become substantially more expensive?

## Run locally

Run the small suite used for pull requests:

```bash
dotnet test CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter TestCategory=PlanQuality
```

Run the larger retail suite:

```bash
PLAN_QUALITY_SCALE=4 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~SmallTierGate
```

Prepare and run the Join Order Benchmark suite:

```bash
scripts/plan-quality/job/prepare.sh /tmp/camusdb-job 0.003

JOB_DIR=/tmp/camusdb-job JOB_SCALE=0.003 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~JobTierGate
```

Set `PLAN_QUALITY_REPORT_DIR` to choose the report directory. Use
`PLAN_QUALITY_ONLY` with comma-separated query ids to investigate a subset.
Partial runs cannot update a baseline.

## Read a report

Start with these sections:

- **Gate failures** identifies queries that changed results or exceeded a work
  limit.
- **Plan changes** compares operator fingerprints before and after the change.
- **Work by query** shows which scan, lookup, or join became more expensive.
- **Cardinality estimates** highlights the largest differences between
  estimated and actual rows.
- **Timings** help investigation but are not graded.

The JSON report contains the counters for every plan node and is suitable for
automated comparison.

## Update a baseline

Update a baseline only when a planner change is intentional and its result and
work have been reviewed:

```bash
PLAN_QUALITY_UPDATE_BASELINE=1 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~SmallTierGate
```

Before writing a baseline, the harness verifies results against a reference
planner configuration. It writes nothing when a query fails or produces a
different result.

Commit the baseline with the planner change and describe why the affected plans
moved. Separate baselines exist for each data suite and scale.

## Scope

The suite exercises a single CamusDB node. It does not grade
[distributed queries](/docs/distributed-queries), such as gathering rows from
other nodes and broadcast joins, or data placement decisions. Those paths require cluster
and fault-injection tests. See [Caraxes](/docs/caraxes) for distributed
reliability testing.
