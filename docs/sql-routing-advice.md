---
sidebar_position: 3.8
---

# SQL routing advice

CamusDB can attach advisory routing metadata to successful SQL responses. A
multi-endpoint client can learn which cluster node leads the data behind a
repeated statement and send later executions directly there. This removes a
forwarding hop. It does not change the result, isolation, authorization, commit
handling, or retry rules.

Routing advice is opt-in per request. A client that does not ask for it receives
the historical response shape.

## When advice appears

The server emits advice only when all of these are true:

- `sql_routing_advice_enabled` is `true`, which is the default.
- The request negotiates routing metadata.
- The statement is eligible.
- The node knows the relevant leader.

For gRPC, set `SqlRequest.routing_accept_version = 1`. For REST, set
`routingAcceptVersion: 1` on `/execute-sql-query` or
`/execute-sql-non-query`.

## Eligible statements

CamusDB advertises a preferred node only when the statement has a single,
ordinary hash-routed table as its data footprint. Simple `SELECT`, `INSERT`,
`UPDATE`, and `DELETE` statements over one table are the main case. Empty point
lookups and zero-row writes can still be eligible because the route is a
property of the table, not of returned rows.

The server clears or omits advice for statements whose destination is not a
single reusable table route. That includes joins, subqueries, derived tables,
views, time-travel reads, branch databases, materialized views, cache-hinted
queries, DDL, `SHOW` statements, and deployments where key-range sharding makes
the destination depend on a key range.

Eligibility is based on the bound statement after name resolution. CamusDB does
not infer it from a text pattern in the SQL string.

## Metadata

A `prefer` advice names an opaque `preferredNodeId`, a maximum reuse age, and a
dependency token. The node id is not a network address. A client must resolve it
through its own operator-provided map, and must ignore it when no mapping
exists. The dependency token is an opaque change detector, not a sortable value
and not an authority for routing by itself.

A `clear` advice tells a client to forget any route it learned for that
statement context. Current reason values are `singleTableHash`, `ineligible`,
`placementUnknown`, and `cacheAffinity`.

Advice is best-effort. If advice construction fails after a statement succeeds,
the statement result still succeeds and the metadata is simply absent.

## Transactions

Advice can appear on autocommit statements and on statements inside an explicit
transaction. It never moves a live transaction. A transaction remains pinned to
the endpoint and stream where it started, and advice learned inside it is useful
only for a later transaction or autocommit statement.

The .NET driver and TypeScript connector can defer `BEGIN` until the first
statement when learned routing is enabled, so the transaction starts where the
first statement is expected to run. See
[.NET Driver](/docs/dotnet-driver#learned-routing) and
[TypeScript](/docs/typescript-connector#transport-and-routing).

## Configuration

```yaml
sql_routing_advice_enabled: true
sql_routing_advice_ttl_ms: 5000
```

`sql_routing_advice_enabled` is a node restart setting and a kill switch for
metadata emission. `sql_routing_advice_ttl_ms` is the maximum advertised reuse
age in milliseconds. The valid range is `1` through `600000`.
