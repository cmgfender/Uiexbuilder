/**
 * Inspector for several selected components (multi-selection): what is selected (click one to
 * select only it), "Paste settings" onto all of them, and the settings they share — editing one
 * here changes it on every selected component in one undo step. Values that differ show
 * "Different on each"; setting them makes them the same.
 */
import { useId, useMemo } from 'react';
import { ClipboardPaste, Layers, RotateCcw, X } from 'lucide-react';
import { useActiveExtension, useEditor } from '../model/store';
import { allHaveText, canPasteSettings, commonPropDefs, sharedProp, sharedText } from '../model/settings';
import { nodeLabel } from '../model/tree';
import { isExpr, type JsonValue, type NodeId, type UINode } from '../model/types';
import { getComponent } from '../registry';
import type { PropDef } from '../registry/types';
import { Badge, Button, IconButton, useToast } from '../ui';
import { ExpressionInput, TemplateInput } from './controls';
import { LiteralEditor } from './editors';
import './inspector.css';
import './power-inspector.css';

export interface MultiInspectorProps {
  ids: NodeId[];
}

export function MultiInspector({ ids }: MultiInspectorProps) {
  const ext = useActiveExtension();
  const clip = useEditor((s) => s.settingsClipboard);
  const toast = useToast();
  const nodes = useMemo(() => ids.map((id) => ext.nodes[id]).filter((n): n is UINode => !!n), [ids, ext.nodes]);
  const defs = useMemo(() => commonPropDefs(nodes), [nodes]);
  const types = [...new Set(nodes.map((n) => n.type))];
  const typeLabel = (t: string) => getComponent(t)?.label ?? t;
  const pasteable = nodes.filter((n) => canPasteSettings(clip, n));
  const liveIds = nodes.map((n) => n.id);
  const text = allHaveText(nodes);

  return (
    <div className="ub-insp ub-pw-multi" data-multi-inspector>
      <div className="ub-insp-head">
        <div className="ub-insp-head__row">
          <span className="ub-insp-head__icon" aria-hidden>
            <Layers size={16} />
          </span>
          <div className="ub-insp-head__titles">
            <div className="ub-insp-head__title">
              <span className="ub-insp-head__label">{nodes.length} components selected</span>
            </div>
            <div className="ub-pw-multi__types">{types.length === 1 ? `All ${typeLabel(types[0])}` : types.map(typeLabel).join(', ')}</div>
          </div>
          <div className="ub-insp-head__tools">
            <IconButton size="sm" label="Clear the selection" onClick={() => useEditor.getState().select(null)}>
              <X size={14} />
            </IconButton>
          </div>
        </div>
        <ul className="ub-pw-multi__chips" aria-label="Selected components">
          {nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="ub-pw-multi__chip"
                title="Select only this one"
                onClick={() => useEditor.getState().select(n.id)}
              >
                {nodeLabel(n, typeLabel(n.type))}
              </button>
            </li>
          ))}
        </ul>
        {clip && (
          <div className="ub-pw-multi__paste">
            <Button
              size="sm"
              icon={<ClipboardPaste size={13} aria-hidden />}
              disabled={!pasteable.length}
              title={pasteable.length ? `Give them the settings copied from ${clip.label}` : `The copied settings are for a ${typeLabel(clip.type)}`}
              onClick={() => {
                const n = useEditor.getState().pasteSettings(liveIds);
                toast(n ? `Pasted the settings of ${clip.label} onto ${n} component${n === 1 ? '' : 's'}` : 'They already have these settings');
              }}
            >
              Paste settings{pasteable.length && pasteable.length < nodes.length ? ` (${pasteable.length} of ${nodes.length})` : ''}
            </Button>
            <span className="ub-pw-multi__from">from {clip.label}</span>
          </div>
        )}
      </div>
      <div className="ub-insp-body ub-scroll">
        <div className="ub-insp-tabpanel">
          <p className="ub-insp-help">
            {defs.length || text
              ? 'Settings they share. A change here applies to all of them.'
              : 'These components have no settings in common. Select components of the same kind to edit them together.'}
          </p>
          {text && <MultiTextRow nodes={nodes} />}
          {defs.map((def) => (
            <MultiPropRow key={def.name} def={def} nodes={nodes} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MultiTextRow({ nodes }: { nodes: UINode[] }) {
  const ext = useActiveExtension();
  const id = useId();
  const shared = sharedText(nodes);
  const ids = nodes.map((n) => n.id);
  return (
    <div className="ub-insp-field ub-pw-multi__row" data-prop="__text">
      <div className="ub-insp-field__label">
        <label htmlFor={id}>Text</label>
        {shared.mixed && <Badge>Different on each</Badge>}
      </div>
      <TemplateInput
        id={id}
        value={shared.mixed ? '' : shared.value}
        onChange={(t) => useEditor.getState().setTextMany(ids, t)}
        ext={ext}
        nodeId={nodes[0]?.id}
        placeholder={shared.mixed ? 'Type to give them all this text' : undefined}
      />
    </div>
  );
}

function MultiPropRow({ def, nodes }: { def: PropDef; nodes: UINode[] }) {
  const ext = useActiveExtension();
  const id = useId();
  const shared = sharedProp(nodes, def.name);
  const ids = nodes.map((n) => n.id);
  const set = (v: JsonValue | { $expr: string } | undefined) => useEditor.getState().setPropsMany(ids, { [def.name]: v });
  const value = shared.mixed ? undefined : shared.value;
  const anySet = nodes.some((n) => n.props[def.name] !== undefined);
  return (
    <div className="ub-insp-field ub-pw-multi__row" data-prop={def.name}>
      <div className="ub-insp-field__label">
        <label htmlFor={id} title={def.description}>
          {def.label}
        </label>
        {shared.mixed && <Badge>Different on each</Badge>}
        <span className="ub-insp-field__actions">
          <IconButton size="sm" label={`Reset ${def.label} on all`} disabled={!anySet} onClick={() => set(undefined)}>
            <RotateCcw size={12} />
          </IconButton>
        </span>
      </div>
      {isExpr(value) ? (
        <ExpressionInput
          id={id}
          value={value.$expr}
          onChange={(t) => set(t.trim() ? { $expr: t } : undefined)}
          ext={ext}
          nodeId={nodes[0]?.id}
          aria-label={`${def.label} expression (all selected)`}
        />
      ) : (
        <LiteralEditor
          id={id}
          def={def}
          value={value as JsonValue | undefined}
          onChange={(v) => set(v)}
          ext={ext}
          nodeId={nodes[0]?.id ?? null}
          required={false}
        />
      )}
    </div>
  );
}
