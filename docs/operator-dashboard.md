---
sidebar_position: 3.69
---

import ThemedImage from '@theme/ThemedImage';
import useBaseUrl from '@docusaurus/useBaseUrl';

# Operator dashboard

Each CamusDB node serves a read-only operator dashboard on its HTTP port. Open
the port in a browser to see the health and the slow queries of the node. You
don't need to install other tools.

The dashboard doesn't run DML or DDL, and it can't change the database.

<ThemedImage
  alt="CamusDB operator dashboard"
  sources={{
    light: useBaseUrl('/img/screenshots/dashboard-light.webp'),
    dark: useBaseUrl('/img/screenshots/dashboard-dark.webp'),
  }}
/>

## Enable or disable it

The dashboard is enabled by default.

```yaml
dashboard_enabled: true
dashboard_refresh_seconds: 2
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `dashboard_enabled` | `true` | Serve the dashboard pages and the `/v1/dashboard/*` endpoints. |
| `dashboard_refresh_seconds` | `2` | How often the browser refreshes the load panel, from 1 to 300 seconds. A value outside the range uses the nearest limit. |

With `dashboard_enabled: false`, the pages and the dashboard endpoints return
404.

## What it shows

| Panel | Content |
| --- | --- |
| Node | The endpoint / role / readiness / mode / version / uptime / data directory. |
| Load | In-flight requests / open transactions / the [partitions](/docs/concepts#partition) that the node hosts. |
| Engine | Request rates / commit duration / cache hit rates. Also counters for [Raft](/docs/concepts#raft) / the write-ahead log / storage. |
| Cluster | The committed list of cluster members. |
| Databases | The databases and their branch parents. It also shows if each database is loaded on this node. |
| Relations | The tables and views of the selected database. |
| Backups | Recent backups, with their kind and size. |
| Slow queries | Recent entries of the [slow query log](/docs/slow-query-log). |
| Configuration | The `SHOW VARIABLES` output of this node. |
| Overlay | The `SHOW CLUSTER SETTINGS` entries. |

Each panel refreshes separately. If one panel fails, the other panels continue
to work.

## Authentication

With authentication enabled, a browser at `/` is redirected to `/SignIn`. The
sign-in form gets a short-lived token for the password, and stores it in the
`__Host-camus_session` cookie.

The cookie has three attributes: `HttpOnly`, `SameSite=Strict`, and `Secure`. The `__Host-` prefix
requires `Path=/` and no `Domain`. This means that another host on the same
domain can't set a cookie that the dashboard reads.

Because the cookie is `Secure`, sign-in needs HTTPS or loopback. Browsers treat
loopback as secure, and local development works. Over a plaintext remote
connection, the browser doesn't keep the cookie, and sign-in fails.

The cookie authenticates the dashboard pages and `/v1/dashboard/*` only. SQL
and row APIs need an `Authorization: Bearer ...` header.

With authentication disabled, the dashboard works from loopback only. A request
from another address returns 403 with `CADB0517`. To use the dashboard from
another machine, enable [authentication](/docs/sql-authentication).

## Browser security headers

Dashboard pages and the error page include a content security policy. They also
send `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`. The content
security policy allows inline scripts only with a nonce for each request. The
JSON endpoints don't send the page policy.

## Permissions

All authenticated users can open the dashboard. However, four panels need a
superuser.

| Panel | Reason |
| --- | --- |
| Engine | It reads `SHOW ENGINE STATS`. |
| Configuration | It reads `SHOW VARIABLES` and `SHOW CLUSTER SETTINGS`. |
| Slow queries | The entries contain the SQL of other users. |
| Cluster | It shows the addresses of other nodes. |

For other users, these panels return 403 with `CADB0517`. The other panels use
the grants of the user. For example, the database list shows only the databases
that the user can reach.

## Slow queries panel

The slow queries panel reads the [slow query log](/docs/slow-query-log). For
each statement, it shows the duration and the text, and flags for full scans
and spills to disk. It also shows when old entries were overwritten.

`SHOW SLOW QUERIES` isn't recorded in the log. This means that the panel doesn't
add entries to it.

## Limits

- All values are node-local. To see all nodes, open the dashboard on each node.
- Counters start at process start. Rates appear after the second refresh.
- The dashboard doesn't store history or send alerts.
- If `engine_metrics_enabled` is `false`, the Engine panel shows that metrics are
  disabled. The same applies to the Slow queries panel and
  `slow_query_log_enabled`.

For alerts and history, use the Prometheus or OpenTelemetry export.
