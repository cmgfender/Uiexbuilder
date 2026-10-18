/**
 * Key check before publishing (POST /api/deploy/check-key): exchanges the personal access key with
 * HubSpot — exactly what a deploy does first — and reports, without uploading anything:
 *  - which HubSpot account the key belongs to (id, name, account type) and a link to that account's
 *    personal access key page;
 *  - whether the key has the "Developer projects" permission, read from the scope groups HubSpot
 *    returns with the exchange ('unknown' when it lists none);
 *  - whether publishing can go ahead: the key must belong to the connected account (once sign-in is
 *    set up) and to ALLOWED_PORTALS when set.
 *
 * Problems with the key itself (empty, malformed, refused by HubSpot, a private app token) are errors
 * (missing_key / invalid_key), like POST /api/deploy. The short-lived access token from the exchange
 * is dropped right away: nothing about the key is stored or returned.
 */
import type { DeployKeyCheck } from '../../../src/connect/types';
import type { ServerConfig, SessionData } from '../types';
import { ConnectorError } from '../http';
import { portalAllowed } from '../config';
import { PortalMismatchError, exchangeDeployKey, keyAccountOf, missingPermissionMessage, portalNotAllowedDeployMessage } from './job';

export interface CheckKeyOptions {
  /** The signed-in session (sign-in set up), or null during first-time setup. */
  signedIn: SessionData | null;
}

/** Largest key-check request body (a key is a few hundred characters). */
export const KEY_CHECK_MAX_BODY_BYTES = 16 * 1024;

export async function checkDeployKey(config: ServerConfig, raw: unknown, opts: CheckKeyOptions): Promise<DeployKeyCheck> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConnectorError(400, 'bad_request', 'The key check must be a JSON object.');
  const r = raw as { personalAccessKey?: unknown; portalId?: unknown };
  const key = typeof r.personalAccessKey === 'string' ? r.personalAccessKey.trim() : '';
  let requested: number | undefined;
  if (r.portalId !== undefined && r.portalId !== null) {
    if (typeof r.portalId !== 'number' || !Number.isSafeInteger(r.portalId) || r.portalId <= 0) {
      throw new ConnectorError(400, 'bad_request', 'portalId must be a HubSpot account id.');
    }
    requested = r.portalId;
  }

  const token = await exchangeDeployKey(config, key);
  const account = keyAccountOf(config, key, token, opts.signedIn);
  const signedIn = opts.signedIn;
  const target = signedIn
    ? { portalId: signedIn.portalId, ...(signedIn.hubDomain ? { name: signedIn.hubDomain } : {}) }
    : requested !== undefined
      ? { portalId: requested }
      : undefined;

  const result: DeployKeyCheck = { ok: true, key: account };
  if (target) result.target = target;
  if (target && target.portalId !== account.portalId) {
    result.ok = false;
    result.problem = 'portal_mismatch';
    result.message = new PortalMismatchError(account.portalId, target.portalId, account.name, !!signedIn).message;
  } else if (!portalAllowed(config, account.portalId)) {
    result.ok = false;
    result.problem = 'portal_not_allowed';
    result.message = portalNotAllowedDeployMessage(account.portalId);
  } else if (account.developerProjects === 'no') {
    result.ok = false;
    result.problem = 'missing_permission';
    result.message = missingPermissionMessage(account);
  }
  return result;
}
