// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createTestEnv, type TestEnv } from './testing';
import { BlockedAddressError, addressBlocked, checkHostname, checkProxyUrl, isBlockedIPv4, isBlockedIPv6, isLoopbackAddress } from './ssrf';
import { devLocalAllowed, sanitizeRequestHeaders, validateProxyRequest, PROXY_MAX_RESPONSE_BYTES } from './routes/proxy';
import { RATE_RULES } from './rateLimit';
import type { ProxyFetchResponse } from '../../src/connect/types';

describe('SSRF guard', () => {
  const prod = { devLocal: false };
  it('allows public https URLs', () => {
    for (const ok of ['https://api.example.com/v1/items?x=1', 'https://example.com:8443/', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/']) {
      expect(checkProxyUrl(ok, prod), ok).toMatchObject({ ok: true });
    }
  });

  it('blocks non-https schemes, credentials and junk', () => {
    for (const bad of ['http://example.com/', 'ftp://example.com/', 'file:///etc/passwd', 'data:text/plain,hi', 'javascript:alert(1)', 'https://user:pass@example.com/', 'not a url', '', 'https://' + 'a'.repeat(2100) + '.com']) {
      expect(checkProxyUrl(bad, prod).ok, bad).toBe(false);
    }
  });

  it('blocks loopback, private, link-local, metadata and internal hosts', () => {
    for (const bad of [
      'https://localhost/',
      'https://LOCALHOST./',
      'https://app.localhost/',
      'https://127.0.0.1/',
      'https://127.1/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://0177.0.0.1/',
      'https://0.0.0.0/',
      'https://10.1.2.3/',
      'https://172.16.0.1/',
      'https://172.31.255.255/',
      'https://192.168.1.1/',
      'https://100.64.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://224.0.0.1/',
      'https://255.255.255.255/',
      'https://[::1]/',
      'https://[::]/',
      'https://[fd00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://[::ffff:a9fe:a9fe]/',
      'https://[64:ff9b::a00:1]/',
      'https://[2002:c0a8:0101::1]/',
      'https://metadata.google.internal/computeMetadata/v1/',
      'https://service.internal/',
      'https://printer.local/',
      'https://intranet/',
    ]) {
      expect(checkProxyUrl(bad, prod).ok, bad).toBe(false);
    }
  });

  it('allows http and https to loopback only when the app itself runs on localhost', () => {
    const dev = { devLocal: true };
    expect(checkProxyUrl('http://localhost:3000/api', dev).ok).toBe(true);
    expect(checkProxyUrl('http://127.0.0.1:8787/', dev).ok).toBe(true);
    expect(checkProxyUrl('https://localhost:3000/', dev).ok).toBe(true);
    expect(checkProxyUrl('http://[::1]:3000/', dev).ok).toBe(true);
    expect(checkProxyUrl('http://example.com/', dev).ok).toBe(false);
    expect(checkProxyUrl('https://10.0.0.1/', dev).ok).toBe(false);
    expect(checkProxyUrl('https://169.254.169.254/', dev).ok).toBe(false);
  });

  it('blocks IPv6 outside global unicast and its special ranges (NAT64, IPv4-translated, Teredo, 6to4, docs)', () => {
    for (const bad of [
      'https://[64:ff9b:1::a00:1]/', // local-use NAT64 for 10.0.0.1
      'https://[64:ff9b::808:808]/', // well-known NAT64 (even of a public address)
      'https://[::ffff:0:a00:1]/', // IPv4-translated 10.0.0.1
      'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', // Teredo
      'https://[2001:2::1]/', // benchmarking
      'https://[2001:10::1]/', // ORCHID
      'https://[2001:db8::1]/', // documentation
      'https://[2002:808:808::1]/', // 6to4
      'https://[3fff::1]/', // documentation (RFC 9637)
      'https://[100::1]/', // discard-only
      'https://[::a00:1]/', // IPv4-compatible
    ]) {
      expect(checkProxyUrl(bad, prod).ok, bad).toBe(false);
    }
    expect(checkProxyUrl('https://[2606:4700:4700::1111]/', prod).ok).toBe(true);
    expect(checkProxyUrl('https://[::ffff:8.8.8.8]/', prod).ok).toBe(true); // IPv4-mapped public address
  });

  it("refuses the ports browsers refuse (SMTP, SSH, …) but allows other https ports", () => {
    for (const port of [22, 25, 53, 110, 143, 587, 6667]) expect(checkProxyUrl(`https://api.example.com:${port}/`, prod).ok, String(port)).toBe(false);
    expect(checkProxyUrl('https://api.example.com:8443/', prod).ok).toBe(true);
  });

  it('checks resolved addresses (what the Node guarded fetch connects to)', () => {
    for (const bad of ['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fd00::1', '64:ff9b:1::a00:1', '::ffff:10.0.0.1', '::ffff:0:a00:1', 'not-an-ip']) {
      expect(addressBlocked(bad), bad).toBe(true);
    }
    for (const ok of ['8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8']) expect(addressBlocked(ok), ok).toBe(false);
    expect(addressBlocked('127.0.0.1', { allowLoopback: true })).toBe(false);
    expect(addressBlocked('10.0.0.5', { allowLoopback: true })).toBe(true);
  });

  it('allows loopback targets only for local development with the browser on the same computer', () => {
    const local = { appUrl: 'http://localhost:5173' };
    expect(devLocalAllowed(local, '127.0.0.1')).toBe(true);
    expect(devLocalAllowed(local, '::1')).toBe(true);
    expect(devLocalAllowed(local, '::ffff:127.0.0.1')).toBe(true);
    expect(devLocalAllowed(local, '192.168.1.20')).toBe(false); // someone on the same network
    expect(devLocalAllowed(local, undefined)).toBe(false);
    expect(devLocalAllowed({ appUrl: 'https://builder.example.com' }, '127.0.0.1')).toBe(false);
    expect(isLoopbackAddress('127.8.9.10')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
  });

  it('range helpers', () => {
    expect(isBlockedIPv4([172, 15, 0, 1])).toBe(false);
    expect(isBlockedIPv4([172, 32, 0, 1])).toBe(false);
    expect(isBlockedIPv4([100, 128, 0, 1])).toBe(false);
    expect(isBlockedIPv4([1, 1, 1, 1])).toBe(false);
    expect(isBlockedIPv6([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111])).toBe(false);
    expect(checkHostname('example.com', { allowLoopback: false })).toBeNull();
  });
});

describe('header sanitising', () => {
  it('drops hop-by-hop headers and rejects invalid ones', () => {
    expect(sanitizeRequestHeaders({ Authorization: 'Bearer x', Host: 'evil', Connection: 'close', 'X-Api-Key': 'k', 'Content-Length': '5' })).toEqual({ Authorization: 'Bearer x', 'X-Api-Key': 'k' });
    expect(() => sanitizeRequestHeaders({ 'Bad Header': 'x' })).toThrow();
    expect(() => sanitizeRequestHeaders({ X: 'a\r\nInjected: 1' })).toThrow();
    expect(() => sanitizeRequestHeaders(['x'])).toThrow();
    expect(sanitizeRequestHeaders(undefined)).toEqual({});
  });

  it('validates the request shape and clamps the timeout to 10 s', () => {
    expect(validateProxyRequest({ url: 'https://a.example.com', method: 'post', timeoutMs: 60_000 })).toMatchObject({ method: 'POST', timeoutMs: 10_000 });
    expect(validateProxyRequest({ url: 'https://a.example.com' })).toMatchObject({ method: 'GET', timeoutMs: 10_000 });
    expect(() => validateProxyRequest({ url: 'https://a.example.com', method: 'TRACE' })).toThrow();
    expect(() => validateProxyRequest({ method: 'GET' })).toThrow();
  });
});

async function signedIn(env: TestEnv = createTestEnv()): Promise<TestEnv> {
  await env.signIn();
  return env;
}

async function proxy(env: TestEnv, body: unknown) {
  const res = await env.call('/api/proxy/fetch', { method: 'POST', json: body });
  return { status: res.status, body: (await res.json()) as ProxyFetchResponse & { error?: { code: string; message: string } } };
}

describe('POST /api/proxy/fetch', () => {
  it('requires a sign-in', async () => {
    const env = createTestEnv();
    const external = vi.fn();
    env.setExternalFetch(external as unknown as typeof fetch);
    const res = await proxy(env, { url: 'https://api.example.com', method: 'GET' });
    expect(res.status).toBe(401);
    expect(external).not.toHaveBeenCalled();
  });

  it('can be turned off', async () => {
    const env = await signedIn(createTestEnv({ env: { ENABLE_FETCH_PROXY: 'false' } }));
    const res = await proxy(env, { url: 'https://api.example.com', method: 'GET' });
    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('feature_disabled');
  });

  it('fetches, forwards only explicit headers, sends a JSON body and strips Set-Cookie', async () => {
    const env = await signedIn();
    const seen: Request[] = [];
    env.setExternalFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response(JSON.stringify({ hello: 'world' }), {
        status: 201,
        headers: { 'content-type': 'application/json', 'set-cookie': 'tracker=1', 'x-custom': 'yes' },
      });
    }) as typeof fetch);
    const res = await proxy(env, { url: 'https://api.example.com/items', method: 'POST', headers: { 'X-Api-Key': 'abc' }, body: { name: 'Ada' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 201, ok: true, headers: { 'content-type': 'application/json', 'x-custom': 'yes' }, body: '{"hello":"world"}', truncated: false });
    const upstream = seen[0];
    expect(upstream.method).toBe('POST');
    expect(upstream.headers.get('x-api-key')).toBe('abc');
    expect(upstream.headers.get('content-type')).toBe('application/json');
    expect(upstream.headers.get('cookie')).toBeNull();
    expect(upstream.headers.get('authorization')).toBeNull();
    expect(await upstream.text()).toBe('{"name":"Ada"}');
  });

  it('never sends a body with GET', async () => {
    const env = await signedIn();
    const seen: RequestInit[] = [];
    env.setExternalFetch((async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init!);
      return new Response('ok');
    }) as typeof fetch);
    await proxy(env, { url: 'https://api.example.com/items', method: 'GET', body: { ignored: true } });
    expect(seen[0].body).toBeUndefined();
  });

  it('refuses blocked URLs without fetching them', async () => {
    const env = await signedIn();
    const external = vi.fn();
    env.setExternalFetch(external as unknown as typeof fetch);
    for (const url of ['http://api.example.com', 'https://169.254.169.254/latest', 'https://localhost:8080', 'https://10.0.0.5/admin']) {
      const res = await proxy(env, { url, method: 'GET' });
      expect(res.status, url).toBe(400);
      expect(res.body.error?.code).toBe('url_not_allowed');
    }
    expect(external).not.toHaveBeenCalled();
  });

  it('follows up to 3 redirects, re-checking each hop', async () => {
    const env = await signedIn();
    const hops: string[] = [];
    env.setExternalFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      hops.push(`${init?.method} ${url} auth=${new Headers(init?.headers).get('authorization')}`);
      expect(init?.redirect).toBe('manual');
      if (url === 'https://a.example.com/start') return new Response(null, { status: 302, headers: { location: '/second' } });
      if (url === 'https://a.example.com/second') return new Response(null, { status: 303, headers: { location: 'https://b.example.com/final' } });
      return new Response('done');
    }) as typeof fetch);
    const res = await proxy(env, { url: 'https://a.example.com/start', method: 'POST', headers: { Authorization: 'Bearer user-supplied' }, body: { x: 1 } });
    expect(res.body).toMatchObject({ status: 200, body: 'done' });
    expect(hops).toEqual([
      'POST https://a.example.com/start auth=Bearer user-supplied',
      'GET https://a.example.com/second auth=Bearer user-supplied',
      // credentials are dropped when the redirect leaves the origin
      'GET https://b.example.com/final auth=null',
    ]);
  });

  it('refuses redirects to blocked hosts and redirect loops', async () => {
    const env = await signedIn();
    env.setExternalFetch((async (input: RequestInfo | URL) => {
      if (String(input).includes('meta')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      return new Response(null, { status: 302, headers: { location: String(input) + 'x' } });
    }) as typeof fetch);
    const meta = await proxy(env, { url: 'https://evil.example.com/meta', method: 'GET' });
    expect(meta.status).toBe(400);
    expect(meta.body.error?.code).toBe('url_not_allowed');
    const loop = await proxy(env, { url: 'https://loop.example.com/', method: 'GET' });
    expect(loop.status).toBe(502);
    expect(loop.body.error?.code).toBe('too_many_redirects');
  });

  it('caps the response body at 1 MB', async () => {
    const env = await signedIn();
    env.setExternalFetch((async () => new Response('a'.repeat(PROXY_MAX_RESPONSE_BYTES + 5000))) as typeof fetch);
    const res = await proxy(env, { url: 'https://big.example.com/', method: 'GET' });
    expect(res.body.truncated).toBe(true);
    expect(res.body.body.length).toBe(PROXY_MAX_RESPONSE_BYTES);
  });

  it('times out slow URLs', async () => {
    const env = await signedIn();
    env.setExternalFetch(((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch);
    const res = await proxy(env, { url: 'https://slow.example.com/', method: 'GET', timeoutMs: 30 });
    expect(res.status).toBe(504);
    expect(res.body.error?.code).toBe('timeout');
  });

  it('reports connection failures plainly', async () => {
    const env = await signedIn();
    env.setExternalFetch((async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    }) as typeof fetch);
    const res = await proxy(env, { url: 'https://down.example.com/', method: 'GET' });
    expect(res.status).toBe(502);
    expect(res.body.error?.code).toBe('fetch_failed');
    expect(res.body.error?.message).not.toContain('ENOTFOUND');
  });

  it('allows a local backend during local development, from a browser on the same computer only', async () => {
    const env = await signedIn(createTestEnv({ env: { APP_URL: 'http://localhost:5173' } }));
    env.setExternalFetch((async () => new Response('local ok')) as typeof fetch);
    const local = await env.call('/api/proxy/fetch', { json: { url: 'http://localhost:3000/api/data', method: 'GET' }, clientIp: '127.0.0.1' });
    expect(await local.json()).toMatchObject({ status: 200, body: 'local ok' });
    // The same dev server reached from another machine on the network: no loopback access.
    const lan = await env.call('/api/proxy/fetch', { json: { url: 'http://127.0.0.1:2375/containers/json', method: 'GET' }, clientIp: '192.168.1.50' });
    expect(lan.status).toBe(400);
    expect(((await lan.json()) as { error: { code: string } }).error.code).toBe('url_not_allowed');
  });

  it('uses ServerConfig.proxyFetch when set and reports names that resolve to private addresses as not allowed', async () => {
    const calls: Array<{ url: string; allowLoopback: boolean }> = [];
    const env = await signedIn(
      createTestEnv({
        config: {
          proxyFetch: async (url, init) => {
            calls.push({ url, allowLoopback: init.allowLoopback });
            if (url.includes('nip.io')) throw new BlockedAddressError('127.0.0.1.nip.io points to a private or internal network address, which the preview proxy does not reach.');
            return new Response('public ok');
          },
        },
      }),
    );
    expect((await proxy(env, { url: 'https://api.example.com/x', method: 'GET' })).body).toMatchObject({ status: 200, body: 'public ok' });
    const blocked = await proxy(env, { url: 'https://127.0.0.1.nip.io/', method: 'GET' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatchObject({ code: 'url_not_allowed' });
    expect(blocked.body.error?.message).toMatch(/private or internal network/);
    expect(calls).toEqual([
      { url: 'https://api.example.com/x', allowLoopback: false },
      { url: 'https://127.0.0.1.nip.io/', allowLoopback: false },
    ]);
  });

  it('is rate limited per signed-in user', async () => {
    const env = await signedIn();
    env.setExternalFetch((async () => new Response('ok')) as typeof fetch);
    for (let i = 0; i < RATE_RULES.proxy.capacity; i++) expect((await proxy(env, { url: 'https://api.example.com/', method: 'GET' })).status).toBe(200);
    const limited = await proxy(env, { url: 'https://api.example.com/', method: 'GET' });
    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe('rate_limited');
  });
});
