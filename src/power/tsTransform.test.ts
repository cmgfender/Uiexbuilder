import { describe, expect, it } from 'vitest';
import { annotateUntypedParams, stripTypeScript, tokenize, topLevelDeclarations } from './tsTransform';

/** Collapses whitespace so assertions do not depend on the blanked-out columns. */
const squash = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*([(),:;{}=<>[\]])\s*/g, '$1').trim();

/** Runs stripped helper code and returns a declared value. */
function run<T>(code: string, name: string): T {
  const js = stripTypeScript(code, { stripExport: true });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`"use strict";\n${js}\nreturn ${name};`)() as T;
}

describe('tokenize', () => {
  it('keeps template literals with nested interpolations as one token', () => {
    const toks = tokenize('const s = `a ${ {b: `x${1}`}.b } c`; x');
    expect(toks.map((t) => t.kind)).toEqual(['ident', 'ident', 'punct', 'template', 'punct', 'ident']);
  });

  it('distinguishes regex literals from division and skips comments', () => {
    const toks = tokenize('a = b / c; d = /x\\/y/g.test(s) // note\n/* block */ e');
    expect(toks.filter((t) => t.kind === 'regex').map((t) => t.value)).toEqual(['/x\\/y/g']);
    expect(toks.at(-1)!.value).toBe('e');
    expect(toks.at(-1)!.nl).toBe(true);
  });
});

describe('stripTypeScript', () => {
  it('removes parameter, return and variable annotations', () => {
    const out = stripTypeScript('function add(a: number, b?: number): number { const r: number = a + (b ?? 0); return r; }');
    expect(squash(out)).toBe(squash('function add(a, b) { const r = a + (b ?? 0); return r; }'));
    expect(run<(a: number, b?: number) => number>('function add(a: number, b?: number): number { return a + (b ?? 0); }', 'add')(2, 3)).toBe(5);
  });

  it('keeps the line structure (removed text becomes spaces)', () => {
    const src = 'function f(a: number,\n  b: string): void {}\n';
    const out = stripTypeScript(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('handles arrow functions with typed params and return types', () => {
    const src = 'const fmt = (value: number, digits: number = 2): string => value.toFixed(digits);';
    expect(squash(stripTypeScript(src))).toBe(squash('const fmt = (value, digits = 2) => value.toFixed(digits);'));
    expect(run<(v: number) => string>(src, 'fmt')(1.005)).toBe('1.00');
  });

  it('removes complex types: unions, generics, object, function and tuple types', () => {
    const src = [
      'function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {',
      '  const out: Partial<Record<string, unknown>> = {};',
      '  for (const k of keys) out[k as string] = obj[k];',
      '  return out as Pick<T, K>;',
      '}',
      'const apply = (fn: (x: number) => number, xs: Array<number | null>): [number, number] => [fn(1), xs.length];',
      'const shape: { a: number; b?: string } = { a: 1 };',
    ].join('\n');
    const pick = run<(o: object, k: string[]) => Record<string, unknown>>(src, 'pick');
    expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    expect(run<(fn: (x: number) => number, xs: unknown[]) => number[]>(src, 'apply')((x) => x * 10, [1, null])).toEqual([10, 2]);
    expect(run<{ a: number }>(src, 'shape')).toEqual({ a: 1 });
  });

  it('removes `as` / `satisfies` casts and non-null assertions', () => {
    const src = [
      'const cfg = { a: 1 } as const;',
      'const n = (JSON.parse("1") as unknown as number) + 1;',
      'const s = { x: 2 } satisfies Record<string, number>;',
      'function first(list?: number[]) { return list!.length ? list![0]! : 0; }',
    ].join('\n');
    expect(run<{ a: number }>(src, 'cfg')).toEqual({ a: 1 });
    expect(run<number>(src, 'n')).toBe(2);
    expect(run<{ x: number }>(src, 's')).toEqual({ x: 2 });
    expect(run<(l: number[]) => number>(src, 'first')([7])).toBe(7);
    // `!=` / `!==` / logical not are untouched.
    expect(squash(stripTypeScript('const t = a !== b && !c && d != e;'))).toBe(squash('const t = a !== b && !c && d != e;'));
  });

  it('removes type / interface declarations and export keywords', () => {
    const src = [
      'export type Money = { amount: number; currency: string };',
      'interface Row extends Base<string> { id: number; name?: string }',
      'export function total(rows: Row[]): number { return rows.length; }',
      'export const RATE: number = 1.5;',
    ].join('\n');
    const out = stripTypeScript(src, { stripExport: true });
    expect(out).not.toMatch(/\b(export|interface|type)\b/);
    expect(run<(r: unknown[]) => number>(src, 'total')([1, 2])).toBe(2);
    expect(run<number>(src, 'RATE')).toBe(1.5);
  });

  it('handles generic arrow functions and call type arguments', () => {
    const src = 'const id = <T,>(x: T): T => x;\nconst m = new Map<string, number>();\nconst v = id<number>(3);';
    expect(run<number>(src, 'v')).toBe(3);
    expect(run<Map<string, number>>(src, 'm')).toBeInstanceOf(Map);
  });

  it('handles object methods, class members, destructuring params and catch clauses', () => {
    const src = [
      'const utils = {',
      '  double(v: number): number { return v * 2; },',
      '  async later(ms: number = 0): Promise<number> { return ms; },',
      '};',
      'class Counter {',
      '  private count: number = 0;',
      '  readonly step?: number;',
      '  inc(by: number = 1): number { this.count += by; return this.count; }',
      '}',
      'function area({ w, h }: { w: number; h: number }): number { return w * h; }',
      'function safe(): string { try { throw new Error("x"); } catch (e: unknown) { return (e as Error).message; } }',
    ].join('\n');
    expect(run<{ double: (v: number) => number }>(src, 'utils').double(4)).toBe(8);
    const C = run<new () => { inc: (n?: number) => number }>(src, 'Counter');
    const c = new C();
    c.inc();
    expect(c.inc(2)).toBe(3);
    expect(run<(o: { w: number; h: number }) => number>(src, 'area')({ w: 2, h: 3 })).toBe(6);
    expect(run<() => string>(src, 'safe')()).toBe('x');
  });

  it('does not touch plain JavaScript (ternaries, object literals, labels, comparisons)', () => {
    const js = [
      'function f(a, b = a ? 1 : 2) {',
      '  const o = { a: 1, b: c ? d : e, [k]: (x) => x };',
      '  for (let i = 0; i < n; i++) { if (i > 2) break; }',
      '  return a < b ? o : { z: 1 };',
      '}',
      'const s = `x: ${a ? b : c}`;',
    ].join('\n');
    expect(stripTypeScript(js)).toBe(js);
  });

  it('returns unbalanced code unchanged', () => {
    expect(stripTypeScript('function f(a: number { ')).toBe('function f(a: number { ');
  });
});

describe('annotateUntypedParams', () => {
  it('adds any to untyped parameters only', () => {
    const out = annotateUntypedParams('function f(a, b: number, c = 1, ...rest) {}');
    expect(out).toBe('function f(a: any, b: number, c: any = 1, ...rest: any[]) {}');
  });

  it('handles arrows, destructuring, optional params, methods and bare arrow params', () => {
    expect(annotateUntypedParams('const g = ({ a, b }, [c], d?) => a;')).toBe('const g = ({ a, b }: any, [c]: any, d?: any) => a;');
    expect(annotateUntypedParams('const h = x => x * 2;')).toBe('const h = (x: any) => x * 2;');
    expect(annotateUntypedParams('const o = { m(v) { return v; } };')).toBe('const o = { m(v: any) { return v; } };');
    expect(annotateUntypedParams('items.map((it) => it.id)')).toBe('items.map((it: any) => it.id)');
  });

  it('leaves calls, control flow and catch clauses alone', () => {
    const src = 'function f(a: string) { if (a) { g(a); } try { h(); } catch (e) { return (a); } }';
    expect(annotateUntypedParams(src)).toBe(src);
  });
});

describe('topLevelDeclarations', () => {
  it('lists top-level functions, classes and variables only', () => {
    const code = [
      'export function formatMoney(v) { function inner() {} return v; }',
      'async function load() {}',
      'function* gen() {}',
      'const RATE = 1.2, TAX = 0.2;',
      'let counter = 0',
      'class Thing {}',
      'type Money = number;',
      'if (true) { var hidden = 1; }',
      'const fn = function named() {};',
    ].join('\n');
    expect(topLevelDeclarations(code)).toEqual(['formatMoney', 'load', 'gen', 'RATE', 'TAX', 'counter', 'Thing', 'fn']);
  });

  it('ignores declarations inside strings, templates and comments', () => {
    expect(topLevelDeclarations('// function nope() {}\nconst s = "function also() {}";\nconst t = `${"function x(){}"}`;')).toEqual(['s', 't']);
    expect(topLevelDeclarations(undefined)).toEqual([]);
  });
});
