---
sidebar_position: 2.65
---

# SHOW VARIABLES

`SHOW VARIABLES` shows the configuration that a running CamusDB node actually
uses, from a SQL prompt.

A node's configuration comes from several layers: built-in defaults,
`config.yml`, environment variables, command-line flags, and
[runtime cluster settings](/docs/runtime-cluster-settings). So the text of
`config.yml` does not always tell you what the node runs, but this statement
does. Use it to:

- Confirm that a change took effect after you edit `config.yml`, restart, or
  run `SET CLUSTER SETTING`.
- Find which layer set a value that is not what you expect.
- Compare nodes when one behaves differently from the others.
- Collect a node's configuration for a bug report.

For the meaning of each key, see [Configuration](/docs/configuration).

```camussql
SHOW VARIABLES;
SHOW VARIABLES LIKE '%cache%';
SHOW VARIABLES LIKE 'ttl_%';
```

```text
variable                          value   type   default  source   mutability  scope
────────────────────────────────  ──────  ─────  ───────  ───────  ──────────  ───────
ttl_default_delete_batch_size     100     int    100      default  runtime     cluster
ttl_default_job_cron              @daily  string @daily   default  runtime     cluster
ttl_enabled                       false   bool   true     config   runtime     cluster
ttl_span_lease_ms                 30000   int    30000    default  runtime     cluster
```

## Effective values, not file contents

The rows come from the configuration object that CamusDB used to construct the
engine, not from a second read of `config.yml`.

That distinction is the point of the statement. An environment variable or a
command-line flag can override a value after CamusDB reads the file, so the
value differs from the file's text. The engine obeys the resolved value.

A key that you commented out in `config.yml` shows its built-in default, and a
key that an environment variable overrode shows the override. The output is
what the node runs.

## Columns

| Column     | Meaning |
|------------|---------|
| `variable` | The key in `snake_case`, as you write it in `config.yml`. Keys in the nested `kahuna:` section, which configures the embedded [Kahuna](/docs/concepts#kahuna) storage layer, appear in dotted form, such as `kahuna.wal_sync_writes`. |
| `value`    | The effective value. It is SQL `NULL` when the setting is genuinely unset, which differs from an empty string. |
| `type`     | `bool`, `int`, `long`, `double`, `string`, `enum`, `duration_ms`, or `list`. |
| `default`  | The value the setting would hold without an override. A value that differs from `default` is one that somebody configured. |
| `source`   | The layer that supplied the value: `default`, `config`, `env`, `cli`, or `cluster`. Precedence is cluster first, then cli, then env, then config, then default. |
| `mutability` | `runtime` means a new value takes effect without restarting the node. `restart` means the component reads the value once, when CamusDB constructs it. The column describes the reader, not a preference. You can change a `restart` key, but the running node obeys the old value until it restarts. |
| `scope`    | `cluster` means every node must agree, because a difference between nodes would change the transaction behavior users see. `node` means differences between nodes are the point, as with traces or local cache sizes. |

CamusDB renders each value as you would spell it in `config.yml`, so you can
paste a value from this output back into a file unchanged. Booleans are
lowercase. Numbers are invariant, with no digit separators or units, so a value
reads `67108864`, not `64 MiB`. Enum tokens use underscores, such as
`read_committed`. Durations are whole milliseconds, like every other `*_ms`
key.

CamusDB sorts the rows by name with an ordinal comparison, so the output of two
nodes compares line by line.

A recorded cluster routing mode also appears with source `cluster` when
`key_range_sharding` is unset locally. This value is fixed at cluster creation;
it is not a runtime setting. See
[key-range routing mode](/docs/key-range-sharding#the-mode-is-fixed-when-the-cluster-is-created).

## LIKE

The optional pattern matches the variable name. `%` matches any run of
characters, and `_` matches exactly one character. A pattern that matches
nothing returns zero rows, not an error.

The match is case-sensitive, like `SHOW TABLES`, `SHOW DATABASES`, and
`SHOW ENGINE STATS`, because all four statements share one matcher. Every
variable name is lowercase, so `LIKE 'TTL_%'` correctly matches nothing. Write
`LIKE 'ttl_%'` instead.

All three string literal forms work as the pattern: `'ttl_%'`, `"ttl_%"`, and
`E'ttl_%'`.

## What the output does not show

CamusDB masks secrets. The output lists `bootstrap_superuser_password`,
`access_token_server_key`, and `node_secret`, because whether a secret is set
is an operational question. Their value renders as `********` when set, and as
empty when not.

Certificate and key-file settings hold a path, not key material, so CamusDB
shows them in full. These are `https_certificate`, `raft_certificate`, and
`kahuna.backup_mac_key_file`, and an operator debugging a broken deployment
needs them.

CamusDB does not list deployment and topology keys yet: `mode`, `node_name`,
the internal cluster ports, the HTTP ports, `peers`, `http_peers`, the
certificate paths, and the whole `diagnostics:` section. They live on a
different configuration object from the engine settings. To find a node's
port, read the configuration file or the startup banner.

CamusDB does not list computed properties. A value derived from other
settings, such as the effective spill threshold, is a view of the
configuration, not part of it. Reporting it would offer a name that no
configuration file accepts. CamusDB does list the settings that produce it.

## The statement is node-local

`SHOW VARIABLES` describes the node that served the statement. It never
forwards to the [leader](/docs/concepts#leader).

Nodes in a cluster can differ for valid reasons, such as a different
`data_dir`, a different port, or a stale `config.yml` on one machine. An answer
from the leader would hide exactly the drift you are looking for.

To compare configuration across a cluster, run the statement against each
node's endpoint. The same rule applies to
[`SHOW ENGINE STATS`](/docs/engine-stats).

## Permissions

While authentication is enabled, the statement requires a superuser. CamusDB
masks the three secrets, but the output still describes the node's whole
security posture and limits: whether authentication and TLS are on, the
password hash cost, the data directory, and every rate limit ceiling. No grant
on a single database narrows that view. Other users receive `CADB0517`, with
HTTP 403.

While authentication is disabled, as on a single-node development instance,
any caller can run the statement.

## There is no SET

`SHOW VARIABLES` is read-only. There is no `SET GLOBAL <variable>`, and no
session variable namespace.

Change a setting across the cluster with `SET CLUSTER SETTING <name> = <value>`,
and revert it with `RESET CLUSTER SETTING <name>`. Both statements require
superuser privileges. See
[Runtime Cluster Settings](/docs/runtime-cluster-settings).

The `mutability` column tells you whether such a change takes effect
immediately. The component re-reads a `runtime` setting, so a new value applies
without a restart. A component latches a `restart` setting when CamusDB
constructs it. The overlay accepts the new value and `SHOW VARIABLES` shows it,
but the running node still obeys the old value until it restarts.

Editing `config.yml`, the local layer, always needs a restart. A cluster
setting overrides that file until you reset the setting.

`SET TRANSACTION …` is a different statement. It adjusts the isolation,
locking, and priority of the transaction in flight, and does not touch the
configuration. The `default_*` variables on this page are only the fallback
for a transaction that states no value of its own.

## See also

- [Configuration](/docs/configuration) for the file format, the precedence
  chain, and the CLI flag mapping.
- [Runtime Cluster Settings](/docs/runtime-cluster-settings) for changing
  settings across the fleet with `SET CLUSTER SETTING`, and for what
  `mutability` and `scope` mean for a change's effect.
- [Engine Statistics](/docs/engine-stats) for `SHOW ENGINE STATS`, the
  equivalent statement for runtime metrics.
