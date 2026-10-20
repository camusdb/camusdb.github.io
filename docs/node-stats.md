---
sidebar_position: 3.65
---

# Node resource stats

CamusDB exposes the disk, CPU, and memory state of the node that receives a
request. This gives operators and monitoring systems a lightweight way to
check whether a node has enough resources to keep serving traffic, especially
whether its data volume is approaching the write-admission watermark.

- REST: `GET /v1/admin/stats`
- gRPC: `CamusSql.GetNodeStats`

The call is node-local. Query every node separately when monitoring a cluster.
It reads cached samples and does not scan the database on the request path.

## Authorization

With authentication disabled, anyone who can reach the endpoint can call it.
With authentication enabled, the caller must be a superuser or hold the global
`MONITOR` privilege:

```camussql
CREATE USER monitoring IDENTIFIED BY 'use-a-secret';
GRANT MONITOR ON *.* TO monitoring;
```

`MONITOR` is valid only on `*.*`. It is intentionally outside `ALL PRIVILEGES`
and grants no access to application data. An account with only `MONITOR` sees no
databases through `SHOW DATABASES`.

Other authenticated users receive `CADB0517 InsufficientPrivilege`, as HTTP
`403` or gRPC `PERMISSION_DENIED`.

## Call the endpoint

```bash
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  https://db1.example.com:7141/v1/admin/stats
```

With the .NET driver, over REST or gRPC:

```csharp
CamusNodeStats stats = await connection.GetNodeStatsAsync();
CamusDiskVolumeStats? data = stats.DataVolume;

if (data is { BelowWatermark: true })
    Console.WriteLine("This node is refusing new writes");
```

`GetNodeStatsAsync()` queries the next endpoint in the connection's rotation.
Use `GetNodeStatsAsync(endpoint)` to ask a specific node. The endpoint must be
one of the entries in the connection string's `Endpoint`.

## Returned data

The REST response uses camel-case field names. gRPC uses the corresponding
snake-case protobuf fields.

### Node identity

| Field | Meaning |
| --- | --- |
| `nodeId` | The node's id within the cluster. It can be empty early during startup. |
| `endpoint` | The node's internal cluster address. |
| `version` | Server version and build commit. |
| `clusterMode` | Whether the node runs in cluster mode. |
| `uptimeSeconds` | Whole seconds since process startup. |
| `sampledAtUnixMs` | Time when the reply was assembled. |

### Disk volumes

The first disk entry has role `data`. A second entry with role `wal` appears
when the [write-ahead log](/docs/concepts#wal) (WAL) directory is mounted on
another volume.

| Field | Meaning |
| --- | --- |
| `role`, `path`, `mountPoint` | The role and location of the measured volume. |
| `totalBytes`, `freeBytes`, `availableBytes`, `usedBytes` | Capacity and currently available space. |
| `minFreeDiskBytes` | The write-admission watermark for the data volume. |
| `belowWatermark` | Whether this node currently refuses new writes for insufficient space. |
| `engineBytes` | Bytes occupied by the storage engine and, when colocated, its WAL. |

`belowWatermark` comes from the same probe used by the write gate. When it is
true, writes fail with `CADB0536 InsufficientDiskSpace`; reads, DDL, and `DROP`
remain available so an operator can investigate or free space. Alert before
that point, for example when available space falls below several times the
configured watermark.

### CPU

| Field | Meaning |
| --- | --- |
| `processCpuPercent` | Process CPU as a percentage of the whole node. |
| `processCpuWindowMs` | Sampling window, normally 60 seconds. |
| `processorCount` | Processors visible to .NET, including container CPU limits. |
| `loadAverage1m`, `loadAverage5m`, `loadAverage15m` | Host load averages on Linux and macOS. |

### Memory

| Field | Meaning |
| --- | --- |
| `processWorkingSetBytes` | Resident memory of the CamusDB process. |
| `gcHeapBytes` | Managed heap size. |
| `gcCommittedBytes` | Memory committed by the garbage collector. |
| `gcMemoryLimitBytes` | Effective managed heap limit. `0` means no limit is configured. |
| `hostTotalBytes`, `hostAvailableBytes` | Memory available to the node, respecting Linux cgroup limits. |

## Missing measurements and sample age

A measurement that the node cannot read is `-1`, never `0`. The `errors`
array identifies the field and explains why it was unavailable. One failed
probe does not fail the complete response.

Disk capacity is at most two seconds old. CPU, load, and host memory samples are
at most five seconds old. Engine size and mount layout are refreshed every 60
seconds. Working-set and GC values come directly from the runtime.

## Related pages

- [Authentication and authorization](/docs/sql-authentication)
- [gRPC API](/docs/grpc-api)
- [.NET driver](/docs/dotnet-driver)
- [Operator dashboard](/docs/operator-dashboard)
- [Spill to disk](/docs/spill-to-disk)

