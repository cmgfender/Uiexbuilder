import { readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * "Connect HubSpot" end-to-end specs (e2e/connect*.spec.ts) run in their own project against the
 * production server + fake HubSpot (`npm run start:demo`, http://localhost:4174). The project and
 * its server are only added when such specs exist, so the main suite is unaffected.
 */
const CONNECT_SPEC = /connect.*\.spec\.ts$/;
const hasConnectSpecs = (() => {
  try {
    return readdirSync('./e2e').some((f) => CONNECT_SPEC.test(f));
  } catch {
    return false;
  }
})();

const mainServer = {
  command: 'npm run build && npm run preview',
  url: 'http://localhost:4173',
  reuseExistingServer: true,
  timeout: 180_000,
};

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
  projects: [
    { name: 'chromium', testIgnore: CONNECT_SPEC, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    ...(hasConnectSpecs
      ? [
          {
            name: 'connect',
            testMatch: CONNECT_SPEC,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://localhost:4174' },
          },
        ]
      : []),
  ],
  webServer: hasConnectSpecs
    ? [
        mainServer,
        {
          // Waits for the build above (dist/), then serves it with the connector + fake HubSpot.
          command: 'npm run start:demo',
          url: 'http://localhost:4174/api/health',
          reuseExistingServer: true,
          timeout: 300_000,
        },
      ]
    : mainServer,
});
