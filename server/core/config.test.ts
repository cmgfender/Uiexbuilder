// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkConfig, configFromEnv, DEFAULT_OPTIONAL_SCOPES, DEFAULT_REQUIRED_SCOPES, isLocalAppUrl, normalizeOrigin, notConfiguredMessage, parseBool, parseScopeList } from './config';
import { createConnector } from './index';

const FULL = {
  APP_URL: 'https://builder.example.com/',
  HUBSPOT_CLIENT_ID: 'cid',
  HUBSPOT_CLIENT_SECRET: 'csecret',
  SESSION_SECRET: 's'.repeat(32),
};

describe('configFromEnv', () => {
  it('reads a complete environment with defaults', () => {
    const c = configFromEnv(FULL);
    expect(c.appUrl).toBe('https://builder.example.com');
    expect(c.secureCookies).toBe(true);
    expect(c.requiredScopes).toEqual(DEFAULT_REQUIRED_SCOPES);
    expect(c.optionalScopes).toEqual(DEFAULT_OPTIONAL_SCOPES);
    expect(c.hubspotApiBase).toBe('https://api.hubapi.com');
    expect(c.hubspotAppBase).toBe('https://app.hubspot.com');
    expect(c.enableFetchProxy).toBe(true);
    expect(c.enableDeploy).toBe(true);
    expect(c.allowedOrigins).toEqual([]);
    expect(typeof c.fetch).toBe('function');
    expect(typeof c.now()).toBe('number');
    expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(checkConfig(c)).toEqual({ oauthConfigured: true, missing: [] });
  });

  it('normalises APP_URL to its origin and decides Secure cookies from the scheme', () => {
    expect(configFromEnv({ ...FULL, APP_URL: 'https://x.example.com/some/path?q=1' }).appUrl).toBe('https://x.example.com');
    const local = configFromEnv({ ...FULL, APP_URL: 'http://localhost:5173/' });
    expect(local.appUrl).toBe('http://localhost:5173');
    expect(local.secureCookies).toBe(false);
  });

  it('defaults APP_URL to the dev server outside production and leaves it empty in production', () => {
    const { APP_URL: _ignored, ...rest } = FULL;
    void _ignored;
    expect(configFromEnv(rest).appUrl).toBe('http://localhost:5173');
    const prod = configFromEnv({ ...rest, NODE_ENV: 'production' });
    expect(prod.appUrl).toBe('');
    expect(checkConfig(prod).missing.map((m) => m.name)).toEqual(['APP_URL']);
  });

  it('parses scope lists (commas or spaces), always requires oauth and removes duplicates', () => {
    const c = configFromEnv({ ...FULL, HUBSPOT_SCOPES: 'crm.objects.contacts.read, crm.objects.contacts.read crm.schemas.contacts.read', HUBSPOT_OPTIONAL_SCOPES: 'tickets,crm.schemas.contacts.read' });
    expect(c.requiredScopes).toEqual(['oauth', 'crm.objects.contacts.read', 'crm.schemas.contacts.read']);
    expect(c.optionalScopes).toEqual(['tickets']);
    expect(configFromEnv({ ...FULL, HUBSPOT_OPTIONAL_SCOPES: 'none' }).optionalScopes).toEqual([]);
    expect(configFromEnv({ ...FULL, HUBSPOT_OPTIONAL_SCOPES: '' }).optionalScopes).toEqual(DEFAULT_OPTIONAL_SCOPES);
    expect(parseScopeList('a b,c <script>')).toEqual(['a', 'b', 'c']);
  });

  it('parses feature flags and allowed origins', () => {
    const c = configFromEnv({ ...FULL, ENABLE_FETCH_PROXY: 'false', ENABLE_DEPLOY: '0', ALLOWED_ORIGINS: 'https://a.example.com/, https://b.example.com,not a url,*' });
    expect(c.enableFetchProxy).toBe(false);
    expect(c.enableDeploy).toBe(false);
    expect(c.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com']);
    expect(parseBool('yes', false)).toBe(true);
    expect(parseBool('weird', true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
  });

  it('accepts EU / test API bases and strips trailing slashes', () => {
    const c = configFromEnv({ ...FULL, HUBSPOT_API_BASE: 'https://api-eu1.hubapi.com/', HUBSPOT_APP_BASE: 'http://localhost:4010/' });
    expect(c.hubspotApiBase).toBe('https://api-eu1.hubapi.com');
    expect(c.hubspotAppBase).toBe('http://localhost:4010');
    expect(configFromEnv({ ...FULL, HUBSPOT_API_BASE: 'ftp://nope' }).hubspotApiBase).toBe('https://api.hubapi.com');
  });

  it('applies overrides last (and recomputes Secure from an overridden appUrl)', () => {
    const fetchFn = (async () => new Response('x')) as typeof fetch;
    const c = configFromEnv(FULL, { appUrl: 'http://localhost:3000/', fetch: fetchFn, allowedOrigins: ['https://z.example.com/'] });
    expect(c.appUrl).toBe('http://localhost:3000');
    expect(c.secureCookies).toBe(false);
    expect(c.fetch).toBe(fetchFn);
    expect(c.allowedOrigins).toEqual(['https://z.example.com']);
    expect(configFromEnv(FULL, { secureCookies: false }).secureCookies).toBe(false);
  });
});

describe('checkConfig', () => {
  it('lists every missing variable', () => {
    const status = checkConfig(configFromEnv({}));
    expect(status.oauthConfigured).toBe(false);
    expect(status.missing.map((m) => m.name)).toEqual(['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'SESSION_SECRET']);
    expect(notConfiguredMessage(status)).toMatch(/HUBSPOT_CLIENT_ID.*HUBSPOT_CLIENT_SECRET.*SESSION_SECRET/);
  });

  it('treats a SESSION_SECRET shorter than 32 characters as not configured', () => {
    const status = checkConfig(configFromEnv({ ...FULL, SESSION_SECRET: 'short' }));
    expect(status.oauthConfigured).toBe(false);
    expect(status.missing).toEqual([{ name: 'SESSION_SECRET', reason: expect.stringContaining('too short') }]);
  });
});

describe('helpers', () => {
  it('normalizeOrigin', () => {
    expect(normalizeOrigin(' https://A.example.com:443/x ')).toBe('https://a.example.com');
    expect(normalizeOrigin('javascript:alert(1)')).toBe('');
    expect(normalizeOrigin('')).toBe('');
  });
  it('isLocalAppUrl', () => {
    expect(isLocalAppUrl('http://localhost:5173')).toBe(true);
    expect(isLocalAppUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalAppUrl('https://builder.example.com')).toBe(false);
  });
});

describe('not configured connector', () => {
  const connector = createConnector(configFromEnv({ APP_URL: 'https://b.example.com' }));
  const req = (path: string, init: RequestInit = {}) =>
    connector.handle(new Request(`https://b.example.com${path}`, { ...init, headers: { 'X-UIEX-Request': '1', ...(init.headers as Record<string, string>) } }));

  it('still answers health with oauthConfigured false', async () => {
    const res = (await req('/api/health'))!;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, oauthConfigured: false, features: { crm: false, fetchProxy: false, deploy: true } });
    expect(body.scopes.required).toContain('oauth');
  });

  it('answers auth routes with 503 not_configured naming the missing variables', async () => {
    const json = (await req('/api/auth/logout', { method: 'POST' }))!;
    expect(json.status).toBe(503);
    const body = await json.json();
    expect(body.error.code).toBe('not_configured');
    expect(body.error.message).toContain('HUBSPOT_CLIENT_ID');
    expect(body.error.message).toContain('SESSION_SECRET');

    const page = (await req('/api/auth/start?returnTo=https://b.example.com', { headers: { Accept: 'text/html' } }))!;
    expect(page.status).toBe(503);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain('HUBSPOT_CLIENT_SECRET');
    expect(html).toContain('not_configured');

    const cb = (await req('/api/auth/callback?code=x&state=y', { headers: { Accept: 'text/html' } }))!;
    expect(cb.status).toBe(503);
  });

  it('reports signed out on /api/me and 503 on CRM routes', async () => {
    expect(await (await req('/api/me'))!.json()).toEqual({ connected: false, reason: 'signed-out' });
    const crm = (await req('/api/crm/object-types'))!;
    expect(crm.status).toBe(503);
    expect((await crm.json()).error.code).toBe('not_configured');
  });
});
