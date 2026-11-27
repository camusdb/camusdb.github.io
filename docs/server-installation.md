---
sidebar_position: 0.9
description: "Install a standalone CamusDB node with the NuGet tool, Homebrew on macOS or Linux, or Docker. All three options run the same server and the same SQL APIs."
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Server installation

Install a standalone CamusDB node to run SQL on your machine or next to your
application. The three methods run the same server with the same SQL APIs.

| Method | Requirements | Choose it when |
| --- | --- | --- |
| NuGet tool | The .NET 10 SDK to install the tool | You already use .NET and want a global `camusdb` command. |
| Homebrew | Homebrew on macOS or Linux | You want a native command or a background service, with the runtime included. |
| Docker | A running Docker engine | You want a container that stores its data in a named volume. |

## Install and start

Choose one method. The examples start a standalone node with the REST API on
port `5095` and gRPC on port `5096`. Stop a node that uses these ports before
you start another one.

<Tabs groupId="camusdb-install" defaultValue="nuget">
<TabItem value="nuget" label="NuGet tool">

Install the [.NET 10 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/10.0).
The server is the `CamusDB.Server` tool on NuGet, and its command is `camusdb`.

```bash
dotnet tool install --global CamusDB.Server
camusdb
```

If there is no configuration file, the node uses the built-in defaults, and it
stores data in your user data directory. The first lines of the output name the
configuration and the data directory. Stop a foreground node with Ctrl+C.

`camusdb init` writes a starter configuration file and creates the default data
directory.

```bash
camusdb init
```

Edit the file, and restart `camusdb`. If the file exists, `init` returns an
error. To overwrite it, run `camusdb init --force`. For the paths, see
[Configuration and data](#configuration-and-data).

Stop the node before you update the tool.

```bash
dotnet tool update --global CamusDB.Server
camusdb
```

</TabItem>
<TabItem value="homebrew" label="Homebrew">

On macOS or Linux, install with [Homebrew](https://brew.sh). The package
includes the .NET runtime. This means that you don't need to install .NET.

```bash
brew install camusdb/tap/camusdb
camusdb
```

The `camusdb` command starts the node in the foreground with your user
configuration. Stop it with Ctrl+C. Homebrew can also run the node as a
background service.

```bash
brew services start camusdb
```

The service reads `$(brew --prefix)/var/camusdb/config.yml`, and it stores its
data in `$(brew --prefix)/var/camusdb/data`. It doesn't read your user
configuration. Homebrew writes the service configuration when you install the
package, and an upgrade doesn't change your edits.

The `brew services` commands also stop and restart the service.

```bash
brew services stop camusdb
brew services restart camusdb
```

After an upgrade, restart the service to load the new version.

```bash
brew upgrade camusdb
brew services restart camusdb
```

If you use the foreground command, stop it before the upgrade, and start it
again after.

</TabItem>
<TabItem value="docker" label="Docker">

The `camusdb/camusdb` image includes the runtime. This command starts it with
the database files in the `camus-data` volume.

```bash
docker run --rm \
  -p 5095:5095 \
  -p 5096:5096 \
  -v camus-data:/data \
  --name camusdb camusdb/camusdb:latest
```

`--rm` removes the container when it stops. The `camus-data` volume remains for
the next run. Stop the node with Ctrl+C, or run `docker stop camusdb` from
another terminal.

To update, stop the container and pull the image. Then start the container
again with the same volume.

```bash
docker pull camusdb/camusdb:latest
```

For a fixed server version, use a version tag, such as `0.18.5`, in place of
`latest`.

</TabItem>
</Tabs>

## Check the node

From another terminal, check that the node responds.

```bash
curl --fail http://localhost:5095/health
```

`/health` answers when the HTTP listener starts. The storage can need a few
more seconds before the node can execute statements.

To run SQL, connect with [camus-cli](/docs/camus-cli) or the
[Web Console](/docs/web-console). You install them separately. To create a
database and run your first queries, follow the
[tutorial](/docs/intro#connect-with-the-sql-shell). You must create a database
before you use it.

## Configuration and data

The table shows the default locations. Some locations come first, such as a
`camusdb.yml` file in the working directory. For the full order, see
[Configuration discovery](/docs/configuration#configuration-discovery).

| Installation | Configuration | Data |
| --- | --- | --- |
| Foreground command on macOS or Linux | `~/.camusdb/config.yml` | `$XDG_DATA_HOME/camusdb` if it is set, otherwise `~/.local/share/camusdb` |
| NuGet tool on Windows | `%APPDATA%\camusdb\config.yml` | `%LOCALAPPDATA%\camusdb` |
| Homebrew service | `$(brew --prefix)/var/camusdb/config.yml` | `$(brew --prefix)/var/camusdb/data` |
| Docker command above | The built-in defaults and the command line of the image | `/data`, in the `camus-data` volume |

`camusdb init` writes the configuration file in this table. `CAMUS_HOME` moves
the user configuration to `$CAMUS_HOME/config.yml` and the default data
directory to `$CAMUS_HOME/data`. The Homebrew service uses `CAMUS_HOME` for its
paths.

The Homebrew service writes its log to `$(brew --prefix)/var/log/camusdb.log`.
A foreground node writes to its console. For the Docker container, use
`docker logs camusdb` while the container exists.

For the settings, such as the ports and TLS, see the
[settings reference](/docs/settings-reference).

## Run a cluster

The commands on this page run one standalone node. For a local cluster, start
with [the Aspire sample](/docs/aspire#try-the-three-node-notes-example), or
follow [cluster mode](/docs/cluster) for a manual setup. For Kubernetes, use the
[Kubernetes Operator](/docs/kubernetes-operator).
