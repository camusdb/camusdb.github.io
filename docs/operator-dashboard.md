---
sidebar_position: 3.69
---

# Operator dashboard

Open a CamusDB node's HTTP port in a browser to see a read-only operator
dashboard. It shows node health, load, engine metrics, databases, relations,
backups, slow queries, and the resolved configuration of that node.

The dashboard does not run DML or DDL. It opens no coordinated transaction and
offers no action that changes the database.

![CamusDB operator dashboard](/img/dashboard.png)

## Enable or disable it

The dashboard is enabled by default:

```yaml
dashboard_enabled: true
dashboard_refresh_seconds: 2
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `dashboard_enabled` | `true` | Serve the dashboard pages and `/v1/dashboard/*` endpoints. |
| `dashboard_refresh_seconds` | `2` | Browser refresh cadence for the load panel. Clamped from 1 to 300 seconds. |

Set `dashboard_enabled: false` to remove the surface entirely. The pages and
dashboard endpoints then return 404.

## What it shows

| Area | Content |
| --- | --- |
| Node | Endpoint, role, readiness, mode, auth state, version, uptime, and data directory. |
| Load | In-flight requests, open transactions, prepared statements, retained bytes, and hosted partitions. |
| Engine | Request and statement rates, commit duration, cache hit rates, Raft, WAL, and storage counters. |
| Cluster | Committed membership roster. |
| Databases | Database ids, branch parents, and whether this node currently has each database loaded. |
| Relations | Tables and views for the selected database. |
| Backups | Recent backups with kind and size. |
| Slow queries | Recent entries from `SHOW SLOW QUERIES`. |
| Configuration | Effective `SHOW VARIABLES` output for this node. |
| Overlay | Live `SHOW CLUSTER SETTINGS` entries. |

Each panel refreshes independently and fails independently. One failing panel
does not stop the rest of the page.

## Authentication

With authentication enabled, a browser at `/` redirects to `/SignIn`. The form
exchanges the password for a short-lived token and stores it in an HTTP-only
`camus_session` cookie for dashboard routes.

The cookie authenticates dashboard pages and `/v1/dashboard/*` only. SQL and row
APIs still require an `Authorization: Bearer ...` header.

With authentication disabled, the dashboard is loopback-only because there is no
principal to check. Enable authentication to expose it from another machine.

## Permissions

Non-superusers can open the dashboard, but three panels require a superuser:

- Engine, because it runs `SHOW ENGINE STATS`.
- Configuration, because it runs `SHOW VARIABLES` and `SHOW CLUSTER SETTINGS`.
- Slow queries, because entries include SQL text submitted by other users.

Other panels use the caller's ordinary grants. The database list is filtered to
databases that the user may reach.

## Slow queries panel

The slow queries panel reads [the slow query log](/docs/slow-query-log). It
shows duration, rows read, rows returned, full-scan flags, spill flags, outcome,
and statement text. It also indicates when the ring has wrapped and older
entries were overwritten.

Polling the panel does not pollute the log. `SHOW SLOW QUERIES` is never
recorded as a slow query.

## Limits

- Every value is node-local. Open the dashboard on each node for a fleet view.
- Counters accumulate from process start. Rates appear after the second refresh.
- The dashboard stores no history and raises no alerts.
- If `engine_metrics_enabled` is false, the Engine panel reports that metrics
  are disabled.
- If `slow_query_log_enabled` is false, the Slow queries panel reports that the
  log is disabled.

For alerting, history, and cluster-wide aggregation, use the Prometheus or
OpenTelemetry diagnostics export.
