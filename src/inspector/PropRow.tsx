/**
 * One component prop in the Properties tab: label (description tooltip, required marker), the
 * literal editor for its PropType, a reset button, the `fx` toggle that switches between a
 * literal value and an expression ({ $expr }), and the Rules toggle (pick the value by thresholds,
 * e.g. a progress bar's color by percentage; stored as an expression, see rules.ts).
 */
import { useId, useRef, useState } from 'react';
import { Link2, ListFilter, RotateCcw } from 'lucide-react';
import { useEditor } from '../model/store';
import { isExpr, type Extension, type JsonValue, type UINode } from '../model/types';
import type { PropDef } from '../registry/types';
import { cx, IconButton, useToast } from '../ui';
import { ExpressionInput } from './controls';
import { describe, editorLayout, LiteralEditor } from './editors';
import { exprToLiteral, isPropRequired, jsonToJs, literalToExpr, templateValueAsExpr } from './propValue';
import { initialRules, rulesOf, rulesToExpr, supportsRules, syncRuleSubjects, type RuleSet } from './rules';
import { RulesEditor } from './RulesEditor';

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
  const setProps = useEditor((s) => s.setProps);
  const toast = useToast();
  const id = useId();
  const raw = node.props[def.name];
  const required = isPropRequired(def, node.props);
  const bindable = def.bindable !== false;
  const [fxDraft, setFxDraft] = useState(false);
  const lastExpr = useRef<string | null>(null);
  // Rules being set up that are not complete yet (e.g. nothing chosen under "Based on").
  const [rulesDraft, setRulesDraft] = useState<RuleSet | null>(null);
  // Show stored rules as the plain expression they are saved as (after clicking fx).
  const [fxView, setFxView] = useState(false);

  const storedRules = rulesOf(raw);
  const rules = rulesDraft ?? storedRules;
  const rulesMode = rules !== null && !fxView && supportsRules(def);
  const exprText = isExpr(raw) ? raw.$expr : templateValueAsExpr(raw, def.type);
  const fxMode = !rulesMode && (exprText !== null || (fxDraft && raw === undefined));
  const layout = boundState || fxMode || rulesMode ? 'block' : editorLayout(def);
  const isSet = raw !== undefined;

  const set = (v: JsonValue | { $expr: string } | undefined) => {
    // Rules on other props that follow this one (e.g. "this bar's percentage") keep following it.
    const extra = syncRuleSubjects(node, { [def.name]: v });
    if (Object.keys(extra).length > 0) setProps(node.id, { [def.name]: v, ...extra });
    else setProp(node.id, def.name, v);
  };

  const changeRules = (next: RuleSet) => {
    if (next.subject.trim() && next.cases.length > 0) {
      setRulesDraft(null);
      set({ $expr: rulesToExpr(next) });
    } else setRulesDraft(next);
  };

  const toggleRules = () => {
    setFxDraft(false);
    setFxView(false);
    lastExpr.current = null;
    if (rulesMode) {
      setRulesDraft(null);
      set(rules!.otherwise as JsonValue);
      return;
    }
    if (storedRules) return; // fxView was just cleared: show the stored rules again
    changeRules(initialRules(node, def));
  };

  const toggleFx = () => {
    if (rulesMode) {
      setRulesDraft(null);
      if (storedRules) setFxView(true);
      else setFxDraft(true);
      return;
    }
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
    setRulesDraft(null);
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
      {supportsRules(def) && (
        <button
          type="button"
          className={cx('ub-insp-fx ub-insp-rulesbtn', rulesMode && 'is-on')}
          aria-pressed={rulesMode}
          aria-label={`${rulesMode ? 'Stop using rules for' : 'Use rules for'} ${def.label}`}
          title={
            rulesMode
              ? 'Stop using rules — keep the “Otherwise” value'
              : 'Rules — change this by a value, e.g. green at 80% or more, red below 40%'
          }
          onClick={toggleRules}
        >
          <ListFilter size={12} aria-hidden />
        </button>
      )}
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
  } else if (rulesMode) {
    editor = <RulesEditor node={node} def={def} ext={ext} value={rules!} onChange={changeRules} />;
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
