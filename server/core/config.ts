/**
 * Server configuration from environment variables + validation.
 *
 * Env: APP_URL, HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, SESSION_SECRET, HUBSPOT_SCOPES,
 * HUBSPOT_OPTIONAL_SCOPES, HUBSPOT_API_BASE, HUBSPOT_APP_BASE, ENABLE_FETCH_PROXY, ENABLE_DEPLOY,
 * ALLOWED_ORIGINS, NODE_ENV.
 */
import type { ServerConfig } from './types';

export const CONNECTOR_VERSION = '1.0.0';

export const DEFAULT_REQUIRED_SCOPES = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
];

export const DEFAULT_OPTIONAL_SCOPES = [
  'tickets',
  'crm.objects.custom.read',
  'crm.schemas.custom.read',
  'crm.objects.owners.read',
  'crm.objects.line_items.read',
  'crm.objects.products.read',
  'crm.objects.quotes.read',
];

export const DEFAULT_API_BASE = 'https://api.hubapi.com';
export const DEFAULT_APP_BASE = 'https://app.hubspot.com';
export const DEV_APP_URL = 'http://localhost:5173';
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Normalise a URL to its origin ("https://x.com/path/" → "https://x.com"); '' when invalid. */
export function normalizeOrigin(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

/** Normalise an API/app base URL (keeps a path prefix, drops trailing slashes). */
function normalizeBase(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

/** Split a scope list given as commas and/or spaces. */
export function parseScopeList(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.toLowerCase() === 'none') return [];
  const out: string[] = [];
  for (const s of value.split(/[\s,]+/)) {
    if (s && /^[A-Za-z0-9._-]+$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

export function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(value)) return false;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(value)) return true;
  return fallback;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const origin = normalizeOrigin(part);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export function configFromEnv(env: Record<string, string | undefined>, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const production = (env.NODE_ENV ?? '').trim() === 'production';
  const rawAppUrl = env.APP_URL?.trim();
  // Outside production a missing APP_URL means the Vite dev server; in production it stays empty
  // and is reported as missing (sign-in needs the exact public URL for the OAuth redirect).
  const appUrl = rawAppUrl ? normalizeOrigin(rawAppUrl) : production ? '' : DEV_APP_URL;

  const required = parseScopeList(env.HUBSPOT_SCOPES) ?? [...DEFAULT_REQUIRED_SCOPES];
  if (!required.includes('oauth')) required.unshift('oauth');
  const optional = (parseScopeList(env.HUBSPOT_OPTIONAL_SCOPES) ?? [...DEFAULT_OPTIONAL_SCOPES]).filter((s) => !required.includes(s));

  const base: ServerConfig = {
    appUrl,
    hubspotClientId: (env.HUBSPOT_CLIENT_ID ?? '').trim(),
    hubspotClientSecret: (env.HUBSPOT_CLIENT_SECRET ?? '').trim(),
    sessionSecret: env.SESSION_SECRET ?? '',
    requiredScopes: required,
    optionalScopes: optional,
    hubspotApiBase: normalizeBase(env.HUBSPOT_API_BASE, DEFAULT_API_BASE),
    hubspotAppBase: normalizeBase(env.HUBSPOT_APP_BASE, DEFAULT_APP_BASE),
    enableFetchProxy: parseBool(env.ENABLE_FETCH_PROXY, true),
    enableDeploy: parseBool(env.ENABLE_DEPLOY, true),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    secureCookies: appUrl.startsWith('https:'),
    fetch: defaultFetch,
    now: () => Date.now(),
    version: CONNECTOR_VERSION,
  };

  const merged: ServerConfig = { ...base, ...stripUndefined(overrides) };
  if (overrides.appUrl !== undefined) {
    merged.appUrl = normalizeOrigin(overrides.appUrl);
    if (overrides.secureCookies === undefined) merged.secureCookies = merged.appUrl.startsWith('https:');
  }
  if (overrides.allowedOrigins !== undefined) {
    merged.allowedOrigins = overrides.allowedOrigins.map((o) => normalizeOrigin(o)).filter(Boolean);
  }
  if (overrides.hubspotApiBase !== undefined) merged.hubspotApiBase = normalizeBase(overrides.hubspotApiBase, DEFAULT_API_BASE);
  if (overrides.hubspotAppBase !== undefined) merged.hubspotAppBase = normalizeBase(overrides.hubspotAppBase, DEFAULT_APP_BASE);
  return merged;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export interface ConfigStatus {
  /** Sign-in (and therefore CRM data) can work. */
  oauthConfigured: boolean;
  /** Environment variables that are missing or invalid, with a short reason. */
  missing: Array<{ name: string; reason: string }>;
}

export function checkConfig(config: ServerConfig): ConfigStatus {
  const missing: ConfigStatus['missing'] = [];
  if (!config.appUrl) missing.push({ name: 'APP_URL', reason: 'the public address of the builder, e.g. https://builder.example.com' });
  if (!config.hubspotClientId) missing.push({ name: 'HUBSPOT_CLIENT_ID', reason: "your HubSpot app's client ID" });
  if (!config.hubspotClientSecret) missing.push({ name: 'HUBSPOT_CLIENT_SECRET', reason: "your HubSpot app's client secret" });
  if (!config.sessionSecret || config.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    missing.push({
      name: 'SESSION_SECRET',
      reason: config.sessionSecret ? `too short — use at least ${MIN_SESSION_SECRET_LENGTH} random characters` : `at least ${MIN_SESSION_SECRET_LENGTH} random characters`,
    });
  }
  return { oauthConfigured: missing.length === 0, missing };
}

export function notConfiguredMessage(status: ConfigStatus): string {
  const names = status.missing.map((m) => `${m.name} (${m.reason})`).join('; ');
  return `Sign in with HubSpot isn't set up on this server yet. Whoever hosts the builder needs to set: ${names}.`;
}

/** True when the app runs on a loopback host (local development). */
export function isLocalAppUrl(appUrl: string): boolean {
  try {
    const host = new URL(appUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}
