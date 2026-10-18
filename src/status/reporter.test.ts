import { describe, expect, it } from 'vitest';
import { REPORTER_LIMITS, cleanReportText, createErrorReporter, currentBuild, firstFrame, isNoise } from './reporter';
import type { ClientReport } from './types';

function setup(ready: 'yes' | 'no' | 'unknown' = 'yes') {
  let t = 1_000_000;
  let state = ready;
  const sent: ClientReport[] = [];
  const reporter = createErrorReporter({ send: (r) => sent.push(r), ready: () => state, now: () => t, build: 'B2x9kQ', path: () => '/status?x=1' });
  return {
    reporter,
    sent,
    advance: (ms: number) => {
      t += ms;
    },
    setReady: (s: 'yes' | 'no' | 'unknown') => {
      state = s;
    },
  };
}

function error(message: string, stack = `TypeError: ${message}\n    at render (https://b.example/assets/index-B2x9kQ.js:1:2)`): Error {
  const e = new TypeError(message);
  e.stack = stack;
  return e;
}

describe('createErrorReporter', () => {
  it('sends a cleaned report with the build and the page path', () => {
    const { reporter, sent } = setup();
    expect(reporter.report(error('Cannot read stages of ada@example.com at https://b.example/api/x?q=secret'), 'error')).toBe(true);
    expect(sent).toEqual([
      {
        type: 'client_error',
        source: 'error',
        name: 'TypeError',
        message: 'Cannot read stages of [email] at https://b.example/api/x',
        stack: 'TypeError: Cannot read stages of [email] at https://b.example/api/x\n    at render (https://b.example/assets/index-B2x9kQ.js:1:2)',
        path: '/status',
        build: 'B2x9kQ',
      },
    ]);
  });

  it('reports each distinct error once per page load', () => {
    const { reporter, sent } = setup();
    reporter.report(error('a'), 'error');
    reporter.report(error('a'), 'error');
    reporter.report(error('b'), 'unhandledrejection');
    expect(sent.map((r) => (r.type === 'client_error' ? r.message : ''))).toEqual(['a', 'b']);
  });

  it('throttles bursts and caps reports per page', () => {
    const { reporter, sent, advance } = setup();
    for (let i = 0; i < 10; i++) reporter.report(error(`e${i}`), 'error');
    expect(sent).toHaveLength(REPORTER_LIMITS.burst);
    advance(REPORTER_LIMITS.refillMs);
    reporter.report(error('later'), 'error');
    expect(sent).toHaveLength(REPORTER_LIMITS.burst + 1);
    for (let i = 0; i < 100; i++) {
      advance(REPORTER_LIMITS.refillMs);
      reporter.report(error(`many${i}`), 'error');
    }
    expect(reporter.sent).toBe(REPORTER_LIMITS.perPage);
  });

  it('waits until it knows a connector is there, and drops everything when there is none', () => {
    const a = setup('unknown');
    a.reporter.report(error('early'), 'error');
    expect(a.sent).toHaveLength(0);
    a.setReady('yes');
    a.reporter.flush();
    expect(a.sent).toHaveLength(1);

    const b = setup('unknown');
    b.reporter.report(error('early'), 'error');
    b.setReady('no');
    b.reporter.flush();
    expect(b.sent).toHaveLength(0);
    expect(b.reporter.report(error('static hosting'), 'error')).toBe(false);
  });

  it('adds the component stack for editor crashes', () => {
    const { reporter, sent } = setup();
    reporter.report(error('crash'), 'react', { componentStack: '\n    at Inspector\n    at AppShell\n' });
    expect(sent[0]).toMatchObject({ source: 'react' });
    expect(sent[0].type === 'client_error' && sent[0].stack).toContain('Components:\nat Inspector\nat AppShell');
  });

  it('accepts things thrown that are not errors', () => {
    const { reporter, sent } = setup();
    reporter.report('just a string', 'unhandledrejection');
    reporter.report({ code: 42 }, 'unhandledrejection');
    reporter.report(undefined, 'unhandledrejection');
    expect(sent.map((r) => (r.type === 'client_error' ? r.message : ''))).toEqual(['just a string', '{"code":42}']);
  });
});

describe('isNoise', () => {
  it('skips what isn’t the builder’s', () => {
    expect(isNoise({ message: 'ResizeObserver loop completed with undelivered notifications.' })).toBe(true);
    expect(isNoise({ message: 'Script error.' })).toBe(true);
    expect(isNoise({ name: 'AbortError', message: 'The user aborted a request.' })).toBe(true);
    expect(isNoise({ message: 'x', stack: 'Error: x\n    at f (chrome-extension://abc/content.js:1:1)' })).toBe(true);
    // The person's own card code in the preview (new Function) is theirs, not the builder's.
    expect(isNoise({ message: 'x is not defined', stack: 'ReferenceError: x is not defined\n    at eval (eval at evaluate (https://b.example/assets/index-1.js:5:9), <anonymous>:1:1)' })).toBe(true);
    expect(isNoise({ message: 'x', stack: 'anonymous@https://b.example/assets/index-1.js line 5 > Function:1:1' })).toBe(true);
    expect(isNoise({ message: 'Cannot read properties of undefined', stack: 'TypeError: …\n    at Inspector (https://b.example/assets/index-1.js:5:9)' })).toBe(false);
    // A message with an "@" (an email address) is not a stack frame.
    expect(
      isNoise({ message: 'Failed for ada@example.com', stack: 'Error: Failed for ada@example.com\n    at eval (eval at evaluate (:290:30), <anonymous>:7:20)' }),
    ).toBe(true);
  });

  it('finds the first frame in every browser’s format', () => {
    expect(firstFrame('Error: mail ada@example.com\n    at save (https://b.example/a.js:1:2)')).toBe('at save (https://b.example/a.js:1:2)');
    expect(firstFrame('save@https://b.example/a.js:1:2\n@https://b.example/a.js:3:4')).toBe('save@https://b.example/a.js:1:2');
    expect(firstFrame(undefined)).toBe('');
  });
});

describe('helpers', () => {
  it('reads the build from the main script name', () => {
    expect(currentBuild('https://b.example/assets/index-B2x9kQ3d.js')).toBe('B2x9kQ3d');
    expect(currentBuild('http://localhost:5173/src/status/reporter.ts')).toBe('dev');
  });

  it('strips query strings but keeps line numbers', () => {
    expect(cleanReportText('at http://localhost:5173/src/App.tsx?t=1697000000:40:3', 200)).toBe('at http://localhost:5173/src/App.tsx:40:3');
    expect(cleanReportText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});
