/**
 * CSRF / origin checks and CORS.
 *
 * - Every /api route except auth/start and auth/callback requires the `X-UIEX-Request` header. A
 *   cross-site page cannot add a custom header without a CORS preflight, which we only grant to
 *   ALLOWED_ORIGINS.
 * - When the request carries an Origin header it must be APP_URL or one of ALLOWED_ORIGINS.
 * - CORS headers (with credentials) are only ever sent to ALLOWED_ORIGINS; the builder itself is
 *   same-origin and needs none.
 */
import { CSRF_HEADER } from '../../src/connect/types';
import { ConnectorError } from './http';
import type { ServerConfig } from './types';
import { normalizeOrigin } from './config';

export function trustedOrigins(config: ServerConfig): string[] {
  return [config.appUrl, ...config.allowedOrigins].filter(Boolean);
}

export function isTrustedOrigin(config: ServerConfig, origin: string | null | undefined): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized !== origin.replace(/\/+$/, '')) return false;
  return trustedOrigins(config).includes(normalized);
}

/** Throws a 403 ConnectorError when the request fails the CSRF / origin checks. */
export function assertCsrf(config: ServerConfig, request: Request): void {
  const origin = request.headers.get('origin');
  if (origin !== null && !isTrustedOrigin(config, origin)) {
    throw new ConnectorError(403, 'forbidden_origin', 'This website is not allowed to use the HubSpot connector.');
  }
  const marker = request.headers.get(CSRF_HEADER);
  if (!marker || !marker.trim()) {
    throw new ConnectorError(403, 'csrf', `Missing ${CSRF_HEADER} header. Requests must come from the builder.`);
  }
  // Defence in depth for browsers that send Fetch Metadata but omit Origin.
  const site = request.headers.get('sec-fetch-site');
  if (origin === null && site === 'cross-site') {
    throw new ConnectorError(403, 'forbidden_origin', 'This website is not allowed to use the HubSpot connector.');
  }
}

/** CORS response headers for an allowed cross-origin caller (never for unknown origins). */
export function corsHeaders(config: ServerConfig, request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function preflightResponse(config: ServerConfig, request: Request): Response {
  const cors = corsHeaders(config, request);
  if (!cors['Access-Control-Allow-Origin']) {
    return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE',
      'Access-Control-Allow-Headers': `Content-Type, ${CSRF_HEADER}`,
      'Access-Control-Max-Age': '600',
    },
  });
}

/**
 * Validate a returnTo value (origin or full URL). It must be on APP_URL or an allowed origin —
 * anything else is refused, so the connector can never be used as an open redirect.
 * Returns the normalised URL (or origin) or null.
 */
export function validateReturnTo(config: ServerConfig, raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return config.appUrl || null;
  if (raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!trustedOrigins(config).includes(url.origin)) return null;
  // Bare origin → origin; full URL → keep path/query/hash on the trusted origin.
  if (url.pathname === '/' && !url.search && !url.hash) return url.origin;
  return url.href;
}
