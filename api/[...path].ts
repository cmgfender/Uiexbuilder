/**
 * Vercel adapter: every /api/* request runs the hosted connector core (server/core) in a Vercel
 * Edge Function. The builder itself is served by Vercel's CDN from dist/ (see vercel.json).
 *
 * Settings (Vercel → Project → Settings → Environment Variables): HUBSPOT_CLIENT_ID,
 * HUBSPOT_CLIENT_SECRET, SESSION_SECRET and APP_URL (optional on Vercel: defaults to the project's
 * production address). Placeholders such as "later" count as not set (server/hosting.ts). Optional: HUBSPOT_SCOPES, HUBSPOT_OPTIONAL_SCOPES, HUBSPOT_API_BASE,
 * HUBSPOT_APP_BASE, ENABLE_FETCH_PROXY, ENABLE_DEPLOY, ALLOWED_ORIGINS, ALLOWED_PORTALS.
 *
 * vercel.json rewrites /api/:path* here with `__uiex_path=:path*` so deep paths work whether or not
 * the platform matches this catch-all file directly; the original path is restored before routing.
 */
import { configFromEnv, createConnector } from '../server/core/index';
import { allowPlainHealthCheck, normalizeHostingEnv } from '../server/hosting';

export const config = { runtime: 'edge' };

/** Name of the query parameter vercel.json uses to carry the original path. */
export const PATH_PARAM = '__uiex_path';

type Connector = ReturnType<typeof createConnector>;
let cached: Connector | null = null;

/** Read settings explicitly (some runtimes only expose env vars that are referenced by name). */
export function vercelEnv(): Record<string, string | undefined> {
  const e = typeof process !== 'undefined' && process.env ? process.env : {};
  return {
    APP_URL: e.APP_URL,
    HUBSPOT_CLIENT_ID: e.HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET: e.HUBSPOT_CLIENT_SECRET,
    SESSION_SECRET: e.SESSION_SECRET,
    HUBSPOT_SCOPES: e.HUBSPOT_SCOPES,
    HUBSPOT_OPTIONAL_SCOPES: e.HUBSPOT_OPTIONAL_SCOPES,
    HUBSPOT_API_BASE: e.HUBSPOT_API_BASE,
    HUBSPOT_APP_BASE: e.HUBSPOT_APP_BASE,
    ENABLE_FETCH_PROXY: e.ENABLE_FETCH_PROXY,
    ENABLE_DEPLOY: e.ENABLE_DEPLOY,
    ALLOWED_ORIGINS: e.ALLOWED_ORIGINS,
    ALLOWED_PORTALS: e.ALLOWED_PORTALS,
    NODE_ENV: e.NODE_ENV ?? 'production',
    VERCEL_PROJECT_PRODUCTION_URL: e.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: e.VERCEL_URL,
  };
}

/** APP_URL, else the project's production domain (what the HubSpot redirect URL is registered for). */
export function vercelAppUrl(env: Record<string, string | undefined>, requestOrigin: string): string {
  const explicit = env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/\/+$/, '')}`;
  return requestOrigin;
}

function connectorFor(request: Request): Connector {
  if (cached) return cached;
  const { env } = normalizeHostingEnv(vercelEnv());
  const appUrl = vercelAppUrl(env, new URL(request.url).origin);
  cached = createConnector(configFromEnv(env, env.APP_URL?.trim() ? {} : { appUrl }));
  return cached;
}

/** Undo the vercel.json rewrite: /api/[...path]?__uiex_path=crm/x → /api/crm/x (other params kept). */
export async function restoreOriginalPath(request: Request): Promise<Request> {
  const url = new URL(request.url);
  const original = url.searchParams.get(PATH_PARAM);
  if (original === null) return request;
  url.searchParams.delete(PATH_PARAM);
  url.pathname = `/api/${original.replace(/^\/+/, '')}`;
  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  return new Request(url.toString(), { method, headers: request.headers, body, redirect: 'manual' });
}

/** The caller's IP as Vercel reports it (x-real-ip; Vercel overwrites what the client sends). */
export function vercelClientIp(request: Request): string | undefined {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  return request.headers.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop();
}

export default async function handler(request: Request): Promise<Response> {
  const req = allowPlainHealthCheck(await restoreOriginalPath(request));
  const response = await connectorFor(req).handle(req, { clientIp: vercelClientIp(request) });
  if (response) return response;
  return new Response(JSON.stringify({ error: { code: 'not_found', message: 'There is no connector endpoint at this address.', status: 404 } }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
