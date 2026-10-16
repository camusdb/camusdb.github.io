# CamusDB Documentation

This repository contains the Docusaurus site published at
https://camusdb.github.io/.

The source project lives at https://github.com/camusdb/camusdb.

## Install

```bash
npm install
```

## Develop

```bash
npm run start
```

## Build

```bash
npm run build
```

The static site is generated in `build/`.

## Deploy

```bash
npm run deploy
```

## Browser playground engine

The `/playground` page uses elastic and three-node cluster exports from `CamusDB.Wasm`.
To update the checked-in runtime from a local CamusDB publish:

```bash
# Run in the CamusDB source checkout:
dotnet publish CamusDB.Wasm/CamusDB.Wasm.csproj -c Release -o artifacts/wasm

# Run in this docs repository:
node scripts/sync-playground-engine.mjs ~/camusdb/artifacts/wasm/wwwroot
node scripts/smoke-cluster.mjs static/playground-engine
npm run test:elastic
npm run build
```

The sync script copies the runtime and assets named by its embedded boot manifest,
so stale fingerprints in the publish directory are not pulled in. The cluster
smoke check exercises cross-node reads, leader failover, writes after failure,
restart/catch-up, and stable elections against the same assets served by the docs.
The elastic check verifies live joins, data placement, graceful draining, rejoining,
4–9 node bounds, and SQL data preservation through scaling.

For the browser interaction and responsive-layout check (Node 20+):

```bash
npx playwright install chromium
npm run build
npm run test:playground
```

The test starts its own static server on port 3100. Screenshots of the stable,
failed-over, and mobile cluster are written to `test-results/`.
