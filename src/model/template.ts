/**
 * `{{ expression }}` template strings — shared semantics for the preview runtime and codegen.
 *
 * Rules (codegen and runtime MUST agree):
 *  1. A string without `{{` is plain text.
 *  2. A string that is exactly one `{{ expr }}` segment (surrounding whitespace allowed) evaluates
 *     to the raw value of `expr` (not stringified) — e.g. a number prop set to "{{ count }}".
 *  3. A string mixing text and segments is interpolated: each segment is converted with `toText`
 *     (null/undefined/booleans -> '', objects -> JSON, others -> String(v)).
 *  4. Literal arrays/objects may contain template strings at any depth; each string follows 1-3.
 *  5. Text children (node.text) follow the same rules, except a single-segment text is still
 *     passed through `toText` (React children must be renderable).
 */

export type TemplatePart = { kind: 'text'; value: string } | { kind: 'expr'; code: string };

const SEGMENT_RE = /\{\{([\s\S]*?)\}\}/g;

export function hasTemplate(str: string): boolean {
  return str.includes('{{') && /\{\{[\s\S]*?\}\}/.test(str);
}

/** Splits a template string into text and expression parts. Empty `{{ }}` segments are dropped. */
export function parseTemplate(str: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const m of str.matchAll(SEGMENT_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ kind: 'text', value: str.slice(last, start) });
    const code = m[1].trim();
    if (code) parts.push({ kind: 'expr', code });
    last = start + m[0].length;
  }
  if (last < str.length) parts.push({ kind: 'text', value: str.slice(last) });
  // Merge adjacent text parts (possible when empty segments were dropped).
  const merged: TemplatePart[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (p.kind === 'text' && prev?.kind === 'text') prev.value += p.value;
    else merged.push({ ...p });
  }
  return merged;
}

/** If the string is exactly one `{{ expr }}` segment (whitespace around allowed), returns expr. */
export function singleExpression(str: string): string | null {
  const parts = parseTemplate(str);
  const nonBlank = parts.filter((p) => !(p.kind === 'text' && p.value.trim() === ''));
  if (nonBlank.length === 1 && nonBlank[0].kind === 'expr') return nonBlank[0].code;
  return null;
}

/** Canonical value -> display text conversion used by interpolation (mirrors generated `toText`). */
export function toText(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Source of the `toText` helper emitted into generated extensions when interpolation is used. */
export const TO_TEXT_HELPER_SOURCE = `const toText = (value: unknown): string =>
  value === null || value === undefined || typeof value === 'boolean'
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);`;

/** Collects every expression used in a template string. */
export function templateExpressions(str: string): string[] {
  return parseTemplate(str)
    .filter((p): p is { kind: 'expr'; code: string } => p.kind === 'expr')
    .map((p) => p.code);
}
