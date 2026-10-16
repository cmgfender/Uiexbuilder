// @vitest-environment node
/**
 * Terminal-free deploy against the fake HubSpot: key exchange, project create, upload (zip + IR),
 * the stepped build → deploy state machine, failures, expired access, who may deploy (sign-in,
 * ALLOWED_PORTALS) and the browser binding / replay safety of deploy jobs.
 */
import { describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../testing';
import type { ConnectorErrorBody, DeployKeyInfo, DeployRequest, DeployStatus } from '../../../src/connect/types';
import { FAKE_PERSONAL_ACCESS_KEY } from '../../fake-hubspot/handler';
import { fakeProjects } from '../../fake-hubspot/projects';
import { sampleProjectFiles, type SampleProjectOptions } from './testFixtures';
import { AUTODEPLOY_WAIT_POLLS, MAX_TRANSIENT_ERRORS, PRIVATE_APP_TOKEN_HELP, unsealJob } from './job';

const PORTAL = 12345678;
/** The browser-binding cookie on https (TEST_APP_URL). */
const BINDING_COOKIE = '__Host-uiex_deploy';
const SESSION_COOKIE = '__Host-uiex_session';

/** A connector with HubSpot sign-in set up and a signed-in browser (deploying needs both). */
async function setup(opts: Parameters<typeof createTestEnv>[0] = {}): Promise<TestEnv> {
  const env = createTestEnv(opts);
  fakeProjects(env.fake.projects).setNow(env.now);
  await env.signIn();
  return env;
}

/** A connector before HubSpot sign-in is set up (the host deploys the connector's own app). */
function setupMode(opts: Parameters<typeof createTestEnv>[0] = {}): TestEnv {
  const env = createTestEnv({ ...opts, env: { HUBSPOT_CLIENT_ID: '', HUBSPOT_CLIENT_SECRET: '', ...opts.env } });
  fakeProjects(env.fake.projects).setNow(env.now);
  return env;
}

function request(overrides: Partial<DeployRequest> = {}, project: SampleProjectOptions = {}): DeployRequest {
  return {
    personalAccessKey: FAKE_PERSONAL_ACCESS_KEY,
    projectName: project.name ?? 'deal-desk',
    platformVersion: project.platformVersion ?? '2026.03',
    files: sampleProjectFiles(project),
    ...overrides,
  };
}

async function start(env: TestEnv, body: unknown): Promise<{ status: number; body: DeployStatus & ConnectorErrorBody }> {
  const res = await env.call('/api/deploy', { json: body });
  return { status: res.status, body: (await res.json()) as DeployStatus & ConnectorErrorBody };
}

async function poll(env: TestEnv, deployId: string, init: { cookies?: boolean } = {}): Promise<{ status: number; body: DeployStatus & ConnectorErrorBody }> {
  const res = await env.call('/api/deploy/status', { json: { deployId }, ...init });
  return { status: res.status, body: (await res.json()) as DeployStatus & ConnectorErrorBody };
}

const queueCalls = (env: TestEnv) => env.fake.requests.filter((r) => r.method === 'POST' && r.path === '/dfs/deploy/v3/deploys/queue/async').length;

/** Poll until success / failed; returns the final status and the phases seen. */
async function runToEnd(env: TestEnv, first: DeployStatus, max = 40): Promise<{ final: DeployStatus; phases: string[]; ids: string[] }> {
  let s = first;
  const phases = [s.phase];
  const ids = [s.deployId];
  for (let i = 0; i < max && s.phase !== 'success' && s.phase !== 'failed'; i++) {
    env.advance(1500);
    const r = await poll(env, s.deployId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    s = r.body;
    phases.push(s.phase);
    ids.push(s.deployId);
  }
  return { final: s, phases, ids };
}

describe('POST /api/deploy + polling (success)', () => {
  it('uploads the project like `hs project upload` and follows the automatic deploy to the end', async () => {
    const env = await setup();
    const { status, body } = await start(env, request());
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      phase: 'building',
      portalId: PORTAL,
      projectName: 'deal-desk',
      projectUrl: `https://app.hubspot.com/developer-projects/${PORTAL}/project/deal-desk`,
    });
    expect(body.buildId).toBeGreaterThan(0);
    expect(body.message).toMatch(/building your project \(build #\d+\)/);
    expect(body.log).toEqual([
      `Signed in to HubSpot account ${PORTAL} (Acme Demo (fake)) with your personal access key.`,
      'Created the project “deal-desk” in HubSpot.',
      `Uploaded 15 files. HubSpot started build #${body.buildId}.`,
    ]);

    // What reached HubSpot: the srcDir contents as a zip + the IR, like the CLI sends.
    const upload = fakeProjects(env.fake.projects).uploads[0];
    expect(upload).toMatchObject({ portalId: PORTAL, projectName: 'deal-desk', platformVersion: '2026.03', buildMessage: 'Uploaded from UI Extension Builder', skipAutoDeploy: false, zipFileName: 'deal-desk.zip' });
    expect([...upload.files.keys()]).toContain('app/cards/DealCard.tsx');
    expect(upload.files.get('app/cards/DealCard.tsx')).toContain('Héllo ✓ deals');
    expect(upload.files.has('hsproject.json')).toBe(false);
    expect(upload.files.has('app/cards/.prettierrc.json')).toBe(false);
    const nodes = upload.uploadRequest.intermediateNodesIndexedByUid as Record<string, { componentType: string; metaFilePath: string }>;
    expect(Object.keys(nodes).sort()).toEqual(['app_home', 'deal_card_card', 'deal_desk', 'get_weather', 'hubspot-serverless-package-uid', 'settings']);
    expect(nodes.deal_card_card).toMatchObject({ componentType: 'CARD', metaFilePath: 'app/cards/DealCard-hsmeta.json' });
    expect(upload.uploadRequest.profileData).toEqual({ vars: { profileVariables: {} } });

    // The request carried the key, but neither the key nor the access token is readable in the deployId.
    expect(body.deployId).not.toContain(FAKE_PERSONAL_ACCESS_KEY);
    expect(body.deployId).not.toContain('fake-pak-at');
    expect(body.deployId.length).toBeLessThan(8000);
    const state = await unsealJob(env.config, body.deployId);
    expect(state).toMatchObject({ s: 'build', p: PORTAL, n: 'deal-desk', b: body.buildId, au: 'deal_desk' });
    expect(JSON.stringify(state)).not.toContain(FAKE_PERSONAL_ACCESS_KEY);

    const { final, phases, ids } = await runToEnd(env, body);
    expect(final.phase, final.message).toBe('success');
    expect(phases).toEqual(['building', 'building', 'building', 'deploying', 'deploying', 'deploying', 'deploying', 'success']);
    expect(new Set(ids).size).toBe(ids.length); // a fresh deployId every step
    expect(final.message).toBe('Your project is live in HubSpot.');
    expect(final.log).toEqual([
      ...body.log,
      `Build #${body.buildId} succeeded.`,
      `HubSpot is deploying build #${body.buildId} automatically.`,
      `Deployed build #${body.buildId}.`,
    ]);
    expect(final.installUrl).toMatch(new RegExp(`^https://app\\.hubspot\\.com/static-token/${PORTAL}/authorize\\?appId=\\d+$`));
    expect(final.error).toBeUndefined();
    expect(fakeProjects(env.fake.projects).project('deal-desk')?.deployedBuildId).toBe(body.buildId);

    // A finished deployId keeps answering the final status without calling HubSpot.
    const before = env.fake.requests.length;
    const again = await poll(env, final.deployId);
    expect(again.body).toEqual(final);
    expect(env.fake.requests.length).toBe(before);

    // Second deploy reuses the project.
    const second = await start(env, request());
    expect(second.body.log[1]).toBe('Found the project “deal-desk” in HubSpot.');
  });

  it('deploys the build itself when automatic deploys are off (like `hs project deploy`)', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-no-autodeploy-0000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
    expect(final.log.join('\n')).toMatch(/Automatic deploys are turned off for this project, so the builder is deploying build #\d+ now\./);
    expect(final.log.join('\n')).toMatch(/Deploying build #\d+\./);
  });

  it('waits for a slow automatic deploy to start', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-slow-autodeploy-000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
  });

  it('collects build and deploy warnings (deduplicated) into the log', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-warn-00000000000000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
    const warnings = final.log.filter((l) => l.startsWith('Warning:'));
    expect(warnings).toEqual([
      'Warning: Card "deal_card_card" has no description; HubSpot shows the card name instead.',
      'Warning: The app was updated; users may need to refresh open record pages.',
    ]);
  });

  it('gives no install link for OAuth / marketplace apps', async () => {
    const env = await setup();
    const { body } = await start(env, request({}, { authType: 'oauth', distribution: 'marketplace' }));
    const { final, phases } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
    expect(final.installUrl).toBeUndefined();
    expect(phases.filter((p) => p === 'deploying')).toHaveLength(3);
  });

  it('survives HubSpot hiccups while polling, but gives up after a while', async () => {
    const env = await setup();
    const { body } = await start(env, request());
    env.fake.failNext({ match: '/builds/', status: 503, times: 2 });
    const r1 = await poll(env, body.deployId);
    expect(r1.body.phase).toBe('building');
    expect(r1.body.message).toMatch(/busy/);
    const { final } = await runToEnd(env, r1.body);
    expect(final.phase).toBe('success');

    const env2 = await setup();
    const s2 = await start(env2, request());
    env2.fake.failNext({ match: '/builds/', status: 429, headers: { 'Retry-After': '1' }, times: 50 });
    let s = s2.body;
    for (let i = 0; i < MAX_TRANSIENT_ERRORS; i++) s = (await poll(env2, s.deployId)).body;
    expect(s.phase).toBe('failed');
    expect(s.error).toBe('hubspot_unavailable');
  });
});

describe('deploy failures', () => {
  it('reports a failed build with the errors HubSpot gave (dependents skipped)', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'fail-build-key-00000000000000' }));
    expect(body.phase).toBe('building');
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('failed');
    expect(final.error).toBe('build_failed');
    expect(final.message).toMatch(/couldn't build your project \(build #\d+\)/);
    expect(final.log).toContain('deal_card_card failed: Card deal_card_card failed to compile');
    expect(final.log).toContain("• src/app/cards/Card.tsx(12,7): error TS2304: Cannot find name 'contact'.");
    expect(final.log.join('\n')).not.toMatch(/Dependent build failed/);
    expect(final.projectUrl).toContain('/project/deal-desk');
  });

  it('reports a failed deploy', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-fail-deploy-000000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'deploy_failed' });
    expect(final.log.join('\n')).toMatch(/Could not deploy deal_desk: the app's scopes changed/);
  });

  it('explains a blocked deploy', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-blocked-deploy-0000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'deploy_blocked' });
    expect(final.message).toMatch(/paused the deploy/);
    expect(final.log).toContain('old_card (CARD): This deploy removes the card "old_card", which is still shown on record pages.');
  });

  it('gives up when HubSpot never starts the automatic deploy', async () => {
    const env = await setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-skip-autodeploy-000000000' }));
    const { final, phases } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'autodeploy_missing' });
    expect(phases.filter((p) => p === 'deploying').length).toBe(AUTODEPLOY_WAIT_POLLS);
  });

  it('rejects an invalid or malformed key before uploading anything', async () => {
    const env = await setup();
    const r = await start(env, request({ personalAccessKey: 'CiRuYTEt-00000000-not-a-real-key-0000' }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_key');
    expect(r.body.error.message).toMatch(/didn't accept this personal access key/);
    expect((await start(env, request({ personalAccessKey: 'abc' }))).body.error.code).toBe('invalid_key');
    expect((await start(env, request({ personalAccessKey: 'pat na1 with spaces in the key' }))).body.error.code).toBe('invalid_key');
    const missing = await start(env, request({ personalAccessKey: '' }));
    expect(missing.body.error).toMatchObject({ code: 'missing_key', message: 'Paste your personal access key.' });
    expect(fakeProjects(env.fake.projects).uploads).toHaveLength(0);
  });

  it('explains a key without the developer projects permission', async () => {
    const env = await setup();
    const r = await start(env, request({ personalAccessKey: 'pat-na1-fake-no-projects-scope-00000000' }));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('missing_scope');
    expect(r.body.error.message).toMatch(/“Developer projects” permission/);
    expect(r.body.error.requiredScopes).toEqual(['developer.projects.write']);
  });

  it('explains a locked project', async () => {
    const env = await setup();
    const r = await start(env, request({ personalAccessKey: 'pat-na1-fake-project-locked-0000000000' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('project_locked');
    expect(r.body.error.message).toMatch(/locked/);
  });

  it('refuses unsafe or inconsistent projects before contacting HubSpot', async () => {
    const env = await setup();
    const files = sampleProjectFiles();
    const cases: Array<[unknown, number, string]> = [
      [{ ...request(), files: [...files, { path: '../../etc/passwd', contents: 'x' }] }, 400, 'invalid_files'],
      [{ ...request(), files: [...files, { path: '/abs.txt', contents: 'x' }] }, 400, 'invalid_files'],
      [{ ...request(), projectName: 'other' }, 400, 'invalid_project'],
      [{ ...request(), projectName: '../evil' }, 400, 'invalid_project'],
      [{ ...request(), platformVersion: '2026.09' }, 400, 'invalid_project'],
      [request({}, { platformVersion: '2025.1' }), 400, 'unsupported_platform'],
      [request({}, { platformVersion: 'latest' }), 400, 'invalid_project'],
      [{ ...request(), files: files.filter((f) => f.path !== 'src/app/app-hsmeta.json') }, 400, 'invalid_project'],
      [{ ...request(), files: files.map((f) => (f.path === 'src/app/settings/settings-hsmeta.json' ? { ...f, path: 'src/app/cards/settings-hsmeta.json' } : f)) }, 400, 'invalid_project'],
      [{ ...request(), portalId: -5 }, 400, 'bad_request'],
      [[], 400, 'bad_request'],
    ];
    for (const [body, status, code] of cases) {
      env.advance(60_000); // stay under the deploy rate limit
      const r = await start(env, body);
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      expect(r.body.error.code, JSON.stringify(r.body)).toBe(code);
    }
    expect(env.fake.requests.filter((r) => r.path.startsWith('/localdevauth/'))).toHaveLength(0);
    const wrongDir = await start(env, cases[8][0]);
    expect(wrongDir.body.error.message).toMatch(/The directory 'app\/cards' is incorrect for type 'settings'/);
  });

  it('refuses a platform version HubSpot has no schemas for', async () => {
    const env = await setup();
    const r = await start(env, request({}, { platformVersion: '2027.03' }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('platform_unavailable');
  });

  it('needs the CSRF header, the feature switch and a session secret', async () => {
    const env = await setup();
    const res = await env.call('/api/deploy', { json: request(), csrf: false });
    expect(res.status).toBe(403);
    const off = setupMode({ config: { enableDeploy: false } });
    const r = await start(off, request());
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('feature_disabled');
    const noSecret = setupMode({ env: { SESSION_SECRET: '' } });
    const r2 = await start(noSecret, request());
    expect(r2.status).toBe(503);
    expect(r2.body.error.code).toBe('not_configured');
  });

  it('refuses huge request bodies', async () => {
    const env = await setup();
    const big = 'x'.repeat(6 * 1024 * 1024);
    const r = await start(env, { ...request(), files: [{ path: 'big.txt', contents: big }] });
    expect(r.status).toBe(413);
  });
});

describe('deployId tokens and expiry', () => {
  it('rejects tampered and expired deployIds', async () => {
    const env = await setup();
    const { body } = await start(env, request());
    const tampered = `${body.deployId.slice(0, -4)}AAAA`;
    const r = await poll(env, tampered);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('deploy_not_found');
    expect((await poll(env, 'nonsense')).status).toBe(404);
    env.advance(61 * 60 * 1000);
    const late = await poll(env, body.deployId);
    expect(late.status).toBe(404);
    expect(late.body.error.message).toMatch(/expire after an hour/);
  });

  it('fails clearly when HubSpot access expires mid-deploy', async () => {
    const env = await setup();
    const { body } = await start(env, request());
    fakeProjects(env.fake.projects).expireAccessTokens();
    const r = await poll(env, body.deployId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phase: 'failed', error: 'expired' });
    expect(r.body.message).toMatch(/expired before it finished/);
    expect(r.body.projectUrl).toContain('/project/deal-desk');
  });
});

describe('who may deploy', () => {
  it('needs a HubSpot sign-in once sign-in is set up', async () => {
    const env = createTestEnv();
    fakeProjects(env.fake.projects).setNow(env.now);
    const r = await start(env, request());
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('not_connected');
    expect(r.body.error.message).toMatch(/Connect HubSpot first/);
    // Refused before the key is sent anywhere.
    expect(env.fake.requests.filter((q) => q.path.startsWith('/localdevauth/'))).toHaveLength(0);
  });

  it('confirms the sign-in with HubSpot before deploying: a copied cookie of a signed-out session cannot deploy', async () => {
    const env = await setup();
    const copied = env.jar.get(SESSION_COOKIE)!;
    await env.call('/api/auth/logout', { method: 'POST' });
    env.jar.set(SESSION_COOKIE, copied);
    const r = await start(env, request());
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('not_connected');
    expect(fakeProjects(env.fake.projects).uploads).toHaveLength(0);
  });

  it('only deploys to the connected account', async () => {
    const otherKey = 'CiRuYTEt-other-portal-key-000000000000';
    const env = await setup({ fake: { personalAccessKeys: { [otherKey]: 999 } } });
    const r = await start(env, request({ personalAccessKey: otherKey }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'portal_mismatch', portalId: 999 });
    expect(r.body.error.message).toMatch(/belongs to HubSpot account 999 \(Fake account 999\), but you're connected to account 12345678/);
    // Asking for the other account does not help while connected to this one.
    const forced = await start(env, request({ personalAccessKey: otherKey, portalId: 999 }));
    expect(forced.status).toBe(409);
    expect(fakeProjects(env.fake.projects).uploads).toHaveLength(0);
  });

  it('before sign-in is set up, deploys with the key alone (first-time setup), rate limited per client', async () => {
    const env = setupMode();
    const first = await start(env, request());
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const { final } = await runToEnd(env, first.body);
    expect(final.phase).toBe('success');
    for (let i = 0; i < 3; i++) expect((await start(env, request())).status).toBe(200);
    const limited = await env.call('/api/deploy', { json: request() });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(((await limited.json()) as ConnectorErrorBody).error.code).toBe('rate_limited');
    // Another client has its own allowance.
    const other = await env.call('/api/deploy', { json: request(), clientIp: '203.0.113.9' });
    expect(other.status).toBe(200);
  });

  it('refuses accounts that are not on ALLOWED_PORTALS', async () => {
    const env = setupMode({ env: { ALLOWED_PORTALS: '111, 222' } });
    const r = await start(env, request());
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('portal_not_allowed');
    expect(fakeProjects(env.fake.projects).uploads).toHaveLength(0);
    const ok = setupMode({ env: { ALLOWED_PORTALS: `111, ${PORTAL}` } });
    expect((await start(ok, request())).status).toBe(200);
  });

  it('never stores a personal access key', async () => {
    const env = await setup();
    const { body } = await start(env, request({ remember: true }));
    expect(body.phase).toBe('building');
    expect(body.log.join('\n')).not.toMatch(/saved|remember/i);
    expect(((await (await env.call('/api/deploy/key')).json()) as DeployKeyInfo).remembered).toBe(false);
    for (const name of env.jar.names()) expect(env.jar.get(name)).not.toContain(FAKE_PERSONAL_ACCESS_KEY);
    const none = await start(env, { ...request({ personalAccessKey: undefined }), useRememberedKey: true });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('no_remembered_key');
    expect((await env.call('/api/deploy/key', { method: 'DELETE' })).status).toBe(200);
  });

  it('explains a private app token pasted instead of a personal access key', async () => {
    const env = await setup();
    const r = await start(env, request({ personalAccessKey: ['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-') }));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'invalid_key', message: PRIVATE_APP_TOKEN_HELP });
  });

  it('uses the EU app host for EU keys', async () => {
    const euKey = 'pat-eu1-fake0000-0000-4000-8000-000000000009';
    const env = setupMode({ fake: { personalAccessKeys: { [euKey]: PORTAL } } });
    const { body } = await start(env, request({ personalAccessKey: euKey }));
    expect(body.projectUrl).toBe(`https://app-eu1.hubspot.com/developer-projects/${PORTAL}/project/deal-desk`);
  });
});

describe('deploy jobs are bound to the browser and safe to replay', () => {
  it('can only be followed by the browser that started it (the deployId alone is not enough)', async () => {
    const env = await setup();
    const { body } = await start(env, request());
    const set = env.jar.get(BINDING_COOKIE);
    expect(set).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Someone who only has the deployId (e.g. from a log line): refused.
    const stranger = await poll(env, body.deployId, { cookies: false });
    expect(stranger.status).toBe(404);
    expect(stranger.body.error.code).toBe('deploy_not_found');
    // Another browser (its own binding cookie): refused.
    const other = createTestEnv();
    other.jar.set(BINDING_COOKIE, 'x'.repeat(43));
    const res = await other.call('/api/deploy/status', { json: { deployId: body.deployId } });
    expect(res.status).toBe(404);
    // The browser that started it: fine (and the old GET form still works for older clients).
    expect((await poll(env, body.deployId)).status).toBe(200);
    const legacy = await env.call(`/api/deploy/${encodeURIComponent(body.deployId)}`);
    expect(legacy.status).toBe(200);
    // Every deploy from this browser reuses its binding.
    await start(env, request());
    expect(env.jar.get(BINDING_COOKIE)).toBe(set);
  });

  it('never queues a build twice or rolls back to an older one when an old deployId is replayed', async () => {
    const key = 'CiRuYTEt-fake-no-autodeploy-000000000000';
    const env = await setup();
    const first = await start(env, request({ personalAccessKey: key }));
    const run1 = await runToEnd(env, first.body);
    expect(run1.final.phase).toBe('success');
    expect(queueCalls(env)).toBe(1);
    const states = await Promise.all(run1.ids.map((id) => unsealJob(env.config, id)));
    const queueId = run1.ids[states.findIndex((st) => st?.s === 'queue')];
    expect(queueId).toBeTruthy();

    // Replaying the queue step after the build went live: no second deploy.
    const replay = await poll(env, queueId);
    expect(replay.body.log).toContain(`Build #${first.body.buildId} is already deployed.`);
    expect((await runToEnd(env, replay.body)).final.phase).toBe('success');
    expect(queueCalls(env)).toBe(1);

    // A newer build goes live; replaying the old queue step must not roll it back.
    const second = await start(env, request({ personalAccessKey: key }));
    const run2 = await runToEnd(env, second.body);
    expect(run2.final.phase).toBe('success');
    expect(queueCalls(env)).toBe(2);
    const rollback = await poll(env, queueId);
    expect(rollback.body).toMatchObject({ phase: 'failed', error: 'superseded' });
    expect(rollback.body.message).toMatch(new RegExp(`newer build \\(#${second.body.buildId}\\)`));
    expect(queueCalls(env)).toBe(2);
    expect(fakeProjects(env.fake.projects).project('deal-desk')?.deployedBuildId).toBe(second.body.buildId);
  });
});
