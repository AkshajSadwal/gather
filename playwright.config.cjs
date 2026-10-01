const { defineConfig } = require('@playwright/test');

const configuredChrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const chrome = configuredChrome || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      ...(configuredChrome || process.platform === 'win32' ? { executablePath: chrome } : {}),
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
