/**
 * Diagnostics: turns what the connector answers into status-page events (server/core/index.ts calls
 * `observe` once per /api request, after the route answered and before the response goes out).
 *
 *   GET  /api/auth/start      302 to HubSpot → sign-in started (keyed by a hash of the OAuth state)
 *   GET  /api/auth/callback   → that same row becomes signed in / failed (code); without a callback
 *                               for 10 minutes it becomes "never came back" (DiagnosticsLog.sweep)
 *   POST /api/deploy/check-key → key check (ok, or the problem: missing permission, wrong account …)
 *   POST /api/deploy          → publish started (keyed by a hash of the job id), or refused (code)
 *   POST /api/deploy/status   → that same row becomes published / failed (code, where it stopped)
 *   anything else ≥ 400       → API error (route pattern, status, code)
 *
 * Only codes, statuses, route patterns, anonymous visitor ids and HubSpot account ids are kept: the
 * OAuth state and deploy job ids are hashed and never stored, response bodies are read only for
 * their codes and phases. Observing never fails or delays a request noticeably.
 */
import { CONNECTOR_ROUTES, type DeployKeyCheck, type DeployStatus } from '../../../src/connect/types';
import { DIAGNOSTICS_ROUTES, type DiagnosticsSnapshot, type PublishStage } from '../../../src/status/types';
import { ERROR_CODE_HEADER, readBodyText } from '../http';
import { normalizePath } from '../router';
import { sessionSecretUsable } from '../session';
import type { ConfigStatus } from '../config';
import type { Route, ServerConfig, Session } from '../types';
import { DiagnosticsLog, type DiagnosticsLogOptions } from './log';
import { VisitorIds, shortHash } from './visitor';

const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Codes the connector answers before any route runs (security/CSRF checks). */
const REFUSED_EARLY = new Set(['csrf', 'forbidden_origin']);

/** A machine code from anything (null when it doesn't look like one). */
export function safeCode(value: unknown): string | undefined {
  return typeof value === 'string' && CODE_RE.test(value) ? value : undefined;
}

/** The JavaScript error type of an unexpected error (never its message, which can echo input). */
export function errorTypeName(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  return /^[A-Za-z][\w$]{0,40}$/.test(name) ? name : 'Error';
}

export interface DiagnosticsOptions extends Partial<Omit<DiagnosticsLogOptions, 'now'>> {
  now?: () => number;
  /** The Node server: one process keeps the whole log (edge hosts run several instances). */
  singleProcess?: boolean;
}

export interface ObservedExchange {
  request: Request;
  url: URL;
  /** The matched route (null: no such endpoint, wrong method, or answered before routing). */
  route: Route | null;
  params: Record<string, string>;
  response: Response;
  session: Session;
  clientIp?: string;
  /** Body of a deploy status poll, read from a copy of the request (see `wantsRequestBody`). */
  pollBody?: Promise<string>;
  /** Type of an unexpected error thrown while answering (internal_error). */
  errorName?: string;
}

/** Sign-in pages are HTML: their result code is in the page's script (or the error-code header). */
async function authPageCode(response: Response): Promise<string> {
  const header = safeCode(response.headers.get(ERROR_CODE_HEADER));
  if (header) return header;
  if ((response.headers.get('content-type') ?? '').includes('text/html')) {
    try {
      const html = await response.clone().text();
      const m = /"error":"([a-z][a-z0-9_]{0,63})"/.exec(html.slice(0, 64 * 1024));
      if (m) return m[1];
    } catch {
      /* fall through */
    }
  }
  switch (response.status) {
    case 429:
      return 'rate_limited';
    case 503:
      return 'not_configured';
    case 403:
      return 'portal_not_allowed';
    case 502:
      return 'hubspot_unreachable';
    default:
      return 'oauth_error';
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  if (!/[/+]json\b/i.test(response.headers.get('content-type') ?? '')) return null;
  try {
    const text = await response.clone().text();
    if (text.length > 512 * 1024) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function errorCodeOf(response: Response): Promise<string> {
  const header = safeCode(response.headers.get(ERROR_CODE_HEADER));
  if (header) return header;
  const body = await readJson<{ error?: { code?: unknown } }>(response);
  return safeCode(body?.error?.code) ?? `http_${response.status}`;
}

/** Where a failed publish stopped: from its code, else the last phase seen. */
export function publishStage(lastPhase: string | undefined, code: string | undefined): PublishStage {
  switch (code) {
    case 'build_failed':
      return 'build';
    case 'deploy_failed':
    case 'deploy_blocked':
    case 'autodeploy_missing':
      return 'deploy';
    default:
      break;
  }
  switch (lastPhase) {
    case 'queued':
    case 'authenticating':
    case 'uploading':
      return 'upload';
    case 'deploying':
      return 'deploy';
    default:
      return 'build';
  }
}

export class Diagnostics {
  readonly log: DiagnosticsLog;
  readonly visitors: VisitorIds;
  readonly singleProcess: boolean;
  private readonly now: () => number;
  private started = false;

  constructor(opts: DiagnosticsOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.log = new DiagnosticsLog({ now: this.now, capacity: opts.capacity, clientCapacity: opts.clientCapacity, abandonAfterMs: opts.abandonAfterMs, emit: opts.emit });
    this.visitors = new VisitorIds(this.now);
    this.singleProcess = opts.singleProcess ?? false;
  }

  /** Records that the connector started (once): the log begins here. */
  serverStarted(config: Pick<ServerConfig, 'version' | 'buildCommit'>): void {
    if (this.started) return;
    this.started = true;
    this.log.record({ kind: 'server.started', outcome: 'info', version: config.buildCommit ? `${config.version} (${config.buildCommit})` : config.version });
  }

  visitorId(clientIp: string | undefined): Promise<string> {
    return this.visitors.id(clientIp);
  }

  /** The requests whose body `observe` needs (deploy status polls carry the job id in the body). */
  static wantsRequestBody(method: string, pathname: string): boolean {
    return method.toUpperCase() === 'POST' && normalizePath(pathname) === CONNECTOR_ROUTES.deployPoll;
  }

  /** Reads such a body from a copy of the request (the route reads the original). */
  static peekBody(request: Request): Promise<string> {
    try {
      return readBodyText(request.clone(), 32 * 1024).catch(() => '');
    } catch {
      return Promise.resolve('');
    }
  }

  /** Records what this request means for the status page. Never throws. */
  async observe(x: ObservedExchange): Promise<void> {
    try {
      await this.observeUnsafe(x);
    } catch {
      /* diagnostics never break a request */
    }
  }

  private async observeUnsafe(x: ObservedExchange): Promise<void> {
    const method = x.request.method.toUpperCase();
    if (method === 'OPTIONS') return;
    this.log.sweep();
    const path = x.route?.path;
    const status = x.response.status;
    // Browser reports record their own events (and are what a misbehaving page would repeat).
    if (path === DIAGNOSTICS_ROUTES.report) return;
    // Refused before the route ran (another website, a request without the builder's header):
    // whatever it asked for, it is a refused request, not a sign-in or publish attempt.
    if (status === 403 && REFUSED_EARLY.has(x.response.headers.get(ERROR_CODE_HEADER) ?? '')) return this.onApiError(x);
    if (path === CONNECTOR_ROUTES.authStart) return this.onAuthStart(x);
    if (path === CONNECTOR_ROUTES.authCallback) return this.onAuthCallback(x);
    if (path === CONNECTOR_ROUTES.deployCheckKey && method === 'POST') return this.onKeyCheck(x);
    if (path === CONNECTOR_ROUTES.deployStart && method === 'POST') return this.onDeployStart(x);
    const poll = (path === CONNECTOR_ROUTES.deployPoll && method === 'POST') || (path === CONNECTOR_ROUTES.deployStatus && method === 'GET');
    if (poll && status < 400) return this.onDeployPoll(x);
    if (status >= 400) return this.onApiError(x);
  }

  private async portalOf(x: ObservedExchange): Promise<number | undefined> {
    try {
      return (await x.session.get())?.portalId;
    } catch {
      return undefined;
    }
  }

  private async onAuthStart(x: ObservedExchange): Promise<void> {
    const visitor = await this.visitorId(x.clientIp);
    const location = x.response.headers.get('location');
    if (x.response.status >= 300 && x.response.status < 400 && location) {
      let state = '';
      try {
        state = new URL(location).searchParams.get('state') ?? '';
      } catch {
        state = '';
      }
      if (state) {
        const mode = x.url.searchParams.get('mode') === 'redirect' ? 'redirect' : 'popup';
        this.log.signInStarted(await shortHash(`state:${state}`), { visitor, mode });
        return;
      }
    }
    this.log.record({ kind: 'signin.failed', outcome: 'failed', code: await authPageCode(x.response), status: x.response.status, visitor, route: 'GET /api/auth/start' });
  }

  private async onAuthCallback(x: ObservedExchange): Promise<void> {
    const state = x.url.searchParams.get('state') ?? '';
    const pending = state && state.length <= 512 ? this.log.takeSignIn(await shortHash(`state:${state}`)) : undefined;
    const visitor = pending?.visitor ?? (await this.visitorId(x.clientIp));
    const res = x.response;
    let ok = false;
    let code: string | undefined;
    if (res.status >= 300 && res.status < 400) {
      // Full-page sign-in: the result is in the return address (?uiex_auth=connected|<code>).
      let result: string | null = null;
      try {
        result = new URL(res.headers.get('location') ?? '').searchParams.get('uiex_auth');
      } catch {
        result = null;
      }
      ok = result === 'connected';
      if (!ok) code = safeCode(result) ?? 'oauth_error';
    } else if (res.status === 200) {
      ok = true;
    } else {
      code = await authPageCode(res);
    }
    if (ok) {
      this.log.finishSignIn(pending, { kind: 'signin.completed', outcome: 'ok', portalId: await this.portalOf(x), visitor });
    } else {
      this.log.finishSignIn(pending, { kind: 'signin.failed', outcome: 'failed', code, status: res.status, visitor });
    }
  }

  private async onKeyCheck(x: ObservedExchange): Promise<void> {
    const visitor = await this.visitorId(x.clientIp);
    if (x.response.status === 200) {
      const body = await readJson<DeployKeyCheck>(x.response);
      if (body && typeof body.ok === 'boolean') {
        const dp = body.key?.developerProjects;
        this.log.record({
          kind: 'publish.key_check',
          outcome: body.ok ? 'ok' : 'failed',
          code: body.ok ? undefined : (safeCode(body.problem) ?? 'key_problem'),
          stage: 'key_check',
          visitor,
          portalId: typeof body.target?.portalId === 'number' ? body.target.portalId : typeof body.key?.portalId === 'number' ? body.key.portalId : undefined,
          developerProjects: dp === 'yes' || dp === 'no' || dp === 'unknown' ? dp : undefined,
        });
        return;
      }
    }
    this.log.record({
      kind: 'publish.key_check',
      outcome: 'failed',
      code: await errorCodeOf(x.response),
      status: x.response.status,
      stage: 'key_check',
      visitor,
      portalId: await this.portalOf(x),
    });
  }

  private async onDeployStart(x: ObservedExchange): Promise<void> {
    const visitor = await this.visitorId(x.clientIp);
    if (x.response.status === 200) {
      const s = await readJson<DeployStatus>(x.response);
      if (s && typeof s.deployId === 'string' && typeof s.phase === 'string') {
        const portalId = typeof s.portalId === 'number' ? s.portalId : await this.portalOf(x);
        if (s.phase === 'failed') {
          this.log.record({ kind: 'publish.failed', outcome: 'failed', code: safeCode(s.error) ?? 'deploy_failed', stage: 'upload', visitor, portalId });
        } else if (s.phase === 'success') {
          this.log.record({ kind: 'publish.succeeded', outcome: 'ok', stage: 'deploy', visitor, portalId, buildId: typeof s.buildId === 'number' ? s.buildId : undefined });
        } else {
          this.log.publishStarted(await shortHash(`deploy:${s.deployId}`), { visitor, portalId, phase: s.phase });
        }
        return;
      }
    }
    this.log.record({
      kind: 'publish.failed',
      outcome: 'failed',
      code: await errorCodeOf(x.response),
      status: x.response.status,
      stage: 'upload',
      visitor,
      portalId: await this.portalOf(x),
      route: 'POST /api/deploy',
    });
  }

  private async onDeployPoll(x: ObservedExchange): Promise<void> {
    let requestId = '';
    if (x.request.method.toUpperCase() === 'POST') {
      try {
        const body = JSON.parse((await x.pollBody) ?? '') as { deployId?: unknown };
        requestId = typeof body?.deployId === 'string' ? body.deployId : '';
      } catch {
        requestId = '';
      }
    } else {
      requestId = x.params.deployId ?? '';
    }
    const s = await readJson<DeployStatus>(x.response);
    if (!s || typeof s.deployId !== 'string' || typeof s.phase !== 'string') return;
    const fromKey = requestId ? await shortHash(`deploy:${requestId}`) : '';
    const toKey = await shortHash(`deploy:${s.deployId}`);
    const job = fromKey ? this.log.takeJob(fromKey) : undefined;
    const portalId = typeof s.portalId === 'number' ? s.portalId : job?.portalId;
    const buildId = typeof s.buildId === 'number' ? s.buildId : undefined;

    if (s.phase === 'success' || s.phase === 'failed') {
      // A finished job answers the same way every time it is asked: record it once.
      if (!this.log.markFinished(toKey)) return;
      const durationMs = job ? Math.max(0, this.now() - job.at) : undefined;
      const patch =
        s.phase === 'success'
          ? { kind: 'publish.succeeded' as const, outcome: 'ok' as const, stage: 'deploy' as const, code: undefined, portalId, buildId, durationMs }
          : (() => {
              const code = safeCode(s.error) ?? 'deploy_failed';
              return { kind: 'publish.failed' as const, outcome: 'failed' as const, code, stage: publishStage(job?.phase, code), portalId, buildId, durationMs };
            })();
      if (job && this.log.update(job.eventId, patch)) return;
      this.log.record({ ...patch, visitor: job?.visitor ?? (await this.visitorId(x.clientIp)) });
      return;
    }
    if (job) {
      this.log.keepJob(toKey, job, s.phase);
      // The old id stays known for a moment (a retried poll may still use it).
      if (fromKey !== toKey) this.log.keepJob(fromKey, job, s.phase);
      return;
    }
    // A publish this server didn't see starting (it restarted meanwhile): follow it from here.
    this.log.publishStarted(toKey, { visitor: await this.visitorId(x.clientIp), portalId, phase: s.phase });
  }

  private async onApiError(x: ObservedExchange): Promise<void> {
    const method = x.request.method.toUpperCase();
    const status = x.response.status;
    const code = await errorCodeOf(x.response);
    let route: string;
    if (x.route) route = `${method} ${x.route.path}`;
    else if (code === 'feature_disabled') route = `${method} /api/deploy`;
    else route = `${method} (unknown address)`;
    this.log.record({
      kind: 'api.error',
      outcome: status >= 500 ? 'failed' : 'warning',
      code,
      status,
      route,
      visitor: await this.visitorId(x.clientIp),
      portalId: await this.portalOf(x),
      errorName: x.errorName,
    });
  }

  /** Everything the status page shows. */
  snapshot(info: { config: ServerConfig; status: ConfigStatus; you?: string }): DiagnosticsSnapshot {
    const { config, status } = info;
    this.log.sweep();
    return {
      now: this.now(),
      server: {
        startedAt: this.log.startedAt,
        version: config.version,
        commit: config.buildCommit,
        singleProcess: this.singleProcess,
        signInConfigured: status.oauthConfigured,
        missingSettings: status.missing.map((m) => m.name),
        deployEnabled: config.enableDeploy && sessionSecretUsable(config),
        allowedPortals: [...(config.allowedPortals ?? [])],
        adminEmailCount: config.adminEmails?.length ?? 0,
        adminPortals: [...(config.adminPortals ?? [])],
      },
      capacity: { max: this.log.capacity + this.log.clientCapacity, kept: this.log.size, dropped: this.log.dropped },
      abandonAfterMs: this.log.abandonAfterMs,
      summary: { lastHour: this.log.counters(60 * 60_000), lastDay: this.log.counters(24 * 60 * 60_000) },
      inProgress: { signIns: this.log.pendingSignIns, publishes: this.log.pendingPublishes },
      you: info.you,
      events: this.log.list(),
    };
  }
}
