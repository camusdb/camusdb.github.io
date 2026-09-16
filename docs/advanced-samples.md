---
sidebar_position: 1.7
---

# Advanced samples

These samples show CamusDB inside complete applications. Use them after the
basic tutorial, when you want to see several CamusDB features working together
through an application stack.

## CamusBank

[CamusBank](https://github.com/camusdb/camusdb-bank) is a mini banking demo
built with .NET, `CamusDB.Client`, ASP.NET Core, and a MudBlazor Blazor Server
frontend. It uses CamusDB as the transactional store for customers, accounts,
transfers, and ledger entries.

![CamusBank dashboard](/img/camusdb-bank.png)

In the sample, you can find:

- Schema initialization for a banking domain, including unique indexes for
  account numbers and transfer idempotency keys.
- Transactional deposit, withdrawal, and transfer workflows that keep account
  balances and ledger entries consistent.
- Retry and idempotency examples for concurrent transfer requests.
- Demo flows for transaction rollback, concurrent money movement, database
  branching, time-travel reads, and recoverable drops.
- An ASP.NET Core Web API, a Blazor Server UI, and integration tests that run
  against a local CamusDB instance.

The app starts a `camusbank` database, applies its schema, and seeds demo
customers with accounts and transaction history on first API startup. See the
sample README for the current prerequisites and run commands.

## CamusBooking

[CamusBooking](https://github.com/camusdb/camusdb-booking) is a flight-booking
demo built with Next.js, React, and the `camusdb` TypeScript connector. It uses
CamusDB as the transactional store for passengers, flights, bookings, and
booking events.

![CamusBooking flight search](/img/camusdb-booking.png)

In the sample, you can find:

- Schema initialization for passenger, flight, booking, booking-event, and app
  metadata tables, including unique indexes for flight numbers, PNRs, and
  idempotency keys.
- A booking workflow that decrements seat inventory, creates a booking, and
  records a `reserved` event inside one transaction.
- Retry and idempotency examples that reuse the same idempotency key and still
  produce one PNR.
- A last-seat race lab that sends concurrent booking attempts against a flight
  with limited inventory.
- Failure-injection flows that abort after a seat hold or before commit, then
  show that inventory and events roll back.
- Demo flows for copy-on-write branches, `AS OF SYSTEM TIME` reads, `EXPLAIN`,
  dropped-table recovery with `RELINK`, and orphan-table inspection.

The app starts a `camusbooking` database, applies its schema, and seeds demo
passengers plus fake flights on first startup. See the sample README for the
current prerequisites and run commands.
