import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
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
