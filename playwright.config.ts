import { defineConfig, devices } from '@playwright/test';

/**
 * Main end-to-end suite (e2e/): the builder as a static website — `npm run build:static` (no HubSpot
 * connector, so the builder never calls /api) served by `vite preview`. Connect HubSpot shows
 * "available on the hosted version".
 *
 * The "Connect HubSpot" suite (e2e-connect/, production server + fake HubSpot) has its own config:
 * playwright.connect.config.ts, run with `npm run e2e:connect`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'npm run build:static && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
