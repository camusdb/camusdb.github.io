---
sidebar_position: 2.65
---

# SHOW VARIABLES

`SHOW VARIABLES` shows the configuration that a running CamusDB node uses, from
a SQL prompt.

The configuration of a node comes from several layers, for example `config.yml`
and [runtime cluster settings](/docs/runtime-cluster-settings). This means that
the text of `config.yml` doesn't always show what the node uses. You can use
`SHOW VARIABLES` to:

- Confirm that a change took effect after you edit `config.yml` and restart, or
  after you run `SET CLUSTER SETTING`.
- Find the layer that set an unexpected value.
- Compare nodes when one node behaves differently from the others.
- Collect the configuration of a node for a bug report.

For the meaning and the valid values of each variable, see the
[settings reference](/docs/settings-reference).

```camussql
SHOW VARIABLES;
SHOW VARIABLES LIKE '%cache%';
SHOW VARIABLES LIKE 'ttl_%';
```

The output of the last statement looks like this (shortened):

```text
variable                          value   type   default  source   mutability  scope
────────────────────────────────  ──────  ─────  ───────  ───────  ──────────  ───────
ttl_default_delete_batch_size     100     int    100      default  runtime     cluster
ttl_default_job_cron              @daily  string @daily   default  runtime     cluster
ttl_enabled                       false   bool   true     config   runtime     cluster
ttl_span_lease_ms                 30000   int    30000    default  runtime     cluster
```

## Effective values

The rows show the values that the node uses after all layers are merged.
`SHOW VARIABLES` doesn't read `config.yml` again. If an environment variable or
a command-line flag overrides a key, the row shows the override. A key that you
commented out in `config.yml` shows its built-in default.

## Columns

| Column | Meaning |
| --- | --- |
| `variable` | The key in `snake_case`, as you write it in `config.yml`. The keys of the `kahuna:` section, which configures the embedded [Kahuna](/docs/concepts#kahuna) storage layer, use dotted names, such as `kahuna.wal_sync_writes`. |
| `value` | The effective value. It's SQL `NULL` when the setting isn't set, which isn't the same as an empty string. An unset `kahuna.*` key shows `NULL` in `value` and `default`. The node then uses the default in the [Kahuna keys reference](/docs/settings-reference#kahuna-keys). |
| `type` | `bool`, `int`, `long`, `double`, `string`, `enum`, `duration_ms`, or `list`. |
| `default` | The built-in value. A value that differs from `default` was configured. |
| `source` | The layer that supplied the value: `default`, `config`, `env`, `cli`, or `cluster`. The highest layer is `cluster`, then `cli`, `env`, `config`, and `default`. |
| `mutability` | `runtime`: a new value applies immediately. `restart`: the node reads the value when it starts. |
| `scope` | `cluster`: all nodes must have the same value, because a difference would change transaction behavior. `node`: nodes can have different values, for example for local cache sizes. |

Each value uses the same format as in `config.yml`. You can copy a value from
the output into the file. Booleans are lowercase, and numbers have no
separators or units. For example, 64 MiB is `67108864`. Enum
values use underscores, such as `read_committed`. Durations are in milliseconds.

The rows are sorted by name with an ordinal comparison. This means that you can
compare the output of two nodes line by line.

When `key_range_sharding` isn't set on the node, the routing mode that the
cluster recorded at creation shows with source `cluster`. You can't change this
value at runtime. For more information, see
[key-range routing mode](/docs/key-range-sharding#the-mode-is-fixed-when-the-cluster-is-created).

## LIKE patterns

The optional pattern matches the variable name. It uses the same
[wildcards and escapes](/docs/sql-expression-syntax#like-and-ilike-patterns) as
a query. `%` matches any characters, and `_` matches exactly one character. To
match a literal underscore, escape it: `SHOW VARIABLES LIKE 'ttl\_%'`.

The match is case-sensitive, as in `SHOW TABLES` and `SHOW ENGINE STATS`. All
variable names are lowercase. This means that `LIKE 'TTL_%'` matches no rows.

A pattern that matches no variable returns no rows. The pattern can be any
string literal, including an `E'...'` string.

## Secrets and keys that aren't listed

Secrets are masked. The output lists `bootstrap_superuser_password`,
`access_token_server_key`, and `node_secret`, because you might need to know
whether a secret is set. A set secret shows `********`, and an unset secret
shows an empty value.

`kahuna.backup_mac_key_file` contains a file path, and its value is shown in
full.

The following keys aren't listed yet:

- Deployment and topology keys, such as `mode` and the ports.
- The certificate paths, such as `https_certificate`.
- The `diagnostics:` section.

To find the port of a node, read the configuration file or the startup banner.

Computed values, such as the effective spill threshold, aren't listed either.
The settings that produce them are listed.

## Node-local output

`SHOW VARIABLES` describes the node that receives the statement. It isn't sent to
the [leader](/docs/concepts#leader).

Nodes in a cluster can have different values for valid reasons, such as a
different `data_dir`, or an old `config.yml` on one machine. An answer from the
leader would hide these differences. To compare the configuration of a cluster,
run the statement on each node. The same rule applies to
[`SHOW ENGINE STATS`](/docs/engine-stats).

## Permissions

With authentication enabled, the statement requires a superuser. The secrets
are masked. However, the output shows the full security configuration of the
node, such as whether TLS is required and the rate limits. Other users get
`CADB0517`, with HTTP 403.

With authentication disabled, any caller can run the statement.

## Change settings

`SHOW VARIABLES` is read-only. CamusDB doesn't support `SET GLOBAL` or session
variables.

To change a `runtime` setting on all nodes, use
`SET CLUSTER SETTING <name> = <value>`. To revert it, use
`RESET CLUSTER SETTING <name>`. Both statements require a superuser. A
`restart` setting returns `CADB0400` with `SET CLUSTER SETTING`. Change it in
`config.yml`, and restart the node. For more information, see
[Runtime cluster settings](/docs/runtime-cluster-settings).

A change to `config.yml` needs a restart. A cluster setting overrides the file
until you reset it.

`SET TRANSACTION` doesn't change the configuration. It sets the isolation and
the locking of the current transaction. The `default_*` variables apply to a
transaction that doesn't set these values.

## See also

- [Settings reference](/docs/settings-reference) for the valid values of each
  variable.
- [Configuration](/docs/configuration) for the file format and the CLI flags.
- [Runtime cluster settings](/docs/runtime-cluster-settings) for
  `SET CLUSTER SETTING`.
- [Engine statistics](/docs/engine-stats) for `SHOW ENGINE STATS`, the
  statement for runtime metrics.
