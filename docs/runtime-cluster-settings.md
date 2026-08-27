---
sidebar_position: 8.5
---

# Runtime cluster settings

You can change a defined subset of the CamusDB configuration while the cluster
runs. Use a SQL prompt. The change reaches every node, whichever node received
the statement.

```camussql
SET CLUSTER SETTING max_mutations_per_transaction = 40000;
SHOW CLUSTER SETTINGS;
RESET CLUSTER SETTING max_mutations_per_transaction;
```

## Why you use one

You can still edit `config.yml` on each node and then restart the nodes. For a
value that defines a node, that is the only method. For every other value, a
cluster setting is the better tool, for five reasons:

- There is no restart, and therefore no period of reduced capacity. Previously
  you rolled a setting out node by node. Examples are a cap on mutations, a rate
  limit for the TTL job, and the default isolation level. The new value now takes
  effect at the next statement boundary, while the node still serves traffic.
- One change gives one value everywhere. CamusDB commits the change through
  Raft. Every node therefore reaches the same value in the same order. There is
  no partial rollout to repair, and no node that keeps an old value because
  somebody forgot a file.
- The change survives the restart that it replaces. CamusDB persists the
  overlay. A node that reboots, and a node that was down during the change, comes
  back with the value of the cluster. It does not come back with its own stale
  YAML.
- One statement reverses the change. `RESET` drops the entry of the cluster.
  Each node then falls back to its own local configuration. That path is much
  shorter than a second edit of the files.
- The database tells you what you can change. Every row of `SHOW VARIABLES`
  carries the mutability and the scope of the setting. There is therefore no
  hand-written list that can become stale.

## The two axes: mutability and scope

CamusDB classifies every setting on two axes. Both axes are visible in
[`SHOW VARIABLES`](/docs/show-variables).

Mutability answers one question: can the setting change without a restart?

| Value | Meaning |
| --- | --- |
| `runtime` | A new value takes effect at the next boundary of the reader. That boundary is the next statement, the next start of a transaction, or the next pass of a background loop. Only these settings can change while the node runs. |
| `restart` | The value is fixed inside something that CamusDB builds once for each process. Examples are the data directory, the node identity, the Raft ports and peers, and the whole `kahuna.*` section. To change one, edit the configuration and restart the node. |

Scope answers a second question: must the fleet agree on the value?

| Value | Meaning |
| --- | --- |
| `cluster` | Disagreement between nodes changes what a user transaction does, and the node that accepted it decides the result. Examples are the isolation defaults, the caps on mutations, and the TTL and lease policy. |
| `node` | The value is per node by design. Examples are the trace switches, the local cache sizes, and the decision whether this node runs a refresh of a materialized view. |

The two axes are independent:

- `data_dir` is `restart` and `node`.
- `max_mutations_per_transaction` is `runtime` and `cluster`.
- `query_tracing_enabled` is `runtime` and `node`. You can change it live, and
  two nodes may hold different values.
- `authentication_enabled` is `restart` and `cluster`. The fleet must agree on
  it, but not through a live change.

Do not keep a list of the changeable settings by hand. Ask the database instead:

```camussql
SHOW VARIABLES;                     -- value, type, default, source, mutability, scope
SHOW VARIABLES LIKE 'ttl_%';        -- narrowed by name
```

## Change a setting

```camussql
SET CLUSTER SETTING max_mutations_per_transaction = 40000;
SET CLUSTER SETTING default_isolation_level = read_committed;
SET CLUSTER SETTING query_tracing_enabled = true;
```

A value uses the same spelling as `config.yml`: a boolean in lowercase, a plain
number, an enum member with underscores, and a duration as whole milliseconds.
An enum value needs no quotation marks. A value that `SHOW VARIABLES` prints
pastes back without a change. That property stops a file and a statement from
two different meanings.

You can send the statement to any node. A node that does not lead the settings
partition forwards the change to the node that does. It uses the authenticated
internal route. CamusDB then commits the change through Raft, and it applies the
change everywhere.

Two conflicting `SET` statements therefore resolve to the same winner on every
node. The commit order decides the winner. A wall clock never decides it. A node
that is down during the change catches up by log replay when it returns.

CamusDB validates the change before it applies the change anywhere. It validates
against the configuration that would result. The validation includes an
invariant across two fields, such as the rule that a lease-renew interval must
stay below its lease. CamusDB rejects a value that would break such a rule. The
message of the validator names both sides of the check. CamusDB writes nothing
in that case.

## Undo a change

```camussql
RESET CLUSTER SETTING max_mutations_per_transaction;
```

`RESET` removes the entry of the cluster for that key. It does not write the
built-in default. A written default would leave the cluster with an override of
every file, with a value that nobody chose.

Each node instead resolves the key through its own local chain again: the
command line, the environment, the file, and the built-in default. A node whose
`config.yml` names that key therefore returns to its file value.

## Precedence: the cluster layer wins

For a `runtime` key, the cluster value overrides the command line of the node,
the environment, and `config.yml`:

1. The cluster overlay.
2. The command-line flags.
3. The environment variables.
4. The selected YAML file.
5. The built-in defaults.

This order has a purpose. A fleet-wide change must not silently do nothing on
the one node whose YAML names that key. That kind of drift is the hardest to
diagnose. A `restart`-class key never accepts a cluster override. A value that
truly defines a node therefore keeps its local origin.

A node whose behavior contradicts its own `config.yml` explains itself. The
`source` column of `SHOW VARIABLES` reads `cluster` for a key that the cluster
supplies. It does not read `config`, `env`, `cli`, or `default`.

## See what the cluster carries

```camussql
SHOW CLUSTER SETTINGS;
SHOW CLUSTER SETTINGS LIKE 'ttl_%';
```

| Column | Meaning |
| --- | --- |
| `setting` | The configuration key. |
| `value` | The text of the stored value, in the spelling that `SET` and `config.yml` accept. |

This statement lists the overlay itself. The overlay holds every key that a `SET`
put in force and that no `RESET` dropped. That is a different question from the
question that `SHOW VARIABLES` answers.

The overlay is what the fleet agreed on. The variables are what this node runs,
after the merge of that overlay over its local configuration. An empty result
means that the cluster carries no override at all.

## Confirm that a change reached every node

`SHOW VARIABLES` is node-local by design. It describes the node that served the
statement. An answer from the leader would hide exactly the drift that you look
for. To confirm a fleet-wide change, ask each node:

```camussql
-- run against every node:
SHOW VARIABLES LIKE 'max_mutations_per_transaction';
```

Every node must report the new value, with `source` equal to `cluster`.

A node that still shows its file value has one of two problems. It has not
applied the change yet, which is replication lag, and which clears on a retry.
Or it cannot reach the cluster. If the value stays wrong, check two things:
the connection from that node to the leader of the settings partition, and the
logs of that node for a warning about a failed apply.

## What CamusDB rejects

Four different mistakes produce four different errors. Each error sends you to a
different place:

| Statement | Error | Why |
| --- | --- | --- |
| `SET CLUSTER SETTING no_such_setting = 1` | `CADB0400`, unknown cluster setting | The key does not exist. Look for the spelling mistake. |
| `SET CLUSTER SETTING data_dir = '/elsewhere'` | `CADB0400`, restart-bound | The key is real, but it is `restart`-class. Edit the configuration, then restart the node. |
| `SET CLUSTER SETTING max_mutations_per_transaction = banana` | `CADB0400`, which names the key | The value does not convert to the type of the setting. |
| `SET CLUSTER SETTING ttl_span_lease_renew_interval_ms = 999999999` | `CADB0600` `InvalidConfig` | The value has a valid form, but it breaks an invariant across two fields. The message names both settings. |

CamusDB reports a `kahuna.*` key as restart-bound, not as unknown. The section
carries no classification for each key. A report of unknown would send an
operator to look for a spelling mistake that is not there.

A rejected change leaves nothing behind. There is no overlay entry, and the
effective configuration of the node does not change.

## Standalone mode

The same three statements work in standalone mode. The validation, the apply,
and the persistence are identical. Only the replication is absent, because there
is no fleet to agree with. A single-node deployment therefore gets live
configuration changes without cluster mode.

## Boot behavior

A node must boot on its file configuration. It swaps to the merged cluster view
as soon as its store is readable. That swap happens before the query engine
serves traffic.

A component that CamusDB builds before that point does one of two things. It
reacts to the swap, or it holds `restart`-class settings only. An ordinary
restart therefore cannot produce a node that permanently disagrees with the
cluster.

## Permissions

All three statements need a superuser while authentication is enabled. Another
user receives `CADB0517` `InsufficientPrivilege`.

Several of these settings bound memory, concurrency, and background work. The
ability to change one across the fleet is therefore a denial-of-service control.

A read of the overlay needs the same privilege as
[`SHOW VARIABLES`](/docs/show-variables). The whole configuration surface
therefore answers consistently.

Any caller may run the three statements while authentication is disabled.

## Related pages

- [Configuration](/docs/configuration) for the full setting reference and the
  startup model.
- [`SHOW VARIABLES`](/docs/show-variables) for the effective values of a node.
- [Cluster Deployment](/docs/cluster) for the way that nodes find each other.
- [Error Codes](/docs/error-codes) for the codes above.
