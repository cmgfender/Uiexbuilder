/**
 * Visual condition builder: "Show when [deal amount] [is more than] [1000] and … — or …".
 * Groups of AND-ed checks, groups OR-ed (like HubSpot's filter groups); each check picks what to
 * test with the shared "Based on" picker (SubjectPicker), an operator offered for that value's type
 * and a fixed value or another value in scope. The condition is stored as the plain expression
 * `conditionToExpr` writes (power-conditions.ts), recognised again when reopened; anything else is
 * edited as code. Used by Advanced › Show this component, the If step in actions and list filters.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Braces, Check, Minus, Plus, Trash2, X } from 'lucide-react';
import type { Extension, NodeId } from '../model/types';
import type { Scope } from '../runtime';
import { cx, IconButton } from '../ui';
import { ExpressionInput, usePreviewScope } from './controls';
import {
  carryValue,
  clauseProblem,
  clauseToExpr,
  conditionToExpr,
  declaredSubjectType,
  defaultOpFor,
  isNumericComparison,
  opLabel,
  opNeedsValue,
  opsFor,
  parseCondition,
  parseValueText,
  savableCondition,
  strictSubjectType,
  subjectType,
  valueText,
  type ConditionClause,
  type ConditionOp,
  type ConditionSet,
  type ConditionValue,
  type SubjectType,
} from './power-conditions';
import { SubjectPicker, type SubjectGroup } from './power-SubjectPicker';
import { safeEvaluate } from './scope';
import './power-inspector.css';

export interface ConditionBuilderProps {
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  /** The stored expression. */
  value: string;
  onChange: (expr: string) => void;
  /** Name of the whole condition, e.g. "Show when" or "If". */
  label: string;
  /** Extra "Based on" groups (e.g. a list's row fields). */
  groups?: SubjectGroup[];
  /** Hide scope variables in "Based on" (only `groups`). */
  scopeless?: boolean;
  /** Names not to offer (e.g. computed values a list's filter can't read). */
  exclude?: string[];
  /** Scope to show "right now" results with (defaults to the preview scope at the node). */
  scope?: Scope | null;
  /** Placeholder of the code editor. */
  codePlaceholder?: string;
  /** Accessible name of the code editor (defaults to "<label> (code)"). */
  codeLabel?: string;
  /** Text of the button that adds the first check. */
  addLabel?: string;
  /** With no condition yet, show one empty check to fill in (instead of an "add" button). */
  startWithCheck?: boolean;
}

const EMPTY_CLAUSE: ConditionClause = { subject: '', op: 'eq', value: { kind: 'literal', value: '' } };

export function ConditionBuilder({
  ext,
  nodeId,
  eventParams,
  value,
  onChange,
  label,
  groups,
  scopeless,
  exclude,
  scope: scopeOverride,
  codePlaceholder = 'e.g. items.length > 0',
  codeLabel,
  addLabel = 'Add a condition',
  startWithCheck,
}: ConditionBuilderProps) {
  const id = useId();
  const parsed = useMemo(() => parseCondition(value), [value]);
  const typeOf = useMemo(() => (s: string) => declaredSubjectType(ext, s), [ext]);
  // What a fixed value must be for the exported card to compile (problems shown under a check).
  const strictOf = useMemo(() => (s: string) => strictSubjectType(ext, s), [ext]);
  // Checks being set up that are not complete yet (no subject chosen) live here until they are.
  const [draft, setDraft] = useState<ConditionSet | null>(() =>
    startWithCheck && parsed !== null && parsed.groups.length === 0 ? { groups: [[{ ...EMPTY_CLAUSE }]] } : null,
  );
  const [code, setCode] = useState(parsed === null);
  const lastWritten = useRef<string | null>(null);
  useEffect(() => {
    // Undo / another editor changed the stored condition: show that instead of the draft.
    if (lastWritten.current !== null && value !== lastWritten.current) {
      setDraft(null);
      lastWritten.current = null;
    }
  }, [value]);
  const previewScope = usePreviewScope(ext, nodeId);
  const scope = scopeOverride ?? previewScope;

  const set = draft ?? parsed;
  const change = (next: ConditionSet) => {
    setDraft(next);
    // A check whose value doesn't fit yet (it shows its problem) is saved once it is fixed.
    const expr = conditionToExpr(savableCondition(next, strictOf), { typeOf });
    lastWritten.current = expr;
    if (expr !== value) onChange(expr);
  };

  if (code || set === null) {
    return (
      <div className="ub-pw-cond" role="group" aria-label={label}>
        <div className="ub-pw-cond__mode">
          <span className="ub-pw-cond__title">{label}</span>
          <button
            type="button"
            className="ub-insp-linkbtn"
            onClick={() => {
              if (parsed === null) return;
              setDraft(null);
              setCode(false);
            }}
            disabled={parsed === null}
            title={parsed === null ? 'This code is not a simple list of checks, so it can only be edited as code' : undefined}
          >
            Use the builder
          </button>
        </div>
        <ExpressionInput
          value={value}
          onChange={(t) => onChange(t.trim() ? t : '')}
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          placeholder={codePlaceholder}
          aria-label={codeLabel ?? `${label} (code)`}
          hidePreview
        />
        {parsed === null && value.trim() !== '' && (
          <div className="ub-pw-cond__note">
            Written as code the builder can’t show.{' '}
            <button
              type="button"
              className="ub-insp-linkbtn"
              onClick={() => {
                setCode(false);
                change({ groups: [[{ ...EMPTY_CLAUSE }]] });
              }}
            >
              Start over with the builder
            </button>
          </div>
        )}
      </div>
    );
  }

  const groupsNow = set.groups;
  const updateClause = (g: number, c: number, next: ConditionClause) =>
    change({ groups: groupsNow.map((grp, i) => (i === g ? grp.map((cl, j) => (j === c ? next : cl)) : grp)) });
  const removeClause = (g: number, c: number) =>
    change({
      groups: groupsNow.map((grp, i) => (i === g ? grp.filter((_, j) => j !== c) : grp)).filter((grp) => grp.length > 0),
    });
  const addClause = (g: number) => change({ groups: groupsNow.map((grp, i) => (i === g ? [...grp, { ...EMPTY_CLAUSE }] : grp)) });
  const addGroup = () => change({ groups: [...groupsNow, [{ ...EMPTY_CLAUSE }]] });

  return (
    <div className="ub-pw-cond" role="group" aria-label={label}>
      <div className="ub-pw-cond__mode">
        <span className="ub-pw-cond__title">{label}</span>
        <button
          type="button"
          className="ub-pw-cond__code"
          onClick={() => setCode(true)}
          title="Edit the condition as a JavaScript expression"
          aria-label={`${label}: edit as code`}
        >
          <Braces size={12} aria-hidden /> Code
        </button>
      </div>
      {groupsNow.length === 0 ? (
        <button type="button" className="ub-btn ub-btn--sm ub-pw-cond__add" onClick={addGroup}>
          <Plus size={13} aria-hidden /> {addLabel}
        </button>
      ) : (
        <>
          {groupsNow.map((grp, g) => (
            <div key={g} className="ub-pw-cond__groupwrap">
              {g > 0 && (
                <div className="ub-pw-cond__or" aria-hidden>
                  <span>or</span>
                </div>
              )}
              <div className="ub-pw-cond__group" role="group" aria-label={`${label}: group ${g + 1}`}>
                {grp.map((c, i) => (
                  <ClauseRow
                    key={i}
                    id={`${id}-${g}-${i}`}
                    index={i}
                    clause={c}
                    ext={ext}
                    nodeId={nodeId}
                    eventParams={eventParams}
                    groups={groups}
                    scopeless={scopeless}
                    exclude={exclude}
                    scope={scope}
                    typeOf={typeOf}
                    strictOf={strictOf}
                    label={groupsNow.length > 1 ? `Group ${g + 1}, check ${i + 1}` : `Check ${i + 1}`}
                    onChange={(next) => updateClause(g, i, next)}
                    onRemove={() => removeClause(g, i)}
                  />
                ))}
                <button type="button" className="ub-insp-linkbtn ub-pw-cond__more" onClick={() => addClause(g)}>
                  <Plus size={12} aria-hidden /> And…
                </button>
              </div>
            </div>
          ))}
          <button type="button" className="ub-insp-linkbtn ub-pw-cond__more" onClick={addGroup} title="Add another group of checks: either group may match">
            <Plus size={12} aria-hidden /> Or…
          </button>
        </>
      )}
    </div>
  );
}

interface ClauseRowProps {
  id: string;
  index: number;
  clause: ConditionClause;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  groups?: SubjectGroup[];
  scopeless?: boolean;
  exclude?: string[];
  scope: Scope;
  typeOf: (s: string) => SubjectType;
  strictOf: (s: string) => SubjectType;
  label: string;
  onChange: (next: ConditionClause) => void;
  onRemove: () => void;
}

function ClauseRow({ id, index, clause, ext, nodeId, eventParams, groups, scopeless, exclude, scope, typeOf, strictOf, label, onChange, onRemove }: ClauseRowProps) {
  const subject = clause.subject.trim();
  const sampleRes = useMemo(() => (subject ? safeEvaluate(subject, scope) : null), [subject, scope]);
  const sample = sampleRes?.ok ? sampleRes.value : undefined;
  const declared = typeOf(subject);
  const type = subjectType(declared, sample);
  const ops = opsFor(type, clause.op);
  const problem = subject ? clauseProblem(clause, strictOf(subject)) : null;
  const result = useMemo(() => {
    const expr = clauseToExpr(clause, { typeOf });
    if (!expr) return null;
    const r = safeEvaluate(expr, scope);
    return r?.ok ? !!r.value : null;
  }, [clause, typeOf, scope]);

  const pickSubject = (next: string) => {
    const nextDeclared = typeOf(next.trim());
    const r = next.trim() ? safeEvaluate(next, scope) : null;
    const nextSample = r?.ok ? r.value : undefined;
    const nextType = subjectType(nextDeclared, nextSample);
    // Keep the check when it still fits the new value (its typed value read for the new type);
    // otherwise start with the natural one.
    if (clause.subject.trim() && opsFor(nextType).includes(clause.op)) {
      return onChange({ subject: next, op: clause.op, ...(opNeedsValue(clause.op) ? { value: carryValue(clause.value, clause.op, nextDeclared, nextSample) } : {}) });
    }
    const op = defaultOpFor(nextType, nextSample);
    onChange({ subject: next, op, ...(opNeedsValue(op) ? { value: { kind: 'literal', value: op === 'gt' ? 0 : '' } } : {}) });
  };
  const pickOp = (op: ConditionOp) => {
    if (!opNeedsValue(op)) return onChange({ subject: clause.subject, op });
    onChange({ subject: clause.subject, op, value: carryValue(clause.value, op, declared, sample) });
  };

  return (
    <div className={cx('ub-pw-cond__clause', problem && 'is-invalid')} role="group" aria-label={label}>
      {index > 0 && <span className="ub-pw-cond__and">and</span>}
      <div className="ub-pw-cond__subject">
        <SubjectPicker
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          groups={groups}
          scopeless={scopeless}
          exclude={exclude}
          lists
          value={clause.subject}
          onChange={pickSubject}
          selectLabel={`${label}: what to check`}
          exprLabel={`${label}: what to check (expression)`}
          placeholder="Choose what to check…"
        />
      </div>
      <div className={cx('ub-pw-cond__test', !opNeedsValue(clause.op) && 'is-novalue')}>
        <select
          className="ub-select ub-pw-cond__op"
          aria-label={`${label}: comparison`}
          value={clause.op}
          disabled={!subject}
          onChange={(e) => pickOp(e.target.value as ConditionOp)}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {opLabel(op, type)}
            </option>
          ))}
        </select>
        {opNeedsValue(clause.op) && (
          <ValueField
            id={`${id}-value`}
            clause={clause}
            declared={declared}
            sample={sample}
            ext={ext}
            nodeId={nodeId}
            eventParams={eventParams}
            groups={groups}
            scopeless={scopeless}
            exclude={exclude}
            label={label}
            disabled={!subject}
            onChange={(value) => onChange({ ...clause, value })}
          />
        )}
        {result !== null && !problem ? (
          <span
            className={cx('ub-pw-cond__now', result ? 'is-yes' : 'is-no')}
            title={result ? 'True right now (preview data)' : 'False right now (preview data)'}
            aria-label={result ? 'True right now' : 'False right now'}
            role="img"
          >
            {result ? <Check size={12} aria-hidden /> : <Minus size={12} aria-hidden />}
          </span>
        ) : (
          <span className="ub-pw-cond__now" aria-hidden />
        )}
        <IconButton size="sm" label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <Trash2 size={12} />
        </IconButton>
      </div>
      {problem && <div className="ub-pw-cond__problem">{problem}</div>}
    </div>
  );
}

function ValueField({
  id,
  clause,
  declared,
  sample,
  ext,
  nodeId,
  eventParams,
  groups,
  scopeless,
  exclude,
  label,
  disabled,
  onChange,
}: {
  id: string;
  clause: ConditionClause;
  declared: SubjectType;
  sample: unknown;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  groups?: SubjectGroup[];
  scopeless?: boolean;
  exclude?: string[];
  label: string;
  disabled: boolean;
  onChange: (v: ConditionValue) => void;
}) {
  const v = clause.value ?? { kind: 'literal', value: '' };
  const [text, setText] = useState(v.kind === 'literal' ? valueText(v.value) : '');
  const literal = v.kind === 'literal' ? v.value : undefined;
  useEffect(() => {
    // Keep the typed text (e.g. "1.") unless the stored value changed to something else.
    if (v.kind === 'literal' && parseValueText(text, clause.op, declared, sample) !== literal) setText(valueText(literal));
  }, [literal, v.kind]);

  if (v.kind === 'ref') {
    return (
      <div className="ub-pw-cond__value is-ref">
        <SubjectPicker
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          groups={groups}
          scopeless={scopeless}
          exclude={exclude}
          value={v.expr}
          onChange={(expr) => onChange({ kind: 'ref', expr })}
          selectLabel={`${label}: value to compare with`}
          exprLabel={`${label}: value to compare with (expression)`}
          placeholder="Choose a value…"
        />
        <IconButton size="sm" label="Type a value instead" onClick={() => onChange({ kind: 'literal', value: '' })}>
          <X size={12} />
        </IconButton>
      </div>
    );
  }

  const bool = declared === 'boolean' && (clause.op === 'eq' || clause.op === 'neq');
  return (
    <div className="ub-pw-cond__value">
      {bool ? (
        <select
          id={id}
          className="ub-select"
          aria-label={`${label}: value`}
          value={String(literal === true)}
          disabled={disabled}
          onChange={(e) => onChange({ kind: 'literal', value: e.target.value === 'true' })}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input
          id={id}
          className="ub-input"
          aria-label={`${label}: value`}
          value={text}
          disabled={disabled}
          inputMode={isNumericComparison(clause.op) || declared === 'number' ? 'decimal' : undefined}
          placeholder={isNumericComparison(clause.op) ? '0' : 'text'}
          onChange={(e) => {
            setText(e.target.value);
            onChange({ kind: 'literal', value: parseValueText(e.target.value, clause.op, declared, sample) });
          }}
        />
      )}
      <IconButton
        size="sm"
        label="Compare with another value (state, data, a field…)"
        disabled={disabled}
        onClick={() => onChange({ kind: 'ref', expr: '' })}
      >
        <Braces size={12} />
      </IconButton>
    </div>
  );
}
