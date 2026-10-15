/**
 * Autocomplete logic for expression and template inputs (pure, unit-tested):
 *  - find the identifier/path being typed at the cursor,
 *  - rank scope variables (plus live object keys) against it,
 *  - apply a suggestion and compute the new cursor position.
 */
import type { Scope } from '../runtime';
import { SCOPE_KIND_ORDER, type ScopeVariable } from './scope';

export interface TokenInfo {
  /** Start offset of the token in the value. */
  start: number;
  /** End offset (the token may extend past the cursor when editing mid-word). */
  end: number;
  /** Text typed so far (from `start` to the cursor). */
  text: string;
}

export interface TemplateTokenInfo extends TokenInfo {
  /** Offset of the `{{` opening the segment. */
  segmentStart: number;
  /** A closing `}}` follows the token. */
  closed: boolean;
}

const PATH_BEFORE_RE = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?$/;
const IDENT_CHAR_RE = /[\w$]/;

/** True when the cursor sits inside a '...' or "..." string literal (template literal text too). */
export function insideString(code: string): boolean {
  let quote: string | null = null;
  let tplDepth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (quote === '`' && ch === '$' && code[i + 1] === '{') {
        tplDepth++;
        quote = null;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '}' && tplDepth > 0) {
      tplDepth--;
      quote = '`';
    }
  }
  return quote !== null;
}

function extendEnd(value: string, cursor: number): number {
  let end = cursor;
  while (end < value.length && IDENT_CHAR_RE.test(value[end])) end++;
  return end;
}

/** The identifier/path being typed in an expression at `cursor`, or null. */
export function expressionTokenAt(value: string, cursor: number): TokenInfo | null {
  const before = value.slice(0, cursor);
  if (insideString(before)) return null;
  const m = PATH_BEFORE_RE.exec(before);
  if (!m) return null;
  const start = cursor - m[0].length;
  const prev = start > 0 ? value[start - 1] : '';
  // Not after a digit / identifier char (e.g. "1.5") or a property access on a call/index ("a().b").
  if (prev && (/[\w$]/.test(prev) || prev === '.' || prev === ')' || prev === ']')) return null;
  return { start, end: extendEnd(value, cursor), text: m[0] };
}

/** The path being typed inside an open `{{ … }}` segment of a template string, or null. */
export function templateTokenAt(value: string, cursor: number): TemplateTokenInfo | null {
  const before = value.slice(0, cursor);
  const open = before.lastIndexOf('{{');
  if (open === -1) return null;
  const inside = before.slice(open + 2);
  if (inside.includes('}}')) return null;
  const tok = expressionTokenAt(inside, inside.length);
  const end = extendEnd(value, cursor);
  const after = value.slice(end);
  const closed = /^\s*\}\}/.test(after);
  if (tok) return { start: open + 2 + tok.start, end, text: tok.text, segmentStart: open, closed };
  // Directly after `{{` (optionally with whitespace): suggest everything.
  if (/^\s*$/.test(inside)) return { start: cursor, end, text: '', segmentStart: open, closed };
  return null;
}

const KIND_RANK = new Map(SCOPE_KIND_ORDER.map((k, i) => [k, i]));

/**
 * Ranks variables against the typed text: prefix matches first, then matches at a path segment
 * or camelCase word start, then (for 2+ chars) substring matches. Exact matches are dropped.
 */
export function filterSuggestions(vars: ScopeVariable[], typed: string, limit = 50): ScopeVariable[] {
  const t = typed.toLowerCase();
  const scored: Array<{ v: ScopeVariable; score: number; i: number }> = [];
  for (const [i, v] of vars.entries()) {
    const name = v.name.toLowerCase();
    if (name === t) continue;
    let score = -1;
    if (!t) score = 0;
    else if (name.startsWith(t)) score = 0;
    else if (t.endsWith('.')) score = -1;
    else if (name.split('.').some((seg) => seg.startsWith(t))) score = 1;
    else if (v.name.split(/(?=[A-Z])|\./).some((w) => w.toLowerCase().startsWith(t))) score = 2;
    else if (t.length >= 2 && name.includes(t)) score = 3;
    if (score === -1) continue;
    // Prefer direct children over deeper paths when completing a path.
    const depth = name.split('.').length;
    scored.push({ v, score: score * 100 + (KIND_RANK.get(v.kind) ?? 9) * 4 + Math.min(depth, 3), i });
  }
  // Ties keep declaration order (e.g. context.user.firstName before lastName).
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.v);
}

function typeOfValue(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array (${v.length})`;
  return typeof v;
}

/**
 * Keys of the live value at a path, e.g. typing `record.` lists the record's properties. Only
 * walks own properties of plain objects/arrays (no evaluation).
 */
export function liveKeySuggestions(typed: string, scope: Scope | null | undefined, limit = 60): ScopeVariable[] {
  if (!scope) return [];
  const dot = typed.lastIndexOf('.');
  if (dot <= 0) return [];
  const base = typed.slice(0, dot);
  const parts = base.split('.');
  let cur: unknown = Object.prototype.hasOwnProperty.call(scope, parts[0]) ? scope[parts[0]] : undefined;
  for (const p of parts.slice(1)) {
    if (cur === null || typeof cur !== 'object') return [];
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return [];
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur === null || typeof cur !== 'object') return [];
  const keys = Array.isArray(cur) ? ['length'] : Object.keys(cur).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  return keys.slice(0, limit).map((k) => ({
    name: `${base}.${k}`,
    kind: 'property' as const,
    detail: k === 'length' && Array.isArray(cur) ? 'number' : typeOfValue((cur as Record<string, unknown>)[k]),
  }));
}

/** Merges static and live suggestions (static first, de-duplicated by name). */
export function mergeVariables(a: ScopeVariable[], b: ScopeVariable[]): ScopeVariable[] {
  const seen = new Set(a.map((v) => v.name));
  return [...a, ...b.filter((v) => !seen.has(v.name))];
}

export interface ApplyResult {
  value: string;
  cursor: number;
}

/** Replaces the token with `name` in an expression. */
export function applyExpressionSuggestion(value: string, token: TokenInfo, name: string): ApplyResult {
  const next = value.slice(0, token.start) + name + value.slice(token.end);
  return { value: next, cursor: token.start + name.length };
}

/** Replaces the token with `name` inside a `{{ }}` segment, normalising to `{{ name }}`. */
export function applyTemplateSuggestion(value: string, token: TemplateTokenInfo, name: string): ApplyResult {
  let start = token.start;
  // Normalise "{{name" / "{{   name" to "{{ name".
  const between = value.slice(token.segmentStart + 2, start);
  let prefix = '';
  if (/^\s*$/.test(between)) {
    start = token.segmentStart + 2;
    prefix = ' ';
  }
  let rest = value.slice(token.end);
  if (token.closed) rest = rest.replace(/^\s*\}\}/, '');
  const suffix = ' }}';
  const head = value.slice(0, start) + prefix + name;
  return { value: head + suffix + rest, cursor: head.length + suffix.length };
}

/** Inserts `text` at the selection (replacing it). */
export function insertAt(value: string, selStart: number, selEnd: number, text: string): ApplyResult {
  return { value: value.slice(0, selStart) + text + value.slice(selEnd), cursor: selStart + text.length };
}
