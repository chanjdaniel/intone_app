import { defineConfig, devices } from '@playwright/test'

// The end-to-end tests run against the production build, served by
// `vite preview`. Build first: `npm run test:e2e` does both.
// E2E_PORT lets parallel checkouts on one machine use different ports.
const port = Number(process.env['E2E_PORT'] ?? 4173)

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI']
    ? [['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
})
