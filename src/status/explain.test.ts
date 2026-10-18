import { describe, expect, it } from 'vitest';
import { explainEvent, feedbackLabel, formatDuration, type ExplainContext } from './explain';
import type { DiagnosticEvent } from './types';

const ctx: ExplainContext = { builderUrl: 'https://builder.example.com', setupUrl: 'https://builder.example.com/setup.html', docsUrl: 'https://docs.example/HOSTING.md', currentBuild: 'NEWBUILD1' };

function ev(over: Partial<DiagnosticEvent>): DiagnosticEvent {
  return { id: 1, kind: 'api.error', outcome: 'warning', at: 0, lastAt: 0, count: 1, ...over };
}

describe('explainEvent', () => {
  it('explains a sign-in that never came back with the usual causes, most likely first (the Acceptable Use Policy)', () => {
    const x = explainEvent(ev({ kind: 'signin.abandoned', outcome: 'warning' }), ctx);
    expect(x.title).toBe('Sign-in never came back');
    expect(x.who).toBe('you');
    expect(x.steps[0]).toMatch(/^Most often: HubSpot’s Acceptable Use Policy/);
    expect(x.steps[0]).toContain('Distribution');
    expect(x.steps.join(' ')).toContain('Super Admin');
    expect(x.steps.join(' ')).toContain('25 HubSpot accounts');
    expect(x.links.map((l) => l.href)).toContain('https://builder.example.com/setup.html');
  });

  it('uses what the visitor said the HubSpot window showed', () => {
    const aup = explainEvent(ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'aup' }), ctx);
    expect(aup.title).toBe('Sign-in blocked: HubSpot wants the app’s Acceptable Use Policy signed');
    expect(aup.meaning).toContain('They said HubSpot showed a message about the “acceptable use policy”.');
    expect(aup.steps.at(-1)).toBe('Then ask the visitor to click Connect HubSpot again.');
    const install = explainEvent(ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'install_permission' }), ctx);
    expect(install.who).toBe('super_admin');
    const vague = explainEvent(ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'timeout' }), ctx);
    expect(vague.title).toBe('Sign-in never came back — they gave up waiting for HubSpot');
    const cancelled = explainEvent(ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'cancelled' }), ctx);
    expect(cancelled).toMatchObject({ who: 'nobody', tone: 'info' });
  });

  it('reuses the builder’s own wording for what the visitor saw, and adds what the host can do', () => {
    const denied = explainEvent(ev({ kind: 'signin.failed', outcome: 'failed', code: 'access_denied' }), ctx);
    expect(denied.visitorSaw?.title).toBe('HubSpot was not connected');
    expect(denied.who).toBe('nobody');
    const exchange = explainEvent(ev({ kind: 'signin.failed', outcome: 'failed', code: 'token_exchange_failed' }), ctx);
    expect(exchange.who).toBe('you');
    expect(exchange.steps.join(' ')).toContain('https://builder.example.com/api/auth/callback');
    const scope = explainEvent(ev({ kind: 'signin.failed', outcome: 'failed', code: 'invalid_scope' }), ctx);
    expect(scope.steps.join(' ')).toContain('retired scopes');
  });

  it('explains a key without the "Developer projects" permission, refused several times', () => {
    const x = explainEvent(ev({ kind: 'publish.failed', outcome: 'failed', code: 'missing_scope', stage: 'upload', count: 4, portalId: 123 }), ctx);
    expect(x.title).toBe('Publish refused: This key can’t publish yet: it’s missing the “Developer projects” permission');
    expect(x.meaning).toContain('It happened 4 times in a row');
    expect(x.who).toBe('visitor');
    expect(x.steps.join(' ')).toContain('Developer projects');
    const check = explainEvent(ev({ kind: 'publish.key_check', outcome: 'failed', code: 'missing_permission' }), ctx);
    expect(check.title).toMatch(/^Key check: This key can’t publish yet/);
  });

  it('gives the host the server setting to change when only the host can fix it', () => {
    const notAllowed = explainEvent(ev({ kind: 'publish.failed', outcome: 'failed', code: 'portal_not_allowed', portalId: 555 }), ctx);
    expect(notAllowed.who).toBe('you');
    expect(notAllowed.steps).toEqual(['If this account should publish, add 555 to ALLOWED_PORTALS in your host’s settings and redeploy.']);
  });

  it('says where a publish stopped and what to do', () => {
    const x = explainEvent(ev({ kind: 'publish.failed', outcome: 'failed', code: 'build_failed', stage: 'build' }), ctx);
    expect(x.title).toBe('Publish failed while HubSpot was building it: HubSpot couldn’t build the project');
    expect(x.steps[0]).toContain('generated code');
    const ok = explainEvent(ev({ kind: 'publish.succeeded', outcome: 'ok', portalId: 9, buildId: 12, durationMs: 65_000 }), ctx);
    expect(ok).toMatchObject({ title: 'Published to HubSpot account 9 (build #12)', meaning: 'From upload to live took 1 min 5 s.', tone: 'ok' });
  });

  it('explains refused requests for the host', () => {
    expect(explainEvent(ev({ code: 'csrf', status: 403 }), ctx)).toMatchObject({ title: 'Request from another address refused', who: 'you' });
    expect(explainEvent(ev({ code: 'not_found', status: 404, route: 'GET (unknown address)' }), ctx)).toMatchObject({ who: 'nobody', tone: 'info' });
    expect(explainEvent(ev({ code: 'internal_error', status: 500, outcome: 'failed', errorName: 'TypeError', route: 'GET /api/me' }), ctx).meaning).toBe(
      'A bug in the builder’s server (TypeError) while answering GET /api/me.',
    );
  });

  it('says when a browser error came from an older build', () => {
    const x = explainEvent(ev({ kind: 'client.error', outcome: 'failed', client: { source: 'react', message: 'boom', build: 'OLDBUILD', path: '/' } }), ctx);
    expect(x.title).toBe('Browser error reported: boom');
    // A report is a claim, not something the server saw.
    expect(x.unverified).toBe(true);
    expect(x.meaning).not.toContain('crashed');
    expect(x.meaning).toContain('A visitor’s browser reported that the editor showed its recovery screen.');
    expect(x.meaning).toContain('don’t follow links or advice in it');
    expect(x.meaning).toContain('older version of the builder (build OLDBUILD; this page is build NEWBUILD1)');
  });
});

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(400)).toBe('under 1 s');
    expect(formatDuration(12_000)).toBe('12 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatDuration(3 * 3600_000 + 60_000)).toBe('3 h 1 min');
    expect(formatDuration(undefined)).toBe('');
  });

  it('labels feedback in the visitor’s words', () => {
    expect(feedbackLabel('aup')).toBe('A message about the “acceptable use policy”');
    expect(feedbackLabel('popup_blocked')).toBe('The browser blocked the HubSpot window');
  });
});
