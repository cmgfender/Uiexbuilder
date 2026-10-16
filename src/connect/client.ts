/**
 * Typed browser client for the hosted HubSpot connector (routes in ./types CONNECTOR_ROUTES).
 *
 * - Base URL: `import.meta.env.VITE_CONNECTOR_URL` or '' (same origin as the builder). The value
 *   'none' (`npm run build:static`) means there is no connector at all: the client is `disabled`
 *   and the builder never calls /api (no failed requests on static hosting).
 * - Every request sends the session cookie (`credentials: 'include'`) and the CSRF header.
 * - Errors become `ConnectorError` (stable `code`, HTTP `status`, `requiredScopes` for missing
 *   permissions, `retryAfter` for rate limits). A response that is not JSON (e.g. the builder's own
 *   index.html on static hosting) is reported as code 'unavailable'; a network failure as
 *   'network_error'. Aborted requests reject with the usual `AbortError` (see `isAbortError`).
 * - Catalog GETs (object types, properties, pipelines, owners) are cached in memory with a TTL,
 *   scoped to the connected portal (`setCacheScope`). Identical GETs in flight are shared; one
 *   caller aborting never cancels the request for the others.
 */
import {
  CONNECTOR_ROUTES,
  CSRF_HEADER,
  type AssociationResultDTO,
  type ConnectionInfo,
  type ConnectorErrorBody,
  type ConnectorHealth,
  type CrmObjectTypeInfo,
  type CrmOwner,
  type CrmPipeline,
  type CrmPropertyDef,
  type CrmRecord,
  type CrmRecordSummary,
  type CrmSearchRequestDTO,
  type CrmSearchResponseDTO,
  type DeployKeyInfo,
  type DeployRequest,
  type DeployStatus,
  type ProxyFetchRequest,
  type ProxyFetchResponse,
} from './types';
import { findStandardType } from './objectTypes';

export interface ConnectorErrorInit {
  code: string;
  message: string;
  status: number;
  requiredScopes?: string[];
  correlationId?: string;
  /** Seconds to wait before retrying (rate limits). */
  retryAfter?: number;
}

/** An error answered by (or on the way to) the connector. `message` is plain language. */
export class ConnectorError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requiredScopes?: string[];
  readonly correlationId?: string;
  readonly retryAfter?: number;

  constructor(init: ConnectorErrorInit) {
    super(init.message);
    this.name = 'ConnectorError';
    this.code = init.code;
    this.status = init.status;
    if (init.requiredScopes?.length) this.requiredScopes = [...init.requiredScopes];
    if (init.correlationId) this.correlationId = init.correlationId;
    if (init.retryAfter !== undefined) this.retryAfter = init.retryAfter;
  }
}

export function isConnectorError(err: unknown): err is ConnectorError {
  return err instanceof ConnectorError;
}

export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError';
}

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  try {
    return new DOMException('The request was cancelled.', 'AbortError');
  } catch {
    const e = new Error('The request was cancelled.');
    e.name = 'AbortError';
    return e;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CatalogRequestOptions extends RequestOptions {
  /** Skip the cache (the fresh answer is cached again). */
  fresh?: boolean;
}

export type CatalogKind = 'objectTypes' | 'properties' | 'pipelines' | 'owners';

export interface ConnectorClientOptions {
  /** Connector base URL ('' = same origin). Defaults to VITE_CONNECTOR_URL. */
  baseUrl?: string;
  /** fetch implementation (defaults to the global fetch at call time). */
  fetch?: typeof fetch;
  /** TTL of cached catalog GETs (ms). Default 5 minutes. */
  cacheTtlMs?: number;
  now?: () => number;
}

type Query = Record<string, string | number | boolean | undefined | null>;

interface Inflight {
  promise: Promise<unknown>;
  controller: AbortController;
  waiters: number;
}

export const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

/** VITE_CONNECTOR_URL values meaning "this build has no connector" (static hosting). */
const NO_CONNECTOR = /^(none|off|false|disabled)$/i;

function envBaseUrl(): string {
  let raw: unknown;
  try {
    raw = import.meta.env?.VITE_CONNECTOR_URL;
  } catch {
    raw = undefined;
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

export class ConnectorClient {
  readonly baseUrl: string;
  /** Built without a connector (VITE_CONNECTOR_URL=none): nothing should call /api. */
  readonly disabled: boolean;
  private readonly options: ConnectorClientOptions;
  private cache = new Map<string, { expires: number; value: unknown }>();
  private inflight = new Map<string, Inflight>();
  private scope = '';
  /** Bumped whenever the cache is cleared: answers that started earlier are not cached. */
  private generation = 0;
  private errorListeners = new Set<(err: ConnectorError) => void>();

  constructor(options: ConnectorClientOptions = {}) {
    this.options = options;
    const base = (options.baseUrl ?? envBaseUrl()).trim();
    this.disabled = NO_CONNECTOR.test(base);
    this.baseUrl = this.disabled ? '' : base.replace(/\/+$/, '');
  }

  // ------------------------------------------------------------------ plumbing

  /** Origin the connector's pages (sign-in popup) post messages from. */
  get origin(): string {
    if (/^https?:\/\//i.test(this.baseUrl)) {
      try {
        return new URL(this.baseUrl).origin;
      } catch {
        /* fall through */
      }
    }
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  /** True when the connector runs on the builder's own origin. */
  get sameOrigin(): boolean {
    return typeof window !== 'undefined' && this.origin === window.location.origin;
  }

  /** Absolute or root-relative URL for a route path. */
  url(path: string, query?: Query): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  /** URL of the sign-in page (opened in a popup, or navigated to in redirect mode). */
  authStartUrl(params: { returnTo: string; mode: 'popup' | 'redirect' }): string {
    return this.url(CONNECTOR_ROUTES.authStart, { returnTo: params.returnTo, mode: params.mode });
  }

  /** Listen to every ConnectorError (e.g. to notice an expired sign-in). Returns an unsubscribe. */
  onError(listener: (err: ConnectorError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Scope the catalog cache (normally the connected portal id). Changing it clears the cache. */
  setCacheScope(scope: string | null): void {
    const next = scope ?? '';
    if (next === this.scope) return;
    this.scope = next;
    this.clearCache();
  }

  get cacheScope(): string {
    return this.scope;
  }

  clearCache(): void {
    this.cache.clear();
    this.generation++;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private fail(err: ConnectorError): ConnectorError {
    for (const l of this.errorListeners) {
      try {
        l(err);
      } catch {
        /* listeners never break requests */
      }
    }
    return err;
  }

  private async send<T>(method: string, path: string, init: { query?: Query; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const url = this.url(path, init.query);
    const headers: Record<string, string> = { [CSRF_HEADER]: '1', Accept: 'application/json' };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    if (init.signal?.aborted) throw abortError(init.signal);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        credentials: 'include',
        cache: 'no-store',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      });
    } catch (err) {
      if (isAbortError(err) || init.signal?.aborted) throw abortError(init.signal);
      throw this.fail(
        new ConnectorError({ code: 'network_error', status: 0, message: "Couldn't reach the HubSpot connector. Check your internet connection and try again." }),
      );
    }
    const type = res.headers.get('content-type') ?? '';
    const isJson = /[/+]json\b/i.test(type);
    let data: unknown = undefined;
    if (isJson) {
      try {
        data = await res.json();
      } catch (err) {
        if (isAbortError(err) || init.signal?.aborted) throw abortError(init.signal);
        data = undefined;
      }
    }
    if (!res.ok) {
      const body = data as Partial<ConnectorErrorBody> | undefined;
      const e = body && typeof body === 'object' ? body.error : undefined;
      if (e && typeof e === 'object' && typeof e.code === 'string') {
        const retry = res.headers.get('retry-after');
        const retryAfter = retry !== null && retry.trim() !== '' && Number.isFinite(Number(retry)) ? Number(retry) : undefined;
        throw this.fail(
          new ConnectorError({
            code: e.code,
            message: typeof e.message === 'string' && e.message ? e.message : `The connector answered ${res.status}.`,
            status: typeof e.status === 'number' ? e.status : res.status,
            requiredScopes: Array.isArray(e.requiredScopes) ? e.requiredScopes.filter((s): s is string => typeof s === 'string') : undefined,
            correlationId: typeof e.correlationId === 'string' ? e.correlationId : undefined,
            retryAfter: e.code === 'rate_limited' ? (retryAfter ?? 1) : retryAfter,
          }),
        );
      }
      if (!isJson) {
        throw this.fail(new ConnectorError({ code: 'unavailable', status: res.status, message: 'The HubSpot connector is not available here.' }));
      }
      throw this.fail(new ConnectorError({ code: 'http_error', status: res.status, message: `The HubSpot connector answered with an error (${res.status}).` }));
    }
    if (!isJson) {
      throw this.fail(new ConnectorError({ code: 'unavailable', status: res.status, message: 'The HubSpot connector is not available here.' }));
    }
    if (data === undefined) {
      throw this.fail(new ConnectorError({ code: 'bad_response', status: res.status, message: 'The HubSpot connector sent an answer the builder could not read.' }));
    }
    return data as T;
  }

  /** Shares one request between identical callers; aborts it only when every caller aborted. */
  private shared<T>(key: string, run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = run(controller.signal);
      const created: Inflight = { promise, controller, waiters: 0 };
      this.inflight.set(key, created);
      const cleanup = () => {
        if (this.inflight.get(key) === created) this.inflight.delete(key);
      };
      promise.then(cleanup, cleanup);
      entry = created;
    }
    const e = entry;
    e.waiters++;
    if (!signal) return e.promise as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const onAbort = () => {
        if (done) return;
        done = true;
        e.waiters--;
        if (e.waiters <= 0) {
          if (this.inflight.get(key) === e) this.inflight.delete(key);
          e.controller.abort();
        }
        reject(abortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      (e.promise as Promise<T>).then(
        (v) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (err: unknown) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  }

  private get<T>(path: string, query: Query | undefined, opts: CatalogRequestOptions & { cacheable?: boolean } = {}): Promise<T> {
    const url = this.url(path, query);
    const cacheKey = `${this.scope}|${url}`;
    if (opts.cacheable && !opts.fresh) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expires > this.now()) {
        if (opts.signal?.aborted) return Promise.reject(abortError(opts.signal));
        return Promise.resolve(hit.value as T);
      }
    }
    const generation = this.generation;
    const scope = this.scope;
    return this.shared<T>(
      `GET ${opts.fresh ? 'fresh ' : ''}${scope}|${url}`,
      async (signal) => {
        const value = await this.send<T>('GET', path, { query, signal });
        if (opts.cacheable && generation === this.generation && scope === this.scope) {
          this.cache.set(cacheKey, { expires: this.now() + (this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS), value });
        }
        return value;
      },
      opts.signal,
    );
  }

  /** A cached catalog answer, synchronously (undefined when not cached or expired). */
  peek<T = unknown>(kind: CatalogKind, objectType?: string): T | undefined {
    const url = this.catalogUrl(kind, objectType);
    if (!url) return undefined;
    const hit = this.cache.get(`${this.scope}|${url}`);
    return hit && hit.expires > this.now() ? (hit.value as T) : undefined;
  }

  private catalogPath(kind: CatalogKind, objectType?: string): string | null {
    switch (kind) {
      case 'objectTypes':
        return CONNECTOR_ROUTES.objectTypes;
      case 'owners':
        return CONNECTOR_ROUTES.owners;
      case 'properties':
        return objectType?.trim() ? fill(CONNECTOR_ROUTES.properties, { objectType: this.apiObjectType(objectType) }) : null;
      case 'pipelines':
        return objectType?.trim() ? fill(CONNECTOR_ROUTES.pipelines, { objectType: this.apiObjectType(objectType) }) : null;
    }
  }

  private catalogUrl(kind: CatalogKind, objectType?: string): string | null {
    const path = this.catalogPath(kind, objectType);
    return path ? this.url(path) : null;
  }

  /**
   * The object type spelling sent to the connector, so every spelling of one type shares the cache:
   * standard types by name ('0-1' → 'contacts'), custom types by object type id when known.
   */
  apiObjectType(input: string): string {
    const raw = input.trim();
    const std = findStandardType(raw);
    if (std) return std.objectType;
    const types = this.peekObjectTypes();
    const lower = raw.toLowerCase();
    const custom = types?.find((t) => t.objectType.toLowerCase() === lower || t.objectTypeId.toLowerCase() === lower);
    return custom ? custom.objectTypeId : raw;
  }

  private peekObjectTypes(): CrmObjectTypeInfo[] | undefined {
    const hit = this.cache.get(`${this.scope}|${this.url(CONNECTOR_ROUTES.objectTypes)}`);
    return hit && hit.expires > this.now() ? (hit.value as CrmObjectTypeInfo[]) : undefined;
  }

  // ------------------------------------------------------------------ session

  health(opts: RequestOptions = {}): Promise<ConnectorHealth> {
    return this.shared('GET health', (signal) => this.send<ConnectorHealth>('GET', CONNECTOR_ROUTES.health, { signal }), opts.signal);
  }

  me(opts: RequestOptions = {}): Promise<ConnectionInfo> {
    return this.shared('GET me', (signal) => this.send<ConnectionInfo>('GET', CONNECTOR_ROUTES.me, { signal }), opts.signal);
  }

  logout(opts: RequestOptions = {}): Promise<{ ok: true }> {
    return this.send<{ ok: true }>('POST', CONNECTOR_ROUTES.logout, { signal: opts.signal });
  }

  // ------------------------------------------------------------------ catalog (cached)

  objectTypes(opts: CatalogRequestOptions = {}): Promise<CrmObjectTypeInfo[]> {
    return this.get<CrmObjectTypeInfo[]>(CONNECTOR_ROUTES.objectTypes, undefined, { ...opts, cacheable: true });
  }

  properties(objectType: string, opts: CatalogRequestOptions = {}): Promise<CrmPropertyDef[]> {
    const path = this.catalogPath('properties', objectType);
    if (!path) return Promise.reject(missingObjectType());
    return this.get<CrmPropertyDef[]>(path, undefined, { ...opts, cacheable: true });
  }

  pipelines(objectType: string, opts: CatalogRequestOptions = {}): Promise<CrmPipeline[]> {
    const path = this.catalogPath('pipelines', objectType);
    if (!path) return Promise.reject(missingObjectType());
    return this.get<CrmPipeline[]>(path, undefined, { ...opts, cacheable: true });
  }

  owners(opts: CatalogRequestOptions = {}): Promise<CrmOwner[]> {
    return this.get<CrmOwner[]>(CONNECTOR_ROUTES.owners, undefined, { ...opts, cacheable: true });
  }

  // ------------------------------------------------------------------ records

  /** Record picker search: by name / email / domain, or recently changed records when `q` is empty. */
  searchRecords(objectType: string, q: string, opts: RequestOptions & { limit?: number } = {}): Promise<CrmRecordSummary[]> {
    const path = fill(CONNECTOR_ROUTES.searchRecords, { objectType: this.apiObjectType(objectType) });
    return this.get<CrmRecordSummary[]>(path, { q: q.trim(), limit: opts.limit }, { signal: opts.signal });
  }

  getRecord(objectType: string, id: string, opts: RequestOptions & { properties?: string[]; formatted?: boolean } = {}): Promise<CrmRecord> {
    const path = fill(CONNECTOR_ROUTES.record, { objectType: this.apiObjectType(objectType), id });
    return this.get<CrmRecord>(path, { properties: opts.properties?.length ? opts.properties.join(',') : undefined, formatted: opts.formatted ? 1 : undefined }, { signal: opts.signal });
  }

  getAssociations(
    objectType: string,
    id: string,
    toObjectType: string,
    opts: RequestOptions & { properties?: string[]; limit?: number; formatted?: boolean } = {},
  ): Promise<AssociationResultDTO[]> {
    const path = fill(CONNECTOR_ROUTES.associations, { objectType: this.apiObjectType(objectType), id, toObjectType: this.apiObjectType(toObjectType) });
    return this.get<AssociationResultDTO[]>(
      path,
      { properties: opts.properties?.length ? opts.properties.join(',') : undefined, limit: opts.limit, formatted: opts.formatted ? 1 : undefined },
      { signal: opts.signal },
    );
  }

  search(objectType: string, request: CrmSearchRequestDTO, opts: RequestOptions = {}): Promise<CrmSearchResponseDTO> {
    const path = fill(CONNECTOR_ROUTES.search, { objectType: this.apiObjectType(objectType) });
    return this.send<CrmSearchResponseDTO>('POST', path, { body: request, signal: opts.signal });
  }

  proxyFetch(request: ProxyFetchRequest, opts: RequestOptions = {}): Promise<ProxyFetchResponse> {
    return this.send<ProxyFetchResponse>('POST', CONNECTOR_ROUTES.proxyFetch, { body: request, signal: opts.signal });
  }

  // ------------------------------------------------------------------ deploy (beta)

  startDeploy(request: DeployRequest, opts: RequestOptions = {}): Promise<DeployStatus> {
    return this.send<DeployStatus>('POST', CONNECTOR_ROUTES.deployStart, { body: request, signal: opts.signal });
  }

  deployStatus(deployId: string, opts: RequestOptions = {}): Promise<DeployStatus> {
    return this.send<DeployStatus>('GET', fill(CONNECTOR_ROUTES.deployStatus, { deployId }), { signal: opts.signal });
  }

  deployKey(opts: RequestOptions = {}): Promise<DeployKeyInfo> {
    return this.send<DeployKeyInfo>('GET', CONNECTOR_ROUTES.deployKey, { signal: opts.signal });
  }

  forgetDeployKey(opts: RequestOptions = {}): Promise<DeployKeyInfo> {
    return this.send<DeployKeyInfo>('DELETE', CONNECTOR_ROUTES.deployKey, { signal: opts.signal });
  }
}

function missingObjectType(): ConnectorError {
  return new ConnectorError({ code: 'bad_request', status: 400, message: 'Choose an object type first.' });
}

/** Replace `:param` segments (URL-encoded). */
export function fill(route: string, params: Record<string, string>): string {
  return route.replace(/:([A-Za-z]+)/g, (m, name: string) => (name in params ? encodeURIComponent(params[name]) : m));
}

let current = new ConnectorClient();

/** The shared client used by the connection store, catalog hooks and live data. */
export function getConnectorClient(): ConnectorClient {
  return current;
}

/** Replace the shared client (tests, or a custom base URL). Returns the previous one. */
export function setConnectorClient(client: ConnectorClient): ConnectorClient {
  const prev = current;
  current = client;
  return prev;
}
