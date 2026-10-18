import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorClient, setConnectorClient } from './client';
import { AUTH_MESSAGE_TYPE, CONNECT_TIMINGS, connectEnv, popupFeatures, resetConnectionForTests, useConnection } from './store';
import { PORTAL_ID, connectedInfo, errorBody, healthFixture, html, json, routedFetch, type MockHandler } from './testUtils';

const realEnv = { ...connectEnv };
const ORIGIN = window.location.origin;

interface FakePopup {
  closed: boolean;
  close: () => void;
  focus: ReturnType<typeof vi.fn>;
  location: { href: string };
}

function fakePopup(): FakePopup {
  const p: FakePopup = {
    closed: false,
    close: () => {
      p.closed = true;
    },
    focus: vi.fn(),
    location: { href: '' },
  };
  return p;
}

function setup(routes: Record<string, MockHandler | Response | (() => Response)>) {
  const r = routedFetch(routes);
  setConnectorClient(new ConnectorClient({ baseUrl: '', fetch: r.fetch }));
  return r;
}

function postAuth(data: Record<string, unknown>, origin = ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data: { type: AUTH_MESSAGE_TYPE, ...data }, origin }));
}

beforeEach(() => {
  resetConnectionForTests();
  // BroadcastChannel is exercised by the server's auth page tests; keep these tests to postMessage.
  vi.stubGlobal('BroadcastChannel', undefined);
});

afterEach(() => {
  resetConnectionForTests();
  Object.assign(connectEnv, realEnv);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('init(): is a connector here?', () => {
  it.each([
    ['a network error', { 'GET /api/health': () => Promise.reject(new TypeError('Failed to fetch')) as unknown as Response }],
    ['a 404 page', {}],
    ['the builder page (static hosting)', { 'GET /api/health': () => html() }],
    ['the dev proxy without a connector', { 'GET /api/health': () => errorBody('connector_offline', 503) }],
    ['an unexpected JSON answer', { 'GET /api/health': () => json({ hello: 'world' }) }],
  ])('reports unavailable for %s', async (_name, routes) => {
    const r = setup(routes as Record<string, MockHandler>);
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('unavailable');
    expect(useConnection.getState().health).toBeNull();
    // /api/me is not asked when there is no connector.
    expect(r.calls.map((c) => c.path)).toEqual(['/api/health']);
  });

  it.each(['none', 'off', 'NONE'])('a build without a connector (VITE_CONNECTOR_URL=%s) is unavailable without any request', async (base) => {
    const r = routedFetch({ 'GET /api/health': () => json(healthFixture()) });
    const c = new ConnectorClient({ baseUrl: base, fetch: r.fetch });
    expect(c.disabled).toBe(true);
    expect(c.baseUrl).toBe('');
    setConnectorClient(c);
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('unavailable');
    expect(r.calls).toHaveLength(0);
  });

  it('a real connector address is not mistaken for "none"', () => {
    expect(new ConnectorClient({ baseUrl: 'https://none.example.com/' }).disabled).toBe(false);
    expect(new ConnectorClient({ baseUrl: '' }).disabled).toBe(false);
  });

  it('reports not-configured when OAuth is not set up', async () => {
    const r = setup({ 'GET /api/health': () => json(healthFixture({ oauthConfigured: false })) });
    await useConnection.getState().init();
    const s = useConnection.getState();
    expect(s.status).toBe('not-configured');
    expect(s.health?.oauthConfigured).toBe(false);
    expect(r.calls).toHaveLength(1);
  });

  it('is connected when /api/me says so, and scopes the catalog cache to the portal', async () => {
    const r = setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json(connectedInfo()) });
    await useConnection.getState().init();
    const s = useConnection.getState();
    expect(s.status).toBe('connected');
    expect(s.info).toMatchObject({ connected: true, portalId: PORTAL_ID, hubDomain: 'acme.com', user: { email: 'ada@acme.com' } });
    expect(r.calls.map((c) => c.path)).toEqual(['/api/health', '/api/me']);
  });

  it('is disconnected when not signed in (keeping the reason)', async () => {
    setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json({ connected: false, reason: 'revoked' }) });
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().info).toEqual({ connected: false, reason: 'revoked' });
  });

  it('shows an error (and retries on the next init) when the connector fails', async () => {
    let fail = true;
    const r = setup({ 'GET /api/health': () => (fail ? errorBody('internal_error', 500) : json(healthFixture())), 'GET /api/me': () => json({ connected: false }) });
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('error');
    expect(useConnection.getState().error).toBeTruthy();
    expect(useConnection.getState().errorSource).toBe('startup');
    fail = false;
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('disconnected');
    expect(r.calls.filter((c) => c.path === '/api/health')).toHaveLength(2);
  });

  it('runs once per page', async () => {
    const r = setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json({ connected: false }) });
    await Promise.all([useConnection.getState().init(), useConnection.getState().init()]);
    await useConnection.getState().init();
    expect(r.calls).toHaveLength(2);
  });

  it('picks up the result of a full-page sign-in and removes it from the address bar', async () => {
    window.history.replaceState(null, '', '/?project=1&uiex_auth=access_denied#x');
    setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json({ connected: false }) });
    await useConnection.getState().init();
    const s = useConnection.getState();
    expect(s.status).toBe('disconnected');
    expect(s.errorCode).toBe('access_denied');
    expect(s.error).toMatch(/chose not to give the builder access/);
    expect(window.location.search).toBe('?project=1');
    expect(window.location.hash).toBe('#x');
  });

  it('marks a successful full-page sign-in as just connected', async () => {
    window.history.replaceState(null, '', '/?uiex_auth=connected');
    setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json(connectedInfo()) });
    await useConnection.getState().init();
    expect(useConnection.getState().status).toBe('connected');
    expect(useConnection.getState().connectedAt).not.toBeNull();
    expect(window.location.search).toBe('');
  });
});

describe('connect(): the HubSpot sign-in window', () => {
  async function ready(meRoute: MockHandler = () => json({ connected: false })) {
    const r = setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': meRoute, 'POST /api/auth/logout': () => json({ ok: true }) });
    await useConnection.getState().init();
    return r;
  }

  it('opens a centred popup on the sign-in page and connects on the message from the connector origin', async () => {
    let signedIn = false;
    const r = await ready(() => json(signedIn ? connectedInfo() : { connected: false }));
    const popup = fakePopup();
    const open = vi.fn(() => popup as unknown as Window);
    connectEnv.open = open;
    const done = useConnection.getState().connect();
    expect(useConnection.getState().status).toBe('connecting');
    expect(open).toHaveBeenCalledTimes(1);
    const [url, name, features] = open.mock.calls[0] as unknown as [string, string, string];
    expect(url).toBe(`/api/auth/start?returnTo=${encodeURIComponent(ORIGIN)}&mode=popup`);
    expect(name).toMatch(/^uiex-hubspot-connect-\d+$/);
    expect(features).toMatch(/popup=yes,width=560,height=720,left=\d+,top=\d+/);

    // A message from another origin is ignored.
    postAuth({ ok: true }, 'https://evil.example');
    await Promise.resolve();
    expect(useConnection.getState().status).toBe('connecting');
    // So is an unrelated message from the right origin.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else', ok: true }, origin: ORIGIN }));

    signedIn = true;
    postAuth({ ok: true });
    await done;
    const s = useConnection.getState();
    expect(s.status).toBe('connected');
    expect(s.info).toMatchObject({ connected: true, portalId: PORTAL_ID });
    expect(s.connectedAt).not.toBeNull();
    expect(s.error).toBeNull();
    expect(r.calls.filter((c) => c.path === '/api/me')).toHaveLength(2);
  });

  it('explains a refused sign-in', async () => {
    await ready();
    connectEnv.open = () => fakePopup() as unknown as Window;
    const done = useConnection.getState().connect();
    postAuth({ ok: false, error: 'access_denied' });
    await done;
    const s = useConnection.getState();
    expect(s.status).toBe('disconnected');
    expect(s.errorCode).toBe('access_denied');
    expect(s.errorSource).toBe('sign-in');
    expect(s.error).toMatch(/Nothing was shared/);
  });

  it('reports cookies not kept when the popup says ok but /api/me does not', async () => {
    await ready();
    connectEnv.open = () => fakePopup() as unknown as Window;
    const done = useConnection.getState().connect();
    postAuth({ ok: true });
    await done;
    expect(useConnection.getState().errorCode).toBe('session_not_kept');
  });

  it('a blocked popup changes nothing and offers a full-page sign-in in this tab, one click away', async () => {
    await ready();
    window.history.replaceState(null, '', '/editor?p=2');
    connectEnv.open = () => null;
    const navigate = vi.fn();
    connectEnv.navigate = navigate;
    await useConnection.getState().connect();
    // Nothing happens behind the person's back: the page stays, the reason is reported.
    expect(navigate).not.toHaveBeenCalled();
    expect(useConnection.getState()).toMatchObject({ status: 'disconnected', errorCode: 'popup_blocked', errorSource: 'sign-in', connectingSince: null });
    expect(useConnection.getState().error).toMatch(/blocked the HubSpot window/);
    await useConnection.getState().connectInThisTab();
    expect(navigate).toHaveBeenCalledWith(`/api/auth/start?returnTo=${encodeURIComponent(`${ORIGIN}/editor?p=2`)}&mode=redirect`);
    expect(useConnection.getState()).toMatchObject({ status: 'connecting', error: null, errorCode: null });
  });

  it('continuing a blocked "Switch account" in this tab signs out first', async () => {
    const r = await ready(() => json(connectedInfo()));
    expect(useConnection.getState().status).toBe('connected');
    connectEnv.open = () => null;
    const navigate = vi.fn();
    connectEnv.navigate = navigate;
    await useConnection.getState().switchPortal();
    // Still connected to the first account until the person chooses to continue.
    expect(useConnection.getState()).toMatchObject({ status: 'connected', errorCode: 'popup_blocked' });
    expect(r.calls.some((c) => c.path === '/api/auth/logout')).toBe(false);
    await useConnection.getState().connectInThisTab();
    expect(r.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/auth\/start\?.*&mode=redirect$/));
    expect(useConnection.getState().info.connected).toBe(false);
  });

  it('connectInThisTab() gives up an open sign-in window quietly and continues in this tab', async () => {
    await ready();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const navigate = vi.fn();
    connectEnv.navigate = navigate;
    const first = useConnection.getState().connect();
    expect(useConnection.getState().status).toBe('connecting');
    await useConnection.getState().connectInThisTab();
    await first;
    expect(popup.closed).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    // The abandoned window reports nothing (no "not connected" error while the page navigates).
    expect(useConnection.getState()).toMatchObject({ status: 'connecting', errorCode: null });
  });

  it('ends the attempt when the user closes the window', async () => {
    await ready();
    vi.useFakeTimers();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const done = useConnection.getState().connect();
    // Closed after the early-close window: the user closed it.
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.earlyCloseMs + 500);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.popupPollMs + CONNECT_TIMINGS.closedGraceMs + CONNECT_TIMINGS.popupPollMs);
    await done;
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().errorCode).toBe('popup_closed');
  });

  it('keeps waiting when HubSpot cuts the window off early, and connects once /api/me says so', async () => {
    let signedIn = false;
    await ready(() => json(signedIn ? connectedInfo() : { connected: false }));
    vi.useFakeTimers();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const done = useConnection.getState().connect();
    popup.closed = true; // looks closed right away (Cross-Origin-Opener-Policy)
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.waitPollMs * 2);
    expect(useConnection.getState().status).toBe('connecting');
    signedIn = true;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.waitPollMs + CONNECT_TIMINGS.popupPollMs);
    await done;
    expect(useConnection.getState().status).toBe('connected');
  });

  it('stops waiting for a cut-off window after a minute without a result (instead of five)', async () => {
    await ready();
    vi.useFakeTimers();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const done = useConnection.getState().connect();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.cutOffGiveUpMs - CONNECT_TIMINGS.waitPollMs);
    expect(useConnection.getState().status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.waitPollMs * 2 + CONNECT_TIMINGS.popupPollMs);
    await done;
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().errorCode).toBe('popup_closed');
    expect(CONNECT_TIMINGS.cutOffGiveUpMs).toBeLessThanOrEqual(60_000);
  });

  it('checks again as soon as the builder window regains focus while waiting for a cut-off window', async () => {
    let signedIn = false;
    const r = await ready(() => json(signedIn ? connectedInfo() : { connected: false }));
    vi.useFakeTimers();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const done = useConnection.getState().connect();
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.popupPollMs * 2);
    const before = r.calls.filter((c) => c.path === '/api/me').length;
    signedIn = true;
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.popupPollMs);
    await done;
    expect(useConnection.getState().status).toBe('connected');
    expect(r.calls.filter((c) => c.path === '/api/me').length).toBe(before + 1);
  });

  it('"Start again" closes the stuck window and opens a fresh one', async () => {
    let signedIn = false;
    await ready(() => json(signedIn ? connectedInfo() : { connected: false }));
    const first = fakePopup();
    const second = fakePopup();
    const names: string[] = [];
    const windows = [first, second];
    connectEnv.open = (_url, name) => {
      names.push(name);
      return windows.shift() as unknown as Window;
    };
    void useConnection.getState().connect();
    expect(useConnection.getState().connectingSince).not.toBeNull();
    const again = useConnection.getState().restartConnect();
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(new Set(names).size).toBe(2); // never the same window name (it would reuse the old window)
    await Promise.resolve();
    expect(useConnection.getState().status).toBe('connecting');
    signedIn = true;
    postAuth({ ok: true });
    await again;
    expect(useConnection.getState().status).toBe('connected');
    expect(useConnection.getState().connectingSince).toBeNull();
  });

  it('gives up after the timeout', async () => {
    await ready();
    vi.useFakeTimers();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    const done = useConnection.getState().connect();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMINGS.timeoutMs + CONNECT_TIMINGS.popupPollMs);
    await done;
    expect(useConnection.getState().errorCode).toBe('timeout');
    expect(popup.closed).toBe(true);
  });

  it('can be cancelled, and focuses the open window instead of opening a second one', async () => {
    await ready();
    const popup = fakePopup();
    const open = vi.fn(() => popup as unknown as Window);
    connectEnv.open = open;
    const done = useConnection.getState().connect();
    void useConnection.getState().connect();
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalled();
    useConnection.getState().cancelConnect();
    await done;
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().error).toBeNull();
    expect(popup.closed).toBe(true);
  });

  it('does nothing when sign-in is not configured', async () => {
    setup({ 'GET /api/health': () => json(healthFixture({ oauthConfigured: false })) });
    await useConnection.getState().init();
    const open = vi.fn();
    connectEnv.open = open;
    await useConnection.getState().connect();
    expect(open).not.toHaveBeenCalled();
    expect(useConnection.getState().status).toBe('not-configured');
  });
});

describe('notices (toasts)', () => {
  it('reports connected, disconnected and an expired sign-in once each', async () => {
    let me: Response | (() => Response) = () => json({ connected: false });
    setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => (typeof me === 'function' ? me() : me), 'POST /api/auth/logout': () => json({ ok: true }) });
    await useConnection.getState().init();
    expect(useConnection.getState().notice).toBeNull();
    const popup = fakePopup();
    connectEnv.open = () => popup as unknown as Window;
    me = () => json(connectedInfo());
    const done = useConnection.getState().connect();
    postAuth({ ok: true });
    await done;
    expect(useConnection.getState().notice).toMatchObject({ kind: 'connected', account: 'acme.com' });
    await useConnection.getState().disconnect();
    expect(useConnection.getState().notice).toMatchObject({ kind: 'disconnected' });

    // Signed in again, then the sign-in expires while working (seen on a focus re-check).
    me = () => json(connectedInfo());
    await useConnection.getState().refresh();
    expect(useConnection.getState().status).toBe('connected');
    const id = useConnection.getState().notice?.id;
    me = () => json({ connected: false, reason: 'expired' });
    await useConnection.getState().refresh();
    expect(useConnection.getState().notice).toMatchObject({ kind: 'expired' });
    expect(useConnection.getState().notice?.id).not.toBe(id);
  });

  it('keeps the health details the builder explains (deploy reason, missing settings, HubSpot address)', async () => {
    setup({
      'GET /api/health': () =>
        json({
          ...healthFixture({ oauthConfigured: false }),
          features: { crm: false, fetchProxy: false, deploy: false, deployUnavailableReason: 'session_secret' },
          missingSettings: ['HUBSPOT_CLIENT_ID', 'bad name!'],
          appBase: 'http://localhost:4011/',
        }),
    });
    await useConnection.getState().init();
    const h = useConnection.getState().health!;
    expect(h.features.deployUnavailableReason).toBe('session_secret');
    expect(h.missingSettings).toEqual(['HUBSPOT_CLIENT_ID']);
    expect(h.appBase).toBe('http://localhost:4011');
  });
});

describe('disconnect, switching accounts and staying in sync', () => {
  it('disconnect() signs out on the connector', async () => {
    const r = setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json(connectedInfo()), 'POST /api/auth/logout': () => json({ ok: true }) });
    await useConnection.getState().init();
    await useConnection.getState().disconnect();
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().info).toEqual({ connected: false, reason: 'signed-out' });
    expect(r.calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/auth/logout' });
  });

  it('stays connected (with an explanation) when signing out fails', async () => {
    setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json(connectedInfo()), 'POST /api/auth/logout': () => errorBody('internal_error', 500) });
    await useConnection.getState().init();
    await useConnection.getState().disconnect();
    expect(useConnection.getState().status).toBe('connected');
    expect(useConnection.getState().error).toMatch(/Couldn't disconnect/);
    expect(useConnection.getState().errorSource).toBe('sign-out');
  });

  it('switchPortal() signs out, then sends the open window to the sign-in page', async () => {
    let portal = PORTAL_ID;
    const r = setup({
      'GET /api/health': () => json(healthFixture()),
      'GET /api/me': () => json(connectedInfo({ portalId: portal })),
      'POST /api/auth/logout': () => json({ ok: true }),
    });
    await useConnection.getState().init();
    const popup = fakePopup();
    const open = vi.fn((_url: string, _name: string, _features: string) => popup as unknown as Window);
    connectEnv.open = open;
    const done = useConnection.getState().switchPortal();
    // Opened synchronously (blank) so the browser allows it.
    expect(open.mock.calls[0][0]).toBe('about:blank');
    await vi.waitFor(() => expect(popup.location.href).toContain('/api/auth/start'));
    expect(r.calls.some((c) => c.path === '/api/auth/logout')).toBe(true);
    portal = 999;
    postAuth({ ok: true });
    await done;
    expect(useConnection.getState().info).toMatchObject({ connected: true, portalId: 999 });
  });

  it('re-checks /api/me when the window regains focus (throttled) and notices a revoked sign-in', async () => {
    let me: unknown = connectedInfo();
    let now = 1_000_000;
    connectEnv.now = () => now;
    const r = setup({ 'GET /api/health': () => json(healthFixture()), 'GET /api/me': () => json(me) });
    await useConnection.getState().init();
    const meCalls = () => r.calls.filter((c) => c.path === '/api/me').length;
    expect(meCalls()).toBe(1);
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(meCalls()).toBe(1); // throttled
    now += CONNECT_TIMINGS.focusThrottleMs + 1;
    me = { connected: false, reason: 'revoked' };
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(useConnection.getState().status).toBe('disconnected'));
    expect(meCalls()).toBe(2);
    expect(useConnection.getState().info).toEqual({ connected: false, reason: 'revoked' });
  });

  it('treats a not_connected answer from any request as an expired sign-in', async () => {
    const r = setup({
      'GET /api/health': () => json(healthFixture()),
      'GET /api/me': () => json(connectedInfo()),
      'GET /api/crm/owners': () => errorBody('not_connected', 401),
    });
    await useConnection.getState().init();
    const { getConnectorClient } = await import('./client');
    await expect(getConnectorClient().owners()).rejects.toMatchObject({ code: 'not_connected' });
    expect(useConnection.getState().status).toBe('disconnected');
    expect(useConnection.getState().info).toEqual({ connected: false, reason: 'expired' });
    expect(r.calls).toHaveLength(3);
  });

  it('popupFeatures() centres the window', () => {
    expect(popupFeatures(500, 600)).toMatch(/^popup=yes,width=500,height=600,left=\d+,top=\d+,resizable=yes,scrollbars=yes$/);
  });
});
