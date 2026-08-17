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
variable                         value   type    default  source   mutability  scope
ttl_default_delete_batch_size    100     int     100      default  runtime     cluster
ttl_default_job_cron             @daily  string  @daily   default  runtime     cluster
ttl_enabled                      false   bool    true     config   runtime     cluster
ttl_span_lease_ms                30000   int     30000    default  runtime     cluster
```

## Result Columns

| Column | Meaning |
| --- | --- |
| `variable` | The `snake_case` key used in `config.yml`. Nested `kahuna` settings use dotted names such as `kahuna.wal_sync_writes`. |
| `value` | The effective value. SQL `NULL` means the value is genuinely unset. |
| `type` | The value type: `bool`, `int`, `long`, `double`, `string`, `enum`, `duration_ms`, or `list`. |
| `default` | The built-in value used when no higher-precedence layer overrides it. |
| `source` | The winning configuration layer: `default`, `config`, `env`, `cli`, or `cluster`. |
| `mutability` | `runtime` if the setting can be changed on a live node, `restart` if the value is baked in at boot. |
| `scope` | `cluster` if the fleet must agree on the value, `node` if it is per-node by design. |

`mutability` and `scope` make this the authoritative answer to "can I change this
now, and will it affect other nodes?", so there is no separate list to consult. See
[Runtime Cluster Settings](/docs/runtime-cluster-settings).

Rows are sorted by variable name, which makes output from different nodes easy
to compare.

## Effective Values

`SHOW VARIABLES` reads the configuration object the engine is running with. It
does not re-read `config.yml` from disk.

That means the output reflects the real precedence chain:

1. the replicated cluster overlay
2. command-line flags
3. environment variables
4. the selected YAML file
5. built-in defaults

A key commented out in YAML shows its default. A key overridden by an
environment variable or CLI flag shows the override. A key a
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings) put in force shows that
value with `source` = `cluster`, even on a node whose own YAML names the key,
which is what explains a node that appears to contradict its configuration file.

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

`SHOW VARIABLES` is itself read-only. To change a setting whose `mutability` is
`runtime`, use
[`SET CLUSTER SETTING`](/docs/runtime-cluster-settings#changing-a-setting). The
change takes effect without a restart and reaches every node. A setting whose
`mutability` is `restart` still requires editing the deployment configuration and
restarting the node.

There are no session-scoped configuration variables; a change is either a cluster
setting or a restart.
