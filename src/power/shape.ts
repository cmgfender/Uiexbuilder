/**
 * Shaping a list without code (pure): filter rows by conditions, sort by a field, keep the first N
 * and add formatted fields (currency, number, percent, date, relative date) — for CRM search /
 * association results, fetch results and array state. A shaped list is an ordinary computed value
 * whose expression has this fixed, readable shape (so runtime, validation and codegen need nothing
 * new, and the exported TSX is plain code):
 *
 *   [...(deals ?? [])]
 *     .filter((row) => Number(row.properties.amount) > 1000)
 *     .sort((a, b) => Number(b.properties.amount ?? 0) - Number(a.properties.amount ?? 0))
 *     .slice(0, 5)
 *     .map((row) => ({ ...row, amountFormatted: Number(row.properties.amount || 0).toLocaleString(…) }))
 *
 * `[...(…)]` copies the list (sort changes the array it is called on, and the data of a hook must
 * not change) and types it as `any[]` in the exported TypeScript even when the source is untyped
 * (a fetch result), so the callbacks' rows need no annotations. `parseShape` recognises exactly this shape again; anything else stays a plain
 * expression.
 */
import { tokenize, type Token } from '../model/jsTokens';
import type { DataSource, Extension } from '../model/types';
import { isSimpleRef } from '../inspector/power-conditions';

/**
 * How values compare: as text, as numbers, or as numbers written with symbols — HubSpot's
 * formatted values such as "$48,000.00" or "45%" ('formatted': the symbols and thousands
 * separators are dropped before comparing, so $7,800 comes before $48,000).
 */
export type SortAs = 'text' | 'number' | 'formatted';

export interface ShapeSort {
  /** Field path inside a row, e.g. ['properties', 'amount']. */
  field: string[];
  dir: 'asc' | 'desc';
  as: SortAs;
}

export type FormatKind = 'currency' | 'number' | 'percent' | 'date' | 'relative';

export interface ShapeFormat {
  /** Name of the added field, e.g. `amountFormatted` (a valid identifier). */
  name: string;
  field: string[];
  kind: FormatKind;
  /** ISO currency code for 'currency' (default USD). */
  currency?: string;
  /** Maximum decimals for currency / number / percent (default 0, number 2). */
  decimals?: number;
}

export interface ListShape {
  /** The list: an expression, e.g. `deals` or `weather.items`. */
  source: string;
  /** Condition over `row` (a builder condition or any expression); empty = keep every row. */
  filter?: string;
  sort?: ShapeSort;
  /** Keep at most this many rows. */
  limit?: number;
  formats?: ShapeFormat[];
}

/** Name of each row inside the filter and formats. */
export const ROW = 'row';

export const FORMAT_KINDS: ReadonlyArray<{ value: FormatKind; label: string; example: string }> = [
  { value: 'currency', label: 'Currency', example: '$48,000' },
  { value: 'number', label: 'Number', example: '48,000.5' },
  { value: 'percent', label: 'Percent', example: '0.25 → 25%' },
  { value: 'date', label: 'Date', example: 'Sep 21, 2026' },
  { value: 'relative', label: 'Relative date', example: 'in 3 days' },
];

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'BRL', 'MXN', 'SGD', 'NZD'];

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** `.properties.amount` / `["first name"]` for a field path. */
export function accessor(path: string[]): string {
  return path.map((k) => (IDENT_RE.test(k) ? `.${k}` : /^\d+$/.test(k) ? `[${k}]` : `[${JSON.stringify(k)}]`)).join('');
}

/** `properties.amount` — a field path as people read it. */
export function fieldLabel(path: string[]): string {
  if (path.length === 2 && path[0] === 'properties') return path[1];
  return path.join('.');
}

function decimals(f: ShapeFormat, fallback: number): number {
  const d = f.decimals;
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6 ? d : fallback;
}

function dateOf(x: string): string {
  return `new Date(isNaN(${x}) ? ${x} : Number(${x}))`;
}

/** The expression that formats one field of `row`. */
export function formatExpr(f: ShapeFormat, row = ROW): string {
  const x = `${row}${accessor(f.field)}`;
  switch (f.kind) {
    case 'currency': {
      const code = /^[A-Z]{3}$/.test(f.currency ?? '') ? f.currency! : 'USD';
      return `Number(${x} || 0).toLocaleString("en-US", { style: "currency", currency: "${code}", maximumFractionDigits: ${decimals(f, 0)} })`;
    }
    case 'number':
      return `Number(${x} || 0).toLocaleString("en-US", { maximumFractionDigits: ${decimals(f, 2)} })`;
    case 'percent':
      return `Number(${x} || 0).toLocaleString("en-US", { style: "percent", maximumFractionDigits: ${decimals(f, 0)} })`;
    case 'date':
      return `${x} ? ${dateOf(x)}.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""`;
    case 'relative':
      return (
        `${x} ? ((days) => new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(` +
        `Math.abs(days) < 31 ? days : Math.round(days / (Math.abs(days) < 365 ? 30.4 : 365)), ` +
        `Math.abs(days) < 31 ? "day" : Math.abs(days) < 365 ? "month" : "year"))` +
        `(Math.round((${dateOf(x)}.getTime() - Date.now()) / 86400000)) : ""`
      );
  }
}

/** The compare function body of a sort. */
export function sortExpr(s: ShapeSort): string {
  const [first, second] = s.dir === 'asc' ? ['a', 'b'] : ['b', 'a'];
  const acc = accessor(s.field);
  if (s.as === 'formatted') {
    const num = (row: string) => `Number(String(${row}${acc} ?? "").replace(/[^0-9.-]/g, ""))`;
    return `${num(first)} - ${num(second)}`;
  }
  return s.as === 'number'
    ? `Number(${first}${acc} ?? 0) - Number(${second}${acc} ?? 0)`
    : `String(${first}${acc} ?? "").localeCompare(String(${second}${acc} ?? ""))`;
}

function sourceTerm(source: string): string {
  const s = source.trim() || '[]';
  return `[...(${isSimpleRef(s) ? s : `(${s})`} ?? [])]`;
}

/** The computed-value expression of a shaped list. */
export function shapeToExpr(shape: ListShape): string {
  const lines = [sourceTerm(shape.source)];
  const filter = shape.filter?.trim();
  if (filter) lines.push(`.filter((${ROW}) => ${filter})`);
  if (shape.sort && shape.sort.field.length) lines.push(`.sort((a, b) => ${sortExpr(shape.sort)})`);
  if (typeof shape.limit === 'number' && Number.isInteger(shape.limit) && shape.limit >= 0) lines.push(`.slice(0, ${shape.limit})`);
  const formats = (shape.formats ?? []).filter((f) => IDENT_RE.test(f.name) && f.field.length);
  if (formats.length) lines.push(`.map((${ROW}) => ({ ...${ROW}, ${formats.map((f) => `${f.name}: ${formatExpr(f)}`).join(', ')} }))`);
  return lines.join('\n  ');
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface Tok {
  kind: Token['kind'];
  text: string;
  start: number;
  end: number;
}

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function close(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'templateHead') depth++;
    else if (t.kind === 'templateTail') depth--;
    else if (t.kind === 'punct' && OPEN[t.text]) depth++;
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
    if (depth === 0) return i;
  }
  return -1;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const ACCESSOR_RE = '((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\]|\\["(?:[^"\\\\]|\\\\.)*"\\])+)';

/** Field path of an accessor written by `accessor`. */
function readAccessor(text: string): string[] | null {
  const out: string[] = [];
  const re = /\.([A-Za-z_$][\w$]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) out.push(m[1]);
    else if (m[2] !== undefined) out.push(m[2]);
    else {
      try {
        out.push(JSON.parse(m[3]) as string);
      } catch {
        return null;
      }
    }
    at = re.lastIndex;
  }
  return at === text.length && out.length ? out : null;
}

function readSort(body: string): ShapeSort | null {
  const m = new RegExp(`^(?:Number\\(String|Number|String)\\(([ab])${ACCESSOR_RE} `).exec(body);
  if (!m) return null;
  const field = readAccessor(m[2]);
  if (!field) return null;
  for (const as of ['number', 'text', 'formatted'] as const) {
    for (const dir of ['asc', 'desc'] as const) {
      const s: ShapeSort = { field, dir, as };
      if (squash(sortExpr(s)) === body) return s;
    }
  }
  return null;
}

function readFormat(name: string, body: string): ShapeFormat | null {
  const m = new RegExp(`${ROW}${ACCESSOR_RE}`).exec(body);
  if (!m) return null;
  const field = readAccessor(m[1]);
  if (!field) return null;
  const currency = /currency: "([A-Z]{3})"/.exec(body)?.[1];
  const d = /maximumFractionDigits: (\d)\b/.exec(body)?.[1];
  for (const kind of ['currency', 'number', 'percent', 'date', 'relative'] as const) {
    const f: ShapeFormat = { name, field, kind };
    if (kind === 'currency') f.currency = currency ?? 'USD';
    // Decimals only when they differ from the format's default (currency / percent 0, number 2).
    if (d !== undefined && (kind === 'currency' || kind === 'number' || kind === 'percent') && Number(d) !== (kind === 'number' ? 2 : 0))
      f.decimals = Number(d);
    if (squash(formatExpr(f)) === body) return f;
  }
  return null;
}

/** Splits at top-level commas. */
function splitCommas(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if ((t.kind === 'punct' && OPEN[t.text]) || t.kind === 'templateHead') {
      const j = close(toks, i);
      if (j === -1) return [toks];
      cur.push(...toks.slice(i, j + 1));
      i = j;
      continue;
    }
    if (t.kind === 'punct' && t.text === ',') {
      out.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  out.push(cur);
  return out;
}

/** Recognises an expression written by `shapeToExpr`; null for anything else. */
export function parseShape(expr: string): ListShape | null {
  const src = expr ?? '';
  const all = tokenize(src);
  if (all.some((t) => t.kind === 'comment')) return null;
  const toks: Tok[] = all.filter((t) => t.kind !== 'whitespace').map((t) => ({ ...t, end: t.start + t.text.length }));
  const text = (a: number, b: number) => (a > b ? '' : src.slice(toks[a].start, toks[b].end));
  // [...(SOURCE ?? [])]
  if (toks[0]?.text !== '[' || toks[1]?.text !== '...' || toks[2]?.text !== '(') return null;
  const c0 = close(toks, 0);
  const inner = close(toks, 2);
  if (c0 === -1 || inner !== c0 - 1) return null;
  const n = inner;
  if (n < 7 || toks[n - 1].text !== ']' || toks[n - 2].text !== '[' || toks[n - 3].text !== '??') return null;
  let source = text(3, n - 4).trim();
  if (!source) return null;
  if (toks[3].text === '(' && close(toks, 3) === n - 4) source = text(4, n - 5).trim();
  else if (!isSimpleRef(source)) return null;

  const shape: ListShape = { source };
  let i = c0 + 1;
  let stage = 0; // 1 filter, 2 sort, 3 limit, 4 map
  const call = (name: string): [number, number] | null => {
    if (toks[i]?.text !== '.' || toks[i + 1]?.text !== name || toks[i + 2]?.text !== '(') return null;
    const end = close(toks, i + 2);
    if (end === -1) return null;
    return [i + 3, end - 1];
  };
  /** `(param) => BODY` or `(a, b) => BODY` inside [a, b]; returns the body range. */
  const arrow = (a: number, b: number, params: string[]): [number, number] | null => {
    let k = a;
    if (toks[k]?.text !== '(') return null;
    k++;
    for (let p = 0; p < params.length; p++) {
      if (toks[k]?.text !== params[p]) return null;
      k++;
      if (p < params.length - 1) {
        if (toks[k]?.text !== ',') return null;
        k++;
      }
    }
    if (toks[k]?.text !== ')' || toks[k + 1]?.text !== '=>') return null;
    return k + 2 <= b ? [k + 2, b] : null;
  };
  while (i < toks.length) {
    let r: [number, number] | null;
    if (stage < 1 && (r = call('filter'))) {
      const body = arrow(r[0], r[1], [ROW]);
      if (!body) return null;
      shape.filter = text(body[0], body[1]).trim();
      i = r[1] + 2;
      stage = 1;
      continue;
    }
    if (stage < 2 && (r = call('sort'))) {
      const body = arrow(r[0], r[1], ['a', 'b']);
      const sort = body ? readSort(squash(text(body[0], body[1]))) : null;
      if (!sort) return null;
      shape.sort = sort;
      i = r[1] + 2;
      stage = 2;
      continue;
    }
    if (stage < 3 && (r = call('slice'))) {
      if (r[1] - r[0] !== 2 || toks[r[0]].text !== '0' || toks[r[0] + 1].text !== ',' || toks[r[0] + 2].kind !== 'number') return null;
      const limit = Number(toks[r[0] + 2].text);
      if (!Number.isInteger(limit) || limit < 0) return null;
      shape.limit = limit;
      i = r[1] + 2;
      stage = 3;
      continue;
    }
    if (stage < 4 && (r = call('map'))) {
      const body = arrow(r[0], r[1], [ROW]);
      if (!body) return null;
      const [a, b] = body;
      // ({ ...row, name: FORMAT, … })
      if (toks[a].text !== '(' || close(toks, a) !== b || toks[a + 1].text !== '{' || close(toks, a + 1) !== b - 1) return null;
      const entries = splitCommas(toks.slice(a + 2, b - 1));
      if (entries.length < 2) return null;
      const spread = entries[0];
      if (spread.length !== 2 || spread[0].text !== '...' || spread[1].text !== ROW) return null;
      const formats: ShapeFormat[] = [];
      for (const e of entries.slice(1)) {
        if (e.length < 3 || e[0].kind !== 'ident' || e[1].text !== ':') return null;
        const f = readFormat(e[0].text, squash(src.slice(e[2].start, e[e.length - 1].end)));
        if (!f) return null;
        formats.push(f);
      }
      shape.formats = formats;
      i = r[1] + 2;
      stage = 4;
      continue;
    }
    return null;
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Lists in an extension
// ---------------------------------------------------------------------------

export interface ListChoice {
  label: string;
  /** Expression of the list. */
  expr: string;
  detail: string;
}

function isListSource(ds: DataSource): boolean {
  return ds.kind === 'associations' || ds.kind === 'crmSearch';
}

/**
 * Lists a shaped list can start from: CRM list sources, fetch / function results and computed
 * values that are lists right now, array state. Computed values only above `beforeComputedId`
 * (a computed value can only use the ones declared before it).
 */
export function listChoices(ext: Extension, scope: Record<string, unknown> | null, beforeComputedId?: string): ListChoice[] {
  const out: ListChoice[] = [];
  const isArray = (name: string) => !!scope && Object.prototype.hasOwnProperty.call(scope, name) && Array.isArray(scope[name]);
  for (const ds of ext.dataSources) {
    if (isListSource(ds)) out.push({ label: ds.name, expr: ds.name, detail: ds.kind === 'associations' ? 'associated records' : 'CRM search results' });
    else if ((ds.kind === 'fetch' || ds.kind === 'function') && isArray(ds.name)) out.push({ label: ds.name, expr: ds.name, detail: 'request result' });
  }
  for (const s of ext.state) if (s.type === 'array' || (s.type === 'any' && isArray(s.name))) out.push({ label: s.name, expr: s.name, detail: 'state (list)' });
  for (const c of ext.computed ?? []) {
    if (c.id === beforeComputedId) break;
    if (isArray(c.name)) out.push({ label: c.name, expr: c.name, detail: 'computed list' });
  }
  return out;
}

/** CRM properties a list source loads (its rows' `properties.*` fields). */
export function sourceProperties(ext: Extension, source: string): string[] {
  const ds = ext.dataSources.find((d) => d.name === source.trim());
  return ds && (ds.kind === 'associations' || ds.kind === 'crmSearch') ? ds.properties : [];
}

/** Every field path of the first rows (primitive leaves, two levels deep). */
export function rowFields(rows: unknown[], declared: string[] = []): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const add = (p: string[]) => {
    const k = JSON.stringify(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  };
  for (const p of declared) add(['properties', p]);
  const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  for (const row of rows.slice(0, 5)) {
    if (!isPlain(row)) continue;
    for (const [k, v] of Object.entries(row)) {
      if (isPlain(v)) for (const [k2, v2] of Object.entries(v)) (v2 === null || typeof v2 !== 'object') && add([k, k2]);
      else if (v === null || typeof v !== 'object') add([k]);
    }
  }
  return out.slice(0, 60);
}

/** Value of a field path in a row. */
export function fieldValue(row: unknown, path: string[]): unknown {
  let cur: unknown = row;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Sort as numbers when the values look like numbers (CRM amounts are text such as "125000"). */
export function guessSortAs(rows: unknown[], path: string[]): SortAs {
  const values = rows.map((r) => fieldValue(r, path)).filter((v) => v !== null && v !== undefined && v !== '');
  if (!values.length) return 'text';
  if (values.every((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))))) return 'number';
  // Formatted numbers ("$48,000.00", "1,250", "45%", "€ 9.99"): digits with symbols around them.
  return values.every((v) => typeof v === 'string' && FORMATTED_NUMBER_RE.test(v.trim())) ? 'formatted' : 'text';
}

const FORMATTED_NUMBER_RE = /^[^\d-]{0,4}-?\d[\d,]*(\.\d+)?[^\d]{0,4}$/;

/** A likely format for a field (amounts as currency, dates as dates). */
export function guessFormat(path: string[], sample: unknown): FormatKind {
  const key = (path[path.length - 1] ?? '').toLowerCase();
  if (/amount|price|revenue|value|cost|total|arr|mrr/.test(key)) return 'currency';
  if (/percent|probability|rate/.test(key)) return 'percent';
  if (/date|time|_at$|createdate|lastmodified/.test(key)) return 'date';
  if (typeof sample === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sample)) return 'date';
  return 'number';
}

/** `amountFormatted` for `properties.amount` (unique among `taken`). */
export function formatName(path: string[], taken: string[]): string {
  const last = (path[path.length - 1] ?? 'value').replace(/[^A-Za-z0-9_$]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''));
  const base = `${/^[0-9]/.test(last) ? `f${last}` : last || 'value'}Formatted`;
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base}${i}`;
  return name;
}

/** "3 rows where …, sorted by amount (highest first), first 5" — one line for summaries. */
export function describeShape(shape: ListShape): string {
  const parts: string[] = [shape.source];
  if (shape.filter?.trim()) parts.push('filtered');
  if (shape.sort) {
    const dir =
      shape.sort.as !== 'text' ? (shape.sort.dir === 'asc' ? 'lowest first' : 'highest first') : shape.sort.dir === 'asc' ? 'A → Z' : 'Z → A';
    parts.push(`sorted by ${fieldLabel(shape.sort.field)} (${dir})`);
  }
  if (shape.limit !== undefined) parts.push(`first ${shape.limit}`);
  if (shape.formats?.length) parts.push(`${shape.formats.length} formatted field${shape.formats.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
