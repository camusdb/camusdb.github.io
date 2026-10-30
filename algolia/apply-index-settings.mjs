/*
 * Pushes algolia/index-settings.json to the live DocSearch index.
 *
 * The crawler applies `initialIndexSettings` only when it creates an index,
 * so an index that already exists keeps whatever settings it was born with.
 * Run this after any change to index-settings.json:
 *
 *   ALGOLIA_ADMIN_KEY=<admin key> node algolia/apply-index-settings.mjs
 *
 * The admin key is write-capable - pass it through the environment only,
 * never commit it.
 */

import {readFile} from 'node:fs/promises';

const APP_ID = 'SPBBUBI3JT';
const INDEX_NAME = 'camusdb_github_io_spbbubi3jt_pages';

const apiKey = process.env.ALGOLIA_ADMIN_KEY;
if (!apiKey) {
  console.error('Set ALGOLIA_ADMIN_KEY to an Algolia key with the editSettings ACL.');
  process.exit(1);
}

const settings = JSON.parse(
  await readFile(new URL('./index-settings.json', import.meta.url), 'utf8'),
);

const headers = {
  'X-Algolia-Application-Id': APP_ID,
  'X-Algolia-API-Key': apiKey,
  'Content-Type': 'application/json',
};
const base = `https://${APP_ID}.algolia.net/1/indexes/${INDEX_NAME}`;

const response = await fetch(`${base}/settings`, {
  method: 'PUT',
  headers,
  body: JSON.stringify(settings),
});
const body = await response.json();
if (!response.ok) {
  console.error(`Algolia rejected the settings (${response.status}):`, body);
  process.exit(1);
}

// Settings changes are asynchronous; wait so the caller can test right away.
for (;;) {
  const task = await fetch(`${base}/task/${body.taskID}`, {headers}).then((r) => r.json());
  if (task.status === 'published') break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.log(`Applied ${Object.keys(settings).length} settings to ${INDEX_NAME}.`);
