// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createTestEnv, TEST_APP_URL } from './testing';
import { validateReturnTo } from './security';
import { configFromEnv } from './config';
import { redactText } from './http';

const ALLOWED = 'https://other-builder.example.test';

describe('CSRF guard', () => {
  it('requires the X-UIEX-Request header on API routes', async () => {
    const env = createTestEnv();
    for (const path of ['/api/health', '/api/me', '/api/crm/object-types']) {
      const res = await env.call(path, { csrf: false });
      expect(res.status, path).toBe(403);
      expect((await res.json()).error.code).toBe('csrf');
    }
    const post = await env.call('/api/auth/logout', { method: 'POST', csrf: false });
    expect(post.status).toBe(403);
  });

  it('accepts same-origin requests with or without an Origin header', async () => {
    const env = createTestEnv();
    expect((await env.call('/api/health')).status).toBe(200);
    expect((await env.call('/api/health', { origin: TEST_APP_URL })).status).toBe(200);
  });

  it('rejects foreign origins even with the header', async () => {
    const env = createTestEnv();
    for (const origin of ['https://evil.example', 'null', 'https://builder.example.test.evil.com', 'http://builder.example.test']) {
      const res = await env.call('/api/me', { origin });
      expect(res.status, origin).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden_origin');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('rejects cross-site fetch metadata without an Origin header', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/me', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status).toBe(403);
  });

  it('does not require the header for the OAuth browser navigations', async () => {
    const env = createTestEnv();
    const start = await env.call(`/api/auth/start?returnTo=${encodeURIComponent(TEST_APP_URL)}`, { csrf: false });
    expect(start.status).toBe(302);
  });
});

describe('CORS', () => {
  it('sends credentials CORS headers only to ALLOWED_ORIGINS', async () => {
    const env = createTestEnv({ env: { ALLOWED_ORIGINS: ALLOWED } });
    const ok = await env.call('/api/health', { origin: ALLOWED });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('vary')).toContain('Origin');

    const same = await env.call('/api/health', { origin: TEST_APP_URL });
    expect(same.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflights for allowed origins and refuses others', async () => {
    const env = createTestEnv({ env: { ALLOWED_ORIGINS: ALLOWED } });
    const pre = await env.call('/api/crm/search/contacts', { method: 'OPTIONS', origin: ALLOWED, csrf: false });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('X-UIEX-Request');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    const bad = await env.call('/api/crm/search/contacts', { method: 'OPTIONS', origin: 'https://evil.example', csrf: false });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows no cross-origin callers by default', async () => {
    const env = createTestEnv();
    const pre = await env.call('/api/health', { method: 'OPTIONS', origin: ALLOWED, csrf: false });
    expect(pre.status).toBe(403);
  });
});

describe('validateReturnTo (no open redirects)', () => {
  const config = configFromEnv({ APP_URL: TEST_APP_URL, ALLOWED_ORIGINS: ALLOWED });
  it('accepts the app origin, allowed origins and full URLs on them', () => {
    expect(validateReturnTo(config, TEST_APP_URL)).toBe(TEST_APP_URL);
    expect(validateReturnTo(config, `${TEST_APP_URL}/`)).toBe(TEST_APP_URL);
    expect(validateReturnTo(config, ALLOWED)).toBe(ALLOWED);
    expect(validateReturnTo(config, `${TEST_APP_URL}/editor?x=1#y`)).toBe(`${TEST_APP_URL}/editor?x=1#y`);
    expect(validateReturnTo(config, null)).toBe(TEST_APP_URL);
  });
  it('refuses everything else', () => {
    for (const bad of [
      'https://evil.example',
      'https://builder.example.test.evil.com',
      'https://evil.example/?https://builder.example.test',
      '//evil.example',
      '/relative',
      'javascript:alert(1)',
      'data:text/html,hi',
      'http://builder.example.test',
      'https://user:pass@builder.example.test',
      `${TEST_APP_URL}${'x'.repeat(3000)}`,
    ]) {
      expect(validateReturnTo(config, bad), bad).toBeNull();
    }
  });
});

describe('redactText', () => {
  it('removes literal secrets, bearer tokens and OAuth form values', () => {
    const out = redactText('secret=topsecret123 Authorization: Bearer abc.DEF-123 refresh_token=na1-xyz&client_secret=shh code=c0de', ['topsecret123']);
    expect(out).not.toContain('topsecret123');
    expect(out).not.toContain('abc.DEF-123');
    expect(out).not.toContain('na1-xyz');
    expect(out).not.toContain('shh');
    expect(out).not.toContain('c0de');
  });
});

describe('response headers', () => {
  it('marks API responses no-store / nosniff / no-referrer / DENY', async () => {
    const env = createTestEnv();
    const res = await env.call('/api/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });
});
