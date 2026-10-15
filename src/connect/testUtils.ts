/**
 * Test helpers for the connect module: a routed fetch mock and fixtures. Only imported by tests.
 */
import { vi } from 'vitest';
import type { ConnectionInfo, ConnectorHealth, CrmObjectTypeInfo } from './types';

export interface MockCall {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
  body?: unknown;
  signal?: AbortSignal | null;
}

export type MockHandler = (call: MockCall) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

export function html(body = '<!doctype html><title>Builder</title>', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export function errorBody(code: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message: `${code} message`, status, ...extra } }, status, headers);
}

/**
 * A fetch mock routed by "METHOD /path" (query ignored). Unknown routes answer 404 HTML, like a
 * static host. `calls` records every request.
 */
export function routedFetch(routes: Record<string, MockHandler | Response | (() => Response)>) {
  const calls: MockCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, 'http://builder.test');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: MockCall = {
      method,
      url: raw,
      path: url.pathname,
      query: url.searchParams,
      headers,
      credentials: init.credentials,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init.signal,
    };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const route = routes[`${method} ${url.pathname}`];
    if (!route) return html('Not found', 404);
    if (route instanceof Response) return route.clone();
    const res = await (route as MockHandler)(call);
    return res;
  });
  return { fetch: fn as unknown as typeof fetch, calls, mock: fn };
}

export const PORTAL_ID = 12345678;

export function healthFixture(over: Partial<ConnectorHealth> = {}): ConnectorHealth {
  return {
    ok: true,
    version: '1.0.0',
    oauthConfigured: true,
    features: { crm: true, fetchProxy: true, deploy: true },
    scopes: { required: ['oauth', 'crm.objects.contacts.read'], optional: ['tickets'] },
    ...over,
  };
}

export function connectedInfo(over: Partial<Extract<ConnectionInfo, { connected: true }>> = {}): Extract<ConnectionInfo, { connected: true }> {
  return {
    connected: true,
    portalId: PORTAL_ID,
    hubDomain: 'acme.com',
    user: { id: 7, email: 'ada@acme.com' },
    scopes: ['oauth', 'crm.objects.contacts.read'],
    expiresAt: Date.now() + 30 * 60_000,
    appHost: 'app.hubspot.com',
    ...over,
  };
}

export const OBJECT_TYPES: CrmObjectTypeInfo[] = [
  { objectType: 'contacts', objectTypeId: '0-1', label: 'Contact', pluralLabel: 'Contacts', primaryDisplayProperty: 'firstname', secondaryDisplayProperties: ['email'], custom: false },
  { objectType: 'companies', objectTypeId: '0-2', label: 'Company', pluralLabel: 'Companies', primaryDisplayProperty: 'name', secondaryDisplayProperties: ['domain'], custom: false },
  { objectType: 'deals', objectTypeId: '0-3', label: 'Deal', pluralLabel: 'Deals', primaryDisplayProperty: 'dealname', secondaryDisplayProperties: [], custom: false },
  { objectType: 'p_projects', objectTypeId: '2-555', label: 'Project', pluralLabel: 'Projects', primaryDisplayProperty: 'name', secondaryDisplayProperties: [], custom: true },
];

/** Flush pending promise callbacks. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
