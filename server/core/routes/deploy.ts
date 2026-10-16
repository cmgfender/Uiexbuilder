/**
 * Terminal-free deploy routes (beta) — see server/core/deploy/job.ts.
 *
 *   POST   /api/deploy             DeployRequest → DeployStatus (phase "building"; upload done)
 *   POST   /api/deploy/status      { deployId } → DeployStatus: advance the job one step (poll with
 *                                  the NEW deployId of each answer). The id travels in the body so
 *                                  it never shows up in access logs.
 *   GET    /api/deploy/:deployId   same as POST /api/deploy/status (older clients)
 *   GET    /api/deploy/key         → DeployKeyInfo — always { remembered: false }: keys are never stored
 *   DELETE /api/deploy/key         → { remembered: false } (kept for older clients)
 *
 * Who may deploy: once HubSpot sign-in is set up on the server, POST /api/deploy needs a signed-in
 * session whose grant HubSpot still confirms, and the key must belong to that account. Before sign-in
 * is set up (the host's first-time setup, deploying the connector's own app) the key alone is enough,
 * rate limited per client IP (see index.ts).
 *
 * Every job is bound to the browser that started it: POST /api/deploy sets the HttpOnly
 * `uiex_deploy` cookie (`__Host-uiex_deploy` on https) and seals its hash into the job; polling
 * without that cookie answers 404 deploy_not_found.
 *
 * All routes require the CSRF header (Route default). The connector answers 404 feature_disabled
 * for all of them when ENABLE_DEPLOY is false.
 */
import { CONNECTOR_ROUTES, type ConnectorErrorBody, type DeployKeyInfo } from '../../../src/connect/types';
import { HubSpotApiError, type RequestContext, type Route, type SessionData } from '../types';
import { ConnectorError, json, readJsonBody } from '../http';
import { checkConfig } from '../config';
import { randomToken } from '../crypto';
import { CookieSession, cookieName } from '../session';
import { DEPLOY_LIMITS } from '../deploy/paths';
import { DEPLOY_BINDING_COOKIE, DEPLOY_BINDING_TTL_SECONDS, PortalMismatchError, advanceDeploy, bindingHash, startDeploy } from '../deploy/job';

const BINDING_RE = /^[A-Za-z0-9_-]{32,64}$/;

function portalMismatch(err: PortalMismatchError): Response {
  const body: ConnectorErrorBody = { error: { code: err.code, message: err.message, status: err.status, portalId: err.keyPortalId } };
  return json(body, err.status);
}

function cookieSession(ctx: RequestContext): CookieSession | null {
  return ctx.session instanceof CookieSession ? ctx.session : null;
}

/** The browser-binding cookie value of this request (null when absent, sent twice or malformed). */
function readBinding(ctx: RequestContext): string | null {
  const value = cookieSession(ctx)?.readCookie(cookieName(ctx.config, DEPLOY_BINDING_COOKIE));
  return typeof value === 'string' && BINDING_RE.test(value) ? value : null;
}

/** Keeps (or creates) the browser-binding cookie and refreshes its lifetime. */
function ensureBinding(ctx: RequestContext): string {
  const value = readBinding(ctx) ?? randomToken(32);
  cookieSession(ctx)?.writeCookie(cookieName(ctx.config, DEPLOY_BINDING_COOKIE), value, DEPLOY_BINDING_TTL_SECONDS);
  return value;
}

/** The signed-in session when HubSpot sign-in is set up (throws 401 when not signed in); null during setup. */
async function deployer(ctx: RequestContext): Promise<SessionData | null> {
  if (!checkConfig(ctx.config).oauthConfigured) return null;
  try {
    // Confirms with HubSpot that the grant is still live (a refresh), so a copy of the cookie of a
    // session that has signed out (its refresh token revoked) can't deploy.
    if (ctx.signedIn) return await ctx.signedIn({ confirm: true });
    await ctx.hubspot();
    const data = await ctx.session.get();
    if (data) return data;
  } catch (err) {
    const status = err instanceof ConnectorError || err instanceof HubSpotApiError ? err.status : 0;
    if (status !== 401) throw err;
  }
  throw new ConnectorError(401, 'not_connected', 'Connect HubSpot first: deploying needs you to be signed in to the HubSpot account you deploy to.');
}

async function advance(ctx: RequestContext, deployId: string): Promise<Response> {
  const binding = readBinding(ctx);
  const { status } = await advanceDeploy(ctx.config, deployId, binding ? await bindingHash(binding) : null);
  if (binding) ensureBinding(ctx);
  return json(status);
}

export const deployRoutes: Route[] = [
  {
    method: 'POST',
    path: CONNECTOR_ROUTES.deployStart,
    handler: async (ctx) => {
      const signedIn = await deployer(ctx);
      const body = await readJsonBody(ctx.request, DEPLOY_LIMITS.maxBodyBytes);
      const binding = await bindingHash(ensureBinding(ctx));
      try {
        const { status } = await startDeploy(ctx.config, body, { signedIn, binding });
        return json(status);
      } catch (err) {
        if (err instanceof PortalMismatchError) return portalMismatch(err);
        throw err;
      }
    },
  },
  {
    method: 'GET',
    path: CONNECTOR_ROUTES.deployKey,
    handler: () => json({ remembered: false } satisfies DeployKeyInfo),
  },
  {
    method: 'DELETE',
    path: CONNECTOR_ROUTES.deployKey,
    handler: () => json({ remembered: false } satisfies DeployKeyInfo),
  },
  {
    method: 'POST',
    path: CONNECTOR_ROUTES.deployPoll,
    handler: async (ctx) => {
      const body = await readJsonBody<{ deployId?: unknown }>(ctx.request, 32 * 1024);
      const deployId = body && typeof body === 'object' && typeof body.deployId === 'string' ? body.deployId : '';
      return advance(ctx, deployId);
    },
  },
  {
    method: 'GET',
    path: CONNECTOR_ROUTES.deployStatus,
    handler: (ctx) => advance(ctx, ctx.params.deployId ?? ''),
  },
];
