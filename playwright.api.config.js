// Browser checks for features that need Aangika's API (the community sign
// dictionary): the app is built with VITE_API_URL pointing at a local copy of
// the Worker (scripts/dev-api.mjs, in-memory storage).
//
//     npx playwright test -c playwright.api.config.js
import { defineConfig, devices } from '@playwright/test';

export const DEV_CODE = 'e2e-dev-code-4411';   // test-only code for the local API

export default defineConfig({
  testDir: './e2e-api',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4175',
    viewport: { width: 1280, height: 850 },
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 850 } } }],
  webServer: [
    {
      command: 'node scripts/dev-api.mjs',
      url: 'http://localhost:8787/health',
      env: { DEV_CODE, PORT: '8787' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx vite build --outDir dist-api && npx vite preview --outDir dist-api --port 4175 --strictPort',
      url: 'http://localhost:4175',
      env: { VITE_API_URL: 'http://localhost:8787' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
