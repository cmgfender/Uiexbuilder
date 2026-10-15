// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest, createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  createNodeServer,
  createRequestListener,
  describeStartup,
  detectAppUrl,
  missingOAuthSettings,
  parseArgs,
  pickEncoding,
  requestPathname,
  requestTarget,
  resolveStaticPath,
  toWebRequest,
  wantsSpaFallback,
  writeWebResponse,
  type ApiHandler,
} from './node';
import type { ServerConfig } from './core/types';

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** Plain node:http request so tests control the raw path (fetch would normalise `..`). */
function raw(
  base: string,
  opts: { method?: string; path?: string; headers?: Record<string, string | string[]>; body?: string | Buffer } = {},
): Promise<RawResponse> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: url.hostname, port: url.port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

describe('request targets', () => {
  it('keeps path and query, and never lets the target change the host', () => {
    expect(requestTarget('/api/me?x=1')).toBe('/api/me?x=1');
    expect(requestTarget('http://evil.example/api/me?x=1')).toBe('/api/me?x=1');
    expect(requestTarget(undefined)).toBe('/');
    expect(requestTarget('*')).toBe('/');
    expect(requestPathname('/a/b?c=d#e')).toBe('/a/b');
  });
});

describe('toWebRequest', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      try {
        const request = await toWebRequest(req, { origin: 'https://builder.example.com/ignored-path', bodyLimit: 1024 });
        const headers: Record<string, string> = {};
        request.headers.forEach((v, k) => (headers[k] = v));
        seen.push({ url: request.url, method: request.method, headers, body: await request.text() });
        res.end('ok');
      } catch (err) {
        res.statusCode = 413;
        res.end(String(err));
      }
    });
    base = await listen(server);
  });
  afterAll(() => close(server));

  it('builds the URL on the configured origin, not on the Host header', async () => {
    seen.length = 0;
    await raw(base, { path: '//evil.example/api/crm/records/contacts/1?properties=a,b', headers: { host: 'evil.example' } });
    expect(seen[0].url).toBe('https://builder.example.com//evil.example/api/crm/records/contacts/1?properties=a,b');
    expect(new URL(seen[0].url).host).toBe('builder.example.com');
  });

  it('copies headers (repeated values joined), keeps cookies intact and drops hop-by-hop headers', async () => {
    seen.length = 0;
    await raw(base, {
      path: '/api/me',
      headers: {
        'X-Repeated': ['one', 'two'],
        Cookie: 'uiex_session=abc; other=1',
        'X-UIEX-Request': '1',
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=5',
      },
    });
    const h = seen[0].headers;
    expect(h['x-repeated']).toBe('one, two');
    expect(h.cookie).toBe('uiex_session=abc; other=1');
    expect(h['x-uiex-request']).toBe('1');
    expect(h.connection).toBeUndefined();
    expect(h['keep-alive']).toBeUndefined();
  });

  it('passes request bodies through and rejects bodies over the limit', async () => {
    seen.length = 0;
    const ok = await raw(base, { method: 'POST', path: '/api/crm/search/contacts', headers: { 'content-type': 'application/json' }, body: '{"query":"ada"}' });
    expect(ok.status).toBe(200);
    expect(seen[0]).toMatchObject({ method: 'POST', body: '{"query":"ada"}' });

    const big = await raw(base, { method: 'POST', path: '/api/deploy', body: 'x'.repeat(2048) });
    expect(big.status).toBe(413);
  });
});

describe('writeWebResponse', () => {
  let server: Server;
  let base: string;
  let firstChunkSeen: () => void = () => {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      const p = req.url ?? '/';
      let response: Response;
      if (p === '/cookies') {
        const headers = new Headers({ 'content-type': 'text/plain' });
        headers.append('set-cookie', 'a=1; Path=/; HttpOnly');
        headers.append('set-cookie', 'b=2; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
        response = new Response('ok', { status: 201, statusText: 'Created', headers });
      } else if (p === '/stream') {
        let step = 0;
        const gate = new Promise<void>((resolve) => (firstChunkSeen = resolve));
        const enc = new TextEncoder();
        response = new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (step === 0) {
                controller.enqueue(enc.encode('first;'));
              } else if (step === 1) {
                await gate; // only continues once the client has received the first chunk
                controller.enqueue(enc.encode('second'));
              } else {
                controller.close();
              }
              step++;
            },
          }),
          { headers: { 'content-type': 'text/plain' } },
        );
      } else if (p === '/empty') {
        response = new Response(null, { status: 204, headers: { 'x-test': 'yes' } });
      } else {
        response = new Response('hello', { headers: { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' } });
      }
      void writeWebResponse(res, response, { head: req.method === 'HEAD', defaults: { 'X-Default': 'd', 'Content-Type': 'ignored' } });
    });
    base = await listen(server);
  });
  afterAll(() => close(server));

  it('sends every Set-Cookie header separately with status and status text', async () => {
    const res = await raw(base, { path: '/cookies' });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toEqual(['a=1; Path=/; HttpOnly', 'b=2; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT']);
    expect(res.headers['x-default']).toBe('d');
    expect(res.headers['content-type']).toBe('text/plain'); // defaults never override
    expect(res.body.toString()).toBe('ok');
  });

  it('streams the body chunk by chunk', async () => {
    const url = new URL(`${base}/stream`);
    const text = await new Promise<string>((resolve, reject) => {
      httpRequest({ host: url.hostname, port: url.port, path: url.pathname }, (res) => {
        let out = '';
        res.on('data', (c: Buffer) => {
          out += c.toString();
          if (out.includes('first;')) firstChunkSeen();
        });
        res.on('end', () => resolve(out));
      })
        .on('error', reject)
        .end();
    });
    expect(text).toBe('first;second');
  });

  it('sends no body for HEAD and 204 responses', async () => {
    const head = await raw(base, { method: 'HEAD', path: '/plain' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    const empty = await raw(base, { path: '/empty' });
    expect(empty.status).toBe(204);
    expect(empty.headers['x-test']).toBe('yes');
  });
});

describe('static files', () => {
  let dir: string;
  let root: string;
  let server: Server;
  let base: string;
  const bigJs = `console.log(${JSON.stringify('x'.repeat(4000))});\n`;
  const apiCalls: Request[] = [];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uiex-static-'));
    root = path.join(dir, 'dist');
    mkdirSync(path.join(root, 'assets'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Builder</title>');
    writeFileSync(path.join(root, 'assets', 'index-abc123.js'), bigJs);
    writeFileSync(path.join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(path.join(root, 'secret.html'), '<!doctype html><title>Secret</title>');
    writeFileSync(path.join(root, '.env'), 'SESSION_SECRET=nope');
    writeFileSync(path.join(dir, 'outside.txt'), 'TOP SECRET OUTSIDE');
    symlinkSync(path.join(dir, 'outside.txt'), path.join(root, 'link.txt'));

    const connector: ApiHandler = {
      async handle(request) {
        apiCalls.push(request);
        const p = new URL(request.url).pathname;
        if (p === '/api/boom') throw new Error('kaboom with secret-token-123');
        if (p === '/api/null') return null;
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      },
    };
    server = createNodeServer({ connector, staticRoot: root, origin: 'https://builder.example.com', hsts: true, bodyLimit: 1024 });
    base = await listen(server);
  });
  afterAll(async () => {
    await close(server);
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html with no-cache and security headers (but no COOP, so the sign-in popup can report back)', async () => {
    const res = await raw(base, { path: '/' });
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('<title>Builder</title>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cross-origin-opener-policy']).toBeUndefined();
  });

  it('serves hashed assets as immutable, compressed with brotli or gzip', async () => {
    const br = await raw(base, { path: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(br.status).toBe(200);
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(br.headers.vary).toBe('Accept-Encoding');
    expect(zlib.brotliDecompressSync(br.body).toString()).toBe(bigJs);

    const gz = await raw(base, { path: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip' } });
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(zlib.gunzipSync(gz.body).toString()).toBe(bigJs);

    const plain = await raw(base, { path: '/assets/index-abc123.js' });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['content-length']).toBe(String(Buffer.byteLength(bigJs)));
    expect(plain.body.toString()).toBe(bigJs);
  });

  it('answers 304 when the ETag matches', async () => {
    const first = await raw(base, { path: '/favicon.svg' });
    expect(first.headers['content-type']).toBe('image/svg+xml');
    expect(first.headers['cache-control']).toBe('public, max-age=3600');
    const etag = String(first.headers.etag);
    const again = await raw(base, { path: '/favicon.svg', headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
  });

  it('falls back to index.html for app routes but 404s for missing files', async () => {
    const route = await raw(base, { path: '/projects/42?tab=data' });
    expect(route.status).toBe(200);
    expect(route.body.toString()).toContain('<title>Builder</title>');
    expect((await raw(base, { path: '/assets/missing-123.js' })).status).toBe(404);
    expect((await raw(base, { path: '/logo.png' })).status).toBe(404);
    expect((await raw(base, { path: '/secret.html' })).body.toString()).toContain('<title>Secret</title>');
  });

  it('never serves files outside the build folder or hidden files', async () => {
    const attempts = [
      '/../outside.txt',
      '/%2e%2e/outside.txt',
      '/..%2foutside.txt',
      '/assets/..%2f..%2foutside.txt',
      '/assets/%2e%2e%2f%2e%2e%2foutside.txt',
      '/%5c..%5coutside.txt',
      '/..\\outside.txt',
      '/.env',
      '/%2eenv',
      '/link.txt',
    ];
    for (const p of attempts) {
      const res = await raw(base, { path: p });
      expect(res.body.toString(), p).not.toContain('TOP SECRET');
      expect(res.body.toString(), p).not.toContain('SESSION_SECRET');
      expect([400, 404], p).toContain(res.status);
    }
    expect((await raw(base, { path: '/%E0%A4%A' })).status).toBe(400);
    expect((await raw(base, { path: '/a%00b' })).status).toBe(400);
  });

  it('only allows GET and HEAD for static files', async () => {
    const res = await raw(base, { method: 'POST', path: '/', body: 'x' });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    const head = await raw(base, { method: 'HEAD', path: '/' });
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
  });

  it('hands /api requests to the connector with the public origin, and maps failures to JSON errors', async () => {
    apiCalls.length = 0;
    const ok = await raw(base, { path: '/api/me?x=1', headers: { 'x-uiex-request': '1', host: 'internal:3000' } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body.toString())).toEqual({ ok: true });
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(apiCalls[0].url).toBe('https://builder.example.com/api/me?x=1');

    const boom = await raw(base, { path: '/api/boom' });
    expect(boom.status).toBe(500);
    expect(boom.body.toString()).not.toContain('secret-token-123');
    expect(JSON.parse(boom.body.toString()).error.code).toBe('internal_error');

    const none = await raw(base, { path: '/api/null' });
    expect(none.status).toBe(404);
    expect(JSON.parse(none.body.toString()).error.code).toBe('not_found');

    const big = await raw(base, { method: 'POST', path: '/api/deploy', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect(JSON.parse(big.body.toString()).error.code).toBe('payload_too_large');
  });
});

describe('API-only mode', () => {
  it('answers non-API paths with a hint instead of the app', async () => {
    const server = createServer(
      createRequestListener({ connector: { handle: async () => new Response('{}') }, staticRoot: null, origin: 'http://localhost:5173', apiOnlyHint: 'Open the builder at http://localhost:5173' }),
    );
    const base = await listen(server);
    try {
      const res = await raw(base, { path: '/' });
      expect(res.status).toBe(404);
      expect(res.body.toString()).toContain('http://localhost:5173');
      expect((await raw(base, { path: '/api/health' })).status).toBe(200);
    } finally {
      await close(server);
    }
  });
});

describe('helpers', () => {
  it('resolves static paths safely', () => {
    expect(resolveStaticPath('/srv/dist', '/assets/a.js')).toEqual({ kind: 'ok', file: path.resolve('/srv/dist/assets/a.js'), pathname: '/assets/a.js' });
    expect(resolveStaticPath('/srv/dist', '/a/../../b').kind).toBe('forbidden');
    expect(resolveStaticPath('/srv/dist', '/.git/config').kind).toBe('forbidden');
    expect(resolveStaticPath('/srv/dist', '/.well-known/security.txt').kind).toBe('ok');
    expect(resolveStaticPath('/srv/dist', '/%zz').kind).toBe('bad-request');
  });

  it('knows which paths are app routes', () => {
    expect(wantsSpaFallback('/')).toBe(true);
    expect(wantsSpaFallback('/projects/42')).toBe(true);
    expect(wantsSpaFallback('/index.html')).toBe(true);
    expect(wantsSpaFallback('/api/me')).toBe(false);
    expect(wantsSpaFallback('/assets/x')).toBe(false);
    expect(wantsSpaFallback('/robots.txt')).toBe(false);
  });

  it('negotiates encodings', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip;q=1, br;q=0')).toBe('gzip');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding('*')).toBe('br');
    expect(pickEncoding(undefined)).toBeNull();
  });

  it('parses CLI flags', () => {
    expect(parseArgs(['--api-only', '--port', '3001', '--host=127.0.0.1'])).toEqual({ apiOnly: true, port: 3001, host: '127.0.0.1' });
    expect(parseArgs(['--dist', 'build'])).toEqual({ apiOnly: false, staticDir: 'build' });
  });

  it('detects the public address on hosting platforms', () => {
    expect(detectAppUrl({ APP_URL: 'https://b.example.com/' }, 3000)).toEqual({ url: 'https://b.example.com', source: 'APP_URL' });
    expect(detectAppUrl({ RENDER_EXTERNAL_URL: 'https://uiex.onrender.com' }, 10000).url).toBe('https://uiex.onrender.com');
    expect(detectAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'uiex.vercel.app' }, 3000).url).toBe('https://uiex.vercel.app');
    expect(detectAppUrl({}, 4321).url).toBe('http://localhost:4321');
    expect(detectAppUrl({ NODE_ENV: 'production' }, 3000).url).toBeNull();
  });

  it('prints a startup summary with the redirect URL and without secrets', () => {
    const config: ServerConfig = {
      appUrl: 'https://builder.example.com',
      hubspotClientId: 'client-id-123',
      hubspotClientSecret: 'super-secret-client-secret',
      sessionSecret: 'x'.repeat(40),
      requiredScopes: ['oauth', 'crm.objects.contacts.read'],
      optionalScopes: ['tickets'],
      hubspotApiBase: 'https://api.hubapi.com',
      hubspotAppBase: 'https://app.hubspot.com',
      enableFetchProxy: true,
      enableDeploy: false,
      allowedOrigins: [],
      secureCookies: true,
      fetch: globalThis.fetch,
      now: Date.now,
      version: '1.0.0',
    };
    const text = describeStartup(config, { listenUrl: 'http://localhost:3000', appUrlSource: 'APP_URL', staticRoot: '/app/dist', staticFound: true }).join('\n');
    expect(text).toContain('https://builder.example.com/api/auth/callback');
    expect(text).toContain('ready (client id client-id-123)');
    expect(text).toContain('deploy to HubSpot (beta) off');
    expect(text).not.toContain('super-secret-client-secret');
    expect(text).not.toContain('x'.repeat(40));

    expect(missingOAuthSettings({ ...config, hubspotClientSecret: '', sessionSecret: 'short' })).toEqual([
      'HUBSPOT_CLIENT_SECRET',
      'SESSION_SECRET (must be at least 32 characters)',
    ]);
    const unset = describeStartup({ ...config, appUrl: '', hubspotClientId: '' }, { listenUrl: 'http://localhost:3000', appUrlSource: 'APP_URL is not set', staticRoot: null, staticFound: false }).join('\n');
    expect(unset).toContain('NOT CONFIGURED - missing APP_URL, HUBSPOT_CLIENT_ID');
    expect(unset).toContain('API-only mode');
  });
});
