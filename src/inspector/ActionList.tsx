/**
 * No-code action editor: an ordered list of action steps rendered as cards (reorder, duplicate,
 * delete, collapse), an "+ Add action" menu grouped by purpose and a form per step type. If/else
 * branches and fetch / app function callbacks nest further ActionLists.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Code, CopyPlus, Maximize2, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '../model/store';
import type {
  ActionStep,
  AddAlertAction,
  AlertType,
  CloseOverlayAction,
  CopyToClipboardAction,
  CustomCodeAction,
  FetchAction,
  HttpMethod,
  IfAction,
  LogAction,
  LogLevel,
  OpenIframeModalAction,
  RunDataSourceAction,
  RunFunctionAction,
  SetStateAction,
  StateVar,
  StateVarType,
} from '../model/types';
import { setterName } from '../runtime';
import { useDialogs } from '../shell/dialogs';
import { Button, cx, IconButton, NumberField, Segmented, Select, Switch, TextInput } from '../ui';
import { uniqueDeclaredName, validateDeclaredName } from '../panels/names';
import {
  ACTION_GROUP_ORDER,
  actionKindInfo,
  availableActionKinds,
  createStep,
  defaultSetValue,
  duplicateStep,
  overlayNodes,
  summarizeStep,
  type ActionContext,
  type ActionKindInfo,
} from './actionModel';
import { ChipsInput } from './ChipsInput';
import { ExpressionInput, TemplateInput } from './controls';
import { ConditionBuilder } from './power-ConditionBuilder';
import { ruleLiteralExpr, ruleLiteralText, rulesOfText, RulesRow, stateRuleDef, textOfRules } from './power-actionRules';
import { parseRules, rulesToExpr } from './rules';
import type { PropDef } from '../registry/types';
import { asOneUndoStep } from './history';
import { Popover } from './Popover';
import { CodeEditorDialog } from '../power/CodeEditor';
import { RequestOptions } from './RequestOptions';
import { moveItem } from './propValue';

export interface ActionListProps {
  steps: ActionStep[];
  onChange: (steps: ActionStep[]) => void;
  ctx: ActionContext;
  /** Nesting depth (0 = event handler). */
  depth?: number;
  emptyText?: string;
  /** Accessible name of the list, e.g. "On click actions". */
  label?: string;
}

export function ActionList({ steps, onChange, ctx, depth = 0, emptyText, label }: ActionListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const update = (i: number, step: ActionStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  return (
    <div className={cx('ub-insp-actions', depth > 0 && 'is-nested')}>
      {steps.length === 0 ? (
        <div className="ub-insp-actions__empty">{emptyText ?? 'No actions yet.'}</div>
      ) : (
        <ol className="ub-insp-steps" aria-label={label ?? 'Actions'}>
          {steps.map((s, i) => (
            <li key={s.id}>
              <StepCard
                step={s}
                index={i}
                count={steps.length}
                ctx={ctx}
                depth={depth}
                collapsed={collapsed.has(s.id)}
                onToggle={() => toggle(s.id)}
                onChange={(next) => update(i, next)}
                onMove={(to) => onChange(moveItem(steps, i, to))}
                onDuplicate={() => {
                  const copy = duplicateStep(s);
                  onChange([...steps.slice(0, i + 1), copy, ...steps.slice(i + 1)]);
                }}
                onDelete={() => onChange(steps.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      <AddActionButton ctx={ctx} onAdd={(type) => onChange([...steps, createStep(type, ctx)])} compact={depth > 0} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add action menu
// ---------------------------------------------------------------------------

function AddActionButton({ ctx, onAdd, compact }: { ctx: ActionContext; onAdd: (type: ActionStep['type']) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const kinds = useMemo(() => availableActionKinds(ctx.ext), [ctx.ext]);
  const groups = ACTION_GROUP_ORDER.map((g) => ({ group: g, items: kinds.filter((k) => k.group === g) })).filter((g) => g.items.length);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };
  const pick = (k: ActionKindInfo) => {
    close(true);
    onAdd(k.type);
  };
  const focusItem = (delta: number) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = i === -1 ? (delta > 0 ? 0 : items.length - 1) : (i + delta + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={cx('ub-btn ub-btn--sm ub-insp-addaction', compact && 'is-compact')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Plus size={13} aria-hidden /> Add action
      </button>
      <Popover
        anchor={btnRef.current}
        open={open}
        onClose={() => close(false)}
        width={272}
        maxHeight={420}
        role="menu"
        aria-label="Add action"
        autoFocus
      >
        <div
          ref={menuRef}
          className="ub-insp-addmenu"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              focusItem(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              focusItem(-1);
            }
          }}
        >
          {groups.map((g) => (
            <div key={g.group} role="group" aria-label={g.group}>
              <div className="ub-insp-vp__group">{g.group}</div>
              {g.items.map((k) => {
                const Icon = k.icon;
                return (
                  <button key={k.type} type="button" role="menuitem" className="ub-insp-addmenu__item" onClick={() => pick(k)}>
                    <span className="ub-insp-addmenu__icon" aria-hidden>
                      <Icon size={14} />
                    </span>
                    <span className="ub-insp-addmenu__text">
                      <span className="ub-insp-addmenu__label">{k.label}</span>
                      <span className="ub-insp-addmenu__desc">{k.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step card
// ---------------------------------------------------------------------------

interface StepCardProps {
  step: ActionStep;
  index: number;
  count: number;
  ctx: ActionContext;
  depth: number;
  collapsed: boolean;
  onToggle: () => void;
  onChange: (step: ActionStep) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function StepCard({ step, index, count, ctx, depth, collapsed, onToggle, onChange, onMove, onDuplicate, onDelete }: StepCardProps) {
  const info = actionKindInfo(step.type);
  const Icon = info?.icon ?? Code;
  const title = info?.label ?? step.type;
  return (
    <div
      className={cx('ub-insp-step', collapsed && 'is-collapsed')}
      data-step-type={step.type}
      aria-label={`Step ${index + 1}: ${title}`}
      role="group"
    >
      <div className="ub-insp-step__head">
        <button
          type="button"
          className="ub-insp-step__toggle"
          aria-expanded={!collapsed}
          onClick={onToggle}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
          <span className="ub-insp-step__icon" aria-hidden>
            <Icon size={13} />
          </span>
          <span className="ub-insp-step__title">{title}</span>
        </button>
        <span className="ub-insp-step__tools">
          <IconButton size="sm" label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUp size={12} />
          </IconButton>
          <IconButton size="sm" label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <ArrowDown size={12} />
          </IconButton>
          <IconButton size="sm" label="Duplicate action" onClick={onDuplicate}>
            <CopyPlus size={12} />
          </IconButton>
          <IconButton size="sm" label="Delete action" onClick={onDelete}>
            <Trash2 size={12} />
          </IconButton>
        </span>
      </div>
      {collapsed ? (
        <button type="button" className="ub-insp-step__summary" onClick={onToggle}>
          {summarizeStep(step, ctx)}
        </button>
      ) : (
        <div className="ub-insp-step__body">
          <StepForm step={step} onChange={onChange} ctx={ctx} depth={depth} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step forms
// ---------------------------------------------------------------------------

function Row({
  label,
  htmlFor,
  children,
  hint,
  actions,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="ub-insp-field">
      <div className="ub-insp-field__label">
        <label htmlFor={htmlFor}>{label}</label>
        {actions && <span className="ub-insp-field__actions">{actions}</span>}
      </div>
      {children}
      {hint && <div className="ub-field__hint">{hint}</div>}
    </div>
  );
}

export function ParamChips({ params, title }: { params: string[]; title?: string }) {
  if (!params.length) return null;
  return (
    <span className="ub-insp-params" title={title ?? 'Available in these actions'}>
      {params.map((p) => (
        <code key={p} className="ub-insp-param">
          {p}
        </code>
      ))}
    </span>
  );
}

function StepForm({
  step,
  onChange,
  ctx,
  depth,
}: {
  step: ActionStep;
  onChange: (s: ActionStep) => void;
  ctx: ActionContext;
  depth: number;
}) {
  const id = step.id;
  switch (step.type) {
    case 'setState':
      return <SetStateForm step={step} onChange={onChange} ctx={ctx} />;
    case 'addAlert':
      return <AlertForm step={step} onChange={onChange} ctx={ctx} />;
    case 'refreshObjectProperties':
      return <div className="ub-insp-help">Reloads the property values shown on the record page (and in CRM data components).</div>;
    case 'reloadPage':
      return <div className="ub-insp-help">Reloads the whole HubSpot page. Unsaved input in the card is lost.</div>;
    case 'openIframeModal':
      return <IframeForm step={step} onChange={onChange} ctx={ctx} />;
    case 'closeOverlay':
      return <CloseOverlayForm step={step} onChange={onChange} ctx={ctx} />;
    case 'copyToClipboard': {
      const s = step as CopyToClipboardAction;
      const empty = !s.text.trim();
      return (
        <RulesRow
          id="text"
          label="Text to copy"
          htmlFor={`${id}-text`}
          ctx={ctx}
          def={TEXT_DEF}
          stored={rulesOfText(s.text)}
          write={(r) => onChange({ ...s, text: textOfRules(r) })}
          off={(v) => onChange({ ...s, text: ruleLiteralText(v) })}
          current={s.text}
        >
          <TemplateInput
            id={`${id}-text`}
            value={s.text}
            onChange={(text) => onChange({ ...s, text })}
            ext={ctx.ext}
            nodeId={ctx.nodeId}
            eventParams={ctx.eventParams}
            placeholder="Text or {{ variable }} to copy"
          />
          {empty && (
            <div className="ub-insp-note" role="status">
              Nothing will be copied yet — type the text, or insert a {'{{ variable }}'}.
            </div>
          )}
        </RulesRow>
      );
    }
    case 'runDataSource':
      return <RunDataSourceForm step={step} onChange={onChange} ctx={ctx} />;
    case 'fetch':
      return <FetchForm step={step} onChange={onChange} ctx={ctx} depth={depth} />;
    case 'runFunction':
      return <RunFunctionForm step={step} onChange={onChange} ctx={ctx} depth={depth} />;
    case 'log':
      return <LogForm step={step} onChange={onChange} ctx={ctx} />;
    case 'if':
      return <IfForm step={step} onChange={onChange} ctx={ctx} depth={depth} />;
    case 'custom':
      return <CustomForm step={step} onChange={onChange} ctx={ctx} />;
    default:
      return <div className="ub-insp-help">Unknown action type.</div>;
  }
}

// ---- state variable picker with inline "new variable"

const STATE_TYPES: StateVarType[] = ['string', 'number', 'boolean', 'array', 'object', 'any'];

/** Value editor of text picked by rules (alert title / message, text to copy). */
const TEXT_DEF: PropDef = { name: 'text', label: 'Text', type: { kind: 'string' } };

/** The simple value a "Set variable" expression stands for (where rules start), else an empty one. */
function literalOf(expr: string, v: StateVar | undefined): string | number | boolean | null {
  const t = expr.trim();
  if (v?.type === 'number') return t !== '' && Number.isFinite(Number(t)) ? Number(t) : 0;
  if (v?.type === 'boolean') return t === 'true' ? true : t === 'false' ? false : true;
  const quoted = /^(['"])(.*)\1$/s.exec(t);
  return quoted ? quoted[2] : '';
}

function initialFor(type: StateVarType) {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/** The new state variable being named (not yet in the extension). */
const NEW_STATE = { kind: 'state' as const, id: '__new__' };

export function StateVarSelect({
  id,
  value,
  onChange,
  ctx,
  placeholder = 'Choose a variable',
  suggestedName = 'value',
  suggestedType = 'string',
  allowNone,
}: {
  id?: string;
  value: string;
  /** `created` is set when the user just created the variable (it is not in `ctx.ext` yet). */
  onChange: (name: string, created?: StateVar) => void;
  ctx: ActionContext;
  placeholder?: string;
  suggestedName?: string;
  suggestedType?: StateVarType;
  allowNone?: boolean;
}) {
  const [creating, setCreating] = useState<{ name: string; type: StateVarType } | null>(null);
  const vars = ctx.ext.state;
  const missing = value && !vars.some((v) => v.name === value);
  if (creating) {
    // Same rule as the Data panel and the Problems panel (setters, data source Loading/Error
    // names, computed values, helpers and reserved words count as taken).
    const error = validateDeclaredName(ctx.ext, creating.name, NEW_STATE);
    const valid = error === null;
    const submit = () => {
      if (!valid) return;
      // Creating the variable and selecting it is one gesture: one undo step.
      asOneUndoStep(() => {
        const v = useEditor
          .getState()
          .addStateVar({ name: creating.name.trim(), type: creating.type, initial: initialFor(creating.type) });
        setCreating(null);
        onChange(v.name, v);
      });
    };
    return (
      <div className="ub-insp-stack">
        <div className="ub-insp-inline">
          <TextInput
            code
            autoFocus
            value={creating.name}
            onChange={(name) => setCreating({ ...creating, name })}
            aria-label="New variable name"
            invalid={!valid}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setCreating(null);
              }
            }}
          />
          <Select
            aria-label="New variable type"
            value={creating.type}
            onChange={(t) => setCreating({ ...creating, type: t as StateVarType })}
            options={STATE_TYPES.map((t) => ({ value: t, label: t }))}
            className="ub-insp-typeselect"
          />
        </div>
        {error && <div className="ub-field__error">{error}.</div>}
        <div className="ub-insp-row-actions">
          <Button size="sm" variant="primary" disabled={!valid} onClick={submit}>
            Create variable
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="ub-insp-inline">
      <Select
        id={id}
        value={value}
        onChange={onChange}
        placeholder={allowNone ? "Don't store" : placeholder}
        options={[
          ...vars.map((v) => ({ value: v.name, label: `${v.name} (${v.type})` })),
          ...(missing ? [{ value, label: `${value} (missing)` }] : []),
        ]}
      />
      <IconButton
        size="sm"
        label="New state variable"
        onClick={() => setCreating({ name: uniqueDeclaredName(ctx.ext, suggestedName, NEW_STATE), type: suggestedType })}
      >
        <Plus size={13} />
      </IconButton>
    </div>
  );
}

function SetStateForm({ step, onChange, ctx }: { step: SetStateAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  const v = ctx.ext.state.find((s) => s.name === step.state);
  const quick: Array<{ label: string; value: string; title: string }> = [];
  if (v?.type === 'boolean') quick.push({ label: 'Toggle', value: `!${v.name}`, title: `Flip ${v.name} between true and false` });
  if (v?.type === 'number') quick.push({ label: 'Increment', value: `${v.name} + 1`, title: `Add 1 to ${v.name}` });
  if (ctx.eventParams.includes('value'))
    quick.push({ label: 'Use event value', value: 'value', title: 'The new value delivered by the event' });
  if (ctx.eventParams.includes('checked'))
    quick.push({ label: 'Use checked', value: 'checked', title: 'Whether the control is now checked' });
  if (ctx.eventParams.includes('response')) quick.push({ label: 'Use response', value: 'response', title: 'The response of the request' });
  const ruleDef = stateRuleDef(v);
  const currentLiteral = literalOf(step.value, v);
  const valueInput = (
    <ExpressionInput
      id={`${step.id}-value`}
      value={step.value}
      onChange={(value) => onChange({ ...step, value })}
      ext={ctx.ext}
      nodeId={ctx.nodeId}
      eventParams={ctx.eventParams}
      placeholder={v?.type === 'string' ? "e.g. 'Done' or value" : 'e.g. count + 1'}
    />
  );
  return (
    <>
      <Row label="Variable" htmlFor={`${step.id}-state`}>
        <StateVarSelect
          id={`${step.id}-state`}
          value={step.state}
          onChange={(state, created) => {
            // A value the user didn't write (blank or the previous variable's default) follows
            // the newly chosen variable, so it stays type-correct.
            const next = created ?? ctx.ext.state.find((s) => s.name === state);
            const untouched = !step.value.trim() || step.value === defaultSetValue(v, ctx.eventParams);
            onChange({ ...step, state, ...(untouched && next ? { value: defaultSetValue(next, ctx.eventParams) } : {}) });
          }}
          ctx={ctx}
        />
      </Row>
      {ruleDef ? (
        <RulesRow
          id="value"
          label="New value"
          htmlFor={`${step.id}-value`}
          ctx={ctx}
          def={ruleDef}
          stored={parseRules(step.value)}
          write={(r) => onChange({ ...step, value: rulesToExpr(r) })}
          off={(lit) => onChange({ ...step, value: ruleLiteralExpr(lit) })}
          current={currentLiteral}
        >
          {valueInput}
        </RulesRow>
      ) : (
        <Row
          label="New value"
          htmlFor={`${step.id}-value`}
          hint={!ctx.ext.state.length ? 'Create a state variable with + to store values between clicks.' : undefined}
        >
          {valueInput}
        </Row>
      )}
      {quick.length > 0 && !parseRules(step.value) && (
        <div className="ub-insp-quick" aria-label="Quick values">
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              className="ub-insp-quick__btn"
              title={q.title}
              onClick={() => onChange({ ...step, value: q.value })}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const ALERT_TYPES: Array<{ value: AlertType; label: string }> = [
  { value: 'success', label: 'Success' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Error' },
  { value: 'tip', label: 'Tip' },
];

/** Alert type rules start like the progress bar's color: success from 80, warning from 40, else error. */
const ALERT_TYPE_RULES_START = {
  cases: [
    { op: '>=' as const, when: 80, then: 'success' },
    { op: '>=' as const, when: 40, then: 'warning' },
  ],
  otherwise: 'danger',
};

const ALERT_TYPE_DEF: PropDef = {
  name: 'type',
  label: 'Type',
  type: { kind: 'enum', options: ALERT_TYPES.map((t) => ({ value: t.value, label: t.label })) },
};

function AlertForm({ step, onChange, ctx }: { step: AddAlertAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  const typeRules = step.alertTypeExpr ? parseRules(step.alertTypeExpr) : null;
  const withoutExpr = (patch: Partial<AddAlertAction>): AddAlertAction => {
    const next: AddAlertAction = { ...step, ...patch };
    delete next.alertTypeExpr;
    return next;
  };
  return (
    <>
      {step.alertTypeExpr && !typeRules ? (
        <Row
          label="Type"
          htmlFor={`${step.id}-typeexpr`}
          actions={
            <button type="button" className="ub-insp-linkbtn" onClick={() => onChange(withoutExpr({}))}>
              Use a fixed type
            </button>
          }
        >
          <ExpressionInput
            id={`${step.id}-typeexpr`}
            value={step.alertTypeExpr}
            onChange={(alertTypeExpr) => onChange(alertTypeExpr.trim() ? { ...step, alertTypeExpr } : withoutExpr({}))}
            ext={ctx.ext}
            nodeId={ctx.nodeId}
            eventParams={ctx.eventParams}
            aria-label="Alert type expression"
          />
        </Row>
      ) : (
        <RulesRow
          id="type"
          label="Type"
          ctx={ctx}
          def={ALERT_TYPE_DEF}
          stored={typeRules}
          write={(r) => onChange({ ...step, alertTypeExpr: rulesToExpr(r) })}
          off={(v) => onChange(withoutExpr({ alertType: ALERT_TYPES.some((t) => t.value === v) ? (v as AlertType) : step.alertType }))}
          current={step.alertType}
          start={ALERT_TYPE_RULES_START}
        >
          <Segmented<AlertType>
            aria-label="Alert type"
            value={step.alertType}
            onChange={(alertType) => onChange({ ...step, alertType })}
            options={ALERT_TYPES}
          />
        </RulesRow>
      )}
      <RulesRow
        id="title"
        label="Title"
        htmlFor={`${step.id}-title`}
        ctx={ctx}
        def={TEXT_DEF}
        stored={rulesOfText(step.title)}
        write={(r) => onChange({ ...step, title: textOfRules(r) })}
        off={(v) => onChange({ ...step, title: ruleLiteralText(v) })}
        current={step.title}
      >
        <TemplateInput
          id={`${step.id}-title`}
          value={step.title}
          onChange={(title) => onChange({ ...step, title })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="Optional"
        />
      </RulesRow>
      <RulesRow
        id="message"
        label="Message"
        htmlFor={`${step.id}-message`}
        ctx={ctx}
        def={TEXT_DEF}
        stored={rulesOfText(step.message)}
        write={(r) => onChange({ ...step, message: textOfRules(r) })}
        off={(v) => onChange({ ...step, message: ruleLiteralText(v) })}
        current={step.message}
      >
        <TemplateInput
          id={`${step.id}-message`}
          value={step.message}
          onChange={(message) => onChange({ ...step, message })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="e.g. Saved {{ name }}"
        />
      </RulesRow>
    </>
  );
}

function IframeForm({ step, onChange, ctx }: { step: OpenIframeModalAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  return (
    <>
      <Row label="URL" htmlFor={`${step.id}-uri`} hint="Keep the host as fixed text so it can be added to the app’s permitted iframe URLs.">
        <TemplateInput
          id={`${step.id}-uri`}
          value={step.uri}
          onChange={(uri) => onChange({ ...step, uri })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="https://…"
        />
      </Row>
      <Row label="Modal title" htmlFor={`${step.id}-title`}>
        <TemplateInput
          id={`${step.id}-title`}
          value={step.title}
          onChange={(title) => onChange({ ...step, title })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
        />
      </Row>
      <div className="ub-insp-grid2">
        <Row label="Width (px)" htmlFor={`${step.id}-w`}>
          <NumberField id={`${step.id}-w`} value={step.width} min={100} onChange={(width) => onChange({ ...step, width: width ?? 640 })} />
        </Row>
        <Row label="Height (px)" htmlFor={`${step.id}-h`}>
          <NumberField
            id={`${step.id}-h`}
            value={step.height}
            min={100}
            onChange={(height) => onChange({ ...step, height: height ?? 480 })}
          />
        </Row>
      </div>
      <Switch
        checked={!!step.flush}
        onChange={(flush) => onChange({ ...step, flush: flush || undefined })}
        label="Flush (no padding around the page)"
      />
    </>
  );
}

function CloseOverlayForm({ step, onChange, ctx }: { step: CloseOverlayAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  const overlays = overlayNodes(ctx.ext);
  const missing = step.overlayNodeId && !overlays.some((o) => o.id === step.overlayNodeId);
  return (
    <Row
      label="Overlay to close"
      htmlFor={`${step.id}-overlay`}
      hint={overlays.length === 0 ? 'Add a Modal or Panel to a button first (Properties → Overlay).' : undefined}
    >
      <Select
        id={`${step.id}-overlay`}
        value={step.overlayNodeId}
        onChange={(overlayNodeId) => onChange({ ...step, overlayNodeId })}
        placeholder="Choose a modal or panel"
        options={[
          ...overlays.map((o) => ({ value: o.id, label: o.label })),
          ...(missing ? [{ value: step.overlayNodeId, label: '(deleted overlay)' }] : []),
        ]}
      />
    </Row>
  );
}

function RunDataSourceForm({ step, onChange, ctx }: { step: RunDataSourceAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  const sources = ctx.ext.dataSources;
  return (
    <Row label="Data source" htmlFor={`${step.id}-ds`}>
      {sources.length ? (
        <Select
          id={`${step.id}-ds`}
          value={step.dataSourceId}
          onChange={(dataSourceId) => onChange({ ...step, dataSourceId })}
          placeholder="Choose a data source"
          options={sources.map((d) => ({ value: d.id, label: `${d.name} (${d.kind})` }))}
        />
      ) : (
        <div className="ub-insp-inline-note">
          No data sources yet.
          <button type="button" className="ub-insp-linkbtn" onClick={() => useEditor.getState().setLeftPanel('data')}>
            Open the Data panel
          </button>
        </div>
      )}
    </Row>
  );
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function CallbackLists({
  step,
  onChange,
  ctx,
  depth,
}: {
  step: FetchAction | RunFunctionAction;
  onChange: (s: ActionStep) => void;
  ctx: ActionContext;
  depth: number;
}) {
  return (
    <div className="ub-insp-branches">
      <div className="ub-insp-branch is-success">
        <div className="ub-insp-branch__head">
          On success <ParamChips params={['response']} />
        </div>
        <ActionList
          steps={step.onSuccess ?? []}
          onChange={(s) => onChange({ ...step, onSuccess: s.length ? s : undefined })}
          ctx={{ ...ctx, eventParams: [...ctx.eventParams.filter((p) => p !== 'response'), 'response'], branch: 'onSuccess' }}
          depth={depth + 1}
          emptyText="Nothing else happens."
          label="On success actions"
        />
      </div>
      <div className="ub-insp-branch is-error">
        <div className="ub-insp-branch__head">
          On error <ParamChips params={['error']} />
        </div>
        <ActionList
          steps={step.onError ?? []}
          onChange={(s) => onChange({ ...step, onError: s.length ? s : undefined })}
          ctx={{ ...ctx, eventParams: [...ctx.eventParams.filter((p) => p !== 'error'), 'error'], branch: 'onError' }}
          depth={depth + 1}
          emptyText="Errors are only logged."
          label="On error actions"
        />
      </div>
    </div>
  );
}

function FetchForm({
  step,
  onChange,
  ctx,
  depth,
}: {
  step: FetchAction;
  onChange: (s: ActionStep) => void;
  ctx: ActionContext;
  depth: number;
}) {
  return (
    <>
      <div className="ub-insp-fetchline">
        <Select
          aria-label="HTTP method"
          value={step.method}
          onChange={(m) => onChange({ ...step, method: m as HttpMethod })}
          options={METHODS.map((m) => ({ value: m, label: m }))}
          className="ub-insp-method"
        />
        <TemplateInput
          value={step.url}
          onChange={(url) => onChange({ ...step, url })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="https://api.example.com/…"
          aria-label="Request URL"
        />
      </div>
      {step.method !== 'GET' && (
        <Row label="Body (JSON object)" htmlFor={`${step.id}-body`}>
          <ExpressionInput
            id={`${step.id}-body`}
            value={step.body ?? ''}
            onChange={(body) => onChange({ ...step, body: body.trim() ? body : undefined })}
            ext={ctx.ext}
            nodeId={ctx.nodeId}
            eventParams={ctx.eventParams}
            placeholder="e.g. { email, note }"
          />
        </Row>
      )}
      <RequestOptions
        ext={ctx.ext}
        nodeId={ctx.nodeId}
        eventParams={ctx.eventParams}
        headers={step.headers}
        timeout={step.timeout}
        onChange={(patch) => {
          const next: FetchAction = { ...step, headers: patch.headers, timeout: patch.timeout };
          if (!next.headers) delete next.headers;
          if (next.timeout === undefined) delete next.timeout;
          onChange(next);
        }}
      />
      <Row label="Store the response in" htmlFor={`${step.id}-result`}>
        <StateVarSelect
          id={`${step.id}-result`}
          value={step.resultState ?? ''}
          onChange={(resultState) => onChange({ ...step, resultState: resultState || undefined })}
          ctx={ctx}
          allowNone
          suggestedName="response"
          suggestedType="any"
        />
      </Row>
      <CallbackLists step={step} onChange={onChange} ctx={ctx} depth={depth} />
    </>
  );
}

function RunFunctionForm({
  step,
  onChange,
  ctx,
  depth,
}: {
  step: RunFunctionAction;
  onChange: (s: ActionStep) => void;
  ctx: ActionContext;
  depth: number;
}) {
  const fns = ctx.project.functions;
  const fn = fns.find((f) => f.id === step.functionId);
  return (
    <>
      <Row
        label="App function"
        htmlFor={`${step.id}-fn`}
        actions={
          fn ? (
            <button type="button" className="ub-insp-linkbtn" onClick={() => useDialogs.getState().open('functions', fn.id)}>
              Edit code
            </button>
          ) : null
        }
      >
        <div className="ub-insp-inline">
          <Select
            id={`${step.id}-fn`}
            value={step.functionId}
            onChange={(functionId) => onChange({ ...step, functionId })}
            placeholder={fns.length ? 'Choose a function' : 'No functions yet'}
            options={fns.map((f) => ({ value: f.id, label: f.uid }))}
          />
          <Button
            size="sm"
            icon={<Plus size={13} />}
            onClick={() =>
              asOneUndoStep(() => {
                const created = useEditor.getState().addFunction();
                onChange({ ...step, functionId: created.id });
              })
            }
            title="Create a new app function"
          >
            Create
          </Button>
        </div>
      </Row>
      <Row
        label="Parameters"
        htmlFor={`${step.id}-params`}
        hint="An object passed as context.parameters, e.g. { email, amount: Number(amount) }"
      >
        <ExpressionInput
          id={`${step.id}-params`}
          value={step.parameters ?? ''}
          onChange={(parameters) => onChange({ ...step, parameters: parameters.trim() ? parameters : undefined })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="{ }"
        />
      </Row>
      {ctx.ext.kind === 'card' && (
        <Row label="Record properties to send" hint="Sent as context.propertiesToSend (current CRM record).">
          <ChipsInput
            value={step.propertiesToSend ?? []}
            onChange={(list) => onChange({ ...step, propertiesToSend: list.length ? list : undefined })}
            placeholder="e.g. email"
            aria-label="Record properties to send"
          />
        </Row>
      )}
      <Row label="Store the result in" htmlFor={`${step.id}-result`}>
        <StateVarSelect
          id={`${step.id}-result`}
          value={step.resultState ?? ''}
          onChange={(resultState) => onChange({ ...step, resultState: resultState || undefined })}
          ctx={ctx}
          allowNone
          suggestedName="result"
          suggestedType="any"
        />
      </Row>
      <CallbackLists step={step} onChange={onChange} ctx={ctx} depth={depth} />
    </>
  );
}

const LOG_LEVELS: Array<{ value: LogLevel; label: string }> = [
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
  { value: 'debug', label: 'Debug' },
];

function LogForm({ step, onChange, ctx }: { step: LogAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  return (
    <>
      <Row label="Level">
        <Segmented<LogLevel>
          aria-label="Log level"
          value={step.level}
          onChange={(level) => onChange({ ...step, level })}
          options={LOG_LEVELS}
        />
      </Row>
      <Row label="Message" htmlFor={`${step.id}-msg`}>
        <TemplateInput
          id={`${step.id}-msg`}
          value={step.message}
          onChange={(message) => onChange({ ...step, message })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          placeholder="e.g. Clicked with {{ count }}"
        />
      </Row>
    </>
  );
}

function IfForm({ step, onChange, ctx, depth }: { step: IfAction; onChange: (s: ActionStep) => void; ctx: ActionContext; depth: number }) {
  return (
    <>
      <ConditionBuilder
        ext={ctx.ext}
        nodeId={ctx.nodeId}
        eventParams={ctx.eventParams}
        value={step.condition}
        onChange={(condition) => onChange({ ...step, condition })}
        label="If"
        codeLabel="Condition"
        codePlaceholder="e.g. count > 10"
        addLabel="Add a check"
        startWithCheck
      />
      <div className="ub-insp-branches">
        <div className="ub-insp-branch is-then">
          <div className="ub-insp-branch__head">Then</div>
          <ActionList
            steps={step.then}
            onChange={(then) => onChange({ ...step, then })}
            ctx={ctx}
            depth={depth + 1}
            emptyText="Nothing happens."
            label="Then actions"
          />
        </div>
        <div className="ub-insp-branch is-else">
          <div className="ub-insp-branch__head">Else</div>
          <ActionList
            steps={step.else}
            onChange={(els) => onChange({ ...step, else: els })}
            ctx={ctx}
            depth={depth + 1}
            emptyText="Nothing happens."
            label="Else actions"
          />
        </div>
      </div>
    </>
  );
}

function CustomForm({ step, onChange, ctx }: { step: CustomCodeAction; onChange: (s: ActionStep) => void; ctx: ActionContext }) {
  const setters = ctx.ext.state.map((s) => setterName(s.name));
  const [big, setBig] = useState(false);
  // The dialog edits the store value directly, so it always sees the latest step.
  const latest = useRef(step);
  latest.current = step;
  return (
    <>
      <div className="ub-insp-codefield">
        <ExpressionInput
          value={step.code}
          onChange={(code) => onChange({ ...step, code })}
          ext={ctx.ext}
          nodeId={ctx.nodeId}
          eventParams={ctx.eventParams}
          statements
          multiline
          placeholder={'// e.g.\nconst res = await hubspot.fetch(url);\nsetItems(await res.json());'}
          aria-label="Custom code"
        />
        <IconButton label="Open custom code in a large editor" size="sm" className="ub-insp-codefield__expand" onClick={() => setBig(true)}>
          <Maximize2 size={13} aria-hidden />
        </IconButton>
      </div>
      {big && (
        <CodeEditorDialog
          open
          onClose={() => setBig(false)}
          title="Custom code"
          intro={<>Runs as an async block when the event fires. Type a name for suggestions.</>}
          keys={
            <>
              Changes apply as you type · type a name for suggestions · <kbd>Esc</kbd> closes
            </>
          }
        >
          <ExpressionInput
            className="ub-pw-bigexpr"
            value={step.code}
            onChange={(code) => onChange({ ...latest.current, code })}
            ext={ctx.ext}
            nodeId={ctx.nodeId}
            eventParams={ctx.eventParams}
            statements
            multiline
            hidePreview
            aria-label="Custom code (large editor)"
          />
        </CodeEditorDialog>
      )}
      <div className="ub-insp-help">
        Runs as an async block. Available: <code>actions</code>, <code>hubspot</code>, <code>logger</code>
        {setters.length > 0 && (
          <>
            , setters{' '}
            {setters.slice(0, 4).map((s, i) => (
              <span key={s}>
                {i > 0 && ', '}
                <code>{s}</code>
              </span>
            ))}
            {setters.length > 4 && '…'}
          </>
        )}
        {ctx.eventParams.length > 0 && (
          <>
            , event params{' '}
            {ctx.eventParams.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <code>{p}</code>
              </span>
            ))}
          </>
        )}
        , plus all state and data.
      </div>
    </>
  );
}
