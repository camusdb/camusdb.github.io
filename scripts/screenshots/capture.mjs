#!/usr/bin/env node
// Captures the documentation screenshots of the web console, the operator dashboard and
// camus-cli from a fresh, seeded CamusDB node, frames them, and writes them to
// static/img/screenshots/.
//
// Requirements: the camusdb, camus-cli and camusdb-webconsole .NET tools, vhs (brew install vhs),
// cwebp (brew install webp) and the Playwright Chromium browser (npx playwright install chromium).
//
// Usage: npm run screenshots [-- --only=webconsole,dashboard,cli,tui] [-- --png]

import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const work = path.join(repo, '.screenshots');
const raw = path.join(work, 'raw');
const state = path.join(work, 'state');
const outDir = path.join(repo, 'static/img/screenshots');

// The dashboard shows the data directory, so it gets a short, neutral path.
const dataDir = '/tmp/camusdb-screenshots';
const endpoint = 'http://localhost:5095';
const consoleUrl = 'http://127.0.0.1:5164';
const ports = [5095, 5096, 5164];

const scale = 2;
const viewport = {width: 1440, height: 900};
const themes = ['dark', 'light'];

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',');
const keepPng = args.includes('--png');
const wanted = (name) => !only || only.includes(name);

const children = [];

// SQL shown in the web console. The seed data in seed.sql gives the same rows on every run.
const querySql = `SELECT o.id, c.name, o.status, o.total
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.status = 'paid'
ORDER BY o.total DESC;`;

const planSql = `EXPLAIN SELECT c.name, SUM(i.quantity * p.price) AS revenue
FROM orders o
JOIN customers c ON c.id = o.customer_id
JOIN order_items i ON i.order_id = o.id
JOIN products p ON p.id = i.product_id
WHERE o.status = 'paid'
GROUP BY c.name;`;

// Opens in the TUI editor through its scratch file, so the tape does not need to type it.
const tuiSql = `SELECT p.name, SUM(i.quantity) AS units
FROM order_items i
JOIN products p ON p.id = i.product_id
GROUP BY p.name
ORDER BY units DESC;`;

function log(message) {
  console.log(`[screenshots] ${message}`);
}

function requireTool(name, hint) {
  if (spawnSync('which', [name]).status !== 0)
    throw new Error(`${name} was not found on PATH. ${hint}`);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({port, host: '127.0.0.1'});
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

// The .NET tools format numbers with the system culture. A fixed culture keeps durations and
// costs as "12.34ms" on every machine, whatever its regional settings.
const childEnv = {...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8'};

function start(command, commandArgs, logName, options = {}) {
  const logFile = fs.openSync(path.join(work, logName), 'w');
  const child = spawn(command, commandArgs, {stdio: ['ignore', logFile, logFile], env: childEnv, ...options});
  children.push(child);
  return child;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {encoding: 'utf8', env: childEnv, ...options});
  if (result.status !== 0)
    throw new Error(`${command} ${commandArgs.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

async function waitFor(description, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check())
        return;
    } catch {
      // Not ready yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function stopChildren() {
  for (const child of children.reverse()) {
    if (child.exitCode === null)
      child.kill('SIGTERM');
  }
}

async function startStack() {
  for (const port of ports) {
    if (await portInUse(port))
      throw new Error(`Port ${port} is in use. Stop the CamusDB node or web console that uses it, then run again.`);
  }

  fs.rmSync(dataDir, {recursive: true, force: true});
  fs.mkdirSync(dataDir, {recursive: true});

  // An explicit config keeps ~/.camusdb/config.yml and ./camusdb.yml out of the demo node.
  const config = path.join(work, 'camusdb.yml');
  fs.writeFileSync(config, `mode: standalone\ndata_dir: ${dataDir}\n`);

  log('starting CamusDB node');
  start('camusdb', ['--config', config, '--memory-profile', 'dev'], 'camusdb.log', {cwd: work});
  await waitFor('the CamusDB node', () => {
    const r = spawnSync('camus-cli', ['-e', 'SELECT 1'], {encoding: 'utf8'});
    return r.status === 0 && !/Exception/.test(r.stdout + r.stderr);
  }, 120_000);

  log('seeding the shop database');
  run('camus-cli', ['-e', 'CREATE DATABASE IF NOT EXISTS shop']);
  run('camus-cli', ['shop', '-f', path.join(here, 'seed.sql')]);

  if (wanted('webconsole')) {
    log('starting the web console');
    start('camusdb-webconsole', ['--endpoint', endpoint, '--database', 'shop', '--no-browser', '--port', '5164'], 'webconsole.log');
    await waitFor('the web console', async () => (await fetch(consoleUrl)).ok);
  }
}

async function setEditor(page, sql) {
  await page.evaluate((text) => window.monaco.editor.getEditors()[0].setValue(text), sql);
  // Blazor receives the change through a round trip; run only after it lands.
  await page.waitForTimeout(400);
}

async function runStatement(page) {
  const before = await page.locator('.status-bar').innerText();
  await page.locator('.run-btn').click();
  await page.waitForFunction((previous) => {
    const bar = document.querySelector('.status-bar');
    return bar && bar.innerText !== previous && /success|error/.test(bar.className);
  }, before);

  const failed = page.locator('.status-bar.error');
  if (await failed.count())
    throw new Error(`The web console query failed: ${await failed.innerText()}`);
  await page.waitForTimeout(500);
}

async function hideNoise(page) {
  await page.addStyleTag({content: `
    ::-webkit-scrollbar { display: none !important; }
    * { scrollbar-width: none !important; caret-color: transparent !important; }
  `});
}

// The console starts Blazor right after Monaco's AMD loader, which defines window.monaco
// asynchronously. On a warm server Blazor can win that race ("BlazorMonaco: monaco is undefined"),
// and the circuit drops. Hold the Blazor script until Monaco exists; retry as a backstop.
const webConsoleAttempts = 3;

async function holdBlazorUntilMonaco(page) {
  await page.route('**/_framework/blazor.web*.js', async (route) => {
    for (let i = 0; i < 100; i++) {
      if (await page.evaluate(() => !!window.monaco?.editor).catch(() => false))
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await route.continue();
  });
}

async function captureWebConsole(browser) {
  for (const theme of themes) {
    for (let attempt = 1; ; attempt++) {
      const context = await browser.newContext({viewport, deviceScaleFactor: scale, locale: 'en-US', colorScheme: theme});
      await context.addCookies([{name: 'camus-theme', value: theme, url: consoleUrl}]);
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      await holdBlazorUntilMonaco(page);
      try {
        await captureWebConsolePage(page, theme);
        break;
      } catch (error) {
        await page.screenshot({path: path.join(work, `webconsole-error-${theme}.png`)});
        if (attempt >= webConsoleAttempts)
          throw error;
        log(`web console ${theme} attempt ${attempt} failed, retrying: ${error.message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  }
}

async function captureWebConsolePage(page, theme) {
  await page.goto(consoleUrl);
  await page.locator('.run-btn').waitFor();
  await page.waitForFunction(() => window.monaco?.editor?.getEditors?.().length > 0);
  await hideNoise(page);

  // Expand one table so the schema explorer shows its columns.
  const orders = page.locator('.schema-node').filter({has: page.locator('.schema-node-label', {hasText: /^orders$/})});
  await orders.locator('.schema-expand-btn').click();
  await page.getByText('customer_id', {exact: true}).first().waitFor();

  await setEditor(page, querySql);
  await runStatement(page);
  await page.mouse.move(0, viewport.height - 1);
  await page.screenshot({path: path.join(raw, `webconsole-query-${theme}.png`)});

  await setEditor(page, planSql);
  await runStatement(page);
  await page.locator('.results-view-toggle button', {hasText: 'Flow'}).click();
  await page.locator('.results-view-toggle button.active', {hasText: 'Flow'}).waitFor();
  await page.waitForTimeout(500);
  await page.mouse.move(0, viewport.height - 1);
  await page.screenshot({path: path.join(raw, `webconsole-plan-${theme}.png`)});
}

async function captureDashboard(browser) {
  for (const theme of themes) {
    // The dashboard's content security policy blocks the injected style tag; bypass it in this
    // throwaway browser only.
    const context = await browser.newContext({
      viewport: {width: 1440, height: 1000}, deviceScaleFactor: scale, locale: 'en-US', colorScheme: theme, bypassCSP: true,
    });
    const page = await context.newPage();
    await page.goto(`${endpoint}/`);
    await page.getByText('Ready', {exact: true}).first().waitFor();
    await hideNoise(page);
    // The panels load on their own schedule; give the slowest one time to fill in.
    await page.waitForTimeout(3000);
    await page.screenshot({path: path.join(raw, `dashboard-${theme}.png`)});
    await context.close();
  }
}

function captureTape(name) {
  // A clean state folder keeps the user's history and TUI draft out of the capture.
  fs.rmSync(state, {recursive: true, force: true});
  fs.mkdirSync(path.join(state, 'camusdb'), {recursive: true, mode: 0o700});
  fs.writeFileSync(path.join(state, 'camusdb', 'query.sql'), tuiSql);

  run('vhs', [path.join(here, 'tapes', `${name}.tape`)], {
    cwd: raw,
    env: {...childEnv, XDG_STATE_HOME: state},
    stdio: 'ignore',
  });
}

async function frame(browser, shots) {
  const context = await browser.newContext({deviceScaleFactor: scale});
  const page = await context.newPage();
  await page.goto(`file://${path.join(here, 'frame.html')}`);

  for (const shot of shots) {
    const source = path.join(raw, `${shot.name}.png`);
    const src = `data:image/png;base64,${fs.readFileSync(source).toString('base64')}`;
    await page.evaluate((spec) => window.render(spec), {...shot, src, scale});

    const png = path.join(work, `${shot.name}.png`);
    await page.locator('#canvas').screenshot({path: png, omitBackground: true});

    const webp = path.join(outDir, `${shot.name}.webp`);
    run('cwebp', ['-quiet', '-q', '90', '-m', '6', png, '-o', webp]);
    if (keepPng)
      fs.copyFileSync(png, path.join(outDir, `${shot.name}.png`));
    log(`wrote ${path.relative(repo, webp)}`);
  }

  await context.close();
}

async function main() {
  requireTool('camusdb', 'Install it with: dotnet tool install -g CamusDB.Server');
  requireTool('camus-cli', 'Install it with: dotnet tool install -g CamusDB.SqlSh');
  if (wanted('webconsole'))
    requireTool('camusdb-webconsole', 'Install it with: dotnet tool install -g CamusDB.WebConsole');
  if (wanted('cli') || wanted('tui'))
    requireTool('vhs', 'Install it with: brew install vhs');
  requireTool('cwebp', 'Install it with: brew install webp');

  fs.mkdirSync(raw, {recursive: true});
  fs.mkdirSync(outDir, {recursive: true});

  await startStack();

  const browser = await chromium.launch();
  const shots = [];
  try {
    if (wanted('webconsole')) {
      log('capturing the web console');
      await captureWebConsole(browser);
      for (const theme of themes) {
        shots.push({name: `webconsole-query-${theme}`, kind: 'browser', theme, label: 'localhost:5164'});
        shots.push({name: `webconsole-plan-${theme}`, kind: 'browser', theme, label: 'localhost:5164'});
      }
    }

    if (wanted('dashboard')) {
      log('capturing the operator dashboard');
      await captureDashboard(browser);
      for (const theme of themes)
        shots.push({name: `dashboard-${theme}`, kind: 'browser', theme, label: 'localhost:5095'});
    }

    for (const [name, label] of [['cli', 'camus-cli shop'], ['tui', 'camus-cli shop --tui']]) {
      if (!wanted(name))
        continue;
      log(`recording the ${name} tape`);
      captureTape(name);
      shots.push({name, kind: 'terminal', theme: 'dark', label});
    }

    log('framing');
    await frame(browser, shots);
  } finally {
    await browser.close();
  }
}

process.on('SIGINT', () => { stopChildren(); process.exit(130); });

try {
  await main();
} catch (error) {
  console.error(`[screenshots] ${error.stack}`);
  console.error(`[screenshots] Logs are in ${path.relative(repo, work)}/`);
  process.exitCode = 1;
} finally {
  stopChildren();
}
