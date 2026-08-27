---
sidebar_position: 2.65
---

# SHOW VARIABLES

Inspect the configuration that a running CamusDB node uses. You do it from a SQL
prompt.

```camussql
SHOW VARIABLES;
SHOW VARIABLES LIKE '%cache%';
SHOW VARIABLES LIKE 'ttl_%';
```

```
variable                          value   type   default  source   mutability  scope
────────────────────────────────  ──────  ─────  ───────  ───────  ──────────  ───────
ttl_default_delete_batch_size     100     int    100      default  runtime     cluster
ttl_default_job_cron              @daily  string @daily   default  runtime     cluster
ttl_enabled                       false   bool   true     config   runtime     cluster
ttl_span_lease_ms                 30000   int    30000    default  runtime     cluster
```

## Effective values, not the contents of a file

The rows come from the configuration object that CamusDB used to construct the
engine. They do not come from a second read of `config.yml`.

That distinction is the purpose of the statement. An environment variable or a
command-line flag can override a value after CamusDB read the file. The value
then differs from the text of the file. The engine obeys the resolved value.

A key that you commented out in `config.yml` shows its built-in default. A key
that an environment variable overrode shows the override. The output is
therefore what the node runs.

## Columns

| Column     | Meaning |
|------------|---------|
| `variable` | The key in `snake_case`, as you write it in `config.yml`. A key of the nested `kahuna:` section appears in dotted form, such as `kahuna.wal_sync_writes`. |
| `value`    | The effective value. It is SQL `NULL` when the setting is genuinely unset, which differs from an empty string. |
| `type`     | `bool`, `int`, `long`, `double`, `string`, `enum`, `duration_ms`, or `list`. |
| `default`  | The value that the setting would hold without an override. A value that differs from `default` is a value that somebody configured. |
| `source`   | The layer that supplied the value: `default`, `config`, `env`, `cli`, or `cluster`. The precedence is cluster first, then cli, then env, then config, then default. |
| `mutability` | `runtime` means that a new value takes effect without a restart of the node. `restart` means that the component reads the value once, when CamusDB constructs it. The column describes the reader. It is not a preference. You can change a `restart` key, but the running node obeys the old value until it restarts. |
| `scope`    | `cluster` means that every node must agree, because a difference between nodes would change the transaction behavior that a user sees. `node` means that a difference between nodes is the purpose, as with the traces or the local cache sizes. |

CamusDB renders a value in the spelling of `config.yml`. You can therefore paste
a value from this output back into a file without a change. A boolean is
lowercase. A number is invariant, without a digit separator and without a unit,
so it reads `67108864`, not `64 MiB`. An enum token uses underscores, such as
`read_committed`. A duration is whole milliseconds, like every other `*_ms` key.

CamusDB sorts the rows by name, with an ordinal comparison. The output of two
nodes therefore compares line by line.

## LIKE

The optional pattern matches the name of the variable. `%` matches any run of
characters. `_` matches exactly one character. A pattern that matches nothing
returns zero rows. It does not return an error.

The match is case-sensitive. It behaves like `SHOW TABLES`, `SHOW DATABASES`,
and `SHOW ENGINE STATS`, because the four statements share one matcher. Every
variable name is lowercase. `LIKE 'TTL_%'` therefore correctly matches nothing.
Write `LIKE 'ttl_%'` instead.

All three forms of a string literal work as the pattern: `'ttl_%'`, `"ttl_%"`,
and `E'ttl_%'`.

## What the output does not show

CamusDB masks a secret. The output lists `bootstrap_superuser_password`,
`access_token_server_key`, and `node_secret`, because the presence of a secret
is an operational question. Their value renders as `********` when it is set. It
renders as empty when it is not.

A certificate setting and a key-file setting hold a path. They do not hold key
material. CamusDB therefore shows them in full. `https_certificate`,
`raft_certificate`, and `kahuna.backup_mac_key_file` are those settings. An
operator who debugs a wrong deployment needs them.

CamusDB does not list the deployment keys and the topology keys yet. Those keys
are `mode`, `node_name`, the Raft ports, the HTTP ports, `peers`, `http_peers`,
the certificate paths, and the whole `diagnostics:` section. They live on a
different configuration object from the settings of the engine. To find the port
of a node, read the configuration file, or read the banner at startup.

CamusDB does not list a computed property. A value derived from other settings,
such as the effective spill threshold, is a view of the configuration. It is not
a part of the configuration. A report of it would offer a name that no
configuration file accepts. CamusDB does list the settings that produce it.

## The statement is node-local

`SHOW VARIABLES` describes the node that served the statement. It never forwards
to the leader.

Two nodes of a cluster can differ for a valid reason. Examples are a different
`data_dir`, a different port, and a stale `config.yml` on one machine. An answer
from the leader would hide exactly the drift that you look for.

To compare the configuration across a cluster, run the statement against the
endpoint of each node. The same rule applies to
[`SHOW ENGINE STATS`](/docs/engine-stats).

## Permissions

The statement needs a superuser while authentication is enabled. CamusDB masks
the three secrets, but the output still describes the whole security posture and
the limits of the node. It shows whether authentication and TLS are on, the cost
of the password hash, the data directory, and every ceiling of a rate limit. No
grant on one database narrows that view. Another user receives `CADB0517`, with
HTTP 403.

While authentication is disabled, as on a single-node development instance, any
caller may run the statement.

## There is no SET

`SHOW VARIABLES` is read-only. There is no `SET GLOBAL <variable>`, and there is
no namespace of session variables.

Change a setting across the cluster with `SET CLUSTER SETTING <name> = <value>`.
Revert it with `RESET CLUSTER SETTING <name>`. Both statements need superuser
privileges. See [Runtime Cluster Settings](/docs/runtime-cluster-settings).

The `mutability` column reports whether such a change takes effect immediately.
The component re-reads a `runtime` setting, so a new value applies without a
restart. A component latches a `restart` setting when CamusDB constructs it. The
overlay accepts the new value, and `SHOW VARIABLES` shows it. The running node
nevertheless obeys the old value until it restarts.

An edit of `config.yml`, which is the local layer, always needs a restart. A
cluster setting overrides that file until you reset the setting.

`SET TRANSACTION …` is a different statement. It adjusts the isolation, the
locking, and the priority of the transaction in flight. It does not touch the
configuration. The `default_*` variables on this page are only the fallback for
a transaction that states no value of its own.

## See also

- [Configuration](/docs/configuration) for the file format, the chain of
  precedence, and the map to the CLI flags.
- [Runtime Cluster Settings](/docs/runtime-cluster-settings) for a change across
  the fleet with `SET CLUSTER SETTING`. That page also explains what
  `mutability` and `scope` mean for the effect of a change.
- [Engine Statistics](/docs/engine-stats) for `SHOW ENGINE STATS`, which is the
  equivalent statement for the runtime metrics.
