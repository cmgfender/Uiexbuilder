/**
 * The status page's memory: a size-capped ring buffer of recent events plus per-minute counters
 * for the last 24 hours. No database: everything is lost when the server restarts, redeploys or
 * (free hosting) goes to sleep — the status page says so.
 *
 * - One row per attempt: a sign-in or publish is recorded when it starts and that same row is
 *   updated when it ends (signed in / failed / never came back; published / failed).
 * - Identical problems from the same visitor within 10 minutes are merged into one row with a
 *   count ("refused 4 times"), so one busy visitor can't push everything else out.
 * - Errors reported by browsers are untrusted (anyone can send one): they live in their own,
 *   smaller buffer so they can't push sign-ins and publishes out, and after a few distinct reports
 *   per visitor (or from everyone) within an hour the rest are only counted, in one "more reports"
 *   row.
 * - Sign-ins in progress are capped too; one that is dropped, or that never comes back after its
 *   row is gone, is only counted (a burst of fake sign-in starts can't flood the page later).
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
  /** Browser error reports kept (their own buffer, on top of `capacity`). */
  clientCapacity: 100,
  /** Distinct browser error rows per visitor per hour; later reports go into one "more" row. */
  clientRowsPerVisitor: 5,
  /** Distinct browser error rows from everyone per hour. */
  clientRowsPerHour: 30,
  /** Sign-ins followed at once (the oldest is no longer followed beyond this). */
  maxPendingSignIns: 500,
} as const;

/** The message of the row that counts a visitor's further browser error reports. */
export const MORE_CLIENT_REPORTS = 'More error reports (counted, not kept one by one)';

/** What a caller records (id, count and timestamps are filled in). */
export type EventInput = Omit<DiagnosticEvent, 'id' | 'at' | 'lastAt' | 'count'> & { at?: number };

/** Kinds whose identical repeats are merged. */
const MERGEABLE = new Set<DiagnosticKind>(['api.error', 'client.error', 'publish.failed', 'publish.key_check', 'signin.failed', 'signin.feedback']);

/** Feedback that only says how the window ended (a later, more specific answer replaces it). */
const VAGUE_FEEDBACK = new Set<SignInFeedbackKind>(['popup_closed', 'timeout', 'nothing']);
/** What the browser itself says (not the visitor's answer): never replaces their answer. */
const AUTOMATIC_FEEDBACK = new Set<SignInFeedbackKind>(['popup_closed', 'timeout', 'popup_blocked']);
/** A visitor who changes their answer within this long changes it on the same row. */
const FEEDBACK_CHANGE_MS = 5 * 60_000;

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
      if (e.outcome === 'pending') c.signInStarted += n;
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
  /** Browser error reports kept (see DIAGNOSTICS_DEFAULTS.clientCapacity). */
  clientCapacity?: number;
  abandonAfterMs?: number;
  /** Where `[event]` lines go (null: nowhere). */
  emit?: ((line: string) => void) | null;
}

export class DiagnosticsLog {
  readonly startedAt: number;
  readonly capacity: number;
  readonly clientCapacity: number;
  readonly abandonAfterMs: number;
  /** Events dropped because the buffer was full. */
  dropped = 0;
  private readonly now: () => number;
  private readonly emit: ((line: string) => void) | null;
  /** Oldest first; an updated event moves to the end. */
  private events: DiagnosticEvent[] = [];
  /** Browser error reports, kept apart (same order). */
  private clientEvents: DiagnosticEvent[] = [];
  /** When each browser error row of the last hour was made, and for whom. */
  private clientRows: Array<{ at: number; visitor?: string }> = [];
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
    this.clientCapacity = Math.max(10, opts.clientCapacity ?? DIAGNOSTICS_DEFAULTS.clientCapacity);
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

  /** The buffer an event of this kind lives in. */
  private listOf(kind: DiagnosticKind): DiagnosticEvent[] {
    return kind === 'client.error' ? this.clientEvents : this.events;
  }

  private touch(e: DiagnosticEvent): void {
    const list = this.listOf(e.kind);
    const i = list.indexOf(e);
    if (i >= 0 && i !== list.length - 1) {
      list.splice(i, 1);
      list.push(e);
    }
  }

  /**
   * A browser error report that would be a new row: once a visitor (or everyone) has several
   * distinct reports within the hour, the rest are counted in one "more reports" row instead.
   */
  private limitClientRows(fields: EventInput, at: number): EventInput {
    if (fields.kind !== 'client.error' || fields.client?.overflow) return fields;
    const hourAgo = at - 60 * 60_000;
    // Rows made in the last hour (whether or not still kept: at most clientRowsPerHour).
    while (this.clientRows.length && this.clientRows[0].at <= hourAgo) this.clientRows.shift();
    const mine = this.clientRows.filter((r) => r.visitor === fields.visitor).length;
    const visitorFull = mine >= DIAGNOSTICS_DEFAULTS.clientRowsPerVisitor;
    if (!visitorFull && this.clientRows.length < DIAGNOSTICS_DEFAULTS.clientRowsPerHour) {
      this.clientRows.push({ at, visitor: fields.visitor });
      return fields;
    }
    return {
      kind: 'client.error',
      outcome: fields.outcome,
      visitor: visitorFull ? fields.visitor : undefined,
      client: { source: 'error', message: MORE_CLIENT_REPORTS, overflow: true },
    };
  }

  /** Records an event (merged into an identical recent one when it is a repeat). */
  record(input: EventInput): DiagnosticEvent {
    const at = input.at ?? this.now();
    let fields: EventInput = { ...input };
    delete fields.at;
    const list = this.listOf(fields.kind);
    if (MERGEABLE.has(fields.kind)) {
      let key = mergeKey(fields);
      if (!this.findMergeable(list, key, at)) {
        fields = this.limitClientRows(fields, at);
        key = mergeKey(fields);
      }
      const e = this.findMergeable(list, key, at);
      if (e) {
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
    list.push(event);
    this.byId.set(event.id, event);
    const max = list === this.clientEvents ? this.clientCapacity : this.capacity;
    while (list.length > max) {
      const old = list.shift()!;
      this.byId.delete(old.id);
      this.dropped += 1;
    }
    this.count(event, at);
    this.log(event, false);
    return event;
  }

  /** A recent row identical to `key` (newest first, within the merge window). */
  private findMergeable(list: DiagnosticEvent[], key: string, at: number): DiagnosticEvent | null {
    for (let i = list.length - 1, seen = 0; i >= 0 && seen < 50; i--, seen++) {
      const e = list[i];
      if (at - e.lastAt > DIAGNOSTICS_DEFAULTS.mergeWindowMs) break;
      if (mergeKey(e) === key) return e;
    }
    return null;
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
    return [...this.events, ...this.clientEvents].sort((a, b) => b.lastAt - a.lastAt || b.id - a.id).map((e) => ({ ...e, client: e.client ? { ...e.client } : undefined }));
  }

  get size(): number {
    return this.events.length + this.clientEvents.length;
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
    // Too many at once (a flood of sign-in starts): the oldest is no longer followed, quietly — it
    // will never show up as "never came back".
    while (this.signIns.size > DIAGNOSTICS_DEFAULTS.maxPendingSignIns) {
      const [oldKey, old] = this.signIns.entries().next().value!;
      this.signIns.delete(oldKey);
      const row = this.byId.get(old.eventId);
      if (old.concludedAt === undefined && row?.kind === 'signin.started' && row.outcome === 'pending') {
        row.outcome = 'info';
        row.code = 'not_followed';
      }
    }
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
      this.abandonUnanswered(p, p.at + this.abandonAfterMs);
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
   * A sign-in that never came back and that nobody said anything about. Several from one visitor
   * close together are one row with a count; one whose row is already gone is only counted (a
   * burst of sign-in starts can't push the real events out ten minutes later).
   */
  private abandonUnanswered(p: PendingSignIn, at: number): void {
    const patch = { kind: 'signin.abandoned' as const, outcome: 'warning' as const };
    const own = this.byId.get(p.eventId);
    const twin = p.visitor ? this.recentAbandoned(p.visitor, at, p.eventId) : null;
    if (!own || twin) {
      if (own) this.remove(own);
      if (twin) {
        twin.count += 1;
        twin.lastAt = Math.max(twin.lastAt, at);
        this.touch(twin);
        this.log(twin, true);
      }
      this.count(patch, at);
      return;
    }
    this.update(p.eventId, { ...patch, durationMs: this.abandonAfterMs, feedback: p.feedback }, at);
  }

  /** The visitor's latest "never came back" row without an answer, from the last few minutes. */
  private recentAbandoned(visitor: string, at: number, except: number): DiagnosticEvent | null {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (at - e.lastAt > DIAGNOSTICS_DEFAULTS.mergeWindowMs) break;
      if (e.id !== except && e.kind === 'signin.abandoned' && e.visitor === visitor && (!e.feedback || AUTOMATIC_FEEDBACK.has(e.feedback))) return e;
    }
    return null;
  }

  private remove(e: DiagnosticEvent): void {
    const list = this.listOf(e.kind);
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    this.byId.delete(e.id);
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
      // Refine the visitor's latest sign-in that ended without coming back: a vague answer gets
      // their specific one; a specific one changes when they change their mind soon after (the
      // latest answer counts, not every choice they looked at).
      for (let i = this.events.length - 1; i >= 0; i--) {
        const e = this.events[i];
        if (now - e.lastAt > 30 * 60_000) break;
        if (e.kind !== 'signin.abandoned' || e.visitor !== visitor) continue;
        if (e.feedback && !VAGUE_FEEDBACK.has(e.feedback)) {
          if (now - e.lastAt > FEEDBACK_CHANGE_MS) break;
          if (AUTOMATIC_FEEDBACK.has(kind) || e.feedback === kind) return e;
        }
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
