/** State variables of the active extension: list, inline editor, add and delete. */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Variable } from 'lucide-react';
import { useEditor } from '../../model/store';
import type { Extension, JsonValue, StateVar } from '../../model/types';
import { Badge, Field, IconButton, NumberField, Section, Select, Switch, TextInput, cx, useToast } from '../../ui';
import { CommitInput, JsonEditor, Snippet } from '../common';
import { renameStateVar } from '../actions';
import { setterOf, uniqueDeclaredName, validateDeclaredName } from '../names';
import { STATE_TYPES, convertInitial, previewValue } from '../utils';
import { DeleteGuard } from './DeleteGuard';
import { consumeDataReveal, useDataReveal } from '../reveal';

const TYPE_LABEL = Object.fromEntries(STATE_TYPES.map((t) => [t.value, t.label])) as Record<StateVar['type'], string>;

export function StateSection({ ext }: { ext: Extension }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Problems panel → "show me": expand the item.
  const revealTarget = useDataReveal((s) => s.target);
  useEffect(() => {
    if (revealTarget) consumeDataReveal('state', ext.state.map((x) => x.id), setOpenId);
  }, [revealTarget, ext.state]);

  const add = () => {
    const name = uniqueDeclaredName(ext, 'value', { kind: 'state', id: '__new__' });
    const v = useEditor.getState().addStateVar({ name, type: 'string', initial: '' });
    setOpenId(v.id);
    setFocusId(v.id);
  };

  return (
    <Section
      title={
        <span className="ub-pn-section-title">
          State <span className="ub-pn-count">{ext.state.length}</span>
        </span>
      }
      actions={
        <IconButton label="Add state variable" size="sm" onClick={add}>
          <Plus size={14} aria-hidden />
        </IconButton>
      }
    >
      {ext.state.length === 0 ? (
        <div className="ub-pn-empty">
          <Variable size={18} aria-hidden />
          <div>
            <div className="ub-pn-strong">No state yet</div>
            <div className="ub-pn-muted">State holds values that change while the card is open — a counter, a form field or a selected tab.</div>
          </div>
          <button type="button" className="ub-pn-link" onClick={add}>
            Add a state variable
          </button>
        </div>
      ) : (
        <div className="ub-pn-items" role="list" aria-label="State variables">
          {ext.state.map((v) => (
            <StateRow
              key={v.id}
              ext={ext}
              v={v}
              open={openId === v.id}
              autoFocus={focusId === v.id}
              onToggle={() => {
                setOpenId(openId === v.id ? null : v.id);
                setFocusId(null);
              }}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function StateRow({
  ext,
  v,
  open,
  autoFocus,
  onToggle,
}: {
  ext: Extension;
  v: StateVar;
  open: boolean;
  autoFocus: boolean;
  onToggle: () => void;
}) {
  const toast = useToast();
  const initId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [open, autoFocus]);
  const update = (patch: Partial<StateVar>) => useEditor.getState().updateStateVar(v.id, patch);

  return (
    <div className={cx('ub-pn-item', open && 'ub-pn-item--open')} role="listitem" data-pn-item={v.id}>
      <button type="button" className="ub-pn-item__head" aria-expanded={open} onClick={onToggle} title={v.description || undefined}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span className="ub-pn-item__name">{v.name}</span>
        <Badge tone="select">{TYPE_LABEL[v.type] ?? v.type}</Badge>
        <span className="ub-pn-item__meta" title={JSON.stringify(v.initial)}>
          {previewValue(v.initial)}
        </span>
      </button>
      {open && (
        <div className="ub-pn-item__body">
          <Field label="Name">
            <CommitInput
              code
              inputRef={nameRef}
              value={v.name}
              aria-label="Variable name"
              validate={(name) => validateDeclaredName(ext, name, { kind: 'state', id: v.id })}
              onCommit={(name) => {
                const n = renameStateVar(v.id, name);
                if (n > 0) toast(`Renamed “${v.name}” to “${name}” and updated ${n} reference${n === 1 ? '' : 's'}`);
              }}
            />
          </Field>
          <div className="ub-pn-grid2">
            <Field label="Type">
              <Select
                aria-label="Variable type"
                value={v.type}
                options={STATE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                onChange={(type) => {
                  const t = type as StateVar['type'];
                  update({ type: t, initial: convertInitial(v.initial, t) });
                }}
              />
            </Field>
            {(v.type === 'string' || v.type === 'number' || v.type === 'boolean') && (
              <Field label="Initial value" htmlFor={initId}>
                <InitialValueEditor id={initId} v={v} onChange={(initial) => update({ initial })} />
              </Field>
            )}
          </div>
          {(v.type === 'array' || v.type === 'object' || v.type === 'any') && (
            <Field label="Initial value">
              <InitialValueEditor id={initId} v={v} onChange={(initial) => update({ initial })} />
            </Field>
          )}
          <Field label="Description" hint="Optional note for you and your team.">
            <TextInput
              value={v.description ?? ''}
              placeholder="What is this for?"
              aria-label="Variable description"
              onChange={(description) => update({ description: description || undefined })}
            />
          </Field>
          <div className="ub-pn-hint">
            Show it with <Snippet code={`{{ ${v.name} }}`} /> in text, use <Snippet code={v.name} /> in expressions, and set it with a
            “Set state” action or <Snippet code={`${setterOf(v.name)}(…)`} /> in custom code.
          </div>
          <div className="ub-pn-row ub-pn-row--end">
            <DeleteGuard ext={ext} name={v.name} noun="variable" onDelete={() => useEditor.getState().removeStateVar(v.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

function InitialValueEditor({ id, v, onChange }: { id: string; v: StateVar; onChange: (value: JsonValue) => void }) {
  switch (v.type) {
    case 'string':
      return (
        <TextInput id={id} value={typeof v.initial === 'string' ? v.initial : ''} placeholder="Empty text" onChange={onChange} />
      );
    case 'number':
      return (
        <NumberField id={id} value={typeof v.initial === 'number' ? v.initial : undefined} onChange={(n) => n !== undefined && onChange(n)} />
      );
    case 'boolean':
      return (
        <div className="ub-pn-switch-cell">
          <Switch id={id} checked={v.initial === true} onChange={onChange} label={v.initial === true ? 'true' : 'false'} />
        </div>
      );
    default:
      return (
        <JsonEditor
          value={v.initial}
          aria-label="Initial value (JSON)"
          rows={3}
          placeholder={v.type === 'array' ? '[]' : v.type === 'object' ? '{}' : 'null'}
          onChange={onChange}
        />
      );
  }
}
