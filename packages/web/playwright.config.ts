import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 } },
  use: {
    baseURL: 'http://127.0.0.1:4178',
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'bun run dev --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop-light', testIgnore: /mobile\.visual\.spec\.ts/, use: { ...devices['Desktop Chrome'], colorScheme: 'light', viewport: { width: 1440, height: 1000 } } },
    { name: 'desktop-dark', testIgnore: /mobile\.visual\.spec\.ts/, use: { ...devices['Desktop Chrome'], colorScheme: 'dark', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-light', testMatch: /mobile\.visual\.spec\.ts/, use: { ...devices['iPhone 13'], colorScheme: 'light' } },
    { name: 'mobile-dark', testMatch: /mobile\.visual\.spec\.ts/, use: { ...devices['iPhone 13'], colorScheme: 'dark' } },
  ],
});
