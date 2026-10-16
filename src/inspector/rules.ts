/**
 * "Rules" for a prop value: pick the value by comparing something (e.g. a progress bar's
 * percentage) against thresholds — "at least 80 → green, at least 40 → yellow, otherwise red".
 *
 * Rules are stored as an ordinary expression ({ $expr }) so the preview runtime, validation and
 * codegen need nothing new. The inspector writes a fixed shape and recognises it again:
 *
 *   (SUBJECT) >= 80 ? "success" : (SUBJECT) >= 40 ? "warning" : "danger"
 *
 * Anything that is not exactly this shape stays a plain `fx` expression.
 */
import { isExpr, type JsonValue, type PropValue, type UINode } from '../model/types';
import type { PropDef } from '../registry/types';
import { jsonToJs } from './propValue';

export type RuleOp = '>=' | '>' | '<=' | '<' | '===' | '!==';
export type RuleLiteral = string | number | boolean | null;

export interface RuleCase {
  op: RuleOp;
  when: RuleLiteral;
  then: RuleLiteral;
}

export interface RuleSet {
  /** JavaScript expression the cases compare, e.g. `3 / 5 * 100` or `properties.amount`. */
  subject: string;
  cases: RuleCase[];
  otherwise: RuleLiteral;
}

export const RULE_OPS: ReadonlyArray<{ value: RuleOp; label: string }> = [
  { value: '>=', label: 'is at least' },
  { value: '>', label: 'is more than' },
  { value: '<=', label: 'is at most' },
  { value: '<', label: 'is less than' },
  { value: '===', label: 'is' },
  { value: '!==', label: 'is not' },
];

/** Comparisons that only make sense for numbers (the threshold is stored as a number when it is one). */
export function isNumericOp(op: RuleOp): boolean {
  return op !== '===' && op !== '!==';
}

/** Prop kinds whose value can be chosen by rules (single primitive values). */
const RULE_KINDS = new Set(['enum', 'string', 'number', 'boolean', 'url', 'href', 'icon', 'date', 'time']);

export function supportsRules(def: PropDef): boolean {
  return def.bindable !== false && RULE_KINDS.has(def.type.kind);
}

function lit(v: RuleLiteral): string {
  return JSON.stringify(v ?? null);
}

export function rulesToExpr(rules: RuleSet): string {
  const subject = `(${rules.subject.trim()})`;
  return rules.cases.map((c) => `${subject} ${c.op} ${lit(c.when)} ? ${lit(c.then)} : `).join('') + lit(rules.otherwise);
}

const OPS: RuleOp[] = ['===', '!==', '>=', '<=', '>', '<'];
const PRIMITIVE_RE = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/** Recognises an expression written by `rulesToExpr`; null for anything else. */
export function parseRules(expr: string): RuleSet | null {
  const src = expr.trim();
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const readParen = (): string | null => {
    if (src[i] !== '(') return null;
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < src.length; j++) {
      const ch = src[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) {
        const inner = src.slice(i + 1, j).trim();
        i = j + 1;
        return inner;
      }
    }
    return null;
  };
  const readLiteral = (): { value: RuleLiteral } | null => {
    ws();
    if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return null;
      try {
        const value = JSON.parse(src.slice(i, j + 1)) as string;
        i = j + 1;
        return { value };
      } catch {
        return null;
      }
    }
    const m = PRIMITIVE_RE.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return { value: JSON.parse(m[0]) as RuleLiteral };
  };
  const expect = (ch: string) => {
    ws();
    if (src[i] !== ch) return false;
    i++;
    return true;
  };

  let subject: string | null = null;
  const cases: RuleCase[] = [];
  for (;;) {
    ws();
    if (src[i] !== '(') break;
    const inner = readParen();
    if (!inner || (subject !== null && inner !== subject)) return null;
    subject = inner;
    ws();
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) return null;
    i += op.length;
    const when = readLiteral();
    if (!when || !expect('?')) return null;
    const then = readLiteral();
    if (!then || !expect(':')) return null;
    cases.push({ op, when: when.value, then: then.value });
  }
  const otherwise = readLiteral();
  ws();
  if (!subject || cases.length === 0 || !otherwise || i !== src.length) return null;
  return { subject, cases, otherwise: otherwise.value };
}

/** Rules stored in a prop value, if it is a rules expression. */
export function rulesOf(value: PropValue | undefined): RuleSet | null {
  return isExpr(value) ? parseRules(value.$expr) : null;
}

// ---------------------------------------------------------------------------
// What rules can be based on, per component
// ---------------------------------------------------------------------------

export interface RuleSubject {
  label: string;
  expr: string;
}

/** A prop value as JavaScript source (expressions parenthesised). */
function propAsJs(value: PropValue | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  if (isExpr(value)) return `(${value.$expr.trim()})`;
  return jsonToJs(value as JsonValue);
}

/** Ready-made "based on" choices for a node, built from its own props. */
export function ruleSubjectsFor(node: Pick<UINode, 'type' | 'props'>): RuleSubject[] {
  const p = node.props;
  switch (node.type) {
    case 'ProgressBar':
      return [
        {
          label: 'This bar’s percentage',
          expr: `${propAsJs(p.value, '0')} / ${propAsJs(p.maxValue, '100')} * 100`,
        },
        { label: 'This bar’s value', expr: propAsJs(p.value, '0') },
      ];
    case 'ScoreCircle':
      return [{ label: 'The score', expr: propAsJs(p.score, '0') }];
    case 'StepIndicator':
      return [{ label: 'The current step', expr: propAsJs(p.currentStep, '0') }];
    case 'StatisticsItem':
      return p.number !== undefined ? [{ label: 'The number', expr: `Number(${propAsJs(p.number, '0')})` }] : [];
    default:
      return [];
  }
}

/** Ready-made rules for props where one obvious set exists (e.g. progress bar color by percentage). */
const PRESETS: Record<string, Omit<RuleSet, 'subject'>> = {
  'ProgressBar.variant': {
    cases: [
      { op: '>=', when: 80, then: 'success' },
      { op: '>=', when: 40, then: 'warning' },
    ],
    otherwise: 'danger',
  },
};

function fallbackLiteral(def: PropDef): RuleLiteral {
  const d = def.defaultValue;
  if (d === null || typeof d === 'string' || typeof d === 'number' || typeof d === 'boolean') return d;
  switch (def.type.kind) {
    case 'enum': {
      return def.type.options[0]?.value ?? null;
    }
    case 'number':
      return 0;
    case 'boolean':
      return true;
    default:
      return '';
  }
}

function asLiteral(value: PropValue | undefined): RuleLiteral | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
}

/** The rules a prop starts with when the user switches Rules on. */
export function initialRules(node: Pick<UINode, 'type' | 'props'>, def: PropDef): RuleSet {
  const subject = ruleSubjectsFor(node)[0]?.expr ?? '';
  const preset = PRESETS[`${node.type}.${def.name}`];
  if (preset)
    return {
      subject,
      cases: preset.cases.map((c) => ({ ...c })),
      otherwise: preset.otherwise,
    };
  const current = asLiteral(node.props[def.name]) ?? fallbackLiteral(def);
  return {
    subject,
    cases: [{ op: '>=', when: 50, then: current }],
    otherwise: current,
  };
}

/**
 * When a prop that a "based on" choice is built from changes (e.g. the progress bar's value), the
 * rules on the node's other props that use the old choice are rewritten to the new one so they
 * keep following it. Returns the extra prop changes to apply together with `patch`.
 */
export function syncRuleSubjects(
  node: Pick<UINode, 'type' | 'props'>,
  patch: Record<string, PropValue | undefined>,
): Record<string, PropValue> {
  const before = ruleSubjectsFor(node);
  if (before.length === 0) return {};
  const nextProps = { ...node.props } as Record<string, PropValue | undefined>;
  for (const [k, v] of Object.entries(patch)) nextProps[k] = v;
  const after = ruleSubjectsFor({
    type: node.type,
    props: nextProps as UINode['props'],
  });
  const extra: Record<string, PropValue> = {};
  before.forEach((old, k) => {
    const next = after[k];
    if (!next || next.expr === old.expr) return;
    for (const [name, value] of Object.entries(node.props)) {
      if (name in patch) continue;
      const rules = rulesOf(value);
      if (rules && rules.subject === old.expr.trim()) extra[name] = { $expr: rulesToExpr({ ...rules, subject: next.expr }) };
    }
  });
  return extra;
}

/** Turns what an editor produced into a rule value (rules only hold simple values). */
export function toRuleLiteral(value: JsonValue | undefined, def: PropDef): RuleLiteral {
  const v = asLiteral(value as PropValue | undefined);
  return v === undefined ? fallbackLiteral(def) : v;
}
