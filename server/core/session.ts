/**
 * Encrypted cookie session (no database). The `uiex_session` cookie holds the SessionData sealed
 * with AES-256-GCM (see crypto.ts). The `uiex_oauth` cookie holds the OAuth state + returnTo for the
 * 10 minutes between /api/auth/start and /api/auth/callback.
 */
import { parseCookies, serializeCookie } from './cookies';
import { seal, unseal } from './crypto';
import type { ServerConfig, Session, SessionData } from './types';
import { MIN_SESSION_SECRET_LENGTH } from './config';

export const SESSION_COOKIE = 'uiex_session';
export const OAUTH_COOKIE = 'uiex_oauth';
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
  k?: string;
}

export function toWire(d: SessionData): WireSession {
  const w: WireSession = { a: d.accessToken, r: d.refreshToken, e: d.expiresAt, p: d.portalId, h: d.hubDomain, m: d.userEmail, s: d.scopes.join(' '), x: d.appHost };
  if (d.userId !== undefined) w.u = d.userId;
  if (d.personalAccessKey) w.k = d.personalAccessKey;
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
  if (typeof o.k === 'string' && o.k) data.personalAccessKey = o.k;
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
  private readonly cookies: Map<string, string>;
  private readonly outgoing = new Map<string, string>();
  /** Tokens this request has seen (redacted from logs and error messages). */
  private readonly secrets = new Set<string>();

  constructor(
    request: Request,
    private readonly config: ServerConfig,
  ) {
    this.cookies = parseCookies(request.headers.get('cookie'));
  }

  private cookieOptions(maxAge: number, path = '/') {
    return { httpOnly: true, secure: this.config.secureCookies, sameSite: 'Lax' as const, path, maxAge };
  }

  async get(): Promise<SessionData | null> {
    if (this.loaded) return this.data;
    this.loaded = true;
    const raw = this.cookies.get(SESSION_COOKIE);
    if (!raw) return null;
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
    for (const s of [data.accessToken, data.refreshToken, data.personalAccessKey]) if (s) this.secrets.add(s);
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
    const cookie = serializeCookie(SESSION_COOKIE, value, this.cookieOptions(SESSION_TTL_SECONDS));
    if (new TextEncoder().encode(cookie).length > MAX_COOKIE_BYTES) {
      throw new Error('session cookie would exceed 4 KB');
    }
    this.outgoing.set(SESSION_COOKIE, cookie);
    this.remember(data);
    this.data = data;
    this.loaded = true;
  }

  clear(): void {
    this.outgoing.set(SESSION_COOKIE, serializeCookie(SESSION_COOKIE, '', this.cookieOptions(0)));
    this.data = null;
    this.loaded = true;
  }

  /** OAuth state cookie (scoped to /api/auth). */
  async getOAuthState(): Promise<OAuthStateData | null> {
    const raw = this.cookies.get(OAUTH_COOKIE);
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
    this.outgoing.set(OAUTH_COOKIE, serializeCookie(OAUTH_COOKIE, value, this.cookieOptions(OAUTH_TTL_SECONDS, '/api/auth')));
  }

  clearOAuthState(): void {
    this.outgoing.set(OAUTH_COOKIE, serializeCookie(OAUTH_COOKIE, '', this.cookieOptions(0, '/api/auth')));
  }

  hasOAuthCookie(): boolean {
    return this.cookies.has(OAUTH_COOKIE);
  }

  /** Set-Cookie header values to add to the response. */
  setCookieHeaders(): string[] {
    return [...this.outgoing.values()];
  }
}
