// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTestEnv, TEST_APP_URL, TEST_CLIENT_ID, TEST_APP_BASE } from './testing';
import { appHostFor } from './oauth';
import { OAUTH_COOKIE, SESSION_COOKIE } from './session';
import { sha256Base64 } from './crypto';

const html = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

async function startFlow(env: ReturnType<typeof createTestEnv>, query = `returnTo=${encodeURIComponent(TEST_APP_URL)}`) {
  const res = await env.call(`/api/auth/start?${query}`, { csrf: false, headers: html });
  return res;
}

function inlineScript(page: string): string {
  return /<script>([\s\S]*?)<\/script>/.exec(page)![1];
}

describe('GET /api/auth/start', () => {
  it('redirects to the HubSpot authorize URL with client id, redirect uri, scopes and state', async () => {
    const env = createTestEnv();
    const res = await startFlow(env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${TEST_APP_BASE}/oauth/authorize`);
    expect(loc.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(loc.searchParams.get('redirect_uri')).toBe(`${TEST_APP_URL}/api/auth/callback`);
    expect(loc.searchParams.get('scope')).toBe(env.config.requiredScopes.join(' '));
    expect(loc.searchParams.get('optional_scope')).toBe(env.config.optionalScopes.join(' '));
    expect(loc.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Spaces are percent-encoded (not "+").
    expect(res.headers.get('location')).toContain('scope=oauth%20crm.objects');
    // State is kept in a short-lived encrypted HttpOnly cookie, not in plain text.
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${OAUTH_COOKIE}=`))!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain(loc.searchParams.get('state')!);
  });

  it('omits optional_scope when there are none', async () => {
    const env = createTestEnv({ env: { HUBSPOT_OPTIONAL_SCOPES: 'none' } });
    const loc = new URL((await startFlow(env)).headers.get('location')!);
    expect(loc.searchParams.has('optional_scope')).toBe(false);
  });

  it('refuses returnTo values on other origins (no open redirect)', async () => {
    const env = createTestEnv();
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'https://builder.example.test.evil.com']) {
      const res = await startFlow(env, `returnTo=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      const page = await res.text();
      expect(page).not.toContain('evil.example');
      expect(page).toContain('not valid');
      expect(inlineScript(page)).toContain('var o=null');
    }
  });

  it('defaults returnTo to APP_URL', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/auth/start', { csrf: false, headers: html });
    expect(res.status).toBe(302);
  });
});

describe('GET /api/auth/callback', () => {
  it('signs in, sets the session cookie and notifies the opener', async () => {
    const env = createTestEnv();
    const res = await env.signIn();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(session).toContain('HttpOnly');
    expect(session).toContain('SameSite=Lax');
    expect(session).toContain('Secure');
    expect(cookies.some((c) => c.startsWith(`${OAUTH_COOKIE}=;`))).toBe(true);

    const page = await res.text();
    const script = inlineScript(page);
    expect(script).toContain('"type":"uiex-hubspot-auth","ok":true');
    expect(script).toContain(`var o="${TEST_APP_URL}"`);
    expect(script).toContain('postMessage(m,o)');
    expect(script).toContain('BroadcastChannel');
    expect(page).toContain('HubSpot is connected');
    // No external resources; CSP allows only this exact inline script/style.
    expect(page).not.toMatch(/<script[^>]+src=/);
    expect(page).not.toMatch(/<link /);
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'sha256-${await sha256Base64(script)}'`);
    expect(csp).toContain("frame-ancestors 'none'");
    // Tokens never reach the page.
    const token = env.fake.requests.find((r) => r.path.startsWith('/oauth/v1/access-tokens/'))!.path.split('/').pop()!;
    expect(page).not.toContain(token);

    const me = await (await env.call('/api/me')).json();
    expect(me).toEqual({
      connected: true,
      portalId: 12345678,
      hubDomain: 'acmedemo.com',
      user: { id: 9001, email: 'jordan.lee@acmedemo.com' },
      scopes: expect.arrayContaining(['oauth', 'crm.objects.contacts.read', 'tickets']),
      expiresAt: env.now() + 1800 * 1000,
      appHost: 'app.hubspot.com',
    });
    expect(JSON.stringify(me)).not.toMatch(/fake-at-|na1-/);
  });

  it('rejects a state mismatch', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('auto', '1');
    authorize.searchParams.set('state', 'forged-state');
    const back = new URL((await env.fake.fetch(authorize.toString())).headers.get('location')!);
    const res = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain('"error":"state_mismatch"');
    expect(page).toContain('Sign-in expired');
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=v1`))).toBe(false);
    expect((await (await env.call('/api/me')).json()).connected).toBe(false);
  });

  it('rejects a callback without the state cookie (e.g. CSRF login attempt)', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/auth/callback?code=whatever&state=abc', { csrf: false, headers: html });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('"error":"state_missing"');
  });

  it('rejects a reused state (the state cookie is single use)', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('auto', '1');
    const back = new URL((await env.fake.fetch(authorize.toString())).headers.get('location')!);
    const first = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(first.status).toBe(200);
    const again = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(again.status).toBe(400);
  });

  it('rejects a state cookie older than 10 minutes', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('auto', '1');
    const back = new URL((await env.fake.fetch(authorize.toString())).headers.get('location')!);
    env.advance(11 * 60 * 1000);
    const res = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('state_missing');
  });

  it('explains access_denied in plain language', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const authorize = new URL(start.headers.get('location')!);
    const decision = new URL('/oauth/authorize/decision', TEST_APP_BASE);
    for (const k of ['client_id', 'redirect_uri', 'scope', 'optional_scope', 'state']) decision.searchParams.set(k, authorize.searchParams.get(k) ?? '');
    decision.searchParams.set('decision', 'deny');
    const back = new URL((await env.fake.fetch(decision.toString())).headers.get('location')!);
    expect(back.searchParams.get('error')).toBe('access_denied');
    const res = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(res.status).toBe(400);
    const page = await res.text();
    expect(page).toContain('You chose not to give the builder access');
    expect(page).toContain('"ok":false,"error":"access_denied"');
  });

  it('never echoes attacker-controlled error codes or HTML', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await env.call(`/api/auth/callback?state=${state}&error=${encodeURIComponent('<script>alert(1)</script>')}`, { csrf: false, headers: html });
    const page = await res.text();
    expect(page).not.toContain('<script>alert');
    expect(page).toContain('"error":"oauth_error"');
  });

  it('reports a failed code exchange', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await env.call(`/api/auth/callback?state=${state}&code=not-a-real-code`, { csrf: false, headers: html });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('token_exchange_failed');
  });

  it('reports HubSpot outages separately', async () => {
    const env = createTestEnv();
    const start = await startFlow(env);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('auto', '1');
    const back = new URL((await env.fake.fetch(authorize.toString())).headers.get('location')!);
    env.fake.failNext({ match: '/oauth/v1/token', status: 503 });
    const res = await env.call(`${back.pathname}${back.search}`, { csrf: false, headers: html });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('hubspot_unreachable');
  });

  it('redirect mode sends the browser back to returnTo with the result', async () => {
    const env = createTestEnv();
    const res = await env.signIn({ mode: 'redirect', returnTo: `${TEST_APP_URL}/editor?project=1` });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(`${loc.origin}${loc.pathname}`).toBe(`${TEST_APP_URL}/editor`);
    expect(loc.searchParams.get('project')).toBe('1');
    expect(loc.searchParams.get('uiex_auth')).toBe('connected');
    expect((await (await env.call('/api/me')).json()).connected).toBe(true);
  });

  it('redirect mode reports errors back to returnTo too', async () => {
    const env = createTestEnv();
    const start = await env.call(`/api/auth/start?mode=redirect&returnTo=${encodeURIComponent(TEST_APP_URL)}`, { csrf: false, headers: html });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await env.call(`/api/auth/callback?state=${state}&error=access_denied`, { csrf: false, headers: html });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).searchParams.get('uiex_auth')).toBe('access_denied');
  });

  it('posts to an allowed separate builder origin', async () => {
    const other = 'https://other-builder.example.test';
    const env = createTestEnv({ env: { ALLOWED_ORIGINS: other } });
    const res = await env.signIn({ returnTo: other });
    expect(inlineScript(await res.text())).toContain(`var o="${other}"`);
  });

  it('detects EU portals from the refresh token region', async () => {
    const env = createTestEnv({ fake: { region: 'eu1' } });
    await env.signIn();
    expect((await (await env.call('/api/me')).json()).appHost).toBe('app-eu1.hubspot.com');
  });
});

describe('appHostFor', () => {
  it('derives the app host from token prefixes, hub domains and API bases', () => {
    expect(appHostFor({ refreshToken: 'na1-abc' })).toBe('app.hubspot.com');
    expect(appHostFor({ refreshToken: 'eu1-abc' })).toBe('app-eu1.hubspot.com');
    expect(appHostFor({ refreshToken: 'pat-eu1-abc' })).toBe('app-eu1.hubspot.com');
    expect(appHostFor({ refreshToken: 'ap1-abc' })).toBe('app-ap1.hubspot.com');
    expect(appHostFor({ hubDomain: 'portal.eu1.hubspot.com' })).toBe('app-eu1.hubspot.com');
    expect(appHostFor({ apiBase: 'https://api-eu1.hubapi.com' })).toBe('app-eu1.hubspot.com');
    expect(appHostFor({ hubDomain: 'europe-shop.com' })).toBe('app.hubspot.com');
    expect(appHostFor({})).toBe('app.hubspot.com');
  });
});

describe('/api/me', () => {
  it('is signed out without a cookie, and with a tampered one (which it clears)', async () => {
    const env = createTestEnv();
    expect(await (await env.call('/api/me')).json()).toEqual({ connected: false, reason: 'signed-out' });
    env.jar.set(SESSION_COOKIE, 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    const res = await env.call('/api/me');
    expect(await res.json()).toEqual({ connected: false, reason: 'signed-out' });
    expect(res.headers.getSetCookie()[0]).toMatch(/^uiex_session=; .*Max-Age=0/);
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('refreshes an expired access token and updates the cookie', async () => {
    const env = createTestEnv();
    await env.signIn();
    const before = env.jar.get(SESSION_COOKIE);
    env.advance(31 * 60 * 1000);
    const res = await env.call('/api/me');
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.expiresAt).toBe(env.now() + 1800 * 1000);
    expect(env.jar.get(SESSION_COOKIE)).not.toBe(before);
    expect(env.fake.requests.filter((r) => r.method === 'POST' && r.path === '/oauth/v1/token')).toHaveLength(2);
  });

  it('does not refresh a token that is still fresh', async () => {
    const env = createTestEnv();
    await env.signIn();
    const res = await env.call('/api/me');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(env.fake.requests.filter((r) => r.path === '/oauth/v1/token')).toHaveLength(1);
  });

  it('refreshes within the last minute before expiry', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.advance(29 * 60 * 1000 + 30 * 1000);
    await env.call('/api/me');
    expect(env.fake.requests.filter((r) => r.path === '/oauth/v1/token')).toHaveLength(2);
  });

  it('reports revoked (and clears the cookie) when the refresh token no longer works', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.revokeRefreshTokens();
    env.advance(31 * 60 * 1000);
    const res = await env.call('/api/me');
    expect(await res.json()).toEqual({ connected: false, reason: 'revoked' });
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('answers 502 (and keeps the session) when HubSpot is down during refresh', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.advance(31 * 60 * 1000);
    env.fake.failNext({ match: '/oauth/v1/token', status: 500 });
    const res = await env.call('/api/me');
    expect(res.status).toBe(502);
    expect(env.jar.get(SESSION_COOKIE)).toBeTruthy();
    expect((await (await env.call('/api/me')).json()).connected).toBe(true);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const env = createTestEnv();
    await env.signIn();
    const res = await env.call('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
    expect(env.fake.requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/oauth/v1/refresh-tokens/'))).toBe(true);
    expect((await (await env.call('/api/me')).json()).connected).toBe(false);
  });

  it('still signs out when revoking fails', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.failNext({ match: 'DELETE /oauth/v1/refresh-tokens', status: 500 });
    const res = await env.call('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('is fine when already signed out', async () => {
    const env = createTestEnv();
    expect((await env.call('/api/auth/logout', { method: 'POST' })).status).toBe(200);
  });
});

describe('/api/health', () => {
  it('reports version, features and scopes', async () => {
    const env = createTestEnv({ env: { ENABLE_FETCH_PROXY: 'false' } });
    expect(await (await env.call('/api/health')).json()).toEqual({
      ok: true,
      version: env.config.version,
      oauthConfigured: true,
      features: { crm: true, fetchProxy: false, deploy: true },
      scopes: { required: env.config.requiredScopes, optional: env.config.optionalScopes },
    });
  });
});
