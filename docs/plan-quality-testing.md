---
sidebar_position: 6.55
---

# Plan quality testing

The `CamusDB.PlanQuality.Tests` project detects query-planner changes that keep
results correct but make queries perform substantially more work. It runs a
fixed corpus against deterministic data, records repeatable execution counters,
and compares them with baseline files committed to the CamusDB repository.

This complements correctness tests. A query can return exactly the same rows
after a planner change while reading ten times more data. The plan-quality gate
is designed to catch that regression.

- [Test project](https://github.com/camusdb/camusdb/tree/main/CamusDB.PlanQuality.Tests)
- [Nightly workflow](https://github.com/camusdb/camusdb/actions/workflows/plan-quality-nightly.yml)

## What the harness measures

Each query runs once through `EXPLAIN (ANALYZE)` for its plan counters and once
as an ordinary query for its result.

| Measurement | Purpose |
| --- | --- |
| Result hash | Gates correctness. Rows and columns are normalized before hashing. |
| Work | Sum of `rows_read`, `kv_lookups`, and `kv_scan_entries` across plan nodes. This is the primary plan-quality gate. |
| Statement rows read | Comes from the slow-query log and includes reads that have no rendered plan node, such as materialized derived sources. |
| Join steps costed | Detects growth in the work performed by join-order search. |
| Plan fingerprint | Reports operator and detail changes without unstable estimates or timings. |
| Join-order path | Reports whether planning was cost-based, heuristic, or replayed from cache. |
| Q-error | Compares estimated and actual rows. The report includes median and maximum error. |
| Planning and execution time | Diagnostic only; hosted runner timing never gates a build. |

The harness deliberately does not compare `estimated_cost`. A planner change
can legitimately change the cost model's units or weights.

## What fails the gate

A run fails when:

- A query fails or exceeds its timeout.
- A result hash changes.
- Work, statement rows read, or join steps costed grows by more than 1.5 times
  and by more than 100 units for one query.
- The geometric mean of work ratios across the corpus grows by more than 5%.
- The corpus and baseline contain different query ids.
- In the [Join Order Benchmark](https://www.vldb.org/pvldb/vol9/p204-leis.pdf) tier, CamusDB returns a different result from
  SQLite over the same generated rows.

Less work, a different plan with equivalent work, a changed join-order path,
and a large q-error change are reported for review but do not fail by
themselves.

## Test tiers

| Tier | Data and queries | Schedule |
| --- | --- | --- |
| Small, scale 1 | About 42,000 deterministic retail rows and 99 queries covering scans, join shapes, outer joins, and subqueries. | Every pull request and push to `main`, in the `Plan-Quality` job. |
| Small, scale 4 | The same corpus over four times the retail data. It exposes index and join choices hidden at the smaller scale. | Nightly. |
| JOB, scale 0.003 | About 225,000 synthetic IMDB rows and all 113 Join Order Benchmark queries. | Nightly. |

The retail data deliberately includes skewed foreign keys, correlated columns,
duplicate indexed values, `NULL` values, and a mixture of indexed and
unindexed relationships. This makes cardinality and access-path mistakes
observable.

The JOB preparation script downloads the query corpus from the pinned Join
Order Benchmark revision at runtime and creates matching SQLite results as an
independent correctness oracle.

## The nightly job

The `plan-quality-nightly` GitHub Actions workflow runs every day at 06:30 UTC
and can also be started manually for a selected Git ref. It has two independent
jobs:

1. `small-tier-large-scale` runs the retail corpus at scale 4, with a 35-minute
   test timeout.
2. `job` pins Python 3.12, prepares the synthetic IMDB and SQLite data, and runs
   the 113 JOB queries with a two-minute timeout per query.

Both jobs upload their Markdown and JSON reports even when the gate fails.
Artifacts are retained for 14 days. A red nightly run means the report needs
inspection; wall-clock variation alone cannot make it red.

## Current nightly values

These values come from the nightly run of 2026-10-15 on commit `97758d08`
([run 38788924979](https://github.com/camusdb/camusdb/actions/runs/38788924979)).
Both gates passed, and no plan changed against the committed baselines. Work
and rows are repeatable counters. Times come from a hosted `ubuntu-latest`
runner and are diagnostic only.

| Value | Small, scale 4 | JOB, scale 0.003 |
| --- | ---: | ---: |
| Queries run | 99 | 113 |
| Failures | 0 | 0 |
| Total work | 2,857,321 | 5,849,952 |
| Total statement rows read | 1,418,373 | 2,855,150 |
| Total planning time | 168 ms | 255 ms |
| Total execution time | 46.9 s | 91.7 s |
| Job wall time, including setup | 3.5 min | 6.3 min |

The largest estimation errors, as the maximum q-error of one plan node:

| Tier | Query | Maximum q-error |
| --- | --- | ---: |
| Small, scale 4 | `st-empty-result` | 24,000 |
| Small, scale 4 | `st-pk-range-order-limit` | 11,455 |
| Small, scale 4 | `sq-not-in-with-null` | 8,000 |
| JOB, scale 0.003 | `29a`, `29b`, `29c` | 38,304 |
| JOB, scale 0.003 | `15d` | 23,513 |
| JOB, scale 0.003 | `33c` | 4,368 |

The slowest queries on the hosted runner:

| Tier | Query | Execution time | Work |
| --- | --- | ---: | ---: |
| Small, scale 4 | `sq-exists-correlated` | 5.5 s | 100 |
| Small, scale 4 | `jy-5-cycle-supplier-city` | 4.9 s | 181,245 |
| Small, scale 4 | `jc-2-group-by` | 4.1 s | 132,545 |
| JOB, scale 0.003 | `16d` | 17.8 s | 201,143 |
| JOB, scale 0.003 | `16c` | 16.8 s | 201,178 |
| JOB, scale 0.003 | `15d` | 8.5 s | 1,003,538 |

The per-query timeouts are 60 seconds in the small tier and 120 seconds in
the JOB tier. The slowest query of each tier stays well below its limit.

## CamusDB versus SQLite and PostgreSQL on the Join Order Benchmark

The JOB tier keeps a SQLite twin of its data as a correctness oracle. The same
rows give a timing reference against two mainstream engines: SQLite, the
embedded library, and PostgreSQL 16, the server the benchmark was written for.
The values below come from one machine on 2026-10-15, on CamusDB 0.15.2, which
brings four changes to the join path: the probe bound (a probe scans only the
entries of its key), Kahuna 1.12.3 (a bounded page read stops at its end key),
the allocation diet of the probe path, and the join-order search over reachable
table subsets, which plans joins of up to 30 tables. All three engines returned
the same row for all 113 queries.

| | CamusDB | SQLite | PostgreSQL |
| --- | --- | --- | --- |
| Version | 0.15.2, Release build, Kahuna 1.12.3 | 3.42.0, through Python 3.11 | 16.11, Homebrew build |
| Deployment | embedded single node inside the test process | in-process library | a local server on localhost, one connection |
| Data | scale 0.003, about 225,000 rows, the JOB foreign-key indexes, `ANALYZE` | the same rows and indexes, `ANALYZE` | the same rows and indexes, `ANALYZE` |
| Settings | the harness settings: plan, result and row-id caches off, slow-query log on | `case_sensitive_like` on | `shared_buffers` 512 MB, `work_mem` 64 MB, the rest default |
| Time per query | the root time of `EXPLAIN (ANALYZE)`, best of two runs | best of three warm runs after a warm-up pass | the execution time of `EXPLAIN (ANALYZE)`, best of three warm runs after a warm-up pass; planning time kept apart |
| Machine | Apple M3, 8 GB, macOS 26.5 | the same | the same |

The CamusDB time includes the `EXPLAIN (ANALYZE)` counters. The two CamusDB
runs took 13.0 s and 17.6 s in total; the second ran with the probe page still
sized from the estimate and under memory pressure. For one query, the slower
run was 1.4 times the faster run at the median and 5.8 times at the maximum.
SQLite's cold runs took 7.6 s in total against 7.2 s warm.

| Measure | CamusDB | SQLite | PostgreSQL |
| --- | ---: | ---: | ---: |
| Total execution time, 113 queries | 12.8 s | 7.2 s | 0.74 s |
| Total planning time, 113 queries | 0.10 s | | 0.72 s |
| Median query | 19 ms | 0.4 ms | 0.7 ms |
| Geometric mean of the ratio CamusDB / engine | | 18x | 13x |
| Median ratio | | 20x | 13x |
| Queries where CamusDB is faster | | 6 | 5 |

| Ratio CamusDB / engine | Queries, SQLite | Queries, PostgreSQL |
| --- | ---: | ---: |
| CamusDB faster | 6 | 5 |
| 1x to 3x | 5 | 11 |
| 3x to 10x | 20 | 35 |
| 10x to 30x | 43 | 29 |
| 30x to 100x | 26 | 22 |
| 100x to 1,000x | 13 | 11 |
| over 1,000x | 0 | 0 |

PostgreSQL executes the corpus in 0.74 s and spends 0.72 s to plan it, 2 ms at
the median query and 23 to 30 ms on each of the 14- and 17-table queries,
where it uses its genetic optimizer. CamusDB plans the same joins in 0.1 s in
all, under 0.3 ms at the median and 8 ms at most. On the heaviest queries the
executor gap is the whole story: `16c` and `16d` take 35 ms in PostgreSQL and
1.7 s in CamusDB, `6d` 11 ms against 1.5 s, and `15d` 130 ms against 1.1 s.
PostgreSQL is faster than SQLite on 40 queries and 1.4x faster at the
geometric mean; the two agree on where the hard queries are.

The first measurement, on the release before these changes, took 45.6 s with
a geometric mean ratio of 80x. The probe of a non-unique index asked the store for a
512-entry page on every outer row, and the store materialized the whole page.
The probe bound and the end key brought the time per unit of work down by half,
to 29 s. The allocation diet cut the allocation of a run from 22.7 GB to
15.9 GB. The join-order search over reachable subsets then planned the nine
widest queries, which the heuristic had ordered badly, and took the total from
28 s to 13 s.

### The nine widest queries, before and after the search planned them

Until this change the cost-based search covered joins of at most 12 tables, and
the nine JOB queries with 14 or 17 tables took the heuristic order, which scores
tables by their filters and not by their row estimates. They held 44% of the
CamusDB time. The search now visits only the table subsets an order can reach,
so it plans these joins in 1 to 8 ms each, and the plans start from the small
filtered tables as SQLite's do.

| Query | Tables | Work before | Work now | Time before | Time now | SQLite |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `28a` | 14 | 89,238 | 92,890 | 195 ms | 82 ms | 21.6 ms |
| `28b` | 14 | 63,678 | 1,298 | 75 ms | 2 ms | 0.3 ms |
| `28c` | 14 | 66,234 | 1,232 | 81 ms | 1 ms | 0.2 ms |
| `29a` | 17 | 416,161 | 1,062 | 2,777 ms | 1 ms | < 0.1 ms |
| `29b` | 17 | 412,441 | 1,060 | 3,141 ms | 1 ms | < 0.1 ms |
| `29c` | 17 | 619,613 | 226,874 | 3,885 ms | 163 ms | 22.3 ms |
| `33a` | 14 | 67,818 | 106 | 99 ms | < 1 ms | < 0.1 ms |
| `33b` | 14 | 68,250 | 100 | 46 ms | < 1 ms | < 0.1 ms |
| `33c` | 14 | 79,198 | 110 | 97 ms | < 1 ms | < 0.1 ms |

Query `29b` shows the difference. SQLite starts from the two 4-row
`comp_cast_type` tables and the 405-row `complete_cast` table, probes `title`
by primary key with the title and year filters, and the join is empty after a
few steps. The heuristic started from `aka_name` and `cast_info` through the
person index and read 412,441 rows and entries for the same empty result. The
search now finds the same start as SQLite.

CamusDB is faster on six queries: `15c`, `15d`, `17c`, `17d`, `17f` and `30a`.
On `15c` and `15d` SQLite starts from `aka_title` and expands through
`movie_companies`, `movie_keyword` and `movie_info` before it applies the
selective `LIKE` filter on `movie_info`, and takes 2.9 s and 2.8 s; CamusDB
applies that filter first and takes 49 ms and 1.1 s.

### Where the rest of the gap comes from

CamusDB spends about 2 µs for each row read or index entry scanned at the
median query, at every query size. The ratio to SQLite is therefore similar for
small and large queries:

| Work of the query | Queries | Median CamusDB | Median SQLite | Median ratio |
| --- | ---: | ---: | ---: | ---: |
| under 1,000 | 13 | 0.6 ms | < 0.1 ms | 18x |
| 1,000 to 10,000 | 55 | 6 ms | 0.2 ms | 22x |
| 10,000 to 100,000 | 34 | 74 ms | 3.5 ms | 20x |
| over 100,000 | 11 | 256 ms | 31.7 ms | 8x |

The comparison cannot split that gap between plan choice and the cost of each
row, because SQLite reports no counter equivalent to work. The flat cost per
unit of work shows that the gap is not a fixed cost per query. The CamusDB
rows go through an embedded transactional key-value store with MVCC, and
through the plan-node counters of `EXPLAIN (ANALYZE)`; SQLite reads B-tree pages
in process. The measured remainder is about 36 µs of fixed cost for each index
probe and about 2 µs for each entry returned; the per-probe cost is the next
item on both sides of the storage boundary.

The estimates of the cost-based path are within a factor of 3 of the actual
rows at the median plan node. 23 of the 113 queries have one plan node with a
q-error above 100, and 8 have one above 1,000.

<details>
<summary>All 113 queries</summary>

Best of two CamusDB runs against the best of three warm runs of SQLite and of
PostgreSQL (execution time). Work is the sum of rows read, key-value lookups
and scan entries over the CamusDB plan.

| Query | CamusDB ms | SQLite ms | PostgreSQL ms | vs SQLite | vs PostgreSQL | Work |
|---|---:|---:|---:|---:|---:|---:|
| `1a` | 100.2 | 0.3 | 0.5 | 286x | 197.9x | 8,154 |
| `1b` | 47.3 | 0.1 | 0.4 | 473x | 118.6x | 12,662 |
| `1c` | 9.6 | 0.1 | 0.4 | 87x | 21.9x | 7,200 |
| `1d` | 66.1 | 0.2 | 0.5 | 330x | 131.9x | 17,702 |
| `2a` | 47.9 | 1.0 | 0.5 | 47x | 93.2x | 10,270 |
| `2b` | 61.2 | 1.5 | 0.5 | 40x | 125.4x | 14,402 |
| `2c` | 63.1 | 1.8 | 0.5 | 36x | 119.5x | 17,910 |
| `2d` | 58.7 | 1.3 | 0.5 | 45x | 120.9x | 13,356 |
| `3a` | 27.4 | 0.7 | 1.0 | 40x | 28.7x | 5,146 |
| `3b` | 6.1 | 0.4 | 0.7 | 14x | 8.6x | 3,876 |
| `3c` | 47.5 | 2.3 | 1.7 | 20x | 27.6x | 16,426 |
| `4a` | 5.7 | 0.1 | 0.4 | 44x | 14.6x | 1,802 |
| `4b` | 1.6 | < 0.1 | 0.2 | 20x | 6.8x | 1,198 |
| `4c` | 16.1 | 0.4 | 0.7 | 37x | 23.4x | 5,796 |
| `5a` | 6.8 | 0.4 | 0.3 | 16x | 22.4x | 7,228 |
| `5b` | 6.0 | 0.4 | 0.3 | 15x | 20.2x | 7,002 |
| `5c` | 19.5 | 1.0 | 1.0 | 19x | 20.4x | 10,838 |
| `6a` | 34.7 | 0.6 | 1.0 | 55x | 35.3x | 3,544 |
| `6b` | 152.7 | 1.2 | 3.0 | 124x | 50.4x | 26,196 |
| `6c` | 2.4 | 0.3 | 0.5 | 9x | 5.3x | 1,996 |
| `6d` | 1511.2 | 31.2 | 11.4 | 48x | 132.0x | 191,726 |
| `6e` | 49.0 | 3.4 | 4.3 | 15x | 11.3x | 21,432 |
| `6f` | 385.0 | 31.7 | 16.5 | 12x | 23.3x | 145,618 |
| `7a` | 12.3 | < 0.1 | 0.5 | 137x | 26.2x | 606 |
| `7b` | 1.0 | < 0.1 | 0.2 | 48x | 5.8x | 188 |
| `7c` | 27.5 | 1.0 | 0.6 | 28x | 45.3x | 1,976 |
| `8a` | 97.3 | 1.4 | 1.7 | 68x | 57.0x | 12,824 |
| `8b` | 8.3 | 0.3 | 0.5 | 24x | 16.1x | 4,824 |
| `8c` | 437.1 | 23.1 | 10.2 | 19x | 43.0x | 55,212 |
| `8d` | 294.9 | 20.9 | 9.5 | 14x | 30.9x | 30,898 |
| `9a` | 9.6 | 1.5 | 1.0 | 6x | 9.8x | 3,518 |
| `9b` | 4.0 | 1.0 | 0.5 | 4x | 7.5x | 2,968 |
| `9c` | 399.5 | 1.4 | 1.9 | 285x | 215.7x | 40,570 |
| `9d` | 89.6 | 9.2 | 7.9 | 10x | 11.3x | 44,132 |
| `10a` | 542.0 | 3.8 | 2.6 | 143x | 207.1x | 33,844 |
| `10b` | 56.7 | 2.0 | 2.1 | 29x | 27.3x | 36,748 |
| `10c` | 342.7 | 13.1 | 6.6 | 26x | 51.8x | 60,380 |
| `11a` | 1.3 | < 0.1 | 0.1 | 26x | 10.7x | 200 |
| `11b` | 0.1 | < 0.1 | 0.1 | 5x | 1.3x | 84 |
| `11c` | 19.1 | 0.4 | 0.9 | 50x | 22.1x | 5,136 |
| `11d` | 83.0 | 3.3 | 1.7 | 25x | 49.8x | 75,012 |
| `12a` | 13.9 | 0.1 | 0.4 | 116x | 36.6x | 1,434 |
| `12b` | 6.3 | 0.1 | 0.3 | 52x | 18.3x | 1,532 |
| `12c` | 37.4 | 3.1 | 2.6 | 12x | 14.1x | 30,126 |
| `13a` | 14.7 | 0.2 | 0.8 | 61x | 18.7x | 3,094 |
| `13b` | 1.6 | 0.1 | 0.4 | 12x | 4.2x | 1,524 |
| `13c` | 1.4 | 0.1 | 0.4 | 12x | 3.7x | 1,524 |
| `13d` | 8.5 | 0.2 | 0.7 | 42x | 12.5x | 2,674 |
| `14a` | 1.5 | 0.1 | 0.3 | 14x | 5.8x | 1,234 |
| `14b` | 0.8 | < 0.1 | 0.3 | 11x | 3.1x | 1,232 |
| `14c` | 3.2 | 0.1 | 0.4 | 23x | 8.7x | 1,480 |
| `15a` | 4.6 | 0.5 | 0.5 | 9x | 8.8x | 2,944 |
| `15b` | 0.4 | 0.2 | < 0.1 | 2x | 4.1x | 1,432 |
| `15c` | 48.6 | 2944.6 | 0.6 | 0x | 82.4x | 6,692 |
| `15d` | 1118.5 | 2819.7 | 129.8 | 0x | 8.6x | 1,001,340 |
| `16a` | 68.4 | 1.1 | 1.3 | 59x | 53.3x | 7,544 |
| `16b` | 256.0 | 39.2 | 17.4 | 7x | 14.7x | 145,856 |
| `16c` | 1691.2 | 34.6 | 35.5 | 49x | 47.7x | 155,432 |
| `16d` | 1706.9 | 34.5 | 35.3 | 49x | 48.4x | 155,400 |
| `17a` | 251.3 | 29.8 | 35.2 | 8x | 7.1x | 212,536 |
| `17b` | 244.7 | 223.7 | 8.5 | 1x | 28.9x | 94,428 |
| `17c` | 116.4 | 229.0 | 8.5 | 1x | 13.7x | 93,636 |
| `17d` | 55.6 | 234.9 | 5.7 | 0x | 9.8x | 68,474 |
| `17e` | 245.3 | 29.5 | 33.9 | 8x | 7.2x | 212,536 |
| `17f` | 166.1 | 233.8 | 16.1 | 1x | 10.3x | 163,682 |
| `18a` | 250.2 | 5.6 | 18.1 | 44x | 13.8x | 25,596 |
| `18b` | 13.6 | 0.2 | 0.6 | 72x | 22.8x | 1,542 |
| `18c` | 99.4 | 5.7 | 3.6 | 17x | 27.8x | 34,290 |
| `19a` | 13.4 | 0.7 | 0.9 | 20x | 15.2x | 3,118 |
| `19b` | 3.7 | 0.2 | 0.5 | 22x | 6.8x | 2,944 |
| `19c` | 89.5 | 5.6 | 6.9 | 16x | 12.9x | 73,038 |
| `19d` | 169.9 | 11.1 | 90.6 | 15x | 1.9x | 152,994 |
| `20a` | 138.1 | 1.1 | 1.7 | 129x | 83.5x | 11,286 |
| `20b` | 49.2 | 0.4 | 1.1 | 123x | 43.6x | 7,744 |
| `20c` | 46.6 | 0.6 | 1.1 | 76x | 43.7x | 8,998 |
| `21a` | 1.0 | < 0.1 | 0.1 | 17x | 8.7x | 200 |
| `21b` | 0.3 | < 0.1 | 0.1 | 8x | 2.9x | 108 |
| `21c` | 0.6 | < 0.1 | 0.1 | 10x | 5.1x | 208 |
| `22a` | 2.7 | < 0.1 | 0.3 | 39x | 9.1x | 1,184 |
| `22b` | 1.1 | < 0.1 | 0.3 | 15x | 3.9x | 1,158 |
| `22c` | 1.3 | < 0.1 | 0.3 | 19x | 4.2x | 1,258 |
| `22d` | 2.0 | 0.2 | 0.4 | 9x | 4.6x | 1,480 |
| `23a` | 43.4 | 0.2 | 0.6 | 228x | 73.2x | 6,172 |
| `23b` | 42.1 | 0.1 | 0.6 | 383x | 70.5x | 6,172 |
| `23c` | 119.9 | 1.8 | 0.7 | 65x | 160.0x | 11,462 |
| `24a` | 9.8 | 3.2 | 1.4 | 3x | 7.1x | 8,420 |
| `24b` | 0.7 | < 0.1 | 0.2 | 19x | 4.7x | 1,500 |
| `25a` | 21.3 | 17.5 | 23.9 | 1x | 0.9x | 12,022 |
| `25b` | 1.9 | < 0.1 | 0.3 | 24x | 5.7x | 1,498 |
| `25c` | 33.8 | 20.5 | 19.7 | 2x | 1.7x | 35,094 |
| `26a` | 4.7 | 0.2 | 1.9 | 21x | 2.4x | 2,992 |
| `26b` | 1.4 | < 0.1 | 0.3 | 20x | 4.1x | 1,232 |
| `26c` | 45.7 | 0.2 | 0.9 | 208x | 51.8x | 7,576 |
| `27a` | 0.8 | < 0.1 | 0.1 | 20x | 7.6x | 186 |
| `27b` | 0.2 | < 0.1 | < 0.1 | 6x | 1.8x | 100 |
| `27c` | 0.9 | 0.2 | < 0.1 | 4x | 8.8x | 192 |
| `28a` | 82.3 | 21.6 | 11.4 | 4x | 7.2x | 92,890 |
| `28b` | 2.1 | 0.3 | 59.6 | 8x | 0.0x | 1,298 |
| `28c` | 1.3 | 0.2 | 0.3 | 6x | 4.2x | 1,232 |
| `29a` | 1.2 | < 0.1 | 0.4 | 30x | 3.2x | 1,062 |
| `29b` | 0.6 | < 0.1 | 8.1 | 16x | 0.1x | 1,060 |
| `29c` | 163.1 | 22.2 | 3.6 | 7x | 45.5x | 226,874 |
| `30a` | 17.4 | 45.1 | 13.1 | 0x | 1.3x | 23,794 |
| `30b` | 1.0 | < 0.1 | 1.9 | 13x | 0.5x | 1,274 |
| `30c` | 16.6 | 15.2 | 4.9 | 1x | 3.4x | 19,616 |
| `31a` | 21.2 | 3.5 | 8.8 | 6x | 2.4x | 13,548 |
| `31b` | 2.6 | < 0.1 | 0.4 | 29x | 6.4x | 1,600 |
| `31c` | 19.3 | 4.8 | 19.9 | 4x | 1.0x | 8,594 |
| `32a` | 25.4 | 0.4 | 0.2 | 69x | 108.7x | 4,554 |
| `32b` | 9.7 | 0.3 | 0.2 | 28x | 44.6x | 4,554 |
| `33a` | 0.3 | < 0.1 | 0.2 | 30x | 2.0x | 106 |
| `33b` | 0.2 | < 0.1 | 0.1 | 18x | 1.2x | 100 |
| `33c` | 0.2 | < 0.1 | 0.2 | 24x | 1.5x | 110 |

</details>

## Run it locally

Run the same small tier used on pull requests:

```bash
dotnet test CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter TestCategory=PlanQuality
```

The default report is written below
`CamusDB.PlanQuality.Tests/bin/Debug/net10.0/plan-quality/`. Set
`PLAN_QUALITY_REPORT_DIR` to choose another location.

Run the larger retail tier:

```bash
PLAN_QUALITY_SCALE=4 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~SmallTierGate
```

Run the JOB tier after preparing its data:

```bash
scripts/plan-quality/job/prepare.sh /tmp/camusdb-job 0.003

JOB_DIR=/tmp/camusdb-job JOB_SCALE=0.003 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~JobTierGate
```

Use `PLAN_QUALITY_ONLY` with a comma-separated set of query ids while
investigating a subset. Partial runs never update a baseline.

## Read a report

The generated report contains:

- Gate failures and non-blocking notes.
- Work grouped by query tags.
- Before-and-after fingerprints for changed plans.
- Queries with the worst cardinality estimates.
- Planning and execution timings for diagnosis.

The JSON report preserves every counter for every plan node and is useful for
automated comparison or deeper analysis.

## Updating a baseline

When an intentional planner change moves plans, regenerate the corresponding
baseline:

```bash
PLAN_QUALITY_UPDATE_BASELINE=1 dotnet test \
  CamusDB.PlanQuality.Tests/CamusDB.PlanQuality.Tests.csproj \
  --filter FullyQualifiedName~SmallTierGate
```

Before writing a baseline, the harness runs each query against a reference
configuration with cost-based access-path and join-order search disabled. If a
result differs or a query fails, it writes nothing.

Commit the baseline change with the planner change and explain why each plan
moved. Baselines exist separately for small scales 1 and 4 and JOB scales
0.001 and 0.003.

## Repeatability and scope

The data generators are seeded, table loads occur in a fixed order, and the
harness disables automatic analyze, row-id, plan, and result caches, and TTL.
It runs `ANALYZE` explicitly and enables the slow-query log at a zero threshold
to obtain statement-level reads. A determinism test repeats counters across
fresh engines.

The harness currently runs on one node. It does not cover broadcast joins,
distributed gathers, or placement decisions. Wall time is reported but not
graded, and some reads performed while binding subqueries are not represented
by plan-node counters.
