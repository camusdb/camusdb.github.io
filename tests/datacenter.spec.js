const {test, expect} = require('@playwright/test');

test('data center changes real WASM membership, preserves SQL, and recovers a failed node', async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/playground/');
  const add = page.getByRole('button', {name: 'Add one node', exact: true});
  const remove = page.getByRole('button', {
    name: 'Remove one node',
    exact: true,
  });
  const editor = page.getByRole('textbox', {
    name: 'Data center SQL',
    exact: true,
  });
  const run = page.getByRole('button', {
    name: 'Run query',
    exact: true,
  });
  await expect(add).toBeEnabled({timeout: 60000});
  await expect(remove).toBeDisabled();
  await editor.fill(
    "CREATE TABLE rack_probe (id INT64 PRIMARY KEY, value STRING); INSERT INTO rack_probe (id,value) VALUES (1,'before growth'); SELECT value FROM rack_probe WHERE id=1;",
  );
  await run.click();
  await expect(
    page.getByRole('cell', {name: 'before growth', exact: true}),
  ).toBeVisible();
  await expect(page.getByText('Served by camusdb-0', {exact: true}).first()).toBeVisible();
  await add.click();
  const ghost = page.getByRole('button', {name: 'camusdb-4 joining cluster', exact: true});
  await expect(ghost).toBeVisible();
  await expect(ghost).toBeDisabled();
  await expect(ghost).toContainText('JOINING');
  await page.getByLabel('Interactive 3D server racks').screenshot({path: '/tmp/camus-joining-ghost.png'});
  await expect(remove).toBeEnabled({timeout: 90000});
  await page
    .getByRole('button', {name: 'Inspect camusdb-4', exact: true})
    .click();
  await expect(ghost).toHaveCount(0);
  await expect(page.getByText('Served by camusdb-0', {exact: true}).first()).toBeVisible();
  await editor.fill('SELECT value FROM rack_probe WHERE id=1;');
  await expect(async () => {
    await expect(run).toBeEnabled();
    await run.click();
    await expect(
      page.getByRole('cell', {name: 'before growth', exact: true}),
    ).toBeVisible({timeout: 3000});
  }).toPass({timeout: 30000});
  await expect(page.getByText('Served by camusdb-4', {exact: true})).toBeVisible();
  await editor.fill("UPDATE rack_probe SET value='after growth' WHERE id=1;");
  await run.click();
  await expect(remove).toBeEnabled();
  await remove.click();
  await expect(
    page.getByRole('button', {name: 'Inspect camusdb-4', exact: true}),
  ).toHaveCount(0, {timeout: 90000});
  await expect(add).toBeEnabled();
  await editor.fill('SELECT value FROM rack_probe WHERE id=1;');
  await run.click();
  await expect(
    page.getByRole('cell', {name: 'after growth', exact: true}),
  ).toBeVisible();
  const inspector = page.getByRole('region', {name: 'Node inspector'});
  await page
    .getByRole('button', {name: 'Inspect camusdb-0', exact: true})
    .click();
  await inspector.getByRole('button', {name: 'Simulate node failure'}).click();
  await expect(
    inspector.getByRole('button', {name: 'Restart node', exact: true}),
  ).toBeEnabled();
  await expect(add).toBeDisabled();
  await inspector
    .getByRole('button', {name: 'Restart node', exact: true})
    .click();
  await expect(add).toBeEnabled({timeout: 90000});
  await page.screenshot({
    path: '/tmp/camusdb-real-datacenter.png',
    fullPage: true,
  });
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(
    page.getByRole('button', {name: 'Inspect camusdb-0', exact: true}),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('synthetic demand triggers real engine removal and growth', async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.goto('/playground/');
  const add = page.getByRole('button', {name: 'Add one node', exact: true});
  await expect(add).toBeEnabled({timeout: 60000});
  await add.click();
  await expect(
    page.getByRole('button', {name: 'Inspect camusdb-4', exact: true}),
  ).toBeVisible({timeout: 60000});
  await expect(add).toBeEnabled();
  await page.getByRole('button', {name: 'Manual', exact: true}).click();
  await page.getByRole('button', {name: 'Quiet', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'Inspect camusdb-4', exact: true}),
  ).toHaveCount(0, {timeout: 90000});
  await page.getByRole('button', {name: 'Traffic spike', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'Inspect camusdb-4', exact: true}),
  ).toBeVisible({timeout: 60000});
  await expect(add).toBeEnabled();
  await page.getByRole('button', {name: 'Enabled', exact: true}).click();
});
