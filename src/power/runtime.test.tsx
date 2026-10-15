/**
 * Computed values and helper functions in the designer preview runtime (src/runtime/scope.ts and
 * RuntimeProvider).
 */
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComputedValue } from '../model/types';
import {
  buildScopeWithDiagnostics,
  createInitialScope,
  initialStateValues,
  resolveDataSources,
  type BaseScopeInput,
} from '../runtime';
import { byName, makeDoc, renderDoc } from '../runtime/testing';

function input(patch: { computed?: ComputedValue[]; helpers?: string; setters?: BaseScopeInput['setters'] } = {}): BaseScopeInput {
  const { project, ext } = makeDoc([], {
    state: [
      { name: 'count', type: 'number', initial: 3 },
      { name: 'items', type: 'array', initial: [{ amount: 10 }, { amount: 5 }] },
    ],
  });
  ext.computed = patch.computed;
  ext.helpers = patch.helpers;
  return {
    project,
    extension: ext,
    stateValues: initialStateValues(ext.state),
    setters: patch.setters ?? { count: () => {}, items: () => {} },
    dataSources: resolveDataSources(ext, {}),
  };
}

const cv = (id: string, name: string, expr: string): ComputedValue => ({ id, name, expr });

describe('scope: computed values', () => {
  it('evaluates in order, each seeing state, helpers and earlier computed values', () => {
    const { scope, diagnostics } = buildScopeWithDiagnostics(
      input({
        helpers: 'function money(v: number): string { return `$${v.toFixed(2)}`; }',
        computed: [
          cv('c1', 'total', 'items.reduce((s, i) => s + i.amount, 0)'),
          cv('c2', 'label', 'money(total * count)'),
          cv('c3', 'empty', ''),
        ],
      }),
    );
    expect(scope.total).toBe(15);
    expect(scope.label).toBe('$45.00');
    expect('empty' in scope).toBe(true);
    expect(scope.empty).toBeUndefined();
    expect(diagnostics).toEqual({ helpersError: null, computedErrors: {} });
  });

  it('turns errors into undefined values with a message (never throws)', () => {
    const { scope, diagnostics } = buildScopeWithDiagnostics(
      input({
        computed: [
          cv('c1', 'early', 'later + 1'),
          cv('c2', 'later', '2'),
          cv('c3', 'broken', 'count +'),
          cv('c4', 'boom', 'items.nope.deep'),
          cv('c5', 'ok', 'later * 2'),
        ],
      }),
    );
    expect(scope.early).toBeUndefined();
    expect(scope.broken).toBeUndefined();
    expect(scope.boom).toBeUndefined();
    expect(scope.ok).toBe(4);
    expect(Object.keys(diagnostics.computedErrors).sort()).toEqual(['c1', 'c3', 'c4']);
    expect(diagnostics.computedErrors.c1).toMatch(/later/);
  });

  it('rejects state changes while computing but allows them from returned functions', () => {
    const calls: unknown[] = [];
    const { scope, diagnostics } = buildScopeWithDiagnostics(
      input({
        setters: { count: (v) => calls.push(v), items: () => {} },
        computed: [cv('c1', 'sneaky', 'setCount(99)'), cv('c2', 'increment', '() => setCount(count + 1)')],
      }),
    );
    expect(diagnostics.computedErrors.c1).toMatch(/cannot change state/);
    expect(calls).toEqual([]);
    (scope.increment as () => void)();
    expect(calls).toEqual([4]);
  });

  it('skips computed values whose names clash with state or each other', () => {
    const { scope } = buildScopeWithDiagnostics(
      input({ computed: [cv('c1', 'count', '100'), cv('c2', 'x', '1'), cv('c3', 'x', '2'), cv('c4', 'bad name', '3')] }),
    );
    expect(scope.count).toBe(3);
    expect(scope.x).toBe(1);
  });

  it('createInitialScope includes helpers and computed values', () => {
    const { project, ext } = makeDoc([], { state: [{ name: 'n', type: 'number', initial: 2 }] });
    ext.helpers = 'const sq = (v) => v * v;';
    ext.computed = [cv('c1', 'area', 'sq(n)')];
    const scope = createInitialScope(project, ext);
    expect(scope.area).toBe(4);
    expect(typeof scope.sq).toBe('function');
  });
});

describe('scope: helpers', () => {
  it('strips TypeScript syntax before evaluating', () => {
    const { scope, diagnostics } = buildScopeWithDiagnostics(
      input({ helpers: 'export const RATE: number = 0.2;\nexport function tax(v: number): number { return v * RATE; }\ninterface X { a: number }' }),
    );
    expect(diagnostics.helpersError).toBeNull();
    expect((scope.tax as (v: number) => number)(100)).toBe(20);
    expect(scope.RATE).toBe(0.2);
  });

  it('reports broken helper code and keeps everything else working', () => {
    const { scope, diagnostics } = buildScopeWithDiagnostics(
      input({ helpers: 'function fmt( {', computed: [cv('c1', 'double', 'count * 2'), cv('c2', 'f', 'fmt(1)')] }),
    );
    expect(diagnostics.helpersError).toBeTruthy();
    expect(scope.double).toBe(6);
    expect(scope.f).toBeUndefined();
    expect(diagnostics.computedErrors.c2).toMatch(/fmt/);
  });

  it('state, data and context shadow helpers with the same name', () => {
    const { scope } = buildScopeWithDiagnostics(input({ helpers: 'const count = 1000; const context = 1;' }));
    expect(scope.count).toBe(3);
    expect(typeof scope.context).toBe('object');
  });
});

describe('RuntimeProvider with computed values', () => {
  it('renders computed values, updates them with state and logs errors once', async () => {
    const { project, ext } = makeDoc(
      [
        { type: 'Text', name: 'out', text: 'Total {{ doubled }} / {{ shout(greeting) }}' },
        { type: 'Text', name: 'bad', text: 'Bad {{ broken }}' },
      ],
      {
        state: [
          { name: 'count', type: 'number', initial: 2 },
          { name: 'greeting', type: 'string', initial: 'hi' },
        ],
      },
    );
    ext.helpers = 'function shout(s: string): string { return s.toUpperCase() + "!"; }';
    ext.computed = [cv('c1', 'doubled', 'count * 2'), cv('c2', 'broken', 'missing.value')];
    const r = renderDoc(project, ext, { mode: 'preview' });
    const out = r.nodes(byName(ext, 'out').id)[0];
    expect(out.textContent).toContain('Total 4 / HI!');
    expect(r.api.diagnostics?.computedErrors.c2).toMatch(/missing/);
    expect(r.api.scope.doubled).toBe(4);

    act(() => r.api.setStateValue('count', 5));
    expect(r.nodes(byName(ext, 'out').id)[0].textContent).toContain('Total 10');

    const errors = r.api.logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Computed value "broken" failed/);
  });
});
