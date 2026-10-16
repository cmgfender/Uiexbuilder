/**
 * Rules editor for one prop (or a component's text): "Based on [this bar's percentage] — is at
 * least [80] → [Success] … Otherwise → [Danger]". Edits a RuleSet (see rules.ts); the parent
 * stores it as an expression. "Based on" lists the component's own values plus everything in scope
 * at the node (state, computed values, record properties, data, repeat item, context).
 */
import { useId, useMemo, useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import type { Extension, JsonValue, UINode } from '../model/types';
import type { PropDef } from '../registry/types';
import { IconButton } from '../ui';
import { ExpressionInput, usePreviewScope, useScopeVariables } from './controls';
import { LiteralEditor } from './editors';
import { isNumericOp, RULE_OPS, rulesToExpr, ruleSubjectsFor, toRuleLiteral, type RuleLiteral, type RuleOp, type RuleSet } from './rules';
import { safeEvaluate, SCOPE_KIND_LABELS, type ScopeVariable, type ScopeVariableKind } from './scope';

export interface RulesEditorProps {
  node: UINode;
  def: PropDef;
  ext: Extension;
  value: RuleSet;
  onChange: (next: RuleSet) => void;
}

const CUSTOM = '__custom__';

/** Scope variables worth comparing (not setters, helpers or whole objects). */
const SUBJECT_KINDS: ScopeVariableKind[] = ['repeat', 'state', 'computed', 'property', 'dataSource', 'context'];

function usableSubject(v: ScopeVariable): boolean {
  return SUBJECT_KINDS.includes(v.kind) && (!v.members || v.kind === 'repeat');
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

function parseWhen(text: string, op: RuleOp): RuleLiteral {
  const t = text.trim();
  if (isNumericOp(op)) {
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t;
  }
  if (t === 'true' || t === 'false') return t === 'true';
  return text;
}

export function RulesEditor({ node, def, ext, value, onChange }: RulesEditorProps) {
  const id = useId();
  const own = ruleSubjectsFor(node);
  const scopeVars = useScopeVariables(ext, node.id);
  const vars = useMemo(() => scopeVars.filter(usableSubject), [scopeVars]);
  const subject = value.subject.trim();
  const ownIndex = own.findIndex((s) => s.expr.trim() === subject);
  const matchedKey = ownIndex >= 0 ? `own:${ownIndex}` : vars.some((v) => v.name === subject) ? `var:${subject}` : null;
  const [custom, setCustom] = useState(!matchedKey && subject !== '');
  const showCustom = custom || (!matchedKey && subject !== '') || (own.length === 0 && vars.length === 0);
  const groups = SUBJECT_KINDS.map((kind) => ({
    kind,
    items: vars.filter((v) => v.kind === kind),
  })).filter((g) => g.items.length > 0);

  // What the rules give right now in the preview (with mock or live data).
  const scope = usePreviewScope(ext, node.id);
  const now = useMemo(() => {
    if (!subject || value.cases.length === 0) return null;
    const s = safeEvaluate(subject, scope);
    const r = safeEvaluate(rulesToExpr(value), scope);
    if (!s?.ok || !r?.ok) return null;
    return { subject: s.value, result: r.value };
  }, [subject, value, scope]);
  const resultLabel = (v: unknown) => {
    if (def.type.kind === 'enum') {
      const o = def.type.options.find((x) => x.value === v);
      if (o) return o.label ?? String(o.value);
    }
    return shortValue(v);
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
      nodeId={node.id}
      required={false}
    />
  );

  return (
    <div className="ub-insp-rules" role="group" aria-label={`${def.label} rules`}>
      <div className="ub-insp-rules__subject">
        <label htmlFor={`${id}-subject`}>Based on</label>
        {(own.length > 0 || vars.length > 0) && (
          <select
            id={`${id}-subject`}
            className="ub-select ub-insp-rules__select"
            value={showCustom ? CUSTOM : (matchedKey ?? '')}
            onChange={(e) => {
              const key = e.target.value;
              if (key === CUSTOM) {
                setCustom(true);
                return;
              }
              setCustom(false);
              if (key.startsWith('own:')) update({ subject: own[Number(key.slice(4))].expr });
              else if (key.startsWith('var:')) update({ subject: key.slice(4) });
            }}
          >
            {!matchedKey && !showCustom && (
              <option value="" disabled>
                Choose what to compare…
              </option>
            )}
            {own.length > 0 && (
              <optgroup label="This component">
                {own.map((s, i) => (
                  <option key={s.label} value={`own:${i}`}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            )}
            {groups.map((g) => (
              <optgroup key={g.kind} label={SCOPE_KIND_LABELS[g.kind]}>
                {g.items.map((v) => (
                  <option key={v.name} value={`var:${v.name}`}>
                    {v.name}
                    {v.detail ? ` — ${v.detail}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={CUSTOM}>Something else (expression)…</option>
          </select>
        )}
        {showCustom && (
          <ExpressionInput
            id={own.length > 0 || vars.length > 0 ? undefined : `${id}-subject`}
            value={value.subject}
            onChange={(text) => update({ subject: text })}
            ext={ext}
            nodeId={node.id}
            placeholder="e.g. properties.amount"
            aria-label={`${def.label}: what the rules compare`}
          />
        )}
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
                  updateCase(i, { op, when: parseWhen(whenText(c.when), op) });
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
                onChange={(e) => updateCase(i, { when: parseWhen(e.target.value, c.op) })}
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
