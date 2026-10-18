/**
 * Status page routes.
 *
 *   GET  /api/admin/access        → AdminAccess: signed in? an admin? are admins set up? (no events)
 *   GET  /api/admin/diagnostics   → DiagnosticsSnapshot — only for admins: signed in with HubSpot
 *                                   (grant confirmed with HubSpot every few minutes) AND the HubSpot
 *                                   user email in ADMIN_EMAILS or the account in ADMIN_PORTALS
 *   POST /api/diagnostics/report  ← ClientReport from browsers (errors, what the sign-in window
 *                                   showed): ≤ 8 KB, rate limited per visitor, cleaned before it is
 *                                   kept (see sanitize.ts). Anyone using the builder may report.
 *
 * All of them need the X-UIEX-Request header and a trusted Origin (Route default).
 */
import {
  CLIENT_REPORT_MAX_BYTES,
  DIAGNOSTICS_ROUTES,
  SIGN_IN_FEEDBACK_KINDS,
  type AdminAccess,
  type SignInFeedbackKind,
} from '../../../src/status/types';
import { ConnectorError, badRequest, json, readBodyText } from '../http';
import type { ConfigStatus } from '../config';
import type { RateLimiter, RateRule } from '../rateLimit';
import { HubSpotApiError, type RequestContext, type Route, type SessionData } from '../types';
import { adminConfigured, isAdminUser } from './access';
import type { Diagnostics } from './observe';
import { cleanClientError } from './sanitize';

/** Reports per visitor: a burst of 20, then one every 30 seconds. */
export const CLIENT_REPORT_RULE: RateRule = { what: 'error reports', capacity: 20, refillMs: 30_000 };
/** Reports from everyone together, so many addresses can't push the real events out of the log. */
export const CLIENT_REPORT_GLOBAL_RULE: RateRule = { what: 'error reports', capacity: 120, refillMs: 5_000 };

export interface DiagnosticsRouteDeps {
  diagnostics: Diagnostics;
  status: ConfigStatus;
  limiter: RateLimiter;
}

/** The signed-in session, confirmed with HubSpot when that is due; null when signed out. */
async function currentUser(ctx: RequestContext): Promise<SessionData | null> {
  try {
    if (ctx.signedIn) return await ctx.signedIn();
    await ctx.hubspot();
    return await ctx.session.get();
  } catch (err) {
    const status = err instanceof ConnectorError || err instanceof HubSpotApiError ? err.status : 0;
    if (status === 401) return null;
    throw err;
  }
}

export function diagnosticsRoutes({ diagnostics, status, limiter }: DiagnosticsRouteDeps): Route[] {
  const access: Route = {
    method: 'GET',
    path: DIAGNOSTICS_ROUTES.access,
    handler: async (ctx) => {
      const configured = adminConfigured(ctx.config);
      if (!status.oauthConfigured) {
        const body: AdminAccess = { signInConfigured: false, missingSettings: status.missing.map((m) => m.name), signedIn: false, admin: false, adminConfigured: configured };
        return json(body);
      }
      const user = await currentUser(ctx);
      if (!user) return json({ signInConfigured: true, signedIn: false, admin: false, adminConfigured: configured } satisfies AdminAccess);
      const body: AdminAccess = {
        signInConfigured: true,
        signedIn: true,
        admin: isAdminUser(ctx.config, { portalId: user.portalId, email: user.userEmail }),
        adminConfigured: configured,
        account: { portalId: user.portalId, hubDomain: user.hubDomain || undefined, email: user.userEmail || undefined },
      };
      return json(body);
    },
  };

  const snapshot: Route = {
    method: 'GET',
    path: DIAGNOSTICS_ROUTES.diagnostics,
    handler: async (ctx) => {
      if (!status.oauthConfigured) {
        throw new ConnectorError(503, 'not_configured', 'The status page needs Sign in with HubSpot, which isn’t set up on this server yet.');
      }
      const user = await currentUser(ctx);
      if (!user) throw new ConnectorError(401, 'not_connected', 'Sign in with HubSpot to see the status page.');
      if (!adminConfigured(ctx.config)) {
        throw new ConnectorError(403, 'admin_not_configured', 'Nobody can see the status page yet: set ADMIN_EMAILS (or ADMIN_PORTALS) on the server.');
      }
      if (!isAdminUser(ctx.config, { portalId: user.portalId, email: user.userEmail })) {
        throw new ConnectorError(403, 'not_admin', 'The status page is only for the people who host this builder.');
      }
      const you = await diagnostics.visitorId(ctx.clientIp);
      return json(diagnostics.snapshot({ config: ctx.config, status, you }));
    },
  };

  const report: Route = {
    method: 'POST',
    path: DIAGNOSTICS_ROUTES.report,
    handler: async (ctx) => {
      const text = await readBodyText(ctx.request, CLIENT_REPORT_MAX_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw badRequest('The report is not valid JSON.');
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('The report must be a JSON object.');
      const body = raw as Record<string, unknown>;
      const visitor = await diagnostics.visitorId(ctx.clientIp);
      let decision = limiter.take(CLIENT_REPORT_RULE, `visitor:${visitor}`);
      if (decision.ok) decision = limiter.take(CLIENT_REPORT_GLOBAL_RULE, 'everyone');
      if (!decision.ok) {
        throw new ConnectorError(429, 'rate_limited', `Too many reports in a short time. Please wait ${decision.retryAfter} seconds.`, {
          headers: { 'Retry-After': String(decision.retryAfter) },
        });
      }
      let portalId: number | undefined;
      try {
        portalId = (await ctx.session.get())?.portalId;
      } catch {
        portalId = undefined;
      }
      if (body.type === 'client_error') {
        const client = cleanClientError(body);
        if (!client) throw badRequest('The report has no error message.');
        diagnostics.log.record({ kind: 'client.error', outcome: 'failed', visitor, portalId, client });
      } else if (body.type === 'signin_feedback') {
        const kind = body.kind as SignInFeedbackKind;
        if (!SIGN_IN_FEEDBACK_KINDS.includes(kind)) throw badRequest('Unknown sign-in feedback.');
        diagnostics.log.signInFeedback(visitor, kind);
      } else {
        throw badRequest('Unknown report type.');
      }
      return new Response(null, { status: 204 });
    },
  };

  return [access, snapshot, report];
}
