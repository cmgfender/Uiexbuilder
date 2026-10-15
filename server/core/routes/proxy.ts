/**
 * POST /api/proxy/fetch — server-side fetch for previewing `hubspot.fetch` calls (feature-flagged
 * with ENABLE_FETCH_PROXY, requires a HubSpot sign-in so it is never an anonymous open proxy).
 *
 * Guards: SSRF host checks (ssrf.ts) on the first URL and on every redirect (manual handling, at
 * most 3 hops), timeout ≤ 10 s, response body capped at 1 MB (`truncated: true`), hop-by-hop and
 * Set-Cookie headers stripped. Only headers listed in `request.headers` are sent — the caller's
 * own cookies / authorization are never forwarded.
 */
import { CONNECTOR_ROUTES, type ProxyFetchRequest, type ProxyFetchResponse } from '../../../src/connect/types';
import type { Route } from '../types';
import { ConnectorError, badRequest, json, readJsonBody } from '../http';
import { checkProxyUrl } from '../ssrf';
import { isLocalAppUrl } from '../config';

export const PROXY_MAX_TIMEOUT_MS = 10_000;
export const PROXY_MAX_RESPONSE_BYTES = 1024 * 1024;
export const PROXY_MAX_REDIRECTS = 3;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

/** Never sent upstream (connection-level, or set by the runtime). */
const BLOCKED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

/** Never returned to the browser. */
const BLOCKED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,100}$/;

export function sanitizeRequestHeaders(input: unknown): Record<string, string> {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw badRequest('"headers" must be an object of header names and values.');
  const out: Record<string, string> = {};
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 50) throw badRequest('Send at most 50 headers.');
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw badRequest(`"${name.slice(0, 40)}" isn't a valid header name.`);
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value)) throw badRequest(`The value of header "${name}" isn't valid.`);
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}

async function readCapped(res: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(all), truncated };
}

function responseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!BLOCKED_RESPONSE_HEADERS.has(lower)) out[lower] = value;
  });
  return out;
}

export function validateProxyRequest(input: unknown): ProxyFetchRequest & { timeoutMs: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('The fetch request must be a JSON object.');
  const req = input as Partial<ProxyFetchRequest>;
  const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
  if (!(METHODS as readonly string[]).includes(method)) throw badRequest(`Method "${String(req.method).slice(0, 20)}" isn't supported.`);
  if (typeof req.url !== 'string') throw badRequest('"url" is required.');
  const timeoutRaw = typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) ? req.timeoutMs : PROXY_MAX_TIMEOUT_MS;
  return {
    url: req.url,
    method: method as ProxyFetchRequest['method'],
    headers: sanitizeRequestHeaders(req.headers),
    body: req.body,
    timeoutMs: Math.min(PROXY_MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutRaw))),
  };
}

export function proxyRoutes(): Route[] {
  const route: Route = {
    method: 'POST',
    path: CONNECTOR_ROUTES.proxyFetch,
    handler: async (ctx) => {
      const { config } = ctx;
      if (!config.enableFetchProxy) {
        throw new ConnectorError(404, 'feature_disabled', 'Previewing hubspot.fetch through the connector is turned off on this server.');
      }
      // Signed-in users only (throws 401 / 503 otherwise).
      await ctx.hubspot();
      const req = validateProxyRequest(await readJsonBody(ctx.request, 1024 * 1024 + 4096));
      const devLocal = isLocalAppUrl(config.appUrl);
      const first = checkProxyUrl(req.url, { devLocal });
      if (!first.ok) throw new ConnectorError(400, 'url_not_allowed', first.reason);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        let url = first.url;
        let method: string = req.method;
        let body: string | undefined = method === 'GET' || req.body === undefined ? undefined : JSON.stringify(req.body);
        const headers: Record<string, string> = { 'User-Agent': 'UIEX-Builder-Connector (hubspot.fetch preview)', ...req.headers };
        if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';

        for (let hop = 0; ; hop++) {
          let res: Response;
          try {
            res = await config.fetch(url.toString(), { method, headers, body, redirect: 'manual', signal: controller.signal });
          } catch {
            if (controller.signal.aborted) {
              throw new ConnectorError(504, 'timeout', `The URL didn't answer within ${Math.round(req.timeoutMs / 1000)} seconds.`);
            }
            throw new ConnectorError(502, 'fetch_failed', "Couldn't connect to that URL. Check the address and that the server is online.");
          }
          const location = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && location) {
            await res.body?.cancel().catch(() => {});
            if (hop >= PROXY_MAX_REDIRECTS) throw new ConnectorError(502, 'too_many_redirects', `The URL redirected more than ${PROXY_MAX_REDIRECTS} times.`);
            let next: URL;
            try {
              next = new URL(location, url);
            } catch {
              throw new ConnectorError(502, 'fetch_failed', 'The URL redirected to an invalid address.');
            }
            const check = checkProxyUrl(next.toString(), { devLocal });
            if (!check.ok) throw new ConnectorError(400, 'url_not_allowed', `The URL redirected to an address that isn't allowed: ${check.reason}`);
            if (check.url.origin !== url.origin) {
              // Like browsers: never carry credentials to another origin.
              for (const h of Object.keys(headers)) {
                if (['authorization', 'cookie'].includes(h.toLowerCase())) delete headers[h];
              }
            }
            if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
              method = 'GET';
              body = undefined;
              for (const h of Object.keys(headers)) if (h.toLowerCase() === 'content-type') delete headers[h];
            }
            url = check.url;
            continue;
          }
          const { text, truncated } = await readCapped(res, PROXY_MAX_RESPONSE_BYTES).catch(() => {
            if (controller.signal.aborted) throw new ConnectorError(504, 'timeout', `The URL didn't finish answering within ${Math.round(req.timeoutMs / 1000)} seconds.`);
            throw new ConnectorError(502, 'fetch_failed', 'The connection closed before the response was complete.');
          });
          const out: ProxyFetchResponse = { status: res.status, ok: res.ok, headers: responseHeaders(res), body: text, truncated };
          return json(out);
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
  return [route];
}
