/// <reference types="vitest/config" />
import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import type { ServerResponse } from 'node:http';

/**
 * Dev only: /api goes to the HubSpot connector that `npm run dev` / `npm run dev:full` start on
 * 127.0.0.1:3001 (scripts/dev.mjs). When it is not running (e.g. plain `vite`), /api answers a
 * 503 JSON error so the builder shows "Connect HubSpot" as unavailable instead of hanging.
 */
const apiProxy: ProxyOptions = {
  target: `http://127.0.0.1:${process.env.UIEX_API_PORT || 3001}`,
  changeOrigin: false,
  xfwd: true,
  configure(proxy) {
    proxy.on('error', (_err, _req, res) => {
      const out = res as ServerResponse;
      if (typeof out.writeHead !== 'function' || out.headersSent) {
        out.destroy?.();
        return;
      }
      out.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      out.end(
        JSON.stringify({
          error: {
            code: 'connector_offline',
            message: 'The HubSpot connector is not running. Start the builder with "npm run dev" (or "npm run dev:full" for demo data).',
            status: 503,
          },
        }),
      );
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy: { '/api': apiProxy } },
  // `vite preview` (used by the Playwright suite) behaves like static hosting: no connector.
  preview: { port: 4173, host: true, proxy: {} },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 60000,
  },
});
