---
sidebar_position: 5.5
---

# Backup and restore

A backup is a copy of your data that you keep outside the running database. You
use it to get your data back after an event the database cannot repair on its
own:

- You lose a disk or a whole server.
- Storage files become corrupt.
- A bad migration, a wrong script, or a bug in an application changes or
  deletes a large amount of data.
- You must return the database to its state at an exact moment, for example
  the minute before an incident. The moment must be inside the
  [retention window](#retention).

A [cluster](/docs/cluster) keeps several copies of each write, but it does not
replace a backup. Replication copies a bad change to every node as fast as a
good change. Only a backup lets you go back to a point before the change.

Use this page when you need disaster recovery for a production node or
cluster. For a smaller problem, a lighter tool is often faster:

- To read the earlier contents of a table while the server runs, use
  [Time-travel reads](/docs/time-travel-reads).
- To undo an accidental `DROP TABLE` or `DROP DATABASE`, use
  [Recover dropped objects](/docs/recover-dropped-objects).
- To copy data to another environment, or to keep an export in SQL, use
  [camus-dump](/docs/camus-dump).

[Which recovery tool to use](#which-recovery-tool-to-use) compares the four
tools.

## How a CamusDB backup works

CamusDB takes a physical backup of its storage engine. The backup holds a base
image plus the [write-ahead log (WAL)](/docs/concepts#wal), the record of
changes the engine wrote after that image. A restore can therefore target any
moment inside the retention window, not only the instant of the backup.

A backup covers a whole node. Every database on a node shares one storage
engine ([Kahuna](/docs/concepts#kahuna)), so one backup captures all of them
together. You cannot back up a single database or table, and there is no SQL
`BACKUP` statement. Backups are server administration operations, and CamusDB
exposes them over HTTP.

A restore is offline. It builds the storage into a fresh directory and never
touches the running server. There is no in-place hot restore: you restore
first, then start a server against the restored directory.

## Why it works this way

This is the recovery path for a database that is too large for a dump. A
logical export, such as [camus-dump](/docs/camus-dump), reads every row through
the SQL layer and writes it out as text. That works at gigabyte scale, but not
at terabyte scale: the dump is slower than the disk, the file is larger than the
data, and the restore must parse every statement, check every constraint, and
build every index again. That replay can take hours or days.

A physical backup copies the base image and the WAL after it, so its cost
follows the bytes on disk, not the row count. A restore is a file copy plus a
WAL replay. An incremental backup keeps the steady cost close to the volume of
change. Compressed and out-of-line large values are ordinary storage data, so a
backup captures them with the rows that reference them, and a restore to an
earlier point returns the large values each row pointed at then. See
[Large Values](/docs/storage-layout).

The two constraints above follow from this design:

- A backup covers a whole node because the image does. Taking one database out
  would mean reading it row by row, which is the logical dump this design avoids.
- A restore is offline because CamusDB cannot replace files that a running
  server holds open and caches. A build into a fresh directory leaves the live
  node untouched, and lets you verify the restore first.

PITR bootstrap with `pitr_bootstrap_from` requires RocksDB for both
`kahuna.storage` and `kahuna.wal_storage`; [Solarium](https://solariumdb.github.io/) cannot be used for that
bootstrap path. See [storage-engine choices](/docs/configuration#solarium-storage-engine).

## Enable backups

Backups are off by default. Set a backup directory under `kahuna:`, then
restart the node:

```yaml
kahuna:
  backup_dir: /opt/camusdb/backups        # required; enables the API
  pitr_window_seconds: 3600               # how far back a restore may target
  base_snapshot_interval_seconds: 1800    # base-image cadence
```

Every endpoint below answers `503` with `CADB0700 BackupNotConfigured` until you
set `backup_dir`.

`pitr_window_seconds` must be greater than `0`, with a maximum of `21600` (six
hours). `base_snapshot_interval_seconds` must not exceed it.

A shorter interval between base images makes restores faster, because CamusDB
replays less WAL, at the cost of more disk space.

Restores need a second opt-in. `POST /v1/restore` refuses with `403 CADB070C
RemoteRestoreDisabled` until you name a server-owned directory. Every restore
destination must be inside that directory:

```yaml
kahuna:
  restore_root: /opt/camusdb/restores
  allow_unconfined_remote_restore: false
```

`allow_unconfined_remote_restore: true` removes that confinement, so a remote
caller can write to any absolute path. Do not use it in production.

The backup and restore roots must be owner-only (mode `0700`), and neither may
be a symbolic link. CamusDB rejects a root that fails this check with
`CADB070F BackupInsecureRoot` before writing anything.

## Authorization

While authentication is enabled, every backup and restore endpoint needs a
superuser bearer token, the same requirement as user administration:

```text
Authorization: Bearer <token>
```

Use HTTPS (port 7141 by default). While TLS is required, CamusDB refuses tokens
over plaintext except from loopback. The examples below use
`http://localhost:5095`, which is loopback.

While authentication is disabled, only loopback callers can use these
endpoints. Requests from any other address fail with `CADB0517
InsufficientPrivilege`, so a network peer cannot start a backup or restore
without credentials. See
[Authentication And Authorization](/docs/sql-authentication).

## API

Every endpoint is under `/v1` and speaks JSON with camelCase fields.

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/backups/full` | none | Take a full backup now. |
| `POST` | `/v1/backups/incremental` | `{ "parentBackupId": "<guid>" }` | Take an incremental backup on top of a parent. |
| `POST` | `/v1/backups/coordinated` | none | Take a consistent backup across the cluster. |
| `GET` | `/v1/backups` | none | List the catalog. |
| `GET` | `/v1/backups/{id}/chain` | none | Resolve and validate the chain that ends at `{id}`. |
| `POST` | `/v1/backups/gc?dryRun=<bool>` | none | Preview or run the retention pass and the orphan file sweep. |
| `POST` | `/v1/restore` | `{ "leafBackupId", "targetDir", "targetTimeMs" }` | Restore offline into a fresh data root. |

Backups, catalog listings, and chain validation are online operations, safe
while the server serves traffic.

`camus-cli` wraps every operation except restore in its `backup` commands,
which are usually easier than curl for daily work. See
[camus-cli](/docs/camus-cli#backups).

```sh
# Take a full backup, then an incremental on top of it
curl -sX POST http://localhost:5095/v1/backups/full \
  -H "Authorization: Bearer $TOKEN"

curl -sX POST http://localhost:5095/v1/backups/incremental \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"parentBackupId":"<full-guid>"}'

# List the catalog and inspect one chain
curl -s http://localhost:5095/v1/backups -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:5095/v1/backups/<leaf-guid>/chain -H "Authorization: Bearer $TOKEN"
```

Every response is an envelope with a status. Failures carry a domain code:

```json
{ "status": "failed", "code": "CADB0701", "message": "..." }
```

### Chains and recoverable coverage

A restore replays one chain: a full backup at the root plus the incremental
backups on top of it. `GET /v1/backups/{id}/chain` validates that chain and
returns it, root first.

```mermaid
flowchart LR
    F[(Full backup<br/>root)] --> I1[Incremental] --> I2[Incremental] --> I3[Incremental<br/>leaf]
    I3 -->|restore| R[(Fresh data root)]
```

CamusDB rejects a chain with `CADB0701 BackupChainInvalid` when it does not
start at a full backup, has a gap, has a broken parent link, or has a cycle.
CamusDB does not reconstruct a state that never existed.

The chain head reports `minRecoverablePhysicalMs` and
`maxRecoverablePhysicalMs`. Those two numbers, not the clock, define your
possible restore points.

That distinction matters: recoverability is a property of the chain, not of
the backup's age. `pitr_window_seconds` bounds the live WAL the running node
keeps, but a backup CamusDB has already written keeps its own coverage. An
archived chain from last month is still restorable to any point inside its own
range.

`targetTimeMs` is in Unix epoch milliseconds. `0` means the latest recoverable
point in the chain. CamusDB rejects a nonzero value outside the chain's
coverage with `CADB0703 RestorePointOutOfWindow` (HTTP 422).

### Verification and incremental fallback {#verification-and-a-fallback-for-an-incremental-backup}

CamusDB verifies every artifact by size and SHA-256, both before publishing and
again before restoring. A missing, truncated, duplicated, extra, or corrupt file
fails the operation closed with `CADB0706 BackupCorruptArtifact`. The engine
refuses the restore instead of guessing.

If the parent of an incremental backup has aged past the retention floor, a
contiguous increment is impossible. Instead of failing, CamusDB takes a full
backup and says so: the response carries `requestedKind`, `actualKind`, and
`substitutionReason`. The substitution is visible in the catalog and never
silently changes the shape of your chain.

When the parent chain spans several nodes, the replacement must be a
coordinated full backup. If the node that received the request is not the
backup coordinator (the node that currently [leads](/docs/concepts#leader) the
cluster's backup metadata), the request fails with `CADB070E
BackupNotCoordinator`. Retry it on the coordinator node.

## Restore runbook {#the-restore-runbook}

A restore is offline. Follow this sequence:

1. Restore into a fresh data root. Call `POST /v1/restore` with a new or empty
   `targetDir`. It must not be the live `data_dir`, that root's `kv` or `wal`
   subdirectory, or another job's target. CamusDB rejects an overlap with
   `CADB0707 RestoreTargetConflict`. The running server is unaffected.

   ```sh
   curl -sX POST http://localhost:5095/v1/restore \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"leafBackupId":"<leaf-guid>","targetDir":"/data/restored","targetTimeMs":1750000000000}'
   ```

   The response returns the finished directory as `dataRoot`, along with
   `partitionsRestored`, `entriesApplied`, `lastAppliedPhysicalMs`, the
   recoverable range, and the resolved chain.

2. Stop the CamusDB server.

3. Start a fresh server with `data_dir` set to that `dataRoot`. CamusDB puts
   the restored storage at `{targetDir}/kv` and creates an empty
   `{targetDir}/wal`, so the target is already a complete data directory that
   a server can boot from. You do not need to move any files by hand. Keep the
   same `kahuna.storage` value and revision settings as the backup.
   A physical backup is bound to the storage revision that produced it. To move
   data across storage revisions, restore with the CamusDB version that took
   the backup, then use a
   [logical dump and reimport](/docs/logical-dump-and-reimport).

4. For whole-cluster disaster recovery, restore every node to one coordinated
   point and start the cluster together. To add a node to a running cluster from
   a backup, use the seeded join below. Starting a restored data root as an
   ordinary joining node does not preserve its restored data.

```mermaid
flowchart TD
    A["POST /v1/restore<br/>leafBackupId, targetDir, targetTimeMs"] --> B["Validate the chain<br/>and verify every artifact"]
    B --> C["Copy the base image<br/>and replay the WAL to targetTimeMs"]
    C --> D["Fresh data root<br/>{targetDir}/kv and empty {targetDir}/wal"]
    D --> E[Stop the CamusDB server]
    E --> F["Start a fresh server<br/>with data_dir set to dataRoot"]
```

`kahuna.backup_restore_throttle_bytes_per_sec` limits the rate of a restore's
checkpoint copy. Use it when the restore shares a volume with other important
workloads.

## Seed a joining node from a backup

An ordinary node joining a running cluster with an empty WAL starts at index
zero of the replication log ([Raft](/docs/concepts#raft)). The leader sends it a
full snapshot, replacing the restored store. A seeded join instead replays the
backup chain before Raft starts and writes a committed checkpoint for each
[partition](/docs/concepts#partition) at the index reached by that chain.
The leader then sends only newer log entries.

```mermaid
flowchart TB
    subgraph O["Ordinary join"]
        direction LR
        O1["Empty WAL<br/>Raft index zero"] --> O2["Leader sends a full snapshot<br/>(replaces the restored store)"]
    end
    O ~~~ S
    subgraph S["Seeded join"]
        direction LR
        S1["Replay the backup chain<br/>before Raft starts"] --> S2["Committed checkpoint<br/>for each partition"] --> S3["Leader sends only<br/>newer log entries"]
    end
```

1. Restore a backup chain into a fresh data root with `POST /v1/restore`. Keep
   the `leafBackupId` and `targetTimeMs`.
2. Copy that complete data root to the joining host. Do not start CamusDB on it;
   its WAL must remain empty.
3. Make the same backup catalog available on the joining host and configure
   `kahuna.backup_dir` to point to it.
4. Start the node with the seed settings:

   ```yaml
   mode: cluster
   peers:
     - 10.0.0.1:7070
     - 10.0.0.2:7070
   join_existing: true
   pitr_bootstrap_from: <leafBackupId>
   pitr_bootstrap_target_time_ms: 0
   kahuna:
     backup_dir: /opt/camusdb/backups
   ```

   The equivalent command-line option is `--pitr-bootstrap-from
   <leafBackupId>`, together with `--join-existing true`. Set
   `--pitr-bootstrap-target-time-ms` when the restore targeted a specific time.
5. Remove `pitr_bootstrap_from` after the node joins successfully.

The target time must match the point used to restore the data root. CamusDB
fails startup with `CADB0710 PitrBootstrapFailed` when the restored image is
missing, the WAL is not empty, the storage backend is unsupported, the chain
or its MAC is invalid, the backup belongs to another configured cluster, or the
seeded point is older than the leader's retained log window. Copy a fresh
restored root before retrying after a partial seed attempt.

## Clusters

On a single embedded node, coordinated and full backups are effectively the
same operation.

Coordinated backups matter in a real cluster. A coordinated backup takes one
consistent cut across every partition at a single cluster timestamp
([HLC](/docs/concepts#hlc)), so a cross-partition transaction cannot be split
in half. Both capture and restore cut on the shared commit timestamp, not on one
partition's WAL time.

As a result:

- Issue a coordinated backup on the coordinator node. Any other node answers
  `421` with `CADB070E BackupNotCoordinator`.
- The operation aborts with `CADB070D BackupTopologyChanged` if the topology
  changes during the backup, and CamusDB publishes nothing. Retry once
  membership is stable.

Set `kahuna.backup_cluster_id` to the same value on every node. Each manifest
records that value and the name of the node that coordinated the backup, and
listings show both as `clusterId` and `coordinatorNode`. A restore refuses to
chain artifacts from a different cluster or a stale topology.

For authenticity, set `kahuna.backup_mac_key_file` to an HMAC-SHA-256 key file.
Authenticity here means detecting a substituted manifest, not only a damaged
one. Use the same key on every node and store it outside `backup_dir`. A node
with a key refuses unsigned or altered manifests.

There is no encryption at rest; the artifacts are plaintext. File system
permissions protect them, and the MAC protects their integrity. Keep
`backup_dir` on an access-controlled volume, preferably an encrypted one.

## Retention

Garbage collection is automatic. It runs after each backup and on a periodic
tick. These settings govern it:

| Setting | Default | Meaning |
| --- | --- | --- |
| `kahuna.backup_retention_max_chains` | `0` | Keep at most N chains. `0` means no limit. |
| `kahuna.backup_retention_max_age_seconds` | `0` | Delete a chain older than this age. `0` means no limit. |
| `kahuna.backup_retention_max_bytes` | `0` | Cap total backup bytes. `0` means no limit. |
| `kahuna.backup_gc_interval_seconds` | `3600` | Background reaper period. `0` disables the tick. |

Garbage collection deletes only whole chains. It always leaves a valid full root
behind every leaf it keeps, so it never strands a leaf you cannot restore.

Preview a pass before you trust it:

```sh
curl -sX POST 'http://localhost:5095/v1/backups/gc?dryRun=true' \
  -H "Authorization: Bearer $TOKEN"
```

The response reports `bytesReclaimed`, `retentionDeletions` (with a reason for
each backup), and `orphanReclamations`. An orphan is a file in the backup
directory that belongs to no manifest. `dryRun=false` applies the same pass.

Plan disk space as the retained WAL (`pitr_window_seconds` multiplied by your
write throughput) plus the base images that overlap that window.

Choose the window from a realistic recovery need, not the furthest point you
can imagine.

## Which recovery tool to use

CamusDB has four recovery mechanisms, each for a different question.

| Your goal | The tool |
| --- | --- |
| Recover a node or a cluster from data loss, to a chosen point in time | Backup and restore, on this page |
| Read the earlier contents of a table, while the server runs | [Time-Travel Reads](/docs/time-travel-reads) |
| Undo a `DROP DATABASE` or a `DROP TABLE` | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Move data to another cluster, or keep a readable SQL export | [camus-dump](/docs/camus-dump) |

The first three tools are physical and stay inside the engine.

`camus-dump` is logical. It writes SQL that you can inspect, compare, and replay
anywhere, which makes it the right tool for migrations. It is the wrong tool for
disaster recovery, because replaying a large dump is far slower than restoring
an image. See [Why it works this way](#why-it-works-this-way) for where that
line falls.

## Error codes

| Code | Name | HTTP | Meaning |
| --- | --- | --- | --- |
| `CADB0700` | `BackupNotConfigured` | 503 | `kahuna.backup_dir` is unset. Backups are opt-in. |
| `CADB0701` | `BackupChainInvalid` | 422 | The chain has no full root, a gap, a broken link, or a cycle. |
| `CADB0702` | `BackupNeedsFullBackup` | 409 | Reserved. When an incremental backup is impossible, CamusDB takes a full backup instead (see [the fallback](#verification-and-a-fallback-for-an-incremental-backup)), so this code is effectively not returned. |
| `CADB0703` | `RestorePointOutOfWindow` | 422 | `targetTimeMs` falls outside the recoverable coverage of the chain. |
| `CADB0704` | `RestoreFailed` | 500 | The restore failed while copying the base image or replaying the WAL. |
| `CADB0705` | `BackupParentMissing` | 404 | The named `parentBackupId` does not exist. |
| `CADB0706` | `BackupCorruptArtifact` | 422 | An artifact is absent, truncated, extra, or duplicated, or it fails its digest. |
| `CADB0707` | `RestoreTargetConflict` | 409 | The destination exists, or it overlaps a protected path. |
| `CADB0708` | `BackupExactCheckpointUnavailable` | 409 | The backend cannot cut an exact checkpoint at that point. |
| `CADB0709` | `BackupUnsupportedFormat` | 422 | The manifest uses a legacy format, or a format that CamusDB does not support. |
| `CADB070A` | `BackupRetryableLeadershipLoss` | 503 | The partition lost its leader during the operation. CamusDB applied nothing durable. Retry. |
| `CADB070B` | `BackupCancelled` | 499 | The caller cancelled the operation. |
| `CADB070C` | `RemoteRestoreDisabled` | 403 | There is no `kahuna.restore_root`, and the unconfined opt-in is off. |
| `CADB070D` | `BackupTopologyChanged` | 503 | The topology changed during a coordinated backup. CamusDB published nothing. Retry. |
| `CADB070E` | `BackupNotCoordinator` | 421 | A caller requested a coordinated backup on a node that is not the coordinator. An incremental backup whose fallback must be a coordinated full backup fails the same way. Retry on the coordinator. |
| `CADB070F` | `BackupInsecureRoot` | 500 | The backup or restore root is a symbolic link, or is group- or world-writable. |
| `CADB0710` | `PitrBootstrapFailed` | 500 | A joining node could not validate or seed its restored data root and WAL from the configured backup chain. |

Three codes are retryable: `CADB070A`, `CADB070B`, and `CADB070D`. Each leaves
nothing published. The other codes need an operator decision first.

## Current limits

- Backups target the local file system only. Object storage targets are not
  available yet.
- There is no encryption at rest.
- There is no in-place hot restore, and you cannot restore a single database or
  table.
- There is no SQL interface. Backup and restore are HTTP administration
  operations. `camus-cli` exposes every operation except restore as a shell
  command.

## Related pages

- [Configuration](/docs/configuration)
- [Cluster Mode](/docs/cluster)
- [WAL And Recovery](/docs/wal-recovery)
- [camus-dump](/docs/camus-dump)
- [HTTP API](/docs/http-api)
