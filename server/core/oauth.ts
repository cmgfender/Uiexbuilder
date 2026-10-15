/**
 * HubSpot OAuth calls: authorize URL, code exchange, refresh, token info, revoke. Plus the region
 * helper that turns token/portal hints into the HubSpot app host used for deep links.
 */
import type { ServerConfig, SessionData } from './types';
import { CONNECTOR_ROUTES } from '../../src/connect/types';

export const HUBSPOT_CALL_TIMEOUT_MS = 10_000;

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface TokenInfo {
  user?: string;
  user_id?: number;
  hub_id: number;
  hub_domain?: string;
  scopes?: string[];
  expires_in?: number;
}

/** OAuth failure. `revoked` = HubSpot rejected the grant (bad/expired/revoked refresh token or code). */
export class OAuthError extends Error {
  constructor(
    message: string,
    public status: number,
    public revoked: boolean,
    public hubspotStatus?: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export function redirectUri(config: ServerConfig): string {
  return `${config.appUrl}${CONNECTOR_ROUTES.authCallback}`;
}

export function authorizeUrl(config: ServerConfig, state: string): string {
  const q = [
    ['client_id', config.hubspotClientId],
    ['redirect_uri', redirectUri(config)],
    ['scope', config.requiredScopes.join(' ')],
  ];
  if (config.optionalScopes.length > 0) q.push(['optional_scope', config.optionalScopes.join(' ')]);
  q.push(['state', state]);
  return `${config.hubspotAppBase}/oauth/authorize?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** fetch with a timeout (AbortController — works on every runtime). */
export async function fetchWithTimeout(config: ServerConfig, url: string, init: RequestInit, timeoutMs = HUBSPOT_CALL_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await config.fetch(url, { ...init, signal: controller.signal, redirect: init.redirect ?? 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function tokenRequest(config: ServerConfig, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...params, client_id: config.hubspotClientId, client_secret: config.hubspotClientSecret });
  let res: Response;
  try {
    res = await fetchWithTimeout(config, `${config.hubspotApiBase}/oauth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' },
      body: body.toString(),
    });
  } catch {
    throw new OAuthError("Couldn't reach HubSpot to finish signing in.", 502, false);
  }
  const data = await readJson(res);
  if (!res.ok) {
    const hsStatus = typeof data?.status === 'string' ? data.status : undefined;
    const oauthError = typeof data?.error === 'string' ? data.error : undefined;
    // 400/401 from the token endpoint means the grant itself is no good (BAD_REFRESH_TOKEN,
    // BAD_AUTH_CODE, invalid_grant…); 5xx / 429 are transient.
    const revoked = res.status === 400 || res.status === 401 || oauthError === 'invalid_grant';
    throw new OAuthError('HubSpot did not accept the sign-in.', res.status, revoked, hsStatus ?? oauthError);
  }
  if (!data || typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new OAuthError('HubSpot sent an unexpected sign-in response.', 502, false);
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : '',
    expires_in: data.expires_in,
  };
}

export function exchangeCode(config: ServerConfig, code: string): Promise<TokenResponse> {
  return tokenRequest(config, { grant_type: 'authorization_code', redirect_uri: redirectUri(config), code });
}

export function refreshAccessToken(config: ServerConfig, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(config, { grant_type: 'refresh_token', redirect_uri: redirectUri(config), refresh_token: refreshToken });
}

export async function getTokenInfo(config: ServerConfig, accessToken: string): Promise<TokenInfo> {
  let res: Response;
  try {
    res = await fetchWithTimeout(config, `${config.hubspotApiBase}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new OAuthError("Couldn't reach HubSpot to read the account details.", 502, false);
  }
  const data = await readJson(res);
  if (!res.ok || !data || typeof data.hub_id !== 'number') {
    throw new OAuthError("HubSpot didn't return the account details.", res.ok ? 502 : res.status, res.status === 400 || res.status === 404);
  }
  return {
    user: typeof data.user === 'string' ? data.user : undefined,
    user_id: typeof data.user_id === 'number' ? data.user_id : undefined,
    hub_id: data.hub_id,
    hub_domain: typeof data.hub_domain === 'string' ? data.hub_domain : undefined,
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((s): s is string => typeof s === 'string') : undefined,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : undefined,
  };
}

/** Best-effort revoke of a refresh token (sign out). Never throws. */
export async function revokeRefreshToken(config: ServerConfig, refreshToken: string): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetchWithTimeout(
      config,
      `${config.hubspotApiBase}/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`,
      { method: 'DELETE' },
      5_000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * HubSpot app host for deep links. HubSpot tokens and personal access keys carry the data-centre
 * region as a prefix ("na1-…", "eu1-…", "pat-eu1-…"); EU portals live on app-eu1.hubspot.com.
 */
export function appHostFor(hints: { refreshToken?: string; hubDomain?: string; apiBase?: string }): string {
  const fromToken = /^(?:pat-)?([a-z]{2}\d)-/i.exec(hints.refreshToken ?? '')?.[1]?.toLowerCase();
  if (fromToken && fromToken !== 'na1') return `app-${fromToken}.hubspot.com`;
  const domain = (hints.hubDomain ?? '').toLowerCase();
  const fromDomain = /(?:^|[.-])(eu\d)(?:[.-]|$)/.exec(domain)?.[1];
  if (fromDomain) return `app-${fromDomain}.hubspot.com`;
  try {
    const host = new URL(hints.apiBase ?? '').hostname.toLowerCase();
    const fromApi = /(?:^|[.-])(eu\d)(?:[.-]|$)/.exec(host)?.[1];
    if (fromApi) return `app-${fromApi}.hubspot.com`;
  } catch {
    // ignore
  }
  return 'app.hubspot.com';
}

/** Build the session from a token response + token info. */
export function buildSessionData(config: ServerConfig, tokens: TokenResponse, info: TokenInfo, previous?: SessionData): SessionData {
  const refreshToken = tokens.refresh_token || previous?.refreshToken || '';
  const hubDomain = info.hub_domain ?? previous?.hubDomain ?? '';
  const data: SessionData = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: config.now() + tokens.expires_in * 1000,
    portalId: info.hub_id,
    hubDomain,
    userEmail: info.user ?? previous?.userEmail ?? '',
    scopes: info.scopes ?? previous?.scopes ?? [],
    appHost: appHostFor({ refreshToken, hubDomain, apiBase: config.hubspotApiBase }),
  };
  const userId = info.user_id ?? previous?.userId;
  if (userId !== undefined) data.userId = userId;
  if (previous?.personalAccessKey) data.personalAccessKey = previous.personalAccessKey;
  return data;
}

/** Refresh the session's access token (keeps portal/user/scopes; HubSpot refresh tokens don't rotate). */
export async function refreshSessionData(config: ServerConfig, data: SessionData): Promise<SessionData> {
  const tokens = await refreshAccessToken(config, data.refreshToken);
  return {
    ...data,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || data.refreshToken,
    expiresAt: config.now() + tokens.expires_in * 1000,
  };
}

/** Refresh when the access token expires within a minute. */
export const REFRESH_MARGIN_MS = 60_000;

export function needsRefresh(config: ServerConfig, data: SessionData): boolean {
  return data.expiresAt - REFRESH_MARGIN_MS < config.now();
}
