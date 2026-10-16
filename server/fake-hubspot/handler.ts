/**
 * In-memory fake of the HubSpot endpoints the connector uses (OAuth authorize/token/token-info,
 * CRM objects/search/associations/properties/schemas/pipelines/owners, and the developer-project
 * endpoints used by terminal-free deploy). Used by unit tests (inject as ServerConfig.fetch) and by
 * the dev/e2e fake server (server/fake-hubspot/server.ts).
 *
 * It serves both "hosts" from one handler (paths don't overlap): the app host (`/oauth/authorize`,
 * an HTML consent page with Approve / Deny buttons; `?auto=1` or `autoApprove` skips it) and the API
 * host (`/oauth/v1/…`, `/crm/…`). Paths starting with FAKE_PROJECT_PATH_PREFIXES are delegated to
 * handleFakeProjects (./projects.ts).
 *
 * Test helpers: issueTokens, expireAccessTokens, revokeRefreshTokens, dropScopes / restoreScopes,
 * failNext (inject 401/403/429/5xx), requests (log), seed (mutable data), projects (deploy state).
 */
import { FAKE_PROJECT_PATH_PREFIXES, handleFakeProjects, type FakeProjectsState } from './projects';
import { createSeed, DEFAULT_PORTAL_ID, type FakeObjectType, type FakeRecord, type FakeSeed } from './seed';
import { runSearch } from './search';

export interface FakeHubSpot {
  /** Handle a request addressed to the fake API or app host. */
  handle(request: Request): Promise<Response>;
  /** fetch-compatible wrapper (for ServerConfig.fetch). */
  fetch: typeof fetch;
}

export interface FakeHubSpotOptions {
  clientId: string;
  clientSecret: string;
  portalId?: number;
  /** Skip the consent page: /oauth/authorize redirects straight back with a code. */
  autoApprove?: boolean;
  /** Access token lifetime (default 1800 s, like HubSpot). */
  accessTokenTtlSeconds?: number;
  /** Data-centre prefix for refresh tokens: 'na1' (default) or 'eu1'. */
  region?: string;
  /** Signed-in user shown in token info. */
  user?: { email: string; id: number };
  hubDomain?: string;
  /** Clock (share it with the connector's ServerConfig.now in tests). */
  now?: () => number;
  /** Extra personal access keys accepted by the deploy endpoints (key → portal id). */
  personalAccessKeys?: Record<string, number>;
}

export interface FakeFailureRule {
  /** Matches `${METHOD} ${pathname}` (string = substring). Omit to match the next request. */
  match?: string | RegExp;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** How many matching requests fail (default 1). */
  times?: number;
}

export interface FakeRequestLog {
  method: string;
  path: string;
  search: string;
  /** Access token used (Bearer), if any. */
  token?: string;
}

export interface FakeHubSpotControls extends FakeHubSpot {
  readonly portalId: number;
  readonly seed: FakeSeed;
  /** Deploy (developer projects) state shared with handleFakeProjects. */
  readonly projects: FakeProjectsState;
  readonly requests: FakeRequestLog[];
  /** Create a grant directly (skips the consent page). */
  issueTokens(opts?: { scopes?: string[]; expiresInSeconds?: number }): { accessToken: string; refreshToken: string; expiresIn: number };
  /** Make every current access token expired (HubSpot answers 401 until refreshed). */
  expireAccessTokens(): void;
  /** Revoke every grant (refresh fails with BAD_REFRESH_TOKEN / invalid_grant; access tokens stop working). */
  revokeRefreshTokens(): void;
  /** Remove scopes from every grant (existing and future) to simulate a partial consent. */
  dropScopes(...scopes: string[]): void;
  restoreScopes(): void;
  /** Make the next matching request(s) fail. */
  failNext(rule: FakeFailureRule): void;
  /** Requested + granted scopes for the next consent (default: everything requested). */
  readonly droppedScopes: ReadonlySet<string>;
}

/**
 * Personal access key the fake always accepts for the default portal. Shaped like a real one (a long
 * base64 code that starts with "CiR…", which encodes the hublet "na1"), not like a private app
 * token ("pat-na1-…"). The demo shows it on the fake's personal access key page
 * (`/personal-access-key/<portal>`, the page the builder's "How do I get this?" guide opens).
 */
export const FAKE_PERSONAL_ACCESS_KEY = 'CiRuYTEtZmFrZS1kZW1vLWtleS1hY21lZGVtby0wMDAwMDAwMRIYdWlleC1kZW1vLWZha2UtcGFrLTAwMDAwMQ';
/** The key earlier demos printed (still accepted). */
export const LEGACY_FAKE_PERSONAL_ACCESS_KEY = 'pat-na1-fake0000-0000-4000-8000-000000000001';

interface Grant {
  refreshToken: string;
  clientId: string;
  scopes: string[];
  revoked: boolean;
}

interface AccessToken {
  token: string;
  grant: Grant;
  expiresAt: number;
}

interface AuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  expiresAt: number;
  used: boolean;
}

function uuid(): string {
  return crypto.randomUUID();
}

function hsJson(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'x-hubspot-correlation-id': uuid(), ...headers },
  });
}

function hsError(status: number, message: string, category: string, extra: Record<string, unknown> = {}): Response {
  return hsJson(status, { status: 'error', message, correlationId: uuid(), category, ...extra });
}

function html(status: number, body: string): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HubSpot (fake)</title></head><body>${body}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function splitScopes(raw: string | null): string[] {
  return (raw ?? '').split(/[\s+]+/).filter(Boolean);
}

export function createFakeHubSpot(opts: FakeHubSpotOptions): FakeHubSpotControls {
  const portalId = opts.portalId ?? DEFAULT_PORTAL_ID;
  const seed = createSeed(portalId);
  if (opts.hubDomain) seed.hubDomain = opts.hubDomain;
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.accessTokenTtlSeconds ?? 1800;
  const region = opts.region ?? 'na1';
  // Not "Jordan Lee" (the mock data's user), so switching to live data visibly changes the preview.
  const user = opts.user ?? { email: 'sam.rivera@acmedemo.com', id: 9001 };

  const grants = new Map<string, Grant>();
  const accessTokens = new Map<string, AccessToken>();
  const codes = new Map<string, AuthCode>();
  const dropped = new Set<string>();
  const failures: Array<FakeFailureRule & { remaining: number }> = [];
  const requests: FakeRequestLog[] = [];
  const projects: FakeProjectsState = {
    portalId,
    personalAccessKeys: new Map<string, number>([
      [FAKE_PERSONAL_ACCESS_KEY, portalId],
      [LEGACY_FAKE_PERSONAL_ACCESS_KEY, portalId],
      ...Object.entries(opts.personalAccessKeys ?? {}),
    ]),
  };

  const effectiveScopes = (g: Grant) => g.scopes.filter((s) => !dropped.has(s));

  function newAccessToken(grant: Grant, expiresInSeconds = ttl): AccessToken {
    const at: AccessToken = { token: `fake-at-${region}-${uuid()}`, grant, expiresAt: now() + expiresInSeconds * 1000 };
    accessTokens.set(at.token, at);
    return at;
  }

  function newGrant(clientId: string, scopes: string[]): Grant {
    const grant: Grant = { refreshToken: `${region}-${uuid()}`, clientId, scopes: [...new Set(scopes)], revoked: false };
    grants.set(grant.refreshToken, grant);
    return grant;
  }

  function findType(raw: string): FakeObjectType | undefined {
    const lower = raw.toLowerCase();
    return seed.objectTypes.find((t) => t.name === lower || t.aliases.map((a) => a.toLowerCase()).includes(lower));
  }

  function recordsOf(t: FakeObjectType): FakeRecord[] {
    let list = seed.records.get(t.name);
    if (!list) {
      list = [];
      seed.records.set(t.name, list);
    }
    return list;
  }

  /** Output properties: requested (existing ones, null when unset) + id/created/modified; defaults when none requested. */
  function outputProperties(t: FakeObjectType, r: FakeRecord, requested: string[] | null): Record<string, string | null> {
    const known = new Set(t.properties.map((p) => p.name));
    const createdProp = t.properties.some((p) => p.name === 'hs_createdate') ? 'hs_createdate' : 'createdate';
    const names = requested && requested.length > 0 ? [...requested, 'hs_object_id', createdProp, t.lastModifiedProperty] : t.defaultProperties;
    const out: Record<string, string | null> = {};
    for (const n of names) if (known.has(n)) out[n] = r.properties[n] ?? null;
    return out;
  }

  function objectJson(t: FakeObjectType, r: FakeRecord, requested: string[] | null) {
    return { id: r.id, properties: outputProperties(t, r, requested), createdAt: r.createdAt, updatedAt: r.updatedAt, archived: false };
  }

  function missingScope(scopes: string[]): Response {
    return hsError(403, "This app hasn't been granted all required scopes to make this call. Read more about required scopes here: https://developers.hubspot.com/scopes.", 'MISSING_SCOPES', {
      errors: [{ message: 'One or more of the following scopes are required.', context: { requiredGranularScopes: scopes } }],
      links: { scopes: 'https://developers.hubspot.com/scopes' },
    });
  }

  /** Authenticate a bearer request; returns the token or an error response. */
  function authenticate(request: Request, log: FakeRequestLog): AccessToken | Response {
    const header = request.headers.get('authorization') ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return hsError(401, 'Authentication credentials not found. This API supports OAuth 2.0 authentication.', 'INVALID_AUTHENTICATION');
    log.token = m[1];
    const at = accessTokens.get(m[1]);
    if (!at || at.grant.revoked) return hsError(401, 'Authentication credentials not found. This API supports OAuth 2.0 authentication.', 'INVALID_AUTHENTICATION');
    if (at.expiresAt <= now()) return hsError(401, 'The OAuth token used to make this call expired 1 second(s) ago.', 'EXPIRED_AUTHENTICATION');
    return at;
  }

  function requireAny(at: AccessToken, anyOf: string[]): Response | null {
    const granted = effectiveScopes(at.grant);
    return anyOf.some((s) => granted.includes(s)) ? null : missingScope([anyOf[0]]);
  }

  // ------------------------------------------------------------------ OAuth

  function authorizePage(url: URL): Response {
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const scope = url.searchParams.get('scope') ?? '';
    const optional = url.searchParams.get('optional_scope') ?? '';
    if (clientId !== opts.clientId) return html(400, '<h1>Invalid client</h1><p>The app that sent you here is not recognised (client_id).</p>');
    let redirect: URL;
    try {
      redirect = new URL(redirectUri);
    } catch {
      return html(400, '<h1>Invalid redirect</h1><p>redirect_uri is missing or invalid.</p>');
    }
    if (!splitScopes(scope).includes('oauth')) return html(400, '<h1>Invalid scope</h1><p>The oauth scope is required.</p>');
    if (url.searchParams.get('auto') === '1' || opts.autoApprove) return decide(url, 'approve');
    const all = [...splitScopes(scope), ...splitScopes(optional)];
    const hidden = ['client_id', 'redirect_uri', 'scope', 'optional_scope', 'state']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(url.searchParams.get(k) ?? '')}">`)
      .join('');
    void redirect;
    return html(
      200,
      `<main><h1>Connect to HubSpot (fake)</h1><p>Portal <strong>${portalId}</strong> (${esc(seed.hubDomain)}) — signed in as ${esc(user.email)}.</p>
<p>The app is asking for:</p><ul>${all.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<form method="get" action="/oauth/authorize/decision">${hidden}
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button></form>
<p hidden>${esc(state)}</p></main>`,
    );
  }

  /** The fake "Personal access key" settings page (what "How do I get this?" opens in the demo). */
  function personalAccessKeyPage(): Response {
    const key = esc(FAKE_PERSONAL_ACCESS_KEY);
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Personal access key · HubSpot (fake)</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:40px auto;max-width:640px;padding:0 16px;color:#33475b}code{display:block;word-break:break-all;background:#eaf0f6;padding:10px 12px;border-radius:6px;margin:8px 0}button{font:inherit;padding:6px 14px}</style>
</head><body><main><h1>Personal access key (fake HubSpot)</h1>
<p>Account <strong>${portalId}</strong> (${esc(seed.hubDomain)}) — ${esc(user.email)}</p>
<p>Permissions: <strong>Developer projects</strong> ✓</p>
<label for="k">Your key</label><code id="k">${key}</code>
<button type="button" id="copy">Copy</button> <span id="done" role="status"></span>
<p>This is a demo account: the key only works with the fake HubSpot.</p></main>
<script>document.getElementById('copy').onclick=function(){var t=document.getElementById('k').textContent;var d=document.getElementById('done');(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){d.textContent='Copied';},function(){var r=document.createRange();r.selectNodeContents(document.getElementById('k'));var s=getSelection();s.removeAllRanges();s.addRange(r);d.textContent='Selected - press Ctrl+C to copy';});};</script>
</body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  // ------------------------------------------------------------ demo app pages
  // The "Finish in HubSpot" checklist links to HubSpot's web app (install the app, settings, a
  // record). In the demo those go to this fake, so they get small stand-in pages instead of an
  // error: each says what the real page does and how to get back to the builder.

  function demoPage(title: string, body: string): Response {
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · HubSpot (fake)</title>
<style>body{font:15px/1.55 system-ui,sans-serif;margin:40px auto;max-width:720px;padding:0 16px;color:#33475b}h1{font-size:24px}
.note{background:#eaf0f6;border-radius:8px;padding:10px 14px}.card{border:1px dashed #cbd6e2;border-radius:8px;padding:14px;margin:12px 0}
button{font:inherit;padding:6px 14px}table{border-collapse:collapse}td,th{border-bottom:1px solid #dfe3eb;padding:6px 10px;text-align:left}</style>
</head><body><main><p class="note">Demo account <strong>${portalId}</strong> (${esc(seed.hubDomain)}) — this is a stand-in for a HubSpot page. Close this tab to go back to the builder.</p>
<h1>${esc(title)}</h1>${body}</main></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  function recordName(t: FakeObjectType, r: FakeRecord): string {
    if (t.name === 'contacts') return [r.properties.firstname, r.properties.lastname].filter(Boolean).join(' ') || `Contact ${r.id}`;
    return r.properties[t.primaryDisplayProperty] || `${t.singular} ${r.id}`;
  }

  function demoAppPage(path: string): Response | null {
    let m: RegExpExecArray | null;
    if (/^\/static-token\/\d+\/authorize\/?$/.test(path)) {
      return demoPage(
        'Install your app',
        `<p>In HubSpot this page asks you to approve the access your app needs. Approve it once and every card in the app can show up on your records.</p>
<button type="button" id="install">Install</button> <span id="done" role="status"></span>
<script>document.getElementById('install').onclick=function(){document.getElementById('done').textContent='Installed — close this tab and go back to the builder.';};</script>`,
      );
    }
    if (/^\/settings\/\d+\/?/.test(path)) {
      return demoPage(
        'Settings',
        `<p>In HubSpot, this is where you add your card to a record page: <strong>Data Management → Objects → (your record type) → Record Customization</strong>. The builder’s checklist lists every click.</p>
<p>The demo account has nothing to set up here.</p>`,
      );
    }
    if ((m = /^\/contacts\/\d+\/record\/([^/]+)\/([^/]+)\/?$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      const r = t ? recordsOf(t).find((x) => x.id === decodeURIComponent(m![2])) : undefined;
      if (!t || !r) return demoPage('Record not found', '<p>This demo account has no such record.</p>');
      const rows = t.defaultProperties
        .filter((n) => r.properties[n] && !/^(hs_object_id|createdate|hs_createdate|lastmodifieddate|hs_lastmodifieddate)$/.test(n))
        .slice(0, 6)
        .map((n) => `<tr><th>${esc(t.properties.find((p) => p.name === n)?.label ?? n)}</th><td>${esc(String(r.properties[n]))}</td></tr>`)
        .join('');
      return demoPage(
        recordName(t, r),
        `<table>${rows}</table><div class="card"><strong>Your app cards show here</strong><br>Once the app is installed and the card is added to the ${esc(t.singular.toLowerCase())} record page, HubSpot shows it in this spot.</div>`,
      );
    }
    if ((m = /^\/contacts\/\d+\/objects\/([^/]+)\/?$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return demoPage('Records', '<p>This demo account has no such record type.</p>');
      const items = recordsOf(t)
        .slice(0, 25)
        .map((r) => `<li><a href="/contacts/${portalId}/record/${esc(t.objectTypeId)}/${esc(r.id)}">${esc(recordName(t, r))}</a></li>`)
        .join('');
      return demoPage(t.plural, `<ul>${items}</ul>`);
    }
    if ((m = /^\/developer-projects\/\d+\/project\/([^/]+)\/?/.exec(path))) {
      return demoPage(
        `Project “${decodeURIComponent(m[1])}”`,
        '<p>In HubSpot this page shows your project’s builds and deploys, and the app it contains (Distribution → Install, Auth → Client ID).</p>',
      );
    }
    return null;
  }

  function decide(url: URL, decision: string): Response {
    const clientId = url.searchParams.get('client_id') ?? '';
    const redirectUri = url.searchParams.get('redirect_uri') ?? '';
    const state = url.searchParams.get('state') ?? '';
    if (clientId !== opts.clientId) return html(400, '<h1>Invalid client</h1>');
    let target: URL;
    try {
      target = new URL(redirectUri);
    } catch {
      return html(400, '<h1>Invalid redirect</h1>');
    }
    if (decision !== 'approve') {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('error_description', 'The user denied access');
      if (state) target.searchParams.set('state', state);
      return new Response(null, { status: 302, headers: { location: target.toString() } });
    }
    const scopes = [...splitScopes(url.searchParams.get('scope')), ...splitScopes(url.searchParams.get('optional_scope'))];
    const code: AuthCode = { code: `fake-code-${uuid()}`, clientId, redirectUri, scopes, expiresAt: now() + 10 * 60 * 1000, used: false };
    codes.set(code.code, code);
    target.searchParams.set('code', code.code);
    if (state) target.searchParams.set('state', state);
    return new Response(null, { status: 302, headers: { location: target.toString() } });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const clientId = form.get('client_id');
    const clientSecret = form.get('client_secret');
    if (clientId !== opts.clientId || clientSecret !== opts.clientSecret) {
      return hsJson(400, { status: 'BAD_CLIENT_ID', message: 'missing or unknown client id', error: 'invalid_client', correlationId: uuid() });
    }
    const grantType = form.get('grant_type');
    if (grantType === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '');
      if (!code || code.used || code.expiresAt <= now() || code.clientId !== clientId) {
        return hsJson(400, { status: 'BAD_AUTH_CODE', message: 'missing or unknown auth code', error: 'invalid_grant', correlationId: uuid() });
      }
      if (form.get('redirect_uri') !== code.redirectUri) {
        return hsJson(400, { status: 'BAD_REDIRECT_URI', message: 'redirect_uri does not match', error: 'invalid_grant', correlationId: uuid() });
      }
      code.used = true;
      const grant = newGrant(clientId, code.scopes);
      const at = newAccessToken(grant);
      return hsJson(200, { token_type: 'bearer', refresh_token: grant.refreshToken, access_token: at.token, expires_in: ttl });
    }
    if (grantType === 'refresh_token') {
      const grant = grants.get(form.get('refresh_token') ?? '');
      if (!grant || grant.revoked || grant.clientId !== clientId) {
        return hsJson(400, { status: 'BAD_REFRESH_TOKEN', message: 'missing or unknown refresh token', error: 'invalid_grant', correlationId: uuid() });
      }
      const at = newAccessToken(grant);
      return hsJson(200, { token_type: 'bearer', refresh_token: grant.refreshToken, access_token: at.token, expires_in: ttl });
    }
    return hsJson(400, { status: 'BAD_GRANT_TYPE', message: 'unsupported grant_type', error: 'unsupported_grant_type', correlationId: uuid() });
  }

  function tokenInfo(raw: string): Response {
    const at = accessTokens.get(raw);
    if (!at || at.grant.revoked) return hsError(404, 'Token not found', 'OBJECT_NOT_FOUND');
    if (at.expiresAt <= now()) return hsError(401, 'The OAuth token used to make this call expired.', 'EXPIRED_AUTHENTICATION');
    return hsJson(200, {
      token: at.token,
      user: user.email,
      hub_domain: seed.hubDomain,
      scopes: effectiveScopes(at.grant),
      scope_to_scope_group_pks: [],
      trial_scopes: [],
      trial_scope_to_scope_group_pks: [],
      hub_id: portalId,
      app_id: 424242,
      expires_in: Math.max(0, Math.floor((at.expiresAt - now()) / 1000)),
      user_id: user.id,
      token_type: 'access',
    });
  }

  function refreshTokenInfo(raw: string): Response {
    const grant = grants.get(raw);
    if (!grant || grant.revoked) return hsError(404, 'Refresh token not found', 'OBJECT_NOT_FOUND');
    return hsJson(200, { token: raw, user: user.email, hub_domain: seed.hubDomain, scopes: effectiveScopes(grant), hub_id: portalId, client_id: grant.clientId, user_id: user.id, token_type: 'refresh' });
  }

  function revoke(raw: string): Response {
    const grant = grants.get(raw);
    if (!grant) return hsError(404, 'Refresh token not found', 'OBJECT_NOT_FOUND');
    grant.revoked = true;
    return new Response(null, { status: 204 });
  }

  // ------------------------------------------------------------------ CRM

  function propertyJson(t: FakeObjectType, p: FakeObjectType['properties'][number], i: number) {
    return {
      updatedAt: '2024-01-15T10:30:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
      name: p.name,
      label: p.label,
      type: p.type,
      fieldType: p.fieldType,
      description: p.description ?? '',
      groupName: p.groupName,
      options: p.options ?? [],
      displayOrder: i,
      calculated: p.calculated ?? false,
      externalOptions: p.name === 'hubspot_owner_id',
      hasUniqueValue: p.name === 'hs_object_id',
      hidden: p.hidden ?? false,
      hubspotDefined: p.hubspotDefined ?? false,
      modificationMetadata: { archivable: !p.hubspotDefined, readOnlyDefinition: !!p.hubspotDefined, readOnlyValue: p.readOnlyValue ?? false },
      formField: !p.readOnlyValue,
      archived: false,
      objectType: t.objectTypeId,
    };
  }

  function schemaJson(t: FakeObjectType) {
    return {
      id: t.custom?.schemaId ?? t.objectTypeId,
      name: t.name,
      labels: { singular: t.singular, plural: t.plural },
      objectTypeId: t.objectTypeId,
      fullyQualifiedName: t.custom?.fullyQualifiedName ?? t.name,
      primaryDisplayProperty: t.primaryDisplayProperty,
      secondaryDisplayProperties: t.secondaryDisplayProperties,
      requiredProperties: [t.primaryDisplayProperty],
      searchableProperties: t.searchable,
      properties: t.properties.map((p, i) => propertyJson(t, p, i)),
      associations: [],
      createdAt: '2024-01-15T10:30:00.000Z',
      updatedAt: '2024-01-15T10:30:00.000Z',
      archived: false,
    };
  }

  function associationsFor(from: FakeObjectType, id: string, to: FakeObjectType) {
    const out = new Map<string, Array<{ category: string; typeId: number; label: string | null }>>();
    for (const a of seed.associations) {
      if (a.fromType === from.name && a.fromId === id && a.toType === to.name) {
        out.set(a.toId, [...(out.get(a.toId) ?? []), ...a.types]);
      } else if (a.toType === from.name && a.toId === id && a.fromType === to.name) {
        out.set(a.fromId, [...(out.get(a.fromId) ?? []), ...a.reverseTypes]);
      }
    }
    return [...out.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([toId, types]) => ({ toObjectId: Number(toId), associationTypes: types }));
  }

  async function readJsonBody(request: Request): Promise<unknown> {
    try {
      return JSON.parse(await request.text()) as unknown;
    } catch {
      return undefined;
    }
  }

  function parseProps(url: URL): string[] | null {
    const values = url.searchParams.getAll('properties');
    if (values.length === 0) return null;
    return values.flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
  }

  async function crm(request: Request, url: URL, at: AccessToken): Promise<Response> {
    const path = url.pathname;
    const method = request.method;
    let m: RegExpExecArray | null;

    // GET /crm/v3/schemas, /crm/v3/schemas/:type
    if (method === 'GET' && path === '/crm/v3/schemas') {
      const denied = requireAny(at, ['crm.schemas.custom.read']);
      if (denied) return denied;
      return hsJson(200, { results: seed.objectTypes.filter((t) => t.custom).map(schemaJson) });
    }
    if (method === 'GET' && (m = /^\/crm\/v3\/schemas\/([^/]+)$/.exec(path))) {
      const denied = requireAny(at, ['crm.schemas.custom.read']);
      if (denied) return denied;
      const t = findType(decodeURIComponent(m[1]));
      if (!t || !t.custom) return hsError(404, 'Unable to find object schema', 'OBJECT_NOT_FOUND');
      return hsJson(200, schemaJson(t));
    }

    // GET /crm/v3/properties/:type
    if (method === 'GET' && (m = /^\/crm\/v3\/properties\/([^/]+)$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.schemaScopes);
      if (denied) return denied;
      return hsJson(200, { results: t.properties.map((p, i) => propertyJson(t, p, i)) });
    }

    // GET /crm/v3/pipelines/:type
    if (method === 'GET' && (m = /^\/crm\/v3\/pipelines\/([^/]+)$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const pipelines = seed.pipelines.get(t.name);
      if (!pipelines) return hsError(400, `Pipelines are not supported for object type ${t.name}`, 'VALIDATION_ERROR');
      return hsJson(200, {
        results: pipelines.map((p) => ({
          id: p.id,
          label: p.label,
          displayOrder: p.displayOrder,
          stages: p.stages.map((s) => ({ ...s, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z', archived: false })),
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          archived: false,
        })),
      });
    }

    // GET /crm/v3/owners
    if (method === 'GET' && (path === '/crm/v3/owners' || path === '/crm/v3/owners/')) {
      const denied = requireAny(at, ['crm.objects.owners.read']);
      if (denied) return denied;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      const offset = Number(url.searchParams.get('after') ?? 0) || 0;
      const email = url.searchParams.get('email');
      const all = seed.owners.filter((o) => !email || o.email === email);
      const page = all.slice(offset, offset + limit);
      const body: Record<string, unknown> = {
        results: page.map((o) => ({ ...o, createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', archived: false, teams: [] })),
      };
      if (offset + limit < all.length) body.paging = { next: { after: String(offset + limit) } };
      return hsJson(200, body);
    }

    // POST /crm/v3/objects/:type/search
    if (method === 'POST' && (m = /^\/crm\/v3\/objects\/([^/]+)\/search$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object') return hsError(400, 'Invalid input JSON', 'VALIDATION_ERROR');
      const outcome = runSearch(t, recordsOf(t), body as Record<string, unknown>);
      if (!outcome.ok) return hsError(400, outcome.message, 'VALIDATION_ERROR');
      const res: Record<string, unknown> = {
        total: outcome.total,
        results: outcome.records.map((r) => objectJson(t, r, outcome.properties)),
      };
      if (outcome.nextAfter) res.paging = { next: { after: outcome.nextAfter, link: '?after=' + outcome.nextAfter } };
      return hsJson(200, res);
    }

    // POST /crm/v3/objects/:type/batch/read
    if (method === 'POST' && (m = /^\/crm\/v3\/objects\/([^/]+)\/batch\/read$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const body = (await readJsonBody(request)) as { properties?: unknown; inputs?: unknown } | undefined;
      if (!body || !Array.isArray(body.inputs)) return hsError(400, 'inputs is required', 'VALIDATION_ERROR');
      if (body.inputs.length > 100) return hsError(400, 'Batch size cannot exceed 100', 'VALIDATION_ERROR');
      const props = Array.isArray(body.properties) ? body.properties.filter((p): p is string => typeof p === 'string') : null;
      const list = recordsOf(t);
      const results = [];
      const missing: string[] = [];
      for (const input of body.inputs as Array<{ id?: unknown }>) {
        const r = list.find((x) => x.id === String(input?.id));
        if (r) results.push(objectJson(t, r, props));
        else missing.push(String(input?.id));
      }
      const res: Record<string, unknown> = { status: 'COMPLETE', results, startedAt: new Date(now()).toISOString(), completedAt: new Date(now()).toISOString() };
      if (missing.length > 0) {
        res.numErrors = 1;
        res.errors = [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: 'Could not get some objects, they may be deleted or not exist.', context: { ids: missing } }];
        return hsJson(207, res);
      }
      return hsJson(200, res);
    }

    // GET /crm/v3/objects/:type/:id
    if (method === 'GET' && (m = /^\/crm\/v3\/objects\/([^/]+)\/([^/]+)$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const r = recordsOf(t).find((x) => x.id === m![2]);
      if (!r) return hsError(404, 'Object not found.  objectId are usually numeric.', 'OBJECT_NOT_FOUND');
      return hsJson(200, objectJson(t, r, parseProps(url)));
    }

    // GET /crm/v3/objects/:type  (list)
    if (method === 'GET' && (m = /^\/crm\/v3\/objects\/([^/]+)$/.exec(path))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, 'VALIDATION_ERROR');
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 10) || 10));
      const offset = Number(url.searchParams.get('after') ?? 0) || 0;
      const list = recordsOf(t);
      const res: Record<string, unknown> = { results: list.slice(offset, offset + limit).map((r) => objectJson(t, r, parseProps(url))) };
      if (offset + limit < list.length) res.paging = { next: { after: String(offset + limit) } };
      return hsJson(200, res);
    }

    // GET /crm/v4/objects/:from/:id/associations/:to
    if (method === 'GET' && (m = /^\/crm\/v4\/objects\/([^/]+)\/([^/]+)\/associations\/([^/]+)$/.exec(path))) {
      const from = findType(decodeURIComponent(m[1]));
      const to = findType(decodeURIComponent(m[3]));
      if (!from || !to) return hsError(400, 'Unable to infer object type', 'VALIDATION_ERROR');
      const denied = requireAny(at, from.readScopes) ?? requireAny(at, to.readScopes);
      if (denied) return denied;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 500) || 500));
      const offset = Number(url.searchParams.get('after') ?? 0) || 0;
      const all = associationsFor(from, m[2], to);
      const res: Record<string, unknown> = { results: all.slice(offset, offset + limit) };
      if (offset + limit < all.length) res.paging = { next: { after: String(offset + limit), link: '?after=' + (offset + limit) } };
      return hsJson(200, res);
    }

    return hsError(404, `Unknown fake endpoint ${method} ${path}`, 'OBJECT_NOT_FOUND');
  }

  // ------------------------------------------------------------------ dispatch

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const log: FakeRequestLog = { method: request.method, path, search: url.search };
    requests.push(log);
    if (requests.length > 2000) requests.splice(0, requests.length - 2000);

    const key = `${request.method} ${path}`;
    const ruleIndex = failures.findIndex((r) => r.match === undefined || (typeof r.match === 'string' ? key.includes(r.match) : r.match.test(key)));
    if (ruleIndex >= 0) {
      const rule = failures[ruleIndex];
      rule.remaining -= 1;
      if (rule.remaining <= 0) failures.splice(ruleIndex, 1);
      const body = rule.body ?? { status: 'error', message: `Injected failure ${rule.status}`, correlationId: uuid(), category: rule.status === 429 ? 'RATE_LIMITS' : 'INJECTED' };
      return hsJson(rule.status, body, rule.headers ?? {});
    }

    if (FAKE_PROJECT_PATH_PREFIXES.some((p) => path.startsWith(p))) return handleFakeProjects(request, projects);

    if (request.method === 'GET' && path === '/oauth/authorize') return authorizePage(url);
    if (request.method === 'GET' && (path === '/l/personal-access-key' || /^\/personal-access-key\/\d+\/?$/.test(path))) return personalAccessKeyPage();
    if (request.method === 'GET' && path === '/oauth/authorize/decision') return decide(url, url.searchParams.get('decision') ?? 'deny');
    if (request.method === 'POST' && path === '/oauth/v1/token') return token(request);
    let m: RegExpExecArray | null;
    if (request.method === 'GET' && (m = /^\/oauth\/v1\/access-tokens\/([^/]+)$/.exec(path))) return tokenInfo(decodeURIComponent(m[1]));
    if (request.method === 'GET' && (m = /^\/oauth\/v1\/refresh-tokens\/([^/]+)$/.exec(path))) return refreshTokenInfo(decodeURIComponent(m[1]));
    if (request.method === 'DELETE' && (m = /^\/oauth\/v1\/refresh-tokens\/([^/]+)$/.exec(path))) return revoke(decodeURIComponent(m[1]));

    if (path.startsWith('/crm/')) {
      const at = authenticate(request, log);
      if (at instanceof Response) return at;
      return crm(request, url, at);
    }
    if (request.method === 'GET') {
      const page = demoAppPage(path);
      if (page) return page;
    }
    return hsError(404, `Unknown fake endpoint ${request.method} ${path}`, 'OBJECT_NOT_FOUND');
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    return handle(request);
  };

  return {
    portalId,
    seed,
    projects,
    requests,
    handle,
    fetch: fakeFetch,
    droppedScopes: dropped,
    issueTokens(o = {}) {
      const all = [...(o.scopes ?? ['oauth', 'crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read', 'crm.schemas.contacts.read', 'crm.schemas.companies.read', 'crm.schemas.deals.read', 'crm.objects.tickets.read', 'crm.schemas.tickets.read', 'crm.objects.custom.read', 'crm.schemas.custom.read', 'crm.objects.owners.read', 'crm.objects.line_items.read', 'crm.objects.products.read', 'crm.objects.quotes.read'])];
      const grant = newGrant(opts.clientId, all);
      const at = newAccessToken(grant, o.expiresInSeconds ?? ttl);
      return { accessToken: at.token, refreshToken: grant.refreshToken, expiresIn: o.expiresInSeconds ?? ttl };
    },
    expireAccessTokens() {
      const t = now();
      for (const at of accessTokens.values()) at.expiresAt = Math.min(at.expiresAt, t - 1000);
    },
    revokeRefreshTokens() {
      for (const g of grants.values()) g.revoked = true;
    },
    dropScopes(...scopes: string[]) {
      for (const s of scopes) dropped.add(s);
    },
    restoreScopes() {
      dropped.clear();
    },
    failNext(rule: FakeFailureRule) {
      failures.push({ ...rule, remaining: rule.times ?? 1 });
    },
  };
}
