/**
 * Properties tab: text content, props grouped by PropDef.group, value binding, overlay slots,
 * children and custom (unmodelled) props.
 */
import { useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, Link2, MousePointerClick, Plus, Trash2 } from 'lucide-react';
import { toIdentifier } from '../model/ids';
import { canAccept } from '../model/rules';
import { useEditor } from '../model/store';
import { nodeLabel } from '../model/tree';
import { isExpr, type Extension, type JsonValue, type PropValue, type StateVarType, type UINode } from '../model/types';
import { getComponent, listComponents } from '../registry';
import type { ComponentDef, PropDef, PropGroup } from '../registry/types';
import { Badge, Button, cx, IconButton, Segmented, Select, TextInput } from '../ui';
import { ComponentPicker } from './ComponentPicker';
import { ExpressionInput, TemplateInput } from './controls';
import { PropRow } from './PropRow';
import { isPropVisible } from './propValue';
import { InspectorSection } from './Section';

export const GROUP_ORDER: PropGroup[] = ['Content', 'Appearance', 'Layout', 'Behavior', 'Validation', 'Data', 'Advanced'];

export interface PropertiesTabProps {
  node: UINode;
  def: ComponentDef;
  ext: Extension;
}

export function PropertiesTab({ node, def, ext }: PropertiesTabProps) {
  const groups = useMemo(() => {
    // Deprecated props only appear while set, so they can be removed.
    const visible = def.props.filter((p) => isPropVisible(p, node.props) && (!p.deprecated || node.props[p.name] !== undefined));
    return GROUP_ORDER.map((g) => ({ group: g, props: visible.filter((p) => (p.group ?? 'Content') === g) })).filter(
      (g) => g.props.length > 0,
    );
  }, [def, node.props]);
  const content = groups.find((g) => g.group === 'Content');
  const rest = groups.filter((g) => g.group !== 'Content');
  const hasText = def.children.mode === 'text';

  return (
    <div className="ub-insp-tabpanel">
      {(hasText || content) && (
        <InspectorSection id="group:Content" title="Content" meta={<SetCount node={node} props={content?.props ?? []} />}>
          {hasText && <TextContent node={node} ext={ext} />}
          {content?.props.map((p) => (
            <BoundPropRow key={`${node.id}:${p.name}`} node={node} def={def} prop={p} ext={ext} />
          ))}
        </InspectorSection>
      )}
      {def.valueBinding && <BindingSection node={node} def={def} ext={ext} />}
      {def.slots?.map((slot) => (
        <SlotSection key={slot.name} node={node} slotName={slot.name} def={def} ext={ext} />
      ))}
      {def.children.mode === 'nodes' && <ChildrenSection node={node} def={def} ext={ext} />}
      {rest.map((g) => (
        <InspectorSection
          key={g.group}
          id={`group:${g.group}`}
          title={g.group}
          defaultOpen={g.group !== 'Advanced'}
          meta={<SetCount node={node} props={g.props} />}
        >
          {g.props.map((p) => (
            <BoundPropRow key={`${node.id}:${p.name}`} node={node} def={def} prop={p} ext={ext} />
          ))}
        </InspectorSection>
      ))}
      <CustomPropsSection node={node} def={def} ext={ext} />
      {groups.length === 0 && !hasText && !def.valueBinding && !def.slots?.length && def.children.mode !== 'nodes' && (
        <div className="ub-insp-note">This component has no properties.</div>
      )}
    </div>
  );
}

function SetCount({ node, props }: { node: UINode; props: PropDef[] }) {
  const n = props.filter((p) => node.props[p.name] !== undefined).length;
  return n ? <span className="ub-insp-setcount">{n} set</span> : null;
}

function BoundPropRow({ node, def, prop, ext }: { node: UINode; def: ComponentDef; prop: PropDef; ext: Extension }) {
  const bound = def.valueBinding?.prop === prop.name ? (node.binding?.state ?? null) : null;
  return (
    <PropRow
      node={node}
      def={prop}
      ext={ext}
      boundState={bound}
      onUnbind={bound ? () => useEditor.getState().updateNode(node.id, { binding: undefined }) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Text content
// ---------------------------------------------------------------------------

function TextContent({ node, ext }: { node: UINode; ext: Extension }) {
  const setText = useEditor((s) => s.setText);
  const text = node.text ?? '';
  // Decide once per node so the field never swaps element (and loses focus) while typing.
  const [multiline] = useState(() => text.length > 48 || text.includes('\n'));
  return (
    <div className="ub-insp-prop ub-insp-prop--block" data-prop="__text">
      <div className="ub-insp-prop__label">
        <label htmlFor={`text-${node.id}`} title="The text shown by this component. Type {{ to insert a variable.">
          Text
        </label>
      </div>
      <div className="ub-insp-prop__editor">
        <TemplateInput
          id={`text-${node.id}`}
          value={text}
          onChange={(t) => setText(node.id, t)}
          ext={ext}
          nodeId={node.id}
          multiline={multiline}
          placeholder="Type text, or {{ variable }}"
          aria-label="Text content"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value binding
// ---------------------------------------------------------------------------

export function compatibleStateType(a: StateVarType, b: StateVarType): boolean {
  return a === b || a === 'any' || b === 'any';
}

/** Suggested state variable name for binding a node: from its `name` / `label` prop or layer name. */
export function bindingVariableName(node: UINode, def: ComponentDef): string {
  const candidates = [node.props.name, node.props.label, node.name, node.props.title];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() && !c.includes('{{')) return toIdentifier(c, 'value');
  }
  return toIdentifier(def.valueBinding?.prop === 'checked' ? `${def.label} checked` : `${def.label} value`, 'value');
}

/** Creates a state variable shaped by the component's valueBinding and binds the node to it. */
export function createBoundVariable(node: UINode, def: ComponentDef): string | null {
  const vb = def.valueBinding;
  if (!vb) return null;
  const st = useEditor.getState();
  const v = st.addStateVar({
    name: bindingVariableName(node, def),
    type: vb.stateType,
    initial: JSON.parse(JSON.stringify(vb.initial)) as JsonValue,
    description: `Bound to ${nodeLabel(node, def.label)}`,
  });
  st.updateNode(node.id, { binding: { state: v.name } });
  return v.name;
}

function BindingSection({ node, def, ext }: { node: UINode; def: ComponentDef; ext: Extension }) {
  const vb = def.valueBinding!;
  const updateNode = useEditor((s) => s.updateNode);
  const current = node.binding?.state ?? '';
  const vars = ext.state.filter((s) => compatibleStateType(s.type, vb.stateType) || s.name === current);
  const missing = current && !ext.state.some((s) => s.name === current);
  const propLabel = def.props.find((p) => p.name === vb.prop)?.label ?? vb.prop;
  return (
    <InspectorSection
      id="binding"
      title={
        <>
          <Link2 size={13} aria-hidden /> Value binding
        </>
      }
      meta={current ? <Badge tone="select">{current}</Badge> : null}
    >
      <div className="ub-insp-help">
        Keeps <strong>{propLabel}</strong> in sync with a state variable: when the user changes it the variable updates, and changing the
        variable updates the component.
      </div>
      <div className="ub-insp-field">
        <div className="ub-insp-field__label">
          <label htmlFor={`bind-${node.id}`}>Bind value to state</label>
        </div>
        <div className="ub-insp-inline">
          <Select
            id={`bind-${node.id}`}
            value={current}
            placeholder="Not bound"
            onChange={(v) => updateNode(node.id, { binding: v ? { state: v } : undefined })}
            options={[
              ...vars.map((s) => ({ value: s.name, label: `${s.name} (${s.type})` })),
              ...(missing ? [{ value: current, label: `${current} (missing)` }] : []),
            ]}
          />
          {current ? (
            <Button size="sm" variant="ghost" onClick={() => updateNode(node.id, { binding: undefined })}>
              Unbind
            </Button>
          ) : null}
        </div>
        {missing && <div className="ub-field__error">State variable “{current}” no longer exists.</div>}
      </div>
      {!current && (
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => createBoundVariable(node, def)}
          title={`Create a ${vb.stateType} state variable and bind it`}
        >
          New variable
        </Button>
      )}
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------
// Slots (overlays)
// ---------------------------------------------------------------------------

const ADD_LABELS: Record<string, string> = { Modal: 'Add modal', Panel: 'Add panel', Tooltip: 'Add tooltip' };

function SlotSection({ node, def, slotName, ext }: { node: UINode; def: ComponentDef; slotName: string; ext: Extension }) {
  const slot = def.slots!.find((s) => s.name === slotName)!;
  const ids = node.slots?.[slot.name] ?? [];
  const full = slot.max !== undefined && ids.length >= slot.max;
  const addable = full ? [] : slot.accepts.filter((t) => canAccept(ext, node.id, t, slot.name).ok);
  const st = useEditor.getState;
  return (
    <InspectorSection
      id={`slot:${slot.name}`}
      title={slot.label}
      meta={ids.length ? <span className="ub-insp-setcount">{ids.length}</span> : null}
    >
      {slot.description && <div className="ub-insp-help">{slot.description}</div>}
      {ids.map((cid) => {
        const child = ext.nodes[cid];
        if (!child) return null;
        const cdef = getComponent(child.type);
        const Icon = cdef?.icon ?? MousePointerClick;
        return (
          <div key={cid} className="ub-insp-noderow">
            <Icon size={14} aria-hidden />
            <span className="ub-insp-noderow__label" title={nodeLabel(child, cdef?.label)}>
              {nodeLabel(child, cdef?.label)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => st().select(cid)}>
              Select
            </Button>
            <IconButton size="sm" label={`Remove ${cdef?.label ?? child.type}`} onClick={() => st().removeNode(cid)}>
              <Trash2 size={13} />
            </IconButton>
          </div>
        );
      })}
      {addable.length > 0 && (
        <div className="ub-insp-row-actions">
          {addable.map((t) => (
            <Button
              key={t}
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => st().insertNode(t, { parentId: node.id, slot: slot.name, index: 0 })}
            >
              {ADD_LABELS[t] ?? `Add ${getComponent(t)?.label ?? t}`}
            </Button>
          ))}
        </div>
      )}
      {ids.length === 0 && addable.length === 0 && <div className="ub-insp-muted">Nothing can be attached here in this extension.</div>}
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

/** Component types that can be added as children of a node (accepted types or all palette types). */
export function addableChildTypes(ext: Extension, node: UINode, def: ComponentDef): string[] {
  const pool =
    def.children.accepts ??
    listComponents()
      .filter((c) => !c.hiddenFromPalette && !c.deprecated)
      .map((c) => c.type);
  return pool.filter((t) => canAccept(ext, node.id, t).ok);
}

function ChildrenSection({ node, def, ext }: { node: UINode; def: ComponentDef; ext: Extension }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const types = useMemo(() => addableChildTypes(ext, node, def), [ext, node, def]);
  const st = useEditor.getState;
  const count = node.children.length;
  return (
    <InspectorSection id="children" title="Children" meta={<span className="ub-insp-setcount">{count}</span>}>
      {count === 0 ? (
        <div className="ub-insp-muted">{def.children.placeholder ?? 'Empty — add components here or drag them onto the canvas.'}</div>
      ) : (
        <div className="ub-insp-children">
          {node.children.map((cid) => {
            const child = ext.nodes[cid];
            if (!child) return null;
            const cdef = getComponent(child.type);
            const Icon = cdef?.icon ?? MousePointerClick;
            return (
              <button key={cid} type="button" className="ub-insp-noderow is-button" onClick={() => st().select(cid)} title="Select">
                <Icon size={14} aria-hidden />
                <span className="ub-insp-noderow__label">{nodeLabel(child, cdef?.label)}</span>
              </button>
            );
          })}
        </div>
      )}
      {def.children.required && count === 0 && <div className="ub-field__error">{def.label} needs at least one child.</div>}
      <div className="ub-insp-row-actions">
        <button
          ref={btnRef}
          type="button"
          className="ub-btn ub-btn--sm"
          disabled={types.length === 0}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={types.length ? 'Add a component at the end' : 'No component can be added here'}
        >
          <ArrowDownToLine size={13} aria-hidden /> Add child
        </button>
      </div>
      <ComponentPicker
        anchor={btnRef.current}
        open={open}
        types={types}
        title="Add child component"
        onClose={(refocus) => {
          setOpen(false);
          if (refocus) btnRef.current?.focus();
        }}
        onPick={(t) => {
          setOpen(false);
          const n = useEditor.getState();
          const live = n.project.extensions.find((e) => e.id === n.activeExtensionId)?.nodes[node.id];
          n.insertNode(t, { parentId: node.id, index: live?.children.length ?? node.children.length });
        }}
      />
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------
// Custom props (power users)
// ---------------------------------------------------------------------------

const PROP_NAME_RE = /^[A-Za-z_$][\w$-]*$/;

function CustomPropsSection({ node, def, ext }: { node: UINode; def: ComponentDef; ext: Extension }) {
  const known = useMemo(() => new Set(def.props.map((p) => p.name)), [def]);
  const custom = Object.keys(node.props).filter((k) => !known.has(k));
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<'json' | 'expr'>('json');
  const [val, setVal] = useState('');
  const setProp = useEditor((s) => s.setProp);

  const keyError = !key
    ? null
    : !PROP_NAME_RE.test(key)
      ? 'Use a valid prop name (letters, digits, _ or -).'
      : known.has(key)
        ? 'This prop is listed above — edit it there.'
        : node.props[key] !== undefined
          ? 'Already set.'
          : ['children', 'key', 'ref'].includes(key)
            ? 'Reserved name.'
            : null;
  let parsed: { ok: true; value: PropValue } | { ok: false; error: string } = { ok: false, error: '' };
  if (mode === 'expr') parsed = val.trim() ? { ok: true, value: { $expr: val } } : { ok: false, error: '' };
  else if (val.trim()) {
    try {
      parsed = { ok: true, value: JSON.parse(val) as JsonValue };
    } catch {
      parsed = { ok: false, error: 'Invalid JSON — wrap text in quotes, e.g. "hello".' };
    }
  }

  return (
    <InspectorSection
      id="custom-props"
      title="Custom props"
      defaultOpen={custom.length > 0}
      meta={custom.length ? <span className="ub-insp-setcount">{custom.length}</span> : null}
    >
      <div className="ub-insp-help">Props the builder doesn’t model yet. They are passed to the component as-is.</div>
      {custom.map((k) => (
        <CustomPropRow key={`${node.id}:${k}`} node={node} name={k} ext={ext} />
      ))}
      <div className="ub-insp-customadd">
        <TextInput code value={key} onChange={setKey} placeholder="propName" aria-label="Custom prop name" invalid={!!keyError} />
        <Segmented<'json' | 'expr'>
          aria-label="Value kind"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'json', label: 'JSON', title: 'A fixed JSON value' },
            { value: 'expr', label: 'fx', title: 'An expression' },
          ]}
        />
      </div>
      {mode === 'expr' ? (
        <ExpressionInput
          value={val}
          onChange={setVal}
          ext={ext}
          nodeId={node.id}
          placeholder="e.g. count > 0"
          aria-label="Custom prop expression"
        />
      ) : (
        <TextInput
          code
          value={val}
          onChange={setVal}
          placeholder='e.g. "text", 42, true, { "a": 1 }'
          aria-label="Custom prop JSON value"
          invalid={!parsed.ok && !!parsed.error}
        />
      )}
      {keyError ? (
        <div className="ub-field__error">{keyError}</div>
      ) : !parsed.ok && parsed.error ? (
        <div className="ub-field__error">{parsed.error}</div>
      ) : null}
      <div className="ub-insp-row-actions">
        <Button
          size="sm"
          icon={<Plus size={13} />}
          disabled={!key || !!keyError || !parsed.ok}
          onClick={() => {
            if (!parsed.ok) return;
            setProp(node.id, key, parsed.value);
            setKey('');
            setVal('');
          }}
        >
          Add prop
        </Button>
      </div>
    </InspectorSection>
  );
}

function CustomPropRow({ node, name, ext }: { node: UINode; name: string; ext: Extension }) {
  const setProp = useEditor((s) => s.setProp);
  const raw = node.props[name];
  const expr = isExpr(raw);
  const [draft, setDraft] = useState(() => (expr ? '' : JSON.stringify(raw)));
  const [error, setError] = useState<string | null>(null);
  // Show the user's draft unless the stored value changed elsewhere (undo, fx toggle).
  const sameAsRaw = (() => {
    try {
      return JSON.stringify(JSON.parse(draft)) === JSON.stringify(raw);
    } catch {
      return false;
    }
  })();
  const shown = expr || error !== null || sameAsRaw ? draft : JSON.stringify(raw);
  return (
    <div className="ub-insp-prop ub-insp-prop--block is-set" data-prop={name}>
      <div className="ub-insp-prop__label">
        <code className="ub-insp-customkey">{name}</code>
      </div>
      <span className="ub-insp-prop__tools">
        <button
          type="button"
          className={cx('ub-insp-fx', expr && 'is-on')}
          aria-pressed={expr}
          aria-label={`${expr ? 'Use JSON for' : 'Use an expression for'} ${name}`}
          title={expr ? 'Switch to a JSON value' : 'Use an expression (fx)'}
          onClick={() => {
            if (expr) {
              try {
                const v = JSON.parse((raw as { $expr: string }).$expr) as JsonValue;
                setProp(node.id, name, v);
                setDraft(JSON.stringify(v));
              } catch {
                setProp(node.id, name, null);
                setDraft('null');
              }
            } else setProp(node.id, name, { $expr: JSON.stringify(raw) });
            setError(null);
          }}
        >
          fx
        </button>
        <IconButton size="sm" label={`Remove ${name}`} onClick={() => setProp(node.id, name, undefined)}>
          <Trash2 size={12} />
        </IconButton>
      </span>
      <div className="ub-insp-prop__editor">
        {expr ? (
          <ExpressionInput
            value={(raw as { $expr: string }).$expr}
            onChange={(t) => setProp(node.id, name, { $expr: t })}
            ext={ext}
            nodeId={node.id}
            aria-label={`${name} expression`}
          />
        ) : (
          <>
            <TextInput
              code
              value={shown}
              invalid={!!error}
              aria-label={`${name} JSON value`}
              onChange={(t) => {
                setDraft(t);
                try {
                  const v = JSON.parse(t) as JsonValue;
                  setError(null);
                  setProp(node.id, name, v);
                } catch {
                  setError('Invalid JSON');
                }
              }}
            />
            {error && <div className="ub-field__error">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
