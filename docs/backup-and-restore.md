---
sidebar_position: 5.5
---

# Backup And Restore

CamusDB takes physical, point-in-time-recoverable backups of its storage engine:
a base image plus the WAL written after it, so a restore can target any moment
inside the retention window rather than only the instant the backup ran.

Two things about it surprise people, so they are worth stating first.

A backup is node-wide. Every database on a node shares one Kahuna storage
engine, so a backup captures all of them at once. There is no per-database or
per-table backup, and no `BACKUP` SQL statement; these are server administration
operations, exposed over HTTP.

Restore is offline. It rebuilds storage into a *fresh* directory and never
touches the running server. There is no hot in-place restore; you restore, then
boot a server against the restored directory.

## Why It Works This Way

Both of those constraints come from the same design goal: this is the recovery
path for databases far too large to dump.

A logical export like [camus-dump](/docs/camus-dump) reads every row through the
SQL layer and writes it back out as text. That is fine at gigabytes and
impractical at terabytes: the dump is slower than the disk, the file is larger
than the data it came from, and restoring it means re-parsing every statement,
re-checking every constraint, and rebuilding every index from scratch. The
restore, not the backup, is where that cost really lands.

A physical backup sidesteps all of it. It copies the storage engine's own base
image and the WAL segments after it, so the work is proportional to bytes on
disk rather than rows in the database, and a restore is a file copy plus a WAL
replay instead of a full logical reload. Incrementals then keep the steady-state
cost close to the volume of change rather than the size of the database.

Both consequences follow from that:

- Node-wide, because the image is. The unit being copied is the storage
  engine's on-disk state, and every database on the node lives inside it. Carving
  one database out would mean reading it row by row, which is the logical dump
  this design exists to avoid.
- Offline, because a live engine cannot be overwritten underneath itself.
  Restoring in place would mean replacing the files a running server holds open
  and has cached. Rebuilding into a fresh directory keeps the live node
  untouched and the restore verifiable before you commit to it.

## Enabling Backups

Backups are off by default. Set a backup directory under `kahuna:` and restart:

```yaml
kahuna:
  backup_dir: /opt/camusdb/backups        # required; enables the API
  pitr_window_seconds: 3600               # how far back a restore may target
  base_snapshot_interval_seconds: 1800    # base-image cadence
```

Until `backup_dir` is set, every endpoint below answers `503` with
`CADB0700 BackupNotConfigured`.

`pitr_window_seconds` must be greater than `0` and at most `21600` (six hours);
`base_snapshot_interval_seconds` must not exceed it. Shortening the base-image
interval makes restores faster because less WAL has to be replayed, at the cost
of more disk.

Restore needs a second opt-in. `POST /v1/restore` refuses with `403`
`CADB070C RemoteRestoreDisabled` until you name a server-owned directory that
every restore destination must live under:

```yaml
kahuna:
  restore_root: /opt/camusdb/restores
  allow_unconfined_remote_restore: false
```

`allow_unconfined_remote_restore: true` lifts the confinement and lets a remote
caller write to any absolute path. Do not use it in production.

The backup and restore roots must be owner-only (mode `0700`) and must not be
symlinks. A root that fails that check is rejected with `CADB070F
BackupInsecureRoot` before anything is written.

## Authorization

When authentication is enabled, every backup and restore endpoint requires a
superuser bearer token, the same bar as user administration:

```
Authorization: Bearer <token>
```

Use HTTPS. A token sent over plaintext is refused when TLS is required. When
authentication is disabled the endpoints are open, consistent with the rest of
the engine. See [Authentication And Authorization](/docs/sql-authentication).

## The API

All endpoints live under `/v1` and speak JSON with camelCase fields.

| Method | Path | Body | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/backups/full` | none | Take a full backup now. |
| `POST` | `/v1/backups/incremental` | `{ "parentBackupId": "<guid>" }` | Take an incremental on top of a parent. |
| `POST` | `/v1/backups/coordinated` | none | Take a cluster-wide consistent backup. |
| `GET` | `/v1/backups` | none | List the catalog. |
| `GET` | `/v1/backups/{id}/chain` | none | Resolve and validate the chain ending at `{id}`. |
| `POST` | `/v1/backups/gc?dryRun=<bool>` | none | Preview or run retention and the orphan sweep. |
| `POST` | `/v1/restore` | `{ "leafBackupId", "targetDir", "targetTimeMs" }` | Offline restore into a fresh data root. |

Taking, listing, and validating are online operations and safe while the server
serves traffic.

`camus-cli` wraps everything except restore in a `backup` command family, which
is usually easier than curl for day-to-day work. See
[camus-cli](/docs/camus-cli#backups).

```sh
# Take a full backup, then an incremental on top of it
curl -sX POST http://localhost:5000/v1/backups/full \
  -H "Authorization: Bearer $TOKEN"

curl -sX POST http://localhost:5000/v1/backups/incremental \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"parentBackupId":"<full-guid>"}'

# List the catalog and inspect one chain
curl -s http://localhost:5000/v1/backups -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:5000/v1/backups/<leaf-guid>/chain -H "Authorization: Bearer $TOKEN"
```

Every response is a status envelope. Failures carry a domain code:

```json
{ "status": "failed", "code": "CADB0701", "message": "..." }
```

### Chains And Recoverable Coverage

A restore replays one *chain*: a full backup at the root, then the incrementals
layered on it. `GET /v1/backups/{id}/chain` returns that chain root-first and
validates it. A chain that does not start at a full backup, has a gap, a broken
parent link, or a cycle is rejected with `CADB0701 BackupChainInvalid` rather
than reconstructed into a state that never existed.

The chain head reports `minRecoverablePhysicalMs` and
`maxRecoverablePhysicalMs`. Those two numbers, not the clock, define what you
can restore to.

That distinction matters: recoverability is a property of the chain, not of how
long ago it was taken. `pitr_window_seconds` bounds how much live WAL the
running node retains, but a backup that has already been written keeps its own
coverage. An archived chain from last month is still restorable to any point
inside its own range.

`targetTimeMs` is Unix epoch milliseconds. `0` means "the latest recoverable
point in this chain". A non-zero value outside the chain's coverage is rejected
with `CADB0703 RestorePointOutOfWindow` (HTTP 422).

### Verification And Incremental Fallback

Every artifact is verified by size and SHA-256 both before publish and before
restore. A missing, truncated, duplicated, extra, or corrupt file fails the
operation closed with `CADB0706 BackupCorruptArtifact`; the engine refuses to
restore rather than guess.

If an incremental's parent has aged past the retention floor, a contiguous
increment is impossible. Rather than fail, CamusDB takes a full backup instead
and says so: the response carries `requestedKind`, `actualKind`, and
`substitutionReason`, so the substitution is visible in the catalog instead of
silently changing your chain's shape.

## The Restore Runbook

Restore is offline. The sequence is:

1. Restore into a fresh data root. Call `POST /v1/restore` with a `targetDir`
   that is new or empty and is not the live `data_dir`, nor its `kv` or `wal`
   subdirectories, nor another job's target. Overlap is rejected with
   `CADB0707 RestoreTargetConflict`. The running server is unaffected.

   ```sh
   curl -sX POST http://localhost:5000/v1/restore \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"leafBackupId":"<leaf-guid>","targetDir":"/data/restored","targetTimeMs":1750000000000}'
   ```

   The response echoes the finished directory as `dataRoot`, along with
   `partitionsRestored`, `entriesApplied`, `lastAppliedPhysicalMs`, the
   recoverable range, and the resolved chain.

2. Stop the CamusDB server.

3. Start a fresh server with `data_dir` set to that `dataRoot`. CamusDB lays
   the restored storage out as `{targetDir}/kv` and creates an empty
   `{targetDir}/wal`, so the target is already a complete, bootable data
   directory. No files need to be moved by hand. Keep the same
   `kahuna.storage` and revision settings the backup was taken with.

4. In a cluster, the restored node holds data as of the restore point and is
   caught up by ordinary Raft replication once it rejoins. Whole-cluster
   recovery means restoring every node to one coordinated point and bringing the
   cluster up together.

A restore's checkpoint copy can be rate-limited with
`kahuna.backup_restore_throttle_bytes_per_sec` when it shares a volume with
something you care about.

## Clusters

For a single embedded node, a coordinated backup and a full backup are
effectively the same thing. Coordinated backups matter for real clusters, where
they take one consistent HLC cut across every partition, so a cross-partition
transaction cannot be torn in half. Both capture and restore cut on the shared
commit HLC rather than per-shard WAL time.

Two rules follow:

- Issue coordinated backups on the coordinator node. Any other node answers
  `421` with `CADB070E BackupNotCoordinator`.
- If the topology changes mid-backup, the operation aborts with
  `CADB070D BackupTopologyChanged` and publishes nothing. Retry once membership
  is stable.

Set `kahuna.backup_cluster_id` to the same value on every node. Manifests carry
it along with the coordinating node, listings surface both as `clusterId` and
`coordinatorNode`, and a restore refuses to chain artifacts produced by a
different cluster or a stale topology.

For authenticity, meaning detection of a *substituted* manifest and not just a
damaged one, set `kahuna.backup_mac_key_file` to an HMAC-SHA-256 key file, identical on every
node and stored outside `backup_dir`. Once a node has a key, it refuses
unsigned or tampered manifests.

There is no encryption at rest. Artifacts are plaintext, protected by
filesystem permissions and the integrity MAC. Keep `backup_dir` on an
access-controlled and ideally encrypted volume.

## Retention

Garbage collection is automatic. It runs after each backup and on a periodic
tick, governed by:

| Setting | Default | Meaning |
| --- | --- | --- |
| `kahuna.backup_retention_max_chains` | `0` | Keep at most N chains. `0` is unlimited. |
| `kahuna.backup_retention_max_age_seconds` | `0` | Delete chains older than this. `0` is unlimited. |
| `kahuna.backup_retention_max_bytes` | `0` | Cap total backup bytes. `0` is unlimited. |
| `kahuna.backup_gc_interval_seconds` | `3600` | Background reaper cadence. `0` disables the tick. |

GC deletes only whole chains, and always leaves a valid full root behind for
every retained leaf. It never strands a leaf that cannot be restored.

Preview a pass before trusting it:

```sh
curl -sX POST 'http://localhost:5000/v1/backups/gc?dryRun=true' \
  -H "Authorization: Bearer $TOKEN"
```

The response reports `bytesReclaimed`, the `retentionDeletions` with a reason
per backup, and any `orphanReclamations`, which are files in the backup
directory that belong to no manifest. `dryRun=false` applies the same pass.

Budget disk for roughly `pitr_window_seconds` times your write throughput of
retained WAL, plus the base images overlapping that window. Pick the window from
how far back you would realistically need to recover, not from how far back you
could imagine wanting to.

## Which Recovery Tool To Use

CamusDB has four recovery mechanisms, and they answer different questions.

| You want to | Use |
| --- | --- |
| Recover a node or cluster from data loss, to a chosen point in time | Backup and restore, this page |
| Read what a table looked like earlier, with the server running | [Time-Travel Reads](/docs/time-travel-reads) |
| Undo a `DROP DATABASE` or `DROP TABLE` | [Recover Dropped Objects](/docs/recover-dropped-objects) |
| Move data to another cluster, or keep a readable SQL export | [camus-dump](/docs/camus-dump) |

The first three are all physical and stay inside the engine. `camus-dump` is
logical: it writes SQL you can inspect, diff, and replay anywhere, which makes
it the right tool for migration and the wrong tool for disaster recovery, since
replaying a large dump is far slower than restoring an image. See
[Why It Works This Way](#why-it-works-this-way) for where that line falls.

## Error Codes

| Code | Name | HTTP | Meaning |
| --- | --- | --- | --- |
| `CADB0700` | `BackupNotConfigured` | 503 | `kahuna.backup_dir` is unset. Backups are opt-in. |
| `CADB0701` | `BackupChainInvalid` | 422 | The chain has no full root, a gap, a broken link, or a cycle. |
| `CADB0702` | `BackupNeedsFullBackup` | 409 | An incremental's parent aged past the retention floor. Take a full backup. |
| `CADB0703` | `RestorePointOutOfWindow` | 422 | `targetTimeMs` falls outside the chain's recoverable coverage. |
| `CADB0704` | `RestoreFailed` | 500 | Restore failed copying the base image or replaying WAL. |
| `CADB0705` | `BackupParentMissing` | 404 | The named `parentBackupId` does not exist. |
| `CADB0706` | `BackupCorruptArtifact` | 422 | An artifact is missing, truncated, extra, duplicated, or fails its digest. |
| `CADB0707` | `RestoreTargetConflict` | 409 | The destination exists or overlaps a protected path. |
| `CADB0708` | `BackupExactCheckpointUnavailable` | 409 | The backend cannot cut an exact as-of checkpoint there. |
| `CADB0709` | `BackupUnsupportedFormat` | 422 | The manifest is in a legacy or unsupported format. |
| `CADB070A` | `BackupRetryableLeadershipLoss` | 503 | Partition leadership was lost mid-flight. Nothing durable was applied; retry. |
| `CADB070B` | `BackupCancelled` | 499 | The caller cancelled the operation. |
| `CADB070C` | `RemoteRestoreDisabled` | 403 | No `kahuna.restore_root` is configured and the unconfined opt-in is off. |
| `CADB070D` | `BackupTopologyChanged` | 503 | Topology changed during a coordinated backup. Nothing was published; retry. |
| `CADB070E` | `BackupNotCoordinator` | 421 | Coordinated backup requested on a non-coordinator node. |
| `CADB070F` | `BackupInsecureRoot` | 500 | The backup or restore root is a symlink or is group/world-writable. |

`CADB070A`, `CADB070D`, and `CADB070B` are the retryable ones, and each leaves
nothing published. The rest need an operator decision first.

## Current Limits

- Backups target the local filesystem only. There is no object-storage
  target yet.
- No encryption at rest.
- No hot in-place restore, and no per-database or per-table restore.
- No SQL surface: backup and restore are HTTP admin operations, though
  `camus-cli` exposes everything but restore as shell commands.

## Related Pages

- [Configuration](/docs/configuration)
- [Cluster Mode](/docs/cluster)
- [WAL And Recovery](/docs/wal-recovery)
- [camus-dump](/docs/camus-dump)
- [HTTP API](/docs/http-api)
