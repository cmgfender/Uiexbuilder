// @vitest-environment node
/**
 * POST /api/deploy/check-key (the builder checks a personal access key before uploading anything)
 * and the key / account details deploy errors carry (missing permission, an account without
 * developer projects, a user without developer tools, another account, ALLOWED_PORTALS).
 */
import { describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../testing';
import type { ConnectorErrorBody, DeployKeyCheck, DeployRequest, DeployStatus } from '../../../src/connect/types';
import { FAKE_OTHER_ACCOUNT_KEY, FAKE_PERSONAL_ACCESS_KEY } from '../../fake-hubspot/handler';
import { FAKE_OTHER_PORTAL_ID, fakeProjects } from '../../fake-hubspot/projects';
import { sampleProjectFiles } from './testFixtures';
import { RATE_RULES } from '../rateLimit';

const PORTAL = 12345678;
const KEY_PAGE = `https://app.hubspot.com/personal-access-key/${PORTAL}`;
/** Keys the fake accepts for the demo account with a failure mode switched on (built at runtime). */
const modeKey = (mode: string) => ['CiRuYTEt', 'fake', 'key', mode, '0000000001'].join('-');

async function setup(opts: Parameters<typeof createTestEnv>[0] = {}): Promise<TestEnv> {
  const env = createTestEnv(opts);
  fakeProjects(env.fake.projects).setNow(env.now);
  await env.signIn();
  return env;
}

async function check(env: TestEnv, body: unknown, init: { csrf?: boolean } = {}): Promise<{ status: number; body: DeployKeyCheck & ConnectorErrorBody }> {
  const res = await env.call('/api/deploy/check-key', { json: body, ...init });
  return { status: res.status, body: (await res.json()) as DeployKeyCheck & ConnectorErrorBody };
}

function deployRequest(key: string): DeployRequest {
  return { personalAccessKey: key, projectName: 'deal-desk', platformVersion: '2026.03', files: sampleProjectFiles() };
}

async function deploy(env: TestEnv, key: string): Promise<{ status: number; body: DeployStatus & ConnectorErrorBody }> {
  const res = await env.call('/api/deploy', { json: deployRequest(key) });
  return { status: res.status, body: (await res.json()) as DeployStatus & ConnectorErrorBody };
}

const uploads = (env: TestEnv) => fakeProjects(env.fake.projects).uploads.length;

describe('POST /api/deploy/check-key', () => {
  it('names the account the key belongs to and confirms the Developer projects permission', async () => {
    const env = await setup();
    const r = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      key: { portalId: PORTAL, name: 'Acme Demo (fake)', accountType: 'STANDARD', developerProjects: 'yes', keyPageUrl: KEY_PAGE },
      target: { portalId: PORTAL, name: 'acmedemo.com' },
    });
    // Nothing was uploaded, and neither the key nor HubSpot's access token comes back.
    expect(uploads(env)).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain(FAKE_PERSONAL_ACCESS_KEY);
    expect(JSON.stringify(r.body)).not.toContain('fake-pak-at');
  });

  it('finds a key without Developer projects from the scope groups of the exchange, and sees it fixed on "Check again"', async () => {
    const env = await setup();
    const fake = fakeProjects(env.fake.projects);
    fake.setDeveloperProjects(FAKE_PERSONAL_ACCESS_KEY, false);
    const r = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, problem: 'missing_permission', key: { portalId: PORTAL, developerProjects: 'no', keyPageUrl: KEY_PAGE } });
    expect(r.body.message).toBe(
      'Your personal access key for Acme Demo (fake) (account 12345678) doesn’t have the “Developer projects” permission, so HubSpot won’t accept projects from it. On HubSpot’s personal access key page, add Developer projects to the key (or create a new key with it ticked), then check the key again.',
    );
    // The admin adds the permission on HubSpot's key page; the same key now passes.
    fake.setDeveloperProjects(FAKE_PERSONAL_ACCESS_KEY, true);
    expect((await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY })).body).toMatchObject({ ok: true, key: { developerProjects: 'yes' } });
  });

  it('says when the key belongs to another account than the connected one', async () => {
    const env = await setup();
    const r = await check(env, { personalAccessKey: FAKE_OTHER_ACCOUNT_KEY });
    expect(r.body).toMatchObject({
      ok: false,
      problem: 'portal_mismatch',
      key: { portalId: FAKE_OTHER_PORTAL_ID, name: 'Other Co (fake)', keyPageUrl: `https://app.hubspot.com/personal-access-key/${FAKE_OTHER_PORTAL_ID}` },
      target: { portalId: PORTAL, name: 'acmedemo.com' },
    });
    expect(r.body.message).toMatch(/belongs to HubSpot account 87654321 \(Other Co \(fake\)\), but you're connected to account 12345678/);
  });

  it('applies ALLOWED_PORTALS, and before sign-in is set up checks the key alone', async () => {
    const env = createTestEnv({ env: { HUBSPOT_CLIENT_ID: '', HUBSPOT_CLIENT_SECRET: '', ALLOWED_PORTALS: '111' } });
    const r = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: false, problem: 'portal_not_allowed', key: { portalId: PORTAL } });
    expect(r.body.target).toBeUndefined();
    expect(r.body.message).toMatch(/ALLOWED_PORTALS/);
    const open = createTestEnv({ env: { HUBSPOT_CLIENT_ID: '', HUBSPOT_CLIENT_SECRET: '' } });
    expect((await check(open, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY, portalId: 999 })).body).toMatchObject({ ok: false, problem: 'portal_mismatch', target: { portalId: 999 } });
    expect((await check(open, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY })).body).toMatchObject({ ok: true });
  });

  it('reports a key HubSpot refuses, a malformed or missing key and a private app token as key errors', async () => {
    const env = await setup();
    const refused = await check(env, { personalAccessKey: 'CiRuYTEt-00000000-not-a-real-key-0000' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({ code: 'invalid_key' });
    expect((await check(env, { personalAccessKey: 'abc' })).body.error.code).toBe('invalid_key');
    expect((await check(env, { personalAccessKey: '' })).body.error).toMatchObject({ code: 'missing_key', message: 'Paste your personal access key.' });
    const pat = await check(env, { personalAccessKey: ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-') });
    expect(pat.body.error.message).toMatch(/private app access token/);
    expect((await check(env, 'nope')).body.error.code).toBe('bad_request');
    expect((await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY, portalId: -1 })).body.error.code).toBe('bad_request');
  });

  it('needs a sign-in once sign-in is set up, and the CSRF header', async () => {
    const env = createTestEnv();
    const r = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('not_connected');
    expect(env.fake.requests.filter((q) => q.path.startsWith('/localdevauth/'))).toHaveLength(0);
    const signed = await setup();
    expect((await check(signed, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY }, { csrf: false })).status).toBe(403);
  });

  it('is rate limited: per signed-in user, and more strictly per client IP before sign-in is set up', async () => {
    const env = await setup();
    for (let i = 0; i < RATE_RULES.keyCheck.capacity; i++) expect((await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY })).status).toBe(200);
    const limited = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(limited.status).toBe(429);
    expect(limited.body.error.message).toMatch(/key checks/);
    const open = createTestEnv({ env: { HUBSPOT_CLIENT_ID: '', HUBSPOT_CLIENT_SECRET: '' } });
    for (let i = 0; i < RATE_RULES.keyCheckSetup.capacity; i++) expect((await check(open, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY })).status).toBe(200);
    expect((await check(open, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY })).status).toBe(429);
  });

  it('is switched off with deploying', async () => {
    const env = await setup({ env: { ENABLE_DEPLOY: 'false' } });
    const r = await check(env, { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('feature_disabled');
  });
});

describe('deploy errors name the key and its account', () => {
  it('missing Developer projects (MISSING_SCOPES): 403 missing_scope with the account and its key page', async () => {
    const env = await setup();
    fakeProjects(env.fake.projects).setDeveloperProjects(FAKE_PERSONAL_ACCESS_KEY, false);
    const r = await deploy(env, FAKE_PERSONAL_ACCESS_KEY);
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({
      code: 'missing_scope',
      requiredScopes: ['developer.projects.write'],
      key: { portalId: PORTAL, name: 'Acme Demo (fake)', developerProjects: 'no', keyPageUrl: KEY_PAGE },
    });
    expect(r.body.error.message).toMatch(/for Acme Demo \(fake\) \(account 12345678\) doesn’t have the “Developer projects” permission/);
    expect(uploads(env)).toBe(0);
  });

  it('developer projects not available in the account (GATED): 403 not_available', async () => {
    const env = await setup();
    const r = await deploy(env, modeKey('gated'));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'not_available', key: { portalId: PORTAL } });
    expect(r.body.error.message).toMatch(/developer projects aren't available in Acme Demo \(fake\) \(account 12345678\)/);
    expect(uploads(env)).toBe(0);
  });

  it("any other 403: forbidden with HubSpot's own words and the usual fix", async () => {
    const env = await setup();
    const r = await deploy(env, modeKey('no-dev-tools'));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatchObject({ code: 'forbidden', key: { portalId: PORTAL } });
    expect(r.body.error.message).toContain('HubSpot said: “The user does not have permission to use developer tools in this account.”');
    expect(r.body.error.message).toMatch(/Super Admin/);
  });

  it('another account: 409 portal_mismatch with both accounts', async () => {
    const env = await setup();
    const r = await deploy(env, FAKE_OTHER_ACCOUNT_KEY);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'portal_mismatch', portalId: FAKE_OTHER_PORTAL_ID, key: { portalId: FAKE_OTHER_PORTAL_ID, name: 'Other Co (fake)' } });
  });

  it('ALLOWED_PORTALS: 403 portal_not_allowed with the key account', async () => {
    const env = createTestEnv({ env: { HUBSPOT_CLIENT_ID: '', HUBSPOT_CLIENT_SECRET: '', ALLOWED_PORTALS: '111' } });
    fakeProjects(env.fake.projects).setNow(env.now);
    const res = await env.call('/api/deploy', { json: deployRequest(FAKE_PERSONAL_ACCESS_KEY) });
    expect(res.status).toBe(403);
    expect(res.headers.get('x-uiex-error-code')).toBe('portal_not_allowed');
    const body = (await res.json()) as ConnectorErrorBody;
    expect(body.error).toMatchObject({ code: 'portal_not_allowed', key: { portalId: PORTAL } });
    expect(body.error.message).toMatch(/ALLOWED_PORTALS/);
  });
});

describe('fake HubSpot: the key page switches the Developer projects permission', () => {
  it('removes and adds back the permission of the demo key, like editing it in HubSpot', async () => {
    const env = createTestEnv();
    const page = async () => (await env.fake.handle(new Request(`https://app.hubspot.com/personal-access-key/${PORTAL}`))).text();
    expect(await page()).toContain('Developer projects</strong> ✓');
    const off = await env.fake.handle(
      new Request(`https://app.hubspot.com/personal-access-key/${PORTAL}/permissions`, { method: 'POST', body: 'developerProjects=off', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
    );
    expect(off.status).toBe(303);
    expect(fakeProjects(env.fake.projects).hasDeveloperProjects(FAKE_PERSONAL_ACCESS_KEY)).toBe(false);
    expect(await page()).toContain('not included');
    await env.fake.handle(new Request(`https://app.hubspot.com/personal-access-key/${PORTAL}/permissions`, { method: 'POST', body: 'developerProjects=on' }));
    expect(fakeProjects(env.fake.projects).hasDeveloperProjects(FAKE_PERSONAL_ACCESS_KEY)).toBe(true);
    // The second account has its own key page and key.
    expect(await (await env.fake.handle(new Request(`https://app.hubspot.com/personal-access-key/${FAKE_OTHER_PORTAL_ID}`))).text()).toContain(FAKE_OTHER_ACCOUNT_KEY);
  });

  it("shows HubSpot's install refusals (no way back to the builder) from the consent page", async () => {
    const env = createTestEnv();
    const res = await env.fake.handle(new Request('https://app.hubspot.com/oauth/authorize/demo-error?kind=aup'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('the app developer has not signed the acceptable use policy');
  });
});
