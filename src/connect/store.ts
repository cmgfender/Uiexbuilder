/**
 * Connection store: is a HubSpot connector available, is the user signed in, and the sign-in flow.
 *
 *  init()        probes GET /api/health (no connector → 'unavailable'; OAuth not set up →
 *                'not-configured'), then GET /api/me. Also picks up the result of a full-page
 *                sign-in (`?uiex_auth=` on return) and re-checks /api/me when the window regains
 *                focus (throttled), so an expired or revoked sign-in shows up without a reload.
 *  connect()     opens a centred popup on /api/auth/start?returnTo=<origin>&mode=popup and waits for
 *                its { type: 'uiex-hubspot-auth' } message (from the connector origin only; also via
 *                BroadcastChannel when same-origin). A blocked popup ends the attempt with
 *                'popup_blocked': the UI then offers "Continue in this tab" (connectInThisTab, a
 *                full-page sign-in that returns to the builder). A closed popup / timeout ends the
 *                attempt ('popup_closed' / 'timeout'; the UI asks "What did HubSpot show?").
 *  connectInThisTab()  full-page sign-in (?mode=redirect) in this tab, for a blocked or broken window.
 *  disconnect()  POST /api/auth/logout.
 *
 * Nothing is persisted: tokens live in the connector's HttpOnly cookie, never in the browser.
 */
import { create } from 'zustand';
import type { ConnectionInfo, ConnectorHealth } from './types';
import { getConnectorClient, isAbortError, isConnectorError, type ConnectorClient } from './client';
import { describeAuthResult, describeError } from './describe';
import { setHubSpotAccess } from '../model/trust';

/**
 * 'checking'     – probing /api/health and /api/me on startup
 * 'unavailable'  – no connector server (e.g. static hosting): connecting is not possible here
 * 'not-configured' – server present but OAuth env vars missing
 * 'disconnected' – ready to connect
 * 'connecting'   – OAuth popup open
 * 'connected'
 * 'error'
 */
export type ConnectionErrorSource = 'sign-in' | 'sign-out' | 'startup';

export type ConnectionStatus = 'checking' | 'unavailable' | 'not-configured' | 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Something worth telling the person once (the shell shows it as a toast): connected, disconnected,
 * or the sign-in expired / was removed while they were working. `id` changes for every notice.
 */
export interface ConnectionNotice {
  id: number;
  kind: 'connected' | 'disconnected' | 'expired';
  /** Account name for 'connected'. */
  account?: string;
}

export interface ConnectionState {
  status: ConnectionStatus;
  health: ConnectorHealth | null;
  info: ConnectionInfo;
  /** Plain-language message about the last failure (connect attempt, startup check, disconnect). */
  error: string | null;
  /** Probe the connector (called once at startup by the shell). */
  init: () => Promise<void>;
  /** Open the HubSpot sign-in popup. Resolves when connected or the popup closes. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  // ---- additive (beyond the original contract)
  /** Machine code of `error` ('access_denied', 'popup_closed', 'timeout', 'network_error' …). */
  errorCode: string | null;
  /** What failed: a sign-in attempt, signing out, or the startup check. */
  errorSource: ConnectionErrorSource | null;
  /** Epoch ms of the last sign-in completed in this tab (popup or redirect); null before. */
  connectedAt: number | null;
  /** Re-check /api/me now (e.g. after an expired-session error). */
  refresh: () => Promise<void>;
  /** Stop waiting for the sign-in window (closes it). */
  cancelConnect: () => void;
  /** Sign in to another HubSpot account: signs out, then opens the sign-in window. */
  switchPortal: () => Promise<void>;
  /** Bring the open sign-in window to the front. */
  focusPopup: () => void;
  clearError: () => void;
  /** Epoch ms when the current sign-in attempt started ('connecting'); null otherwise. */
  connectingSince: number | null;
  /** Last thing worth a toast (see ConnectionNotice). */
  notice: ConnectionNotice | null;
  /** Give up on the open sign-in window and open a new one (must run inside a click). */
  restartConnect: () => Promise<void>;
  /**
   * Sign in in this tab instead of a window (full-page redirect to HubSpot and back): one click for
   * a blocked or broken sign-in window. Closes an open sign-in window first; after a blocked
   * "Switch account" it signs out first. The page navigates away (autosave flushes on unload).
   */
  connectInThisTab: () => Promise<void>;
}

/** Message posted by the connector's sign-in result page (server/core/authPage.ts). */
export const AUTH_MESSAGE_TYPE = 'uiex-hubspot-auth';
export const AUTH_BROADCAST_CHANNEL = 'uiex-hubspot-auth';
/** Query parameter the connector appends to the return URL in redirect mode. */
export const AUTH_RESULT_PARAM = 'uiex_auth';
const POPUP_NAME = 'uiex-hubspot-connect';

export const CONNECT_TIMINGS = {
  /** How often the popup is checked for being closed. */
  popupPollMs: 500,
  /** After the popup closed: wait this long for a late message before asking /api/me. */
  closedGraceMs: 1200,
  /**
   * A popup that "closes" this soon after opening was most likely cut off by HubSpot's security
   * headers (Cross-Origin-Opener-Policy) rather than closed by the user: keep waiting for the
   * result (BroadcastChannel / polling /api/me, and again whenever this window regains focus) —
   * but only for `cutOffGiveUpMs`, then report "HubSpot was not connected".
   */
  earlyCloseMs: 4000,
  /** Polling interval of /api/me while waiting for a cut-off popup. */
  waitPollMs: 3000,
  /** How long to keep waiting for a cut-off popup before giving up (popup_closed). */
  cutOffGiveUpMs: 60_000,
  /** After this long in 'connecting' the button shows a visible "Waiting for HubSpot…" panel. */
  waitingHintMs: 8000,
  /**
   * After this long the panel says "Still waiting for HubSpot… having trouble?" and opens its
   * "What does HubSpot show?" help (HubSpot shows install refusals inside its window, and never
   * comes back).
   */
  stillWaitingMs: 30_000,
  /** Give up waiting for the sign-in after this long. */
  timeoutMs: 5 * 60_000,
  /** Minimum time between /api/me re-checks triggered by window focus. */
  focusThrottleMs: 30_000,
};

/** Browser hooks (replaced in tests). */
export const connectEnv = {
  open: (url: string, name: string, features: string): Window | null => window.open(url, name, features),
  navigate: (url: string): void => window.location.assign(url),
  now: (): number => Date.now(),
};

const SIGNED_OUT: ConnectionInfo = { connected: false, reason: 'signed-out' };

interface AuthMessage {
  type: typeof AUTH_MESSAGE_TYPE;
  ok: boolean;
  error?: string;
  message?: string;
}

function isAuthMessage(data: unknown): data is AuthMessage {
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === AUTH_MESSAGE_TYPE && typeof (data as { ok?: unknown }).ok === 'boolean';
}

function validInfo(info: unknown): ConnectionInfo {
  if (info && typeof info === 'object' && (info as { connected?: unknown }).connected === true) {
    const i = info as Extract<ConnectionInfo, { connected: true }>;
    if (typeof i.portalId === 'number') {
      return {
        connected: true,
        portalId: i.portalId,
        hubDomain: typeof i.hubDomain === 'string' ? i.hubDomain : '',
        user: i.user && typeof i.user === 'object' ? { ...(typeof i.user.id === 'number' ? { id: i.user.id } : {}), email: typeof i.user.email === 'string' ? i.user.email : '' } : { email: '' },
        scopes: Array.isArray(i.scopes) ? i.scopes.filter((s): s is string => typeof s === 'string') : [],
        expiresAt: typeof i.expiresAt === 'number' ? i.expiresAt : 0,
        appHost: typeof i.appHost === 'string' && /^[a-z0-9.-]+$/i.test(i.appHost) ? i.appHost : 'app.hubspot.com',
      };
    }
  }
  const reason = info && typeof info === 'object' ? (info as { reason?: unknown }).reason : undefined;
  return reason === 'expired' || reason === 'revoked' || reason === 'signed-out' ? { connected: false, reason } : SIGNED_OUT;
}

/** Errors that mean "there is no connector here" (static hosting, dev without the server …). */
function meansNoConnector(err: unknown): boolean {
  if (!isConnectorError(err)) return true;
  return err.code === 'network_error' || err.code === 'unavailable' || err.code === 'connector_offline' || err.status === 404;
}

function isValidHealth(h: unknown): h is ConnectorHealth {
  return !!h && typeof h === 'object' && (h as ConnectorHealth).ok === true && typeof (h as ConnectorHealth).oauthConfigured === 'boolean';
}

function normalizeHealth(h: ConnectorHealth): ConnectorHealth {
  const features = h.features && typeof h.features === 'object' ? h.features : { crm: h.oauthConfigured, fetchProxy: false, deploy: false };
  const scopes = h.scopes && typeof h.scopes === 'object' ? h.scopes : { required: [], optional: [] };
  const out: ConnectorHealth = {
    ok: true,
    version: typeof h.version === 'string' ? h.version : '',
    oauthConfigured: h.oauthConfigured,
    features: { crm: !!features.crm, fetchProxy: !!features.fetchProxy, deploy: !!features.deploy },
    scopes: {
      required: Array.isArray(scopes.required) ? scopes.required.filter((s) => typeof s === 'string') : [],
      optional: Array.isArray(scopes.optional) ? scopes.optional.filter((s) => typeof s === 'string') : [],
    },
  };
  if (features.deployUnavailableReason === 'disabled' || features.deployUnavailableReason === 'session_secret') {
    out.features.deployUnavailableReason = features.deployUnavailableReason;
  }
  if (features.deployNeedsSignIn === true) out.features.deployNeedsSignIn = true;
  if (Array.isArray(h.missingSettings)) out.missingSettings = h.missingSettings.filter((s): s is string => typeof s === 'string' && /^[A-Z_]{2,40}$/.test(s));
  if (typeof h.appBase === 'string' && /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(h.appBase)) out.appBase = h.appBase.replace(/\/+$/, '');
  return out;
}

let noticeSeq = 0;
function notify(kind: ConnectionNotice['kind'], account?: string): void {
  useConnection.setState({ notice: { id: ++noticeSeq, kind, ...(account ? { account } : {}) } });
}

/** The HubSpot app base for links: health.appBase (EU / demo) or https://<appHost>. */
export function hubspotAppOrigin(appHost: string | undefined): string {
  const base = useConnection.getState().health?.appBase;
  if (base) return base;
  const host = appHost && /^[a-z0-9.-]+$/i.test(appHost) ? appHost : 'app.hubspot.com';
  return `https://${host}`;
}

/** Reads and removes `?uiex_auth=<result>` (full-page sign-in result) from the address bar. */
function consumeRedirectResult(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get(AUTH_RESULT_PARAM);
    if (value === null) return null;
    url.searchParams.delete(AUTH_RESULT_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    return /^[a-z_]{1,64}$/.test(value) ? value : 'unknown_error';
  } catch {
    return null;
  }
}

/** The current page address without a previous sign-in result (return URL of redirect mode). */
function returnUrl(): string {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(AUTH_RESULT_PARAM);
    return url.toString();
  } catch {
    return window.location.origin;
  }
}

export function popupFeatures(width = 560, height = 720): string {
  const w = typeof window !== 'undefined' ? window : undefined;
  const sx = w?.screenX ?? 0;
  const sy = w?.screenY ?? 0;
  const ow = w?.outerWidth || w?.innerWidth || width;
  const oh = w?.outerHeight || w?.innerHeight || height;
  const left = Math.max(0, Math.round(sx + (ow - width) / 2));
  const top = Math.max(0, Math.round(sy + (oh - height) / 2));
  return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

// ---------------------------------------------------------------------------------- flow state

type Outcome =
  | { kind: 'connected'; info: ConnectionInfo }
  | { kind: 'failed'; code: string; message?: string }
  | { kind: 'cancelled' };

interface Flow {
  popup: Window;
  promise: Promise<void>;
  cancel: () => void;
}

let flow: Flow | null = null;
let attemptSeq = 0;
/** The last blocked attempt was "Switch account": continuing in this tab signs out first. */
let blockedSwitch = false;
let initPromise: Promise<void> | null = null;
let focusWatcher: (() => void) | null = null;
let lastMeCheck = 0;
const listenedClients = new WeakSet<ConnectorClient>();

function client(): ConnectorClient {
  const c = getConnectorClient();
  if (!listenedClients.has(c)) {
    listenedClients.add(c);
    // Any request answered "not connected" means the sign-in expired or was revoked.
    c.onError((err) => {
      if (err.code !== 'not_connected') return;
      const s = useConnection.getState();
      if (s.status === 'connected') {
        c.setCacheScope(null);
        useConnection.setState({ status: 'disconnected', info: { connected: false, reason: 'expired' } });
        notify('expired');
      }
    });
  }
  return c;
}

async function fetchMe(): Promise<ConnectionInfo | null> {
  try {
    const info = validInfo(await client().me());
    lastMeCheck = connectEnv.now();
    return info;
  } catch (err) {
    if (isConnectorError(err) && err.code === 'not_connected') return { connected: false, reason: 'expired' };
    return null;
  }
}

function applyInfo(info: ConnectionInfo): void {
  const c = client();
  if (info.connected) {
    c.setCacheScope(String(info.portalId));
    const prev = useConnection.getState().info;
    // Keep the same object when nothing changed (fewer re-renders on focus re-checks).
    const same = prev.connected && JSON.stringify(prev) === JSON.stringify(info);
    useConnection.setState({ status: 'connected', info: same ? prev : info });
  } else {
    c.setCacheScope(null);
    const was = useConnection.getState();
    useConnection.setState({ status: 'disconnected', info });
    if (was.status === 'connected' && (info.reason === 'expired' || info.reason === 'revoked')) notify('expired');
  }
}

function settle(outcome: Outcome, previous: { status: ConnectionStatus; info: ConnectionInfo }): void {
  if (outcome.kind === 'connected' && outcome.info.connected) {
    applyInfo(outcome.info);
    useConnection.setState({ error: null, errorCode: null, errorSource: null, connectedAt: connectEnv.now(), connectingSince: null });
    notify('connected', outcome.info.hubDomain || `account ${outcome.info.portalId}`);
    return;
  }
  useConnection.setState({ connectingSince: null });
  if (outcome.kind === 'cancelled') {
    useConnection.setState({ status: previous.status === 'connecting' ? 'disconnected' : previous.status, info: previous.info });
    return;
  }
  if (outcome.kind === 'failed') {
    if (outcome.code === 'not_configured') {
      useConnection.setState({ status: 'not-configured', error: null, errorCode: null, errorSource: null });
      return;
    }
    const d = describeAuthResult(outcome.code, outcome.message);
    const status: ConnectionStatus = previous.info.connected && previous.status === 'connected' ? 'connected' : 'disconnected';
    useConnection.setState({ status, info: status === 'connected' ? previous.info : previous.info.connected ? SIGNED_OUT : previous.info, error: d.message, errorCode: outcome.code, errorSource: 'sign-in' });
  }
}

/** Waits for the popup's result. Resolves with the outcome (never rejects). */
function watchPopup(popup: Window, openedAt: number): { promise: Promise<Outcome>; cancel: () => void } {
  const c = client();
  let finish: (o: Outcome) => void = () => {};
  const promise = new Promise<Outcome>((resolve) => {
    let done = false;
    let closedAt: number | null = null;
    let checking = false;
    let lastPoll = 0;
    let channel: BroadcastChannel | null = null;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
      if (channel) {
        try {
          channel.close();
        } catch {
          /* ignore */
        }
      }
    };
    finish = (o: Outcome) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(o);
    };

    const onResult = async (msg: AuthMessage) => {
      if (done) return;
      if (!msg.ok) {
        finish({ kind: 'failed', code: typeof msg.error === 'string' && msg.error ? msg.error : 'unknown_error', message: typeof msg.message === 'string' ? msg.message : undefined });
        return;
      }
      checking = true;
      const info = await fetchMe();
      checking = false;
      if (done) return;
      if (info?.connected) finish({ kind: 'connected', info });
      else finish({ kind: 'failed', code: info ? 'session_not_kept' : 'network_error' });
    };

    const onMessage = (event: MessageEvent) => {
      // Only the connector's own pages may report a sign-in result.
      if (event.origin !== c.origin) return;
      if (!isAuthMessage(event.data)) return;
      void onResult(event.data);
    };
    window.addEventListener('message', onMessage);
    // Back in the builder after finishing (or giving up) in a cut-off HubSpot window: check right away.
    const onFocus = () => {
      if (done || checking || closedAt === null) return;
      lastPoll = 0;
    };
    window.addEventListener('focus', onFocus);
    // Fallback when HubSpot's pages cut the popup's link to this window (same-origin connector only).
    if (c.sameOrigin && typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
        channel.onmessage = (event: MessageEvent) => {
          if (isAuthMessage(event.data)) void onResult(event.data);
        };
      } catch {
        channel = null;
      }
    }

    const timer = setInterval(() => {
      if (done || checking) return;
      const now = connectEnv.now();
      if (now - openedAt >= CONNECT_TIMINGS.timeoutMs) {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
        finish({ kind: 'failed', code: 'timeout' });
        return;
      }
      let closed = false;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (!closed) return;
      if (closedAt === null) closedAt = now;
      const cutOff = closedAt - openedAt < CONNECT_TIMINGS.earlyCloseMs;
      if (!cutOff && now - closedAt < CONNECT_TIMINGS.closedGraceMs) return;
      if (cutOff && lastPoll !== 0 && now - lastPoll < CONNECT_TIMINGS.waitPollMs) return;
      const givingUp = cutOff && now - closedAt >= CONNECT_TIMINGS.cutOffGiveUpMs;
      lastPoll = now;
      checking = true;
      void fetchMe().then((info) => {
        checking = false;
        if (done) return;
        if (info?.connected) finish({ kind: 'connected', info });
        else if (!cutOff || givingUp) finish({ kind: 'failed', code: 'popup_closed' });
        // A cut-off popup: keep waiting a little (BroadcastChannel / next poll / focus / Cancel).
      });
    }, CONNECT_TIMINGS.popupPollMs);
  });
  return { promise, cancel: () => finish({ kind: 'cancelled' }) };
}

/**
 * Starts a sign-in. `beforeAuth` runs after the popup is open (it must be opened synchronously in
 * the click handler or the browser blocks it), e.g. signing out first when switching accounts.
 */
function startSignIn(beforeAuth?: () => Promise<void>): Promise<void> {
  if (flow) {
    try {
      flow.popup.focus();
    } catch {
      /* ignore */
    }
    return flow.promise;
  }
  const c = client();
  const state = useConnection.getState();
  const previous = { status: state.status, info: state.info };
  const url = c.authStartUrl({ returnTo: window.location.origin, mode: 'popup' });
  let popup: Window | null = null;
  try {
    // A fresh window name per attempt: "Start again" must never reuse (and then close) the old window.
    popup = connectEnv.open(beforeAuth ? 'about:blank' : url, `${POPUP_NAME}-${++attemptSeq}`, popupFeatures());
  } catch {
    popup = null;
  }
  let blocked = !popup;
  try {
    blocked = blocked || popup!.closed;
  } catch {
    /* treat as open */
  }

  if (blocked || !popup) {
    // Popup blocked: nothing changed yet. The UI offers "Continue in this tab" (connectInThisTab) —
    // one click, and the person knows the page is about to go to HubSpot and come back.
    blockedSwitch = !!beforeAuth;
    useConnection.setState({ connectingSince: null });
    settle({ kind: 'failed', code: 'popup_blocked' }, previous);
    return Promise.resolve();
  }
  blockedSwitch = false;
  useConnection.setState({ status: 'connecting', error: null, errorCode: null, errorSource: null, connectingSince: connectEnv.now() });

  const win = popup;
  const openedAt = connectEnv.now();
  const watcher = watchPopup(win, openedAt);
  let self: Flow | null = null;
  const promise = (async () => {
    let prepError: unknown = null;
    if (beforeAuth) {
      try {
        await beforeAuth();
        win.location.href = url;
      } catch (err) {
        prepError = err;
        watcher.cancel();
      }
    }
    const outcome = await watcher.promise;
    // "Start again" replaced this attempt with a new window: the new attempt reports the result.
    const superseded = flow !== self;
    if (!superseded) flow = null;
    if (outcome.kind !== 'connected') {
      try {
        if (!win.closed) win.close();
      } catch {
        /* ignore */
      }
    }
    if (superseded && outcome.kind === 'cancelled') return;
    if (prepError) {
      // Signing out of the current account failed: nothing changed.
      settle({ kind: 'cancelled' }, previous);
      useConnection.setState({
        error: `Couldn't switch accounts: ${describeError(prepError).message}`,
        errorCode: isConnectorError(prepError) ? prepError.code : 'unknown_error',
        errorSource: 'sign-in',
      });
      return;
    }
    settle(outcome, beforeAuth ? { status: 'disconnected', info: useConnection.getState().info } : previous);
  })();
  self = { popup: win, promise, cancel: watcher.cancel };
  flow = self;
  return promise;
}

function installFocusWatcher(): void {
  if (focusWatcher || typeof window === 'undefined') return;
  const onFocus = () => {
    const s = useConnection.getState();
    if (s.status !== 'connected') return;
    if (connectEnv.now() - lastMeCheck < CONNECT_TIMINGS.focusThrottleMs) return;
    void s.refresh();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') onFocus();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisible);
  focusWatcher = () => {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

async function runInit(): Promise<void> {
  useConnection.setState({ status: 'checking', error: null, errorCode: null, errorSource: null });
  const redirectResult = consumeRedirectResult();
  const c = client();
  if (c.disabled) {
    // A static build without a connector: "available on the hosted version", without a request.
    useConnection.setState({ status: 'unavailable', health: null });
    return;
  }
  let health: ConnectorHealth;
  try {
    const h: unknown = await c.health();
    if (!isValidHealth(h)) {
      useConnection.setState({ status: 'unavailable', health: null });
      return;
    }
    health = normalizeHealth(h);
  } catch (err) {
    if (meansNoConnector(err)) {
      useConnection.setState({ status: 'unavailable', health: null });
    } else {
      const d = describeError(err);
      useConnection.setState({ status: 'error', health: null, error: d.message, errorCode: isConnectorError(err) ? err.code : 'unknown_error', errorSource: 'startup' });
    }
    return;
  }
  if (!health.oauthConfigured) {
    useConnection.setState({ status: 'not-configured', health, info: SIGNED_OUT });
    return;
  }
  useConnection.setState({ health });
  installFocusWatcher();
  let info: ConnectionInfo;
  try {
    info = validInfo(await c.me());
    lastMeCheck = connectEnv.now();
  } catch (err) {
    if (isConnectorError(err) && err.code === 'not_connected') {
      info = { connected: false, reason: 'expired' };
    } else {
      const d = describeError(err);
      useConnection.setState({ status: 'error', error: d.message, errorCode: isConnectorError(err) ? err.code : 'unknown_error', errorSource: 'startup' });
      return;
    }
  }
  applyInfo(info);
  if (redirectResult) {
    if (redirectResult === 'connected') {
      if (info.connected) {
        useConnection.setState({ connectedAt: connectEnv.now() });
        notify('connected', info.hubDomain || `account ${info.portalId}`);
      }
      else settle({ kind: 'failed', code: 'session_not_kept' }, { status: 'disconnected', info });
    } else {
      settle({ kind: 'failed', code: redirectResult }, { status: 'disconnected', info });
    }
  }
}

export const useConnection = create<ConnectionState>()((_set, get) => ({
  status: 'checking',
  health: null,
  info: SIGNED_OUT,
  error: null,
  errorCode: null,
  errorSource: null,
  connectedAt: null,
  connectingSince: null,
  notice: null,

  init: () => {
    const s = get();
    // Once per page; a failed check ('error') may be retried.
    if (initPromise && s.status !== 'error') return initPromise;
    initPromise = runInit().catch(() => {
      useConnection.setState({ status: 'unavailable', health: null });
    });
    return initPromise;
  },

  connect: () => {
    const s = get();
    if (!s.health?.oauthConfigured) {
      // Nothing to connect to; a failed startup check is retried instead.
      return s.status === 'error' ? get().init() : Promise.resolve();
    }
    return startSignIn();
  },

  switchPortal: () => {
    const s = get();
    if (!s.health?.oauthConfigured) return Promise.resolve();
    return startSignIn(async () => {
      try {
        await client().logout();
      } catch (err) {
        if (!(isConnectorError(err) && err.code === 'not_connected')) throw err;
      }
      client().setCacheScope(null);
      useConnection.setState({ info: SIGNED_OUT });
    });
  },

  disconnect: async () => {
    flow?.cancel();
    const c = client();
    try {
      await c.logout();
    } catch (err) {
      if (!(isConnectorError(err) && err.code === 'not_connected') && !isAbortError(err)) {
        const d = describeError(err);
        useConnection.setState({ error: `Couldn't disconnect: ${d.message}`, errorCode: isConnectorError(err) ? err.code : 'unknown_error', errorSource: 'sign-out' });
        return;
      }
    }
    c.setCacheScope(null);
    const wasConnected = get().status === 'connected';
    useConnection.setState({ status: 'disconnected', info: SIGNED_OUT, error: null, errorCode: null, errorSource: null });
    if (wasConnected) notify('disconnected');
  },

  refresh: async () => {
    const s = get();
    if (s.status !== 'connected' && s.status !== 'disconnected') return;
    const info = await fetchMe();
    if (!info) return; // offline for a moment: keep the current state
    if (get().status === 'connecting') return;
    applyInfo(info);
  },

  cancelConnect: () => {
    if (!flow) return;
    try {
      flow.popup.close();
    } catch {
      /* ignore */
    }
    flow.cancel();
  },

  restartConnect: () => {
    const current = flow;
    flow = null;
    // Open the new window first (synchronously, inside the click, so it isn't blocked)…
    const next = startSignIn();
    // …then drop the old attempt; it sees it was superseded and reports nothing.
    if (current) {
      try {
        current.popup.close();
      } catch {
        /* ignore */
      }
      current.cancel();
    }
    return next;
  },

  connectInThisTab: async () => {
    const s = get();
    if (!s.health?.oauthConfigured) return;
    // An open sign-in window is given up quietly (it sees it was superseded and reports nothing).
    const current = flow;
    flow = null;
    if (current) {
      try {
        current.popup.close();
      } catch {
        /* ignore */
      }
      current.cancel();
    }
    const c = client();
    const switching = blockedSwitch;
    blockedSwitch = false;
    const previous = { status: s.status === 'connecting' ? ('disconnected' as const) : s.status, info: s.info };
    useConnection.setState({ status: 'connecting', error: null, errorCode: null, errorSource: null, connectingSince: connectEnv.now() });
    if (switching) {
      try {
        await c.logout();
      } catch (err) {
        if (!(isConnectorError(err) && err.code === 'not_connected')) {
          settle({ kind: 'cancelled' }, previous);
          useConnection.setState({
            error: `Couldn't switch accounts: ${describeError(err).message}`,
            errorCode: isConnectorError(err) ? err.code : 'unknown_error',
            errorSource: 'sign-in',
          });
          return;
        }
      }
      c.setCacheScope(null);
      useConnection.setState({ info: SIGNED_OUT });
    }
    connectEnv.navigate(c.authStartUrl({ returnTo: returnUrl(), mode: 'redirect' }));
  },

  focusPopup: () => {
    try {
      flow?.popup.focus();
    } catch {
      /* ignore */
    }
  },

  clearError: () => useConnection.setState({ error: null, errorCode: null, errorSource: null }),
}));

// Code of imported projects asks for trust again once HubSpot is connected (model/trust.ts).
useConnection.subscribe((s) => setHubSpotAccess(s.status === 'connected' && s.info.connected));

/** Test helper: forget the startup check, the sign-in flow and the focus watcher. */
export function resetConnectionForTests(): void {
  flow?.cancel();
  flow = null;
  blockedSwitch = false;
  initPromise = null;
  focusWatcher?.();
  focusWatcher = null;
  lastMeCheck = 0;
  useConnection.setState({ status: 'checking', health: null, info: SIGNED_OUT, error: null, errorCode: null, errorSource: null, connectedAt: null, connectingSince: null, notice: null });
}

/** The connected account, or null. */
export function connectedInfo(state: Pick<ConnectionState, 'info'>): Extract<ConnectionInfo, { connected: true }> | null {
  return state.info.connected ? state.info : null;
}
