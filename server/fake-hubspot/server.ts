/**
 * Fake HubSpot over HTTP, for trying "Connect HubSpot" locally without a HubSpot account
 * (`npm run dev:full`) and for end-to-end tests.
 *
 * One node:http server answers both HubSpot hosts the connector talks to:
 *   - the app host (browser-facing): GET /oauth/authorize — the consent page
 *   - the API host (server-to-server): /oauth/v1/*, /crm/v3/*, /crm/v4/*, developer-project endpoints
 * so point both HUBSPOT_APP_BASE and HUBSPOT_API_BASE at it (default http://localhost:4010).
 *
 * Env (CLI): FAKE_HUBSPOT_PORT (4010), FAKE_HUBSPOT_HOST (127.0.0.1), FAKE_HUBSPOT_CLIENT_ID,
 * FAKE_HUBSPOT_CLIENT_SECRET, FAKE_HUBSPOT_PORTAL_ID, FAKE_HUBSPOT_AUTO_APPROVE, FAKE_HUBSPOT_QUIET.
 */
import { createServer, type Server } from 'node:http';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createFakeHubSpot, FAKE_PERSONAL_ACCESS_KEY, type FakeHubSpotControls } from './handler';
import { BodyTooLargeError, toWebRequest, tuneServer, writeWebResponse } from '../node';

/** Replaced by scripts/build-server.mjs (esbuild `define`). */
declare const __UIEX_BUNDLED__: boolean | undefined;

export const FAKE_HUBSPOT_DEFAULT_PORT = 4010;
export const DEMO_CLIENT_ID = 'uiex-demo-client-id';
export const DEMO_CLIENT_SECRET = 'uiex-demo-client-secret';
export const DEMO_PORTAL_ID = 12345678;

export interface FakeHubSpotServerOptions {
  /** 0 picks a free port. Default 4010. */
  port?: number;
  /** Default 127.0.0.1 (never exposed to the network by default). */
  host?: string;
  clientId?: string;
  clientSecret?: string;
  portalId?: number;
  /** Skip the consent page (tests). */
  autoApprove?: boolean;
  log?: (line: string) => void;
}

export interface RunningFakeHubSpot {
  server: Server;
  /** The fake itself, with test controls (expire tokens, drop scopes, inject failures …). */
  fake: FakeHubSpotControls;
  /** e.g. http://127.0.0.1:4010 — use as HUBSPOT_API_BASE and HUBSPOT_APP_BASE. */
  url: string;
  port: number;
  clientId: string;
  clientSecret: string;
  close(): Promise<void>;
}

const HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

export async function startFakeHubSpotServer(opts: FakeHubSpotServerOptions = {}): Promise<RunningFakeHubSpot> {
  const clientId = opts.clientId ?? DEMO_CLIENT_ID;
  const clientSecret = opts.clientSecret ?? DEMO_CLIENT_SECRET;
  const fake = createFakeHubSpot({ clientId, clientSecret, portalId: opts.portalId ?? DEMO_PORTAL_ID, autoApprove: opts.autoApprove });
  const host = opts.host ?? '127.0.0.1';
  const log = opts.log;

  let selfOrigin = `http://${host}`;
  const server = tuneServer(
    createServer((req, res) => {
      // The browser reaches the consent page via whatever host name it used (localhost vs 127.0.0.1),
      // so build URLs on the Host header when it looks sane. Dev/test only.
      const hostHeader = req.headers.host;
      const origin = hostHeader && HOST_RE.test(hostHeader) ? `http://${hostHeader}` : selfOrigin;
      (async () => {
        let request: Request;
        try {
          request = await toWebRequest(req, { origin, bodyLimit: 50 * 1024 * 1024 });
        } catch (err) {
          const status = err instanceof BodyTooLargeError ? 413 : 400;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: status === 413 ? 'Body too large' : 'Bad request', category: 'VALIDATION_ERROR' }));
          return;
        }
        const response = await fake.handle(request);
        const logged = new URL(request.url).pathname.replace(/(\/(?:access|refresh)-tokens\/)[^/]+/, '$1[redacted]');
        log?.(`[fake-hubspot] ${req.method} ${logged} ${response.status}`);
        await writeWebResponse(res, response, { head: req.method === 'HEAD' });
      })().catch((err: unknown) => {
        log?.(`[fake-hubspot] ${req.method} ${req.url?.split('?')[0]} crashed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Fake HubSpot crashed', category: 'INTERNAL_ERROR' }));
        } else {
          res.destroy();
        }
      });
    }),
  );

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? FAKE_HUBSPOT_DEFAULT_PORT, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? FAKE_HUBSPOT_DEFAULT_PORT);
  const urlHost = host.includes(':') ? `[${host}]` : host;
  selfOrigin = `http://${urlHost}:${port}`;

  return {
    server,
    fake,
    url: selfOrigin,
    port,
    clientId,
    clientSecret,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** CLI entry: `node dist-server/fake-hubspot.mjs` (or `tsx server/fake-hubspot/server.ts`). */
export function runFakeHubSpotCli(env: Record<string, string | undefined> = process.env): void {
  const port = Number(env.FAKE_HUBSPOT_PORT || FAKE_HUBSPOT_DEFAULT_PORT);
  startFakeHubSpotServer({
    port,
    host: env.FAKE_HUBSPOT_HOST || '127.0.0.1',
    clientId: env.FAKE_HUBSPOT_CLIENT_ID || DEMO_CLIENT_ID,
    clientSecret: env.FAKE_HUBSPOT_CLIENT_SECRET || DEMO_CLIENT_SECRET,
    portalId: env.FAKE_HUBSPOT_PORTAL_ID ? Number(env.FAKE_HUBSPOT_PORTAL_ID) : DEMO_PORTAL_ID,
    autoApprove: /^(1|true|yes)$/i.test(env.FAKE_HUBSPOT_AUTO_APPROVE ?? ''),
    log: env.FAKE_HUBSPOT_QUIET ? undefined : (line) => console.log(line),
  })
    .then((running) => {
      console.log(`Fake HubSpot is running at ${running.url} (demo portal ${env.FAKE_HUBSPOT_PORTAL_ID || DEMO_PORTAL_ID}).`);
      console.log(`  Use HUBSPOT_API_BASE=${running.url} HUBSPOT_APP_BASE=${running.url}`);
      console.log(`  HUBSPOT_CLIENT_ID=${running.clientId} HUBSPOT_CLIENT_SECRET=<demo secret>`);
      console.log(`  Demo personal access key for "Publish to HubSpot": ${FAKE_PERSONAL_ACCESS_KEY}`);
      const stop = () => {
        void running.close().then(() => process.exit(0));
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
    })
    .catch((err: unknown) => {
      console.error(`Could not start the fake HubSpot server: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}

function isDirectRun(): boolean {
  if (typeof __UIEX_BUNDLED__ !== 'undefined' && __UIEX_BUNDLED__) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) runFakeHubSpotCli();
