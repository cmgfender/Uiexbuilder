/**
 * Expression evaluation for the designer preview. Expressions are plain JavaScript evaluated
 * against a scope object (state variables, data sources, context, repeat items, handler params).
 * See src/model/template.ts for the template-string rules shared with codegen.
 */
import { isExpr, type JsonValue, type PropValue } from '../model/types';
import { hasTemplate, parseTemplate, singleExpression, toText } from '../model/template';

export type Scope = Record<string, unknown>;
export type EvalResult = { ok: true; value: unknown } | { ok: false; error: string };

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const fnCache = new Map<string, (...args: unknown[]) => unknown>();

function scopeKeys(scope: Scope): string[] {
  return Object.keys(scope).filter((k) => IDENT_RE.test(k));
}

function compile(kind: 'expr' | 'stmts', code: string, keys: string[]): (...args: unknown[]) => unknown {
  const cacheKey = `${kind}\u0000${keys.join(',')}\u0000${code}`;
  let fn = fnCache.get(cacheKey);
  if (!fn) {
    const body =
      kind === 'expr' ? `"use strict"; return (${code}\n);` : `"use strict"; return (async () => {\n${code}\n})();`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    fn = new Function(...keys, body) as (...args: unknown[]) => unknown;
    if (fnCache.size > 2000) fnCache.clear();
    fnCache.set(cacheKey, fn);
  }
  return fn;
}

/** Evaluates a JS expression against a scope. Never throws. */
export function evaluate(code: string, scope: Scope): EvalResult {
  const trimmed = code.trim();
  if (!trimmed) return { ok: true, value: undefined };
  const keys = scopeKeys(scope);
  try {
    const fn = compile('expr', trimmed, keys);
    return { ok: true, value: fn(...keys.map((k) => scope[k])) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Checks that an expression parses (without evaluating it). */
export function checkExpressionSyntax(code: string): string | null {
  if (!code.trim()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(`"use strict"; return (${code}\n);`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Checks that a block of statements parses (custom code action). */
export function checkStatementsSyntax(code: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(`"use strict"; return (async () => {\n${code}\n})();`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Runs async statements (custom code action) against a scope. Rejects on error. */
export async function runStatements(code: string, scope: Scope): Promise<unknown> {
  const keys = scopeKeys(scope);
  const fn = compile('stmts', code, keys);
  return await (fn(...keys.map((k) => scope[k])) as Promise<unknown>);
}

/** Interpolates a template string (rule 3: always returns a string). */
export function interpolate(str: string, scope: Scope): string {
  if (!hasTemplate(str)) return str;
  return parseTemplate(str)
    .map((p) => {
      if (p.kind === 'text') return p.value;
      const r = evaluate(p.code, scope);
      return r.ok ? toText(r.value) : '';
    })
    .join('');
}

/** Resolves a template string (rules 1-3): a single segment yields the raw value. */
export function resolveTemplateString(str: string, scope: Scope): unknown {
  if (!hasTemplate(str)) return str;
  const single = singleExpression(str);
  if (single !== null) {
    const r = evaluate(single, scope);
    return r.ok ? r.value : undefined;
  }
  return interpolate(str, scope);
}

/** Resolves a literal JSON value, applying template rules to strings at any depth (rule 4). */
export function resolveLiteral(value: JsonValue, scope: Scope): unknown {
  if (typeof value === 'string') return resolveTemplateString(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveLiteral(v, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveLiteral(v, scope);
    return out;
  }
  return value;
}

/** Resolves any prop value (literal or { $expr }). */
export function resolvePropValue(value: PropValue, scope: Scope): unknown {
  if (isExpr(value)) {
    const r = evaluate(value.$expr, scope);
    return r.ok ? r.value : undefined;
  }
  return resolveLiteral(value, scope);
}

/** Resolves text content (rule 5): always a string. */
export function resolveText(text: string | undefined, scope: Scope): string {
  if (!text) return '';
  return interpolate(text, scope);
}
