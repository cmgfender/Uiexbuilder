import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, HOUR_MS, attentionItems, filterEvents, isProblem, relativeTime } from './model';
import type { ExplainContext } from './explain';
import type { DiagnosticEvent } from './types';

const ctx: ExplainContext = { builderUrl: 'https://b.example', setupUrl: 'https://b.example/setup.html', docsUrl: 'https://docs.example' };
const NOW = 10_000_000_000;
let id = 0;

function ev(over: Partial<DiagnosticEvent>): DiagnosticEvent {
  id += 1;
  return { id, kind: 'api.error', outcome: 'warning', at: NOW - 60_000, lastAt: NOW - 60_000, count: 1, ...over };
}

describe('filterEvents', () => {
  const events = [
    ev({ kind: 'signin.completed', outcome: 'ok', portalId: 123, visitor: 'aaaaaa' }),
    ev({ kind: 'signin.abandoned', outcome: 'warning', visitor: 'bbbbbb' }),
    ev({ kind: 'publish.failed', outcome: 'failed', code: 'missing_scope', lastAt: NOW - 3 * HOUR_MS }),
    ev({ kind: 'client.error', outcome: 'failed', client: { source: 'error', message: 'Cannot read stages' } }),
    ev({ kind: 'api.error', outcome: 'warning', code: 'not_found', status: 404 }),
    ev({ kind: 'server.started', outcome: 'info' }),
  ];

  it('filters by kind, time, problems and free text', () => {
    expect(filterEvents(events, DEFAULT_FILTER, NOW)).toHaveLength(6);
    expect(filterEvents(events, { ...DEFAULT_FILTER, group: 'signin' }, NOW).map((e) => e.kind)).toEqual(['signin.completed', 'signin.abandoned']);
    expect(filterEvents(events, { ...DEFAULT_FILTER, group: 'errors' }, NOW).map((e) => e.kind)).toEqual(['client.error', 'api.error']);
    expect(filterEvents(events, { ...DEFAULT_FILTER, range: 'hour' }, NOW)).toHaveLength(5);
    expect(filterEvents(events, { ...DEFAULT_FILTER, problemsOnly: true }, NOW).map((e) => e.kind)).toEqual(['signin.abandoned', 'publish.failed', 'client.error']);
    expect(filterEvents(events, { ...DEFAULT_FILTER, query: '123' }, NOW).map((e) => e.kind)).toEqual(['signin.completed']);
    expect(filterEvents(events, { ...DEFAULT_FILTER, query: 'cannot STAGES' }, NOW).map((e) => e.kind)).toEqual(['client.error']);
    expect(filterEvents(events, { ...DEFAULT_FILTER, query: 'bbbbbb' }, NOW).map((e) => e.kind)).toEqual(['signin.abandoned']);
  });

  it('does not count normal-life refusals as problems', () => {
    expect(isProblem({ kind: 'api.error', outcome: 'warning', code: 'not_connected' })).toBe(false);
    expect(isProblem({ kind: 'signin.failed', outcome: 'failed', code: 'access_denied' })).toBe(false);
    expect(isProblem({ kind: 'signin.failed', outcome: 'failed', code: 'token_exchange_failed' })).toBe(true);
  });
});

describe('attentionItems', () => {
  it('puts an unsigned Acceptable Use Policy first, and merges a key check with the refused publishes after it', () => {
    const items = attentionItems(
      [
        ev({ kind: 'publish.key_check', outcome: 'failed', code: 'missing_permission', visitor: 'aaaaaa' }),
        ev({ kind: 'publish.failed', outcome: 'failed', code: 'missing_scope', count: 4, visitor: 'aaaaaa' }),
        ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'aup', visitor: 'bbbbbb' }),
        ev({ kind: 'signin.abandoned', outcome: 'warning', visitor: 'cccccc' }),
        ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'timeout', visitor: 'dddddd' }),
        ev({ kind: 'client.error', outcome: 'failed', client: { source: 'error', message: 'boom' } }),
      ],
      NOW,
      ctx,
    );
    expect(items.map((i) => [i.key, i.count])).toEqual([
      ['abandoned:aup', 1],
      ['publish:missing_permission', 5],
      ['abandoned', 2],
      ['client:boom', 1],
    ]);
    expect(items[2].explanation.title).toBe('2 sign-ins never came back');
    expect(items[2].visitors).toBe(2);
    expect(items[1].filter).toMatchObject({ group: 'publish', problemsOnly: true, query: '' });
  });

  it('leaves out normal life and one-off probes, and anything older than a day', () => {
    const items = attentionItems(
      [
        ev({ kind: 'signin.failed', outcome: 'failed', code: 'access_denied' }),
        ev({ kind: 'api.error', outcome: 'warning', code: 'forbidden_origin', status: 403 }),
        ev({ kind: 'api.error', outcome: 'warning', code: 'not_found', status: 404, route: 'GET (unknown address)' }),
        ev({ kind: 'signin.abandoned', outcome: 'warning', feedback: 'cancelled' }),
        ev({ kind: 'client.error', outcome: 'failed', client: { source: 'error', message: 'old' }, lastAt: NOW - 25 * HOUR_MS }),
      ],
      NOW,
      ctx,
    );
    expect(items).toEqual([]);
    // …unless refusals from another address pile up (a wrong APP_URL).
    const many = attentionItems([ev({ kind: 'api.error', outcome: 'warning', code: 'forbidden_origin', status: 403, count: 6 })], NOW, ctx);
    expect(many.map((i) => i.explanation.title)).toEqual(['Request from another address refused']);
  });
});

describe('relativeTime', () => {
  it('reads naturally', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 min ago');
    expect(relativeTime(NOW - 3 * HOUR_MS, NOW)).toBe('3 h ago');
    expect(relativeTime(NOW - 30 * HOUR_MS, NOW)).toBe('yesterday');
  });
});
