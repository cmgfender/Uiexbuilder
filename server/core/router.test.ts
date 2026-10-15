// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Router, normalizePath } from './router';
import { createTestEnv, TEST_APP_URL } from './testing';
import { CONNECTOR_ROUTES } from '../../src/connect/types';
import type { Route } from './types';

const ok = () => new Response('ok');

describe('Router', () => {
  const routes: Route[] = [
    { method: 'GET', path: '/api/crm/records/:objectType/search', handler: ok },
    { method: 'GET', path: '/api/crm/records/:objectType/:id', handler: ok },
    { method: 'GET', path: '/api/crm/records/:objectType/:id/associations/:toObjectType', handler: ok },
    { method: 'POST', path: '/api/crm/search/:objectType', handler: ok },
    { method: 'GET', path: '/api/x.y', handler: ok },
  ];
  const router = new Router(routes);

  it('matches literal segments before params (registration order)', () => {
    const m = router.match('GET', '/api/crm/records/contacts/search');
    expect(m.kind === 'match' && m.route.path).toBe('/api/crm/records/:objectType/search');
  });

  it('extracts and decodes params', () => {
    const m = router.match('GET', '/api/crm/records/p_projects/7001/associations/0-2');
    expect(m).toMatchObject({ kind: 'match', params: { objectType: 'p_projects', id: '7001', toObjectType: '0-2' } });
    expect(router.match('GET', '/api/crm/records/a%20b/1')).toMatchObject({ params: { objectType: 'a b', id: '1' } });
  });

  it('reports 405 with the allowed methods and 404 for unknown paths', () => {
    expect(router.match('GET', '/api/crm/search/contacts')).toEqual({ kind: 'method-not-allowed', allow: ['POST'] });
    expect(router.match('GET', '/api/nope')).toEqual({ kind: 'not-found' });
    expect(router.match('GET', '/api/xzy')).toEqual({ kind: 'not-found' }); // "." is literal
  });

  it('ignores a trailing slash', () => {
    expect(normalizePath('/api/me/')).toBe('/api/me');
    expect(normalizePath('/')).toBe('/');
    expect(router.match('GET', '/api/x.y/').kind).toBe('match');
  });

  it('rejects malformed escapes with a 400 error', () => {
    expect(() => router.match('GET', '/api/crm/records/%E0%A4%A/1')).toThrow(/invalid characters/);
  });
});

describe('connector routing', () => {
  it('returns null for non-API paths so adapters can serve static files', async () => {
    const env = createTestEnv();
    for (const p of ['/', '/index.html', '/apix', '/assets/app.js']) {
      expect(await env.connector.handle(new Request(`${TEST_APP_URL}${p}`))).toBeNull();
    }
  });

  it('answers unknown /api paths with a 404 JSON error and no-store headers', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: expect.stringContaining('/api/does-not-exist'), status: 404 } });
  });

  it('answers wrong methods with 405 and an Allow header', async () => {
    const env = createTestEnv();
    const res = await env.call(CONNECTOR_ROUTES.me, { method: 'POST', body: '{}' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect((await res.json()).error.code).toBe('method_not_allowed');
  });

  it('maps network failures to 502 without leaking the error text', async () => {
    const env = createTestEnv();
    await env.signIn();
    const original = env.config.fetch;
    env.config.fetch = (() => {
      throw new Error(`boom with Bearer abc.def and ${env.config.hubspotClientSecret}`);
    }) as typeof fetch;
    const res = await env.call('/api/crm/properties/contacts');
    env.config.fetch = original;
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('hubspot_unreachable');
    expect(JSON.stringify(body)).not.toContain(env.config.hubspotClientSecret);
    expect(JSON.stringify(body)).not.toContain('boom');
  });

  it('answers HEAD like GET without a body', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/health', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('turns unexpected exceptions into a generic 500 and logs them without tokens', async () => {
    const env = createTestEnv();
    await env.signIn();
    expect((await env.call('/api/crm/owners')).status).toBe(200);
    env.fake.failNext({ match: '/crm/v3/properties/', status: 200, body: { results: 'not-a-list' } });
    const res = await env.call('/api/crm/properties/contacts');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal_error', message: expect.any(String), status: 500 } });
    expect(env.logs).toHaveLength(1);
    expect(env.logs[0]).toContain('/api/crm/properties/contacts');
    const token = env.fake.requests.find((r) => r.token)?.token;
    expect(token).toBeTruthy();
    expect(env.logs[0]).not.toContain(token!);
  });

  it('times out slow handlers with 504', async () => {
    const env = createTestEnv({ connector: { requestTimeoutMs: 30 } });
    await env.signIn();
    env.config.fetch = (() => new Promise(() => {})) as typeof fetch;
    const res = await env.call('/api/crm/owners');
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe('timeout');
  });
});
