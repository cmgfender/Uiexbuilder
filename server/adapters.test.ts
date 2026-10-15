// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowPlainHealthCheck, isPlaceholder, normalizeHostingEnv } from './hosting';
import cloudflareWorker, { stringBindings, withStaticHeaders, type CloudflareEnv } from './cloudflare';
import vercelHandler, { PATH_PARAM, restoreOriginalPath, vercelAppUrl } from '../api/[...path]';
import { DEFAULT_OPTIONAL_SCOPES, DEFAULT_REQUIRED_SCOPES } from './core/index';
import type { ConnectorHealth } from '../src/connect/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('hosting settings', () => {
  it('treats placeholders typed into deploy forms as "not set"', () => {
    for (const v of ['later', 'LATER', ' todo ', '-', 'xxx', 'n/a', '<client id>', 'your-client-id', 'changeme', '']) {
      expect(isPlaceholder(v), v).toBe(true);
    }
    for (const v of ['12345678-aaaa-bbbb-cccc-1234567890ab', 'OPYvNTXXEtMxkv5sZNOllkE1pVVvncHLRMcNvgGqtNzOncJZ']) {
      expect(isPlaceholder(v), v).toBe(false);
    }
    const { env, notes } = normalizeHostingEnv({
      APP_URL: 'later',
      HUBSPOT_CLIENT_ID: 'later',
      HUBSPOT_CLIENT_SECRET: '  real-secret  ',
      SESSION_SECRET: 'later',
      OTHER: 'later',
    });
    expect(env).toEqual({ HUBSPOT_CLIENT_SECRET: 'real-secret', OTHER: 'later' });
    expect(notes.join(' ')).toContain('HUBSPOT_CLIENT_ID looks like a placeholder');
    expect(notes.join(' ')).not.toContain('real-secret');
  });

  it('cleans APP_URL and ignores values that are not web addresses', () => {
    expect(normalizeHostingEnv({ APP_URL: 'https://builder.example.com/' }).env.APP_URL).toBe('https://builder.example.com');
    expect(normalizeHostingEnv({ APP_URL: 'builder.example.com' }).env.APP_URL).toBe('https://builder.example.com');
    expect(normalizeHostingEnv({ APP_URL: 'localhost:5173' }).env.APP_URL).toBe('http://localhost:5173');
    expect(normalizeHostingEnv({ APP_URL: 'https://YOUR-DOMAIN' }).env.APP_URL).toBeUndefined();
    const bad = normalizeHostingEnv({ APP_URL: 'ftp://files.example.com' });
    expect(bad.env.APP_URL).toBeUndefined();
    expect(bad.notes[0]).toContain('APP_URL is not a web address');
  });
});

describe('plain health checks', () => {
  it('lets platform health checks and people in a browser read /api/health', () => {
    const plain = allowPlainHealthCheck(new Request('https://b.example.com/api/health'));
    expect(plain.headers.get('X-UIEX-Request')).toBe('health-check');
  });

  it('leaves every other request alone', () => {
    const cases = [
      new Request('https://b.example.com/api/me'),
      new Request('https://b.example.com/api/health', { method: 'POST', body: '{}' }),
      new Request('https://b.example.com/api/health', { headers: { Origin: 'https://evil.example' } }),
      new Request('https://b.example.com/api/health', { headers: { 'X-UIEX-Request': '1' } }),
    ];
    for (const req of cases) expect(allowPlainHealthCheck(req)).toBe(req);
  });
});

describe('Cloudflare Workers adapter', () => {
  const assetCalls: string[] = [];
  const env = (extra: Record<string, unknown> = {}): CloudflareEnv => ({
    ASSETS: {
      async fetch(request: Request) {
        assetCalls.push(new URL(request.url).pathname);
        const isAsset = new URL(request.url).pathname.startsWith('/assets/');
        return new Response(isAsset ? 'js' : '<!doctype html>', { headers: { 'Content-Type': isAsset ? 'text/javascript' : 'text/html' } });
      },
    },
    ...extra,
  });

  it('answers /api with the connector and reports "not configured" until the secrets exist', async () => {
    const res = await cloudflareWorker.fetch(new Request('https://uiex.example.workers.dev/api/health'), env({ HUBSPOT_CLIENT_ID: 'later' }));
    expect(res.status).toBe(200);
    const health = (await res.json()) as ConnectorHealth;
    expect(health.ok).toBe(true);
    expect(health.oauthConfigured).toBe(false);
    expect(assetCalls).toEqual([]);
  });

  it('is configured with secrets, using the request origin when APP_URL is empty', async () => {
    const res = await cloudflareWorker.fetch(
      new Request('https://uiex.example.workers.dev/api/health'),
      env({ APP_URL: '', HUBSPOT_CLIENT_ID: 'id', HUBSPOT_CLIENT_SECRET: 'secret', SESSION_SECRET: 's'.repeat(40) }),
    );
    expect(((await res.json()) as ConnectorHealth).oauthConfigured).toBe(true);
  });

  it('serves everything else from the assets binding with security and cache headers', async () => {
    assetCalls.length = 0;
    const page = await cloudflareWorker.fetch(new Request('https://uiex.example.workers.dev/projects/1'), env());
    expect(assetCalls).toEqual(['/projects/1']);
    expect(page.headers.get('Cache-Control')).toBe('no-cache');
    expect(page.headers.get('X-Frame-Options')).toBe('DENY');
    const asset = await cloudflareWorker.fetch(new Request('https://uiex.example.workers.dev/assets/index-1.js'), env());
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('passes only string bindings to the connector', () => {
    expect(stringBindings({ ASSETS: { fetch: async () => new Response() }, APP_URL: 'https://x.com', N: 1 as unknown as string })).toEqual({
      APP_URL: 'https://x.com',
      NODE_ENV: 'production',
    });
    const r = withStaticHeaders(new Response('x', { status: 404, headers: { 'Content-Type': 'text/plain' } }), '/assets/missing.js');
    expect(r.headers.get('Cache-Control')).toBeNull();
  });
});

describe('Vercel adapter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('restores the original path after the vercel.json rewrite (query and body kept)', async () => {
    const rewritten = new Request(`https://uiex.vercel.app/api/[...path]?q=ada&${PATH_PARAM}=crm%2Frecords%2Fcontacts%2Fsearch&limit=5`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-uiex-request': '1' },
      body: '{"a":1}',
    });
    const restored = await restoreOriginalPath(rewritten);
    const url = new URL(restored.url);
    expect(url.pathname).toBe('/api/crm/records/contacts/search');
    expect(url.searchParams.get('q')).toBe('ada');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.has(PATH_PARAM)).toBe(false);
    expect(restored.headers.get('x-uiex-request')).toBe('1');
    expect(await restored.text()).toBe('{"a":1}');

    const direct = new Request('https://uiex.vercel.app/api/me');
    expect(await restoreOriginalPath(direct)).toBe(direct);
  });

  it('uses APP_URL, else the production domain', () => {
    expect(vercelAppUrl({ APP_URL: 'https://b.example.com/' }, 'https://x.vercel.app')).toBe('https://b.example.com');
    expect(vercelAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'uiex.vercel.app' }, 'https://uiex-git-x.vercel.app')).toBe('https://uiex.vercel.app');
    expect(vercelAppUrl({}, 'https://preview.vercel.app')).toBe('https://preview.vercel.app');
  });

  it('serves the connector health check through the rewrite', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'uiex.vercel.app');
    const res = await vercelHandler(new Request(`https://uiex.vercel.app/api/[...path]?${PATH_PARAM}=health`));
    expect(res.status).toBe(200);
    const health = (await res.json()) as ConnectorHealth;
    expect(health.ok).toBe(true);
    expect(health.scopes.required).toContain('oauth');
  });
});

describe('deployment files', () => {
  it('the HubSpot app asks for exactly the scopes the connector requests', () => {
    const meta = JSON.parse(read('hubspot-app/src/app/app-hsmeta.json'));
    expect(meta.type).toBe('app');
    expect(meta.config.distribution).toBe('marketplace');
    expect(meta.config.auth.type).toBe('oauth');
    expect(meta.config.auth.requiredScopes).toEqual(DEFAULT_REQUIRED_SCOPES);
    expect(meta.config.auth.optionalScopes).toEqual(DEFAULT_OPTIONAL_SCOPES);
    expect(meta.config.auth.redirectUrls).toEqual(['https://YOUR-DOMAIN/api/auth/callback', 'http://localhost:5173/api/auth/callback']);
    expect(meta.config.permittedUrls).toEqual({ fetch: [], iframe: [], img: [] });
    expect(JSON.parse(read('hubspot-app/hsproject.json'))).toEqual({ name: 'uiex-builder-connector', srcDir: 'src', platformVersion: '2026.03' });
  });

  it('vercel.json routes /api to the function and everything else to the app', () => {
    const vercel = JSON.parse(read('vercel.json'));
    expect(vercel.outputDirectory).toBe('dist');
    expect(vercel.rewrites[0]).toEqual({ source: '/api/:path*', destination: `/api/[...path]?${PATH_PARAM}=:path*` });
    expect(vercel.rewrites[1].destination).toBe('/index.html');
  });

  it('render.yaml checks /api/health and prompts for the HubSpot settings', () => {
    const render = read('render.yaml');
    expect(render).toContain('healthCheckPath: /api/health');
    for (const key of ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'SESSION_SECRET', 'APP_URL']) expect(render).toContain(`key: ${key}`);
  });

  it('the secret page makes 48-character secrets with crypto.getRandomValues', () => {
    const html = read('public/secret.html');
    expect(html).toContain('crypto.getRandomValues');
    expect(html).toContain('var LENGTH = 48;');
    expect(html).not.toMatch(/<script[^>]+src=/);
  });
});
