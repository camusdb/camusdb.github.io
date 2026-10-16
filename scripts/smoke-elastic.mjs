import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const deadline = setTimeout(() => {
  console.error('Elastic cluster timed out');
  process.exit(1);
}, 240000);
const root = path.resolve(process.argv[2] || 'static/playground-engine');
const {dotnet} = await import(
  pathToFileURL(path.join(root, '_framework/dotnet.js'))
);
const runtime = await dotnet.create();
const exports = await runtime.getAssemblyExports(
  runtime.getConfig().mainAssemblyName,
);
const engine = exports.CamusDB.Wasm.PlaygroundEngine;
const execute = async (node, sql) => {
  const results = JSON.parse(
    await engine.ExecuteOnNodeAsync(node, sql, 'playground'),
  );
  for (const result of results)
    assert.equal(result.ok, true, JSON.stringify(result));
  return results;
};
try {
  let status = JSON.parse(await engine.StartElasticClusterAsync(4));
  console.log(
    `Started ${status.nodes.length} nodes, ${status.partitions.length} data partitions`,
  );
  await execute(
    0,
    "CREATE TABLE scaling_probe (id INT64 PRIMARY KEY, value STRING); INSERT INTO scaling_probe (id, value) VALUES (1, 'before growth');",
  );
  status = JSON.parse(await engine.AddClusterNodeAsync());
  assert.equal(status.nodes.length, 5);
  assert.equal(status.nodes[4].role, 'Voter');
  console.log(`Added voter; roster v${status.membershipVersion}`);
  const until = Date.now() + 60000;
  for (;;) {
    try {
      const rows = await execute(
        4,
        'SELECT value FROM scaling_probe WHERE id = 1;',
      );
      assert.equal(rows[0].rows[0][0], 'before growth');
      break;
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  const placementDeadline = Date.now() + 60000;
  for (;;) {
    status = JSON.parse(await engine.ClusterStatusAsync());
    if (
      status.partitions.some((p) =>
        p.replicas.some((r) => r.index === 4 && r.role === 'Voter'),
      )
    )
      break;
    assert.ok(
      Date.now() < placementDeadline,
      'Rebalancer must place a data replica on the added node',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log('Rebalancer placed data on the added node');
  await execute(
    4,
    "UPDATE scaling_probe SET value = 'after growth' WHERE id = 1;",
  );
  status = JSON.parse(await engine.RemoveClusterNodeAsync());
  assert.equal(status.nodes.length, 4);
  assert.equal(status.members.filter((m) => m.role === 'Voter').length, 4);
  const rows = await execute(
    0,
    'SELECT value FROM scaling_probe WHERE id = 1;',
  );
  assert.equal(rows[0].rows[0][0], 'after growth');
  // Reusing the removed ordinal must join a fresh engine, never bootstrap a new cluster.
  status = JSON.parse(await engine.AddClusterNodeAsync());
  assert.equal(status.nodes[4].role, 'Voter');
  for (let count = 6; count <= 9; count++) {
    status = JSON.parse(await engine.AddClusterNodeAsync());
    assert.equal(status.nodes.length, count);
    assert.equal(status.nodes[count - 1].role, 'Voter');
    console.log(`Grew to ${count} real voters`);
  }
  await assert.rejects(() => engine.AddClusterNodeAsync());
  assert.equal(JSON.parse(await engine.ClusterStatusAsync()).nodes.length, 9);
  for (let count = 8; count >= 4; count--) {
    status = JSON.parse(await engine.RemoveClusterNodeAsync());
    assert.equal(status.nodes.length, count);
    assert.ok(
      status.partitions.every((p) =>
        p.replicas.every((r) => r.index >= 0 && r.index < count),
      ),
      'No removed endpoint remains in placement',
    );
    console.log(`Drained to ${count} real voters`);
  }
  await assert.rejects(() => engine.RemoveClusterNodeAsync());
  const readDeadline = Date.now() + 60000;
  for (;;) {
    try {
      const preserved = await execute(
        0,
        'SELECT value FROM scaling_probe WHERE id = 1;',
      );
      assert.equal(preserved[0].rows[0][0], 'after growth');
      break;
    } catch (error) {
      if (Date.now() > readDeadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  console.log(
    'PASS: real placement, 4→9→4 membership, bounds, data preservation, and rejoin',
  );
} finally {
  await engine.StopClusterAsync();
  clearTimeout(deadline);
}
