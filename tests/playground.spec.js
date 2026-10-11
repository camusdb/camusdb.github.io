const {test, expect} = require('@playwright/test');

test('real cluster routes SQL, fails over, rejoins, isolates, and resets', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/playground/');
  await page
    .getByRole('button', {name: 'Start 3-node cluster', exact: true})
    .click();
  await expect(page.getByText('Cluster stable', {exact: true})).toBeVisible();
  const run = page.getByRole('button', {name: 'Run query'});
  await expect(run).toBeEnabled();
  const topology = page.getByRole('region', {name: 'Cluster topology'});
  const node = (index) =>
    topology
      .locator('article')
      .filter({
        has: page.getByRole('button', {name: `Inspect Node 0${index}`}),
      });
  const editor = page.getByRole('textbox', {name: 'Cluster SQL'});
  await expect(
    page.locator('pre').filter({hasText: 'SELECT title, author, year'}),
  ).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  // Selecting a follower changes the coordinator and the result provenance.
  await node(3).getByRole('button', {name: 'Route queries here'}).click();
  await run.click();
  await expect(node(3).getByText('Returned last result')).toBeVisible();
  await expect(
    page.getByRole('cell', {name: 'Solaris', exact: true}),
  ).toBeVisible();
  await page
    .locator('main')
    .screenshot({
      style: '.navbar { visibility: hidden; }',
      path: testInfo.outputPath('cluster-stable.png'),
    });

  await page
    .getByRole('button', {name: 'Stop metadata leader', exact: true})
    .click();
  await expect(page.getByText('Stopped', {exact: true})).toHaveCount(1);
  await expect(page.getByText('Cluster degraded', {exact: true})).toBeVisible();
  await expect(
    topology.getByRole('button', {name: 'Stop node', exact: true}),
  ).toHaveCount(2);
  for (const button of await topology
    .getByRole('button', {name: 'Stop node', exact: true})
    .all())
    await expect(button).toBeDisabled();
  await editor.fill(
    "UPDATE books SET price = 42 WHERE title = 'Solaris';\nSELECT price FROM books WHERE title = 'Solaris';",
  );
  await run.click();
  await expect(page.getByRole('cell', {name: '42', exact: true})).toBeVisible();
  await page
    .locator('main')
    .screenshot({
      style: '.navbar { visibility: hidden; }',
      path: testInfo.outputPath('cluster-failover.png'),
    });
  const stopped = topology
    .locator('article')
    .filter({has: page.getByText('Stopped', {exact: true})});
  const stoppedName = await stopped
    .getByRole('button', {name: 'Inspect Node', exact: false})
    .getAttribute('aria-label');
  await stopped.getByRole('button', {name: 'Restart node'}).click();
  await expect(page.getByText('Cluster stable', {exact: true})).toBeVisible();
  const rejoined = topology
    .locator('article')
    .filter({has: page.getByRole('button', {name: stoppedName, exact: true})});
  await rejoined.getByRole('button', {name: 'Route queries here'}).click();
  await editor.fill("SELECT price FROM books WHERE title = 'Solaris';");
  await run.click();
  await expect(rejoined.getByText('Returned last result')).toBeVisible();
  await expect(page.getByRole('cell', {name: '42', exact: true})).toBeVisible();

  await node(1).getByRole('button', {name: 'Isolate', exact: true}).click();
  await expect(page.getByText('Isolated', {exact: true})).toHaveCount(1);
  await expect(page.getByText('Online', {exact: true})).toHaveCount(2);
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('cell', {name: '42', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Restore all links'}).click();
  await expect(page.getByText('Cluster stable', {exact: true})).toBeVisible();

  await editor.fill('CREATE DATABASE browser_lab;');
  await run.click();
  await expect(
    page.getByRole('combobox', {name: 'Cluster database'}),
  ).toHaveValue('browser_lab');
  await editor.fill('SELECT * FROM missing_table;');
  await run.click();
  await expect(page.getByText('Last request failed')).toBeVisible();
  await page.getByRole('button', {name: 'Reset cluster', exact: true}).click();
  await expect(
    page.getByRole('combobox', {name: 'Cluster database'}),
  ).toHaveValue('playground');
  await expect(run).toBeEnabled();
  await expect(
    page.getByRole('combobox', {name: 'Cluster database'}).locator('option'),
  ).toHaveCount(1);

  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(
    page.getByRole('button', {name: 'Inspect Node 01'}),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator('main')
    .screenshot({
      style: '.navbar { visibility: hidden; }',
      path: testInfo.outputPath('cluster-mobile.png'),
    });
  await page.getByRole('button', {name: 'Inspect Node 01'}).click();
  await expect(
    page.getByRole('button', {name: 'Close node details'}),
  ).toBeVisible();
  await page.getByRole('button', {name: 'Close node details'}).click();

  await page.getByRole('button', {name: 'Single node', exact: true}).click();
  await expect(page.getByText('Ready', {exact: true})).toBeVisible();
  await page
    .getByRole('textbox', {name: 'SQL', exact: true})
    .fill('SELECT COUNT(*) AS total FROM books;');
  await page
    .getByRole('textbox', {name: 'SQL', exact: true})
    .press('Control+Enter');
  await expect(page.getByRole('cell', {name: '15', exact: true})).toBeVisible();
  await page.getByRole('button', {name: '3-node cluster', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'Start 3-node cluster', exact: true}),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
