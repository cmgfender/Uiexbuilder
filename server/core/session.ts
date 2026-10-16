/**
 * Encrypted cookie session (no database). The session cookie holds the SessionData sealed with
 * AES-256-GCM (see crypto.ts). The OAuth cookie holds the OAuth state + returnTo for the 10 minutes
 * between /api/auth/start and /api/auth/callback.
 *
 * Cookie names: on https (secureCookies) every cookie uses the `__Host-` prefix
 * (`__Host-uiex_session`, `__Host-uiex_oauth`), which browsers only accept when it is Secure, has
 * Path=/ and no Domain — so a page on a sibling subdomain can never plant ("toss") one of them. On
 * http://localhost development the plain names are used (`uiex_session`, `uiex_oauth`). A cookie
 * name sent more than once is ambiguous and read as "no cookie" (see cookies.ts).
 */
import { parseCookies, serializeCookie } from './cookies';
import { seal, unseal } from './crypto';
import type { ServerConfig, Session, SessionData } from './types';
import { MIN_SESSION_SECRET_LENGTH } from './config';

/** Base cookie names (used as is on http://localhost; with the `__Host-` prefix on https). */
export const SESSION_COOKIE = 'uiex_session';
export const OAUTH_COOKIE = 'uiex_oauth';
export const HOST_PREFIX = '__Host-';

/** The cookie name for this server: `__Host-<base>` when cookies are Secure (https), else `<base>`. */
export function cookieName(config: Pick<ServerConfig, 'secureCookies'>, base: string): string {
  return config.secureCookies ? `${HOST_PREFIX}${base}` : base;
}
export const sessionCookieName = (config: Pick<ServerConfig, 'secureCookies'>) => cookieName(config, SESSION_COOKIE);
export const oauthCookieName = (config: Pick<ServerConfig, 'secureCookies'>) => cookieName(config, OAUTH_COOKIE);
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OAUTH_TTL_SECONDS = 10 * 60;
/** Browsers drop cookies over 4096 bytes (name + value + attributes). */
export const MAX_COOKIE_BYTES = 4096;

/** Compact on-the-wire form of SessionData (short keys keep the cookie small). */
interface WireSession {
  a: string;
  r: string;
  e: number;
  p: number;
  h: string;
  m: string;
  u?: number;
  s: string;
  x: string;
  /** Epoch ms when HubSpot last confirmed the grant (token exchange or refresh). */
  v?: number;
}

export function toWire(d: SessionData): WireSession {
  const w: WireSession = { a: d.accessToken, r: d.refreshToken, e: d.expiresAt, p: d.portalId, h: d.hubDomain, m: d.userEmail, s: d.scopes.join(' '), x: d.appHost };
  if (d.userId !== undefined) w.u = d.userId;
  if (d.verifiedAt !== undefined) w.v = d.verifiedAt;
  // Personal access keys are never stored in the cookie (an older version could; `k` is ignored).
  return w;
}

export function fromWire(w: unknown): SessionData | null {
  if (!w || typeof w !== 'object') return null;
  const o = w as Partial<WireSession>;
  if (typeof o.a !== 'string' || typeof o.r !== 'string' || typeof o.e !== 'number' || typeof o.p !== 'number') return null;
  const data: SessionData = {
    accessToken: o.a,
    refreshToken: o.r,
    expiresAt: o.e,
    portalId: o.p,
    hubDomain: typeof o.h === 'string' ? o.h : '',
    userEmail: typeof o.m === 'string' ? o.m : '',
    scopes: typeof o.s === 'string' && o.s ? o.s.split(' ') : [],
    appHost: typeof o.x === 'string' && o.x ? o.x : 'app.hubspot.com',
  };
  if (typeof o.u === 'number') data.userId = o.u;
  if (typeof o.v === 'number') data.verifiedAt = o.v;
  return data;
}

export function sessionSecretUsable(config: ServerConfig): boolean {
  return typeof config.sessionSecret === 'string' && config.sessionSecret.length >= MIN_SESSION_SECRET_LENGTH;
}

export interface OAuthStateData {
  state: string;
  returnTo: string;
  mode: 'popup' | 'redirect';
}

/**
 * Request-scoped cookie session. Cookies to set are collected and applied to the response by the
 * connector (`setCookieHeaders`).
 */
export class CookieSession implements Session {
  private loaded = false;
  private data: SessionData | null = null;
  /** True when the request carried a session cookie that could not be read (tampered / old / expired). */
  invalidCookie = false;
  private readonly cookies: Map<string, string | null>;
  private readonly outgoing = new Map<string, string>();
  /** Tokens this request has seen (redacted from logs and error messages). */
  private readonly secrets = new Set<string>();

  constructor(
    request: Request,
    private readonly config: ServerConfig,
  ) {
    this.cookies = parseCookies(request.headers.get('cookie'));
  }

  private cookieOptions(maxAge: number) {
    return { httpOnly: true, secure: this.config.secureCookies, sameSite: 'Lax' as const, path: '/', maxAge };
  }

  /** A request cookie: undefined when absent, null when sent more than once (ambiguous). */
  readCookie(name: string): string | null | undefined {
    return this.cookies.get(name);
  }

  /** Set (or with maxAge 0, delete) an HttpOnly cookie on the response. */
  writeCookie(name: string, value: string, maxAgeSeconds: number): void {
    this.outgoing.set(name, serializeCookie(name, maxAgeSeconds > 0 ? value : '', this.cookieOptions(maxAgeSeconds)));
  }

  async get(): Promise<SessionData | null> {
    if (this.loaded) return this.data;
    this.loaded = true;
    const raw = this.cookies.get(sessionCookieName(this.config));
    if (raw === undefined || raw === '') return null;
    if (raw === null) {
      // The same session cookie name twice: one of them was planted. Trust neither.
      this.invalidCookie = true;
      this.clear();
      return null;
    }
    if (!sessionSecretUsable(this.config)) {
      this.invalidCookie = true;
      return null;
    }
    const wire = await unseal<WireSession>(raw, { secret: this.config.sessionSecret, purpose: 'session', aad: SESSION_COOKIE, now: this.config.now() });
    const data = fromWire(wire);
    if (!data) {
      // Tampered, sealed with a rotated secret, an old format, or expired: treat as signed out.
      this.invalidCookie = true;
      this.clear();
      return null;
    }
    this.remember(data);
    this.data = data;
    return data;
  }

  private remember(data: SessionData): void {
    for (const s of [data.accessToken, data.refreshToken]) if (s) this.secrets.add(s);
  }

  /** Every token read from or written to the session during this request. */
  knownSecrets(): string[] {
    return [...this.secrets];
  }

  async set(data: SessionData): Promise<void> {
    if (!sessionSecretUsable(this.config)) throw new Error('SESSION_SECRET is not configured');
    const value = await seal(toWire(data), {
      secret: this.config.sessionSecret,
      purpose: 'session',
      aad: SESSION_COOKIE,
      now: this.config.now(),
      ttlSeconds: SESSION_TTL_SECONDS,
    });
    const name = sessionCookieName(this.config);
    const cookie = serializeCookie(name, value, this.cookieOptions(SESSION_TTL_SECONDS));
    if (new TextEncoder().encode(cookie).length > MAX_COOKIE_BYTES) {
      throw new Error('session cookie would exceed 4 KB');
    }
    this.outgoing.set(name, cookie);
    this.remember(data);
    this.data = data;
    this.loaded = true;
  }

  clear(): void {
    this.writeCookie(sessionCookieName(this.config), '', 0);
    this.data = null;
    this.loaded = true;
  }

  /** OAuth state cookie (between /api/auth/start and /api/auth/callback). */
  async getOAuthState(): Promise<OAuthStateData | null> {
    const raw = this.cookies.get(oauthCookieName(this.config));
    // Absent, or sent twice (one of them planted): no usable state.
    if (!raw || !sessionSecretUsable(this.config)) return null;
    const data = await unseal<OAuthStateData>(raw, { secret: this.config.sessionSecret, purpose: 'oauth-state', aad: OAUTH_COOKIE, now: this.config.now() });
    if (!data || typeof data.state !== 'string' || typeof data.returnTo !== 'string') return null;
    return { state: data.state, returnTo: data.returnTo, mode: data.mode === 'redirect' ? 'redirect' : 'popup' };
  }

  async setOAuthState(data: OAuthStateData): Promise<void> {
    const value = await seal(data, {
      secret: this.config.sessionSecret,
      purpose: 'oauth-state',
      aad: OAUTH_COOKIE,
      now: this.config.now(),
      ttlSeconds: OAUTH_TTL_SECONDS,
    });
    this.writeCookie(oauthCookieName(this.config), value, OAUTH_TTL_SECONDS);
  }

  clearOAuthState(): void {
    this.writeCookie(oauthCookieName(this.config), '', 0);
  }

  hasOAuthCookie(): boolean {
    return this.cookies.has(oauthCookieName(this.config));
  }

  /** Set-Cookie header values to add to the response. */
  setCookieHeaders(): string[] {
    return [...this.outgoing.values()];
  }
}
