import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  use: {
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} } },
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
