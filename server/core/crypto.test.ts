// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, bytesToBase64Url, randomToken, seal, timingSafeEqual, unseal } from './crypto';
import { parseCookieList, parseCookies, serializeCookie } from './cookies';
import { CookieSession, MAX_COOKIE_BYTES, OAUTH_COOKIE, SESSION_COOKIE, fromWire, oauthCookieName, sessionCookieName, toWire } from './session';
import { configFromEnv } from './config';
import type { SessionData } from './types';

const SECRET = 'a-very-long-session-secret-with-enough-entropy-123';
const NOW = Date.parse('2025-06-01T12:00:00Z');
const base = { secret: SECRET, purpose: 'session', aad: 'uiex_session', now: NOW };

describe('base64url + random', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const enc = bytesToBase64Url(bytes);
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...base64UrlToBytes(enc)]).toEqual([...bytes]);
    expect(() => base64UrlToBytes('not base64!')).toThrow();
  });
  it('randomToken is unique and url-safe', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('seal / unseal (AES-256-GCM, HKDF key)', () => {
  it('round-trips and does not reveal the plaintext', async () => {
    const sealed = await seal({ token: 'super-secret-token' }, { ...base, ttlSeconds: 60 });
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('super-secret-token');
    expect(await unseal(sealed, base)).toEqual({ token: 'super-secret-token' });
  });

  it('uses a fresh IV each time', async () => {
    const a = await seal({ x: 1 }, { ...base, ttlSeconds: 60 });
    const b = await seal({ x: 1 }, { ...base, ttlSeconds: 60 });
    expect(a).not.toBe(b);
  });

  it('rejects tampered values', async () => {
    const sealed = await seal({ x: 1 }, { ...base, ttlSeconds: 60 });
    const [v, iv, ct] = sealed.split('.');
    const bytes = base64UrlToBytes(ct);
    bytes[0] ^= 1;
    expect(await unseal(`${v}.${iv}.${bytesToBase64Url(bytes)}`, base)).toBeNull();
    const ivBytes = base64UrlToBytes(iv);
    ivBytes[3] ^= 1;
    expect(await unseal(`${v}.${bytesToBase64Url(ivBytes)}.${ct}`, base)).toBeNull();
    expect(await unseal(`v2.${iv}.${ct}`, base)).toBeNull();
    expect(await unseal('garbage', base)).toBeNull();
    expect(await unseal('v1.!!.!!', base)).toBeNull();
    expect(await unseal('', base)).toBeNull();
  });

  it('rejects values sealed with another secret (rotation) or for another cookie/purpose', async () => {
    const sealed = await seal({ x: 1 }, { ...base, ttlSeconds: 60 });
    expect(await unseal(sealed, { ...base, secret: `${SECRET}-rotated` })).toBeNull();
    expect(await unseal(sealed, { ...base, aad: 'uiex_oauth' })).toBeNull();
    expect(await unseal(sealed, { ...base, purpose: 'oauth-state' })).toBeNull();
  });

  it('rejects expired values', async () => {
    const sealed = await seal({ x: 1 }, { ...base, ttlSeconds: 60 });
    expect(await unseal(sealed, { ...base, now: NOW + 59_000 })).toEqual({ x: 1 });
    expect(await unseal(sealed, { ...base, now: NOW + 61_000 })).toBeNull();
  });
});

describe('cookies', () => {
  it('parses and serialises', () => {
    // A name sent twice is ambiguous (one copy may have been planted by a sibling subdomain): null.
    expect(parseCookies('a=1; b="2"; a=3; junk; c=')).toEqual(
      new Map<string, string | null>([
        ['a', null],
        ['b', '2'],
        ['c', ''],
      ]),
    );
    expect(parseCookieList('a=1; a=3')).toEqual(new Map([['a', ['1', '3']]]));
    expect(serializeCookie('__Host-n', 'v', { secure: true })).toBe('__Host-n=v; Path=/; Secure');
    expect(() => serializeCookie('__Host-n', 'v', { secure: false })).toThrow(/__Host-/);
    expect(() => serializeCookie('__Host-n', 'v', { secure: true, path: '/api' })).toThrow(/__Host-/);
    expect(serializeCookie('n', 'v', { httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 10 })).toBe('n=v; Path=/; Max-Age=10; HttpOnly; Secure; SameSite=Lax');
    expect(serializeCookie('n', '', { maxAge: 0 })).toContain('Expires=Thu, 01 Jan 1970');
    expect(() => serializeCookie('bad name', 'v')).toThrow();
    expect(() => serializeCookie('n', 'a;b')).toThrow();
  });
});

function bigSession(): SessionData {
  return {
    // Generous sizes: real HubSpot access tokens are a few hundred characters.
    accessToken: 'C'.repeat(1000),
    refreshToken: 'eu1-12345678-1234-1234-1234-123456789012',
    expiresAt: NOW + 1_800_000,
    portalId: 987654321,
    hubDomain: 'a-rather-long-portal-domain-name.example.com',
    userEmail: 'someone.with.a.long.name@a-rather-long-portal-domain-name.example.com',
    userId: 123456789,
    scopes: [
      'oauth',
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.deals.read',
      'crm.schemas.contacts.read',
      'crm.schemas.companies.read',
      'crm.schemas.deals.read',
      'tickets',
      'crm.objects.custom.read',
      'crm.schemas.custom.read',
      'crm.objects.owners.read',
      'crm.objects.line_items.read',
      'crm.objects.products.read',
      'crm.objects.quotes.read',
      'crm.objects.leads.read',
      'crm.objects.appointments.read',
      'crm.objects.listings.read',
      'crm.objects.services.read',
      'crm.objects.courses.read',
      'crm.objects.invoices.read',
    ],
    appHost: 'app-eu1.hubspot.com',
    verifiedAt: NOW - 1000,
  };
}

describe('CookieSession', () => {
  const config = configFromEnv({ APP_URL: 'https://b.example.com', HUBSPOT_CLIENT_ID: 'c', HUBSPOT_CLIENT_SECRET: 's', SESSION_SECRET: SECRET }, { now: () => NOW });
  const request = (cookie?: string) => new Request('https://b.example.com/api/me', { headers: cookie ? { cookie } : {} });

  const SESSION = sessionCookieName(config);
  const OAUTH = oauthCookieName(config);

  it('uses __Host- cookie names on https and plain names on http://localhost', () => {
    expect(SESSION).toBe('__Host-uiex_session');
    expect(OAUTH).toBe('__Host-uiex_oauth');
    const local = configFromEnv({ APP_URL: 'http://localhost:5173', SESSION_SECRET: SECRET });
    expect(sessionCookieName(local)).toBe(SESSION_COOKIE);
    expect(oauthCookieName(local)).toBe(OAUTH_COOKIE);
  });

  it('wire format round-trips', () => {
    const data = bigSession();
    expect(fromWire(JSON.parse(JSON.stringify(toWire(data))))).toEqual(data);
    expect(fromWire({ a: 1 })).toBeNull();
    expect(fromWire(null)).toBeNull();
  });

  it("never stores a personal access key (an old cookie's key is ignored)", () => {
    const wire = toWire({ ...bigSession(), personalAccessKey: 'pat-eu1-secret-key' });
    expect(JSON.stringify(wire)).not.toContain('pat-eu1-secret-key');
    expect(fromWire({ ...wire, k: 'pat-eu1-old-key' })?.personalAccessKey).toBeUndefined();
  });

  it('sets an HttpOnly, SameSite=Lax, Secure cookie that reads back', async () => {
    const s = new CookieSession(request(), config);
    expect(await s.get()).toBeNull();
    await s.set(bigSession());
    const [cookie] = s.setCookieHeaders();
    expect(cookie).toMatch(/^__Host-uiex_session=v1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const value = cookie.split(';')[0].slice(`${SESSION}=`.length);
    const again = new CookieSession(request(`${SESSION}=${value}`), config);
    expect(await again.get()).toEqual(bigSession());
    expect(again.setCookieHeaders()).toEqual([]);
  });

  it('keeps even a large session cookie under 4 KB', async () => {
    const s = new CookieSession(request(), config);
    await s.set(bigSession());
    const [cookie] = s.setCookieHeaders();
    expect(new TextEncoder().encode(cookie).length).toBeLessThan(MAX_COOKIE_BYTES);
  });

  it('refuses to write a cookie over 4 KB', async () => {
    const s = new CookieSession(request(), config);
    await expect(s.set({ ...bigSession(), accessToken: 'x'.repeat(4000) })).rejects.toThrow(/4 KB/);
  });

  it('treats tampered or rotated-secret cookies as signed out and clears them', async () => {
    const s = new CookieSession(request(), config);
    await s.set(bigSession());
    const value = s.setCookieHeaders()[0].split(';')[0].slice(`${SESSION}=`.length);
    const tampered = value.slice(0, -2) + (value.endsWith('A') ? 'BB' : 'AA');
    const t = new CookieSession(request(`${SESSION}=${tampered}`), config);
    expect(await t.get()).toBeNull();
    expect(t.invalidCookie).toBe(true);
    expect(t.setCookieHeaders()[0]).toMatch(/^__Host-uiex_session=; Path=\/; Max-Age=0/);

    const rotated = configFromEnv({ APP_URL: 'https://b.example.com', HUBSPOT_CLIENT_ID: 'c', HUBSPOT_CLIENT_SECRET: 's', SESSION_SECRET: `${SECRET}-new` }, { now: () => NOW });
    const r = new CookieSession(request(`${SESSION}=${value}`), rotated);
    expect(await r.get()).toBeNull();
    expect(r.setCookieHeaders()).toHaveLength(1);
  });

  it('trusts neither copy when the session cookie is sent twice (cookie tossing from a sibling subdomain)', async () => {
    const victim = new CookieSession(request(), config);
    await victim.set(bigSession());
    const victimValue = victim.setCookieHeaders()[0].split(';')[0].slice(`${SESSION}=`.length);
    const attacker = new CookieSession(request(), config);
    await attacker.set({ ...bigSession(), portalId: 666 });
    const attackerValue = attacker.setCookieHeaders()[0].split(';')[0].slice(`${SESSION}=`.length);
    const both = new CookieSession(request(`${SESSION}=${attackerValue}; ${SESSION}=${victimValue}`), config);
    expect(await both.get()).toBeNull();
    expect(both.invalidCookie).toBe(true);
    // The plain (unprefixed) name a sibling subdomain can plant is never read on https.
    const tossed = new CookieSession(request(`${SESSION_COOKIE}=${attackerValue}`), config);
    expect(await tossed.get()).toBeNull();
    // …and it is deleted (Path=/), as a leftover of older versions would be.
    expect(tossed.setCookieHeaders().some((c) => /^uiex_session=; Path=\/; Max-Age=0/.test(c))).toBe(true);
  });

  it('expires sessions after 30 days', async () => {
    const s = new CookieSession(request(), config);
    await s.set(bigSession());
    const value = s.setCookieHeaders()[0].split(';')[0].slice(`${SESSION}=`.length);
    const later = { ...config, now: () => NOW + 31 * 24 * 3600 * 1000 };
    expect(await new CookieSession(request(`${SESSION}=${value}`), later).get()).toBeNull();
  });

  it('omits Secure for http://localhost development', async () => {
    const local = configFromEnv({ APP_URL: 'http://localhost:5173', HUBSPOT_CLIENT_ID: 'c', HUBSPOT_CLIENT_SECRET: 's', SESSION_SECRET: SECRET });
    const s = new CookieSession(request(), local);
    await s.set(bigSession());
    expect(s.setCookieHeaders()[0]).not.toContain('Secure');
  });

  it('keeps the OAuth state in a __Host- cookie (Path=/) for 10 minutes, and ignores duplicates', async () => {
    const s = new CookieSession(request(), config);
    await s.setOAuthState({ state: 'abc', returnTo: 'https://b.example.com', mode: 'popup' });
    const [cookie] = s.setCookieHeaders();
    expect(cookie).toMatch(/^__Host-uiex_oauth=v1\./);
    expect(cookie).toContain('Path=/;');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=600');
    const value = cookie.split(';')[0].slice(`${OAUTH}=`.length);
    expect(await new CookieSession(request(`${OAUTH}=${value}`), config).getOAuthState()).toEqual({ state: 'abc', returnTo: 'https://b.example.com', mode: 'popup' });
    // An OAuth cookie value can't be replayed as the session cookie.
    expect(await new CookieSession(request(`${SESSION}=${value}`), config).get()).toBeNull();
    const late = { ...config, now: () => NOW + 11 * 60 * 1000 };
    expect(await new CookieSession(request(`${OAUTH}=${value}`), late).getOAuthState()).toBeNull();
    // A second (planted) copy, or the old unprefixed name, gives no usable state (login CSRF).
    expect(await new CookieSession(request(`${OAUTH}=${value}; ${OAUTH}=${value}`), config).getOAuthState()).toBeNull();
    expect(await new CookieSession(request(`${OAUTH_COOKIE}=${value}`), config).getOAuthState()).toBeNull();
  });

  it('clears an OAuth cookie an older version scoped to /api/auth (http://localhost)', async () => {
    const local = configFromEnv({ APP_URL: 'http://localhost:5173', SESSION_SECRET: SECRET });
    const s = new CookieSession(request(), local);
    await s.setOAuthState({ state: 'abc', returnTo: 'http://localhost:5173', mode: 'popup' });
    const headers = s.setCookieHeaders();
    expect(headers[0]).toMatch(/^uiex_oauth=v1\..*Path=\/;/);
    expect(headers[1]).toMatch(/^uiex_oauth=; Path=\/api\/auth; Max-Age=0/);
  });
});
