// @vitest-environment node
/**
 * Terminal-free deploy against the fake HubSpot: key exchange, project create, upload (zip + IR),
 * the stepped build → deploy state machine, failures, expired access and the remembered key.
 */
import { describe, expect, it } from 'vitest';
import { createTestEnv, type TestEnv } from '../testing';
import type { ConnectorErrorBody, DeployKeyInfo, DeployRequest, DeployStatus } from '../../../src/connect/types';
import { FAKE_PERSONAL_ACCESS_KEY } from '../../fake-hubspot/handler';
import { fakeProjects } from '../../fake-hubspot/projects';
import { sampleProjectFiles, type SampleProjectOptions } from './testFixtures';
import { AUTODEPLOY_WAIT_POLLS, MAX_TRANSIENT_ERRORS, unsealJob } from './job';

const PORTAL = 12345678;

function setup(opts: Parameters<typeof createTestEnv>[0] = {}): TestEnv {
  const env = createTestEnv(opts);
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

async function poll(env: TestEnv, deployId: string): Promise<{ status: number; body: DeployStatus & ConnectorErrorBody }> {
  const res = await env.call(`/api/deploy/${encodeURIComponent(deployId)}`);
  return { status: res.status, body: (await res.json()) as DeployStatus & ConnectorErrorBody };
}

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
    const env = setup();
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
    const env = setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-no-autodeploy-0000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
    expect(final.log.join('\n')).toMatch(/Automatic deploys are turned off for this project, so the builder is deploying build #\d+ now\./);
    expect(final.log.join('\n')).toMatch(/Deploying build #\d+\./);
  });

  it('waits for a slow automatic deploy to start', async () => {
    const env = setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-slow-autodeploy-000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
  });

  it('collects build and deploy warnings (deduplicated) into the log', async () => {
    const env = setup();
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
    const env = setup();
    const { body } = await start(env, request({}, { authType: 'oauth', distribution: 'marketplace' }));
    const { final, phases } = await runToEnd(env, body);
    expect(final.phase).toBe('success');
    expect(final.installUrl).toBeUndefined();
    expect(phases.filter((p) => p === 'deploying')).toHaveLength(3);
  });

  it('survives HubSpot hiccups while polling, but gives up after a while', async () => {
    const env = setup();
    const { body } = await start(env, request());
    env.fake.failNext({ match: '/builds/', status: 503, times: 2 });
    const r1 = await poll(env, body.deployId);
    expect(r1.body.phase).toBe('building');
    expect(r1.body.message).toMatch(/busy/);
    const { final } = await runToEnd(env, r1.body);
    expect(final.phase).toBe('success');

    const env2 = setup();
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
    const env = setup();
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
    const env = setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-fail-deploy-000000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'deploy_failed' });
    expect(final.log.join('\n')).toMatch(/Could not deploy deal_desk: the app's scopes changed/);
  });

  it('explains a blocked deploy', async () => {
    const env = setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-blocked-deploy-0000000000' }));
    const { final } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'deploy_blocked' });
    expect(final.message).toMatch(/paused the deploy/);
    expect(final.log).toContain('old_card (CARD): This deploy removes the card "old_card", which is still shown on record pages.');
  });

  it('gives up when HubSpot never starts the automatic deploy', async () => {
    const env = setup();
    const { body } = await start(env, request({ personalAccessKey: 'pat-na1-fake-skip-autodeploy-000000000' }));
    const { final, phases } = await runToEnd(env, body);
    expect(final).toMatchObject({ phase: 'failed', error: 'autodeploy_missing' });
    expect(phases.filter((p) => p === 'deploying').length).toBe(AUTODEPLOY_WAIT_POLLS);
  });

  it('rejects an invalid or malformed key before uploading anything', async () => {
    const env = setup();
    const r = await start(env, request({ personalAccessKey: 'pat-na1-00000000-not-a-real-key-0000' }));
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
    const env = setup();
    const r = await start(env, request({ personalAccessKey: 'pat-na1-fake-no-projects-scope-00000000' }));
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('missing_scope');
    expect(r.body.error.message).toMatch(/“Developer projects” permission/);
    expect(r.body.error.requiredScopes).toEqual(['developer.projects.write']);
  });

  it('explains a locked project', async () => {
    const env = setup();
    const r = await start(env, request({ personalAccessKey: 'pat-na1-fake-project-locked-0000000000' }));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('project_locked');
    expect(r.body.error.message).toMatch(/locked/);
  });

  it('refuses unsafe or inconsistent projects before contacting HubSpot', async () => {
    const env = setup();
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
      const r = await start(env, body);
      expect(r.status, JSON.stringify(r.body)).toBe(status);
      expect(r.body.error.code, JSON.stringify(r.body)).toBe(code);
    }
    expect(env.fake.requests.filter((r) => r.path.startsWith('/localdevauth/'))).toHaveLength(0);
    const wrongDir = await start(env, cases[8][0]);
    expect(wrongDir.body.error.message).toMatch(/The directory 'app\/cards' is incorrect for type 'settings'/);
  });

  it('refuses a platform version HubSpot has no schemas for', async () => {
    const env = setup();
    const r = await start(env, request({}, { platformVersion: '2027.03' }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('platform_unavailable');
  });

  it('needs the CSRF header, the feature switch and a session secret', async () => {
    const env = setup();
    const res = await env.call('/api/deploy', { json: request(), csrf: false });
    expect(res.status).toBe(403);
    const off = setup({ config: { enableDeploy: false } });
    const r = await start(off, request());
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('feature_disabled');
    const noSecret = setup({ env: { SESSION_SECRET: '' } });
    const r2 = await start(noSecret, request());
    expect(r2.status).toBe(503);
    expect(r2.body.error.code).toBe('not_configured');
  });

  it('refuses huge request bodies', async () => {
    const env = setup();
    const big = 'x'.repeat(6 * 1024 * 1024);
    const r = await start(env, { ...request(), files: [{ path: 'big.txt', contents: big }] });
    expect(r.status).toBe(413);
  });
});

describe('deployId tokens and expiry', () => {
  it('rejects tampered and expired deployIds', async () => {
    const env = setup();
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

  it('fails clearly when HubSpot access expires and no key is remembered', async () => {
    const env = setup();
    const { body } = await start(env, request());
    fakeProjects(env.fake.projects).expireAccessTokens();
    const r = await poll(env, body.deployId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ phase: 'failed', error: 'expired' });
    expect(r.body.message).toMatch(/expired before it finished/);
    expect(r.body.projectUrl).toContain('/project/deal-desk');
  });
});

describe('connected portal and the remembered key', () => {
  it('remembers the key in the session, renews expired access with it, and forgets it on request', async () => {
    const env = setup();
    await env.signIn();
    expect(((await (await env.call('/api/deploy/key')).json()) as DeployKeyInfo).remembered).toBe(false);

    const { status, body } = await start(env, request({ remember: true }));
    expect(status).toBe(200);
    expect(body.log).toContain('Saved the key on this browser (encrypted) for next time.');
    expect(await (await env.call('/api/deploy/key')).json()).toEqual({ remembered: true, portalId: PORTAL });
    // The session cookie is sealed: the key is not readable in it.
    expect(env.jar.get('uiex_session')).not.toContain(FAKE_PERSONAL_ACCESS_KEY);

    fakeProjects(env.fake.projects).expireAccessTokens();
    const r = await poll(env, body.deployId);
    expect(r.body.phase).toBe('building');
    expect(r.body.log).toContain('Renewed HubSpot access with the key saved on this browser.');
    const { final } = await runToEnd(env, r.body);
    expect(final.phase).toBe('success');

    // Deploy again with the remembered key (no key in the request).
    const again = await start(env, { ...request({ personalAccessKey: undefined }), useRememberedKey: true });
    expect(again.status).toBe(200);
    expect(again.body.log[0]).toMatch(/Signed in to HubSpot account/);

    const del = await env.call('/api/deploy/key', { method: 'DELETE' });
    expect(await del.json()).toEqual({ remembered: false });
    expect(((await (await env.call('/api/deploy/key')).json()) as DeployKeyInfo).remembered).toBe(false);
    const none = await start(env, { ...request({ personalAccessKey: undefined }), useRememberedKey: true });
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('no_remembered_key');
    // Still signed in after forgetting the key.
    expect(((await (await env.call('/api/me')).json()) as { connected: boolean }).connected).toBe(true);
  });

  it('does not remember a key when not connected', async () => {
    const env = setup();
    const { body } = await start(env, request({ remember: true }));
    expect(body.log).toContain("The key wasn't saved: connect HubSpot first to remember it on this browser.");
    expect(((await (await env.call('/api/deploy/key')).json()) as DeployKeyInfo).remembered).toBe(false);
  });

  it('warns when the key belongs to another portal than the connected one, and deploys there when asked', async () => {
    const otherKey = 'pat-na1-other-portal-key-000000000000';
    const env = setup({ fake: { personalAccessKeys: { [otherKey]: 999 } } });
    await env.signIn();
    const r = await start(env, request({ personalAccessKey: otherKey, remember: true }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'portal_mismatch', portalId: 999 });
    expect(r.body.error.message).toMatch(/belongs to HubSpot account 999 \(Fake account 999\), but the deploy is going to account 12345678/);
    expect(fakeProjects(env.fake.projects).uploads).toHaveLength(0);

    const ok = await start(env, request({ personalAccessKey: otherKey, remember: true, portalId: 999 }));
    expect(ok.status).toBe(200);
    expect(ok.body.portalId).toBe(999);
    expect(ok.body.log).toContain("The key wasn't saved because it belongs to a different HubSpot account than the one you're connected to.");
    expect(ok.body.projectUrl).toBe('https://app.hubspot.com/developer-projects/999/project/deal-desk');
  });

  it('uses the EU app host for EU keys', async () => {
    const euKey = 'pat-eu1-fake0000-0000-4000-8000-000000000009';
    const env = setup({ fake: { personalAccessKeys: { [euKey]: PORTAL } } });
    const { body } = await start(env, request({ personalAccessKey: euKey }));
    expect(body.projectUrl).toBe(`https://app-eu1.hubspot.com/developer-projects/${PORTAL}/project/deal-desk`);
  });
});
