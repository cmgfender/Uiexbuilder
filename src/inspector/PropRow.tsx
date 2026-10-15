/**
 * One component prop in the Properties tab: label (description tooltip, required marker), the
 * literal editor for its PropType, a reset button and the `fx` toggle that switches between a
 * literal value and an expression ({ $expr }).
 */
import { useId, useRef, useState } from 'react';
import { Link2, RotateCcw } from 'lucide-react';
import { useEditor } from '../model/store';
import { isExpr, type Extension, type JsonValue, type UINode } from '../model/types';
import type { PropDef } from '../registry/types';
import { cx, IconButton, useToast } from '../ui';
import { ExpressionInput } from './controls';
import { describe, editorLayout, LiteralEditor } from './editors';
import { exprToLiteral, isPropRequired, jsonToJs, literalToExpr, templateValueAsExpr } from './propValue';

export interface PropRowProps {
  node: UINode;
  def: PropDef;
  ext: Extension;
  /** State variable the prop is two-way bound to (value binding), if any. */
  boundState?: string | null;
  onUnbind?: () => void;
}

export function PropRow({ node, def, ext, boundState, onUnbind }: PropRowProps) {
  const setProp = useEditor((s) => s.setProp);
  const toast = useToast();
  const id = useId();
  const raw = node.props[def.name];
  const required = isPropRequired(def, node.props);
  const bindable = def.bindable !== false;
  const [fxDraft, setFxDraft] = useState(false);
  const lastExpr = useRef<string | null>(null);

  const exprText = isExpr(raw) ? raw.$expr : templateValueAsExpr(raw, def.type);
  const fxMode = exprText !== null || (fxDraft && raw === undefined);
  const layout = boundState ? 'block' : fxMode ? 'block' : editorLayout(def);
  const isSet = raw !== undefined;

  const set = (v: JsonValue | { $expr: string } | undefined) => setProp(node.id, def.name, v);

  const toggleFx = () => {
    if (!fxMode) {
      const expr = raw !== undefined ? literalToExpr(raw as JsonValue) : (lastExpr.current ?? '');
      lastExpr.current = null;
      if (expr.trim()) set({ $expr: expr });
      else setFxDraft(true);
      return;
    }
    const code = exprText ?? '';
    setFxDraft(false);
    const r = exprToLiteral(code, def.type);
    if (r.ok) {
      set(r.value);
    } else {
      lastExpr.current = code;
      set(undefined);
      toast(`“${def.label}” can’t show this expression as a fixed value — switch fx back on to restore it.`);
    }
  };

  const reset = () => {
    setFxDraft(false);
    lastExpr.current = null;
    set(undefined);
  };

  const label = (
    <label htmlFor={id} title={describe(def)} className={cx(def.description && 'has-help')}>
      {def.label}
      {def.deprecated && <span className="ub-insp-deprecated">deprecated</span>}
      {required && (
        <span className="ub-insp-req" aria-label="required" title={def.required ? 'Required' : 'Required with the current settings'}>
          *
        </span>
      )}
    </label>
  );

  const tools = boundState ? null : (
    <span className="ub-insp-prop__tools">
      {bindable && (
        <button
          type="button"
          className={cx('ub-insp-fx', fxMode && 'is-on')}
          aria-pressed={fxMode}
          aria-label={`${fxMode ? 'Use a fixed value for' : 'Use an expression for'} ${def.label}`}
          title={fxMode ? 'Switch to a fixed value' : 'Use an expression (fx) — compute the value from state, data or context'}
          onClick={toggleFx}
        >
          fx
        </button>
      )}
      <IconButton
        size="sm"
        label={`Reset ${def.label} to default`}
        className={cx('ub-insp-reset', !isSet && 'is-hidden')}
        disabled={!isSet}
        onClick={reset}
      >
        <RotateCcw size={12} />
      </IconButton>
    </span>
  );

  let editor;
  if (boundState) {
    editor = (
      <div className="ub-insp-bound">
        <Link2 size={13} aria-hidden />
        <span>
          Bound to <code>{boundState}</code>
        </span>
        {onUnbind && (
          <button type="button" className="ub-insp-linkbtn" onClick={onUnbind}>
            Unbind
          </button>
        )}
      </div>
    );
  } else if (fxMode) {
    editor = (
      <ExpressionInput
        id={id}
        value={exprText ?? ''}
        onChange={(text) => {
          if (!text.trim()) {
            setFxDraft(true);
            set(undefined);
          } else set({ $expr: text });
        }}
        ext={ext}
        nodeId={node.id}
        placeholder={def.defaultValue !== undefined ? jsonToJs(def.defaultValue) : 'e.g. count > 0'}
        aria-label={`${def.label} expression`}
      />
    );
  } else {
    editor = (
      <LiteralEditor
        id={id}
        def={def}
        value={raw as JsonValue | undefined}
        onChange={(v) => set(v)}
        ext={ext}
        nodeId={node.id}
        required={required}
      />
    );
  }

  return (
    // Same DOM order in both layouts (CSS grid places the parts) so toggling fx keeps focus.
    <div className={cx('ub-insp-prop', `ub-insp-prop--${layout}`, isSet && 'is-set')} data-prop={def.name}>
      <div className="ub-insp-prop__label">{label}</div>
      <div className="ub-insp-prop__editor">{editor}</div>
      {tools}
    </div>
  );
}
