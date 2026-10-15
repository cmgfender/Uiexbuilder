/**
 * Expression evaluation for the designer preview. Expressions are plain JavaScript evaluated
 * against a scope object (state variables, data sources, context, repeat items, handler params).
 * See src/model/template.ts for the template-string rules shared with codegen.
 *
 * Safety:
 *  - loops in evaluated code are guarded (runtime/loopGuard.ts): a runaway loop throws instead of
 *    freezing the tab;
 *  - while the active project's code is not trusted (model/trust.ts — e.g. a document imported
 *    from a file), only side-effect-free expressions run (runtime/safeExpression.ts); anything
 *    else returns a `blocked` result and templates show the expression's source instead.
 */
import { isExpr, type JsonValue, type PropValue } from '../model/types';
import { hasTemplate, parseTemplate, singleExpression, toText } from '../model/template';
import { codeExecutionAllowed } from '../model/trust';
import { guardLoops } from './loopGuard';
import { isSafeExpression } from './safeExpression';

export type Scope = Record<string, unknown>;
export type EvalResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: string;
      /** The expression was not run because the project's code is not trusted. */
      blocked?: true;
    };

/** Error text of expressions that do not run while a project's code is untrusted. */
export const CODE_PAUSED_MESSAGE = 'Code of this imported project is paused until you trust it';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const fnCache = new Map<string, (...args: unknown[]) => unknown>();

function scopeKeys(scope: Scope): string[] {
  return Object.keys(scope).filter((k) => IDENT_RE.test(k));
}

/**
 * Names every expression can use unless the scope declares its own: `toText` converts a value to
 * display text exactly like `{{ }}` interpolation (generated code emits the same helper), so an
 * expression such as `` `Owner: ${toText(owner)}` `` renders like the template `Owner: {{ owner }}`.
 */
const BUILTINS: Record<string, unknown> = { toText };

/** Parameter names and argument values for compiling user code against a scope. */
function bindScope(scope: Scope): { keys: string[]; values: unknown[] } {
  const keys = scopeKeys(scope);
  const values = keys.map((k) => scope[k]);
  for (const [name, value] of Object.entries(BUILTINS)) {
    if (name in scope) continue;
    keys.push(name);
    values.push(value);
  }
  return { keys, values };
}

function compile(kind: 'expr' | 'stmts', code: string, keys: string[]): (...args: unknown[]) => unknown {
  const cacheKey = `${kind}\u0000${keys.join(',')}\u0000${code}`;
  let fn = fnCache.get(cacheKey);
  if (!fn) {
    const guarded = guardLoops(code);
    const body =
      kind === 'expr' ? `"use strict"; return (${guarded}\n);` : `"use strict"; return (async () => {\n${guarded}\n})();`;
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
  const { keys, values } = bindScope(scope);
  if (!codeExecutionAllowed() && !isSafeExpression(trimmed, keys)) {
    return { ok: false, error: CODE_PAUSED_MESSAGE, blocked: true };
  }
  try {
    const fn = compile('expr', trimmed, keys);
    return { ok: true, value: fn(...values) };
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
  if (!codeExecutionAllowed()) throw new Error(CODE_PAUSED_MESSAGE);
  const { keys, values } = bindScope(scope);
  const fn = compile('stmts', code, keys);
  return await (fn(...values) as Promise<unknown>);
}

/**
 * Called when an expression fails while resolving a template / prop (the value then degrades to
 * '' or undefined). The preview uses it to surface errors that would crash the card on HubSpot.
 */
export type ExpressionErrorHandler = (code: string, error: string) => void;

/** Interpolates a template string (rule 3: always returns a string). */
export function interpolate(str: string, scope: Scope, onError?: ExpressionErrorHandler): string {
  if (!hasTemplate(str)) return str;
  return parseTemplate(str)
    .map((p) => {
      if (p.kind === 'text') return p.value;
      const r = evaluate(p.code, scope);
      if (!r.ok && r.blocked) return `{{ ${p.code} }}`;
      if (!r.ok) onError?.(p.code, r.error);
      return r.ok ? toText(r.value) : '';
    })
    .join('');
}

/** Resolves a template string (rules 1-3): a single segment yields the raw value. */
export function resolveTemplateString(str: string, scope: Scope, onError?: ExpressionErrorHandler): unknown {
  if (!hasTemplate(str)) return str;
  const single = singleExpression(str);
  if (single !== null) {
    const r = evaluate(single, scope);
    if (!r.ok && r.blocked) return str;
    if (!r.ok) onError?.(single, r.error);
    return r.ok ? r.value : undefined;
  }
  return interpolate(str, scope, onError);
}

/** Resolves a literal JSON value, applying template rules to strings at any depth (rule 4). */
export function resolveLiteral(value: JsonValue, scope: Scope, onError?: ExpressionErrorHandler): unknown {
  if (typeof value === 'string') return resolveTemplateString(value, scope, onError);
  if (Array.isArray(value)) return value.map((v) => resolveLiteral(v, scope, onError));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveLiteral(v, scope, onError);
    return out;
  }
  return value;
}

/** Resolves any prop value (literal or { $expr }). */
export function resolvePropValue(value: PropValue, scope: Scope, onError?: ExpressionErrorHandler): unknown {
  if (isExpr(value)) {
    const r = evaluate(value.$expr, scope);
    if (!r.ok && !r.blocked) onError?.(value.$expr, r.error);
    return r.ok ? r.value : undefined;
  }
  return resolveLiteral(value, scope, onError);
}

/** Resolves text content (rule 5): always a string. */
export function resolveText(text: string | undefined, scope: Scope, onError?: ExpressionErrorHandler): string {
  if (!text) return '';
  return interpolate(text, scope, onError);
}
