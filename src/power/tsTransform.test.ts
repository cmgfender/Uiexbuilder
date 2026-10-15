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

/** Evaluates `expr` after the stripped helper code. */
function evalAfter(code: string, expr: string): unknown {
  const js = stripTypeScript(code, { stripExport: true });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`"use strict";\n${js}\n;return (${expr});`)();
}

describe('stripTypeScript: TypeScript constructs with runtime meaning (lowered like tsc)', () => {
  it('drops function and method overload signatures (with or without semicolons)', () => {
    const fn = 'export function o(a: string): string;\nexport function o(a: number): number;\nexport function o(a: any) { return a; }';
    expect(evalAfter(fn, 'o(3)')).toBe(3);
    expect(evalAfter('function g(a: string): string\nfunction g(a: any) { return a }', "g('x')")).toBe('x');
    expect(evalAfter('class C { m(a: string): string; m(a: number): number; m(a: any) { return a; } }', 'new C().m(5)')).toBe(5);
    expect(evalAfter('class C {\n  m(a: string): string\n  m(a: any) {\n    return a\n  }\n}', 'new C().m(6)')).toBe(6);
    // A missing body that is not a signature is still a syntax error.
    expect(() => evalAfter('function broken() return 1', '1')).toThrow();
  });

  it('removes `this` parameters', () => {
    expect(evalAfter('function who(this: any, n: number) { return n; }', 'who(4)')).toBe(4);
    expect(evalAfter('function w(this: void) { return 1; }', 'w()')).toBe(1);
    expect(evalAfter('class C { m(this: C, a: number) { return a; } }', 'new C().m(9)')).toBe(9);
  });

  it('assigns constructor parameter properties (after super() in derived classes)', () => {
    expect(evalAfter('class Money { constructor(private cents: number) {} dollars() { return this.cents / 100; } }', 'new Money(250).dollars()')).toBe(2.5);
    const derived = [
      'class Base { constructor(public a: number) {} }',
      'class D extends Base { constructor(a: number, private readonly b: number = 2) { super(a); } sum() { return this.a + this.b; } }',
    ].join('\n');
    expect(evalAfter(derived, 'new D(1).sum()')).toBe(3);
    expect(evalAfter('class P { total: number; constructor(private a: number, public b = 2) { this.total = this.a + this.b; } }', 'new P(3).total')).toBe(5);
  });

  it('lowers enums with reverse mapping, auto-increment and member references', () => {
    expect(evalAfter('enum Dir { Up = 1, Down, Left, Right }', '[Dir.Right, Dir[2]]')).toEqual([4, 'Down']);
    expect(evalAfter('enum Flags { None = 0, A = 1 << 0, B = 1 << 1, AB = A | B }', '[Flags.AB, Flags[3]]')).toEqual([3, 'AB']);
    expect(evalAfter("const enum Stage { Open = 'open', Won = \"won\", }", "[Stage.Won, Stage['won']]")).toEqual(['won', undefined]);
    expect(evalAfter("export enum Q { 'a-b' = 1, \"c d\" }\nfunction label(q: Q): string { return Q[q]; }", "[Q['a-b'], label(2)]")).toEqual([1, 'c d']);
  });

  it('lowers namespaces (dotted names, nested namespaces, live let exports, private members)', () => {
    expect(evalAfter('namespace Util { export const k = 3; const hidden = 1; }', '[Util.k, Util.hidden]')).toEqual([3, undefined]);
    expect(evalAfter('namespace A.B { export const x: number = 2; }', 'A.B.x')).toBe(2);
    expect(evalAfter('namespace Counter { export let n = 0; export function inc(): number { n++; return n; } }', '[Counter.inc(), Counter.inc(), Counter.n]')).toEqual([1, 2, 2]);
    const nested = "namespace Outer { export namespace Inner { export const v = 'in'; } export enum E { X = 3 } export type T = string; export class Box { constructor(public w: number) {} } }";
    expect(evalAfter(nested, '[Outer.Inner.v, Outer.E.X, new Outer.Box(4).w]')).toEqual(['in', 3, 4]);
  });

  it('removes abstract / declare members, index signatures and optional method markers', () => {
    const shapes = [
      'abstract class Shape { abstract name: string; protected abstract area(): number; describe() { return this.name + this.area(); } }',
      "class Sq extends Shape { name = 'sq'; area() { return 4; } }",
    ].join('\n');
    expect(evalAfter(shapes, 'new Sq().describe()')).toBe('sq4');
    expect(evalAfter('class A { declare x: number; y = 1; }', 'Object.keys(new A())')).toEqual(['y']);
    expect(evalAfter('class M { [key: string]: any; a = 1; }', 'new M().a')).toBe(1);
    expect(evalAfter('class O { m?(): void; n?() { return 2; } }', 'new O().n()')).toBe(2);
  });

  it('strips TypeScript inside template literal interpolations (keeping nested template text)', () => {
    const code = "function msg(e: unknown, n?: number): string { return `Failed: ${(e as Error).message} (${n!}) ${n ? `multi\nline` : ''}`; }";
    expect(evalAfter(code, "msg(new Error('boom'), 2)")).toBe('Failed: boom (2) multi\nline');
    expect(evalAfter('const get = (o?: { f(): number }) => o!.f!();', 'get({ f: () => 4 })')).toBe(4);
  });

  it('keeps the number of lines when lowering', () => {
    const src = 'enum Size {\n  Small = 1,\n  Large\n}\nnamespace N {\n  export const a = 1;\n}\n';
    expect(stripTypeScript(src).split('\n').length).toBe(src.split('\n').length);
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

  it('lists enums, namespaces and abstract classes but not ambient declarations', () => {
    const code = [
      'enum Color { Red }',
      'const enum Size { S }',
      'export namespace Util.Inner { export const a = 1; }',
      'abstract class Shape {}',
      'declare const VERSION: string;',
      'declare function external(): void;',
    ].join('\n');
    expect(topLevelDeclarations(code)).toEqual(['Color', 'Size', 'Util', 'Shape']);
  });

  it('ignores declarations inside strings, templates and comments', () => {
    expect(topLevelDeclarations('// function nope() {}\nconst s = "function also() {}";\nconst t = `${"function x(){}"}`;')).toEqual(['s', 't']);
    expect(topLevelDeclarations(undefined)).toEqual([]);
  });
});
