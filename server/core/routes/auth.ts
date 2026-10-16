/**
 * Sign in with HubSpot: /api/auth/start, /api/auth/callback, /api/auth/logout, /api/me, /api/health.
 */
import { CONNECTOR_ROUTES, type ConnectionInfo, type ConnectorHealth } from '../../../src/connect/types';
import type { RequestContext, Route } from '../types';
import { ConnectorError, errorJson, json } from '../http';
import { DEFAULT_APP_BASE, type ConfigStatus, notConfiguredMessage, portalAllowed } from '../config';
import { CookieSession, sessionSecretUsable } from '../session';
import { randomToken, timingSafeEqual } from '../crypto';
import { validateReturnTo } from '../security';
import { OAuthError, authorizeUrl, buildSessionData, exchangeCode, getTokenInfo, needsRefresh, refreshSessionData, revokeRefreshToken } from '../oauth';
import { describeAuthError, renderAuthPage } from '../authPage';

function cookieSession(ctx: RequestContext): CookieSession {
  if (!(ctx.session instanceof CookieSession)) throw new Error('cookie session required');
  return ctx.session;
}

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('text/html') || accept === '' || (accept.includes('*/*') && !accept.includes('application/json'));
}

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Append `uiex_auth=<result>` to a redirect-mode returnTo URL. */
function withAuthResult(returnTo: string, result: string): string {
  const url = new URL(returnTo);
  url.searchParams.set('uiex_auth', result);
  return url.toString();
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

export function authRoutes(status: ConfigStatus): Route[] {
  const notConfigured = async (ctx: RequestContext, returnTo: string | null): Promise<Response> => {
    const message = notConfiguredMessage(status);
    if (ctx.request.method === 'GET' && wantsHtml(ctx.request)) {
      return renderAuthPage({
        status: 503,
        ok: false,
        title: describeAuthError('not_configured').title,
        message,
        targetOrigin: originOf(returnTo),
        returnTo,
        errorCode: 'not_configured',
      });
    }
    return errorJson(503, 'not_configured', message);
  };

  const start: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.authStart,
    csrf: false,
    handler: async (ctx) => {
      const { config, url } = ctx;
      const rawReturnTo = url.searchParams.get('returnTo');
      const returnTo = validateReturnTo(config, rawReturnTo);
      if (!status.oauthConfigured) return notConfigured(ctx, returnTo);
      if (!returnTo) {
        const d = describeAuthError('bad_return_to');
        // Never post to or link to an unvalidated origin.
        return renderAuthPage({ status: 400, ok: false, title: d.title, message: d.message, targetOrigin: null, returnTo: config.appUrl, errorCode: 'bad_return_to' });
      }
      const mode = url.searchParams.get('mode') === 'redirect' ? 'redirect' : 'popup';
      const state = randomToken(32);
      await cookieSession(ctx).setOAuthState({ state, returnTo, mode });
      return redirect(authorizeUrl(config, state));
    },
  };

  const callback: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.authCallback,
    csrf: false,
    handler: async (ctx) => {
      const { config, url } = ctx;
      const session = cookieSession(ctx);
      if (!status.oauthConfigured) return notConfigured(ctx, config.appUrl || null);

      const saved = await session.getOAuthState();
      session.clearOAuthState();
      // returnTo was validated at start; validate again in case APP_URL / ALLOWED_ORIGINS changed.
      const returnTo = saved ? validateReturnTo(config, saved.returnTo) ?? config.appUrl : config.appUrl;
      const targetOrigin = originOf(returnTo);
      const mode = saved?.mode ?? 'popup';

      const fail = async (code: string, httpStatus = 400, detail?: string): Promise<Response> => {
        if (mode === 'redirect' && returnTo) return redirect(withAuthResult(returnTo, code));
        const d = describeAuthError(code);
        return renderAuthPage({ status: httpStatus, ok: false, title: d.title, message: detail ?? d.message, targetOrigin, returnTo, errorCode: code });
      };

      const stateParam = url.searchParams.get('state') ?? '';
      const errorParam = url.searchParams.get('error');
      if (!saved) return fail('state_missing');
      if (!stateParam || !timingSafeEqual(stateParam, saved.state)) return fail('state_mismatch');
      if (errorParam) {
        const code = /^[a-z_]{1,64}$/.test(errorParam) ? errorParam : 'oauth_error';
        return fail(code);
      }
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) return fail('token_exchange_failed');

      let data;
      try {
        const tokens = await exchangeCode(config, code);
        const info = await getTokenInfo(config, tokens.access_token);
        data = buildSessionData(config, tokens, info);
      } catch (err) {
        if (err instanceof OAuthError && !err.revoked && err.status >= 500) return fail('hubspot_unreachable', 502);
        return fail('token_exchange_failed');
      }
      if (!portalAllowed(config, data.portalId)) {
        // ALLOWED_PORTALS: give the grant back right away and keep no session.
        await revokeRefreshToken(config, data.refreshToken);
        return fail('portal_not_allowed', 403);
      }
      await session.set(data);
      if (mode === 'redirect' && returnTo) return redirect(withAuthResult(returnTo, 'connected'));
      return renderAuthPage({
        status: 200,
        ok: true,
        title: 'HubSpot is connected',
        message: 'You can close this window and go back to the builder.',
        targetOrigin,
        returnTo,
      });
    },
  };

  const logout: Route = {
    method: 'POST',
    path: CONNECTOR_ROUTES.logout,
    handler: async (ctx) => {
      if (!status.oauthConfigured) return notConfigured(ctx, null);
      const data = await ctx.session.get();
      if (data?.refreshToken) await revokeRefreshToken(ctx.config, data.refreshToken);
      ctx.session.clear();
      return json({ ok: true });
    },
  };

  const me: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.me,
    handler: async (ctx) => {
      const signedOut: ConnectionInfo = { connected: false, reason: 'signed-out' };
      if (!status.oauthConfigured) return json(signedOut);
      let data = await ctx.session.get();
      if (!data) return json(signedOut);
      if (!portalAllowed(ctx.config, data.portalId)) {
        ctx.session.clear();
        return json({ connected: false, reason: 'revoked' } satisfies ConnectionInfo);
      }
      // Also confirms every few minutes that the grant is still live (sign-out revokes it).
      if (needsRefresh(ctx.config, data)) {
        try {
          data = await refreshSessionData(ctx.config, data);
          await ctx.session.set(data);
        } catch (err) {
          if (err instanceof OAuthError && err.revoked) {
            ctx.session.clear();
            return json({ connected: false, reason: 'revoked' } satisfies ConnectionInfo);
          }
          throw new ConnectorError(502, 'hubspot_unreachable', "Couldn't reach HubSpot to renew your sign-in. Please try again in a moment.");
        }
      }
      const info: ConnectionInfo = {
        connected: true,
        portalId: data.portalId,
        hubDomain: data.hubDomain,
        user: data.userId !== undefined ? { id: data.userId, email: data.userEmail } : { email: data.userEmail },
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        appHost: data.appHost,
      };
      return json(info);
    },
  };

  const health: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.health,
    // Holds no user data, so platform health checks (Render, Docker, uptime monitors) and people
    // opening the address in a browser can read it without the X-UIEX-Request marker.
    csrf: false,
    handler: (ctx) => {
      const { config } = ctx;
      const secretOk = sessionSecretUsable(config);
      const body: ConnectorHealth = {
        ok: true,
        version: config.version,
        oauthConfigured: status.oauthConfigured,
        features: {
          crm: status.oauthConfigured,
          fetchProxy: status.oauthConfigured && config.enableFetchProxy,
          // Deploy keeps its job state encrypted with SESSION_SECRET, so it needs a usable secret too.
          deploy: config.enableDeploy && secretOk,
        },
        scopes: { required: [...config.requiredScopes], optional: [...config.optionalScopes] },
        // Names only (never values), so the builder and /setup.html can say exactly what is left.
        missingSettings: status.missing.map((m) => m.name),
      };
      if (!config.enableDeploy) body.features.deployUnavailableReason = 'disabled';
      else if (!secretOk) body.features.deployUnavailableReason = 'session_secret';
      if (status.oauthConfigured) body.features.deployNeedsSignIn = true;
      if (config.hubspotAppBase && config.hubspotAppBase !== DEFAULT_APP_BASE) body.appBase = config.hubspotAppBase;
      return json(body);
    },
  };

  return [health, start, callback, logout, me];
}
