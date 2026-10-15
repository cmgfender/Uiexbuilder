import { describe, expect, it, vi } from 'vitest';
import { ConnectorClient, ConnectorError, fill, isAbortError } from './client';
import { CSRF_HEADER } from './types';
import { OBJECT_TYPES, errorBody, healthFixture, html, json, routedFetch } from './testUtils';

function make(routes: Parameters<typeof routedFetch>[0], opts: { now?: () => number; baseUrl?: string; cacheTtlMs?: number } = {}) {
  const r = routedFetch(routes);
  const client = new ConnectorClient({ baseUrl: opts.baseUrl ?? '', fetch: r.fetch, now: opts.now, cacheTtlMs: opts.cacheTtlMs });
  return { client, ...r };
}

async function rejection(p: Promise<unknown>): Promise<ConnectorError> {
  try {
    await p;
  } catch (err) {
    return err as ConnectorError;
  }
  throw new Error('expected the promise to reject');
}

describe('ConnectorClient: requests', () => {
  it('sends the session cookie, the CSRF header and JSON bodies', async () => {
    const { client, calls } = make({
      'GET /api/health': json(healthFixture()),
      'POST /api/crm/search/contacts': json({ results: [], total: 0, hasMore: false }),
    });
    await client.health();
    await client.search('0-1', { query: 'ada', properties: ['email'] });
    expect(calls[0].credentials).toBe('include');
    expect(calls[0].headers[CSRF_HEADER.toLowerCase()]).toBe('1');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].headers['content-type']).toBe('application/json');
    expect(calls[1].body).toEqual({ query: 'ada', properties: ['email'] });
    // '0-1' is sent as the standard name.
    expect(calls[1].path).toBe('/api/crm/search/contacts');
  });

  it('uses the base URL and builds query strings without empty values', async () => {
    const { client, calls } = make({ 'GET /api/crm/records/deals/42': json({ id: '42', objectType: 'deals', objectTypeId: '0-3', properties: {} }) }, { baseUrl: 'https://connector.example/' });
    expect(client.baseUrl).toBe('https://connector.example');
    expect(client.origin).toBe('https://connector.example');
    await client.getRecord('deals', '42', { properties: ['dealname', 'amount'], formatted: true });
    expect(calls[0].url).toBe('https://connector.example/api/crm/records/deals/42?properties=dealname%2Camount&formatted=1');
    expect(client.authStartUrl({ returnTo: 'https://builder.example', mode: 'popup' })).toBe(
      'https://connector.example/api/auth/start?returnTo=https%3A%2F%2Fbuilder.example&mode=popup',
    );
  });

  it('has a typed method for every data route', async () => {
    const { client, calls } = make({
      'GET /api/me': json({ connected: false }),
      'POST /api/auth/logout': json({ ok: true }),
      'GET /api/crm/object-types': json(OBJECT_TYPES),
      'GET /api/crm/properties/companies': json([]),
      'GET /api/crm/pipelines/deals': json([]),
      'GET /api/crm/owners': json([]),
      'GET /api/crm/records/contacts/search': json([]),
      'GET /api/crm/records/contacts/1/associations/companies': json([]),
      'POST /api/proxy/fetch': json({ status: 200, ok: true, headers: {}, body: '{}', truncated: false }),
      'POST /api/deploy': json({ deployId: 'd1', phase: 'queued', message: '', log: [], projectName: 'p' }),
      'GET /api/deploy/d1': json({ deployId: 'd1', phase: 'success', message: '', log: [], projectName: 'p' }),
      'GET /api/deploy/key': json({ remembered: false }),
      'DELETE /api/deploy/key': json({ remembered: false }),
    });
    await client.me();
    await client.logout();
    await client.objectTypes();
    await client.properties('company');
    await client.pipelines('0-3');
    await client.owners();
    await client.searchRecords('contacts', ' ada ', { limit: 5 });
    await client.getAssociations('0-1', '1', '0-2', { properties: ['name'], limit: 10 });
    await client.proxyFetch({ url: 'https://api.example.com', method: 'GET' });
    await client.startDeploy({ projectName: 'p', platformVersion: '2026.03', files: [] });
    await client.deployStatus('d1');
    await client.deployKey();
    await client.forgetDeployKey();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/me',
      'POST /api/auth/logout',
      'GET /api/crm/object-types',
      'GET /api/crm/properties/companies',
      'GET /api/crm/pipelines/deals',
      'GET /api/crm/owners',
      'GET /api/crm/records/contacts/search',
      'GET /api/crm/records/contacts/1/associations/companies',
      'POST /api/proxy/fetch',
      'POST /api/deploy',
      'GET /api/deploy/d1',
      'GET /api/deploy/key',
      'DELETE /api/deploy/key',
    ]);
    expect(calls[6].query.get('q')).toBe('ada');
    expect(calls[6].query.get('limit')).toBe('5');
    expect(calls[7].query.get('properties')).toBe('name');
    expect(calls[7].query.get('limit')).toBe('10');
  });

  it('fills route params URL-encoded', () => {
    expect(fill('/api/crm/records/:objectType/:id', { objectType: 'p_x', id: 'a/b' })).toBe('/api/crm/records/p_x/a%2Fb');
  });
});

describe('ConnectorClient: errors', () => {
  it('maps a missing permission with the needed scopes', async () => {
    const { client } = make({ 'GET /api/crm/properties/tickets': errorBody('missing_scope', 403, { requiredScopes: ['tickets'], correlationId: 'abc' }) });
    const err = await rejection(client.properties('tickets'));
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe('missing_scope');
    expect(err.status).toBe(403);
    expect(err.requiredScopes).toEqual(['tickets']);
    expect(err.correlationId).toBe('abc');
    expect(err.message).toBe('missing_scope message');
  });

  it('maps rate limits with retry-after', async () => {
    const { client } = make({ 'GET /api/crm/owners': errorBody('rate_limited', 429, {}, { 'retry-after': '7' }) });
    const err = await rejection(client.owners());
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfter).toBe(7);
  });

  it('reports a static host (HTML answer) as unavailable', async () => {
    const ok = make({ 'GET /api/health': html() });
    expect((await rejection(ok.client.health())).code).toBe('unavailable');
    const missing = make({});
    const err = await rejection(missing.client.health());
    expect(err.code).toBe('unavailable');
    expect(err.status).toBe(404);
  });

  it('reports network failures as network_error and non-JSON errors as http_error', async () => {
    const failing = new ConnectorClient({ baseUrl: '', fetch: vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch });
    expect((await rejection(failing.me())).code).toBe('network_error');
    const { client } = make({ 'GET /api/me': json({ nope: true }, 500) });
    const err = await rejection(client.me());
    expect(err.code).toBe('http_error');
    expect(err.status).toBe(500);
  });

  it('notifies error listeners', async () => {
    const { client } = make({ 'GET /api/me': errorBody('not_connected', 401) });
    const seen: string[] = [];
    const off = client.onError((e) => seen.push(e.code));
    await rejection(client.me());
    off();
    await rejection(client.me());
    expect(seen).toEqual(['not_connected']);
  });

  it('rejects with an AbortError when the caller aborts', async () => {
    let release: (r: Response) => void = () => {};
    const { client } = make({ 'GET /api/crm/records/contacts/search': () => new Promise<Response>((resolve) => (release = resolve)) });
    const controller = new AbortController();
    const p = client.searchRecords('contacts', 'x', { signal: controller.signal });
    controller.abort();
    const err = await rejection(p);
    expect(isAbortError(err)).toBe(true);
    release(json([]));
  });
});

describe('ConnectorClient: catalog cache', () => {
  it('caches catalog GETs with a TTL', async () => {
    let now = 1_000;
    const { client, calls } = make({ 'GET /api/crm/properties/contacts': () => json([{ name: 'email', label: 'Email', type: 'string', fieldType: 'text' }]) }, { now: () => now, cacheTtlMs: 1000 });
    await client.properties('contacts');
    await client.properties('contacts');
    expect(calls).toHaveLength(1);
    expect(client.peek('properties', 'contacts')).toHaveLength(1);
    now += 1001;
    expect(client.peek('properties', 'contacts')).toBeUndefined();
    await client.properties('contacts');
    expect(calls).toHaveLength(2);
    await client.properties('contacts', { fresh: true });
    expect(calls).toHaveLength(3);
  });

  it("shares one cache entry for 'contacts', 'contact' and '0-1'", async () => {
    const { client, calls } = make({ 'GET /api/crm/properties/contacts': () => json([]) });
    await client.properties('contacts');
    await client.properties('0-1');
    await client.properties('Contact');
    expect(calls).toHaveLength(1);
    expect(client.peek('properties', '0-1')).toEqual([]);
  });

  it('resolves custom object names to their id once object types are known', async () => {
    const { client, calls } = make({ 'GET /api/crm/object-types': () => json(OBJECT_TYPES), 'GET /api/crm/properties/2-555': () => json([]) });
    await client.objectTypes();
    await client.properties('p_projects');
    await client.properties('2-555');
    expect(calls.map((c) => c.path)).toEqual(['/api/crm/object-types', '/api/crm/properties/2-555']);
  });

  it('dedupes identical requests in flight; one caller aborting does not cancel the others', async () => {
    let release: (r: Response) => void = () => {};
    const { client, calls } = make({ 'GET /api/crm/object-types': () => new Promise<Response>((resolve) => (release = resolve)) });
    const a = new AbortController();
    const p1 = client.objectTypes({ signal: a.signal });
    const p2 = client.objectTypes();
    expect(calls).toHaveLength(1);
    a.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    release(json(OBJECT_TYPES));
    await expect(p2).resolves.toHaveLength(4);
    expect(calls[0].signal?.aborted).toBe(false);
  });

  it('aborts the shared request once every caller aborted', async () => {
    const { client, calls } = make({ 'GET /api/crm/owners': () => new Promise<Response>(() => {}) });
    const a = new AbortController();
    const b = new AbortController();
    const p1 = client.owners({ signal: a.signal });
    const p2 = client.owners({ signal: b.signal });
    a.abort();
    expect(calls[0].signal?.aborted).toBe(false);
    b.abort();
    expect(calls[0].signal?.aborted).toBe(true);
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('scopes the cache to the portal and drops answers from before a scope change', async () => {
    let release: (r: Response) => void = () => {};
    let n = 0;
    const { client, calls } = make({
      'GET /api/crm/owners': () => {
        n++;
        return n === 1 ? new Promise<Response>((resolve) => (release = resolve)) : json([{ id: '2', email: 'b@x.com' }]);
      },
    });
    client.setCacheScope('1');
    const pending = client.owners();
    client.setCacheScope('2');
    release(json([{ id: '1', email: 'a@x.com' }]));
    await pending;
    // The portal-1 answer was not cached for portal 2.
    expect(client.peek('owners')).toBeUndefined();
    await client.owners();
    expect(calls).toHaveLength(2);
    expect(client.peek('owners')).toEqual([{ id: '2', email: 'b@x.com' }]);
    client.setCacheScope(null);
    expect(client.peek('owners')).toBeUndefined();
  });

  it('does not cache record reads (always fresh data)', async () => {
    const { client, calls } = make({ 'GET /api/crm/records/contacts/1': () => json({ id: '1', objectType: 'contacts', objectTypeId: '0-1', properties: {} }) });
    await client.getRecord('contacts', '1');
    await client.getRecord('contacts', '1');
    expect(calls).toHaveLength(2);
  });
});
