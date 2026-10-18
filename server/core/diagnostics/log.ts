/**
 * The status page's memory: a size-capped ring buffer of recent events plus per-minute counters
 * for the last 24 hours. No database: everything is lost when the server restarts, redeploys or
 * (free hosting) goes to sleep — the status page says so.
 *
 * - One row per attempt: a sign-in or publish is recorded when it starts and that same row is
 *   updated when it ends (signed in / failed / never came back; published / failed).
 * - Identical problems from the same visitor within 10 minutes are merged into one row with a
 *   count ("refused 4 times"), so one busy visitor can't push everything else out.
 * - Every event (and every update) is also written as one JSON log line starting with `[event]`,
 *   so the host's own logs stay searchable after a restart.
 *
 * Nothing sensitive goes in: callers pass codes, statuses, route patterns, anonymous visitor ids
 * and HubSpot account ids only (see src/status/types.ts).
 */
import type { DiagnosticCounters, DiagnosticEvent, DiagnosticKind, DiagnosticOutcome, SignInFeedbackKind } from '../../../src/status/types';

export const DIAGNOSTICS_DEFAULTS = {
  /** Events kept. */
  capacity: 600,
  /** A sign-in without a callback after this long is "abandoned" (the OAuth state cookie lives 10 minutes). */
  abandonAfterMs: 10 * 60_000,
  /** Identical problems closer together than this are merged. */
  mergeWindowMs: 10 * 60_000,
  /** A publish nobody asked about for this long is no longer followed. */
  publishIdleMs: 30 * 60_000,
  /** Counters are kept this long. */
  countersMs: 24 * 60 * 60_000,
} as const;

/** What a caller records (id, count and timestamps are filled in). */
export type EventInput = Omit<DiagnosticEvent, 'id' | 'at' | 'lastAt' | 'count'> & { at?: number };

/** Kinds whose identical repeats are merged. */
const MERGEABLE = new Set<DiagnosticKind>(['api.error', 'client.error', 'publish.failed', 'publish.key_check', 'signin.failed', 'signin.feedback']);

/** Feedback that only says how the window ended (a later, more specific answer replaces it). */
const VAGUE_FEEDBACK = new Set<SignInFeedbackKind>(['popup_closed', 'timeout', 'nothing']);

export function emptyCounters(): DiagnosticCounters {
  return {
    signInStarted: 0,
    signInCompleted: 0,
    signInFailed: 0,
    signInAbandoned: 0,
    publishStarted: 0,
    publishSucceeded: 0,
    publishFailed: 0,
    keyCheckProblems: 0,
    apiErrors: 0,
    serverErrors: 0,
    clientErrors: 0,
  };
}

function addCount(c: DiagnosticCounters, e: Pick<DiagnosticEvent, 'kind' | 'outcome' | 'status'>, n: number): void {
  switch (e.kind) {
    case 'signin.started':
      c.signInStarted += n;
      break;
    case 'signin.completed':
      c.signInCompleted += n;
      break;
    case 'signin.failed':
      c.signInFailed += n;
      break;
    case 'signin.abandoned':
      c.signInAbandoned += n;
      break;
    case 'publish.started':
      if (e.outcome === 'pending') c.publishStarted += n;
      break;
    case 'publish.succeeded':
      c.publishSucceeded += n;
      break;
    case 'publish.failed':
      c.publishFailed += n;
      break;
    case 'publish.key_check':
      if (e.outcome === 'failed') c.keyCheckProblems += n;
      break;
    case 'api.error':
      c.apiErrors += n;
      if ((e.status ?? 0) >= 500) c.serverErrors += n;
      break;
    case 'client.error':
      c.clientErrors += n;
      break;
    default:
      break;
  }
}

function mergeKey(e: Omit<DiagnosticEvent, 'id' | 'at' | 'lastAt' | 'count'>): string {
  return JSON.stringify([e.kind, e.outcome, e.code, e.status, e.route, e.stage, e.visitor, e.portalId, e.feedback, e.developerProjects, e.client?.source, e.client?.message, e.errorName]);
}

/** The `[event]` log line for an event (no stack traces: the status page has them). */
export function eventLogLine(e: DiagnosticEvent, update = false): string {
  const line: Record<string, unknown> = { at: new Date(e.lastAt).toISOString(), kind: e.kind, outcome: e.outcome };
  if (update) line.update = true;
  if (e.count > 1) line.repeat = e.count;
  for (const key of ['code', 'status', 'route', 'stage', 'durationMs', 'mode', 'visitor', 'portalId', 'buildId', 'developerProjects', 'feedback', 'errorName', 'version'] as const) {
    if (e[key] !== undefined) line[key] = e[key];
  }
  if (e.client) {
    line.client = { source: e.client.source, name: e.client.name, message: e.client.message.slice(0, 200), path: e.client.path, build: e.client.build };
  }
  return `[event] ${JSON.stringify(line)}`;
}

interface PendingSignIn {
  eventId: number;
  at: number;
  visitor?: string;
  mode?: 'popup' | 'redirect';
  feedback?: SignInFeedbackKind;
  /** Concluded as abandoned (kept a while so a late callback still finds its row). */
  concludedAt?: number;
}

export interface PublishJob {
  eventId: number;
  at: number;
  updatedAt: number;
  visitor?: string;
  portalId?: number;
  /** Last DeployPhase seen ('building', 'deploying' …). */
  phase: string;
}

export interface DiagnosticsLogOptions {
  now: () => number;
  capacity?: number;
  abandonAfterMs?: number;
  /** Where `[event]` lines go (null: nowhere). */
  emit?: ((line: string) => void) | null;
}

export class DiagnosticsLog {
  readonly startedAt: number;
  readonly capacity: number;
  readonly abandonAfterMs: number;
  /** Events dropped because the buffer was full. */
  dropped = 0;
  private readonly now: () => number;
  private readonly emit: ((line: string) => void) | null;
  /** Oldest first; an updated event moves to the end. */
  private events: DiagnosticEvent[] = [];
  private byId = new Map<number, DiagnosticEvent>();
  private seq = 0;
  private minutes = new Map<number, DiagnosticCounters>();
  private signIns = new Map<string, PendingSignIn>();
  private jobs = new Map<string, PublishJob>();
  private finished: string[] = [];
  private finishedSet = new Set<string>();

  constructor(opts: DiagnosticsLogOptions) {
    this.now = opts.now;
    this.capacity = Math.max(10, opts.capacity ?? DIAGNOSTICS_DEFAULTS.capacity);
    this.abandonAfterMs = opts.abandonAfterMs ?? DIAGNOSTICS_DEFAULTS.abandonAfterMs;
    this.emit = opts.emit ?? null;
    this.startedAt = this.now();
  }

  // ------------------------------------------------------------------ events

  private log(e: DiagnosticEvent, update: boolean): void {
    if (!this.emit) return;
    try {
      this.emit(eventLogLine(e, update));
    } catch {
      /* logging never breaks a request */
    }
  }

  private count(e: Pick<DiagnosticEvent, 'kind' | 'outcome' | 'status'>, at: number, n = 1): void {
    const minute = Math.floor(at / 60_000);
    let c = this.minutes.get(minute);
    if (!c) {
      c = emptyCounters();
      this.minutes.set(minute, c);
      this.pruneCounters();
    }
    addCount(c, e, n);
  }

  private pruneCounters(): void {
    const oldest = Math.floor((this.now() - DIAGNOSTICS_DEFAULTS.countersMs) / 60_000) - 1;
    for (const minute of this.minutes.keys()) if (minute < oldest) this.minutes.delete(minute);
  }

  private touch(e: DiagnosticEvent): void {
    const i = this.events.indexOf(e);
    if (i >= 0 && i !== this.events.length - 1) {
      this.events.splice(i, 1);
      this.events.push(e);
    }
  }

  /** Records an event (merged into an identical recent one when it is a repeat). */
  record(input: EventInput): DiagnosticEvent {
    const at = input.at ?? this.now();
    const fields: EventInput = { ...input };
    delete fields.at;
    if (MERGEABLE.has(fields.kind)) {
      const key = mergeKey(fields);
      for (let i = this.events.length - 1, seen = 0; i >= 0 && seen < 50; i--, seen++) {
        const e = this.events[i];
        if (at - e.lastAt > DIAGNOSTICS_DEFAULTS.mergeWindowMs) break;
        if (mergeKey(e) !== key) continue;
        e.count += 1;
        e.lastAt = Math.max(e.lastAt, at);
        if (fields.durationMs !== undefined) e.durationMs = fields.durationMs;
        if (fields.client?.stack && !e.client?.stack && e.client) e.client.stack = fields.client.stack;
        this.touch(e);
        this.count(e, at);
        this.log(e, false);
        return e;
      }
    }
    const event: DiagnosticEvent = { id: ++this.seq, ...fields, at, lastAt: at, count: 1 };
    this.events.push(event);
    this.byId.set(event.id, event);
    while (this.events.length > this.capacity) {
      const old = this.events.shift()!;
      this.byId.delete(old.id);
      this.dropped += 1;
    }
    this.count(event, at);
    this.log(event, false);
    return event;
  }

  /**
   * Updates a recorded event in place (a sign-in or publish that ended). Counts it again only when
   * its kind or outcome changes.
   * Returns null when the event is no longer kept (then callers record a new one).
   */
  update(id: number, patch: Partial<Omit<DiagnosticEvent, 'id' | 'at' | 'count'>> & { kind: DiagnosticKind; outcome: DiagnosticOutcome }, at = this.now()): DiagnosticEvent | null {
    const e = this.byId.get(id);
    if (!e) return null;
    const changed = e.kind !== patch.kind || e.outcome !== patch.outcome;
    Object.assign(e, patch);
    e.lastAt = Math.max(e.lastAt, at);
    this.touch(e);
    // Counted once per state: refining a row (e.g. adding what the visitor said) isn't a new event.
    if (changed) this.count(e, at);
    this.log(e, true);
    return e;
  }

  get(id: number): DiagnosticEvent | undefined {
    return this.byId.get(id);
  }

  /** Newest first (by last update). */
  list(): DiagnosticEvent[] {
    return [...this.events].sort((a, b) => b.lastAt - a.lastAt || b.id - a.id).map((e) => ({ ...e, client: e.client ? { ...e.client } : undefined }));
  }

  get size(): number {
    return this.events.length;
  }

  /** Counters for events in the last `ms` milliseconds (minute resolution). */
  counters(ms: number): DiagnosticCounters {
    const from = Math.floor((this.now() - ms) / 60_000);
    const out = emptyCounters();
    for (const [minute, c] of this.minutes) {
      if (minute < from) continue;
      for (const k of Object.keys(out) as Array<keyof DiagnosticCounters>) out[k] += c[k];
    }
    return out;
  }

  // ------------------------------------------------------------------ sign-ins

  /** The sign-in window opened (`key`: a hash of the OAuth state, which the callback brings back). */
  signInStarted(key: string, input: { visitor?: string; mode?: 'popup' | 'redirect' }): DiagnosticEvent {
    const event = this.record({ kind: 'signin.started', outcome: 'pending', visitor: input.visitor, mode: input.mode });
    this.signIns.set(key, { eventId: event.id, at: event.lastAt, visitor: input.visitor, mode: input.mode });
    return event;
  }

  /** The sign-in this callback belongs to (removed), if it was seen starting. */
  takeSignIn(key: string): PendingSignIn | undefined {
    const pending = this.signIns.get(key);
    if (pending) this.signIns.delete(key);
    return pending;
  }

  /** Ends a sign-in: updates its row, or records a new one when the start wasn't seen. */
  finishSignIn(
    pending: PendingSignIn | undefined,
    result: { kind: 'signin.completed' | 'signin.failed'; outcome: 'ok' | 'failed'; code?: string; status?: number; portalId?: number; visitor?: string },
  ): DiagnosticEvent {
    const at = this.now();
    const durationMs = pending ? Math.max(0, at - pending.at) : undefined;
    if (pending) {
      const updated = this.update(pending.eventId, { ...result, visitor: pending.visitor ?? result.visitor, durationMs }, at);
      if (updated) return updated;
    }
    return this.record({ ...result, durationMs, mode: pending?.mode });
  }

  /** Concludes sign-ins that never came back (call often; it is cheap). */
  sweep(): void {
    const now = this.now();
    for (const [key, p] of this.signIns) {
      if (p.concludedAt !== undefined) {
        if (now - p.concludedAt > this.abandonAfterMs) this.signIns.delete(key);
        continue;
      }
      if (now - p.at < this.abandonAfterMs) continue;
      this.signIns.delete(key);
      this.abandon(p, p.at + this.abandonAfterMs, this.abandonAfterMs);
    }
    for (const [key, job] of this.jobs) {
      if (now - job.updatedAt < DIAGNOSTICS_DEFAULTS.publishIdleMs || !this.jobs.has(key)) continue;
      this.takeJob(key);
      // Nobody followed it to the end (the browser was closed): HubSpot may still have finished it.
      this.update(job.eventId, { kind: 'publish.started', outcome: 'warning', code: 'not_followed' }, job.updatedAt + DIAGNOSTICS_DEFAULTS.publishIdleMs);
    }
  }

  private abandon(p: PendingSignIn, at: number, durationMs: number | undefined): void {
    const patch = { kind: 'signin.abandoned' as const, outcome: 'warning' as const, durationMs, feedback: p.feedback };
    if (!this.update(p.eventId, patch, at)) this.record({ ...patch, at, visitor: p.visitor, mode: p.mode });
  }

  /**
   * A visitor's browser said how the sign-in window ended or what it showed. Their sign-in still in
   * progress ends now as "never came back" with that answer; an answer about a sign-in that already
   * ended refines it; anything else is recorded as feedback on its own.
   */
  signInFeedback(visitor: string, kind: SignInFeedbackKind): DiagnosticEvent {
    const now = this.now();
    if (kind !== 'popup_blocked') {
      let latest: [string, PendingSignIn] | null = null;
      for (const entry of this.signIns) {
        const p = entry[1];
        if (p.visitor !== visitor || p.concludedAt !== undefined) continue;
        if (!latest || p.at > latest[1].at) latest = entry;
      }
      if (latest) {
        const [, p] = latest;
        p.feedback = kind;
        p.concludedAt = now;
        this.abandon(p, now, now - p.at);
        return this.byId.get(p.eventId) ?? this.events[this.events.length - 1];
      }
      // Refine the visitor's latest sign-in that ended without coming back.
      for (let i = this.events.length - 1; i >= 0; i--) {
        const e = this.events[i];
        if (now - e.lastAt > 30 * 60_000) break;
        if (e.kind !== 'signin.abandoned' || e.visitor !== visitor) continue;
        if (e.feedback && !VAGUE_FEEDBACK.has(e.feedback)) break;
        const updated = this.update(e.id, { kind: e.kind, outcome: e.outcome, feedback: kind }, now);
        if (updated) return updated;
      }
    }
    return this.record({ kind: 'signin.feedback', outcome: kind === 'cancelled' ? 'info' : 'warning', visitor, feedback: kind });
  }

  get pendingSignIns(): number {
    let n = 0;
    for (const p of this.signIns.values()) if (p.concludedAt === undefined) n++;
    return n;
  }

  // ------------------------------------------------------------------ publishes

  /** An upload was accepted (`key`: a hash of the deploy job id the browser polls with). */
  publishStarted(key: string, input: { visitor?: string; portalId?: number; phase: string }): DiagnosticEvent {
    const event = this.record({ kind: 'publish.started', outcome: 'pending', visitor: input.visitor, portalId: input.portalId, stage: 'build' });
    const at = event.lastAt;
    this.jobs.set(key, { eventId: event.id, at, updatedAt: at, visitor: input.visitor, portalId: input.portalId, phase: input.phase });
    this.pruneJobs();
    return event;
  }

  /** The job this id belongs to, forgotten under every id it was known by. */
  takeJob(key: string): PublishJob | undefined {
    const job = this.jobs.get(key);
    if (job) for (const [k, j] of this.jobs) if (j === job) this.jobs.delete(k);
    return job;
  }

  /** The job moved on (the browser polls with a new id each step). */
  keepJob(key: string, job: PublishJob, phase: string): void {
    job.phase = phase;
    job.updatedAt = this.now();
    this.jobs.set(key, job);
    this.pruneJobs();
  }

  /** True once per finished job id (the browser may ask about a finished job more than once). */
  markFinished(key: string): boolean {
    if (this.finishedSet.has(key)) return false;
    this.finishedSet.add(key);
    this.finished.push(key);
    while (this.finished.length > 300) this.finishedSet.delete(this.finished.shift()!);
    return true;
  }

  private pruneJobs(): void {
    while (this.jobs.size > 300) this.jobs.delete(this.jobs.keys().next().value!);
  }

  get pendingPublishes(): number {
    return new Set(this.jobs.values()).size;
  }
}
