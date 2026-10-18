/**
 * Event action execution for the preview runtime.
 *
 * Semantics mirror the React code generated for a handler:
 *  - Steps run sequentially; async steps (fetch, run function, refetch) are awaited.
 *  - Every expression sees the scope SNAPSHOT taken when the handler started: a `setState` step
 *    does not change the value later steps of the same handler see (like `setCount(count + 1)`
 *    followed by `count` in a React event handler). Branches of `if` share that snapshot.
 *    Only fetch / run-function callbacks add values: `response` in onSuccess, `error` in onError.
 *  - A failing expression (or custom code) throws, which aborts the rest of the handler — as the
 *    generated code would. Inside fetch / run function, a failure (request, body/parameters
 *    expression or an onSuccess step) runs the onError steps instead (try { ... } catch (error)).
 *  - Errors are logged to the runtime console and never escape into the editor.
 *  - With live HubSpot data (ActionHost.getLive), fetch requests go through the connector's
 *    proxy (no browser CORS limits) and actions.fetchCrmObjectProperties reads the sample record.
 */
import type {
  ActionStep,
  AlertType,
  AppFunction,
  Extension,
  FetchAction,
  LogLevel,
  Project,
  RunFunctionAction,
} from '../model/types';
import type { ProxyFetchRequest, ProxyFetchResponse } from '../connect/types';
import { evaluate, interpolate, runStatements, type Scope } from './expr';
import { elapsedMs, isAbortLike, liveErrorInfo, now } from './liveErrors';
import { mockFunctionResult, mockRecordProperties } from './mockData';
import type { IframeModalState, LiveDataAdapter, RuntimeLogEntry } from './types';

/** Simulated latencies and limits (mutable so tests can shorten them). */
export const RUNTIME_TIMING = {
  /** runDataSource: time between loading=true and the (mock) data arriving. */
  dataSourceLatencyMs: 350,
  /** runFunction / hubspot.serverless: simulated round trip. */
  functionLatencyMs: 300,
  /** Alerts added with addAlert dismiss themselves after this long. */
  alertDismissMs: 6000,
  /** Default timeout for real fetch requests made from the preview. */
  fetchTimeoutMs: 8000,
  /** Live data: a source whose request changed re-runs once its inputs settle for this long. */
  liveDebounceMs: 250,
};

/** What the action runner needs from the runtime host (RuntimeProvider implements it). */
export interface ActionHost {
  getProject(): Project;
  getExtension(): Extension;
  hasState(name: string): boolean;
  setState(name: string, value: unknown): void;
  addAlert(alert: { type: AlertType; title?: string; message: string }): void;
  log(level: RuntimeLogEntry['level'], message: string, detail?: unknown): void;
  openIframeModal(modal: IframeModalState, onClose?: () => void): void;
  closeOverlay(idOrOverlayId: string): void;
  runDataSource(dataSourceId: string): Promise<void>;
  /** False once the runtime was reset or unmounted: in-flight handlers stop silently. */
  isActive(): boolean;
  /** Live HubSpot data of the preview (null / absent = mock data). */
  getLive?(): LiveDataAdapter | null;
}

const ALERT_TYPES: AlertType[] = ['info', 'warning', 'success', 'danger', 'tip'];

/** Normalises user-supplied alert types ('error' is accepted as an alias of 'danger'). */
export function normalizeAlertType(type: unknown): AlertType {
  if (type === 'error') return 'danger';
  return ALERT_TYPES.includes(type as AlertType) ? (type as AlertType) : 'info';
}

/** A handler step failed; the message has already been logged. Aborts the handler. */
class StepFailure extends Error {
  constructor(
    message: string,
    readonly original: unknown,
  ) {
    super(message);
    this.name = 'StepFailure';
  }
}

/** A request failure from the preview's fetch (network/CORS or timeout). */
export class PreviewFetchError extends Error {
  constructor(
    message: string,
    readonly reason: 'network' | 'timeout' | 'status' | 'parse',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PreviewFetchError';
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

function toError(e: unknown): Error {
  if (e instanceof StepFailure) return toError(e.original);
  return e instanceof Error ? e : new Error(errorMessage(e));
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Human label of a step, used in log messages. */
export function describeStep(step: ActionStep): string {
  switch (step.type) {
    case 'setState':
      return `Set ${step.state || '(no state)'}`;
    case 'addAlert':
      return 'Show alert';
    case 'refreshObjectProperties':
      return 'Refresh object properties';
    case 'reloadPage':
      return 'Reload page';
    case 'openIframeModal':
      return 'Open iframe modal';
    case 'closeOverlay':
      return 'Close overlay';
    case 'copyToClipboard':
      return 'Copy to clipboard';
    case 'runDataSource':
      return 'Refetch data';
    case 'fetch':
      return `Fetch ${step.method} ${step.url}`;
    case 'runFunction':
      return 'Run app function';
    case 'log':
      return 'Log message';
    case 'if':
      return 'If / else';
    case 'custom':
      return 'Custom code';
    default:
      return 'Action';
  }
}

/** Evaluates an expression or throws a logged StepFailure (aborting the handler). */
function evalStrict(host: ActionHost, step: ActionStep, what: string, code: string, scope: Scope): unknown {
  const r = evaluate(code, scope);
  if (!r.ok) {
    const message = `${describeStep(step)}: ${what} failed — ${r.error}`;
    host.log('error', message, { expression: code });
    throw new StepFailure(message, new Error(r.error));
  }
  return r.value;
}

// ---------------------------------------------------------------------------
// Simulated HubSpot host APIs (shared by steps and custom code)
// ---------------------------------------------------------------------------

export interface PreviewFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * hubspot.fetch as the preview runs it: a real browser fetch with a timeout. JSON-serialises
 * object bodies like HubSpot does. Network failures (usually CORS in the designer) and timeouts
 * reject with a PreviewFetchError.
 */
export async function previewFetch(url: string, options: PreviewFetchOptions = {}): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const timeoutMs = options.timeout ?? RUNTIME_TIMING.fetchTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const init: RequestInit = { method, headers, signal: controller.signal };
  if (options.body !== undefined && options.body !== null && method !== 'GET') {
    if (typeof options.body === 'string') {
      init.body = options.body;
    } else {
      init.body = JSON.stringify(options.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
  }
  try {
    if (typeof globalThis.fetch !== 'function') throw new Error('fetch is not available in this browser');
    return await globalThis.fetch(url, init);
  } catch (e) {
    if (controller.signal.aborted) {
      throw new PreviewFetchError(`Request timed out after ${Math.round(timeoutMs / 100) / 10}s`, 'timeout');
    }
    throw new PreviewFetchError(`Network request failed (${errorMessage(e)})`, 'network');
  } finally {
    clearTimeout(timer);
  }
}

/** Parses a JSON response body (empty body -> null). Rejects on non-2xx statuses. */
async function readJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  let parsed = true;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      parsed = false;
      body = text;
    }
  }
  if (!res.ok) {
    const err = new PreviewFetchError(`Request failed with status ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`, 'status', res.status);
    (err as PreviewFetchError & { body?: unknown }).body = body;
    throw err;
  }
  if (!parsed) throw new PreviewFetchError('Response is not valid JSON', 'parse', res.status);
  return body;
}

const PROXY_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;

/**
 * The connector request for a preview hubspot.fetch call. Bodies are JSON (a JSON string body is
 * sent as the value it encodes), GET requests carry none.
 */
export function previewRequestToProxy(url: string, options: PreviewFetchOptions = {}): ProxyFetchRequest {
  const upper = (options.method ?? 'GET').toUpperCase();
  const method = (PROXY_METHODS as readonly string[]).includes(upper) ? (upper as ProxyFetchRequest['method']) : 'GET';
  const request: ProxyFetchRequest = { url, method, timeoutMs: options.timeout ?? RUNTIME_TIMING.fetchTimeoutMs };
  if (options.headers && Object.keys(options.headers).length) request.headers = { ...options.headers };
  if (method !== 'GET' && options.body !== undefined && options.body !== null) {
    let body = options.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON: sent as a JSON string.
      }
    }
    request.body = body;
  }
  return request;
}

/**
 * Parses a proxied response like the preview parses a direct one (empty body -> null): a non-2xx
 * status or a body that is not JSON throws a PreviewFetchError.
 */
export function readProxyJson(res: ProxyFetchResponse): unknown {
  const text = typeof res.body === 'string' ? res.body : '';
  let body: unknown = null;
  let parsed = true;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      parsed = false;
      body = text;
    }
  }
  if (!res.ok) {
    const err = new PreviewFetchError(`Request failed with status ${res.status}`, 'status', res.status);
    (err as PreviewFetchError & { body?: unknown }).body = body;
    throw err;
  }
  if (!parsed) {
    throw new PreviewFetchError(
      res.truncated ? 'Response is too large to preview (it was cut off, so it is not valid JSON)' : 'Response is not valid JSON',
      'parse',
      res.status,
    );
  }
  return body;
}

/** A fetch Response stand-in for a proxied response (what custom code's hubspot.fetch resolves to). */
export function proxyResponseLike(url: string, res: ProxyFetchResponse): Response {
  const text = typeof res.body === 'string' ? res.body : '';
  const headerMap = new Map(Object.entries(res.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const headers = {
    get: (name: string) => headerMap.get(String(name).toLowerCase()) ?? null,
    has: (name: string) => headerMap.has(String(name).toLowerCase()),
    forEach: (cb: (value: string, key: string) => void) => headerMap.forEach((v, k) => cb(v, k)),
  };
  const like = {
    ok: res.ok,
    status: res.status,
    statusText: '',
    url,
    redirected: false,
    type: 'basic',
    headers,
    bodyUsed: false,
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
    clone: () => proxyResponseLike(url, res),
  };
  return like as unknown as Response;
}

/** The connector's fetch proxy when the preview uses live HubSpot data. */
function proxyOf(host: ActionHost): LiveDataAdapter['proxyFetch'] | undefined {
  const live = host.getLive?.();
  return live && typeof live.proxyFetch === 'function' ? live.proxyFetch : undefined;
}

/** Logs a proxied request that failed (connector errors keep their code). */
function logProxyFailure(host: ActionHost, method: string, url: string, e: unknown): void {
  if (isAbortLike(e)) return;
  const info = liveErrorInfo(e);
  const body = e instanceof PreviewFetchError ? (e as { body?: unknown }).body : undefined;
  host.log(
    'error',
    `Live: ${method} ${url} failed — ${info.message}${info.code ? ` (${info.code})` : ''}`,
    body !== undefined ? body : info.detail,
  );
}

/** Explains why a request from the designer failed and how HubSpot differs. */
function logFetchFailure(host: ActionHost, url: string, e: unknown): void {
  if (e instanceof PreviewFetchError && e.reason === 'network') {
    host.log(
      'error',
      `Request to ${url} failed: ${e.message}. In the designer the request goes straight from your browser, so ` +
        `the server must allow CORS. In HubSpot, hubspot.fetch is proxied by HubSpot's servers (no CORS needed; the ` +
        `URL's origin must be listed in the app's permitted fetch URLs). Mock the response in Data → mock data to ` +
        `preview it here.`,
    );
    return;
  }
  if (e instanceof PreviewFetchError && e.reason === 'timeout') {
    host.log('error', `Request to ${url} failed: ${e.message}.`);
    return;
  }
  host.log('error', `Request to ${url} failed: ${errorMessage(e)}`, e instanceof PreviewFetchError ? (e as { body?: unknown }).body : undefined);
}

function findFunction(project: Project, idOrUid: string): AppFunction | undefined {
  return project.functions.find((f) => f.id === idOrUid) ?? project.functions.find((f) => f.uid === idOrUid || f.fileName === idOrUid);
}

/** hubspot.serverless as the preview runs it: returns the function's mock result after a delay. */
async function simulateServerless(
  host: ActionHost,
  fn: AppFunction,
  parameters: unknown,
  propertiesToSend: string[] | undefined,
): Promise<unknown> {
  const ext = host.getExtension();
  host.log('action', `hubspot.serverless('${fn.uid}')`, {
    parameters,
    ...(propertiesToSend?.length ? { propertiesToSend: mockRecordProperties(ext, propertiesToSend) } : {}),
  });
  await delay(RUNTIME_TIMING.functionLatencyMs);
  const result = mockFunctionResult(host.getExtension(), fn.id);
  host.log('info', `${fn.uid} returned (mock)`, result);
  return result;
}

/**
 * `announce`: say in the card what was copied (HubSpot copies silently, so the preview shows it
 * to make the action testable) — unless the handler shows its own alert afterwards, which would
 * otherwise appear twice.
 */
async function copyText(host: ActionHost, text: string, announce = true): Promise<void> {
  try {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) throw new Error('Clipboard API is not available');
    await clipboard.writeText(text);
    host.log('action', `Copied to clipboard: "${text}"`);
    if (announce) host.addAlert({ type: 'info', title: 'Copied to clipboard (preview)', message: clipText(text) || '(empty text)' });
  } catch (e) {
    host.log('warn', `Copy to clipboard failed (${errorMessage(e)}). Text: "${text}"`);
    host.addAlert({ type: 'warning', title: 'Copy to clipboard (preview)', message: `The browser blocked the copy. Text: ${clipText(text) || '(empty text)'}` });
  }
}

function clipText(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `“${flat.slice(0, 59)}…”` : flat ? `“${flat}”` : '';
}

function simulatedNotice(host: ActionHost, call: string, explanation: string): void {
  host.log('action', `${call} (simulated)`);
  host.addAlert({ type: 'info', title: `${call} (simulated)`, message: explanation });
}

function closeOverlayById(host: ActionHost, idOrOverlayId: string): void {
  host.closeOverlay(idOrOverlayId);
  host.log('action', `actions.closeOverlay('${idOrOverlayId}')`);
}

function openIframe(
  host: ActionHost,
  opts: { uri?: unknown; title?: unknown; width?: unknown; height?: unknown; flush?: unknown },
  onClose?: () => void,
): void {
  const modal: IframeModalState = {
    uri: String(opts.uri ?? ''),
    title: String(opts.title ?? ''),
    width: typeof opts.width === 'number' && opts.width > 0 ? opts.width : 640,
    height: typeof opts.height === 'number' && opts.height > 0 ? opts.height : 480,
    flush: opts.flush === true,
  };
  host.log('action', `actions.openIframeModal('${modal.uri}')`, modal);
  host.openIframeModal(modal, onClose);
}

/**
 * The sample record's real properties (live data with a sample record and a property list), or
 * null to use the mock values. Failures are logged and reject like HubSpot's action would.
 */
async function liveRecordProperties(host: ActionHost, list: string[] | '*'): Promise<Record<string, string | null> | null> {
  const live = host.getLive?.();
  const crm = live?.context.crm;
  if (!live || !crm || list === '*' || list.length === 0) return null;
  const started = now();
  try {
    const values = await live.getRecordProperties(crm.objectTypeId, crm.objectId, list, false);
    const out: Record<string, string | null> = {};
    for (const p of list) {
      const v = values?.[p];
      out[p] = v === undefined || v === null ? null : String(v);
    }
    host.log('info', `Live: GET record properties (${list.length}) — ${elapsedMs(started)} ms`);
    return out;
  } catch (e) {
    if (!isAbortLike(e)) {
      const info = liveErrorInfo(e);
      host.log('error', `Live: GET record properties failed — ${info.message}${info.code ? ` (${info.code})` : ''}`, info.detail);
    }
    throw e;
  }
}

/** The `actions`, `hubspot` and `logger` objects available to custom code. */
export function createCustomCodeGlobals(host: ActionHost): { actions: Record<string, unknown>; hubspot: Record<string, unknown>; logger: Record<string, unknown> } {
  const fmt = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : safeJson(a))).join(' ');
  const logger = {
    info: (...args: unknown[]) => host.log('info', fmt(args)),
    warn: (...args: unknown[]) => host.log('warn', fmt(args)),
    error: (...args: unknown[]) => host.log('error', fmt(args)),
    debug: (...args: unknown[]) => host.log('debug', fmt(args)),
  };
  const actions = {
    addAlert: (opts: { type?: unknown; title?: unknown; message?: unknown } = {}) => {
      const alert = {
        type: normalizeAlertType(opts.type),
        title: opts.title === undefined ? undefined : String(opts.title),
        message: opts.message === undefined ? '' : String(opts.message),
      };
      host.log('action', `actions.addAlert(${alert.type})`, alert);
      host.addAlert(alert);
    },
    reloadPage: () => simulatedNotice(host, 'actions.reloadPage()', 'In HubSpot this reloads the page.'),
    refreshObjectProperties: () =>
      simulatedNotice(host, 'actions.refreshObjectProperties()', 'In HubSpot this refreshes the record’s properties on the page.'),
    openIframeModal: (opts: Record<string, unknown> = {}, onClose?: () => void) =>
      openIframe(host, opts, typeof onClose === 'function' ? onClose : undefined),
    closeOverlay: (id: unknown) => closeOverlayById(host, String(id)),
    copyTextToClipboard: (text: unknown) => copyText(host, String(text ?? '')),
    fetchCrmObjectProperties: async (properties: unknown) => {
      const list = properties === '*' ? '*' : Array.isArray(properties) ? properties.map(String) : [];
      const real = await liveRecordProperties(host, list);
      if (real) {
        host.log('action', 'actions.fetchCrmObjectProperties (live)', real);
        return real;
      }
      const result = mockRecordProperties(host.getExtension(), list);
      host.log('action', 'actions.fetchCrmObjectProperties (mock)', result);
      return result;
    },
    onCrmPropertiesUpdate: (properties: unknown, callback: unknown) => {
      if (typeof callback !== 'function') return;
      const list = properties === '*' ? '*' : Array.isArray(properties) ? properties.map(String) : [];
      const live = host.getLive?.();
      if (live?.context.crm && list !== '*' && list.length) {
        void liveRecordProperties(host, list)
          .then((real) => {
            if (real && host.isActive()) (callback as (props: Record<string, string | null>) => void)(real);
          })
          .catch(() => {});
        return;
      }
      (callback as (props: Record<string, string | null>) => void)(mockRecordProperties(host.getExtension(), list));
    },
    navigateToPage: (...args: unknown[]) => host.log('action', `actions.navigateToPage(${fmt(args)}) (simulated)`),
  };
  const hubspot = {
    fetch: async (url: unknown, options: PreviewFetchOptions = {}) => {
      const u = String(url);
      const method = (options.method ?? 'GET').toUpperCase();
      host.log('action', `hubspot.fetch ${method} ${u}`, options.body);
      const proxy = proxyOf(host);
      if (proxy) {
        const started = now();
        try {
          const res = await proxy(previewRequestToProxy(u, options ?? {}));
          host.log('info', `Live: ${method} ${u} → ${res.status} — ${elapsedMs(started)} ms`);
          return proxyResponseLike(u, res);
        } catch (e) {
          logProxyFailure(host, method, u, e);
          throw e;
        }
      }
      try {
        const res = await previewFetch(u, options);
        host.log('info', `hubspot.fetch ${u} → ${res.status}`);
        return res;
      } catch (e) {
        logFetchFailure(host, u, e);
        throw e;
      }
    },
    serverless: async (name: unknown, options: { parameters?: unknown; propertiesToSend?: string[] } = {}) => {
      const fn = findFunction(host.getProject(), String(name));
      if (!fn) throw new Error(`App function "${String(name)}" does not exist in this project`);
      return simulateServerless(host, fn, options.parameters, options.propertiesToSend);
    },
  };
  return { actions, hubspot, logger };
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

async function runFetchStep(step: FetchAction, scope: Scope, host: ActionHost): Promise<void> {
  const url = interpolate(step.url ?? '', scope);
  let response: unknown;
  try {
    const method = (step.method ?? 'GET').toUpperCase();
    // Like HubSpot, GET requests carry no body (a hidden, stale body is not evaluated either).
    const body = method !== 'GET' && step.body?.trim() ? evalStrict(host, step, 'body', step.body, scope) : undefined;
    const headers: Record<string, string> = {};
    for (const h of Array.isArray(step.headers) ? step.headers : []) {
      if (h && typeof h.key === 'string' && h.key.trim()) headers[h.key.trim()] = interpolate(h.value ?? '', scope);
    }
    const timeout = typeof step.timeout === 'number' && step.timeout > 0 ? step.timeout : undefined;
    host.log('action', `hubspot.fetch ${method} ${url}`, body);
    const options: PreviewFetchOptions = { method, body, headers, ...(timeout ? { timeout } : {}) };
    const proxy = proxyOf(host);
    if (proxy) {
      // Live data: the connector makes the request server-side (like HubSpot's own proxy).
      const started = now();
      let status: number;
      try {
        const res = await proxy(previewRequestToProxy(url, options));
        status = res.status;
        response = readProxyJson(res);
      } catch (e) {
        if (!host.isActive()) return;
        logProxyFailure(host, method, url, e);
        throw new StepFailure(errorMessage(e), e);
      }
      if (!host.isActive()) return;
      host.log('info', `Live: ${method} ${url} → ${status} — ${elapsedMs(started)} ms`, response);
    } else {
      let res: Response;
      try {
        res = await previewFetch(url, options);
        response = await readJsonResponse(res);
      } catch (e) {
        logFetchFailure(host, url, e);
        throw new StepFailure(errorMessage(e), e);
      }
      if (!host.isActive()) return;
      host.log('info', `Response from ${url} (${res.status})`, response);
    }
    if (step.resultState) setStateChecked(host, step.resultState, response);
    await executeSteps(step.onSuccess ?? [], { ...scope, response }, host);
  } catch (e) {
    if (!host.isActive()) return;
    await executeSteps(step.onError ?? [], { ...scope, error: toError(e) }, host);
  }
}

async function runFunctionStep(step: RunFunctionAction, scope: Scope, host: ActionHost): Promise<void> {
  try {
    const fn = findFunction(host.getProject(), step.functionId);
    if (!fn) {
      const message = `Run app function: function ${step.functionId || '(none selected)'} does not exist`;
      host.log('error', message);
      throw new StepFailure(message, new Error(message));
    }
    const parameters = step.parameters?.trim() ? evalStrict(host, step, 'parameters', step.parameters, scope) : undefined;
    const response = await simulateServerless(host, fn, parameters, step.propertiesToSend);
    if (!host.isActive()) return;
    if (step.resultState) setStateChecked(host, step.resultState, response);
    await executeSteps(step.onSuccess ?? [], { ...scope, response }, host);
  } catch (e) {
    if (!host.isActive()) return;
    await executeSteps(step.onError ?? [], { ...scope, error: toError(e) }, host);
  }
}

function setStateChecked(host: ActionHost, name: string, value: unknown): void {
  if (!host.hasState(name)) {
    host.log('warn', `State variable "${name}" does not exist — value not stored`, value);
    return;
  }
  host.setState(name, value);
  host.log('action', `${name} = ${preview(value)}`);
}

function preview(value: unknown): string {
  const s = typeof value === 'string' ? JSON.stringify(value) : safeJson(value);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** The handler shows an alert of its own after this step (so a preview-only notice would repeat it). */
function alertFollows(rest: readonly ActionStep[]): boolean {
  return rest.some((s) => s.type === 'addAlert');
}

async function executeStep(step: ActionStep, scope: Scope, host: ActionHost, rest: readonly ActionStep[] = []): Promise<void> {
  switch (step.type) {
    case 'setState': {
      const value = evalStrict(host, step, 'value', step.value ?? '', scope);
      setStateChecked(host, step.state, value);
      return;
    }
    case 'addAlert': {
      const alert = {
        type: normalizeAlertType(
          typeof step.alertTypeExpr === 'string' && step.alertTypeExpr.trim()
            ? evalStrict(host, step, 'the alert type', step.alertTypeExpr, scope)
            : step.alertType,
        ),
        title: step.title ? interpolate(step.title, scope) : undefined,
        message: interpolate(step.message ?? '', scope),
      };
      host.log('action', `actions.addAlert(${alert.type})`, alert);
      host.addAlert(alert);
      return;
    }
    case 'refreshObjectProperties':
      simulatedNotice(host, 'Refresh object properties', 'In HubSpot, actions.refreshObjectProperties() refreshes the record’s properties on the page.');
      return;
    case 'reloadPage':
      simulatedNotice(host, 'Reload page', 'In HubSpot, actions.reloadPage() reloads the page.');
      return;
    case 'openIframeModal':
      openIframe(host, {
        uri: interpolate(step.uri ?? '', scope),
        title: interpolate(step.title ?? '', scope),
        width: step.width,
        height: step.height,
        flush: step.flush,
      });
      return;
    case 'closeOverlay':
      closeOverlayById(host, step.overlayNodeId);
      return;
    case 'copyToClipboard':
      await copyText(host, interpolate(step.text ?? '', scope), !alertFollows(rest));
      return;
    case 'runDataSource':
      await host.runDataSource(step.dataSourceId);
      return;
    case 'fetch':
      await runFetchStep(step, scope, host);
      return;
    case 'runFunction':
      await runFunctionStep(step, scope, host);
      return;
    case 'log': {
      const level: LogLevel = (['info', 'warn', 'error', 'debug'] as const).includes(step.level) ? step.level : 'info';
      host.log(level, interpolate(step.message ?? '', scope));
      return;
    }
    case 'if': {
      const cond = evalStrict(host, step, 'condition', step.condition ?? '', scope);
      await executeSteps(cond ? step.then ?? [] : step.else ?? [], scope, host);
      return;
    }
    case 'custom': {
      if (!step.code?.trim()) return;
      const globals = createCustomCodeGlobals(host);
      try {
        await runStatements(step.code, { ...scope, ...globals });
      } catch (e) {
        const message = `Custom code failed — ${errorMessage(e)}`;
        host.log('error', message, e instanceof Error ? e.stack : undefined);
        throw new StepFailure(message, e);
      }
      return;
    }
    default: {
      const unknownStep = step as { type?: unknown };
      host.log('warn', `Unknown action type "${String(unknownStep.type)}" skipped`);
    }
  }
}

/** Runs steps sequentially with the given (snapshot) scope. Throws StepFailure to abort. */
async function executeSteps(steps: ActionStep[], scope: Scope, host: ActionHost): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!host.isActive()) return;
    try {
      await executeStep(step, scope, host, steps.slice(i + 1));
    } catch (e) {
      if (e instanceof StepFailure) throw e;
      // Unexpected failure inside the runtime itself: log and abort like a thrown error would.
      const message = `${describeStep(step)} failed — ${errorMessage(e)}`;
      host.log('error', message);
      throw new StepFailure(message, e);
    }
  }
}

/**
 * Executes a handler's steps against a scope snapshot. Never rejects: failures are logged and
 * abort the remaining steps.
 */
export async function executeActions(steps: ActionStep[], scope: Scope, host: ActionHost): Promise<void> {
  try {
    await executeSteps(steps, scope, host);
  } catch (e) {
    if (!(e instanceof StepFailure)) host.log('error', `Handler failed — ${errorMessage(e)}`);
  }
}
