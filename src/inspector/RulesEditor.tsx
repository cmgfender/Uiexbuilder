/**
 * Rules editor for one prop (or a component's text, or a value in an action): "Based on [this
 * bar's percentage] — is at least [80] → [Success] … Otherwise → [Danger]". Edits a RuleSet (see
 * rules.ts); the parent stores it as an expression. "Based on" (the shared SubjectPicker) lists the
 * component's own values plus everything in scope at the node (event values, repeat item and its
 * fields, state, computed values, record properties, data, context).
 */
import { useId, useMemo } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import type { Extension, JsonValue, NodeId, UINode } from '../model/types';
import type { PropDef } from '../registry/types';
import { IconButton } from '../ui';
import { usePreviewScope } from './controls';
import { LiteralEditor } from './editors';
import {
  declaredSubjectType,
  expectedLiteralText,
  isSimpleRef,
  parseValueText,
  rawComparisonMismatch,
  strictSubjectType,
  subjectMayBeNull,
  type ConditionOp,
} from './power-conditions';
import { SubjectPicker } from './power-SubjectPicker';
import { isNumericOp, RULE_OPS, rulesToExpr, ruleSubjectsFor, toRuleLiteral, type RuleLiteral, type RuleOp, type RuleSet } from './rules';
import { safeEvaluate } from './scope';

export interface RulesEditorProps {
  /** The component whose value the rules pick (its own values are offered under "Based on"). */
  node?: UINode | null;
  /** Where the rules are evaluated (defaults to the node). */
  nodeId?: NodeId | null;
  /** Event values in scope (rules on an action's values). */
  eventParams?: string[];
  def: PropDef;
  ext: Extension;
  value: RuleSet;
  onChange: (next: RuleSet) => void;
}

function shortValue(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  const text = typeof v === 'string' ? `“${v}”` : JSON.stringify(v);
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

function whenText(v: RuleLiteral): string {
  return v === null ? '' : String(v);
}

const AS_CONDITION_OP: Record<RuleOp, ConditionOp> = { '>=': 'gte', '>': 'gt', '<=': 'lte', '<': 'lt', '===': 'eq', '!==': 'neq' };

/**
 * The threshold typed for a rule: numbers for "at least / more than…"; for "is / is not" a value of
 * the subject's type — CRM values stay text ("true", "125000"), typed state and numbers follow
 * their type.
 */
export function parseWhen(text: string, op: RuleOp, declared: ReturnType<typeof declaredSubjectType> = 'any', sample?: unknown): RuleLiteral {
  if (isNumericOp(op)) {
    const t = text.trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t;
  }
  return parseValueText(text, AS_CONDITION_OP[op], declared, sample);
}

export function RulesEditor({ node, nodeId: at, eventParams, def, ext, value, onChange }: RulesEditorProps) {
  const id = useId();
  const nodeId = at ?? node?.id ?? null;
  const own = node ? ruleSubjectsFor(node) : [];
  const subject = value.subject.trim();

  // What the rules give right now in the preview (with mock or live data).
  const scope = usePreviewScope(ext, nodeId);
  const subjectNow = useMemo(() => (subject ? safeEvaluate(subject, scope) : null), [subject, scope]);
  const now = useMemo(() => {
    if (!subjectNow?.ok || value.cases.length === 0) return null;
    const r = safeEvaluate(rulesToExpr(value), scope);
    if (!r?.ok) return null;
    return { subject: subjectNow.value, result: r.value };
  }, [subjectNow, value, scope]);
  const sample = subjectNow?.ok ? subjectNow.value : undefined;
  const resultLabel = (v: unknown) => {
    if (def.type.kind === 'enum') {
      const o = def.type.options.find((x) => x.value === v);
      if (o) return o.label ?? String(o.value);
    }
    return shortValue(v);
  };

  const declared = declaredSubjectType(ext, subject);
  // A threshold the exported card's type-check would refuse (e.g. an emptied box for a number).
  const whenProblem = (op: RuleOp, when: RuleLiteral): string | null => {
    if (!isSimpleRef(subject)) return null;
    const expected = rawComparisonMismatch(AS_CONDITION_OP[op], when, strictSubjectType(ext, subject), subjectMayBeNull(ext, subject));
    if (!expected) return null;
    return expected === 'start value' ? `${subject} starts empty: give it a start value, or use “is” / “is not”.` : expectedLiteralText(expected);
  };
  const update = (patch: Partial<RuleSet>) => onChange({ ...value, ...patch });
  const updateCase = (i: number, patch: Partial<RuleSet['cases'][number]>) =>
    update({
      cases: value.cases.map((c, j) => (j === i ? { ...c, ...patch } : c)),
    });

  const valueEditor = (v: RuleLiteral, onValue: (next: RuleLiteral) => void, label: string, key: string) => (
    <LiteralEditor
      key={key}
      id={`${id}-${key}`}
      def={{ ...def, label }}
      value={v as JsonValue}
      onChange={(next) => onValue(toRuleLiteral(next, def))}
      ext={ext}
      nodeId={nodeId}
      required={false}
    />
  );

  return (
    <div className="ub-insp-rules" role="group" aria-label={`${def.label} rules`}>
      <div className="ub-insp-rules__subject">
        <label htmlFor={`${id}-subject`}>Based on</label>
        <SubjectPicker
          id={`${id}-subject`}
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          own={own}
          value={value.subject}
          onChange={(subject) => update({ subject })}
          exprLabel={`${def.label}: what the rules compare`}
        />
        {now && (
          <p className="ub-insp-rules__now" aria-live="polite">
            Right now: {shortValue(now.subject)} → <strong>{resultLabel(now.result)}</strong>
          </p>
        )}
      </div>

      <ol className="ub-insp-rules__list">
        {value.cases.map((c, i) => (
          <li key={i} className="ub-insp-rules__case">
            <div className="ub-insp-rules__cond">
              <span className="ub-insp-rules__if">{i === 0 ? 'If it' : 'Else if it'}</span>
              <select
                className="ub-select ub-insp-rules__select"
                aria-label={`Rule ${i + 1} comparison`}
                value={c.op}
                onChange={(e) => {
                  const op = e.target.value as RuleOp;
                  updateCase(i, { op, when: parseWhen(whenText(c.when), op, declared, sample) });
                }}
              >
                {RULE_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                className="ub-input ub-insp-rules__when"
                aria-label={`Rule ${i + 1} value to compare with`}
                inputMode={isNumericOp(c.op) ? 'decimal' : undefined}
                value={whenText(c.when)}
                onChange={(e) => updateCase(i, { when: parseWhen(e.target.value, c.op, declared, sample) })}
              />
              <IconButton
                size="sm"
                label={`Remove rule ${i + 1}`}
                disabled={value.cases.length === 1}
                onClick={() => update({ cases: value.cases.filter((_, j) => j !== i) })}
              >
                <Trash2 size={12} />
              </IconButton>
            </div>
            {whenProblem(c.op, c.when) && <div className="ub-insp-rules__problem">{whenProblem(c.op, c.when)}</div>}
            <div className="ub-insp-rules__then">
              <ArrowRight size={12} aria-hidden />
              {valueEditor(c.then, (then) => updateCase(i, { then }), `Rule ${i + 1} result`, `then-${i}`)}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="ub-insp-linkbtn ub-insp-rules__add"
        onClick={() => {
          const last = value.cases[value.cases.length - 1];
          update({
            cases: [
              ...value.cases,
              {
                op: last?.op ?? '>=',
                when: last?.when ?? 0,
                then: value.otherwise,
              },
            ],
          });
        }}
      >
        <Plus size={12} aria-hidden /> Add rule
      </button>
      <div className="ub-insp-rules__otherwise">
        <span className="ub-insp-rules__if">Otherwise</span>
        <div className="ub-insp-rules__then">
          <ArrowRight size={12} aria-hidden />
          {valueEditor(value.otherwise, (otherwise) => update({ otherwise }), 'Otherwise result', 'otherwise')}
        </div>
      </div>
    </div>
  );
}
