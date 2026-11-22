---
sidebar_position: 3.65
---

# Node resource stats

The node stats call returns the disk, CPU, and memory use of one node. Use it to
alert before the data volume of a node gets too full. When the free space falls
below the write watermark, writes on that node fail.

- REST: `GET /v1/admin/stats`
- gRPC: `CamusSql.GetNodeStats`

The call returns the stats of the node that receives it. To monitor a cluster,
call each node. The call reads cached samples, and it doesn't scan the database.

## Authorization

With authentication off, any client that can reach the endpoint can call it.
With authentication on, the caller must be a superuser or have the global
`MONITOR` privilege.

```camussql
CREATE USER monitoring IDENTIFIED BY 'use-a-secret';
GRANT MONITOR ON *.* TO monitoring;
```

You can grant `MONITOR` only `ON *.*`. Another target returns `CADB0515`.
`ALL PRIVILEGES` doesn't include `MONITOR`, and `MONITOR` doesn't give access to
application data. An account that has only `MONITOR` sees no databases in
`SHOW DATABASES`.

| Caller | HTTP | gRPC |
| --- | --- | --- |
| A request that doesn't have a valid token | `401`, `CADB0516 AuthenticationFailed` | `UNAUTHENTICATED` |
| A user that isn't a superuser and doesn't have `MONITOR` | `403`, `CADB0517 InsufficientPrivilege` | `PERMISSION_DENIED` |

## Call the endpoint

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  https://db1.example.com:7141/v1/admin/stats
```

The .NET driver has the same call for REST and gRPC connections.

```csharp
CamusNodeStats stats = await connection.GetNodeStatsAsync();
CamusDiskVolumeStats? data = stats.DataVolume;

if (data is { BelowWatermark: true })
    Console.WriteLine("This node is refusing new writes");
```

`GetNodeStatsAsync()` calls the next endpoint in the rotation of the
connection. To call a given node, use `GetNodeStatsAsync(endpoint)`. The
endpoint must be one of the entries in `Endpoint` in the connection string.

## Returned data

The REST response uses camelCase field names. gRPC uses the matching snake_case
protobuf fields.

### Node identity

| Field | Meaning |
| --- | --- |
| `nodeId` | The id of the node in the cluster. It can be empty early in startup. |
| `endpoint` | The internal cluster address of the node. |
| `version` | The server version and the build commit, for example `0.18.4+f45cffac...`. |
| `clusterMode` | `true` in cluster mode. |
| `uptimeSeconds` | The seconds since the process started. |
| `sampledAtUnixMs` | The time when the response was built. |

### Disk volumes

The first entry in `disks` has the role `data`. A second entry with the role
`wal` is added when the [write-ahead log](/docs/concepts#wal) (WAL) directory is
on a different volume.

| Field | Meaning |
| --- | --- |
| `role` | `data` or `wal`. |
| `path` | The directory that is measured. |
| `mountPoint` | The mount point of the volume. |
| `totalBytes` | The size of the volume. |
| `freeBytes` | The free space on the volume. |
| `availableBytes` | The free space that the CamusDB process can use. |
| `usedBytes` | The used space on the volume. |
| `minFreeDiskBytes` | The write watermark (`min_free_disk_bytes`). |
| `belowWatermark` | `true` when new writes on this node fail for lack of space. |
| `engineBytes` | The size of the storage engine files. On the `data` entry, it includes the WAL when the WAL is on the same volume. |

`belowWatermark` uses the same disk reading as the write check. While it is
`true`, a DML statement returns `CADB0536 InsufficientDiskSpace`. This includes
`DELETE`. Reads and DDL work, for example `DROP TABLE` and
`TRUNCATE TABLE`. `CREATE TABLE ... AS SELECT` writes rows, and it returns
`CADB0536`. You should alert before that point, for example when
`availableBytes` falls below a few times `minFreeDiskBytes`. For the setting,
see [`min_free_disk_bytes`](/docs/settings-reference).

The write check watches only the data volume. On the `wal` entry,
`minFreeDiskBytes` is `0` and `belowWatermark` is `false`. If the WAL is on a
separate volume, alert on its `availableBytes`.

### CPU

| Field | Meaning |
| --- | --- |
| `processCpuPercent` | The CPU use of the process, as a percentage of all the processors of the node. |
| `processCpuWindowMs` | The time window of `processCpuPercent`. It is 60 seconds, and shorter in the first minute after startup. |
| `processorCount` | The processors that .NET can use. A container CPU limit is applied. |
| `loadAverage1m`, `loadAverage5m`, `loadAverage15m` | The load averages of the host. They are available on Linux and macOS. |

### Memory

| Field | Meaning |
| --- | --- |
| `processWorkingSetBytes` | The resident memory of the CamusDB process. |
| `gcHeapBytes` | The size of the managed heap. |
| `gcCommittedBytes` | The memory that the garbage collector has committed. |
| `gcMemoryLimitBytes` | The limit of the managed heap. `0` means that no limit is set. |
| `hostTotalBytes`, `hostAvailableBytes` | The memory of the node. A Linux cgroup limit is applied. |

## Missing values and sample age

A value that the node can't read is `-1`. This means that you can tell a
missing value from a real `0`. Each entry in the `errors` array has a `field`,
such as `cpu.load_average_1m`, and a `message` with the reason. A failed probe
doesn't fail the response.

| Values | Age |
| --- | --- |
| Disk space and `belowWatermark` | At most 2 seconds |
| CPU, load averages, and host memory | At most 5 seconds |
| `engineBytes` and `mountPoint` | At most 60 seconds |
| `processWorkingSetBytes`, `gcHeapBytes`, `gcCommittedBytes` | Read at the time of the call |

## Related pages

- [Authentication and authorization](/docs/sql-authentication)
- [gRPC API](/docs/grpc-api)
- [.NET driver](/docs/dotnet-driver)
- [Operator dashboard](/docs/operator-dashboard)
- [Spill to disk](/docs/spill-to-disk)
