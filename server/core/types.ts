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
  /**
   * ALLOWED_PORTALS: HubSpot account ids (hub ids) that may sign in and deploy. Empty = any account.
   * Optional for backwards compatibility; configFromEnv always sets it.
   */
  allowedPortals?: number[];
  /**
   * The status page (/status): signed-in HubSpot users whose email is in ADMIN_EMAILS, or who signed
   * in to an account in ADMIN_PORTALS, may see it. Both empty = nobody. Optional (configFromEnv sets them).
   */
  adminEmails?: string[];
  adminPortals?: number[];
  /** Short git commit the host built the server from (RENDER_GIT_COMMIT …), shown on the status page. */
  buildCommit?: string;
  /** Cookie `Secure` flag (false only for http://localhost development). */
  secureCookies: boolean;
  /** Injected fetch (tests use the fake HubSpot handler). Defaults to globalThis.fetch. */
  fetch: typeof fetch;
  /**
   * Fetch used by the preview fetch proxy for arbitrary public URLs. The Node adapter passes a
   * DNS-checked fetch (server/guardedFetch.ts) that refuses host names resolving to private
   * addresses (throwing ssrf.BlockedAddressError) and connects to exactly the address it checked.
   * Defaults to `fetch` (Edge runtimes have no DNS API, and no private network to reach).
   */
  proxyFetch?: ProxyFetch;
  /** Clock (tests). Defaults to Date.now. */
  now: () => number;
  version: string;
}

/** Decrypted contents of the session cookie. Keep small (cookie ≤ 4 KB). */
/** What the preview fetch proxy hands to ServerConfig.proxyFetch (one hop; redirects are not followed). */
export interface ProxyFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** Loopback addresses may be reached (local development, browser on the same computer). */
  allowLoopback: boolean;
}

export type ProxyFetch = (url: string, init: ProxyFetchInit) => Promise<Response>;

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
  /** Epoch ms when HubSpot last confirmed the grant (sign-in or token refresh). */
  verifiedAt?: number;
  /**
   * @deprecated Personal access keys are no longer stored in the session (any page script could
   * have deployed with a stored key). Never set; an old cookie's key is ignored.
   */
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
  /**
   * The signed-in session after confirming with HubSpot that the grant is still live when that is
   * due (token about to expire, or not checked for a few minutes). Throws 401 when signed out, 503
   * when sign-in isn't set up. `confirm: true` always asks HubSpot (refreshes the token), e.g.
   * before a deploy, so a copied cookie of a signed-out session stops working right away.
   * Optional for backwards compatibility; createConnector provides it.
   */
  signedIn?: (opts?: { confirm?: boolean }) => Promise<SessionData>;
  /** Client IP address when the hosting adapter knows it (rate limits, local-development checks). */
  clientIp?: string;
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
