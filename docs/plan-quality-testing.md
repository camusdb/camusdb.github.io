---
sidebar_position: 6.55
description: "How CamusDB tests its query planner. Repeatable work counters, result hashes, and committed baselines catch a plan that returns the right rows but reads much more data."
---

# Plan quality testing

A planner change can return the right rows and read much more data than before.
A correctness test doesn't catch this. `CamusDB.PlanQuality.Tests` executes a
fixed set of queries on generated data. It compares the result and the work of each
query with a committed baseline. A change that makes a plan read much more data
fails the gate.

- [Test project](https://github.com/camusdb/camusdb/tree/main/CamusDB.PlanQuality.Tests)
- [Nightly workflow](https://github.com/camusdb/camusdb/actions/workflows/plan-quality-nightly.yml)
- [Contributor guide](https://github.com/camusdb/camusdb/blob/main/docs/plan-quality-harness.md),
  including how to add a query

## What it checks

The harness executes each query with `EXPLAIN (ANALYZE)` and as a normal query. It
records the following measurements:

| Measurement | What it catches |
| --- | --- |
| Result hash | Wrong or missing rows. The hash doesn't depend on row order or column order. |
| Work | Plans that read more data. Work is `rows_read + kv_lookups + kv_scan_entries`, summed over the plan nodes. |
| Statement rows read | Reads that no plan node shows, such as a materialized subquery. |
| Join steps costed | More work to choose a join order. |
| Plan fingerprint | Changes to the operators and the main plan details. |
| Cardinality error | Large differences between the estimated rows and the actual rows (q-error). |
| Planning and execution time | Slow queries, for investigation. Times aren't graded. CI machines vary too much. |

The gate fails in the following cases:

- A query returns an error, or it takes longer than the query timeout.
- A result changes. In the Join Order Benchmark suite, a result that differs
  from SQLite also fails.
- The work of a query grows by more than 1.5 times and by more than 100. The
  same limits apply to the statement rows read and to the join steps costed.
- The geometric mean of the work ratios over all queries grows by more than 5%.
  This catches a small slowdown that is spread over many queries.
- The queries in the corpus don't match the baseline, or the baseline is for a
  different data set or scale.

The limit of 100 is for small queries. For example, a query whose work goes
from 3 to 6 doubles its work, and it passes.

A new plan passes if it returns the same result and its work is in the limits.
The report lists these changes as notes for review:

- A changed plan fingerprint.
- Work that went down past the limits. Update the baseline to keep the gain.
- A maximum q-error that moved by more than 2 times.

## Test suites

| Suite | Coverage | When it's tested |
| --- | --- | --- |
| Small retail | 99 queries, from single-table access paths to joins of 17 tables. The data has skew, correlated columns, duplicate keys, and `NULL` values. | Pull requests and pushes. |
| Larger retail | The same queries at scale 4. The large tables have 4 times more rows, and the small tables keep their size. This shows plan choices that the small data hides. | Nightly. |
| [Join Order Benchmark](https://www.vldb.org/pvldb/vol9/p204-leis.pdf) | 113 join queries on synthetic IMDB data. SQLite gets the same generated rows, and it checks the results independently. | Nightly. |

The counters must be the same on each run. For this reason, the data
generators use fixed seeds and load the rows in a stable order. The harness also
uses `ANALYZE` on each table. It turns off the background jobs and the caches
that change the counters, such as automatic analyze and the plan cache.

## Run locally

Run the small suite, as the pull request check does:

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

`JOB_SCALE` must be the scale that you passed to `prepare.sh`. A baseline exists
for the scales `0.001` and `0.003`. The nightly job uses `0.003`.

The following environment variables change a run:

| Variable | Default | Effect |
| --- | --- | --- |
| `PLAN_QUALITY_SCALE` | `1` | The scale of the retail data. Each scale has a separate baseline. |
| `PLAN_QUALITY_ONLY` | All queries | A comma-separated list of query IDs, to investigate a subset. A partial run can't update a baseline. |
| `PLAN_QUALITY_REPORT_DIR` | `plan-quality` in the test output directory | The directory for the Markdown and JSON reports. |
| `PLAN_QUALITY_QUERY_TIMEOUT_SEC` | `60` | The time limit for one query. The nightly Join Order Benchmark job uses `120`. |
| `PLAN_QUALITY_UPDATE_BASELINE` | Not set | `1` writes a new baseline. See [Update a baseline](#update-a-baseline). |

## Read a report

Each run writes a Markdown report and a JSON report, also when the gate fails.
For the small suite at scale 1, the files are `small-sf1-report.md` and
`small-sf1-run.json`. The nightly job uploads them.

The Markdown report starts with the gate result and the totals, such as the
geometric mean of the work ratios. Then look at these sections:

- **Failures** lists the queries that failed the gate, with the reason. The
  section is shown when a query failed.
- **Notes (not failures)** lists the changes for review, such as work
  improvements and changed plans.
- **Work by tag** groups the work by query type, for example `tables:3`.
- **Plan changes** compares the operators of each changed plan, before and
  after.
- **Worst estimates** lists the plan nodes with the largest q-error.

The sections that end with "(not graded)" are for investigation. The JSON report
has the counters of each plan node, for automated comparison.

## Update a baseline

Update a baseline when a planner change is intended, and you reviewed its
results and work:

```bash
PLAN_QUALITY_UPDATE_BASELINE=1 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~SmallTierGate
```

The update needs all queries. Before it writes the file, the harness executes
each query again on a reference planner configuration, with the cost-based choices
turned off. If a query fails, or a result differs, no baseline is written.

Commit the baseline with the planner change, and describe why the plans moved.
The baselines are in `CamusDB.PlanQuality.Tests/Baselines`, one file for each
suite and scale.

## Randomized SQL testing

`CamusDB.SqlFuzz.Tests` generates random SQL. It compares queries that must
return the same rows, and it finds wrong results that no error shows. A second
database isn't needed.

| Check | What it compares |
| --- | --- |
| Predicate partitioning (TLP) | A full result with the rows where a predicate is true, false, or `NULL`. |
| Count rewriting (NoREC) | Two equivalent ways of counting the matching rows. |
| Plan equivalence | The results under index or full-scan hints, planner settings, and forced join strategies. |
| Error classification | Expected SQL errors against internal errors, hangs, and invalid JSON from the HTTP API. |
| Write integrity | The expected effect of each write on rows, indexes, covering columns, and large values. |

Run the five campaigns from a CamusDB checkout:

```bash
SQLFUZZ_SEED=42 SQLFUZZ_BUDGET_SECONDS=30 \
  dotnet test CamusDB.SqlFuzz.Tests/CamusDB.SqlFuzz.Tests.csproj \
  --filter 'FullyQualifiedName~.FuzzCampaignTests.'
```

`SQLFUZZ_BUDGET_SECONDS` is the time for each check. Without `SQLFUZZ_SEED`,
the seed comes from the clock, or from the run number in CI. The seed is printed
at the start of the run.

For each finding, the fuzzer records the seed and the round. It shrinks the SQL
to a smaller failing case, and it prints a regression test that you can paste
into `CamusDB.Tests`. The files go to `sqlfuzz-findings` in the test output
directory. `SQLFUZZ_OUTPUT_DIR` changes the location.

To replay one finding, set the following variables:

- `SQLFUZZ_SEED` and `SQLFUZZ_ROUND` to the recorded values.
- `SQLFUZZ_ORACLE` to the check that found it: `tlp`, `norec`, `plan`, `error`,
  or `dml`.

The [nightly workflow](https://github.com/camusdb/camusdb/actions/workflows/sql-fuzz-nightly.yml)
uses a new seed each night and uploads the findings. Note the following limits:

- The fuzzer uses one session at a time. It doesn't test concurrency or faults.
  For distributed fault testing, see [Caraxes](/docs/caraxes).
- The row comparisons skip shapes that depend on row order, such as `LIMIT` and
  window functions. The error check covers them.
- A defect that affects all the compared forms of a query can't be found.

For all settings, see the
[fuzzer guide](https://github.com/camusdb/camusdb/blob/main/docs/sql-fuzzer.md).

## Comparison with SQLite and PostgreSQL

The Join Order Benchmark also gives a reference comparison with SQLite and
PostgreSQL. The three databases get the same generated rows and indexes. Each
analyzes the tables and executes the same 113 queries. They return the same results.

| Measurement | CamusDB | SQLite | PostgreSQL |
| --- | ---: | ---: | ---: |
| Setup | Embedded node in the test process | In-process library | Local server |
| Total execution time | 1.5 s | 7.2 s | 0.74 s |
| Total planning time | 0.09 s | Not reported separately | 0.72 s |
| Median query | 2.8 ms | 0.4 ms | 0.7 ms |

Each query is warmed up, and the best of several executions is used. The
CamusDB times include the counters that `EXPLAIN (ANALYZE)` collects.

The comparison is for reference. It isn't part of the gate. The three databases
have different storage and execution designs, and a few hard queries can
decide the total time. This is why the gate grades work counters and result
hashes.

## Single-node scope

The suites test one CamusDB node. They don't grade
[distributed queries](/docs/distributed-queries) or data placement. Those need
cluster and fault-injection tests. For more information, see
[Caraxes](/docs/caraxes).
