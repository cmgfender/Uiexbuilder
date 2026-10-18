// @vitest-environment node
/**
 * The status page's server side against the fake HubSpot: sign-ins (completed, failed, never came
 * back, what the visitor said), publishes (key check, success, refusals merged, build failures),
 * refused API requests, browser reports, who may read it, and that nothing sensitive is kept.
 */
import { describe, expect, it } from 'vitest';
import { createTestEnv, TEST_APP_URL, TEST_SESSION_SECRET, type TestEnv } from '../testing';
import type { DeployRequest, DeployStatus } from '../../../src/connect/types';
import type { AdminAccess, DiagnosticEvent, DiagnosticsSnapshot } from '../../../src/status/types';
import { FAKE_PERSONAL_ACCESS_KEY } from '../../fake-hubspot/handler';
import { fakeProjects } from '../../fake-hubspot/projects';
import { sampleProjectFiles } from '../deploy/testFixtures';
import { DIAGNOSTICS_DEFAULTS, DiagnosticsLog, MORE_CLIENT_REPORTS, eventLogLine } from './log';
import { VisitorIds, DAY_MS } from './visitor';
import { Diagnostics } from './observe';
import { errorJson } from '../http';

const PORTAL = 12345678;
const ADMIN = 'sam.rivera@acmedemo.com';
const html = { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

interface Setup {
  env: TestEnv;
  lines: string[];
}

function setup(envVars: Record<string, string | undefined> = { ADMIN_EMAILS: ADMIN }): Setup {
  const lines: string[] = [];
  const env = createTestEnv({ env: envVars, connector: { eventLog: (l) => lines.push(l) } });
  fakeProjects(env.fake.projects).setNow(env.now);
  return { env, lines };
}

async function snapshot(env: TestEnv): Promise<DiagnosticsSnapshot> {
  const res = await env.call('/api/admin/diagnostics');
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as DiagnosticsSnapshot;
}

/** Events without the "server started" row. */
function activity(s: DiagnosticsSnapshot): DiagnosticEvent[] {
  return s.events.filter((e) => e.kind !== 'server.started');
}

function deployRequest(key = FAKE_PERSONAL_ACCESS_KEY): DeployRequest {
  return { personalAccessKey: key, projectName: 'deal-desk', platformVersion: '2026.03', files: sampleProjectFiles() };
}

async function startSignIn(env: TestEnv, clientIp?: string): Promise<URL> {
  const res = await env.call(`/api/auth/start?returnTo=${encodeURIComponent(TEST_APP_URL)}`, { csrf: false, headers: html, clientIp });
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}

async function publishToEnd(env: TestEnv, key?: string): Promise<DeployStatus> {
  const res = await env.call('/api/deploy', { json: deployRequest(key) });
  let s = (await res.json()) as DeployStatus;
  expect(res.status, JSON.stringify(s)).toBe(200);
  for (let i = 0; i < 40 && s.phase !== 'success' && s.phase !== 'failed'; i++) {
    env.advance(1500);
    s = (await (await env.call('/api/deploy/status', { json: { deployId: s.deployId } })).json()) as DeployStatus;
  }
  return s;
}

describe('sign-in events', () => {
  it('records one row per sign-in: started, then signed in, with the account and how long it took', async () => {
    const { env, lines } = setup();
    await env.signIn();
    const s = await snapshot(env);
    const rows = activity(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'signin.completed', outcome: 'ok', portalId: PORTAL, mode: 'popup', count: 1 });
    expect(rows[0].visitor).toMatch(/^[0-9a-f]{6}$/);
    expect(rows[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(s.summary.lastHour).toMatchObject({ signInStarted: 1, signInCompleted: 1, signInFailed: 0, signInAbandoned: 0 });
    // Searchable log lines: the start and the update.
    const signInLines = lines.filter((l) => l.includes('"signin.'));
    expect(signInLines).toHaveLength(2);
    expect(signInLines[0]).toMatch(/^\[event\] \{"at":"[^"]+","kind":"signin\.started","outcome":"pending"/);
    expect(JSON.parse(signInLines[1].slice('[event] '.length))).toMatchObject({ kind: 'signin.completed', update: true, portalId: PORTAL });
  });

  it('records a refused sign-in with its code (the visitor said no)', async () => {
    const { env } = setup();
    const authorize = await startSignIn(env);
    const state = authorize.searchParams.get('state')!;
    const res = await env.call(`/api/auth/callback?state=${encodeURIComponent(state)}&error=access_denied`, { csrf: false, headers: html });
    expect(res.status).toBe(400);
    await env.signIn();
    const rows = activity(await snapshot(env));
    expect(rows.map((e) => [e.kind, e.code ?? null])).toEqual([
      ['signin.completed', null],
      ['signin.failed', 'access_denied'],
    ]);
  });

  it('records a full-page sign-in result from the return address', async () => {
    const { env } = setup();
    await env.signIn({ mode: 'redirect' });
    expect(activity(await snapshot(env))[0]).toMatchObject({ kind: 'signin.completed', mode: 'redirect', portalId: PORTAL });
  });

  it('infers "never came back" when HubSpot does not send the visitor back within 10 minutes', async () => {
    const { env, lines } = setup();
    await startSignIn(env, '198.51.100.7');
    env.advance(DIAGNOSTICS_DEFAULTS.abandonAfterMs - 1000);
    await env.call('/api/health');
    await env.signIn();
    let rows = activity(await snapshot(env));
    expect(rows.find((e) => e.kind === 'signin.started')).toMatchObject({ outcome: 'pending' });
    expect((await snapshot(env)).inProgress.signIns).toBe(1);
    env.advance(2000);
    const s = await snapshot(env);
    rows = activity(s);
    const abandoned = rows.find((e) => e.kind === 'signin.abandoned')!;
    expect(abandoned).toMatchObject({ outcome: 'warning', durationMs: DIAGNOSTICS_DEFAULTS.abandonAfterMs });
    expect(s.summary.lastHour).toMatchObject({ signInStarted: 2, signInCompleted: 1, signInAbandoned: 1 });
    expect(s.inProgress.signIns).toBe(0);
    expect(lines.some((l) => l.includes('"kind":"signin.abandoned"'))).toBe(true);
  });

  it('ends a sign-in with what the visitor said the HubSpot window showed', async () => {
    const { env } = setup();
    await startSignIn(env, '198.51.100.7');
    env.advance(5000);
    const closed = await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'signin_feedback', kind: 'popup_closed' }, clientIp: '198.51.100.7' });
    expect(closed.status).toBe(204);
    // Then they pick "a message about the acceptable use policy" in the help.
    await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'signin_feedback', kind: 'aup' }, clientIp: '198.51.100.7' });
    await env.signIn();
    const rows = activity(await snapshot(env));
    const abandoned = rows.filter((e) => e.kind === 'signin.abandoned');
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]).toMatchObject({ feedback: 'aup', durationMs: 5000 });
    expect(rows.some((e) => e.kind === 'signin.feedback')).toBe(false);
    // Refining the row with their answer is not another sign-in that never came back.
    expect((await snapshot(env)).summary.lastHour.signInAbandoned).toBe(1);
    // Unknown feedback is refused.
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'signin_feedback', kind: 'whatever' } })).status).toBe(400);
  });

  it('keeps no OAuth state, codes, tokens or email addresses', async () => {
    const { env, lines } = setup();
    const authorize = await startSignIn(env);
    await env.signIn();
    const text = JSON.stringify(await snapshot(env)) + lines.join('\n');
    expect(text).not.toContain(authorize.searchParams.get('state')!);
    expect(text).not.toContain(ADMIN);
    expect(text).not.toContain(TEST_SESSION_SECRET);
    expect(text).not.toMatch(/Bearer|access_token|refresh_token|code=/);
    for (const cookie of env.jar.cookies.values()) expect(text).not.toContain(cookie.value);
  });
});

describe('publish events', () => {
  it('records a key check and a publish that went live as one row with its build and duration', async () => {
    const { env } = setup();
    await env.signIn();
    const check = await env.call('/api/deploy/check-key', { json: { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY } });
    expect(check.status).toBe(200);
    const final = await publishToEnd(env);
    expect(final.phase).toBe('success');
    // Asking about the finished job again records nothing new.
    await env.call('/api/deploy/status', { json: { deployId: final.deployId } });
    const s = await snapshot(env);
    const rows = activity(s).filter((e) => e.kind.startsWith('publish.'));
    expect(rows.map((e) => e.kind)).toEqual(['publish.succeeded', 'publish.key_check']);
    expect(rows[0]).toMatchObject({ outcome: 'ok', portalId: PORTAL, buildId: final.buildId, stage: 'deploy' });
    expect(rows[0].durationMs).toBeGreaterThan(0);
    expect(rows[1]).toMatchObject({ outcome: 'ok', developerProjects: 'yes', portalId: PORTAL });
    expect(s.summary.lastDay).toMatchObject({ publishStarted: 1, publishSucceeded: 1, publishFailed: 0, keyCheckProblems: 0 });
    expect(s.inProgress.publishes).toBe(0);
    const text = JSON.stringify(s);
    expect(text).not.toContain(FAKE_PERSONAL_ACCESS_KEY);
    expect(text).not.toContain(final.deployId);
  });

  it('merges repeated refusals (a key without "Developer projects", refused 4 times)', async () => {
    const { env } = setup();
    await env.signIn();
    for (let i = 0; i < 4; i++) {
      const res = await env.call('/api/deploy', { json: deployRequest('no-projects-scope-key-000000000000') });
      expect(res.status).toBe(403);
      env.advance(20_000);
    }
    const s = await snapshot(env);
    const refused = activity(s).filter((e) => e.kind === 'publish.failed');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: 'missing_scope', status: 403, stage: 'upload', count: 4, portalId: PORTAL, route: 'POST /api/deploy' });
    expect(refused[0].lastAt - refused[0].at).toBe(60_000);
    expect(s.summary.lastHour.publishFailed).toBe(4);
  });

  it('records a key check that found a problem', async () => {
    const { env } = setup();
    await env.signIn();
    await env.call('/api/deploy/check-key', { json: { personalAccessKey: 'no-projects-scope-key-000000000000' } });
    const row = activity(await snapshot(env)).find((e) => e.kind === 'publish.key_check')!;
    expect(row.outcome).toBe('failed');
    expect(row.code).toMatch(/^[a-z_]+$/);
  });

  it('records where a publish stopped (the build failed)', async () => {
    const { env } = setup();
    await env.signIn();
    const final = await publishToEnd(env, 'fail-build-key-00000000000000');
    expect(final.phase).toBe('failed');
    const row = activity(await snapshot(env)).find((e) => e.kind === 'publish.failed')!;
    expect(row).toMatchObject({ code: 'build_failed', stage: 'build', outcome: 'failed', portalId: PORTAL });
  });

  it('stops following a publish nobody asks about (the browser was closed)', async () => {
    const { env } = setup();
    await env.signIn();
    const res = await env.call('/api/deploy', { json: deployRequest() });
    expect(res.status).toBe(200);
    env.advance(DIAGNOSTICS_DEFAULTS.publishIdleMs + 1000);
    const row = activity(await snapshot(env)).find((e) => e.kind === 'publish.started')!;
    expect(row).toMatchObject({ outcome: 'warning', code: 'not_followed' });
  });
});

describe('API errors', () => {
  it('records refused requests by route pattern (never the address, which can hold record ids)', async () => {
    const { env } = setup();
    await env.call('/api/crm/object-types');
    await env.call('/api/nope');
    await env.signIn();
    await env.call('/api/crm/records/contacts/99999999?properties=email');
    const rows = activity(await snapshot(env)).filter((e) => e.kind === 'api.error');
    expect(rows.map((e) => [e.route, e.status, e.code])).toEqual([
      ['GET /api/crm/records/:objectType/:id', 404, 'not_found'],
      ['GET (unknown address)', 404, 'not_found'],
      ['GET /api/crm/object-types', 401, 'not_connected'],
    ]);
    expect(rows[0].portalId).toBe(PORTAL);
    expect(JSON.stringify(rows)).not.toContain('99999999');
  });

  it('records requests refused before any route ran as refused requests, not publish attempts', async () => {
    const { env } = setup();
    await env.signIn();
    const res = await env.call('/api/deploy/check-key', { json: { personalAccessKey: FAKE_PERSONAL_ACCESS_KEY }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    const s = await snapshot(env);
    expect(activity(s).filter((e) => e.kind !== 'signin.completed').map((e) => [e.kind, e.code, e.route])).toEqual([['api.error', 'forbidden_origin', 'POST /api/deploy/check-key']]);
    expect(s.summary.lastHour.keyCheckProblems).toBe(0);
  });

  it('records the error type (not the message) of a server error', async () => {
    const diagnostics = new Diagnostics({ now: () => 1_000_000 });
    const request = new Request('https://builder.example.test/api/crm/owners');
    await diagnostics.observe({
      request,
      url: new URL(request.url),
      route: { method: 'GET', path: '/api/crm/owners', handler: () => new Response() },
      params: {},
      response: errorJson(500, 'internal_error', 'Something went wrong on the connector server. Please try again.'),
      session: { get: async () => null, set: async () => {}, clear: () => {} },
      clientIp: '203.0.113.1',
      errorName: 'TypeError',
    });
    expect(diagnostics.log.list()[0]).toMatchObject({ kind: 'api.error', outcome: 'failed', status: 500, code: 'internal_error', route: 'GET /api/crm/owners', errorName: 'TypeError' });
    expect(diagnostics.log.counters(60_000)).toMatchObject({ apiErrors: 1, serverErrors: 1 });
  });

  it('never breaks a request, whatever it is given', async () => {
    const diagnostics = new Diagnostics();
    const request = new Request('https://builder.example.test/api/auth/callback?state=x');
    const broken = { get: async () => { throw new Error('nope'); }, set: async () => {}, clear: () => {} };
    await expect(
      diagnostics.observe({ request, url: new URL(request.url), route: { method: 'GET', path: '/api/auth/callback', handler: () => new Response() }, params: {}, response: new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), session: broken }),
    ).resolves.toBeUndefined();
  });
});

describe('browser reports', () => {
  it('keeps a cleaned error: no query strings, email addresses or tokens', async () => {
    const { env, lines } = setup();
    const token = ['CiRuYTEt', 'ZmFrZS1kZW1vLWtleS1hY21lZGVtby0wMDAwMDAwMRIY'].join('');
    const res = await env.call('/api/diagnostics/report', { origin: TEST_APP_URL,
      json: {
        type: 'client_error',
        source: 'unhandledrejection',
        name: 'TypeError',
        message: `Cannot read properties of undefined for ada@example.com at https://builder.example.test/api/crm?q=ada&code=xyz with ${token}`,
        stack: `TypeError: boom\n    at render (https://builder.example.test/assets/index-B2x9kQ.js?v=123:12:5)\n    at x (http://localhost:5173/src/App.tsx?t=1697000000:40:3)`,
        path: '/status?tab=1#x',
        build: 'B2x9kQ',
      },
    });
    expect(res.status).toBe(204);
    await env.signIn();
    const row = activity(await snapshot(env)).find((e) => e.kind === 'client.error')!;
    expect(row.client).toMatchObject({ source: 'unhandledrejection', name: 'TypeError', path: '/status', build: 'B2x9kQ' });
    expect(row.client!.message).toBe('Cannot read properties of undefined for [email] at https://builder.example.test/api/crm with [redacted]');
    expect(row.client!.stack).toContain('https://builder.example.test/assets/index-B2x9kQ.js:12:5');
    // Not this builder's address (APP_URL / ALLOWED_ORIGINS): only "[link]".
    expect(row.client!.stack).toContain('at x ([link])');
    expect(row.client!.stack).not.toContain('localhost');
    const line = lines.find((l) => l.includes('client.error'))!;
    expect(line).not.toContain('at render'); // stacks stay out of the log lines
    expect(line).not.toContain(token);
  });

  it('refuses large, malformed and too frequent reports, and never records the report route as an error', async () => {
    const { env } = setup();
    const big = await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: 'x'.repeat(9000) } });
    expect(big.status).toBe(413);
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, body: 'nope', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'other' } })).status).toBe(400);
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: '' } })).status).toBe(400);
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: 'x' }, csrf: false })).status).toBe(403);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: `error ${i}` } })).status);
    }
    expect(statuses.filter((s) => s === 204).length).toBeLessThanOrEqual(20);
    expect(statuses.at(-1)).toBe(429);
    // Another visitor is not affected.
    expect((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: 'mine' }, clientIp: '203.0.113.50' })).status).toBe(204);
    // Many addresses together are capped too.
    const crowd: number[] = [];
    for (let i = 0; i < 160; i++) {
      crowd.push((await env.call('/api/diagnostics/report', { origin: TEST_APP_URL, json: { type: 'client_error', message: `crowd ${i}` }, clientIp: `198.18.${i >> 8}.${i & 255}` })).status);
    }
    expect(crowd.filter((s) => s === 204).length).toBeLessThan(120);
    expect(crowd.at(-1)).toBe(429);
    await env.signIn();
    const rows = activity(await snapshot(env));
    expect(rows.some((e) => e.kind === 'api.error' && e.route?.includes('/api/diagnostics/report'))).toBe(false);
  });
});

describe('browser reports are untrusted', () => {
  const fake = {
    type: 'client_error',
    source: 'react',
    name: 'SecurityNotice',
    message: 'URGENT: your HubSpot connector secret leaked. Rotate it now at https://evil.example/hubspot-rotate or www.evil.example/x or evil.example/rotate',
    stack: 'Error\n    at x (https://evil.example/a.js:1:2)',
    path: '/javascript:alert(1)',
  };

  it('needs the builder’s own Origin (scripts without one are refused, and leave no row)', async () => {
    const { env } = setup();
    expect((await env.call('/api/diagnostics/report', { json: fake })).status).toBe(403);
    expect((await env.call('/api/diagnostics/report', { json: fake, origin: 'https://evil.example' })).status).toBe(403);
    await env.signIn();
    const rows = activity(await snapshot(env));
    expect(rows.some((e) => e.kind === 'client.error' || e.kind === 'api.error')).toBe(false);
  });

  it('keeps no outside links or odd page paths', async () => {
    const { env } = setup();
    expect((await env.call('/api/diagnostics/report', { json: fake, origin: TEST_APP_URL })).status).toBe(204);
    await env.signIn();
    const row = activity(await snapshot(env)).find((e) => e.kind === 'client.error')!;
    expect(row.client!.message).toBe('URGENT: your HubSpot connector secret leaked. Rotate it now at [link] or [link] or [link]');
    expect(row.client!.stack).toBe('Error\n    at x ([link])');
    expect(row.client!.path).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain('evil');
  });

  it('keeps a few distinct reports per visitor an hour, then only counts them; they never push sign-ins out', async () => {
    const { env } = setup();
    await env.signIn();
    for (let i = 0; i < 15; i++) {
      expect((await env.call('/api/diagnostics/report', { json: { ...fake, message: `fake ${i}` }, origin: TEST_APP_URL, clientIp: '203.0.113.66' })).status).toBe(204);
      env.advance(31_000);
    }
    const s = await snapshot(env);
    const rows = activity(s);
    const reports = rows.filter((e) => e.kind === 'client.error');
    expect(reports.filter((e) => !e.client?.overflow).map((e) => e.client!.message)).toEqual(['fake 4', 'fake 3', 'fake 2', 'fake 1', 'fake 0']);
    const more = reports.filter((e) => e.client?.overflow);
    expect(more).toHaveLength(1);
    expect(more[0]).toMatchObject({ count: 10, client: { message: MORE_CLIENT_REPORTS } });
    expect(s.summary.lastHour.clientErrors).toBe(15);
    expect(rows.some((e) => e.kind === 'signin.completed')).toBe(true);
  });
});

describe('who may see the status page', () => {
  async function access(env: TestEnv): Promise<AdminAccess> {
    const res = await env.call('/api/admin/access');
    expect(res.status).toBe(200);
    return (await res.json()) as AdminAccess;
  }

  it('needs sign-in, and says so', async () => {
    const { env } = setup();
    expect(await access(env)).toEqual({ signInConfigured: true, signedIn: false, admin: false, adminConfigured: true });
    const res = await env.call('/api/admin/diagnostics');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_connected');
  });

  it('nobody is an admin until ADMIN_EMAILS or ADMIN_PORTALS is set', async () => {
    const { env } = setup({});
    await env.signIn();
    expect(await access(env)).toEqual({ signInConfigured: true, signedIn: true, admin: false, adminConfigured: false, account: { portalId: PORTAL, hubDomain: 'acmedemo.com', email: ADMIN } });
    const res = await env.call('/api/admin/diagnostics');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('admin_not_configured');
  });

  it('refuses signed-in people who are not admins', async () => {
    const { env } = setup({ ADMIN_EMAILS: 'someone.else@example.com', ADMIN_PORTALS: '99999999' });
    await env.signIn();
    expect((await access(env)).admin).toBe(false);
    const res = await env.call('/api/admin/diagnostics');
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain('not_admin');
    expect(body).not.toContain('signin.');
  });

  it('lets in an admin by email (any case) or by HubSpot account', async () => {
    for (const vars of [{ ADMIN_EMAILS: 'Sam.Rivera@AcmeDemo.com, other@example.com' }, { ADMIN_PORTALS: `${PORTAL}` }]) {
      const { env } = setup(vars);
      await env.signIn();
      expect((await access(env)).admin).toBe(true);
      const s = await snapshot(env);
      expect(s.you).toMatch(/^[0-9a-f]{6}$/);
      expect(s.server).toMatchObject({ signInConfigured: true, singleProcess: false, deployEnabled: true });
      expect(s.events.at(-1)).toMatchObject({ kind: 'server.started' });
    }
  });

  it('needs the CSRF header and a trusted origin', async () => {
    const { env } = setup();
    await env.signIn();
    expect((await env.call('/api/admin/diagnostics', { csrf: false })).status).toBe(403);
    expect((await env.call('/api/admin/diagnostics', { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('explains when sign-in itself is not set up', async () => {
    const { env } = setup({ ADMIN_EMAILS: ADMIN, HUBSPOT_CLIENT_ID: '' });
    expect(await access(env)).toMatchObject({ signInConfigured: false, missingSettings: ['HUBSPOT_CLIENT_ID'], signedIn: false, admin: false });
    expect((await env.call('/api/admin/diagnostics')).status).toBe(503);
  });
});

describe('DiagnosticsLog', () => {
  it('keeps at most `capacity` events and counts what it dropped', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t, capacity: 10 });
    for (let i = 0; i < 15; i++) {
      t += 1000;
      log.record({ kind: 'api.error', outcome: 'warning', code: `code_${i}`, status: 400 });
    }
    expect(log.size).toBe(10);
    expect(log.dropped).toBe(5);
    expect(log.list()[0].code).toBe('code_14');
    // Counters still see everything.
    expect(log.counters(60 * 60_000).apiErrors).toBe(15);
  });

  it('merges identical problems only within 10 minutes and only from the same visitor', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t });
    const err = { kind: 'api.error' as const, outcome: 'warning' as const, code: 'csrf', status: 403, visitor: 'aaaaaa' };
    log.record(err);
    t += 60_000;
    log.record(err);
    log.record({ ...err, visitor: 'bbbbbb' });
    t += DIAGNOSTICS_DEFAULTS.mergeWindowMs + 1;
    log.record(err);
    expect(log.list().map((e) => [e.visitor, e.count])).toEqual([
      ['aaaaaa', 1],
      ['bbbbbb', 1],
      ['aaaaaa', 2],
    ]);
  });

  it('counts the last hour and the last day separately', () => {
    let t = 10 * DAY_MS;
    const log = new DiagnosticsLog({ now: () => t });
    log.record({ kind: 'client.error', outcome: 'failed', client: { source: 'error', message: 'a' } });
    t += 2 * 60 * 60_000;
    log.record({ kind: 'client.error', outcome: 'failed', client: { source: 'error', message: 'b' } });
    expect(log.counters(60 * 60_000).clientErrors).toBe(1);
    expect(log.counters(DAY_MS).clientErrors).toBe(2);
    t += DAY_MS + 2 * 60_000;
    expect(log.counters(DAY_MS).clientErrors).toBe(0);
  });

  it('keeps browser reports in their own buffer, so a flood of them can’t push other events out', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t, capacity: 10, clientCapacity: 10 });
    log.record({ kind: 'signin.completed', outcome: 'ok', portalId: 1 });
    for (let i = 0; i < 400; i++) {
      t += 1000;
      log.record({ kind: 'client.error', outcome: 'failed', visitor: `v${i}`, client: { source: 'error', message: `m${i}` } });
    }
    const rows = log.list();
    expect(rows.some((e) => e.kind === 'signin.completed')).toBe(true);
    expect(rows.filter((e) => e.kind === 'client.error').length).toBeLessThanOrEqual(10);
    // Everyone together: at most 30 distinct reports an hour, then one "more" row.
    expect(rows.find((e) => e.client?.overflow)).toMatchObject({ visitor: undefined });
  });

  it('follows at most 500 sign-ins at once; a flood of starts never turns into a flood of "never came back"', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t });
    log.record({ kind: 'publish.succeeded', outcome: 'ok', portalId: 1 });
    for (let i = 0; i < 3000; i++) log.signInStarted(`k${i}`, { visitor: `v${i}` });
    expect(log.pendingSignIns).toBe(DIAGNOSTICS_DEFAULTS.maxPendingSignIns);
    t += DIAGNOSTICS_DEFAULTS.abandonAfterMs + 1;
    log.sweep();
    expect(log.pendingSignIns).toBe(0);
    const abandoned = log.list().filter((e) => e.kind === 'signin.abandoned');
    // Only sign-ins whose rows were still kept became rows; the others are only counted.
    expect(abandoned.length).toBeLessThanOrEqual(DIAGNOSTICS_DEFAULTS.capacity);
    expect(log.counters(DAY_MS).signInAbandoned).toBe(DIAGNOSTICS_DEFAULTS.maxPendingSignIns);
    expect(log.counters(DAY_MS).signInStarted).toBe(3000);
  });

  it('one visitor’s sign-ins that never came back close together are one row with a count', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t });
    for (let i = 0; i < 20; i++) {
      log.signInStarted(`k${i}`, { visitor: 'aaaaaa' });
      t += 1000;
    }
    log.signInStarted('other', { visitor: 'bbbbbb' });
    t += DIAGNOSTICS_DEFAULTS.abandonAfterMs + 1;
    log.sweep();
    const rows = log.list().filter((e) => e.kind === 'signin.abandoned');
    expect(rows.map((e) => [e.visitor, e.count]).sort()).toEqual([
      ['aaaaaa', 20],
      ['bbbbbb', 1],
    ]);
    expect(log.list().filter((e) => e.kind === 'signin.started')).toHaveLength(0);
    expect(log.counters(DAY_MS).signInAbandoned).toBe(21);
  });

  it('keeps the answer a visitor settles on: a changed answer replaces the last one, the browser’s own never does', () => {
    let t = 1_000_000;
    const log = new DiagnosticsLog({ now: () => t });
    log.signInStarted('k', { visitor: 'aaaaaa' });
    t += 5000;
    log.signInFeedback('aaaaaa', 'popup_closed');
    for (const kind of ['aup', 'install_permission', 'cancelled', 'nothing', 'other', 'aup'] as const) {
      t += 400;
      log.signInFeedback('aaaaaa', kind);
    }
    log.signInFeedback('aaaaaa', 'timeout');
    const rows = log.list().filter((e) => e.kind.startsWith('signin.'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'signin.abandoned', feedback: 'aup', count: 1 });
    // Much later, a new answer about that old sign-in is its own row.
    t += 10 * 60_000;
    log.signInFeedback('aaaaaa', 'install_permission');
    expect(log.list().filter((e) => e.kind === 'signin.feedback')).toHaveLength(1);
  });

  it('writes one JSON line per event without stacks', () => {
    const line = eventLogLine({
      id: 1,
      kind: 'client.error',
      outcome: 'failed',
      at: 0,
      lastAt: 0,
      count: 3,
      client: { source: 'error', message: 'boom', stack: 'at secret (x.js:1:1)' },
    });
    expect(line.startsWith('[event] {')).toBe(true);
    const parsed = JSON.parse(line.slice(8));
    expect(parsed).toEqual({ at: '1970-01-01T00:00:00.000Z', kind: 'client.error', outcome: 'failed', repeat: 3, client: { source: 'error', message: 'boom' } });
  });
});

describe('VisitorIds', () => {
  it('gives the same address the same id for a day, and a new one the next day', async () => {
    let t = 5 * DAY_MS + 1000;
    const ids = new VisitorIds(() => t);
    const a1 = await ids.id('203.0.113.1');
    expect(a1).toMatch(/^[0-9a-f]{6}$/);
    expect(await ids.id('203.0.113.1')).toBe(a1);
    expect(await ids.id('203.0.113.2')).not.toBe(a1);
    t += DAY_MS;
    expect(await ids.id('203.0.113.1')).not.toBe(a1);
  });

  it('two servers never agree on an id (the salt is random and never stored)', async () => {
    const now = () => DAY_MS * 3;
    expect(await new VisitorIds(now).id('203.0.113.1')).not.toBe(await new VisitorIds(now).id('203.0.113.1'));
  });
});
