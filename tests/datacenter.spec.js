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


test('multiple servers can fail and growth stays blocked until all recover', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/playground/');
  const add = page.getByRole('button', {name: 'Add one node', exact: true});
  const notice = page.locator('#cluster-resize-notice');
  const fail = page.getByRole('button', {name: 'Simulate node failure', exact: true});
  const restart = page.getByRole('button', {name: 'Restart node', exact: true});
  await expect(add).toBeEnabled({timeout: 60000});
  for (const id of [0, 1]) {
    await page.getByRole('button', {name: `Inspect camusdb-${id}`, exact: true}).click();
    await expect(fail).toBeEnabled();
    await fail.click();
    await expect(page.getByRole('img', {name: `camusdb-${id} is down`, exact: true})).toBeVisible();
    await expect(restart).toBeEnabled();
    await expect(add).toBeDisabled();
    await expect(notice).toContainText('Adding servers is paused for safety.');
    await expect(notice).toContainText('Restart unavailable servers');
    await expect(add).toHaveAttribute('aria-describedby', 'cluster-resize-notice');
  }
  await expect(page.getByRole('img', {name: /camusdb-\d is down/})).toHaveCount(2);
  await page.getByRole('button', {name: 'Manual', exact: true}).click();
  await page.getByRole('button', {name: 'Traffic spike', exact: true}).click();
  // Demand must not add servers while any server is down.
  await page.waitForTimeout(5500);
  await expect(page.getByRole('button', {name: 'Inspect camusdb-4', exact: true})).toHaveCount(0);
  await expect(page.locator('[data-joining="true"]')).toHaveCount(0);
  await page.getByRole('button', {name: 'Enabled', exact: true}).click();
  for (const id of [1, 0]) {
    await page.getByRole('button', {name: `Inspect camusdb-${id}`, exact: true}).click();
    await restart.click();
    await expect(page.getByRole('img', {name: `camusdb-${id} is down`, exact: true})).toHaveCount(0, {timeout: 60000});
    if (id === 1) {
      await expect(add).toBeDisabled();
      await expect(notice).toBeVisible();
    }
  }
  await expect(add).toBeEnabled({timeout: 60000});
  await expect(notice).toHaveCount(0);
});

test('stopped servers do not fail healthy queries or leak transport errors', async ({page}) => {
  test.setTimeout(240000);
  await page.goto('/playground/');
  const add = page.getByRole('button', {name: 'Add one node', exact: true});
  const editor = page.getByRole('textbox', {name: 'Data center SQL', exact: true});
  const run = page.getByRole('button', {name: 'Run query', exact: true});
  const fail = page.getByRole('button', {name: 'Simulate node failure', exact: true});
  const inspect = (id) =>
    page.getByRole('button', {name: `Inspect camusdb-${id}`, exact: true}).click();
  const stop = async (id) => {
    await inspect(id);
    await expect(fail).toBeEnabled();
    await fail.click();
    await expect(page.getByRole('img', {name: `camusdb-${id} is down`, exact: true})).toBeVisible();
  };
  await expect(add).toBeEnabled({timeout: 60000});

  // One stopped server leaves every partition a majority, so a query must work on its first
  // run, including inside the election window right after the stop.
  await stop(1);
  await inspect(0);
  await editor.fill('SELECT title FROM books ORDER BY year;');
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(run).toBeEnabled({timeout: 30000});
    await run.click();
    await expect(page.getByText('Served by camusdb-0', {exact: true}).first()).toBeVisible();
    await expect(run).toBeEnabled({timeout: 30000});
    await expect(page.getByRole('cell', {name: 'Foundation', exact: true})).toBeVisible();
    await expect(page.getByText(/CADB\d+|KahunaServerException/)).toHaveCount(0);
  }

  // Two stopped servers leave some partitions with no majority. A statement that needs one fails
  // within its budget, names the server by its rack label, and leaves the page usable.
  await stop(2);
  for (const id of [0, 3]) {
    await inspect(id);
    await editor.fill('SELECT name FROM authors;');
    await expect(run).toBeEnabled({timeout: 30000});
    await run.click();
    await expect(page.getByText(`Served by camusdb-${id}`, {exact: true}).first()).toBeVisible({timeout: 30000});
    await expect(run).toBeEnabled({timeout: 30000});
    await expect(page.getByText(/KahunaServerException|does not exist|needs localhost:/)).toHaveCount(0);
  }
  await expect(page.getByRole('button', {name: 'Restart node', exact: true})).toHaveCount(0);
  await inspect(1);
  await expect(page.getByRole('button', {name: 'Restart node', exact: true})).toBeEnabled();
});

test('starting servers bounce until they are ready, and the pause button stops them', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/playground/');
  const rack = page.locator('button[data-preparing="true"]').first();
  await expect(rack).toBeVisible({timeout: 60000});
  const zOffset = () => rack.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m43).catch(() => 0);
  const opacity = () => rack.locator('> span').first().evaluate((el) => getComputedStyle(el).opacity).catch(() => '1');
  await expect.poll(zOffset, {intervals: [40]}).toBeGreaterThan(20);
  await expect.poll(async () => Number(await opacity()), {intervals: [40]}).toBeLessThan(0.6);

  const pause = page.getByRole('button', {name: 'Pause animation', exact: true});
  await pause.click();
  await expect(rack).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', {name: 'Resume animation', exact: true}).click();

  // A ready server stands still on the floor and keeps its face fully opaque.
  await expect(page.getByRole('button', {name: 'Add one node', exact: true})).toBeEnabled({timeout: 60000});
  const ready = page.getByRole('button', {name: 'Inspect camusdb-1', exact: true});
  await expect.poll(() => ready.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m43)).toBe(0);
  await expect.poll(() => ready.locator('> span').first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

  // A restarting server takes the same animation, and its fire stops.
  await ready.click();
  await page.getByRole('button', {name: 'Simulate node failure', exact: true}).click();
  await expect(page.getByRole('img', {name: 'camusdb-1 is down', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Restart node', exact: true}).click();
  await expect(page.getByRole('img', {name: 'camusdb-1 is down', exact: true})).toHaveCount(0);
  await expect(page.locator('button[data-joining="true"]')).toHaveCount(1);
});

test('starting servers do not bounce with reduced motion', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/playground/');
  const rack = page.locator('button[data-preparing="true"]').first();
  await expect(rack).toBeVisible({timeout: 60000});
  expect(await rack.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
});

test('the console explains why a stopped server cannot run queries', async ({page}) => {
  test.setTimeout(180000);
  await page.goto('/playground/');
  const add = page.getByRole('button', {name: 'Add one node', exact: true});
  await expect(add).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Inspect camusdb-1', exact: true}).click();
  await page.getByRole('button', {name: 'Simulate node failure', exact: true}).click();

  // The inspector says that it shows the selected server, and follows the selection.
  const inspector = page.getByRole('region', {name: 'Node inspector'});
  await expect(inspector.getByText('Selected server', {exact: true})).toBeVisible();
  await expect(inspector.getByRole('heading', {name: 'camusdb-1', exact: true})).toBeVisible();

  const notice = page.locator('#console-server-notice');
  const blocked = page.getByRole('button', {name: 'Server down', exact: true});
  await expect(notice).toContainText('camusdb-1 is down, so it cannot run queries.');
  await expect(blocked).toBeDisabled();
  await expect(blocked).toHaveAttribute('aria-describedby', 'console-server-notice');

  // Switching to a running server clears the block.
  await page.getByRole('button', {name: 'Use camusdb-0', exact: true}).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Run query', exact: true})).toBeEnabled();

  // Restarting from the console brings the stopped server back.
  await page.getByRole('button', {name: 'Inspect camusdb-1', exact: true}).click();
  await expect(notice).toBeVisible();
  await page.getByRole('button', {name: 'Restart camusdb-1', exact: true}).click();
  await expect(page.getByRole('img', {name: 'camusdb-1 is down', exact: true})).toHaveCount(0);
  await expect(add).toBeEnabled({timeout: 60000});
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Run query', exact: true})).toBeEnabled();
});
