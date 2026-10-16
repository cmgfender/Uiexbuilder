import { defineConfig, devices } from '@playwright/test';

/**
 * "Connect HubSpot" end-to-end suite (e2e-connect/): the production build served by the real Node
 * server with the HubSpot connector, signed in to the FAKE HubSpot portal (consent page, CRM data,
 * developer projects). Run with `npm run e2e:connect`.
 *
 * The web server is `scripts/dev.mjs --fake --prod` (what `npm run start:demo` runs) on its own
 * ports, so it never collides with the main suite (vite preview on :4173) or a demo you have open.
 *
 * Screenshots of the main screens are written when CONNECT_SCREENSHOTS=<directory> is set.
 */
const DEMO_PORT = Number(process.env.UIEX_E2E_CONNECT_PORT || 4175);
const FAKE_PORT = Number(process.env.UIEX_E2E_FAKE_PORT || 4011);
const CONNECT_BASE_URL = `http://localhost:${DEMO_PORT}`;

export default defineConfig({
  testDir: './e2e-connect',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: CONNECT_BASE_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'connect', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Builds the app (dist/), then serves it with the connector + fake HubSpot.
    command: 'npm run build:app && node scripts/dev.mjs --fake --prod',
    url: `${CONNECT_BASE_URL}/api/health`,
    env: { UIEX_DEMO_PORT: String(DEMO_PORT), FAKE_HUBSPOT_PORT: String(FAKE_PORT), LOG_REQUESTS: '0' },
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
