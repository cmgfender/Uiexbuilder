/**
 * Test harness: a connector wired to the fake HubSpot with a controllable clock and a cookie jar.
 * Used by the server tests (and available to other server modules' tests, e.g. deploy).
 *
 *   const env = createTestEnv();
 *   await env.signIn();
 *   const res = await env.call('/api/crm/object-types');
 */
import { createFakeHubSpot, type FakeHubSpotControls, type FakeHubSpotOptions } from '../fake-hubspot/handler';
import { configFromEnv } from './config';
import { createConnector, type Connector, type ConnectorOptions } from './index';
import { CSRF_HEADER } from '../../src/connect/types';
import type { ServerConfig } from './types';

export const TEST_APP_URL = 'https://builder.example.test';
export const TEST_CLIENT_ID = 'test-client-id';
export const TEST_CLIENT_SECRET = 'test-client-secret-value';
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
export const TEST_API_BASE = 'https://api.hubapi.com';
export const TEST_APP_BASE = 'https://app.hubspot.com';
export const TEST_START_TIME = Date.parse('2025-06-01T12:00:00.000Z');

interface StoredCookie {
  value: string;
  path: string;
}

/** Minimal cookie jar honouring Max-Age=0 deletion and Path scoping. */
export class CookieJar {
  readonly cookies = new Map<string, StoredCookie>();

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attrs] = header.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let path = '/';
      let remove = false;
      for (const a of attrs) {
        const [k, v] = a.split('=');
        if (k.toLowerCase() === 'path') path = v ?? '/';
        if (k.toLowerCase() === 'max-age' && Number(v) <= 0) remove = true;
      }
      if (remove || value === '') this.cookies.delete(name);
      else this.cookies.set(name, { value, path });
    }
  }

  header(pathname: string): string {
    return [...this.cookies.entries()]
      .filter(([, c]) => pathname === c.path || pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/')
      .map(([n, c]) => `${n}=${c.value}`)
      .join('; ');
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  set(name: string, value: string, path = '/'): void {
    this.cookies.set(name, { value, path });
  }
}

export interface CallInit {
  method?: string;
  headers?: Record<string, string>;
  /** JSON body. */
  json?: unknown;
  body?: string;
  /** Send the X-UIEX-Request header (default true). */
  csrf?: boolean;
  /** Origin header (default: none, like a same-origin GET). */
  origin?: string;
  /** Use the cookie jar (default true). */
  cookies?: boolean;
}

export interface TestEnv {
  fake: FakeHubSpotControls;
  config: ServerConfig;
  connector: Connector;
  jar: CookieJar;
  now(): number;
  advance(ms: number): void;
  /** Requests to non-HubSpot hosts go here (proxy tests). */
  setExternalFetch(fn: typeof fetch | null): void;
  call(pathAndQuery: string, init?: CallInit): Promise<Response>;
  /** Runs the whole popup sign-in (start → fake consent → callback). Returns the callback response. */
  signIn(opts?: { returnTo?: string; mode?: 'popup' | 'redirect' }): Promise<Response>;
  logs: string[];
}

export function createTestEnv(
  opts: {
    env?: Record<string, string | undefined>;
    config?: Partial<ServerConfig>;
    fake?: Partial<FakeHubSpotOptions>;
    connector?: ConnectorOptions;
  } = {},
): TestEnv {
  let clock = TEST_START_TIME;
  const now = () => clock;
  const fake = createFakeHubSpot({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, now, ...opts.fake });
  let external: typeof fetch | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === TEST_API_BASE || url.origin === TEST_APP_BASE) return fake.fetch(input, init);
    if (external) return external(input, init);
    throw new TypeError('fetch failed (no network in tests)');
  };
  const config = configFromEnv(
    {
      APP_URL: TEST_APP_URL,
      HUBSPOT_CLIENT_ID: TEST_CLIENT_ID,
      HUBSPOT_CLIENT_SECRET: TEST_CLIENT_SECRET,
      SESSION_SECRET: TEST_SESSION_SECRET,
      HUBSPOT_API_BASE: TEST_API_BASE,
      HUBSPOT_APP_BASE: TEST_APP_BASE,
      ...opts.env,
    },
    { fetch: fetchImpl, now, ...opts.config },
  );
  const logs: string[] = [];
  const connector = createConnector(config, { hubspot: { sleep: async () => {} }, log: (m) => logs.push(m), ...opts.connector });
  const jar = new CookieJar();

  async function call(pathAndQuery: string, init: CallInit = {}): Promise<Response> {
    const url = new URL(pathAndQuery, config.appUrl || TEST_APP_URL);
    const headers: Record<string, string> = { ...init.headers };
    if (init.csrf !== false) headers[CSRF_HEADER] = '1';
    if (init.origin) headers.Origin = init.origin;
    if (init.cookies !== false) {
      const cookie = jar.header(url.pathname);
      if (cookie) headers.Cookie = cookie;
    }
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['Content-Type'] = 'application/json';
    }
    const res = await connector.handle(new Request(url, { method: init.method ?? (body !== undefined ? 'POST' : 'GET'), headers, body }));
    if (!res) throw new Error(`not an API route: ${pathAndQuery}`);
    if (init.cookies !== false) jar.store(res);
    return res;
  }

  async function signIn(o: { returnTo?: string; mode?: 'popup' | 'redirect' } = {}): Promise<Response> {
    const q = new URLSearchParams({ returnTo: o.returnTo ?? (config.appUrl || TEST_APP_URL) });
    if (o.mode) q.set('mode', o.mode);
    const start = await call(`/api/auth/start?${q}`, { csrf: false, headers: { Accept: 'text/html' } });
    if (start.status !== 302) throw new Error(`auth/start answered ${start.status}`);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('auto', '1');
    const consent = await fake.fetch(authorize.toString());
    const back = new URL(consent.headers.get('location')!);
    return call(`${back.pathname}${back.search}`, { csrf: false, headers: { Accept: 'text/html' } });
  }

  return {
    fake,
    config,
    connector,
    jar,
    now,
    advance: (ms) => {
      clock += ms;
    },
    setExternalFetch: (fn) => {
      external = fn;
    },
    call,
    signIn,
    logs,
  };
}
