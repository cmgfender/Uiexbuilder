/**
 * Hosted connector server — core contracts. The server is written against the standard Web Fetch
 * API (Request → Response) so the same core runs on Node (server/node.ts), Vercel and Cloudflare
 * Workers adapters. API shapes are defined in src/connect/types.ts (shared with the browser).
 */
import type { ConnectorErrorBody } from '../../src/connect/types';

export interface ServerConfig {
  /** Public origin of the builder + connector, e.g. "https://builder.example.com" (no trailing slash). */
  appUrl: string;
  hubspotClientId: string;
  hubspotClientSecret: string;
  /** ≥ 32 random characters; used to derive the cookie encryption key. */
  sessionSecret: string;
  /** OAuth scopes. */
  requiredScopes: string[];
  optionalScopes: string[];
  /** Base URLs (overridable for tests / EU data centre). */
  hubspotApiBase: string; // default https://api.hubapi.com
  hubspotAppBase: string; // default https://app.hubspot.com  (authorize URL host)
  /** Feature switches. */
  enableFetchProxy: boolean;
  enableDeploy: boolean;
  /** Extra allowed browser origins for the API (CORS) besides appUrl — e.g. a separately hosted builder. */
  allowedOrigins: string[];
  /** Cookie `Secure` flag (false only for http://localhost development). */
  secureCookies: boolean;
  /** Injected fetch (tests use the fake HubSpot handler). Defaults to globalThis.fetch. */
  fetch: typeof fetch;
  /** Clock (tests). Defaults to Date.now. */
  now: () => number;
  version: string;
}

/** Decrypted contents of the session cookie. Keep small (cookie ≤ 4 KB). */
export interface SessionData {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  portalId: number;
  hubDomain: string;
  userEmail: string;
  userId?: number;
  scopes: string[];
  appHost: string;
  /** Optional remembered personal access key for terminal-free deploy (beta). */
  personalAccessKey?: string;
}

export interface Session {
  /** Current session or null when signed out / cookie invalid. */
  get(): Promise<SessionData | null>;
  /** Replace the session (sets the cookie on the response). */
  set(data: SessionData): Promise<void>;
  clear(): void;
}

/** Authenticated HubSpot API access for the current session (auto-refreshes tokens). */
export interface HubSpotApi {
  /** JSON request to api.hubapi.com with the session's bearer token. Throws HubSpotApiError. */
  request<T>(method: string, path: string, init?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<T>;
}

export class HubSpotApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public correlationId?: string,
    public requiredScopes?: string[],
  ) {
    super(message);
  }
}

export interface RequestContext {
  request: Request;
  url: URL;
  /** Path params from the route pattern (e.g. :objectType). */
  params: Record<string, string>;
  config: ServerConfig;
  session: Session;
  /** Throws a 401 ConnectorError when not signed in. */
  hubspot: () => Promise<HubSpotApi>;
}

export type RouteHandler = (ctx: RequestContext) => Promise<Response> | Response;

export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  /** Pattern like '/api/crm/properties/:objectType' (see CONNECTOR_ROUTES). */
  path: string;
  handler: RouteHandler;
  /** Require the X-UIEX-Request header + same-origin check (default true for non-GET; GET JSON routes too). */
  csrf?: boolean;
}

export type { ConnectorErrorBody };
