/**
 * Hosted HubSpot connector — platform-agnostic core (Web Fetch API only).
 *
 *   const connector = createConnector(configFromEnv(process.env));
 *   const response = await connector.handle(request); // null → not an /api route (serve static files)
 *
 * Every /api response gets `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`,
 * `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CORS headers for ALLOWED_ORIGINS only, and
 * the session cookies the route set. Errors are ConnectorErrorBody JSON. Tokens and secrets never
 * appear in responses or logs.
 */
import type { RequestContext, Route, ServerConfig, SessionData } from './types';
import { HubSpotApiError } from './types';
import { API_SECURITY_HEADERS, ConnectorError, errorJson, errorToResponse, redactText } from './http';
import { checkConfig, notConfiguredMessage, portalAllowed, type ConfigStatus } from './config';
import { CONNECTOR_ROUTES } from '../../src/connect/types';
import { RATE_RULES, RateLimiter, type RateRule } from './rateLimit';
import { Router } from './router';
import { CookieSession } from './session';
import { SessionHubSpotApi, type HubSpotApiOptions } from './hubspot';
import { assertCsrf, corsHeaders, preflightResponse } from './security';
import { authRoutes } from './routes/auth';
import { crmRoutes } from './routes/crm';
import { proxyRoutes } from './routes/proxy';
import { deployRoutes } from './routes/deploy';
import { describeAuthError, renderAuthPage } from './authPage';

export { configFromEnv, checkConfig, CONNECTOR_VERSION, DEFAULT_OPTIONAL_SCOPES, DEFAULT_REQUIRED_SCOPES } from './config';
export type { ConfigStatus } from './config';
export { ConnectorError, RateLimitedError, json, errorJson, readJsonBody } from './http';
export { SESSION_COOKIE, OAUTH_COOKIE, cookieName, sessionCookieName, oauthCookieName } from './session';
export { RATE_RULES, RateLimiter } from './rateLimit';
export type { RateRule } from './rateLimit';
export { appHostFor } from './oauth';
export { AUTH_MESSAGE_TYPE, AUTH_BROADCAST_CHANNEL } from './authPage';
export * from './types';

/** Overall time budget for one API request before the connector answers 504. */
export const REQUEST_TIMEOUT_MS = 25_000;

/** What the hosting adapter knows about the caller (all optional). */
export interface RequestMeta {
  /**
   * The client's IP address as the adapter sees it (Node: the socket address, or the address a
   * trusted proxy in front of it reports; Vercel: x-real-ip; Cloudflare: cf-connecting-ip). Used for
   * rate limits and to allow http://localhost fetch previews only to a browser on the same computer.
   */
  clientIp?: string;
}

export interface Connector {
  handle(request: Request, meta?: RequestMeta): Promise<Response | null>;
}

/** Internal knobs (tests). */
export interface ConnectorOptions {
  requestTimeoutMs?: number;
  hubspot?: HubSpotApiOptions;
  /** Where errors are logged (already redacted). Defaults to console.error. */
  log?: (message: string) => void;
  /** Rate limiter (tests share or replace it). Defaults to one per connector. */
  rateLimiter?: RateLimiter;
}

/** The message shown when a signed-in HubSpot account isn't on ALLOWED_PORTALS. */
export function portalNotAllowedMessage(portalId: number): string {
  return `This builder only works with specific HubSpot accounts, and account ${portalId} isn't one of them. Ask the person who set up this builder to add it, or connect a different account.`;
}

function rateLimited(rule: RateRule, retryAfter: number): ConnectorError {
  return new ConnectorError(429, 'rate_limited', `Too many ${rule.what} in a short time. Please wait ${retryAfter} seconds and try again.`, {
    headers: { 'Retry-After': String(retryAfter) },
  });
}

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function createConnector(config: ServerConfig, options: ConnectorOptions = {}): Connector {
  const status: ConfigStatus = checkConfig(config);
  const router = new Router([...authRoutes(status), ...crmRoutes(), ...proxyRoutes()]);
  for (const r of deployRoutes) router.add(r);
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const log = options.log ?? ((m: string) => console.error(m));
  const limiter = options.rateLimiter ?? new RateLimiter(config.now);

  /** Rate limits for the routes that make the server call out on the caller's behalf. */
  async function applyRateLimit(route: Route, request: Request, session: CookieSession, clientIp: string | undefined): Promise<Response | null> {
    const ipKey = `ip:${clientIp ?? 'unknown'}`;
    const userKey = async () => {
      if (!status.oauthConfigured) return null;
      const data = await session.get().catch(() => null);
      return data ? `user:${data.portalId}:${data.userId ?? data.userEmail}` : null;
    };
    let rule: RateRule | null = null;
    let key = ipKey;
    if (route.path === CONNECTOR_ROUTES.authStart) rule = RATE_RULES.authStart;
    else if (route.path === CONNECTOR_ROUTES.authCallback) rule = RATE_RULES.authCallback;
    else if (route.path === CONNECTOR_ROUTES.deployStart && route.method === 'POST') {
      const user = await userKey();
      rule = user ? RATE_RULES.deploy : RATE_RULES.deploySetup;
      key = user ?? ipKey;
    } else if (route.path === CONNECTOR_ROUTES.proxyFetch) {
      rule = RATE_RULES.proxy;
      key = (await userKey()) ?? ipKey;
    }
    if (!rule) return null;
    const decision = limiter.take(rule, key);
    if (decision.ok) return null;
    const err = rateLimited(rule, decision.retryAfter);
    // Sign-in start / callback are page loads in the HubSpot window: answer with a readable page.
    const accept = request.headers.get('accept') ?? '';
    if ((route.path === CONNECTOR_ROUTES.authStart || route.path === CONNECTOR_ROUTES.authCallback) && !accept.includes('application/json')) {
      const page = await renderAuthPage({
        status: 429,
        ok: false,
        title: describeAuthError('rate_limited').title,
        message: err.message,
        targetOrigin: null,
        returnTo: config.appUrl || null,
        errorCode: 'rate_limited',
      });
      page.headers.set('Retry-After', String(decision.retryAfter));
      return page;
    }
    throw err;
  }

  async function dispatch(request: Request, url: URL, session: CookieSession, meta: RequestMeta): Promise<Response> {
    if (request.method === 'OPTIONS') return preflightResponse(config, request);

    if (!config.enableDeploy && (url.pathname === '/api/deploy' || url.pathname.startsWith('/api/deploy/'))) {
      return errorJson(404, 'feature_disabled', 'Deploying from the builder is turned off on this server.');
    }

    // HEAD is answered like GET (without a body), e.g. for hosting health probes.
    const match = router.match(request.method === 'HEAD' ? 'GET' : request.method, url.pathname);
    if (match.kind === 'not-found') {
      return errorJson(404, 'not_found', `There is no connector endpoint at ${url.pathname.slice(0, 200)}.`);
    }
    if (match.kind === 'method-not-allowed') {
      return errorJson(405, 'method_not_allowed', `Use ${match.allow.join(' or ')} for this endpoint.`, { headers: { Allow: match.allow.join(', ') } });
    }
    const route: Route = match.route;
    if (route.csrf !== false) assertCsrf(config, request);
    const limited = await applyRateLimit(route, request, session, meta.clientIp);
    if (limited) return limited;

    let api: SessionHubSpotApi | null = null;
    const hubspot = async (): Promise<SessionHubSpotApi> => {
      if (!status.oauthConfigured) throw new ConnectorError(503, 'not_configured', notConfiguredMessage(status));
      if (api) return api;
      const data = await session.get();
      if (!data) throw new ConnectorError(401, 'not_connected', 'Connect HubSpot to see real data.');
      if (!portalAllowed(config, data.portalId)) {
        // ALLOWED_PORTALS changed after this account signed in.
        session.clear();
        throw new ConnectorError(403, 'portal_not_allowed', portalNotAllowedMessage(data.portalId));
      }
      api = new SessionHubSpotApi(config, session, data, options.hubspot);
      return api;
    };
    const ctx: RequestContext = {
      request,
      url,
      params: match.params,
      config,
      session,
      hubspot,
      signedIn: async (opts?: { confirm?: boolean }): Promise<SessionData> => {
        const a = await hubspot();
        return opts?.confirm ? a.refresh() : a.ensureFresh();
      },
      clientIp: meta.clientIp,
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Response>((_, reject) => {
      timer = setTimeout(() => reject(new ConnectorError(504, 'timeout', 'HubSpot took too long to answer. Please try again.')), timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve(route.handler(ctx)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async handle(request: Request, meta: RequestMeta = {}): Promise<Response | null> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return null;
      }
      if (!isApiPath(url.pathname)) return null;

      const session = new CookieSession(request, config);
      const redact = (s: string) => redactText(s, [config.hubspotClientSecret, config.sessionSecret, ...session.knownSecrets()]);
      let response: Response;
      try {
        response = await dispatch(request, url, session, meta);
      } catch (err) {
        if (!(err instanceof ConnectorError) && !(err instanceof HubSpotApiError)) {
          const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          log(redact(`[uiex-connector] ${request.method} ${url.pathname} failed: ${detail}`));
        }
        response = errorToResponse(err, redact);
      }
      return finalize(response, request, session);
    },
  };

  function finalize(response: Response, request: Request, session: CookieSession): Response {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    for (const [k, v] of Object.entries(corsHeaders(config, request))) headers.set(k, v);
    for (const cookie of session.setCookieHeaders()) headers.append('Set-Cookie', cookie);
    const body = request.method === 'HEAD' ? null : response.body;
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
}
