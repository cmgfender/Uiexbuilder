/**
 * Reports errors in the builder to the host's private status page (POST /api/diagnostics/report).
 *
 * - Only when a connector is present: never on static hosting (`VITE_CONNECTOR_URL=none`), and
 *   only once the connector answered (`useConnection` health); earlier errors wait in a small queue.
 * - Listens to window `error` and `unhandledrejection`; the editor's error boundary can call
 *   `reportReactError` (it then also sends the component stack).
 * - Deduplicated (each distinct error once per page load) and throttled (a burst of 3, then one
 *   every 20 seconds, at most 15 per page load).
 * - Skips noise and errors that aren't the builder's: browser extensions, cross-origin "Script
 *   error.", ResizeObserver warnings, cancelled requests, and the person's own card code running in
 *   the preview (compiled with `new Function`).
 * - Cleans before sending: no query strings or fragments in URLs, no email addresses, short
 *   messages and stacks. The server cleans again (it never trusts what browsers send).
 *
 * Also `reportSignInFeedback`: what the HubSpot sign-in window showed, when it never came back.
 */
import { CONNECTOR_ROUTES, CSRF_HEADER } from '../connect/types';
import { getConnectorClient } from '../connect/client';
import { useConnection } from '../connect/store';
import { postReport } from './api';
import type { ClientErrorReport, ClientErrorSource, ClientReport, SignInFeedbackKind } from './types';

export const REPORTER_LIMITS = {
  /** Reports sent at once before throttling. */
  burst: 3,
  /** One more report allowed every … */
  refillMs: 20_000,
  /** Reports per page load. */
  perPage: 15,
  /** Errors kept while waiting to learn whether a connector is there. */
  queue: 5,
  message: 300,
  stack: 1500,
  stackLines: 12,
} as const;

/** "https://x/a.js?v=1:2:3" → "https://x/a.js:2:3"; "/api/x?q=ada" → "/api/x"; emails masked. */
export function cleanReportText(text: string, max: number): string {
  const cleaned = text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"()<>]*)[?#][^\s'"()<>]*?(?=(?::\d+){1,2}(?:[\s)'"]|$)|[\s'"()<>]|$)/gi, '$1')
    .replace(/((?:^|[\s('"])\/[\w\-./%~]*)\?[^\s'"()<>]*/g, '$1')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function cleanStack(stack: string): string {
  const lines = stack.split(/\r?\n/).filter((l) => l.trim()).slice(0, REPORTER_LIMITS.stackLines);
  return cleanReportText(lines.join('\n'), REPORTER_LIMITS.stack);
}

/** The build of the running builder: the hash in its main script's file name ("dev" in development). */
export function currentBuild(moduleUrl: string = import.meta.url): string {
  try {
    const m = /\/assets\/[^/]*?-([A-Za-z0-9_-]{6,})\.js$/.exec(new URL(moduleUrl).pathname);
    if (m) return m[1];
  } catch {
    /* fall through */
  }
  return 'dev';
}

interface ErrorParts {
  name?: string;
  message: string;
  stack?: string;
}

function partsOf(error: unknown): ErrorParts | null {
  if (error instanceof Error || (error && typeof error === 'object' && 'message' in error)) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    const message = typeof e.message === 'string' ? e.message : String(e.message ?? '');
    return { name: typeof e.name === 'string' ? e.name : undefined, message, stack: typeof e.stack === 'string' ? e.stack : undefined };
  }
  if (typeof error === 'string') return { message: error };
  if (error === undefined || error === null) return null;
  try {
    return { message: JSON.stringify(error)?.slice(0, 200) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

/**
 * The first stack frame: "at fn (url:1:2)" in Chrome, "fn@url:1:2" in Firefox and Safari. The
 * "Name: message" line of V8 stacks is skipped even when the message contains an "@".
 */
export function firstFrame(stack: string | undefined): string {
  if (!stack) return '';
  const lines = stack.split('\n').map((l) => l.trim());
  return lines.find((l) => /^at\s/.test(l) || /^[^\s@]*@(?:[a-z][\w+.-]*:\/\/|\s*$)/i.test(l)) ?? '';
}

/** Errors that aren't the builder's, or carry nothing useful. */
export function isNoise(parts: ErrorParts, filename?: string): boolean {
  const { name, message, stack } = parts;
  if (!message.trim() && !stack) return true;
  if (name === 'AbortError' || /\bAbortError\b|The (?:user|operation) aborted|request was cancelled/i.test(message)) return true;
  if (/^ResizeObserver loop/i.test(message)) return true;
  if (/^Script error\.?$/i.test(message.trim()) && !stack) return true;
  const where = `${filename ?? ''}\n${stack ?? ''}`;
  if (/(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:\/\//i.test(where)) return true;
  // The person's own card code (expressions, custom code, helpers) runs through `new Function`:
  // its errors are shown in the preview and the Console, and aren't the builder's.
  const top = firstFrame(stack);
  if (/\beval at\b|> (?:Function|eval)\b|^(?:at )?(?:eval|anonymous) ?\(?<anonymous>|Function code/i.test(top)) return true;
  return false;
}

export interface ErrorReporterOptions {
  send: (report: ClientReport) => Promise<unknown> | unknown;
  /** Whether a connector is there: 'yes' (send), 'no' (drop), 'unknown' (queue). */
  ready: () => 'yes' | 'no' | 'unknown';
  now?: () => number;
  build?: string;
  path?: () => string;
}

export interface ErrorReporter {
  /** Reports an error; returns true when it was sent or queued. */
  report(error: unknown, source: ClientErrorSource, extra?: { filename?: string; componentStack?: string | null }): boolean;
  /** Sends queued errors once the connector is known to be there (drops them when it isn't). */
  flush(): void;
  /** Reports sent so far. */
  readonly sent: number;
}

export function createErrorReporter(opts: ErrorReporterOptions): ErrorReporter {
  const now = opts.now ?? (() => Date.now());
  const seen = new Set<string>();
  const queue: ClientErrorReport[] = [];
  let tokens: number = REPORTER_LIMITS.burst;
  let refilled = now();
  let sent = 0;

  const take = (): boolean => {
    const t = now();
    tokens = Math.min(REPORTER_LIMITS.burst, tokens + (t - refilled) / REPORTER_LIMITS.refillMs);
    refilled = t;
    if (tokens < 1 || sent >= REPORTER_LIMITS.perPage) return false;
    tokens -= 1;
    return true;
  };

  const deliver = (r: ClientErrorReport) => {
    if (!take()) return;
    sent += 1;
    try {
      void Promise.resolve(opts.send(r)).catch(() => {});
    } catch {
      /* best effort */
    }
  };

  const flush = () => {
    const state = opts.ready();
    if (state === 'unknown') return;
    const pending = queue.splice(0);
    if (state === 'yes') for (const r of pending) deliver(r);
  };

  return {
    get sent() {
      return sent;
    },
    flush,
    report(error, source, extra = {}) {
      try {
        const parts = partsOf(error);
        if (!parts || isNoise(parts, extra.filename)) return false;
        const signature = `${parts.name ?? ''}|${parts.message.slice(0, 200)}|${firstFrame(parts.stack)}`;
        if (seen.has(signature)) return false;
        seen.add(signature);
        let stack = parts.stack;
        if (extra.componentStack) {
          const components = extra.componentStack.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6).join('\n');
          stack = `${stack ?? ''}\nComponents:\n${components}`.trim();
        }
        const report: ClientErrorReport = {
          type: 'client_error',
          source,
          message: cleanReportText(parts.message || parts.name || 'Unknown error', REPORTER_LIMITS.message),
        };
        if (parts.name && /^[A-Za-z][\w$.]{0,59}$/.test(parts.name)) report.name = parts.name;
        if (stack) report.stack = cleanStack(stack);
        const path = opts.path?.();
        if (path) report.path = path.split(/[?#]/)[0].slice(0, 120);
        if (opts.build) report.build = opts.build;
        const state = opts.ready();
        if (state === 'no') return false;
        if (state === 'unknown') {
          if (queue.length >= REPORTER_LIMITS.queue) return false;
          queue.push(report);
          return true;
        }
        deliver(report);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Our own answer to "is there a connector?" when the connection store hasn't checked yet. */
let probed: 'yes' | 'no' | 'unknown' = 'unknown';
let probing = false;

/** One GET /api/health (the editor may crash, or show its recovery screen, before it checks). */
function probeConnector(onDone: () => void): void {
  if (probing || probed !== 'unknown') return;
  probing = true;
  const client = getConnectorClient();
  fetch(client.url(CONNECTOR_ROUTES.health), { credentials: 'include', cache: 'no-store', headers: { [CSRF_HEADER]: '1', Accept: 'application/json' } })
    .then(async (res) => {
      const body = /[/+]json\b/i.test(res.headers.get('content-type') ?? '') ? ((await res.json()) as { ok?: unknown }) : null;
      probed = res.ok && body?.ok === true ? 'yes' : 'no';
    })
    .catch(() => {
      probed = 'no';
    })
    .finally(() => {
      probing = false;
      onDone();
    });
}

/** Whether the connector answered (the connection store knows after its startup check). */
function connectorReady(): 'yes' | 'no' | 'unknown' {
  const { status, health } = useConnection.getState();
  if (status !== 'checking') return health ? 'yes' : 'no';
  return probed;
}

let installed: ErrorReporter | null = null;

/** Installs the window listeners once (src/main.tsx). Does nothing without a connector. */
export function installErrorReporter(): ErrorReporter | null {
  if (installed || typeof window === 'undefined') return installed;
  if (getConnectorClient().disabled) return null;
  const reporter = createErrorReporter({
    send: (r) => postReport(r),
    ready: connectorReady,
    build: currentBuild(),
    path: () => window.location.pathname,
  });
  const flushLater = () => probeConnector(() => reporter.flush());
  window.addEventListener('error', (e: ErrorEvent) => {
    if (reporter.report(e.error ?? e.message, 'error', { filename: e.filename }) && connectorReady() === 'unknown') flushLater();
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (reporter.report(e.reason, 'unhandledrejection') && connectorReady() === 'unknown') flushLater();
  });
  useConnection.subscribe(() => reporter.flush());
  installed = reporter;
  return reporter;
}

/** For error boundaries (componentDidCatch): reports a crash with its component stack. */
export function reportReactError(error: unknown, componentStack?: string | null): void {
  const reporter = installed;
  if (reporter?.report(error, 'react', { componentStack }) && connectorReady() === 'unknown') probeConnector(() => reporter.flush());
}

const lastFeedback = new Map<SignInFeedbackKind, number>();

/**
 * Tells the host what the HubSpot sign-in window showed (or how it ended) when it never came back
 * — the status page then shows it instead of a bare "never came back". Best effort, at most once
 * per answer every 10 seconds.
 */
export function reportSignInFeedback(kind: SignInFeedbackKind): void {
  if (getConnectorClient().disabled || connectorReady() !== 'yes') return;
  const t = Date.now();
  if (t - (lastFeedback.get(kind) ?? 0) < 10_000) return;
  lastFeedback.set(kind, t);
  void postReport({ type: 'signin_feedback', kind });
}

/** Test helper. */
export function resetErrorReporterForTests(): void {
  installed = null;
  probed = 'unknown';
  probing = false;
  lastFeedback.clear();
}
