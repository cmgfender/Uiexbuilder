import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { validateProject } from '../model/validate';
import type { Extension } from '../model/types';
import {
  checkHelpersSyntax,
  compileHelpers,
  helperNames,
  HELPERS_EXAMPLE,
  prepareHelpersForTypeScript,
} from './helpers';
import {
  isComputedIdentifier,
  toComputedIdentifier,
  uniqueComputedName,
  usableComputed,
  validateComputedName,
} from './computed';

describe('helperNames', () => {
  it('lists top-level declarations (TypeScript allowed)', () => {
    expect(helperNames(HELPERS_EXAMPLE)).toEqual(['formatMoney', 'daysUntil', 'initials']);
    expect(helperNames('const fmt: (v: number) => string = (v) => String(v);\nexport async function load() {}')).toEqual(['fmt', 'load']);
  });
});

describe('compileHelpers', () => {
  it('evaluates TypeScript helper code and returns the declared values', () => {
    const h = compileHelpers(HELPERS_EXAMPLE);
    expect(h.error).toBeNull();
    expect((h.values.formatMoney as (v: number) => string)(1234.5)).toBe('$1,234.50');
    expect((h.values.initials as (v: string) => string)('Ada Lovelace')).toBe('AL');
    expect(typeof h.values.daysUntil).toBe('function');
  });

  it('caches per source text', () => {
    const code = 'const n = { v: 1 };';
    expect(compileHelpers(code)).toBe(compileHelpers(code));
    expect(compileHelpers(code).values.n).toBe(compileHelpers(code).values.n);
  });

  it('reports syntax and runtime errors without throwing', () => {
    const bad = compileHelpers('function broken( {');
    expect(bad.error).toBeTruthy();
    expect(bad.values).toEqual({});
    const throws = compileHelpers('const x = (() => { throw new Error("boom"); })();');
    expect(throws.error).toBe('boom');
    expect(compileHelpers('').names).toEqual([]);
    expect(compileHelpers(undefined).error).toBeNull();
  });
});

describe('checkHelpersSyntax', () => {
  it('accepts TypeScript annotations and exports, rejects broken code', () => {
    expect(checkHelpersSyntax('export function f(a: number): number { return a; }')).toBeNull();
    expect(checkHelpersSyntax('function f( {')).toMatch(/./);
    expect(checkHelpersSyntax('')).toBeNull();
  });

  it('accepts valid TypeScript that has runtime meaning, and the preview runs it like tsc', () => {
    const code = [
      "export enum Stage { Open = 'open', Won = 'won' }",
      'export function o(a: string): string;',
      'export function o(a: number): number;',
      'export function o(a: any) { return a; }',
      'class Money { constructor(private cents: number) {} dollars() { return this.cents / 100; } }',
      'abstract class Shape { abstract area(): number; }',
      'namespace Util { export const k = 3; }',
      'function who(this: unknown, n: number) { return n; }',
      'function isWon(s: string) { return s === Stage.Won; }',
      'const total = new Money(250).dollars() + Util.k + o(1) + who(1);',
    ].join('\n');
    expect(checkHelpersSyntax(code)).toBeNull();
    const h = compileHelpers(code);
    expect(h.error).toBeNull();
    expect(h.names).toEqual(['Stage', 'o', 'Money', 'Shape', 'Util', 'who', 'isWon', 'total']);
    expect(h.values.total).toBe(7.5);
    expect((h.values.isWon as (s: string) => boolean)('won')).toBe(true);
  });

  it('explains that imports cannot work in helper code', () => {
    expect(checkHelpersSyntax("import { format } from 'date-fns';\nfunction f() { return 1; }")).toMatch(/import statements are not supported/);
  });
});

describe('prepareHelpersForTypeScript', () => {
  it('annotates untyped parameters and trims trailing whitespace', () => {
    expect(prepareHelpersForTypeScript('function f(a, b: string) {}\r\n\n')).toBe('function f(a: any, b: string) {}');
  });
});

function extWith(patch: Partial<Extension>): Extension {
  return { ...createExtension({}), ...patch };
}

describe('computed value names', () => {
  const ext = extWith({
    state: [{ id: 's1', name: 'count', type: 'number', initial: 0 }],
    dataSources: [{ id: 'd1', kind: 'fetch', name: 'weather', url: 'https://x.example', method: 'GET', runOnMount: true }],
    computed: [
      { id: 'c1', name: 'double', expr: 'count * 2' },
      { id: 'c2', name: 'count', expr: '1' },
      { id: 'c3', name: 'double', expr: '2' },
      { id: 'c4', name: 'not valid', expr: '3' },
      { id: 'c5', name: 'weatherLoading', expr: '4' },
      { id: 'c6', name: 'triple', expr: 'count * 3' },
    ],
    helpers: 'function fmt(v) { return v; }',
  });

  it('usableComputed skips invalid and conflicting names', () => {
    expect(usableComputed(ext).map((c) => c.id)).toEqual(['c1', 'c6']);
  });

  it('validateComputedName explains conflicts', () => {
    expect(validateComputedName(ext, 'total')).toBeNull();
    expect(validateComputedName(ext, 'triple', 'c6')).toBeNull();
    expect(validateComputedName(ext, 'double', 'c6')).toMatch(/another computed/);
    expect(validateComputedName(ext, 'count')).toMatch(/state variable/);
    expect(validateComputedName(ext, 'setCount')).toMatch(/setter/);
    expect(validateComputedName(ext, 'setWeatherError')).toMatch(/data source/);
    expect(validateComputedName(ext, 'fmt')).toMatch(/helper/);
    expect(validateComputedName(ext, '1x')).toMatch(/number/);
    expect(validateComputedName(ext, 'a-b')).toMatch(/letters/);
    expect(validateComputedName(ext, 'class')).toMatch(/reserved/);
    expect(validateComputedName(ext, 'context')).toMatch(/reserved/);
    expect(validateComputedName(ext, 'Math')).toMatch(/built-in/);
    expect(validateComputedName(ext, '')).toMatch(/required/);
  });

  it('builds unique identifiers', () => {
    expect(toComputedIdentifier('Total amount')).toBe('totalAmount');
    expect(toComputedIdentifier('2nd')).toBe('_2nd');
    expect(toComputedIdentifier('')).toBe('computed');
    expect(isComputedIdentifier('context')).toBe(false);
    expect(uniqueComputedName(ext, 'double')).toBe('double2');
    expect(uniqueComputedName(ext, 'count')).toBe('count2');
    expect(uniqueComputedName(ext)).toBe('computed');
  });
});

describe('computed names agree with validation', () => {
  it('rejects the names validation reports as reserved (React hooks, hubspot, React)', () => {
    for (const name of ['useState', 'useEffect', 'useMemo', 'useCallback', 'hubspot', 'React', 'context', 'class']) {
      const project = createProject('Names');
      const ext = project.extensions[0];
      ext.computed = [{ id: 'c1', name, expr: '1' }];
      const problems = validateProject(project).filter((i) => i.field === 'computed:c1' && i.severity === 'error');
      expect(problems.length, name).toBeGreaterThan(0);
      expect(validateComputedName(ext, name, 'c1'), name).toMatch(/reserved/);
      expect(isComputedIdentifier(name), name).toBe(false);
      // Runtime and codegen skip it, and a new value never gets that name.
      expect(usableComputed(ext), name).toEqual([]);
      ext.computed = [];
      expect(uniqueComputedName(ext, name), name).not.toBe(name);
    }
  });

  it('a name the Data panel accepts is not an error in the Problems panel', () => {
    for (const name of ['total', 'useTotal', 'stateValue', '$price', '_internal']) {
      const project = createProject('Names');
      const ext = project.extensions[0];
      ext.computed = [{ id: 'c1', name, expr: '1' }];
      expect(validateComputedName(ext, name, 'c1'), name).toBeNull();
      const problems = validateProject(project).filter((i) => i.field === 'computed:c1' && i.severity === 'error');
      expect(problems, name).toEqual([]);
    }
  });
});
