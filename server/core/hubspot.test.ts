// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTestEnv } from './testing';
import { mapHubSpotError, missingScopeMessage, SessionHubSpotApi } from './hubspot';
import { RateLimitedError } from './http';
import { SESSION_COOKIE } from './session';
import { HubSpotApiError } from './types';

const tokenCalls = (env: ReturnType<typeof createTestEnv>) => env.fake.requests.filter((r) => r.method === 'POST' && r.path === '/oauth/v1/token').length;

describe('HubSpotApi via ctx.hubspot()', () => {
  it('requires a sign-in', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'not_connected', message: 'Connect HubSpot to see real data.', status: 401 } });
  });

  it('refreshes an expiring token before calling HubSpot and stores the new token in the cookie', async () => {
    const env = createTestEnv();
    await env.signIn();
    const before = env.jar.get(SESSION_COOKIE);
    env.advance(30 * 60 * 1000);
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(200);
    expect(tokenCalls(env)).toBe(2);
    expect(env.jar.get(SESSION_COOKIE)).not.toBe(before);
    // The next request uses the refreshed token without refreshing again.
    expect((await env.call('/api/crm/owners')).status).toBe(200);
    expect(tokenCalls(env)).toBe(2);
  });

  it('refreshes once and retries when HubSpot answers 401', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.expireAccessTokens();
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(200);
    expect(tokenCalls(env)).toBe(2);
    const ownersCalls = env.fake.requests.filter((r) => r.path === '/crm/v3/owners');
    expect(ownersCalls).toHaveLength(2);
    expect(ownersCalls[0].token).not.toBe(ownersCalls[1].token);
  });

  it('signs out when HubSpot still says 401 after a refresh', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.failNext({ match: '/crm/v3/owners', status: 401, times: 2 });
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('not_connected');
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('signs out when the refresh token was revoked (app uninstalled)', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.expireAccessTokens();
    env.fake.revokeRefreshTokens();
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('not_connected');
    expect(body.error.message).toMatch(/Connect HubSpot again/);
    expect(env.jar.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('maps MISSING_SCOPES to missing_scope with the required scopes and a plain explanation', async () => {
    const env = createTestEnv();
    env.fake.dropScopes('tickets');
    await env.signIn();
    const res = await env.call('/api/crm/properties/tickets');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'missing_scope', status: 403, requiredScopes: ['tickets'] });
    expect(body.error.message).toContain('tickets');
    expect(body.error.message).toMatch(/connect again/i);
    expect(body.error.correlationId).toEqual(expect.any(String));
  });

  it('retries a 429 once after the (bounded) Retry-After wait', async () => {
    const sleep = vi.fn(async () => {});
    const env = createTestEnv({ connector: { hubspot: { sleep } } });
    await env.signIn();
    env.fake.failNext({ match: '/crm/v3/owners', status: 429, headers: { 'Retry-After': '30' } });
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('reports rate_limited with Retry-After when HubSpot keeps answering 429', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.failNext({ match: '/crm/v3/owners', status: 429, headers: { 'Retry-After': '7' }, times: 2 });
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('7');
    const body = await res.json();
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.message).toContain('7 seconds');
  });

  it('maps HubSpot 5xx to 502 hubspot_error with the correlation id', async () => {
    const env = createTestEnv();
    await env.signIn();
    env.fake.failNext({ match: '/crm/v3/owners', status: 503, body: { status: 'error', message: 'internal details', correlationId: 'corr-123', category: 'SERVICE_UNAVAILABLE' } });
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'hubspot_error', correlationId: 'corr-123' });
    expect(body.error.message).not.toContain('internal details');
  });

  it('times out slow HubSpot calls with 504', async () => {
    const env = createTestEnv({ connector: { hubspot: { sleep: async () => {}, timeoutMs: 20 } } });
    await env.signIn();
    const fakeFetch = env.config.fetch;
    env.config.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/crm/')) {
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      }
      return fakeFetch(input, init);
    }) as typeof fetch;
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe('timeout');
  });
});

describe('mapHubSpotError', () => {
  it('collects required scopes from errors[].context and context', () => {
    const e = mapHubSpotError(403, {
      category: 'MISSING_SCOPES',
      correlationId: 'c1',
      errors: [{ context: { requiredGranularScopes: ['crm.objects.custom.read'] } }, { context: { requiredScopes: ['crm.schemas.custom.read', 'crm.objects.custom.read'] } }],
    });
    expect(e).toBeInstanceOf(HubSpotApiError);
    expect(e.code).toBe('missing_scope');
    expect(e.requiredScopes).toEqual(['crm.objects.custom.read', 'crm.schemas.custom.read']);
    expect(e.message).toContain('custom objects');
    expect(e.correlationId).toBe('c1');
  });

  it('handles MISSING_SCOPES without details', () => {
    const e = mapHubSpotError(403, { category: 'MISSING_SCOPES' });
    expect(e.code).toBe('missing_scope');
    expect(e.requiredScopes).toEqual([]);
    expect(e.message).toBe(missingScopeMessage([]));
  });

  it('maps other statuses', () => {
    expect(mapHubSpotError(403, { message: 'nope' }).code).toBe('forbidden');
    expect(mapHubSpotError(404, null).code).toBe('not_found');
    expect(mapHubSpotError(400, { message: 'Property x does not exist' })).toMatchObject({ code: 'bad_request', status: 400, message: expect.stringContaining('Property x does not exist') });
    expect(mapHubSpotError(401, null)).toMatchObject({ code: 'not_connected', status: 401 });
    const rl = mapHubSpotError(429, null, '12');
    expect(rl).toBeInstanceOf(RateLimitedError);
    expect((rl as RateLimitedError).retryAfterSeconds).toBe(12);
    expect(mapHubSpotError(500, null)).toMatchObject({ code: 'hubspot_error', status: 502 });
  });
});

describe('SessionHubSpotApi.request', () => {
  it('encodes query parameters, skips undefined and parses JSON', async () => {
    const env = createTestEnv();
    const { accessToken, refreshToken } = env.fake.issueTokens();
    const session = { get: async () => null, set: vi.fn(async () => {}), clear: vi.fn() };
    const api = new SessionHubSpotApi(env.config, session, {
      accessToken,
      refreshToken,
      expiresAt: env.now() + 3_600_000,
      portalId: 12345678,
      hubDomain: 'acmedemo.com',
      userEmail: 'x@y.z',
      scopes: [],
      appHost: 'app.hubspot.com',
    });
    const res = await api.request<{ id: string; properties: Record<string, string> }>('GET', '/crm/v3/objects/contacts/1001', { query: { properties: 'firstname', archived: undefined } });
    expect(res.properties.firstname).toBe('Ada');
    const last = env.fake.requests.at(-1)!;
    expect(last.search).toBe('?properties=firstname');
    expect(session.set).not.toHaveBeenCalled();
  });
});
