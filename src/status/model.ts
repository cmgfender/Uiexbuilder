/**
 * Status page model (pure): timeline filters, the "Needs your attention" groups and time labels.
 */
import { keyProblemKind } from '../panels/deploy/model';
import { explainEvent, feedbackLabel, type ExplainContext, type Explanation } from './explain';
import type { DiagnosticCounters, DiagnosticEvent } from './types';

export type EventGroup = 'all' | 'signin' | 'publish' | 'errors';
export type TimeRange = 'hour' | 'day' | 'all';

export interface EventFilter {
  group: EventGroup;
  problemsOnly: boolean;
  range: TimeRange;
  /** Free text: a code, visitor id, account id, address or message. */
  query: string;
}

export const DEFAULT_FILTER: EventFilter = { group: 'all', problemsOnly: false, range: 'all', query: '' };

export const HOUR_MS = 60 * 60_000;
export const DAY_MS = 24 * HOUR_MS;

export function groupOf(e: Pick<DiagnosticEvent, 'kind'>): Exclude<EventGroup, 'all'> | 'server' {
  if (e.kind.startsWith('signin.')) return 'signin';
  if (e.kind.startsWith('publish.')) return 'publish';
  if (e.kind === 'server.started') return 'server';
  return 'errors';
}

/** Refusals that are normal life (a deleted record, an expired sign-in, someone saying no). */
const BENIGN_CODES = new Set(['not_found', 'not_connected', 'access_denied', 'bad_return_to', 'superseded']);

/** Something went wrong (or may have): failed or a warning, except normal-life refusals. */
export function isProblem(e: Pick<DiagnosticEvent, 'outcome' | 'kind' | 'code'>): boolean {
  if (e.outcome !== 'failed' && e.outcome !== 'warning') return false;
  return !(e.code && BENIGN_CODES.has(e.code));
}

function searchText(e: DiagnosticEvent): string {
  return [e.kind, e.code, e.visitor, e.portalId, e.route, e.stage, e.status, e.feedback && feedbackLabel(e.feedback), e.client?.message, e.client?.name, e.client?.path, e.client?.build, e.errorName]
    .filter((v) => v !== undefined && v !== null && v !== '')
    .join(' ')
    .toLowerCase();
}

export function filterEvents(events: readonly DiagnosticEvent[], filter: EventFilter, now: number): DiagnosticEvent[] {
  const since = filter.range === 'hour' ? now - HOUR_MS : filter.range === 'day' ? now - DAY_MS : -Infinity;
  const words = filter.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((e) => {
    if (e.lastAt < since) return false;
    if (filter.group !== 'all' && groupOf(e) !== filter.group) return false;
    if (filter.problemsOnly && !isProblem(e)) return false;
    if (words.length) {
      const text = searchText(e);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

export interface AttentionItem {
  key: string;
  /** How many times, and from how many visitors. */
  count: number;
  visitors: number;
  lastAt: number;
  explanation: Explanation;
  /** Filter that shows these events in the timeline. */
  filter: EventFilter;
  /** Lower comes first (see attentionItems). */
  rank: number;
}

/** Codes that are normal life, not worth a card unless they pile up. */
const QUIET = new Set(['access_denied', 'state_mismatch', 'state_missing', 'not_connected', 'rate_limited', 'bad_return_to', 'superseded', 'not_admin', 'csrf', 'forbidden_origin']);

function attentionKey(e: DiagnosticEvent): string | null {
  if (!isProblem(e)) return null;
  switch (e.kind) {
    case 'signin.abandoned':
      return e.feedback === 'aup' || e.feedback === 'install_permission' ? `abandoned:${e.feedback}` : e.feedback === 'cancelled' ? null : 'abandoned';
    case 'signin.failed':
      return `signin.failed:${e.code ?? ''}`;
    case 'publish.failed':
    case 'publish.key_check':
      // A key check that found a problem and the refused publishes after it are one problem.
      return `publish:${keyProblemKind(e.code ?? '') ?? e.code ?? ''}`;
    case 'signin.feedback':
      return e.feedback && e.feedback !== 'cancelled' ? `feedback:${e.feedback}` : null;
    case 'api.error':
      if (e.code === 'not_found' && e.route?.includes('(unknown address)')) return null;
      return `api:${e.code ?? e.status}`;
    case 'client.error':
      return e.client?.overflow ? `client:more:${e.visitor ?? ''}` : `client:${e.client?.message ?? ''}`;
    case 'publish.started':
      return null;
    default:
      return null;
  }
}

/**
 * Problems in the last `windowMs`, grouped (all "never came back" sign-ins together, publishes by
 * problem …), most important first: by how often, weighted by whether the host can act on it.
 */
export function attentionItems(events: readonly DiagnosticEvent[], now: number, ctx: ExplainContext, windowMs = DAY_MS): AttentionItem[] {
  const groups = new Map<string, DiagnosticEvent[]>();
  for (const e of events) {
    if (now - e.lastAt > windowMs) continue;
    const key = attentionKey(e);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  const items: AttentionItem[] = [];
  for (const [key, list] of groups) {
    const count = list.reduce((n, e) => n + e.count, 0);
    const code = list[0].code;
    if (code && QUIET.has(code) && count < 5) continue;
    const latest = list.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
    let explanation = explainEvent({ ...latest, count }, ctx);
    if (key === 'abandoned') {
      // Several visitors, several vague answers: the general explanation, counted.
      explanation = { ...explainEvent({ ...latest, count, feedback: undefined }, ctx) };
      explanation.title = count === 1 ? 'A sign-in never came back' : `${count} sign-ins never came back`;
    }
    const visitors = new Set(list.map((e) => e.visitor ?? '?')).size;
    const kindGroup = groupOf(latest);
    const filter: EventFilter = {
      ...DEFAULT_FILTER,
      group: kindGroup === 'server' ? 'all' : kindGroup,
      problemsOnly: true,
      range: 'day',
      query: latest.kind === 'signin.abandoned' ? 'signin.abandoned' : key.startsWith('publish:') ? '' : (latest.code ?? latest.client?.message?.slice(0, 40) ?? ''),
    };
    // Impact: how often, weighted by whether the host can act on it. An unsigned Acceptable Use
    // Policy blocks every sign-in, so it always comes first; what browsers report is unverified,
    // so it never outranks what the server saw itself.
    const weight = explanation.unverified ? 1 : explanation.who === 'you' ? 3 : explanation.who === 'super_admin' || explanation.who === 'visitor' ? 2 : 1;
    const bonus = key === 'abandoned:aup' ? 100 : key === 'abandoned:install_permission' ? 6 : 0;
    const rank = -(count * weight + bonus + (explanation.tone === 'danger' ? 1 : 0));
    items.push({ key, count, visitors, lastAt: latest.lastAt, explanation, filter, rank });
  }
  return items.sort((a, b) => a.rank - b.rank || b.count - a.count || b.lastAt - a.lastAt);
}

/** "just now", "3 min ago", "2 h ago", "yesterday", "3 days ago". */
export function relativeTime(at: number, now: number): string {
  const s = Math.round((now - at) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Local clock time ("14:02:11"), with the date when it isn't today. */
export function clockTime(at: number, now: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

/** Sum of problems in a set of counters (for the page title / badge). */
export function problemCount(c: DiagnosticCounters): number {
  return c.signInFailed + c.signInAbandoned + c.publishFailed + c.keyCheckProblems + c.apiErrors + c.clientErrors;
}
