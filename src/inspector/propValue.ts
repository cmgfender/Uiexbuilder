/**
 * Pure helpers for prop values in the inspector: literal <-> expression conversion (the `fx`
 * toggle), type checks used to pick an editor, option-list bulk entry and small formatting helpers.
 */
import { hasTemplate, parseTemplate, singleExpression } from '../model/template';
import { isExpr, type JsonValue, type PropValue } from '../model/types';
import type { EnumOption, PropDef, PropType } from '../registry/types';

export type PropKind = PropType['kind'];

/** Kinds whose literal value is a string that may contain `{{ }}` template segments. */
const TEMPLATE_KINDS = new Set<PropKind>(['string', 'url', 'href']);

export function isTemplateKind(kind: PropKind): boolean {
  return TEMPLATE_KINDS.has(kind);
}

export function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function escapeTemplateText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** A literal string (possibly a `{{ }}` template) as an equivalent JavaScript expression. */
export function stringToExpr(str: string): string {
  if (!hasTemplate(str)) return JSON.stringify(str);
  const single = singleExpression(str);
  if (single !== null) return single;
  const body = parseTemplate(str)
    .map((p) => (p.kind === 'text' ? escapeTemplateText(p.value) : `\${${p.code}}`))
    .join('');
  return `\`${body}\``;
}

/** A JSON literal as JavaScript source (template strings at any depth become JS expressions). */
export function jsonToJs(value: JsonValue): string {
  if (typeof value === 'string') return stringToExpr(value);
  if (Array.isArray(value)) return `[${value.map(jsonToJs).join(', ')}]`;
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([k, v]) => `${IDENT_RE.test(k) ? k : JSON.stringify(k)}: ${jsonToJs(v)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

/**
 * Expression text for the `fx` toggle when switching a literal to expression mode. An unset value
 * yields '' (the user starts typing; the default is shown as placeholder).
 */
export function literalToExpr(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  return jsonToJs(value);
}

/**
 * Parses a template literal such as `Hello ${name}!` back into a `{{ }}` template string.
 * Returns null for anything more complex (nested backticks, tagged templates...).
 */
export function templateLiteralToTemplate(code: string): string | null {
  const src = code.trim();
  if (src.length < 2 || src[0] !== '`' || src[src.length - 1] !== '`') return null;
  const inner = src.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '`') return null;
    if (ch === '\\') {
      const next = inner[i + 1];
      if (next === undefined) return null;
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (ch === '$' && inner[i + 1] === '{') {
      let depth = 1;
      let j = i + 2;
      while (j < inner.length && depth > 0) {
        if (inner[j] === '`') return null;
        if (inner[j] === '{') depth++;
        else if (inner[j] === '}') depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0) return null;
      const code = inner.slice(i + 2, j).trim();
      if (code.includes('}}')) return null;
      out += `{{ ${code} }}`;
      i = j + 1;
      continue;
    }
    if (ch === '{' && inner[i + 1] === '{') return null;
    out += ch;
    i++;
  }
  return out;
}

/** Parses JS source that is a plain literal (JSON, or a single-quoted string). */
export function parseJsLiteral(code: string): { ok: true; value: JsonValue } | { ok: false } {
  const src = code.trim();
  if (!src) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(src) as JsonValue };
  } catch {
    /* not JSON */
  }
  const single = /^'((?:[^'\\\n]|\\.)*)'$/.exec(src);
  if (single) {
    try {
      const asJson = `"${single[1].replace(/\\'/g, "'").replace(/"/g, '\\"')}"`;
      return { ok: true, value: JSON.parse(asJson) as string };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

/** Whether a literal value has the shape the prop's editor expects. */
export function matchesKind(value: JsonValue, type: PropType): boolean {
  switch (type.kind) {
    case 'string':
    case 'url':
    case 'icon':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return type.options.some((o) => o.value === value);
    case 'href':
      return typeof value === 'string' || (isPlainObject(value) && (value.url === undefined || typeof value.url === 'string'));
    case 'options':
      return Array.isArray(value) && value.every((o) => isPlainObject(o));
    case 'stringList':
      return Array.isArray(value) && value.every((o) => typeof o === 'string');
    case 'date':
      return isPlainObject(value) && typeof value.year === 'number' && typeof value.month === 'number' && typeof value.date === 'number';
    case 'time':
      return isPlainObject(value) && typeof value.hours === 'number' && typeof value.minutes === 'number';
    case 'object':
      return isPlainObject(value);
    case 'json':
      return true;
    default:
      return true;
  }
}

export type ExprToLiteralResult = { ok: true; value: JsonValue | undefined } | { ok: false };

/**
 * Converts expression text back to a literal for the `fx` toggle. Plain literals are parsed;
 * other expressions are kept as `{{ expr }}` text for string-like props. Returns `{ ok: false }`
 * when the expression cannot be represented by the prop's literal editor.
 */
export function exprToLiteral(code: string, type: PropType): ExprToLiteralResult {
  const src = code.trim();
  if (!src) return { ok: true, value: undefined };
  const lit = parseJsLiteral(src);
  if (lit.ok && matchesKind(lit.value, type)) return { ok: true, value: lit.value };
  if (isTemplateKind(type.kind)) {
    const tpl = templateLiteralToTemplate(src);
    if (tpl !== null) return { ok: true, value: tpl };
    if (src.includes('}}')) return { ok: false };
    return { ok: true, value: `{{ ${src} }}` };
  }
  return { ok: false };
}

/**
 * For non-string kinds a literal template string (e.g. a number prop set to "{{ count }}") can't be
 * shown by the literal editor; the inspector presents it as an expression instead.
 */
export function templateValueAsExpr(value: PropValue | undefined, type: PropType): string | null {
  if (typeof value !== 'string' || isTemplateKind(type.kind) || !hasTemplate(value)) return null;
  return stringToExpr(value);
}

/** True when a literal value cannot be edited with the prop's editor (shown as raw JSON instead). */
export function isMismatchedLiteral(value: PropValue | undefined, type: PropType): boolean {
  if (value === undefined || isExpr(value)) return false;
  return !matchesKind(value as JsonValue, type);
}

/** Display text of an enum option. */
export function optionLabel(o: EnumOption): string {
  return o.label ?? String(o.value);
}

/** Human readable rendering of a default value (placeholders, "(default)" markers). */
export function formatDefault(def: Pick<PropDef, 'defaultValue' | 'type'>): string | undefined {
  const d = def.defaultValue;
  if (d === undefined) return undefined;
  if (def.type.kind === 'enum') {
    const o = def.type.options.find((x) => x.value === d);
    if (o) return optionLabel(o);
  }
  if (typeof d === 'string') return d;
  return JSON.stringify(d);
}

/** Whether the prop is required for the node's current props (required or requiredWhen). */
export function isPropRequired(def: PropDef, props: Record<string, unknown>): boolean {
  if (def.required) return true;
  try {
    return !!def.requiredWhen?.(props);
  } catch {
    return false;
  }
}

/** Whether the prop is shown for the node's current props (visibleWhen). */
export function isPropVisible(def: PropDef, props: Record<string, unknown>): boolean {
  if (!def.visibleWhen) return true;
  try {
    return def.visibleWhen(props);
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Options lists
// ---------------------------------------------------------------------------

export interface OptionItem {
  label: string;
  value: string | number;
  description?: string;
  initialIsChecked?: boolean;
  readOnly?: boolean;
  [key: string]: JsonValue | undefined;
}

/** Slug used as the value of an option entered without one: "New York" -> "new_york". */
export function optionValueFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || label.trim();
}

/**
 * Bulk entry: one option per line, "Label" or "Label | value" (value derived from the label when
 * omitted). Blank lines are ignored.
 */
export function parseOptionLines(text: string): OptionItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bar = line.indexOf('|');
      if (bar === -1) return { label: line, value: optionValueFromLabel(line) };
      const label = line.slice(0, bar).trim();
      const value = line.slice(bar + 1).trim();
      return { label: label || value, value: value || optionValueFromLabel(label) };
    });
}

/** Inverse of parseOptionLines (used to prefill the bulk editor). */
export function optionsToLines(options: OptionItem[]): string {
  return options
    .map((o) => {
      const v = String(o.value ?? '');
      return v === optionValueFromLabel(o.label ?? '') ? (o.label ?? '') : `${o.label ?? ''} | ${v}`;
    })
    .join('\n');
}

/** Moves an item within a list (returns a new array). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// ---------------------------------------------------------------------------
// Dates & times ({ year, month (0-based), date } / { hours, minutes })
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');

export function dateToInput(v: JsonValue | undefined): string {
  if (!isPlainObject(v)) return '';
  const { year, month, date } = v;
  if (typeof year !== 'number' || typeof month !== 'number' || typeof date !== 'number') return '';
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(date)}`;
}

export function inputToDate(s: string): JsonValue | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  return { year: Number(m[1]), month: Number(m[2]) - 1, date: Number(m[3]) };
}

export function timeToInput(v: JsonValue | undefined): string {
  if (!isPlainObject(v)) return '';
  const { hours, minutes } = v;
  if (typeof hours !== 'number' || typeof minutes !== 'number') return '';
  return `${pad(hours)}:${pad(minutes)}`;
}

export function inputToTime(s: string): JsonValue | undefined {
  const m = /^(\d{2}):(\d{2})/.exec(s);
  if (!m) return undefined;
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

/** Light URL check for hints (templates are accepted as-is). */
export function urlHint(value: string): string | null {
  const v = value.trim();
  if (!v || hasTemplate(v)) return null;
  if (/^(https?:)?\/\//i.test(v) || /^(mailto|tel|data):/i.test(v) || v.startsWith('/') || v.startsWith('./')) {
    if (/^https?:\/\/[^/\s.]+$/i.test(v) && !/^https?:\/\/localhost/i.test(v)) return 'This URL has no domain extension (e.g. .com).';
    if (/\s/.test(v) && !v.startsWith('data:')) return 'URLs cannot contain spaces.';
    return null;
  }
  return 'Use a full URL starting with https://';
}

/** Short one-line rendering of any value for previews ("= …" lines). */
export function formatPreviewValue(value: unknown, max = 80): string {
  let s: string;
  if (value === undefined) s = 'undefined';
  else if (typeof value === 'function') s = `ƒ ${(value as { name?: string }).name || 'function'}()`;
  else if (typeof value === 'string') s = JSON.stringify(value);
  else if (value instanceof Error) s = `Error: ${value.message}`;
  else if (typeof value === 'object' && value !== null) {
    try {
      s = JSON.stringify(value) ?? String(value);
    } catch {
      s = String(value);
    }
    if (Array.isArray(value)) s = `(${value.length}) ${s}`;
  } else s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * JSON for editing: nested structure on separate lines, but small flat objects/arrays (e.g. chart
 * rows) on a single line each.
 */
export function prettyJson(value: JsonValue, indent = ''): string {
  const flat = (v: JsonValue) =>
    v === null ||
    typeof v !== 'object' ||
    (Array.isArray(v)
      ? v.every((x) => x === null || typeof x !== 'object')
      : Object.values(v).every((x) => x === null || typeof x !== 'object'));
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (flat(value)) {
    const one = Array.isArray(value)
      ? `[${value.map((x) => JSON.stringify(x)).join(', ')}]`
      : Object.keys(value).length
        ? `{ ${Object.entries(value)
            .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
            .join(', ')} }`
        : '{}';
    if (one.length + indent.length <= 72) return one;
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((v) => inner + prettyJson(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, inner)}`).join(',\n')}\n${indent}}`;
}
