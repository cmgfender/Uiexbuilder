/**
 * Authenticated HubSpot API client for one request (ctx.hubspot()).
 * - refreshes the access token when it expires within 60 s, and once more on a 401
 * - writes the refreshed tokens back into the session cookie
 * - maps HubSpot errors to HubSpotApiError with stable codes (missing_scope, rate_limited …)
 * - retries a 429 once after a bounded Retry-After wait
 */
import { HubSpotApiError, type HubSpotApi, type ServerConfig, type Session, type SessionData } from './types';
import { RateLimitedError, sleep } from './http';
import { HUBSPOT_CALL_TIMEOUT_MS, OAuthError, needsRefresh, refreshSessionData } from './oauth';

/** Longest we wait for a Retry-After before retrying once. */
export const MAX_RETRY_WAIT_MS = 2_000;

export interface HubSpotApiOptions {
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const SCOPE_FRIENDLY: Record<string, string> = {
  tickets: 'tickets',
  'crm.objects.contacts.read': 'contacts',
  'crm.objects.companies.read': 'companies',
  'crm.objects.deals.read': 'deals',
  'crm.objects.custom.read': 'custom objects',
  'crm.schemas.custom.read': 'custom object definitions',
  'crm.objects.owners.read': 'record owners',
  'crm.objects.line_items.read': 'line items',
  'crm.objects.products.read': 'products',
  'crm.objects.quotes.read': 'quotes',
  'crm.schemas.contacts.read': 'contact properties',
  'crm.schemas.companies.read': 'company properties',
  'crm.schemas.deals.read': 'deal properties',
};

export function missingScopeMessage(scopes: string[]): string {
  if (scopes.length === 0) {
    return "Your HubSpot connection doesn't include permission for this. Disconnect, connect again and approve all the requested access.";
  }
  const what = [...new Set(scopes.map((s) => SCOPE_FRIENDLY[s] ?? s))].join(', ');
  return `Your HubSpot connection doesn't include permission to read ${what}. Disconnect, connect again and approve access to ${what} (scope: ${scopes.join(', ')}).`;
}

interface HubSpotErrorJson {
  status?: string;
  message?: string;
  correlationId?: string;
  category?: string;
  errors?: Array<{ message?: string; context?: Record<string, unknown> }>;
  context?: Record<string, unknown>;
}

function collectRequiredScopes(body: HubSpotErrorJson | null): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const s of v) if (typeof s === 'string' && !out.includes(s)) out.push(s);
  };
  for (const e of body?.errors ?? []) {
    add(e.context?.requiredGranularScopes);
    add(e.context?.requiredScopes);
  }
  add(body?.context?.requiredGranularScopes);
  add(body?.context?.requiredScopes);
  return out;
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 1;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return 1;
}

/** Map a non-OK HubSpot response to a HubSpotApiError. */
export function mapHubSpotError(status: number, body: HubSpotErrorJson | null, retryAfter?: string | null): HubSpotApiError {
  const correlationId = body?.correlationId;
  const hsMessage = typeof body?.message === 'string' ? body.message.slice(0, 500) : '';
  if (status === 401) {
    return new HubSpotApiError('Your HubSpot sign-in has expired. Connect HubSpot again.', 401, 'not_connected', correlationId);
  }
  if (status === 403) {
    const required = collectRequiredScopes(body);
    if (body?.category === 'MISSING_SCOPES' || required.length > 0) {
      return new HubSpotApiError(missingScopeMessage(required), 403, 'missing_scope', correlationId, required);
    }
    return new HubSpotApiError(hsMessage || "HubSpot says you don't have access to this.", 403, 'forbidden', correlationId);
  }
  if (status === 404) {
    return new HubSpotApiError("HubSpot couldn't find that — it may have been deleted, or it isn't in this account.", 404, 'not_found', correlationId);
  }
  if (status === 429) {
    const secs = parseRetryAfter(retryAfter ?? null);
    return new RateLimitedError(`HubSpot is receiving too many requests right now. Please wait ${Math.max(1, Math.ceil(secs))} seconds and try again.`, Math.max(1, Math.ceil(secs)), correlationId);
  }
  if (status === 400 || status === 409 || status === 422) {
    return new HubSpotApiError(hsMessage ? `HubSpot couldn't process the request: ${hsMessage}` : "HubSpot couldn't process the request.", 400, 'bad_request', correlationId);
  }
  return new HubSpotApiError('HubSpot had a problem answering. Please try again in a moment.', 502, 'hubspot_error', correlationId);
}

/** Thrown when the refresh token no longer works (app uninstalled, access revoked). */
export function revokedError(): HubSpotApiError {
  return new HubSpotApiError('Your HubSpot connection was removed or has expired. Connect HubSpot again.', 401, 'not_connected');
}

export class SessionHubSpotApi implements HubSpotApi {
  private refreshing: Promise<SessionData> | null = null;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ServerConfig,
    private readonly session: Session,
    private data: SessionData,
    opts: HubSpotApiOptions = {},
  ) {
    this.sleep = opts.sleep ?? sleep;
    this.timeoutMs = opts.timeoutMs ?? HUBSPOT_CALL_TIMEOUT_MS;
  }

  get current(): SessionData {
    return this.data;
  }

  /** Refresh tokens (deduplicated within the request) and persist them in the cookie. */
  async refresh(): Promise<SessionData> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const next = await refreshSessionData(this.config, this.data);
          this.data = next;
          await this.session.set(next);
          return next;
        } catch (err) {
          if (err instanceof OAuthError && err.revoked) {
            this.session.clear();
            throw revokedError();
          }
          throw new HubSpotApiError("Couldn't renew your HubSpot sign-in right now. Please try again in a moment.", 502, 'hubspot_error');
        } finally {
          // allow a later refresh (e.g. after a 401) once this one settles
          queueMicrotask(() => {
            this.refreshing = null;
          });
        }
      })();
    }
    return this.refreshing;
  }

  async ensureFresh(): Promise<SessionData> {
    if (needsRefresh(this.config, this.data)) return this.refresh();
    return this.data;
  }

  async request<T>(method: string, path: string, init: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    await this.ensureFresh();
    const url = new URL(`${this.config.hubspotApiBase}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    let refreshed = false;
    let retried429 = false;
    for (;;) {
      const res = await this.send(method, url.toString(), init.body);
      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new HubSpotApiError('HubSpot sent a response the connector could not read.', 502, 'hubspot_error');
        }
      }
      const body = await readErrorJson(res);
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.refresh();
        continue;
      }
      if (res.status === 429 && !retried429) {
        retried429 = true;
        const waitMs = Math.min(MAX_RETRY_WAIT_MS, parseRetryAfter(res.headers.get('retry-after')) * 1000);
        await this.sleep(waitMs);
        continue;
      }
      if (res.status === 401) {
        // Still unauthorized right after a refresh: the grant is gone.
        this.session.clear();
        throw revokedError();
      }
      throw mapHubSpotError(res.status, body, res.headers.get('retry-after'));
    }
  }

  private async send(method: string, url: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.data.accessToken}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await this.config.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new HubSpotApiError('HubSpot took too long to answer. Please try again.', 504, 'timeout');
      }
      void err;
      throw new HubSpotApiError("Couldn't reach HubSpot. Check the connection and try again.", 502, 'hubspot_unreachable');
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readErrorJson(res: Response): Promise<HubSpotErrorJson | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as HubSpotErrorJson) : null;
  } catch {
    return null;
  }
}
