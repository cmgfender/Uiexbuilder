/**
 * Hosting helpers shared by the Node, Vercel and Cloudflare adapters (Web-standard code only: it
 * runs on the Edge runtime and Workers too).
 *
 * 1. Forgiving reading of settings (normalizeHostingEnv).
 * People deploying with one-click buttons often have to fill a box before they have the value
 * (Vercel's deploy form requires every listed variable). The hosting guide tells them to type
 * "later"; such placeholders are treated as "not set", so the builder honestly reports
 * "HubSpot sign-in is not set up yet" instead of sending people to a broken HubSpot page.
 *
 * 2. Plain health checks (allowPlainHealthCheck).
 */

/** Settings where a placeholder or an invalid value means "not set yet". */
export const HUBSPOT_SETTING_NAMES = ['APP_URL', 'HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'SESSION_SECRET'] as const;

const PLACEHOLDER =
  /^(later|todo|tbd|tbc|none|null|undefined|nil|skip|empty|blank|placeholder|pending|change[-_ ]?me|replace[-_ ]?me|fill[-_ ]?me|x+|-+|\.+|\?+|n\/?a|<[^>]*>|\{\{[^}]*\}\}|your[-_ ][a-z0-9 _-]*)$/i;

export function isPlaceholder(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const v = value.trim();
  return v === '' || PLACEHOLDER.test(v) || /your[-_]?domain/i.test(v);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export interface NormalizedHostingEnv {
  env: Record<string, string | undefined>;
  /** Plain-language notes about ignored values, for the startup log (never contains values). */
  notes: string[];
}

/**
 * Copy of `env` with placeholder HubSpot settings removed and APP_URL cleaned (trimmed, trailing
 * slashes dropped; removed when it is not an http(s) address so the platform address is used).
 */
export function normalizeHostingEnv(env: Record<string, string | undefined>): NormalizedHostingEnv {
  const out: Record<string, string | undefined> = { ...env };
  const notes: string[] = [];
  for (const name of HUBSPOT_SETTING_NAMES) {
    const raw = out[name];
    if (raw === undefined) continue;
    if (isPlaceholder(raw)) {
      if (raw.trim() !== '') notes.push(`${name} looks like a placeholder, so it is treated as not set yet.`);
      delete out[name];
      continue;
    }
    out[name] = name === 'SESSION_SECRET' ? raw : raw.trim();
  }
  const appUrl = out.APP_URL;
  if (appUrl !== undefined) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(appUrl);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(appUrl) ? appUrl : `${local ? 'http' : 'https'}://${appUrl}`;
    if (isHttpUrl(withScheme)) {
      out.APP_URL = withScheme.replace(/\/+$/, '');
    } else {
      notes.push('APP_URL is not a web address (it should look like https://builder.example.com), so it is ignored.');
      delete out.APP_URL;
    }
  }
  return { env: out, notes };
}

const HEALTH_PATH = '/api/health';
const CSRF_HEADER = 'X-UIEX-Request';

/**
 * Platform health checks (Render, Docker, uptime monitors) and a person opening /api/health in the
 * browser to check a deploy cannot send the builder's X-UIEX-Request header. The health check holds
 * no user data, so a plain GET without an Origin header is marked as such before it reaches the
 * connector. Requests that carry an Origin are left alone (the connector's origin check applies).
 */
export function allowPlainHealthCheck(request: Request): Request {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return request;
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return request;
  }
  if (pathname !== HEALTH_PATH && pathname !== `${HEALTH_PATH}/`) return request;
  if (request.headers.has(CSRF_HEADER) || request.headers.has('origin')) return request;
  const headers = new Headers(request.headers);
  headers.set(CSRF_HEADER, 'health-check');
  return new Request(request.url, { method, headers, signal: request.signal });
}
