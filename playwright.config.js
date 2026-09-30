// Browser checks against the PRODUCTION build (vite preview), so the service
// worker, precache and offline model cache behave as they do when deployed.
// Chrome's fake camera provides frames (a test pattern: no real hands), which
// proves the camera -> landmarks -> engine loop runs, not recognition accuracy.
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 850 },
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    serviceWorkers: 'allow',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /speech\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 850 } },
    },
    {
      // The microphone "hears" a Hindi recording (scripts/fixtures/speech),
      // for offline speech-to-text.
      name: 'speech',
      testMatch: /speech\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 850 },
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
            `--use-file-for-fake-audio-capture=${resolve('scripts/fixtures/speech/hi_water.wav')}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
