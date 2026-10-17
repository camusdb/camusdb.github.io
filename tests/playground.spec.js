const {test, expect} = require('@playwright/test');

test('one workspace keeps SQL visible beside the 3D scene', async ({page}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/playground/');
  const editor = page.getByRole('textbox', {name: 'Data center SQL', exact: true});
  const run = page.getByRole('button', {name: 'Run query', exact: true});
  await expect(editor).toBeInViewport();
  await expect(run).toBeInViewport();
  await expect(page.getByLabel('Interactive 3D server racks')).toBeInViewport();
  await expect(page.getByRole('button', {name: /SQL workbench|Single node|3-node cluster/})).toHaveCount(0);
  await expect(run).toBeEnabled({timeout: 60000});
  await page.getByRole('button', {name: 'Rotate scene left', exact: true}).click();
  await page.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await page.getByRole('button', {name: 'Reset camera', exact: true}).click();
  await page.getByRole('button', {name: 'Create a table', exact: true}).click();
  await editor.press('Control+Enter');
  await expect(page.getByRole('cell', {name: 'Hello, CamusDB!', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Inspect camusdb-1', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Data center SQL'})).toContainText('playground / camusdb-1');
  await page.getByRole('button', {name: 'Read rows', exact: true}).click();
  await run.click();
  await expect(page.getByRole('cell', {name: 'Hello, CamusDB!', exact: true})).toBeVisible();
  await page.screenshot({path: '/tmp/camusdb-unified-desktop.png', fullPage: true});
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(editor.locator('..')).toHaveCSS('background-color', 'rgb(245, 248, 255)');
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(editor).toBeInViewport();
  await expect(run).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: '/tmp/camusdb-unified-mobile.png', fullPage: true});
  await editor.fill('SELECT * FROM missing_table;');
  await run.click();
  await expect(page.getByRole('region', {name: 'Query results'})).toContainText(/missing_table/);
  await expect(page.getByRole('region', {name: 'Query results'})).toContainText('Served by camusdb-1');
  await page.getByRole('button', {name: 'Reset data center', exact: true}).click();
  await expect(run).toBeEnabled({timeout: 60000});
  await expect(page.getByText('Your results appear here')).toBeVisible();
  expect(errors).toEqual([]);
});

test('restored SQL examples run against the sample library', async ({page}) => {
  await page.goto('/playground/');
  const run = page.getByRole('button', {name: 'Run query', exact: true});
  const results = page.getByRole('region', {name: 'Query results'});
  await expect(run).toBeEnabled({timeout: 60000});
  for (const name of ['Databases', 'Filter and sort', 'Join and group', 'Subquery', 'Returning', 'Foreign keys', 'Use the index', 'Update, then check', 'Your own table', 'Schema', 'Functions', 'Branching']) {
    await page.getByRole('button', {name, exact: true}).click();
    await run.click();
    await expect(run).toBeEnabled();
    await expect(results.locator('article')).not.toHaveCount(0);
    await expect(results.locator('article[class*="failed"]'), name).toHaveCount(0);
  }
  await page.getByRole('button', {name: 'Inspect camusdb-2', exact: true}).click();
  const selected = page.getByRole('button', {name: 'Inspect camusdb-2', exact: true});
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(selected).toContainText('SELECTED');
  await expect(page.getByRole('button', {name: 'Inspect camusdb-0', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({path: '/tmp/camus-examples-selection.png', fullPage: true});
  await page.getByRole('button', {name: 'Reset data center', exact: true}).click();
  await expect(run).toBeEnabled({timeout: 60000});
  await page.getByRole('textbox', {name: 'Data center SQL', exact: true}).fill('SELECT COUNT(*) AS total FROM books;');
  await run.click();
  await expect(results.getByRole('cell', {name: '15', exact: true})).toBeVisible();
});


test('startup stays informative and SQL highlighting follows editing and scrolling', async ({page}) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/_framework/dotnet.js', async (route) => { await gate; await route.continue(); });
  await page.goto('/playground/');
  const status = page.getByRole('region', {name: 'Cluster session status'});
  const editor = page.getByRole('textbox', {name: 'Data center SQL', exact: true});
  await expect(status).toContainText('Preparing your cluster');
  await expect(page.getByRole('button', {name: 'Starting cluster…', exact: true})).toBeDisabled();
  await expect(page.getByRole('list', {name: 'Startup progress'})).toContainText('Load engine');
  await editor.fill("-- Ready while loading\nSELECT 'hello', 42 FROM books;");
  const highlighted = editor.locator('..').locator('pre');
  await expect(highlighted.locator('span').filter({hasText: /^SELECT$/})).toHaveCSS('color', 'rgb(20, 89, 219)');
  await expect(highlighted.locator('span').filter({hasText: /^'hello'$/})).toHaveCSS('color', 'rgb(180, 83, 9)');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(highlighted.locator('span').filter({hasText: /^SELECT$/})).toHaveCSS('color', 'rgb(20, 89, 219)');
  await page.getByRole('button', {name: 'Foreign keys', exact: true}).click();
  await editor.evaluate((el) => { el.scrollTop = 150; el.dispatchEvent(new Event('scroll', {bubbles: true})); });
  await expect(highlighted.locator('code')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, -150)');
  release();
  await expect(status).toContainText('Cluster ready', {timeout: 60000});
  await expect(page.getByRole('list', {name: 'Startup progress'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Run query', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Filter and sort', exact: true}).click();
  await expect(highlighted).toContainText('SELECT title, author, year');
  await page.screenshot({path: '/tmp/camus-highlight-ready.png', fullPage: true});
});

test('partition blades track leadership and failed servers show fire until recovery', async ({page}) => {
  await page.goto('/playground/');
  await expect(page.getByRole('button', {name: 'Run query', exact: true})).toBeEnabled({timeout: 60000});
  const server = page.getByRole('button', {name: 'Inspect camusdb-0', exact: true});
  await expect(server.locator('[data-role]')).toHaveCount(8);
  await expect.poll(() => page.locator('button [data-role="leader"]').count()).toBe(8);
  const front = await server.evaluate((el) => parseFloat(el.parentElement.style.top));
  const back = await page.getByRole('button', {name: 'Inspect camusdb-3', exact: true}).evaluate((el) => parseFloat(el.parentElement.style.top));
  expect(front).toBeGreaterThan(back);
  await page.getByRole('button', {name: 'Simulate node failure', exact: true}).click();
  const fire = page.getByRole('img', {name: 'camusdb-0 is down', exact: true});
  await expect(fire).toBeVisible();
  await expect(server.locator('[data-role="offline"]')).toHaveCount(8);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByLabel('Interactive 3D server racks').screenshot({path: '/tmp/camusdb-fire.png'});
  await page.getByRole('button', {name: 'Restart node', exact: true}).click();
  await expect(fire).toHaveCount(0);
  await expect(server.locator('[data-role="offline"]')).toHaveCount(0);
});
