---
sidebar_position: 0.9
description: "Install a standalone CamusDB node with the NuGet tool, Homebrew on macOS or Linux, or Docker. All three options run the same server and the same SQL APIs."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Server installation

Install a standalone CamusDB node to run SQL locally or alongside your
application. Choose the package that fits your environment; all three options
run the same server and expose the same SQL APIs.

| Method | Requirements | Choose it when |
| --- | --- | --- |
| NuGet tool | .NET 10 SDK to install the tool | You already use .NET and want a global `camusdb` command. |
| Homebrew | Homebrew on macOS or Linux | You want a native command or background service with its runtime included. |
| Docker | A running Docker engine | You want a container with data kept in a named volume. |

## Install and start

Choose one method. The examples start a standalone node with REST on port
`5095` and gRPC on `5096`. Stop an existing node before starting another on
the same ports.

<Tabs groupId="camusdb-install" defaultValue="nuget">
<TabItem value="nuget" label="NuGet tool">

Install the [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
then install the server from NuGet:

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

With no configuration file, the node starts on built-in defaults and stores
data in your user data directory. To keep settings of your own:

```bash
camusdb init
```

This creates a starter configuration and the default data directory. Edit the
file and restart `camusdb`; see [configuration and data](#configuration-and-data)
for the paths. Stop a foreground node with Ctrl+C.

To update, stop the node, update the tool, and start it again:

```bash
dotnet tool update --global CamusDB.Server
camusdb
```

</TabItem>
<TabItem value="homebrew" label="Homebrew">

On macOS or Linux, install with [Homebrew](https://brew.sh). The package
includes the .NET runtime, so the server needs no separate .NET installation:

```bash
brew install camusdb/tap/camusdb
camusdb
```

This runs in the foreground with your user configuration. Stop it with Ctrl+C.
To run a background service instead:

```bash
brew services start camusdb
```

The service uses its own configuration and data directory under
`$(brew --prefix)/var/camusdb`; it does not use the foreground command's user
configuration. Homebrew creates the service configuration on installation
and preserves your edits on upgrade.

Manage the service with:

```bash
brew services stop camusdb
brew services restart camusdb
```

Update the package and restart the service to load the new version:

```bash
brew upgrade camusdb
brew services restart camusdb
```

If you run the foreground command instead, stop it before upgrading and run
`camusdb` again afterward.

</TabItem>
<TabItem value="docker" label="Docker">

With Docker running, start the published image:

```bash
docker run --rm \
  -p 5095:5095 \
  -p 5096:5096 \
  -v camus-data:/data \
  --name camusdb camusdb/camusdb:latest
```

The image includes the runtime. The `camus-data` volume keeps database files
under `/data`, independently of the container. `--rm` removes the stopped
container, while the named volume remains for the next run.

Stop the node with Ctrl+C or, from another terminal:

```bash
docker stop camusdb
```

To update, stop the container, pull the image, and repeat the start command
with the same volume:

```bash
docker pull camusdb/camusdb:latest
```

Use a version tag in place of `latest` when you need a fixed server version.

</TabItem>
</Tabs>

## Check the node

From another terminal, check that the standalone node is responding:

```bash
curl --fail http://localhost:5095/health
```

To run SQL, connect with [camus-cli](/docs/camus-cli) or the
[Web Console](/docs/web-console). They are separate installations. Follow the
[tutorial](/docs/intro#connect-with-the-sql-shell) to create a database and run
your first queries. A database must be created explicitly before use.

## Configuration and data

These are the default locations; explicit configuration and environment
settings can override them:

| Installation | Configuration | Data |
| --- | --- | --- |
| Foreground command on macOS/Linux | `~/.camusdb/config.yml`, created by `camusdb init` | `$XDG_DATA_HOME/camusdb`, or `~/.local/share/camusdb` when unset |
| NuGet tool on Windows | `%APPDATA%\camusdb\config.yml`, created by `camusdb init` | `%LOCALAPPDATA%\camusdb` |
| Homebrew service | `$(brew --prefix)/var/camusdb/config.yml` | `$(brew --prefix)/var/camusdb/data` |
| Docker command above | Built-in/image settings unless overridden | `/data`, backed by the `camus-data` volume |

The Homebrew service writes its log to
`$(brew --prefix)/var/log/camusdb.log`. A foreground process or Docker
container writes to its console; use `docker logs camusdb` while the
container exists.

For installed commands, `CAMUS_HOME` relocates the user configuration to
`$CAMUS_HOME/config.yml` and the default data directory to `$CAMUS_HOME/data`.
`--config <path>` selects a configuration file explicitly. See
[configuration discovery](/docs/configuration#configuration-discovery) for
precedence and [the settings reference](/docs/settings-reference) for ports,
authentication, TLS, and storage options.

## Run a cluster

The commands above run one standalone node. For a local cluster, start with
[the Aspire sample](/docs/aspire#try-the-three-node-notes-example), or follow
[cluster mode](/docs/cluster) for manual setup. For Kubernetes, use the
[Kubernetes Operator](/docs/kubernetes-operator).
