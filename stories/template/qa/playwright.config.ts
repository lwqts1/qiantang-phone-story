import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'story.spec.ts',
  timeout: 60000,
  workers: 1,
  reporter: 'list',
  outputDir: '../../../test-results/qiantang',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: process.env.STORY_BROWSER === 'chromium' ? undefined : 'msedge',
    headless: true,
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'npm run story:preview',
    cwd: '../../..',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
