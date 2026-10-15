/**
 * Helper functions (Extension.helpers): module-level JavaScript / TypeScript declarations that
 * every expression of the extension can call (e.g. `formatMoney(amount)`).
 *
 * Pure and dependency-free (no React, no store) so the model, runtime, codegen and validation can
 * import it without cycles.
 *
 *  - helperNames(code)          top-level names the code declares (scope listing, name checks).
 *  - compileHelpers(code)       evaluates the code once (cached per source text) for the designer
 *                               preview, after stripping TypeScript syntax; returns the values of
 *                               the declared names or an error message. Never throws.
 *  - checkHelpersSyntax(code)   syntax error message, or null. TypeScript is accepted: types are
 *                               removed and enums, namespaces, parameter properties, overloads and
 *                               abstract classes are lowered like tsc (see tsTransform.ts).
 *  - prepareHelpersForTypeScript(code)  the helper source as emitted into generated .tsx files:
 *                               untyped parameters get `: any` so plain JavaScript helpers
 *                               type-check under `strict`.
 */
import { annotateUntypedParams, stripTypeScript, topLevelDeclarations } from './tsTransform';

/** Names of the top-level `function` / `class` / `const` / `let` / `var` declarations in helper code. */
export function helperNames(code: string | undefined): string[] {
  return topLevelDeclarations(code);
}

export interface CompiledHelpers {
  /** Declared names (see helperNames), in declaration order. */
  names: string[];
  /** Values of the declared names (functions, constants). Empty when compilation failed. */
  values: Record<string, unknown>;
  /** Syntax / runtime error raised while evaluating the code, or null. */
  error: string | null;
}

const EMPTY: CompiledHelpers = Object.freeze({ names: [], values: Object.freeze({}) as Record<string, unknown>, error: null });
const cache = new Map<string, CompiledHelpers>();
const CACHE_LIMIT = 40;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const IMPORT_RE = /^\s*import\s*(?:[\w${}*,\s]+\sfrom\s*)?['"]/m;

/** The engine's error, or a plain explanation for code the preview can never run (imports). */
function explain(code: string, e: unknown): string {
  const msg = message(e);
  if (IMPORT_RE.test(code) && /import/i.test(msg)) {
    return 'import statements are not supported in helper code — write the function here instead (hubspot and logger are available)';
  }
  return msg;
}

/** The helper code as a JavaScript function body (TypeScript syntax and `export` removed). */
export function helpersToJavaScript(code: string): string {
  return stripTypeScript(code, { stripExport: true });
}

/**
 * Evaluates helper code (once per distinct source text) and returns its top-level declarations.
 * The code runs in strict mode inside a function, without access to the extension's scope.
 */
export function compileHelpers(code: string | undefined): CompiledHelpers {
  if (typeof code !== 'string' || !code.trim()) return EMPTY;
  const cached = cache.get(code);
  if (cached) return cached;
  const names = helperNames(code);
  let result: CompiledHelpers;
  try {
    const js = helpersToJavaScript(code);
    const ret = `return { ${names.map((n) => `${JSON.stringify(n)}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`"use strict";\n${js}\n;${ret}`) as () => Record<string, unknown>;
    const values = fn() ?? {};
    result = { names, values, error: null };
  } catch (e) {
    result = { names, values: {}, error: explain(code, e) };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(code, result);
  return result;
}

/** Syntax error of helper code (TypeScript annotations are allowed), or null when it parses. */
export function checkHelpersSyntax(code: string | undefined): string | null {
  if (typeof code !== 'string' || !code.trim()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(`"use strict";\n${helpersToJavaScript(code)}\n`);
    return null;
  } catch (e) {
    return explain(code, e);
  }
}

/** Helper source as emitted into generated TypeScript: untyped parameters become `any`. */
export function prepareHelpersForTypeScript(code: string): string {
  return annotateUntypedParams(code.replace(/\r\n?/g, '\n')).replace(/\s+$/, '');
}

/** Example helpers offered by the Helpers editor ("Insert examples"), one entry per function. */
export const HELPER_EXAMPLES: ReadonlyArray<{ name: string; code: string }> = [
  {
    name: 'formatMoney',
    code: `/** Formats a number as money, e.g. formatMoney(1234.5) → "$1,234.50". */
function formatMoney(value: number | string, currency = 'USD'): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
}`,
  },
  {
    name: 'daysUntil',
    code: `/** Whole days from today until a date (negative when it is in the past). */
function daysUntil(date: string | number): number {
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}`,
  },
  {
    name: 'initials',
    code: `/** "Ada Lovelace" → "AL" */
function initials(name: string): string {
  return String(name ?? '')
    .split(/\\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase())
    .slice(0, 2)
    .join('');
}`,
  },
];

/** All example helpers as one snippet. */
export const HELPERS_EXAMPLE = `${HELPER_EXAMPLES.map((e) => e.code).join('\n\n')}\n`;

/**
 * Appends the example helpers that `code` does not declare yet. Returns the new code and the
 * names that were added (empty when every example already exists).
 */
export function appendHelperExamples(code: string | undefined): { code: string; added: string[] } {
  const current = typeof code === 'string' ? code : '';
  const declared = new Set(helperNames(current));
  const missing = HELPER_EXAMPLES.filter((e) => !declared.has(e.name));
  if (missing.length === 0) return { code: current, added: [] };
  const snippet = missing.map((e) => e.code).join('\n\n');
  const base = current.replace(/\s+$/, '');
  return { code: `${base ? `${base}\n\n` : ''}${snippet}\n`, added: missing.map((e) => e.name) };
}
