const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: {timeout: 30_000},
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    viewport: {width: 1440, height: 1050},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run serve -- --host 127.0.0.1 --port 3100 --no-open',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: !process.env.CI,
  },
});
