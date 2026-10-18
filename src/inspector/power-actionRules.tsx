/**
 * Rules for values chosen in actions: the alert's type, title and message, a "Set variable" value,
 * the text to copy — "Based on [score] — is at least [80] → Success … Otherwise → Warning". The
 * same Rules editor as on component settings (RulesEditor, rules.ts), stored the same way: a plain
 * expression (`alertTypeExpr`, a set value) or one `{{ … }}` segment in a text, so the exported
 * handler is ordinary code.
 */
import { useState, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import { singleExpression } from '../model/template';
import type { JsonValue, StateVar } from '../model/types';
import type { PropDef } from '../registry/types';
import { cx } from '../ui';
import type { ActionContext } from './actionModel';
import { literalToExpr } from './propValue';
import { parseRules, rulesToExpr, type RuleLiteral, type RuleSet } from './rules';
import { RulesEditor } from './RulesEditor';

/** Rules stored as the only `{{ … }}` of a text, if any. */
export function rulesOfText(text: string): RuleSet | null {
  const expr = singleExpression(text ?? '');
  return expr === null ? null : parseRules(expr);
}

/** A text that shows what the rules pick. */
export function textOfRules(rules: RuleSet): string {
  return `{{ ${rulesToExpr(rules)} }}`;
}

/** The text a rule result becomes when rules are switched off. */
export function ruleLiteralText(v: RuleLiteral): string {
  return v === null || v === undefined ? '' : String(v);
}

/** A "Set variable" value for a rule result (`'Done'`, `3`, `true`). */
export function ruleLiteralExpr(v: RuleLiteral): string {
  return literalToExpr(v as JsonValue);
}

/** The value editor a state variable's rules use (only simple types have rules). */
export function stateRuleDef(v: StateVar | undefined): PropDef | null {
  if (!v) return null;
  const label = `New value of ${v.name}`;
  switch (v.type) {
    case 'string':
      return { name: 'value', label, type: { kind: 'string' } };
    case 'number':
      return { name: 'value', label, type: { kind: 'number' } };
    case 'boolean':
      return { name: 'value', label, type: { kind: 'boolean' } };
    default:
      return null;
  }
}

/** Complete rules are stored right away; rules still being set up (no "Based on") stay a draft. */
function useRulesDraft(stored: RuleSet | null, write: (rules: RuleSet) => void) {
  const [draft, setDraft] = useState<RuleSet | null>(null);
  const rules = draft ?? stored;
  const change = (next: RuleSet) => {
    if (next.subject.trim() && next.cases.length > 0) {
      setDraft(null);
      write(next);
    } else setDraft(next);
  };
  return { rules, change, clear: () => setDraft(null), hasDraft: draft !== null };
}

export interface RulesRowProps {
  id: string;
  label: string;
  ctx: ActionContext;
  /** Type and label of the value the rules pick (enum options, text, number…). */
  def: PropDef;
  /** Rules currently stored in the step, if any. */
  stored: RuleSet | null;
  /** Stores complete rules in the step. */
  write: (rules: RuleSet) => void;
  /** Switches rules off, keeping the "Otherwise" value. */
  off: (otherwise: RuleLiteral) => void;
  /** The current plain value (rules start from it). */
  current: RuleLiteral;
  /** Ready-made rules to start with instead (e.g. alert type: success / warning / error). */
  start?: Omit<RuleSet, 'subject'>;
  /** The plain editor shown without rules. */
  children: ReactNode;
  hint?: ReactNode;
  /** Ids of the plain editor (for the label). */
  htmlFor?: string;
}

/** A labelled field of an action form with a Rules toggle next to its label. */
export function RulesRow({ id, label, ctx, def, stored, write, off, current, start, children, hint, htmlFor }: RulesRowProps) {
  const { rules, change, clear } = useRulesDraft(stored, write);
  const on = rules !== null;
  const toggle = () => {
    if (on) {
      clear();
      if (stored) off(stored.otherwise);
      return;
    }
    change(
      start
        ? { subject: '', cases: start.cases.map((c) => ({ ...c })), otherwise: start.otherwise }
        : { subject: '', cases: [{ op: '>=', when: 50, then: current }], otherwise: current },
    );
  };
  return (
    <div className="ub-insp-field" data-action-field={id}>
      <div className="ub-insp-field__label">
        <label htmlFor={on ? undefined : htmlFor}>{label}</label>
        <span className="ub-insp-field__actions">
          <button
            type="button"
            className={cx('ub-insp-fx ub-insp-rulesbtn', on && 'is-on')}
            aria-pressed={on}
            aria-label={`${on ? 'Stop using rules for' : 'Use rules for'} ${label}`}
            title={on ? 'Stop using rules — keep the “Otherwise” value' : 'Rules — pick this by a value, e.g. a success alert at 80% or more'}
            onClick={toggle}
          >
            <ListFilter size={12} aria-hidden />
          </button>
        </span>
      </div>
      {on ? (
        <RulesEditor ext={ctx.ext} nodeId={ctx.nodeId} eventParams={ctx.eventParams} def={{ ...def, label }} value={rules!} onChange={change} />
      ) : (
        children
      )}
      {hint && !on && <div className="ub-field__hint">{hint}</div>}
    </div>
  );
}
