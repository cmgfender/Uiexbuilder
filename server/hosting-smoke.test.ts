// @vitest-environment node
/**
 * Smoke test of the hosted setup: the fake HubSpot server and the production Node server run on
 * random ports, and a plain fetch client with a hand-made cookie jar signs in end to end
 * (authorize → consent auto-approved → callback → session cookie → CRM data → sign out).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, type RunningServer } from './node';
import { DEMO_CLIENT_ID, DEMO_CLIENT_SECRET, DEMO_PORTAL_ID, startFakeHubSpotServer, type RunningFakeHubSpot } from './fake-hubspot/server';
import { CONNECTOR_ROUTES, CSRF_HEADER, type ConnectionInfo, type ConnectorHealth, type CrmObjectTypeInfo, type CrmRecord, type CrmRecordSummary } from '../src/connect/types';

/** Minimal cookie jar: name → value, honouring deletions (Max-Age=0 / past Expires). */
class CookieJar {
  private cookies = new Map<string, string>();
  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attrs] = header.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => {
        const [k, v = ''] = a.trim().split('=');
        if (k.toLowerCase() === 'max-age') return Number(v) <= 0;
        if (k.toLowerCase() === 'expires') return Date.parse(v) <= Date.now();
        return false;
      });
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get size(): number {
    return this.cookies.size;
  }
}

describe('hosted connector smoke test (Node server + fake HubSpot)', () => {
  let fake: RunningFakeHubSpot;
  let app: RunningServer;
  let distDir: string;
  const logs: string[] = [];
  const sessionSecret = 'smoke-test-session-secret-0123456789-abcdefghij';
  const jar = new CookieJar();

  const call = async (url: string, init: RequestInit & { api?: boolean } = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (jar.size > 0) headers.set('cookie', jar.header());
    if (init.api) {
      headers.set(CSRF_HEADER, '1');
      headers.set('origin', app.config.appUrl);
    }
    const res = await fetch(url, { ...init, headers, redirect: 'manual' });
    jar.store(res);
    return res;
  };
  const api = (route: string, init: RequestInit = {}) => call(`${app.url}${route}`, { ...init, api: true });

  beforeAll(async () => {
    distDir = mkdtempSync(path.join(tmpdir(), 'uiex-smoke-'));
    mkdirSync(path.join(distDir, 'assets'));
    writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>UI Extension Builder</title>');

    fake = await startFakeHubSpotServer({ port: 0, autoApprove: true });
    app = await startServer({
      argv: ['--port', '0', '--static', distDir],
      env: {
        NODE_ENV: 'test',
        HUBSPOT_CLIENT_ID: DEMO_CLIENT_ID,
        HUBSPOT_CLIENT_SECRET: DEMO_CLIENT_SECRET,
        SESSION_SECRET: sessionSecret,
        HUBSPOT_API_BASE: fake.url,
        HUBSPOT_APP_BASE: fake.url,
        LOG_REQUESTS: '0',
      },
      handleSignals: false,
      log: (line) => logs.push(line),
    });
  });

  afterAll(async () => {
    await app?.close();
    await fake?.close();
    rmSync(distDir, { recursive: true, force: true });
  });

  it('logs what is configured, including the exact redirect URL, but no secrets', () => {
    const text = logs.join('\n');
    expect(app.config.appUrl).toBe(app.url);
    expect(text).toContain(`${app.url}/api/auth/callback`);
    expect(text).toContain('HubSpot sign-in:  ready');
    expect(text).not.toContain(DEMO_CLIENT_SECRET);
    expect(text).not.toContain(sessionSecret);
  });

  it('answers a plain health check (as Render / Docker send it) and serves the app', async () => {
    const res = await fetch(`${app.url}${CONNECTOR_ROUTES.health}`);
    expect(res.status).toBe(200);
    const health = (await res.json()) as ConnectorHealth;
    expect(health).toMatchObject({ ok: true, oauthConfigured: true });
    expect(health.scopes.required).toContain('oauth');

    const page = await fetch(`${app.url}/projects/demo`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('UI Extension Builder');
  });

  it('signs in with HubSpot end to end and reads CRM data', async () => {
    const before = (await (await api(CONNECTOR_ROUTES.me)).json()) as ConnectionInfo;
    expect(before.connected).toBe(false);

    // 1. The popup opens /api/auth/start → redirect to HubSpot's consent page.
    const start = await call(`${app.url}${CONNECTOR_ROUTES.authStart}?returnTo=${encodeURIComponent(app.config.appUrl)}`);
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${fake.url}/oauth/authorize`);
    expect(authorize.searchParams.get('client_id')).toBe(DEMO_CLIENT_ID);
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${app.config.appUrl}/api/auth/callback`);
    expect(authorize.searchParams.get('scope')?.split(' ')).toContain('oauth');
    expect(authorize.searchParams.get('state')).toBeTruthy();

    // 2. HubSpot (auto-approve) redirects back to the callback with a code.
    const consent = await call(authorize.toString());
    expect(consent.status).toBe(302);
    const callback = new URL(consent.headers.get('location') ?? '');
    expect(`${callback.origin}${callback.pathname}`).toBe(`${app.config.appUrl}/api/auth/callback`);
    expect(callback.searchParams.get('code')).toBeTruthy();

    // 3. The callback exchanges the code and sets the encrypted session cookie.
    const done = await call(callback.toString(), { headers: { accept: 'text/html' } });
    expect(done.status).toBe(200);
    expect(done.headers.get('content-type')).toContain('text/html');
    expect(jar.header()).not.toContain('access_token');

    // 4. The builder is now connected.
    const me = (await (await api(CONNECTOR_ROUTES.me)).json()) as ConnectionInfo;
    expect(me.connected).toBe(true);
    if (me.connected) {
      expect(me.portalId).toBe(DEMO_PORTAL_ID);
      expect(me.scopes).toContain('crm.objects.contacts.read');
    }

    // 5. Real (fake) CRM data flows through the Node adapter.
    const typesRes = await api(CONNECTOR_ROUTES.objectTypes);
    expect(typesRes.status).toBe(200);
    const types = (await typesRes.json()) as CrmObjectTypeInfo[];
    expect(types.map((t) => t.objectType)).toContain('contacts');

    const found = (await (await api(`${CONNECTOR_ROUTES.searchRecords.replace(':objectType', 'contacts')}?limit=5`)).json()) as CrmRecordSummary[];
    expect(found.length).toBeGreaterThan(0);
    const recordRes = await api(`${CONNECTOR_ROUTES.record.replace(':objectType', 'contacts').replace(':id', found[0].id)}?properties=firstname,email`);
    expect(recordRes.status).toBe(200);
    const record = (await recordRes.json()) as CrmRecord;
    expect(record.id).toBe(found[0].id);
    expect(Object.keys(record.properties)).toContain('email');
  });

  it('refuses API calls without the builder header, and signs out', async () => {
    const forged = await call(`${app.url}${CONNECTOR_ROUTES.me}`);
    expect(forged.status).toBe(403);

    const out = await api(CONNECTOR_ROUTES.logout, { method: 'POST' });
    expect(out.status).toBe(200);
    const after = (await (await api(CONNECTOR_ROUTES.me)).json()) as ConnectionInfo;
    expect(after.connected).toBe(false);
  });
});
