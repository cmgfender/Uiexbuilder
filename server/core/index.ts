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
import type { RequestContext, Route, ServerConfig } from './types';
import { HubSpotApiError } from './types';
import { API_SECURITY_HEADERS, ConnectorError, errorJson, errorToResponse, redactText } from './http';
import { checkConfig, notConfiguredMessage, type ConfigStatus } from './config';
import { Router } from './router';
import { CookieSession } from './session';
import { SessionHubSpotApi, type HubSpotApiOptions } from './hubspot';
import { assertCsrf, corsHeaders, preflightResponse } from './security';
import { authRoutes } from './routes/auth';
import { crmRoutes } from './routes/crm';
import { proxyRoutes } from './routes/proxy';
import { deployRoutes } from './routes/deploy';

export { configFromEnv, checkConfig, CONNECTOR_VERSION, DEFAULT_OPTIONAL_SCOPES, DEFAULT_REQUIRED_SCOPES } from './config';
export type { ConfigStatus } from './config';
export { ConnectorError, RateLimitedError, json, errorJson, readJsonBody } from './http';
export { SESSION_COOKIE, OAUTH_COOKIE } from './session';
export { appHostFor } from './oauth';
export { AUTH_MESSAGE_TYPE, AUTH_BROADCAST_CHANNEL } from './authPage';
export * from './types';

/** Overall time budget for one API request before the connector answers 504. */
export const REQUEST_TIMEOUT_MS = 25_000;

export interface Connector {
  handle(request: Request): Promise<Response | null>;
}

/** Internal knobs (tests). */
export interface ConnectorOptions {
  requestTimeoutMs?: number;
  hubspot?: HubSpotApiOptions;
  /** Where errors are logged (already redacted). Defaults to console.error. */
  log?: (message: string) => void;
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

  async function dispatch(request: Request, url: URL, session: CookieSession): Promise<Response> {
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

    let api: SessionHubSpotApi | null = null;
    const ctx: RequestContext = {
      request,
      url,
      params: match.params,
      config,
      session,
      hubspot: async () => {
        if (!status.oauthConfigured) throw new ConnectorError(503, 'not_configured', notConfiguredMessage(status));
        if (api) return api;
        const data = await session.get();
        if (!data) throw new ConnectorError(401, 'not_connected', 'Connect HubSpot to see real data.');
        api = new SessionHubSpotApi(config, session, data, options.hubspot);
        return api;
      },
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
    async handle(request: Request): Promise<Response | null> {
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
        response = await dispatch(request, url, session);
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
