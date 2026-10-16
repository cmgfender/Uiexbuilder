// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFakeHubSpot, FAKE_PERSONAL_ACCESS_KEY, type FakeHubSpotControls } from './handler';
import { createSeed, CUSTOM_OBJECT_TYPE_ID } from './seed';
import { compareValues } from './search';

const API = 'https://api.hubapi.com';
const APP = 'https://app.hubspot.com';
const REDIRECT = 'https://builder.example.test/api/auth/callback';

function fake(extra: Partial<Parameters<typeof createFakeHubSpot>[0]> = {}): FakeHubSpotControls {
  return createFakeHubSpot({ clientId: 'cid', clientSecret: 'secret', ...extra });
}

function authorizeUrl(params: Record<string, string> = {}): string {
  const q = new URLSearchParams({ client_id: 'cid', redirect_uri: REDIRECT, scope: 'oauth crm.objects.contacts.read', optional_scope: 'crm.objects.tickets.read', state: 'st', ...params });
  return `${APP}/oauth/authorize?${q}`;
}

async function exchange(f: FakeHubSpotControls, form: Record<string, string>) {
  const res = await f.fetch(`${API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'cid', client_secret: 'secret', redirect_uri: REDIRECT, ...form }).toString(),
  });
  return { status: res.status, body: await res.json() };
}

async function authCode(f: FakeHubSpotControls): Promise<string> {
  const res = await f.fetch(authorizeUrl({ auto: '1' }));
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location')!);
  expect(loc.searchParams.get('state')).toBe('st');
  return loc.searchParams.get('code')!;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

async function api(f: FakeHubSpotControls, token: string, path: string, init: RequestInit = {}) {
  const res = await f.fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('seed', () => {
  it('has a realistic portal', () => {
    const seed = createSeed();
    expect(seed.portalId).toBe(12345678);
    expect(seed.records.get('contacts')!.length).toBeGreaterThanOrEqual(12);
    expect(seed.records.get('companies')!.length).toBeGreaterThanOrEqual(6);
    expect(seed.records.get('deals')!.length).toBeGreaterThanOrEqual(10);
    expect(seed.records.get('tickets')!.length).toBeGreaterThanOrEqual(5);
    expect(seed.records.get('projects')!.length).toBeGreaterThan(0);
    for (const name of ['contacts', 'companies', 'deals', 'tickets']) {
      const t = seed.objectTypes.find((o) => o.name === name)!;
      const custom = t.properties.filter((p) => !p.hubspotDefined);
      expect(custom.length, name).toBeGreaterThanOrEqual(3);
      expect(custom.some((p) => p.type === 'enumeration' && (p.options?.length ?? 0) > 1), name).toBe(true);
    }
    expect(seed.objectTypes.find((t) => t.custom)?.aliases).toContain('p_projects');
    expect(seed.pipelines.get('deals')!.length).toBe(2);
    expect(seed.pipelines.get('tickets')![0].stages.length).toBe(4);
    expect(seed.owners.length).toBe(3);
    // every association points at existing records
    for (const a of seed.associations) {
      expect(seed.records.get(a.fromType)!.some((r) => r.id === a.fromId), `${a.fromType}/${a.fromId}`).toBe(true);
      expect(seed.records.get(a.toType)!.some((r) => r.id === a.toId), `${a.toType}/${a.toId}`).toBe(true);
    }
  });
});

describe('fake OAuth', () => {
  it('shows a consent page with Approve and Deny buttons', async () => {
    const f = fake();
    const res = await f.fetch(authorizeUrl());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain('<button type="submit" name="decision" value="approve">Approve</button>');
    expect(page).toContain('Deny');
    expect(page).toContain('crm.objects.contacts.read');
    expect(page).toContain('tickets');
    expect(page).toContain('action="/oauth/authorize/decision"');
  });

  it('escapes attacker-controlled values on the consent page', async () => {
    const f = fake();
    const page = await (await f.fetch(authorizeUrl({ state: '"><script>alert(1)</script>' }))).text();
    expect(page).not.toContain('<script>alert(1)</script>');
  });

  it('rejects an unknown client or a missing oauth scope', async () => {
    const f = fake();
    expect((await f.fetch(authorizeUrl({ client_id: 'other' }))).status).toBe(400);
    expect((await f.fetch(authorizeUrl({ scope: 'crm.objects.contacts.read' }))).status).toBe(400);
    expect((await f.fetch(authorizeUrl({ redirect_uri: 'not a url' }))).status).toBe(400);
  });

  it('redirects with an error when the user denies', async () => {
    const f = fake();
    const q = new URL(authorizeUrl());
    q.pathname = '/oauth/authorize/decision';
    q.searchParams.set('decision', 'deny');
    const res = await f.fetch(q.toString());
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st');
    expect(loc.searchParams.has('code')).toBe(false);
  });

  it('auto-approves with autoApprove', async () => {
    const f = fake({ autoApprove: true });
    const res = await f.fetch(authorizeUrl());
    expect(res.status).toBe(302);
  });

  it('exchanges a code once, refreshes, reports token info and revokes', async () => {
    const f = fake({ now: () => 5_000_000 });
    const code = await authCode(f);
    const first = await exchange(f, { grant_type: 'authorization_code', code });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ token_type: 'bearer', expires_in: 1800 });
    expect(first.body.refresh_token).toMatch(/^na1-/);
    // single use
    const again = await exchange(f, { grant_type: 'authorization_code', code });
    expect(again).toMatchObject({ status: 400, body: { status: 'BAD_AUTH_CODE', error: 'invalid_grant' } });

    const info = await (await f.fetch(`${API}/oauth/v1/access-tokens/${first.body.access_token}`)).json();
    expect(info).toMatchObject({ hub_id: 12345678, hub_domain: 'acmedemo.com', user: 'sam.rivera@acmedemo.com', user_id: 9001, token_type: 'access', expires_in: 1800 });
    expect(info.scopes).toEqual(['oauth', 'crm.objects.contacts.read', 'crm.objects.tickets.read']);

    const refreshed = await exchange(f, { grant_type: 'refresh_token', refresh_token: first.body.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(first.body.access_token);
    expect(refreshed.body.refresh_token).toBe(first.body.refresh_token);

    const revoke = await f.fetch(`${API}/oauth/v1/refresh-tokens/${first.body.refresh_token}`, { method: 'DELETE' });
    expect(revoke.status).toBe(204);
    const dead = await exchange(f, { grant_type: 'refresh_token', refresh_token: first.body.refresh_token });
    expect(dead).toMatchObject({ status: 400, body: { status: 'BAD_REFRESH_TOKEN', error: 'invalid_grant' } });
    expect((await api(f, refreshed.body.access_token, '/crm/v3/objects/contacts/1001')).status).toBe(401);
  });

  it('checks client credentials and redirect_uri', async () => {
    const f = fake();
    const code = await authCode(f);
    expect((await exchange(f, { grant_type: 'authorization_code', code, client_secret: 'wrong' })).body.status).toBe('BAD_CLIENT_ID');
    expect((await exchange(f, { grant_type: 'authorization_code', code, redirect_uri: 'https://evil.example/cb' })).body.status).toBe('BAD_REDIRECT_URI');
  });

  it('expires codes after 10 minutes and access tokens after their lifetime', async () => {
    let clock = 1_000_000;
    const f = fake({ now: () => clock });
    const code = await authCode(f);
    clock += 11 * 60 * 1000;
    expect((await exchange(f, { grant_type: 'authorization_code', code })).body.status).toBe('BAD_AUTH_CODE');
    const { accessToken } = f.issueTokens({ expiresInSeconds: 60 });
    expect((await api(f, accessToken, '/crm/v3/objects/contacts/1001')).status).toBe(200);
    clock += 61_000;
    const expired = await api(f, accessToken, '/crm/v3/objects/contacts/1001');
    expect(expired).toMatchObject({ status: 401, body: { category: 'EXPIRED_AUTHENTICATION' } });
  });

  it('uses the configured region prefix', async () => {
    const f = fake({ region: 'eu1' });
    expect(f.issueTokens().refreshToken).toMatch(/^eu1-/);
  });
});

describe('fake CRM', () => {
  it('requires a valid bearer token', async () => {
    const f = fake();
    const res = await f.fetch(`${API}/crm/v3/owners`);
    expect(res.status).toBe(401);
    expect((await res.json()).category).toBe('INVALID_AUTHENTICATION');
    expect((await f.fetch(`${API}/crm/v3/owners`, bearer('nope'))).status).toBe(401);
  });

  it('answers MISSING_SCOPES in HubSpot’s format', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens({ scopes: ['oauth', 'crm.objects.contacts.read'] });
    const res = await api(f, accessToken, '/crm/v3/objects/tickets/4001');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ category: 'MISSING_SCOPES', errors: [{ context: { requiredGranularScopes: ['crm.objects.tickets.read'] } }] });
    expect(res.body.correlationId).toEqual(expect.any(String));
    f.dropScopes('crm.objects.contacts.read');
    expect((await api(f, accessToken, '/crm/v3/objects/contacts/1001')).status).toBe(403);
    f.restoreScopes();
    expect((await api(f, accessToken, '/crm/v3/objects/contacts/1001')).status).toBe(200);
  });

  it('reads objects by name, type id or custom object alias', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    const byName = await api(f, accessToken, '/crm/v3/objects/contacts/1001?properties=firstname,loyalty_points,unknown');
    expect(byName.body).toMatchObject({ id: '1001', archived: false, properties: { firstname: 'Ada', loyalty_points: '1250', hs_object_id: '1001' } });
    expect(byName.body.properties).not.toHaveProperty('unknown');
    expect((await api(f, accessToken, '/crm/v3/objects/0-1/1002')).body.properties.firstname).toBe('Grace');
    expect((await api(f, accessToken, `/crm/v3/objects/${CUSTOM_OBJECT_TYPE_ID}/7001`)).body.properties.project_name).toBe('Enterprise rollout');
    expect((await api(f, accessToken, '/crm/v3/objects/p_projects/7002')).status).toBe(200);
    expect((await api(f, accessToken, '/crm/v3/objects/p12345678_projects/7003')).status).toBe(200);
    expect((await api(f, accessToken, '/crm/v3/objects/contacts/42')).status).toBe(404);
    expect((await api(f, accessToken, '/crm/v3/objects/widgets/1')).status).toBe(400);
    const list = await api(f, accessToken, '/crm/v3/objects/deals?limit=4');
    expect(list.body.results).toHaveLength(4);
    expect(list.body.paging.next.after).toBe('4');
  });

  it('batch-reads records', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    const res = await api(f, accessToken, '/crm/v3/objects/companies/batch/read', { method: 'POST', body: JSON.stringify({ properties: ['name'], inputs: [{ id: '2001' }, { id: '2002' }] }) });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { properties: { name: string } }) => r.properties.name)).toEqual(['Analytical Engines Ltd', 'COBOL Works']);
    const partial = await api(f, accessToken, '/crm/v3/objects/companies/batch/read', { method: 'POST', body: JSON.stringify({ properties: ['name'], inputs: [{ id: '2001' }, { id: '9' }] }) });
    expect(partial.status).toBe(207);
    expect(partial.body.results).toHaveLength(1);
  });

  it('returns v4 associations in both directions', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    const fwd = await api(f, accessToken, '/crm/v4/objects/contacts/1001/associations/companies');
    expect(fwd.body.results).toEqual([
      {
        toObjectId: 2001,
        associationTypes: [
          { category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' },
          { category: 'HUBSPOT_DEFINED', typeId: 279, label: null },
        ],
      },
    ]);
    const rev = await api(f, accessToken, '/crm/v4/objects/companies/2001/associations/contacts');
    expect(rev.body.results.map((r: { toObjectId: number }) => r.toObjectId)).toEqual([1001, 1011]);
    const paged = await api(f, accessToken, '/crm/v4/objects/companies/2001/associations/contacts?limit=1');
    expect(paged.body.results).toHaveLength(1);
    expect(paged.body.paging.next.after).toBe('1');
  });

  it('serves properties, schemas, pipelines and owners', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    const props = await api(f, accessToken, '/crm/v3/properties/deals');
    const stage = props.body.results.find((p: { name: string }) => p.name === 'dealstage');
    expect(stage).toMatchObject({ type: 'enumeration', fieldType: 'radio', hubspotDefined: true, modificationMetadata: { readOnlyValue: false } });
    expect(stage.options.length).toBe(11);
    const schemas = await api(f, accessToken, '/crm/v3/schemas');
    expect(schemas.body.results).toHaveLength(1);
    expect(schemas.body.results[0]).toMatchObject({ name: 'projects', objectTypeId: CUSTOM_OBJECT_TYPE_ID, fullyQualifiedName: 'p12345678_projects', labels: { singular: 'Project', plural: 'Projects' } });
    expect((await api(f, accessToken, '/crm/v3/schemas/p_projects')).status).toBe(200);
    const pipelines = await api(f, accessToken, '/crm/v3/pipelines/tickets');
    expect(pipelines.body.results[0].stages).toHaveLength(4);
    expect((await api(f, accessToken, '/crm/v3/pipelines/contacts')).status).toBe(400);
    const owners = await api(f, accessToken, '/crm/v3/owners?limit=2');
    expect(owners.body.results).toHaveLength(2);
    expect(owners.body.paging.next.after).toBe('2');
  });
});

describe('fake CRM search', () => {
  const run = async (body: unknown, type = 'contacts') => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    return api(f, accessToken, `/crm/v3/objects/${type}/search`, { method: 'POST', body: JSON.stringify(body) });
  };
  const ids = (res: { body: { results: Array<{ id: string }> } }) => res.body.results.map((r) => r.id);

  it('matches the free-text query against searchable properties', async () => {
    expect(ids(await run({ query: 'globex.io', limit: 20 }))).toEqual(['1007', '1008']);
    expect(ids(await run({ query: 'MÜLLER' }))).toEqual(['1014']);
  });

  it('supports every operator', async () => {
    const f = (operator: string, extra: Record<string, unknown>, propertyName = 'loyalty_points') => run({ limit: 100, filterGroups: [{ filters: [{ propertyName, operator, ...extra }] }] });
    expect(ids(await f('EQ', { value: '1250' }))).toEqual(['1001']);
    expect(ids(await f('EQ', { value: 'CUSTOMER' }, 'lifecyclestage')).length).toBe(7);
    expect(ids(await f('NEQ', { value: 'customer' }, 'lifecyclestage'))).not.toContain('1001');
    expect(ids(await f('GT', { value: '1500' }))).toEqual(['1005', '1009']);
    expect(ids(await f('GTE', { value: '1720' }))).toEqual(['1005', '1009']);
    expect(ids(await f('LT', { value: '50' }))).toEqual(['1004', '1012']);
    expect(ids(await f('LTE', { value: '30' }))).toEqual(['1004', '1012']);
    expect(ids(await f('BETWEEN', { value: '400', highValue: '700' }))).toEqual(['1006', '1010', '1014']);
    expect(ids(await f('IN', { values: ['starter', 'enterprise'] }, 'favorite_product'))).toEqual(['1001', '1005', '1007', '1008', '1010', '1011', '1012']);
    expect(ids(await f('NOT_IN', { values: ['customer', 'opportunity', 'lead'] }, 'lifecyclestage'))).toEqual(['1007', '1012', '1013']);
    expect(ids(await f('HAS_PROPERTY', {}, 'onboarding_date'))).toEqual(['1001', '1002', '1005', '1006', '1009', '1010', '1011']);
    expect(ids(await f('NOT_HAS_PROPERTY', {}, 'company'))).toEqual(['1013']);
    expect(ids(await f('CONTAINS_TOKEN', { value: '*@initech.com' }, 'email'))).toEqual(['1009', '1010']);
    expect(ids(await f('CONTAINS_TOKEN', { value: 'manager' }, 'jobtitle'))).toEqual(['1005', '1008', '1009', '1011']);
    expect(ids(await f('NOT_CONTAINS_TOKEN', { value: 'manager' }, 'jobtitle'))).not.toContain('1005');
    expect(ids(await f('GTE', { value: '2023-07-01' }, 'onboarding_date'))).toEqual(['1002', '1010']);
  });

  it('ORs filter groups and ANDs filters', async () => {
    const res = await run({
      limit: 100,
      filterGroups: [
        { filters: [{ propertyName: 'country', operator: 'EQ', value: 'Germany' }] },
        { filters: [{ propertyName: 'country', operator: 'EQ', value: 'United Kingdom' }, { propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] },
      ],
    });
    expect(ids(res)).toEqual(['1001', '1008']);
  });

  it('sorts (objects or strings) and pages', async () => {
    const asc = await run({ sorts: [{ propertyName: 'amount', direction: 'ASCENDING' }], limit: 3 }, 'deals');
    expect(ids(asc)).toEqual(['3008', '3006', '3003']);
    expect(asc.body.total).toBe(10);
    expect(asc.body.paging.next.after).toBe('3');
    const desc = await run({ sorts: ['-amount'], limit: 2, after: '2' }, 'deals');
    expect(ids(desc)).toEqual(['3004', '3009']);
    const last = await run({ limit: 5, after: '5' }, 'deals');
    expect(last.body.paging).toBeUndefined();
  });

  it('returns requested properties plus the defaults', async () => {
    const res = await run({ query: 'ada', properties: ['email'] });
    expect(Object.keys(res.body.results[0].properties).sort()).toEqual(['createdate', 'email', 'hs_object_id', 'lastmodifieddate']);
    const defaults = await run({ query: 'ada' });
    expect(Object.keys(defaults.body.results[0].properties)).toContain('firstname');
  });

  it('validates like HubSpot', async () => {
    expect((await run({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'LIKE', value: 'x' }] }] })).status).toBe(400);
    expect((await run({ filterGroups: [{ filters: [{ propertyName: 'nope', operator: 'EQ', value: 'x' }] }] })).status).toBe(400);
    expect((await run({ filterGroups: Array.from({ length: 6 }, () => ({ filters: [] })) })).status).toBe(400);
    expect((await run({ limit: 500 })).status).toBe(400);
  });

  it('compares numbers, dates and text', () => {
    expect(compareValues('10', '9')).toBe(1);
    expect(compareValues('2024-01-01', '2023-12-31')).toBe(1);
    expect(compareValues('apple', 'Banana')).toBeLessThan(0);
  });
});

describe('fake controls', () => {
  it('injects failures', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    f.failNext({ match: '/crm/v3/owners', status: 429, headers: { 'Retry-After': '1' }, times: 2 });
    expect((await api(f, accessToken, '/crm/v3/owners')).status).toBe(429);
    expect((await api(f, accessToken, '/crm/v3/objects/contacts/1001')).status).toBe(200);
    expect((await api(f, accessToken, '/crm/v3/owners')).status).toBe(429);
    expect((await api(f, accessToken, '/crm/v3/owners')).status).toBe(200);
  });

  it('expires and revokes tokens', async () => {
    const f = fake();
    const { accessToken, refreshToken } = f.issueTokens();
    f.expireAccessTokens();
    expect((await api(f, accessToken, '/crm/v3/owners')).status).toBe(401);
    f.revokeRefreshTokens();
    expect((await exchange(f, { grant_type: 'refresh_token', refresh_token: refreshToken })).status).toBe(400);
  });

  it('logs requests', async () => {
    const f = fake();
    const { accessToken } = f.issueTokens();
    await api(f, accessToken, '/crm/v3/owners?limit=1');
    expect(f.requests.at(-1)).toMatchObject({ method: 'GET', path: '/crm/v3/owners', search: '?limit=1', token: accessToken });
  });

  it('delegates developer-project paths to the projects fake with a known personal access key', async () => {
    const f = fake({ personalAccessKeys: { 'pat-na1-extra': 999 } });
    expect(f.projects.personalAccessKeys.get(FAKE_PERSONAL_ACCESS_KEY)).toBe(12345678);
    expect(f.projects.personalAccessKeys.get('pat-na1-extra')).toBe(999);
    const res = await f.fetch(`${API}/localdevauth/v1/auth/refresh`, { method: 'POST', body: JSON.stringify({ encodedOAuthRefreshToken: FAKE_PERSONAL_ACCESS_KEY }) });
    expect(await res.text()).not.toContain('Unknown fake endpoint');
  });
});

describe('demo app pages (the "Finish in HubSpot" checklist links)', () => {
  it('serves friendly stand-ins for install, settings, a record, a record list and the project page', async () => {
    const f = fake();
    const page = async (path: string) => {
      const res = await f.fetch(`${APP}${path}`);
      return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
    };
    const install = await page(`/static-token/${f.portalId}/authorize?appId=1003`);
    expect(install.status).toBe(200);
    expect(install.type).toContain('text/html');
    expect(install.text).toContain('Install your app');
    expect((await page(`/settings/${f.portalId}`)).text).toContain('Record Customization');
    const contact = f.seed.records.get('contacts')![0];
    const record = await page(`/contacts/${f.portalId}/record/0-1/${contact.id}`);
    expect(record.text).toContain(String(contact.properties.firstname));
    expect(record.text).toContain('Your app cards show here');
    const list = await page(`/contacts/${f.portalId}/objects/0-3`);
    expect(list.text).toContain(`/contacts/${f.portalId}/record/0-3/`);
    expect((await page(`/developer-projects/${f.portalId}/project/my-hubspot-cards`)).text).toContain('“my-hubspot-cards”');
    // Values from the seed are escaped; unknown pages are still HubSpot-style errors.
    expect((await page(`/contacts/${f.portalId}/record/0-1/nope`)).text).toContain('no such record');
    const unknown = await f.fetch(`${APP}/nothing-here`);
    expect(unknown.status).toBe(404);
  });
});
