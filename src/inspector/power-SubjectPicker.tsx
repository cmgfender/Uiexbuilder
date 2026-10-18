/**
 * The "Based on" picker shared by Rules, the condition builder and list filters: one select with
 * the component's own values ("This bar's percentage"), extra groups from the caller (e.g. "Each
 * row" fields of a list), everything in scope at the node (event values, repeat item and its
 * fields, state, computed values, data, record properties, context) and "Something else
 * (expression)…", which shows an expression field with autocomplete.
 */
import { useId, useMemo, useState } from 'react';
import type { Extension, NodeId } from '../model/types';
import { ExpressionInput, usePreviewScope, useScopeVariables } from './controls';
import { SCOPE_KIND_LABELS, type ScopeVariable, type ScopeVariableKind } from './scope';

export interface SubjectChoice {
  label: string;
  expr: string;
  detail?: string;
}

export interface SubjectGroup {
  label: string;
  items: SubjectChoice[];
}

const CUSTOM = '__custom__';

/** Scope variables worth comparing (not setters or helpers). */
const SUBJECT_KINDS: ScopeVariableKind[] = ['param', 'repeat', 'state', 'computed', 'property', 'dataSource', 'context'];

/**
 * Whether a scope variable can be compared. Whole objects / lists only when `lists` is set (a
 * condition can check that a list is empty; a rule compares single values).
 */
export function usableSubject(v: ScopeVariable, lists = false): boolean {
  if (!SUBJECT_KINDS.includes(v.kind)) return false;
  if (!v.members || v.kind === 'repeat' || v.kind === 'param') return true;
  return lists;
}

/**
 * Fields of a value right now, as paths (`deal.properties.amount`): primitive leaves of plain
 * objects, two levels deep (HubSpot records keep their values under `properties`).
 */
export function sampleFields(name: string, value: unknown, max = 40): SubjectChoice[] {
  const out: SubjectChoice[] = [];
  const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const key = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`);
  const walk = (path: string, v: unknown, depth: number) => {
    if (!isPlain(v)) return;
    for (const [k, child] of Object.entries(v)) {
      if (out.length >= max) return;
      const p = `${path}${key(k)}`;
      if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) {
        out.push({ label: p, expr: p, detail: child === null ? 'empty now' : typeof child === 'string' ? `“${clip(child)}” now` : `${String(child)} now` });
      } else if (Array.isArray(child)) {
        out.push({ label: p, expr: p, detail: `list of ${child.length}` });
      } else if (depth < 2) walk(p, child, depth + 1);
    }
  };
  walk(name, value, 1);
  return out;
}

function clip(s: string): string {
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

export interface SubjectPickerProps {
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  value: string;
  onChange: (subject: string) => void;
  /** Values of the component itself (first group, "This component"). */
  own?: SubjectChoice[];
  /** Extra groups shown before the scope (e.g. a list's row fields). */
  groups?: SubjectGroup[];
  /** Offer whole lists and objects (for "is empty"). */
  lists?: boolean;
  /** Hide everything in scope (only `own` / `groups`). */
  scopeless?: boolean;
  /** Scope names not to offer (and their members). */
  exclude?: string[];
  /** Id of the select (or of the expression field when there is nothing to choose from). */
  id?: string;
  /** Accessible name of the select when no <label htmlFor={id}> names it. */
  selectLabel?: string;
  /** Accessible name of the expression field ("Something else"). */
  exprLabel: string;
  placeholder?: string;
}

export function SubjectPicker({
  ext,
  nodeId,
  eventParams,
  value,
  onChange,
  own = [],
  groups = [],
  lists,
  scopeless,
  exclude,
  id,
  selectLabel,
  exprLabel,
  placeholder = 'Choose what to compare…',
}: SubjectPickerProps) {
  const autoId = useId();
  const selectId = id ?? `${autoId}-subject`;
  const scopeVars = useScopeVariables(ext, nodeId, eventParams);
  const scope = usePreviewScope(ext, nodeId);
  const excludeKey = (exclude ?? []).join('\u0000');
  const vars = useMemo(() => {
    if (scopeless) return [];
    const skip = new Set(excludeKey ? excludeKey.split('\u0000') : []);
    return scopeVars.filter((v) => usableSubject(v, lists) && !skip.has(v.name.split(/[.[]/)[0]));
  }, [scopeVars, scopeless, lists, excludeKey]);
  // Fields of the repeat item / event values as they are right now (e.g. `deal.properties.amount`).
  const fields = useMemo(() => {
    const out: SubjectChoice[] = [];
    if (scopeless) return out;
    const seen = new Set(vars.map((v) => v.name));
    for (const v of vars) {
      if (v.kind !== 'repeat' && v.kind !== 'param') continue;
      if (v.name.includes('.') || !(v.name in scope)) continue;
      for (const f of sampleFields(v.name, scope[v.name])) {
        if (!seen.has(f.expr)) {
          seen.add(f.expr);
          out.push(f);
        }
      }
    }
    return out;
  }, [vars, scope, scopeless]);

  const allGroups: Array<{ key: string; label: string; items: SubjectChoice[] }> = [];
  if (own.length) allGroups.push({ key: 'own', label: 'This component', items: own });
  groups.forEach((g, i) => g.items.length && allGroups.push({ key: `g${i}`, label: g.label, items: g.items }));
  for (const kind of SUBJECT_KINDS) {
    const items: SubjectChoice[] = vars.filter((v) => v.kind === kind).map((v) => ({ label: v.name, expr: v.name, detail: v.detail }));
    if (kind === 'repeat' || kind === 'param') {
      const parents = new Set(items.map((i) => i.expr));
      items.push(...fields.filter((f) => parents.has(f.expr.split(/[.[]/)[0])));
    }
    if (items.length) allGroups.push({ key: kind, label: SCOPE_KIND_LABELS[kind], items });
  }

  const subject = value.trim();
  let matched: string | null = null;
  for (const g of allGroups) {
    const i = g.items.findIndex((it) => it.expr.trim() === subject);
    if (i >= 0) {
      matched = `${g.key}:${i}`;
      break;
    }
  }
  const [custom, setCustom] = useState(!matched && subject !== '');
  const hasChoices = allGroups.length > 0;
  const showCustom = custom || (!matched && subject !== '') || !hasChoices;

  return (
    <>
      {hasChoices && (
        <select
          id={selectId}
          className="ub-select ub-insp-rules__select"
          aria-label={selectLabel}
          value={showCustom ? CUSTOM : (matched ?? '')}
          onChange={(e) => {
            const key = e.target.value;
            if (key === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            const [gk, idx] = [key.slice(0, key.lastIndexOf(':')), Number(key.slice(key.lastIndexOf(':') + 1))];
            const item = allGroups.find((g) => g.key === gk)?.items[idx];
            if (item) onChange(item.expr);
          }}
        >
          {!matched && !showCustom && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {allGroups.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.items.map((it, i) => (
                <option key={`${it.expr}:${i}`} value={`${g.key}:${i}`}>
                  {it.label}
                  {it.detail ? ` — ${it.detail}` : ''}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM}>Something else (expression)…</option>
        </select>
      )}
      {showCustom && (
        <ExpressionInput
          id={hasChoices ? undefined : selectId}
          value={value}
          onChange={onChange}
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          placeholder="e.g. properties.amount"
          aria-label={exprLabel}
        />
      )}
    </>
  );
}
