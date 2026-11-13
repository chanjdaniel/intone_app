import { defineConfig, devices } from '@playwright/test'

import { appPort, probePort } from './tests/e2e/ports.ts'

// The end-to-end tests run against the production build, served by
// `vite preview`. Build first: `npm run test:e2e` does both. The
// fake-microphone probe, a test-only page, is built and served apart.
const probeConfig = 'tests/e2e/probe/vite.config.ts'
// The specs that time the page itself, run alone (below).
const timingSpecs = /(frame-rate|live-curve)\.spec\.ts$/

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: timingSpecs,
      use: { ...devices['Desktop Chrome'] },
    },
    // The frame-rate and live-curve tests measure the page's own timing,
    // so they run after every other test has finished, one at a time.
    // Run them by themselves with
    // `npx playwright test --project timing --no-deps`.
    {
      name: 'timing',
      testMatch: timingSpecs,
      dependencies: ['chromium'],
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `npx vite preview --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: false,
    },
    {
      command: `npx vite build --config ${probeConfig} && npx vite preview --config ${probeConfig} --host 127.0.0.1 --port ${probePort} --strictPort`,
      url: `http://127.0.0.1:${probePort}`,
      reuseExistingServer: false,
    },
  ],
})
