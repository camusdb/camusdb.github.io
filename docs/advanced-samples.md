---
sidebar_position: 1.7
---

# Advanced samples

These samples show several CamusDB features working together in complete
applications. Try them after the basic tutorial.

## CamusShop

[CamusShop](https://github.com/camusdb/camusdb-ecommerce) is a robot store
built with .NET 10, ASP.NET Core, Blazor, and the
[CamusDB EF Core provider](/docs/ef-core). It keeps checkout, inventory,
payments, and fulfillment correct under races, failures, and retries.

![CamusShop robot storefront](/img/robots.png)

Features:

- EF Core mappings for OID keys, `NUMERIC` money, string enums, and arrays.
- Migrations with checks, foreign keys, unique indexes, and a sequence.
- Serializable retries that rerun the unit of work with a clean change tracker.
- Stock reservation by read-check-write or by conditional `UPDATE`.
- Atomic checkout: stock, order, items, timeline, outbox, and cart in one
  transaction.
- Idempotent checkout and payment APIs.
- Order state machine with optimistic concurrency.
- Transactional outbox for payment, warehouse, refund, and notification work.
- Concurrency lab and tests for flash sales, duplicate requests, injected
  failures, and stale versions.

On startup, the API creates the `camusshop` database, applies migrations, and
seeds demo data. See the README for prerequisites, test cards, and run
commands.

## CamusBank

[CamusBank](https://github.com/camusdb/camusdb-bank) is a mini bank built with
.NET, `CamusDB.Client`, ASP.NET Core, and MudBlazor. CamusDB stores customers,
accounts, transfers, and ledger entries.

![CamusBank dashboard](/img/camusdb-bank.png)

Features:

- Unique indexes for account numbers and transfer idempotency keys.
- Transactional deposits, withdrawals, and transfers that keep balances and
  ledger entries consistent.
- Retries and idempotency for concurrent transfers.
- Demos of rollback, database branching, time-travel reads, and recoverable
  drops.
- Integration tests against a local CamusDB instance.

On first startup, the API creates the `camusbank` database, applies its schema,
and seeds demo data. See the README for prerequisites and run commands.

## CamusBooking

[CamusBooking](https://github.com/camusdb/camusdb-booking) is a flight-booking
app built with Next.js, React, and the `camusdb` TypeScript connector. CamusDB
stores passengers, flights, bookings, and booking events.

![CamusBooking flight search](/img/camusdb-booking.png)

Features:

- Unique indexes for flight numbers, PNRs, and idempotency keys.
- One transaction that decrements seats, creates the booking, and records a
  `reserved` event.
- Idempotent retries that always produce one PNR.
- Last-seat race lab with concurrent booking attempts.
- Failure injection that shows seats and events roll back.
- Demos of branches, `AS OF SYSTEM TIME`, `EXPLAIN`, table recovery with
  `RELINK`, and orphan-table inspection.

On first startup, the app creates the `camusbooking` database, applies its
schema, and seeds demo data. See the README for prerequisites and run commands.
