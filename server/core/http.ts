/**
 * JSON / HTML response helpers, the connector's error type and secret redaction.
 * Web Fetch API only (runs on Node 20+, Vercel and Cloudflare Workers).
 */
import type { ConnectorErrorBody } from '../../src/connect/types';
import { HubSpotApiError } from './types';

/** An error the connector reports to the browser as a ConnectorErrorBody. */
export class ConnectorError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: { correlationId?: string; requiredScopes?: string[]; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** HubSpot answered 429 even after one retry. */
export class RateLimitedError extends HubSpotApiError {
  constructor(
    message: string,
    public retryAfterSeconds: number,
    correlationId?: string,
  ) {
    super(message, 429, 'rate_limited', correlationId);
  }
}

/** Headers added to every /api response. */
export const API_SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorBody(status: number, code: string, message: string, extra: { correlationId?: string; requiredScopes?: string[] } = {}): ConnectorErrorBody {
  const error: ConnectorErrorBody['error'] = { code, message, status };
  if (extra.correlationId) error.correlationId = extra.correlationId;
  if (extra.requiredScopes && extra.requiredScopes.length > 0) error.requiredScopes = extra.requiredScopes;
  return { error };
}

export function errorJson(status: number, code: string, message: string, extra: { correlationId?: string; requiredScopes?: string[]; headers?: Record<string, string> } = {}): Response {
  return json(errorBody(status, code, message, extra), status, extra.headers ?? {});
}

/** Convert anything thrown by a route into a ConnectorErrorBody response (never leaks internals). */
export function errorToResponse(err: unknown, redact: (s: string) => string = (s) => s): Response {
  if (err instanceof ConnectorError) {
    return errorJson(err.status, err.code, redact(err.message), err.extra);
  }
  if (err instanceof HubSpotApiError) {
    const headers: Record<string, string> = {};
    if (err instanceof RateLimitedError && err.retryAfterSeconds > 0) headers['Retry-After'] = String(err.retryAfterSeconds);
    return errorJson(err.status, err.code, redact(err.message), {
      correlationId: err.correlationId,
      requiredScopes: err.requiredScopes,
      headers,
    });
  }
  return errorJson(500, 'internal_error', 'Something went wrong on the connector server. Please try again.');
}

export function badRequest(message: string): ConnectorError {
  return new ConnectorError(400, 'bad_request', message);
}

/** Escape text for HTML element and attribute contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON that is safe to embed inside an inline <script> (no `</script>`, no HTML comments, no U+2028). */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Read a request body as text, refusing bodies larger than `limit` bytes (413). Streams so a huge
 * body is never fully buffered.
 */
export async function readBodyText(request: Request, limit: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function tooLarge(limit: number): ConnectorError {
  return new ConnectorError(413, 'payload_too_large', `The request is too large (limit ${Math.round(limit / 1024)} KB).`);
}

/** Parse a JSON request body (object expected). */
export async function readJsonBody<T = unknown>(request: Request, limit = 256 * 1024): Promise<T> {
  const text = await readBodyText(request, limit);
  if (!text.trim()) throw badRequest('The request body is empty; JSON was expected.');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

/**
 * Remove secrets from text before it is logged or sent to the browser: the given literal values
 * plus anything that looks like a bearer token or an OAuth credential in a query/form string.
 */
export function redactText(text: string, secrets: Array<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  out = out.replace(/((?:access_token|refresh_token|client_secret|code|token)=)[^&\s"']+/gi, '$1[redacted]');
  return out;
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Clamp an integer query parameter. */
export function clampInt(raw: string | null | undefined, min: number, max: number, fallback: number): number {
  if (raw === null || raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
