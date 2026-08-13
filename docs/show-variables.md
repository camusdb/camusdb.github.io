---
sidebar_position: 2.65
---

# SHOW VARIABLES

`SHOW VARIABLES` reports the effective configuration values used by the CamusDB
node that served the statement.

```camussql
SHOW VARIABLES;
SHOW VARIABLES LIKE "%cache%";
SHOW VARIABLES LIKE "ttl_%";
```

The result includes configuration keys, resolved values, types, defaults, and
the layer that supplied each value:

```camussql
variable                         value     type    default   source
ttl_default_delete_batch_size    100       int     100       default
ttl_default_job_cron             @daily    string  @daily    default
ttl_enabled                      false     bool    true      config
ttl_span_lease_ms                30000     int     30000     default
```

## Result Columns

| Column | Meaning |
| --- | --- |
| `variable` | The `snake_case` key used in `config.yml`. Nested `kahuna` settings use dotted names such as `kahuna.wal_sync_writes`. |
| `value` | The effective value. SQL `NULL` means the value is genuinely unset. |
| `type` | The value type: `bool`, `int`, `long`, `double`, `string`, `enum`, `duration_ms`, or `list`. |
| `default` | The built-in value used when no higher-precedence layer overrides it. |
| `source` | The winning configuration layer: `default`, `config`, `env`, or `cli`. |

Rows are sorted by variable name, which makes output from different nodes easy
to compare.

## Effective Values

`SHOW VARIABLES` reads the configuration object the engine is running with. It
does not re-read `config.yml` from disk.

That means the output reflects the real precedence chain:

1. command-line flags
2. environment variables
3. the selected YAML file
4. built-in defaults

A key commented out in YAML shows its default. A key overridden by an
environment variable or CLI flag shows the override.

See [Configuration](/docs/configuration) for the full startup and precedence
model.

## Filtering With LIKE

The optional `LIKE` pattern matches variable names:

```camussql
SHOW VARIABLES LIKE "query_result_cache_%";
SHOW VARIABLES LIKE "kahuna.%";
```

`%` matches any run of characters and `_` matches one character. Matching is
case-sensitive because configuration variable names are lowercase. A pattern
that matches nothing returns an empty result set.

## Secrets

Secret values are masked. Authentication keys and passwords are shown as
`********` when set and empty when unset. Path-like settings such as certificate
file paths are displayed because they are needed for operational debugging.

## Node-Local Output

`SHOW VARIABLES` describes only the node that handled the statement. In a
cluster, nodes can legitimately differ in local paths, ports, certificates, or
temporary rollout state. Run the statement against each node when you need to
compare a cluster.

This is the configuration counterpart to
[SHOW ENGINE STATS](/docs/engine-stats), which also reports node-local state.

## Scope

`SHOW VARIABLES` focuses on engine/runtime settings exposed through the
configuration catalog. Some deployment and topology settings, such as the run
mode, node identity, listener ports, peer lists, and diagnostics exporter
settings, may need to be checked from the startup configuration or process
logs.

## Permissions

When authentication is enabled, `SHOW VARIABLES` requires a superuser. A
non-superuser receives `CADB0517` `InsufficientPrivilege`.

When authentication is disabled, any caller may run it.

## Runtime Changes

`SHOW VARIABLES` is read-only. CamusDB does not provide `SET GLOBAL` or session
configuration variables. To change a setting, update the deployment
configuration and restart the node.
