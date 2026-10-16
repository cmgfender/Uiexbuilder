/**
 * Cloudflare Workers adapter: /api/* runs the hosted connector core; everything else is served from
 * the built app (dist/) through the static-assets binding, with an SPA fallback (wrangler.toml).
 *
 * Settings (Workers → your worker → Settings → Variables and Secrets): HUBSPOT_CLIENT_ID,
 * HUBSPOT_CLIENT_SECRET and SESSION_SECRET as *secrets*; APP_URL as a variable (optional: defaults
 * to the address the request arrived on, e.g. https://uiex-builder.<you>.workers.dev).
 */
import { configFromEnv, createConnector } from './core/index';
import { allowPlainHealthCheck, normalizeHostingEnv } from './hosting';

/** Minimal shape of the Workers static-assets binding (avoids a dependency on @cloudflare/workers-types). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface CloudflareEnv {
  ASSETS: AssetsBinding;
  APP_URL?: string;
  HUBSPOT_CLIENT_ID?: string;
  HUBSPOT_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  [name: string]: unknown;
}

type Connector = ReturnType<typeof createConnector>;
let cached: { env: CloudflareEnv; origin: string; connector: Connector } | null = null;

/** String-valued bindings only (vars + secrets), as configFromEnv expects. */
export function stringBindings(env: CloudflareEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value;
  if (out.NODE_ENV === undefined) out.NODE_ENV = 'production';
  return out;
}

function connectorFor(env: CloudflareEnv, origin: string): Connector {
  if (cached && cached.env === env && cached.origin === origin) return cached.connector;
  const { env: vars } = normalizeHostingEnv(stringBindings(env));
  const overrides = vars.APP_URL?.trim() ? {} : { appUrl: origin };
  const connector = createConnector(configFromEnv(vars, overrides));
  cached = { env, origin, connector };
  return connector;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Add security + caching headers to a static asset response. */
export function withStaticHeaders(response: Response, pathname: string): Response {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  if (response.ok && pathname.startsWith('/assets/')) out.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  else if ((out.headers.get('Content-Type') ?? '').includes('text/html')) out.headers.set('Cache-Control', 'no-cache');
  return out;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message, status } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      try {
        const clientIp = request.headers.get('cf-connecting-ip')?.trim() || undefined;
        const response = await connectorFor(env, url.origin).handle(allowPlainHealthCheck(request), { clientIp });
        return response ?? jsonError(404, 'not_found', 'There is no connector endpoint at this address.');
      } catch {
        return jsonError(500, 'internal_error', 'Something went wrong on the connector server. Please try again.');
      }
    }
    if (!env.ASSETS) return new Response('Static assets are not configured (see wrangler.toml).', { status: 500 });
    return withStaticHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
};
