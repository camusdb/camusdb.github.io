---
sidebar_position: 8.5
---

# Runtime Cluster Settings

A defined subset of CamusDB's configuration can be changed while the cluster is
running, from a SQL prompt, and the change lands on every node no matter which
node received it.

```camussql
SET CLUSTER SETTING max_mutations_per_transaction = 40000;
SHOW CLUSTER SETTINGS;
RESET CLUSTER SETTING max_mutations_per_transaction;
```

## Why Use One

Editing `config.yml` on each node and restarting them still works, and for
node-defining values it is the only thing that works. For everything else, a
cluster setting is the better tool:

- No restart, so no window of reduced capacity. A knob you would previously have
  rolled out node by node, such as a mutation cap, a TTL rate limit, or the
  default isolation level, takes effect at the next statement boundary with the
  node still serving.
- One change, one value, everywhere. The change is committed through Raft, so
  every node ends up on the same value in the same order. There is no partial
  rollout to reconcile and no node left behind because someone forgot a file.
- It survives the restart it replaces. The overlay is persisted, so a node that
  reboots, or one that was down when the change was made, comes back running the
  cluster's value rather than its own stale YAML.
- Reversible in one statement. `RESET` drops the cluster's entry and each node
  falls back to its own local configuration, which is a far shorter path back
  than re-editing files.
- The database tells you what is changeable. Every row of `SHOW VARIABLES`
  carries the setting's mutability and scope, so there is no hand-maintained list
  to fall out of date.

## The Two Axes: Mutability And Scope

Every setting is classified on two axes, and both are visible in
[`SHOW VARIABLES`](/docs/show-variables).

Mutability answers whether the setting can change without a restart:

| | Meaning |
| --- | --- |
| `runtime` | A new value takes effect at the reader's next boundary: the next statement, the next transaction begin, the next iteration of a background loop. Only these can be changed live. |
| `restart` | The value is baked into something built once per process, such as the data directory, node identity, Raft ports and peers, or the whole `kahuna.*` section. Changing it means editing configuration and restarting the node. |

Scope answers whether the fleet must agree on the value:

| | Meaning |
| --- | --- |
| `cluster` | Nodes disagreeing changes what a user's transaction does depending on which node accepted it: isolation defaults, mutation caps, TTL and lease policy. |
| `node` | Per-node by design: tracing switches, local cache sizes, whether *this* node runs materialized-view refreshes. |

The two axes are independent. `data_dir` is `restart` and `node`.
`max_mutations_per_transaction` is `runtime` and `cluster`.
`query_tracing_enabled` is `runtime` and `node`, so it is changeable live and
nodes are free to differ. `authentication_enabled` is `restart` and `cluster`:
the fleet must agree on it, but not by way of a live change.

Rather than keep a list of changeable settings by hand, ask the database:

```camussql
SHOW VARIABLES;                     -- value, type, default, source, mutability, scope
SHOW VARIABLES LIKE 'ttl_%';        -- narrowed by name
```

## Changing A Setting

```camussql
SET CLUSTER SETTING max_mutations_per_transaction = 40000;
SET CLUSTER SETTING default_isolation_level = read_committed;
SET CLUSTER SETTING query_tracing_enabled = true;
```

Values use the same spelling `config.yml` uses: lowercase booleans, plain
numbers, underscored enum members, durations as whole milliseconds. Enum values
need no quotes. A value printed by `SHOW VARIABLES` pastes back unchanged, which
is the property that keeps a file and a statement from meaning two different
things.

The statement may be sent to any node. A node that does not lead the settings
partition forwards the change to the one that does, over the authenticated
internal route; the change is then committed through Raft and applied everywhere.
Two conflicting `SET`s therefore resolve to the same winner on every node,
because commit order decides, never wall clocks. A node that is down during the
change catches up by log replay when it returns.

The change is validated before it is applied anywhere, against the configuration
that would result, including cross-field invariants such as a lease-renew
interval having to sit under its lease. A value that would break one is rejected
with the validator's message, which names both sides of the check, and nothing is
written.

## Undoing A Change

```camussql
RESET CLUSTER SETTING max_mutations_per_transaction;
```

`RESET` removes the cluster's entry for the key. It does not write the built-in
default, because that would leave the cluster overriding every file with a value
nobody chose. Each node instead resolves the key through its own local chain
again (command line, environment, file, built-in default), so a node whose
`config.yml` names that key returns to its file value.

## Precedence: The Cluster Layer Wins

For a `runtime` key the cluster value overrides the node's command line,
environment, and `config.yml`:

1. the cluster overlay
2. command-line flags
3. environment variables
4. the selected YAML file
5. built-in defaults

The ordering is chosen so that a fleet-wide change cannot silently no-op on the
one node whose YAML happens to name that key, which is the hardest kind of drift
to diagnose. `restart`-class keys are never cluster-overridable, so genuinely
node-defining values keep their local provenance.

A node whose behavior contradicts its own `config.yml` explains itself: the
`source` column in `SHOW VARIABLES` reads `cluster` for a key the cluster
supplies, instead of `config`, `env`, `cli`, or `default`.

## Seeing What The Cluster Carries

```camussql
SHOW CLUSTER SETTINGS;
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

| Column | Meaning |
| --- | --- |
| `setting` | The configuration key. |
| `value` | The stored value text, in the same spelling `SET` and `config.yml` accept. |

This lists the overlay itself, every key a `SET` put in force and no `RESET`
dropped, which is a different question from what `SHOW VARIABLES` answers. The
overlay is what the fleet agreed on; the variables are what this node is actually
running after merging that overlay over its local configuration. An empty result
means the cluster carries no overrides at all.

## Confirming A Change Landed Everywhere

`SHOW VARIABLES` is node-local by design, since it describes the node that served
the statement. Answering from the leader would hide exactly the drift you are
looking for. So confirming a fleet-wide change means asking each node:

```camussql
-- run against every node:
SHOW VARIABLES LIKE 'max_mutations_per_transaction';
```

Every node should report the new value with `source` = `cluster`. A node still
showing its file value either has not applied the change yet, which is
replication lag and clears on a retry, or cannot reach the cluster. If it
persists, check that node's connectivity to the settings-partition leader and its
logs for failed-apply warnings.

## What Gets Rejected

Four different mistakes produce distinct errors, because they send you to
different places:

| Statement | Error | Why |
| --- | --- | --- |
| `SET CLUSTER SETTING no_such_setting = 1` | `CADB0400`, unknown cluster setting | The key does not exist. Go hunt the typo. |
| `SET CLUSTER SETTING data_dir = '/elsewhere'` | `CADB0400`, restart-bound | The key is real but `restart`-class. Edit configuration and restart the node. |
| `SET CLUSTER SETTING max_mutations_per_transaction = banana` | `CADB0400`, naming the key | The value does not coerce to the setting's type. |
| `SET CLUSTER SETTING ttl_span_lease_renew_interval_ms = 999999999` | `CADB0600` `InvalidConfig` | The value is well-formed but breaks a cross-field invariant. The message names both settings. |

A `kahuna.*` key is reported as restart-bound rather than unknown, even though
the section carries no per-key classification. Reporting it as unknown would send
an operator hunting for a typo that is not there.

A rejected change leaves nothing behind: no overlay entry, and the node's
effective configuration is untouched.

## Standalone Mode

The same three statements work in standalone mode. Validation, apply, and
persistence are identical; only replication is absent, since there is no fleet to
agree with. A single-node deployment therefore gets live configuration changes
without running in cluster mode.

## Boot Behavior

A node necessarily boots on its file configuration and swaps to the merged
cluster view as soon as its store is readable, before the query engine starts
serving. Components built before that point either react to the swap or hold only
`restart`-class settings, so an ordinary restart cannot produce a node that
permanently disagrees with the cluster.

## Permissions

All three statements require a superuser when authentication is enabled; a
non-superuser receives `CADB0517` `InsufficientPrivilege`. Several of these knobs
bound memory, concurrency, and background work, so the ability to change one
fleet-wide is a denial-of-service lever. Reading the overlay is held to the same
bar as [`SHOW VARIABLES`](/docs/show-variables), so the whole configuration
surface answers consistently.

With authentication disabled, any caller may run them.

## Related Pages

[Configuration](/docs/configuration) for the full setting reference and the
startup model, [`SHOW VARIABLES`](/docs/show-variables) for the node's effective
values, [Cluster Deployment](/docs/cluster) for how nodes find each other, and
[Error Codes](/docs/error-codes) for the codes above.
