/**
 * Visual conditions (pure): "Show when deal amount is more than 1000 and stage is closedwon, or …"
 * for a component's visibility condition, the If step in actions and the filter of a shaped list.
 *
 * A condition is stored as an ordinary JavaScript expression (so the preview runtime, validation and
 * codegen need nothing new). The builder writes a fixed, readable shape and recognises it again:
 *
 *   OR of AND groups, like HubSpot's own filter groups:
 *     (a && b) || c
 *   one clause per comparison:
 *     deal.amount === "x"            is / is not                 (===, !==)
 *     Number(deal.amount) > 1000     more / less than, at least / at most  (Number() unless numeric)
 *     String(S ?? "").toLowerCase().includes("acme")             contains (case-insensitive)
 *     !String(S ?? "").toLowerCase().includes("acme")            doesn't contain
 *     String(S ?? "").length === 0 / !== 0                       is empty / is not empty
 *     S / !S                                                     is true / is false (has a value / has none)
 *
 * Subjects that are plain references (`deal.properties.amount`, `items.length`) are written bare;
 * anything else is parenthesised. A value is a literal or another reference (e.g. a search box's
 * state). Anything that is not exactly this shape is left to the plain expression editor.
 */
import { tokenize, type Token } from '../model/jsTokens';
import type { Extension, StateVarType } from '../model/types';
import { CONTEXT_VARIABLES } from './scope';

export type ConditionOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'notContains'
  | 'empty'
  | 'notEmpty'
  | 'isTrue'
  | 'isFalse';

export type ConditionLiteral = string | number | boolean | null;

/** What a clause compares with: a fixed value, or another value in scope (an expression). */
export type ConditionValue = { kind: 'literal'; value: ConditionLiteral } | { kind: 'ref'; expr: string };

export interface ConditionClause {
  /** JavaScript expression the clause tests, e.g. `deal.properties.amount`. */
  subject: string;
  op: ConditionOp;
  /** For comparisons and contains. */
  value?: ConditionValue;
}

/** OR of AND groups: the condition holds when every clause of at least one group holds. */
export interface ConditionSet {
  groups: ConditionClause[][];
}

/** What a subject holds, as far as the editor knows (its declared type in generated code). */
export type SubjectType = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'any';

export const NO_VALUE_OPS: ReadonlySet<ConditionOp> = new Set(['empty', 'notEmpty', 'isTrue', 'isFalse']);
const NUMERIC_OPS: ReadonlySet<ConditionOp> = new Set(['gt', 'gte', 'lt', 'lte']);
const CMP: Record<string, ConditionOp> = { '===': 'eq', '!==': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
const CMP_TEXT: Partial<Record<ConditionOp, string>> = { eq: '===', neq: '!==', gt: '>', gte: '>=', lt: '<', lte: '<=' };

export function opNeedsValue(op: ConditionOp): boolean {
  return !NO_VALUE_OPS.has(op);
}

export function isNumericComparison(op: ConditionOp): boolean {
  return NUMERIC_OPS.has(op);
}

/** Plain-language label of an operator for a subject of the given type. */
export function opLabel(op: ConditionOp, type: SubjectType = 'any'): string {
  switch (op) {
    case 'eq':
      return 'is';
    case 'neq':
      return 'is not';
    case 'gt':
      return 'is more than';
    case 'gte':
      return 'is at least';
    case 'lt':
      return 'is less than';
    case 'lte':
      return 'is at most';
    case 'contains':
      return 'contains';
    case 'notContains':
      return 'doesn’t contain';
    case 'empty':
      return 'is empty';
    case 'notEmpty':
      return 'is not empty';
    case 'isTrue':
      return type === 'boolean' ? 'is true' : 'has a value';
    case 'isFalse':
      return type === 'boolean' ? 'is false' : 'has no value';
  }
}

/**
 * Operators offered for a subject type (only ones whose generated code type-checks: no
 * `.length` on a typed number, no `>` on a boolean). `current` is always included.
 */
export function opsFor(type: SubjectType, current?: ConditionOp): ConditionOp[] {
  let ops: ConditionOp[];
  switch (type) {
    case 'boolean':
      ops = ['isTrue', 'isFalse', 'eq', 'neq'];
      break;
    case 'number':
      ops = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
      break;
    case 'string':
      ops = ['eq', 'neq', 'contains', 'notContains', 'empty', 'notEmpty', 'gt', 'gte', 'lt', 'lte'];
      break;
    case 'array':
      ops = ['notEmpty', 'empty', 'contains', 'notContains'];
      break;
    case 'object':
      ops = ['isTrue', 'isFalse', 'eq', 'neq'];
      break;
    default:
      ops = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'notContains', 'empty', 'notEmpty', 'isTrue', 'isFalse'];
  }
  if (current && !ops.includes(current)) ops = [...ops, current];
  return ops;
}

/** The operator a clause starts with for a newly chosen subject (and what it holds now). */
export function defaultOpFor(type: SubjectType, sample?: unknown): ConditionOp {
  // CRM numbers are text ("48000"): compare them as numbers.
  if (type === 'string' && typeof sample === 'string' && sample.trim() !== '' && Number.isFinite(Number(sample))) return 'gt';
  switch (type) {
    case 'boolean':
    case 'object':
      return 'isTrue';
    case 'array':
      return 'notEmpty';
    case 'number':
      return 'gt';
    default:
      return 'eq';
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const SIMPLE_REF_RE = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|(?:\?\.)?\[(?:\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\])*$/;
const NOT_REFS = new Set(['true', 'false', 'null', 'typeof', 'new', 'void', 'delete', 'this', 'function', 'class', 'await', 'yield', 'in', 'instanceof']);

/** `deal.properties.amount`, `items[0]`, `a?.b` — written without parentheses. */
export function isSimpleRef(code: string): boolean {
  const t = code.trim();
  if (!SIMPLE_REF_RE.test(t)) return false;
  const head = /^[A-Za-z_$][\w$]*/.exec(t)![0];
  return !NOT_REFS.has(head);
}

function term(code: string): string {
  const t = code.trim();
  return isSimpleRef(t) ? t : `(${t})`;
}

function literal(v: ConditionLiteral): string {
  return JSON.stringify(v ?? null);
}

export interface EmitOptions {
  /** Declared type of a subject (decides whether numeric comparisons need `Number(…)`). */
  typeOf?: (subject: string) => SubjectType;
}

function valueCode(v: ConditionValue | undefined): string {
  if (!v) return 'null';
  return v.kind === 'ref' ? term(v.expr) : literal(v.value);
}

/** The JavaScript of one clause (null when it can't be written yet, e.g. no subject). */
export function clauseToExpr(c: ConditionClause, opts: EmitOptions = {}): string | null {
  const subject = c.subject.trim();
  if (!subject) return null;
  // A value to compare with that is still being chosen.
  if (opNeedsValue(c.op) && c.value?.kind === 'ref' && !c.value.expr.trim()) return null;
  const S = term(subject);
  const v = c.value;
  switch (c.op) {
    case 'eq':
    case 'neq':
      return `${S} ${CMP_TEXT[c.op]} ${valueCode(v)}`;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op = CMP_TEXT[c.op];
      const numericValue = v?.kind === 'literal' ? typeof v.value === 'number' : true;
      // Text thresholds (e.g. ISO dates) compare as text, through String() so a value that may be
      // empty (null) still compiles; numbers compare as numbers, and CRM values (text such as
      // "125000") are converted first.
      if (!numericValue) return v?.kind === 'literal' && typeof v.value === 'string' ? `String(${S} ?? "") ${op} ${valueCode(v)}` : `${S} ${op} ${valueCode(v)}`;
      const numberSubject = (opts.typeOf?.(subject) ?? 'any') === 'number';
      const left = numberSubject ? S : `Number(${subject})`;
      const right = v?.kind === 'ref' ? (numberSubject && opts.typeOf?.(v.expr.trim()) === 'number' ? term(v.expr) : `Number(${v.expr.trim()})`) : valueCode(v);
      return `${left} ${op} ${right}`;
    }
    case 'contains':
    case 'notContains': {
      const needle =
        v?.kind === 'ref'
          ? `String(${term(v.expr)} ?? "").toLowerCase()`
          : literal(String(v?.kind === 'literal' ? (v.value ?? '') : '').toLowerCase());
      return `${c.op === 'notContains' ? '!' : ''}String(${S} ?? "").toLowerCase().includes(${needle})`;
    }
    // String() keeps this valid for every type: lists ("" when empty), text, numbers ("0" is a value).
    case 'empty':
      return `String(${S} ?? "").length === 0`;
    case 'notEmpty':
      return `String(${S} ?? "").length !== 0`;
    case 'isTrue':
      return S;
    case 'isFalse':
      return `!${S}`;
  }
}

/** The expression of a condition set ('' when nothing is complete yet). */
export function conditionToExpr(set: ConditionSet, opts: EmitOptions = {}): string {
  const groups = set.groups
    .map((g) => g.map((c) => clauseToExpr(c, opts)).filter((x): x is string => !!x))
    .filter((g) => g.length > 0);
  if (groups.length === 0) return '';
  if (groups.length === 1) return groups[0].join(' && ');
  return groups.map((g) => (g.length > 1 ? `(${g.join(' && ')})` : g[0])).join(' || ');
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

/** Splits at a top-level punctuator (`||`, `&&`); null when brackets are unbalanced. */
function splitTop(toks: Tok[], sep: string): Tok[][] | null {
  const out: Tok[][] = [];
  let cur: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if ((t.kind === 'punct' && OPEN[t.text]) || t.kind === 'templateHead') {
      const j = close(toks, i);
      if (j === -1) return null;
      cur.push(...toks.slice(i, j + 1));
      i = j;
      continue;
    }
    if (t.kind === 'punct' && t.text === sep) {
      out.push(cur);
      cur = [];
      continue;
    }
    cur.push(t);
  }
  out.push(cur);
  return out;
}

/** True when the tokens are exactly one bracket pair `( … )`. */
function wrapped(toks: Tok[]): boolean {
  return toks.length >= 2 && toks[0].text === '(' && toks[0].kind === 'punct' && close(toks, 0) === toks.length - 1;
}

function hasTop(toks: Tok[], texts: string[]): boolean {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'punct' && OPEN[t.text]) {
      const j = close(toks, i);
      if (j === -1) return true;
      i = j;
      continue;
    }
    if (t.kind === 'punct' && texts.includes(t.text)) return true;
    if (t.kind === 'ident' && texts.includes(t.text)) return true;
  }
  return false;
}

interface Parser {
  src: string;
}

function slice(p: Parser, toks: Tok[]): string {
  if (toks.length === 0) return '';
  return p.src.slice(toks[0].start, toks[toks.length - 1].end).trim();
}

/** A subject term: a simple reference, or one parenthesised expression (its inside). */
function readTerm(p: Parser, toks: Tok[]): string | null {
  if (toks.length === 0) return null;
  if (wrapped(toks)) {
    const inner = toks.slice(1, -1);
    if (inner.length === 0) return null;
    // A nested AND / OR group is not something one clause can show.
    if (hasTop(inner, ['&&', '||', ','])) return null;
    return slice(p, inner);
  }
  const text = slice(p, toks);
  return isSimpleRef(text) ? text : null;
}

/** `Number(term)` → the term inside; null when not that shape. */
function readNumberCall(p: Parser, toks: Tok[]): string | null {
  if (toks.length < 4 || toks[0].text !== 'Number' || toks[1].text !== '(' || close(toks, 1) !== toks.length - 1) return null;
  const inner = toks.slice(2, -1);
  if (inner.length === 0 || hasTop(inner, [','])) return null;
  const t = readTerm(p, inner);
  return t ?? (hasTop(inner, ['&&', '||', '??', '?']) ? null : slice(p, inner));
}

function unquote(text: string): string | null {
  if (text.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(text);
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  if (text.startsWith("'")) {
    const inner = text.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"');
    try {
      const v: unknown = JSON.parse(`"${inner}"`);
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

function readLiteral(toks: Tok[]): { value: ConditionLiteral } | null {
  if (toks.length === 1) {
    const t = toks[0];
    if (t.kind === 'string') {
      const s = unquote(t.text);
      return s === null ? null : { value: s };
    }
    if (t.kind === 'number' && /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$|^\.\d+$/.test(t.text)) return { value: Number(t.text) };
    if (t.kind === 'ident' && (t.text === 'true' || t.text === 'false')) return { value: t.text === 'true' };
    if (t.kind === 'ident' && t.text === 'null') return { value: null };
    return null;
  }
  if (toks.length === 2 && toks[0].text === '-' && toks[1].kind === 'number') {
    const n = Number(toks[1].text);
    return Number.isFinite(n) ? { value: -n } : null;
  }
  return null;
}

function readValue(p: Parser, toks: Tok[]): ConditionValue | null {
  const lit = readLiteral(toks);
  if (lit) return { kind: 'literal', value: lit.value };
  const num = readNumberCall(p, toks);
  if (num !== null) return { kind: 'ref', expr: num };
  const ref = readTerm(p, toks);
  return ref !== null ? { kind: 'ref', expr: ref } : null;
}

function texts(toks: Tok[], from: number, expected: string[]): boolean {
  if (from + expected.length > toks.length) return false;
  return expected.every((e, k) => toks[from + k].text === e);
}

/** `String(X ?? "")` → X (a term); null otherwise. */
function readStringOf(p: Parser, toks: Tok[]): string | null {
  if (toks.length < 6 || toks[0].text !== 'String' || toks[1].text !== '(' || close(toks, 1) !== toks.length - 1) return null;
  const inner = toks.slice(2, -1);
  const n = inner.length;
  if (n < 3 || inner[n - 2].text !== '??' || inner[n - 1].kind !== 'string' || unquote(inner[n - 1].text) !== '') return null;
  return readTerm(p, inner.slice(0, n - 2));
}

/** `String(S ?? "").toLowerCase().includes(V)` → subject and value. */
function readContains(p: Parser, toks: Tok[]): ConditionClause | null {
  if (toks[0]?.text !== 'String' || toks[1]?.text !== '(') return null;
  const c1 = close(toks, 1);
  if (c1 === -1) return null;
  const subject = readStringOf(p, toks.slice(0, c1 + 1));
  if (subject === null) return null;
  if (!texts(toks, c1 + 1, ['.', 'toLowerCase', '(', ')', '.', 'includes', '('])) return null;
  const open = c1 + 7;
  const c2 = close(toks, open);
  if (c2 !== toks.length - 1) return null;
  const arg = toks.slice(open + 1, c2);
  const lit = readLiteral(arg);
  if (lit && typeof lit.value === 'string') return { subject, op: 'contains', value: { kind: 'literal', value: lit.value } };
  // String(R ?? "").toLowerCase()
  if (arg[0]?.text !== 'String' || arg[1]?.text !== '(') return null;
  const c3 = close(arg, 1);
  if (c3 === -1 || !texts(arg, c3 + 1, ['.', 'toLowerCase', '(', ')']) || c3 + 5 !== arg.length) return null;
  const ref = readStringOf(p, arg.slice(0, c3 + 1));
  return ref === null ? null : { subject, op: 'contains', value: { kind: 'ref', expr: ref } };
}

/** `String(S ?? "").length === 0` / `!== 0`. */
function readEmpty(p: Parser, toks: Tok[]): ConditionClause | null {
  if (toks[0]?.text !== 'String' || toks[1]?.text !== '(') return null;
  const c = close(toks, 1);
  if (c === -1 || !texts(toks, c + 1, ['.', 'length']) || c + 5 !== toks.length) return null;
  const cmp = toks[c + 3].text;
  if ((cmp !== '===' && cmp !== '!==') || toks[c + 4].text !== '0') return null;
  const subject = readStringOf(p, toks.slice(0, c + 1));
  return subject === null ? null : { subject, op: cmp === '===' ? 'empty' : 'notEmpty' };
}

function readClause(p: Parser, toks: Tok[]): ConditionClause | null {
  if (toks.length === 0) return null;
  if (toks[0].text === '!' && toks[0].kind === 'punct') {
    const rest = toks.slice(1);
    const contains = readContains(p, rest);
    if (contains) return { ...contains, op: 'notContains' };
    const subject = readTerm(p, rest);
    return subject !== null ? { subject, op: 'isFalse' } : null;
  }
  const contains = readContains(p, toks);
  if (contains) return contains;
  const empty = readEmpty(p, toks);
  if (empty) return empty;
  // One top-level comparison.
  let at = -1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'punct' && OPEN[t.text]) {
      const j = close(toks, i);
      if (j === -1) return null;
      i = j;
      continue;
    }
    if (t.kind === 'punct' && (CMP[t.text] || t.text === '==' || t.text === '!=')) {
      if (at !== -1) return null;
      at = i;
    }
  }
  if (at === -1) {
    const subject = readTerm(p, toks);
    return subject !== null ? { subject, op: 'isTrue' } : null;
  }
  const op = CMP[toks[at].text];
  if (!op) return null;
  const left = toks.slice(0, at);
  const right = toks.slice(at + 1);
  const subject = readNumberCall(p, left) ?? readTerm(p, left);
  const value = readValue(p, right);
  if (!value) return null;
  if (subject === null) {
    // A text threshold: `String(S ?? "") > "2026-01-01"`.
    const text = readStringOf(p, left);
    const threshold = isNumericComparison(op) && value.kind === 'literal' && typeof value.value === 'string';
    return text !== null && threshold ? { subject: text, op, value } : null;
  }
  return { subject, op, value };
}

/**
 * Recognises a condition the builder can show (written by `conditionToExpr` or by hand in the same
 * shape, e.g. `!dealsLoading && deals.length > 0`); null for anything else. '' is an empty set.
 */
export function parseCondition(expr: string): ConditionSet | null {
  const src = expr ?? '';
  if (!src.trim()) return { groups: [] };
  const all = tokenize(src);
  if (all.some((t) => t.kind === 'comment' || t.kind === 'regex')) return null;
  const toks: Tok[] = all.filter((t) => t.kind !== 'whitespace').map((t) => ({ ...t, end: t.start + t.text.length }));
  const p: Parser = { src };
  const groups = splitTop(toks, '||');
  if (!groups) return null;
  const out: ConditionClause[][] = [];
  for (let g of groups) {
    if (g.length === 0) return null;
    if (wrapped(g) && hasTop(g.slice(1, -1), ['&&'])) g = g.slice(1, -1);
    const parts = splitTop(g, '&&');
    if (!parts) return null;
    const clauses: ConditionClause[] = [];
    for (const part of parts) {
      const c = readClause(p, part);
      if (!c) return null;
      clauses.push(c);
    }
    out.push(clauses);
  }
  return { groups: out };
}

// ---------------------------------------------------------------------------
// Subject types and values typed by the user
// ---------------------------------------------------------------------------

function fromStateType(t: StateVarType): SubjectType {
  return t === 'any' ? 'any' : t;
}

/** Declared type of a subject in the generated code (state types, CRM text, list sizes…). */
export function declaredSubjectType(ext: Pick<Extension, 'state' | 'dataSources'>, subject: string): SubjectType {
  const s = subject.trim();
  const state = ext.state.find((v) => v.name === s);
  // A number that starts as null may be null: compare it through Number() like untyped values.
  if (state) return state.type === 'number' && state.initial === null ? 'any' : fromStateType(state.type);
  if (/\.length$/.test(s) && !s.includes('(')) return 'number';
  for (const ds of ext.dataSources) {
    if (s === `${ds.name}Loading`) return 'boolean';
    if (s === `${ds.name}Error`) return 'string';
    if (s === ds.name) {
      if (ds.kind === 'associations' || ds.kind === 'crmSearch') return 'array';
      if (ds.kind === 'crmProperties') return 'object';
      return 'any';
    }
    // Record properties are text (or null) in HubSpot.
    if (ds.kind === 'crmProperties' && s.startsWith(`${ds.name}.`) && isSimpleRef(s)) return 'string';
  }
  // Context values are read with optional chaining in the exported code (they may be missing), so
  // numbers among them compare through Number() like untyped values.
  const ctx = CONTEXT_VARIABLES.find((v) => v.name === s);
  if (ctx?.detail?.startsWith('string')) return 'string';
  return 'any';
}

/**
 * A subject's type as the exported card's TypeScript sees it, whether or not it may be null: what a
 * fixed value compared with it must be for the card to compile. Unlike `declaredSubjectType`, a
 * number variable that starts empty is still a number (`number | null` in the card), and a
 * variable whose start value doesn't match its type is untyped (`any`).
 */
export function strictSubjectType(ext: Pick<Extension, 'state' | 'dataSources'>, subject: string): SubjectType {
  const s = subject.trim();
  const state = ext.state.find((v) => v.name === s);
  if (state) {
    // Mirrors codegen's stateTypeArg.
    if (state.type === 'string' || state.type === 'number' || state.type === 'boolean') {
      return state.initial === null || typeof state.initial === state.type ? state.type : 'any';
    }
    return state.type === 'array' && Array.isArray(state.initial) ? 'array' : 'any';
  }
  // Record properties come back untyped from useCrmProperties; context ids are numbers.
  for (const ds of ext.dataSources) if (ds.kind === 'crmProperties' && s.startsWith(`${ds.name}.`) && isSimpleRef(s)) return 'any';
  if (CONTEXT_VARIABLES.find((v) => v.name === s)?.detail?.startsWith('number')) return 'number';
  return declaredSubjectType(ext, s);
}

/** Whether a subject may be null in the exported card (a typed variable that starts empty). */
export function subjectMayBeNull(ext: Pick<Extension, 'state' | 'dataSources'>, subject: string): boolean {
  const s = subject.trim();
  const state = ext.state.find((v) => v.name === s);
  if (state) return state.initial === null && (state.type === 'string' || state.type === 'number' || state.type === 'boolean');
  return ext.dataSources.some((ds) => s === `${ds.name}Error`);
}

/** Type of a subject for choosing operators: the declared type, else what it holds right now. */
export function subjectType(declared: SubjectType, sample: unknown): SubjectType {
  if (declared !== 'any') return declared;
  if (Array.isArray(sample)) return 'array';
  if (typeof sample === 'number') return 'number';
  if (typeof sample === 'boolean') return 'boolean';
  if (typeof sample === 'string') return 'string';
  return 'any';
}

/** The literal a typed value becomes, for a subject of this type (and what it holds now). */
export function parseValueText(text: string, op: ConditionOp, declared: SubjectType, sample: unknown): ConditionLiteral {
  const t = text.trim();
  const numeric = t !== '' && Number.isFinite(Number(t));
  if (op === 'contains' || op === 'notContains') return text;
  if (isNumericComparison(op)) return numeric ? Number(t) : text;
  if (declared === 'number') return numeric ? Number(t) : text;
  if (declared === 'boolean') return t === 'true' ? true : t === 'false' ? false : text;
  if (declared === 'string' || declared === 'array' || declared === 'object') return text;
  // Untyped values (data, computed values, repeat items): follow what it holds right now. CRM
  // values are text even when they look like numbers ("true", "125000").
  if (typeof sample === 'number') return numeric ? Number(t) : text;
  if (typeof sample === 'boolean') return t === 'true' ? true : t === 'false' ? false : text;
  if (typeof sample === 'string') return text;
  return numeric ? Number(t) : text;
}

/** A literal as the user types it. */
export function valueText(v: ConditionLiteral | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * A problem with a clause's value for its subject's type (`strictSubjectType`; shown under the
 * clause, and the clause isn't saved until it is fixed), else null.
 */
export function clauseProblem(c: ConditionClause, declared: SubjectType): string | null {
  if (!c.subject.trim()) return 'Choose what to check.';
  if (!opNeedsValue(c.op) || !c.value || c.value.kind === 'ref') return null;
  const v = c.value.value;
  if (declared === 'number' && typeof v !== 'number') return 'Enter a number.';
  if (declared === 'boolean' && (c.op === 'eq' || c.op === 'neq') && typeof v !== 'boolean') return 'Enter true or false.';
  const expected = literalTypeMismatch(c, declared);
  return expected ? expectedLiteralText(expected) : null;
}

/** What a fixed value compared with a subject must be ('value': another value in scope instead). */
export type ExpectedLiteral = 'number' | 'boolean' | 'text' | 'number or text' | 'value';

/**
 * A fixed value the exported card's strict type-check refuses for a subject of this type
 * (`strictSubjectType`): what it should be instead, else null. `count === ""` for a number variable
 * and `open === "yes"` for a true / false one fail to compile; "is" / "is not" null, values in scope
 * and untyped subjects are accepted, and thresholds compare as numbers or as text.
 */
export function literalTypeMismatch(c: ConditionClause, declared: SubjectType): ExpectedLiteral | null {
  if (!opNeedsValue(c.op) || c.value?.kind !== 'literal') return null;
  const v = c.value.value;
  const t = v === null ? 'null' : typeof v;
  switch (c.op) {
    case 'eq':
    case 'neq':
      if (v === null) return null;
      if (declared === 'number') return t === 'number' ? null : 'number';
      if (declared === 'boolean') return t === 'boolean' ? null : 'boolean';
      if (declared === 'string') return t === 'string' ? null : 'text';
      if (declared === 'array' || declared === 'object') return 'value';
      return null;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      // Numbers compare through Number(), text through String(); `> null` never compiles.
      if (t === 'number' || t === 'string') return null;
      if (t === 'boolean' && (declared === 'boolean' || declared === 'any')) return null;
      return declared === 'number' ? 'number' : 'number or text';
    default:
      return null;
  }
}

/**
 * Like `literalTypeMismatch`, for a comparison exactly as written in code (`count === ""`, Rules'
 * `(count) >= 80`): nothing is converted, so a fixed value must have the subject's own type, and a
 * value that may be null can't be compared with more / less than ('start value').
 */
export function rawComparisonMismatch(op: ConditionOp, value: ConditionLiteral, type: SubjectType, nullable: boolean): ExpectedLiteral | 'start value' | null {
  const t = value === null ? 'null' : typeof value;
  if (op === 'eq' || op === 'neq') {
    if (value === null || type === 'any') return null;
    if (type === 'number') return t === 'number' ? null : 'number';
    if (type === 'boolean') return t === 'boolean' ? null : 'boolean';
    if (type === 'string') return t === 'string' ? null : 'text';
    return 'value';
  }
  if (!isNumericComparison(op)) return null;
  if (t === 'null') return type === 'number' ? 'number' : 'number or text';
  if (nullable) return 'start value';
  if (type === 'any') return null;
  if (type === 'number') return t === 'number' ? null : 'number';
  if (type === 'string') return t === 'string' ? null : 'text';
  if (type === 'boolean') return t === 'boolean' ? null : 'boolean';
  return 'value';
}

/** A comparison with a fixed value, as written in code. */
export interface LiteralComparison {
  /** A plain reference (`count`, `deal.properties.amount`), as written (without parentheses). */
  subject: string;
  op: ConditionOp;
  value: ConditionLiteral;
}

const CMP_PUNCT: Record<string, ConditionOp> = { '===': 'eq', '==': 'eq', '!==': 'neq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
/** Tokens an operand of a comparison can follow / be followed by (everything binding less tightly). */
const OPERAND_BEFORE = new Set(['(', '[', '{', ',', '?', ':', '&&', '||', '??', '=>']);
const OPERAND_AFTER = new Set([')', ']', '}', ',', '?', ':', '&&', '||', '??', ';']);

/**
 * Every `REF op LITERAL` comparison in an expression, at any depth, where REF is a plain reference
 * (maybe in parentheses, as Rules write it) and both sides are whole operands — `count === ""`,
 * `(count) >= 80 ? …`, but not `Number(count) > 5`, `a + count === 5` or `count === 5 + 1`.
 */
export function literalComparisons(code: string): LiteralComparison[] {
  let all: Token[];
  try {
    all = tokenize(code);
  } catch {
    return [];
  }
  const toks = all.filter((t) => t.kind !== 'whitespace' && t.kind !== 'comment');
  const isEdge = (t: Token | undefined, set: Set<string>) =>
    !t || (t.kind === 'punct' && set.has(t.text)) || t.kind === 'templateHead' || t.kind === 'templateMiddle' || t.kind === 'templateTail';
  /** Index of the bracket opening the one closing at `close` (null when unbalanced). */
  const opening = (close: number): number | null => {
    const want = toks[close].text === ')' ? '(' : '[';
    let depth = 0;
    for (let i = close; i >= 0; i--) {
      const t = toks[i];
      if (t.kind !== 'punct') continue;
      if (t.text === toks[close].text) depth++;
      else if (t.text === want && --depth === 0) return i;
    }
    return null;
  };
  /** Start index of a plain reference ending at `end` (null when it isn't one). */
  const refStart = (end: number): number | null => {
    let i = end;
    for (;;) {
      const t = toks[i];
      if (t?.kind === 'punct' && t.text === ']') {
        const open = opening(i);
        if (open === null || open === 0) return null;
        i = open - 1;
        if (toks[i]?.kind === 'punct' && toks[i].text === '?.') i--;
        continue;
      }
      if (t?.kind !== 'ident') return null;
      const before = toks[i - 1];
      if (before?.kind === 'punct' && (before.text === '.' || before.text === '?.')) {
        i -= 2;
        continue;
      }
      return i;
    }
  };
  const text = (from: number, to: number) => code.slice(toks[from].start, toks[to].start + toks[to].text.length).trim();
  const out: LiteralComparison[] = [];
  for (let i = 1; i < toks.length - 1; i++) {
    const op = toks[i].kind === 'punct' ? CMP_PUNCT[toks[i].text] : undefined;
    if (!op) continue;
    // Left: a reference, or one in parentheses that aren't a call.
    let end = i - 1;
    let start: number | null;
    if (toks[end].kind === 'punct' && toks[end].text === ')') {
      const open = opening(end);
      const callee = open === null ? undefined : toks[open - 1];
      if (open === null || (callee && (callee.kind === 'ident' || (callee.kind === 'punct' && (callee.text === ')' || callee.text === ']' || callee.text === '?.'))))) continue;
      if (refStart(end - 1) !== open + 1) continue;
      start = open;
      end -= 1;
    } else {
      start = refStart(end);
    }
    if (start === null || !isEdge(toks[start - 1], OPERAND_BEFORE)) continue;
    const subjectFrom = toks[start].text === '(' ? start + 1 : start;
    const subject = text(subjectFrom, end);
    if (!isSimpleRef(subject)) continue;
    // Right: one literal, then the end of the operand.
    let j = i + 1;
    let lit = readLiteral([{ ...toks[j], end: 0 }]);
    if (!lit && toks[j].text === '-' && toks[j + 1]?.kind === 'number') {
      lit = readLiteral([{ ...toks[j], end: 0 }, { ...toks[j + 1], end: 0 }]);
      j++;
    }
    if (!lit || !isEdge(toks[j + 1], OPERAND_AFTER)) continue;
    out.push({ subject, op, value: lit.value });
  }
  return out;
}

/** "Enter a number." — what to do about a value that doesn't fit. */
export function expectedLiteralText(expected: ExpectedLiteral): string {
  switch (expected) {
    case 'number':
      return 'Enter a number.';
    case 'boolean':
      return 'Choose true or false.';
    case 'text':
      return 'Enter text.';
    case 'number or text':
      return 'Enter a number or text.';
    case 'value':
      return 'Compare it with another value instead (the { } button).';
  }
}

/**
 * The value a clause keeps when its subject or comparison changes: another value in scope stays,
 * a typed value is read again for the new type, and "is" / "is not" on a true / false value starts
 * at true (its menu shows true or false, never an empty value).
 */
export function carryValue(prev: ConditionValue | undefined, op: ConditionOp, declared: SubjectType, sample: unknown): ConditionValue {
  if (prev?.kind === 'ref') return prev;
  const value = parseValueText(valueText(prev?.kind === 'literal' ? prev.value : ''), op, declared, sample);
  if (declared === 'boolean' && (op === 'eq' || op === 'neq') && typeof value !== 'boolean') return { kind: 'literal', value: true };
  return { kind: 'literal', value };
}

/**
 * The checks that can be saved: a check whose value doesn't fit yet (`clauseProblem`, e.g. an
 * emptied number box) is left out of the stored expression until it is fixed, like a check whose
 * subject or compared value is still being chosen.
 */
export function savableCondition(set: ConditionSet, typeOf: (subject: string) => SubjectType): ConditionSet {
  return { groups: set.groups.map((g) => g.filter((c) => !c.subject.trim() || !clauseProblem(c, typeOf(c.subject.trim())))) };
}

/** "deal amount is more than 1000 and …" — one line for summaries. */
export function describeCondition(set: ConditionSet, label: (subject: string) => string = (s) => s): string {
  const clause = (c: ConditionClause) => {
    const value = !opNeedsValue(c.op)
      ? ''
      : c.value?.kind === 'ref'
        ? ` ${label(c.value.expr)}`
        : c.value
          ? ` ${typeof c.value.value === 'string' ? `“${c.value.value}”` : valueText(c.value.value)}`
          : '';
    return `${label(c.subject)} ${opLabel(c.op)}${value}`;
  };
  return set.groups.map((g) => g.map(clause).join(' and ')).join(', or ');
}

/** A fresh clause for a subject. */
export function newClause(subject: string, type: SubjectType): ConditionClause {
  const op = defaultOpFor(type);
  return {
    subject,
    op,
    ...(opNeedsValue(op) ? { value: { kind: 'literal', value: op === 'gt' ? 0 : '' } as ConditionValue } : {}),
  };
}
