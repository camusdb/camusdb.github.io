// Copy exactly the assets referenced by the published .NET boot manifest.
// Usage: node scripts/sync-playground-engine.mjs ~/camusdb/artifacts/wasm/wwwroot
import {readFile, mkdir, copyFile, rm} from 'node:fs/promises';
import path from 'node:path';
const source = process.argv[2];
if (!source)
  throw new Error('Pass the published CamusDB.Wasm wwwroot directory.');
const destination = path.resolve('static/playground-engine/_framework');
const loader = await readFile(
  path.join(source, '_framework/dotnet.js'),
  'utf8',
);
const manifest = JSON.parse(
  loader.split('/*json-start*/')[1].split('/*json-end*/')[0],
);
const assets = new Set(['dotnet.js']);
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.name === 'string') assets.add(value.name);
  Object.values(value).forEach(collect);
}
collect(manifest.resources);
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});
for (const file of assets)
  await copyFile(
    path.join(source, '_framework', file),
    path.join(destination, file),
  );
console.log(`Synced ${assets.size} runtime assets from ${source}`);
