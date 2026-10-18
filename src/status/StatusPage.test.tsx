import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { StatusPage, guessHost, hostSteps } from './StatusPage';
import { useStatusAdmin, resetStatusAdminForTests } from './useStatusAdmin';
import { resetConnectionForTests, useConnection } from '../connect/store';
import { connectedInfo, healthFixture, json, routedFetch, type MockHandler } from '../connect/testUtils';
import type { AdminAccess, DiagnosticEvent, DiagnosticsSnapshot } from './types';

const NOW = Date.now();

function snapshot(events: DiagnosticEvent[]): DiagnosticsSnapshot {
  const counters = {
    signInStarted: 3,
    signInCompleted: 1,
    signInFailed: 0,
    signInAbandoned: 2,
    publishStarted: 1,
    publishSucceeded: 1,
    publishFailed: 4,
    keyCheckProblems: 1,
    apiErrors: 0,
    serverErrors: 0,
    clientErrors: 0,
  };
  return {
    now: NOW,
    server: {
      startedAt: NOW - 2 * 3600_000,
      version: '1.0.0',
      commit: 'abc1234',
      singleProcess: true,
      signInConfigured: true,
      missingSettings: [],
      deployEnabled: true,
      allowedPortals: [],
      adminEmailCount: 1,
      adminPortals: [],
    },
    capacity: { max: 600, kept: events.length, dropped: 0 },
    abandonAfterMs: 600_000,
    summary: { lastHour: counters, lastDay: counters },
    inProgress: { signIns: 0, publishes: 0 },
    you: 'aaaaaa',
    events,
  };
}

const EVENTS: DiagnosticEvent[] = [
  { id: 4, kind: 'publish.failed', outcome: 'failed', at: NOW - 120_000, lastAt: NOW - 60_000, count: 4, code: 'missing_scope', status: 403, stage: 'upload', visitor: 'aaaaaa', portalId: 12345678, route: 'POST /api/deploy' },
  { id: 3, kind: 'signin.abandoned', outcome: 'warning', at: NOW - 900_000, lastAt: NOW - 300_000, count: 1, visitor: 'bbbbbb', feedback: 'aup', durationMs: 4000 },
  { id: 2, kind: 'signin.completed', outcome: 'ok', at: NOW - 1_000_000, lastAt: NOW - 990_000, count: 1, visitor: 'aaaaaa', portalId: 12345678, durationMs: 9000 },
  { id: 1, kind: 'server.started', outcome: 'info', at: NOW - 7_200_000, lastAt: NOW - 7_200_000, count: 1, version: '1.0.0 (abc1234)' },
];

function serve(opts: { connected: boolean; access: AdminAccess; health?: ReturnType<typeof healthFixture> }) {
  const routes: Record<string, MockHandler> = {
    'GET /api/health': () => json(opts.health ?? healthFixture()),
    'GET /api/me': () => json(opts.connected ? connectedInfo() : { connected: false, reason: 'signed-out' }),
    'GET /api/admin/access': () => json(opts.access),
    'GET /api/admin/diagnostics': () => json(snapshot(EVENTS)),
  };
  const mock = routedFetch(routes);
  vi.stubGlobal('fetch', mock.fetch);
  return mock;
}

beforeEach(() => {
  resetConnectionForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetConnectionForTests();
  document.documentElement.classList.remove('ub-st-root');
});

describe('StatusPage', () => {
  it('asks to sign in, and shows nothing else', async () => {
    const mock = serve({ connected: false, access: { signInConfigured: true, signedIn: false, admin: false, adminConfigured: true } });
    render(<StatusPage />);
    expect(await screen.findByRole('heading', { name: 'Sign in to see what’s happening' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with HubSpot' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Can’t sign in?' }));
    expect(screen.getByText(/acceptable use policy”/)).toBeTruthy();
    expect(mock.calls.some((c) => c.path === '/api/admin/diagnostics')).toBe(false);
    expect(document.documentElement.classList.contains('ub-st-root')).toBe(true);
  });

  it('explains exactly how to become an admin when nobody is one yet', async () => {
    const mock = serve({
      connected: true,
      access: { signInConfigured: true, signedIn: true, admin: false, adminConfigured: false, account: { portalId: 12345678, email: 'ada@acme.com' } },
    });
    render(<StatusPage />);
    expect(await screen.findByRole('heading', { name: 'One setting to go: make yourself an admin' })).toBeTruthy();
    expect(screen.getByText('ada@acme.com')).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Where the builder is hosted' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Render' }));
    expect(screen.getByRole('tabpanel').textContent).toContain('Environment');
    expect(screen.getByText(/ADMIN_PORTALS=12345678/)).toBeTruthy();
    expect(mock.calls.some((c) => c.path === '/api/admin/diagnostics')).toBe(false);
  });

  it('tells a signed-in non-admin the page isn’t for them', async () => {
    const mock = serve({
      connected: true,
      access: { signInConfigured: true, signedIn: true, admin: false, adminConfigured: true, account: { portalId: 12345678, email: 'ada@acme.com' } },
    });
    render(<StatusPage />);
    expect(await screen.findByRole('heading', { name: 'This page is for the people who host this builder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch HubSpot account' })).toBeTruthy();
    expect(mock.calls.some((c) => c.path === '/api/admin/diagnostics')).toBe(false);
  });

  it('points to the setup checklist when sign-in isn’t set up', async () => {
    serve({
      connected: false,
      health: healthFixture({ oauthConfigured: false, missingSettings: ['HUBSPOT_CLIENT_ID'] }),
      access: { signInConfigured: false, missingSettings: ['HUBSPOT_CLIENT_ID'], signedIn: false, admin: false, adminConfigured: true },
    });
    render(<StatusPage />);
    expect(await screen.findByRole('heading', { name: 'Set up Sign in with HubSpot first' })).toBeTruthy();
    expect(screen.getByText('HUBSPOT_CLIENT_ID')).toBeTruthy();
  });

  it('shows admins what needs attention, the counters and the timeline', async () => {
    serve({ connected: true, access: { signInConfigured: true, signedIn: true, admin: true, adminConfigured: true, account: { portalId: 12345678, email: 'ada@acme.com' } } });
    render(<StatusPage />);
    expect(await screen.findByRole('heading', { name: 'Builder status' })).toBeTruthy();
    const attention = screen.getByRole('region', { name: 'Needs your attention' });
    const cards = within(attention).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(cards).toEqual([
      'Sign-in blocked: HubSpot wants the app’s Acceptable Use Policy signed',
      'Publish refused: This key can’t publish yet: it’s missing the “Developer projects” permission',
    ]);
    expect(within(attention).getByText('4 times')).toBeTruthy();
    expect(screen.getByText(/resets|restart, a new deploy/)).toBeTruthy();
    const timeline = screen.getByRole('region', { name: 'Timeline' });
    expect(within(timeline).getByText('4 events')).toBeTruthy();
    // Expand a row: plain explanation + facts.
    const row = within(timeline).getByRole('button', { name: /Signed in to HubSpot account 12345678/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(within(timeline).getByText('Connecting took 9 s.')).toBeTruthy();
    // Filter: only sign-ins.
    fireEvent.click(within(timeline).getByRole('button', { name: 'Sign-ins' }));
    await waitFor(() => expect(within(timeline).queryByText(/Publish refused/)).toBeNull());
    expect(within(timeline).getByText(/2 of 4 events/)).toBeTruthy();
    expect(screen.getByText('Visitor aaaaaa (you)')).toBeTruthy();
  });
});

describe('useStatusAdmin (account menu link)', () => {
  it('is true only for a signed-in admin, asking once per account', async () => {
    resetStatusAdminForTests();
    const mock = serve({ connected: true, access: { signInConfigured: true, signedIn: true, admin: true, adminConfigured: true } });
    const signedOut = renderHook(() => useStatusAdmin());
    expect(signedOut.result.current).toBe(false);
    signedOut.unmount();
    useConnection.setState({ status: 'connected', info: connectedInfo() });
    const { result } = renderHook(() => useStatusAdmin());
    await waitFor(() => expect(result.current).toBe(true));
    renderHook(() => useStatusAdmin());
    expect(mock.calls.filter((c) => c.path === '/api/admin/access')).toHaveLength(1);
  });
});

describe('host instructions', () => {
  it('guesses the host from the address', () => {
    expect(guessHost('uiex-builder.onrender.com')).toBe('render');
    expect(guessHost('my-builder.vercel.app')).toBe('vercel');
    expect(guessHost('uiex.me.workers.dev')).toBe('cloudflare');
    expect(guessHost('localhost')).toBe('local');
    expect(guessHost('builder.example.com')).toBe('render');
  });

  it('names the setting in every host’s steps', () => {
    for (const host of ['render', 'vercel', 'cloudflare', 'docker', 'local'] as const) {
      expect(hostSteps(host, 'ADMIN_EMAILS=a@b.co').join(' ')).toContain('ADMIN_EMAILS');
    }
  });
});
