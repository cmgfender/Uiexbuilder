/**
 * Properties tab: text content, props grouped by PropDef.group, value binding, overlay slots,
 * children and custom (unmodelled) props.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronRight,
  Database,
  Eye,
  Link2,
  ListFilter,
  MousePointerClick,
  PanelTop,
  Plus,
  Repeat,
  Search,
  ShieldAlert,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { newId, toIdentifier } from '../model/ids';
import { canAccept } from '../model/rules';
import { useEditor } from '../model/store';
import { hasTemplate, singleExpression } from '../model/template';
import { nodeLabel } from '../model/tree';
import {
  isExpr,
  type ActionStep,
  type Extension,
  type JsonValue,
  type PropValue,
  type StateVarType,
  type UINode,
} from '../model/types';
import { getComponent, listComponents } from '../registry';
import type { ComponentDef, ComponentTip, EventDef, PropDef, PropGroup, SlotDef, TipAction } from '../registry/types';
import { Badge, Button, cx, IconButton, Segmented, Select, Switch, TextInput } from '../ui';
import { ComponentPicker } from './ComponentPicker';
import { ExpressionInput, TemplateInput } from './controls';
import { createdDefaultText } from './editors';
import { asOneUndoStep } from './history';
import { nodeHints } from './nodeHints';
import { confirmModalTemplate } from './overlayPresets';
import { useInspectorPrefs } from './prefs';
import { PropRow } from './PropRow';
import { isPropVisible } from './propValue';
import { propSelector, revealInInspector, usePropRequests } from './requests';
import { initialRules, parseRules, rulesToExpr, type RuleSet } from './rules';
import { RulesEditor } from './RulesEditor';
import { InspectorSection, useSectionStore } from './Section';
import { elsewhereHint, FILTER_MIN_SETTINGS, matchesWords, propMatches, queryWords } from './settingsFilter';
import { activeTipsFor, tipsFor } from './tips';

export const GROUP_ORDER: PropGroup[] = ['Content', 'Appearance', 'Layout', 'Behavior', 'Validation', 'Data', 'Advanced'];

/** The groups in the order the component wants them (most-used first), Content always first. */
export function componentGroupOrder(def: ComponentDef): PropGroup[] {
  const first: PropGroup[] = (def.groupOrder ?? []).filter((g) => g !== 'Content' && g !== 'Advanced');
  return ['Content', ...first, ...GROUP_ORDER.filter((g) => g !== 'Content' && !first.includes(g))];
}

/** Containers whose children are what the person came to edit: their list comes first. */
function childrenFirst(def: ComponentDef): boolean {
  return def.children.mode === 'nodes' && def.category === 'Layout' && !def.props.some((p) => (p.group ?? 'Content') === 'Content');
}

export interface PropertiesTabProps {
  node: UINode;
  def: ComponentDef;
  ext: Extension;
}

export function PropertiesTab({ node, def, ext }: PropertiesTabProps) {
  const [query, setQuery] = useState('');
  const words = useMemo(() => queryWords(query), [query]);
  const filtering = words.length > 0;
  const visible = useMemo(
    // Deprecated props only appear while set, so they can be removed.
    () => def.props.filter((p) => isPropVisible(p, node.props) && (!p.deprecated || node.props[p.name] !== undefined)),
    [def, node.props],
  );
  const groups = useMemo(() => {
    const shown = filtering ? visible.filter((p) => propMatches(p, words)) : visible;
    return componentGroupOrder(def)
      .map((g) => ({ group: g, props: shown.filter((p) => (p.group ?? 'Content') === g) }))
      .filter((g) => g.props.length > 0);
  }, [def, visible, filtering, words]);
  const content = groups.find((g) => g.group === 'Content');
  const advanced = groups.find((g) => g.group === 'Advanced');
  const rest = groups.filter((g) => g.group !== 'Content' && g.group !== 'Advanced');
  const hasText = def.children.mode === 'text';
  const isContainer = def.children.mode === 'nodes';
  const inputBinding = !!def.valueBinding && def.category === 'Forms & inputs';

  const showFilter = settingCount(def, visible) >= FILTER_MIN_SETTINGS || query !== '';

  // What matches while filtering (sections without a match are left out).
  const textShown = hasText && (!filtering || matchesWords(words, ['Text', 'content', 'words', 'label', node.text]));
  const bindingShown =
    !!def.valueBinding && (!filtering || matchesWords(words, ['Value binding', 'bind link variable state value', def.valueBinding.prop]));
  const slotShown = (slot: SlotDef) =>
    !filtering || matchesWords(words, [slot.label, slot.name, slot.description, 'modal panel tooltip pop-up popup confirmation overlay']);
  const childrenShown =
    isContainer &&
    (!filtering ||
      matchesWords(words, [
        'inside children child components add',
        ...node.children.map((id) => (ext.nodes[id] ? nodeLabel(ext.nodes[id], getComponent(ext.nodes[id].type)?.label) : '')),
      ]));
  const customShown = !filtering || matchesWords(words, ['custom props', ...Object.keys(node.props)]);
  const tips = filtering ? [] : tipsFor(def, node);
  const activeTips = filtering ? [] : activeTipsFor(def, node);

  const contentSection = (textShown || content) && (
    <InspectorSection
      id="group:Content"
      title="Content"
      meta={<SetCount node={node} props={content?.props ?? []} />}
      forceOpen={filtering}
    >
      {textShown && <TextContent node={node} ext={ext} />}
      {content?.props.map((p) => (
        <BoundPropRow key={`${node.id}:${p.name}`} node={node} def={def} prop={p} ext={ext} />
      ))}
    </InspectorSection>
  );
  const childrenSection = childrenShown && <ChildrenSection node={node} def={def} ext={ext} forceOpen={filtering} />;
  const tipsSection = (tips.length > 0 || activeTips.length > 0) && <TipsSection node={node} def={def} tips={tips} active={activeTips} />;
  const groupSection = (g: { group: PropGroup; props: PropDef[] }) => (
    <InspectorSection
      key={g.group}
      id={`group:${g.group}`}
      title={g.group}
      defaultOpen={g.group !== 'Advanced'}
      forceOpen={filtering}
      meta={<SetCount node={node} props={g.props} />}
    >
      {g.props.map((p) => (
        <BoundPropRow key={`${node.id}:${p.name}`} node={node} def={def} prop={p} ext={ext} />
      ))}
    </InspectorSection>
  );
  const nothing =
    filtering &&
    !textShown &&
    groups.length === 0 &&
    !bindingShown &&
    !childrenShown &&
    !(def.slots ?? []).some(slotShown) &&
    !(customShown && Object.keys(node.props).some((k) => !def.props.some((p) => p.name === k)));

  return (
    <div className="ub-insp-tabpanel">
      {showFilter && <SettingsFilter value={query} onChange={setQuery} />}
      {nothing ? (
        <NoMatch query={query} onClear={() => setQuery('')} />
      ) : (
        <>
          {childrenFirst(def) && childrenSection}
          {contentSection}
          {inputBinding && bindingShown && <BindingSection node={node} def={def} ext={ext} forceOpen={filtering} />}
          {!childrenFirst(def) && childrenSection}
          {/* The tips follow the main settings: the Content section, else the first group. */}
          {!contentSection && rest.slice(0, 1).map(groupSection)}
          {tipsSection}
          {(contentSection ? rest : rest.slice(1)).map(groupSection)}
          {def.slots?.filter(slotShown).map((slot) => (
            <SlotSection key={slot.name} node={node} slotName={slot.name} def={def} ext={ext} forceOpen={filtering} />
          ))}
          {!inputBinding && bindingShown && <BindingSection node={node} def={def} ext={ext} forceOpen={filtering} />}
          {advanced && groupSection(advanced)}
          {customShown && <CustomPropsSection node={node} def={def} ext={ext} forceOpen={filtering} />}
          {!filtering && groups.length === 0 && !hasText && !def.valueBinding && !def.slots?.length && !isContainer && (
            <div className="ub-insp-note">This component has no properties.</div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter settings
// ---------------------------------------------------------------------------

function settingCount(def: ComponentDef, visible: PropDef[]): number {
  return visible.length + (def.children.mode === 'text' ? 1 : 0) + (def.valueBinding ? 1 : 0) + (def.slots?.length ?? 0);
}

/** Whether the Properties tab shows "Filter settings" for this node (enough settings to need it). */
export function hasSettingsFilter(def: ComponentDef, node: UINode): boolean {
  const visible = def.props.filter((p) => isPropVisible(p, node.props) && (!p.deprecated || node.props[p.name] !== undefined));
  return settingCount(def, visible) >= FILTER_MIN_SETTINGS;
}

/** Focuses the Properties tab's filter box (the `/` shortcut). Returns false when there is none. */
export function focusSettingsFilter(): boolean {
  const input = document.querySelector<HTMLInputElement>('.ub-insp [data-insp-filter]');
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

function SettingsFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="ub-insp-filter" role="search">
      <Search size={13} aria-hidden className="ub-insp-filter__icon" />
      <input
        ref={ref}
        type="text"
        className="ub-insp-filter__input"
        data-insp-filter=""
        value={value}
        placeholder="Filter settings"
        aria-label="Filter settings"
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      {value ? (
        <IconButton
          size="sm"
          label="Clear filter"
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <X size={12} />
        </IconButton>
      ) : (
        <kbd className="ub-insp-filter__key" title="Press / to filter settings" aria-hidden>
          /
        </kbd>
      )}
    </div>
  );
}

function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  const hint = elsewhereHint(query);
  const setTab = useEditor((s) => s.setRightPanel);
  return (
    <div className="ub-insp-nomatch" role="status">
      <div>No settings match “{query.trim()}”.</div>
      {hint && (
        <div className="ub-insp-help">
          {hint.label}{' '}
          <button type="button" className="ub-insp-linkbtn" onClick={() => setTab(hint.tab)}>
            Open {hint.tab === 'events' ? 'Events' : 'Advanced'}
          </button>
        </div>
      )}
      <div className="ub-insp-row-actions is-center">
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear filter
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "You can also…" tips
// ---------------------------------------------------------------------------

const TIP_ICONS: Record<TipAction['kind'], typeof ListFilter> = {
  rules: ListFilter,
  data: Database,
  event: Zap,
  condition: Eye,
  repeat: Repeat,
  binding: Link2,
  overlay: PanelTop,
};

/** Runs a tip: opens the place where that power lives and switches it on where it can. */
export function runTip(node: UINode, def: ComponentDef, action: TipAction): void {
  const editor = useEditor.getState();
  switch (action.kind) {
    case 'rules':
    case 'data': {
      editor.setRightPanel('properties');
      if (action.prop !== '__text') {
        const prop = def.props.find((p) => p.name === action.prop);
        if (prop) useSectionStore.getState().setOpen(`group:${prop.group ?? 'Content'}`, true);
      } else useSectionStore.getState().setOpen('group:Content', true);
      usePropRequests.getState().request({ nodeId: node.id, prop: action.prop, action: action.kind });
      return;
    }
    case 'event':
      editor.setRightPanel('events');
      revealInInspector(`[data-event="${action.event.replace(/["\\]/g, '\\$&')}"]`);
      return;
    case 'condition':
    case 'repeat':
      editor.setRightPanel('advanced');
      useSectionStore.getState().setOpen(action.kind === 'condition' ? 'adv:condition' : 'adv:repeat', true);
      revealInInspector(`[data-adv="${action.kind}"]`);
      return;
    case 'binding':
      editor.setRightPanel('properties');
      useSectionStore.getState().setOpen('binding', true);
      revealInInspector('[data-section="binding"]', 'select');
      return;
    case 'overlay':
      editor.setRightPanel('properties');
      useSectionStore.getState().setOpen('slot:overlay', true);
      revealInInspector('[data-section="slot:overlay"]', '.ub-insp-row-actions button');
      return;
    default:
      return;
  }
}

function TipsSection({ node, def, tips, active }: { node: UINode; def: ComponentDef; tips: ComponentTip[]; active: ComponentTip[] }) {
  return (
    <InspectorSection id="tips" title="You can also" className="ub-insp-tips">
      <ul className="ub-insp-tips__list">
        {active.map((tip) => {
          const Icon = TIP_ICONS[tip.action.kind];
          return (
            <li key={`on:${JSON.stringify(tip.action)}`}>
              <button type="button" className="ub-insp-tip is-on" onClick={() => runTip(node, def, tip.action)}>
                <Icon size={13} aria-hidden />
                <span>
                  {tip.text} <span className="ub-insp-tip__on">On · edit</span>
                </span>
                <ChevronRight size={13} aria-hidden className="ub-insp-tip__go" />
              </button>
            </li>
          );
        })}
        {tips.map((tip) => {
          const Icon = TIP_ICONS[tip.action.kind];
          return (
            <li key={JSON.stringify(tip.action)}>
              <button type="button" className="ub-insp-tip" onClick={() => runTip(node, def, tip.action)}>
                <Icon size={13} aria-hidden />
                <span>{tip.text}</span>
                <ChevronRight size={13} aria-hidden className="ub-insp-tip__go" />
              </button>
            </li>
          );
        })}
      </ul>
    </InspectorSection>
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
      onUnbind={bound ? () => setBinding(node, def, undefined) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Text content
// ---------------------------------------------------------------------------

/** Text content shown with rules is stored as one `{{ }}` expression (see rules.ts). */
const TEXT_DEF: PropDef = { name: '__text', label: 'Text', type: { kind: 'string' } };

function textRules(text: string): RuleSet | null {
  const code = singleExpression(text);
  return code === null ? null : parseRules(code);
}

function TextContent({ node, ext }: { node: UINode; ext: Extension }) {
  const setText = useEditor((s) => s.setText);
  const showHelp = useInspectorPrefs((s) => s.showHelp);
  const text = node.text ?? '';
  // Decide once per node so the field never swaps element (and loses focus) while typing.
  const [multiline] = useState(() => text.length > 48 || text.includes('\n'));
  const createdText = useMemo(() => createdDefaultText(node.type), [node.type]);
  const [draft, setDraft] = useState<RuleSet | null>(null);
  const rules = draft ?? textRules(text);
  const helpId = `text-help-${node.id}`;

  const changeRules = (next: RuleSet) => {
    if (next.subject.trim() && next.cases.length > 0) {
      setDraft(null);
      setText(node.id, `{{ ${rulesToExpr(next)} }}`);
    } else setDraft(next);
  };
  const toggleRules = () => {
    if (rules) {
      setDraft(null);
      setText(node.id, rules.otherwise === null ? '' : String(rules.otherwise));
      return;
    }
    const start = initialRules(node, TEXT_DEF);
    const current = hasTemplate(text) ? '' : text;
    changeRules({ ...start, cases: start.cases.map((c) => ({ ...c, then: current })), otherwise: current });
  };

  // "You can also…" tips: switch on rules, or open the variable picker.
  const latest = useRef({ rules, toggleRules });
  latest.current = { rules, toggleRules };
  useEffect(() => {
    const check = () => {
      const req = usePropRequests.getState().take(node.id, '__text');
      if (!req) return;
      if (req.action === 'rules') {
        if (!latest.current.rules) latest.current.toggleRules();
        revealInInspector(propSelector('__text'), 'select, input');
      } else {
        if (latest.current.rules) latest.current.toggleRules();
        revealInInspector(propSelector('__text'), '.ub-insp-varbtn');
        setTimeout(() => document.querySelector<HTMLElement>(`.ub-insp ${propSelector('__text')} .ub-insp-varbtn`)?.click(), 80);
      }
    };
    check();
    return usePropRequests.subscribe(check);
  }, [node.id]);

  return (
    <div className="ub-insp-prop ub-insp-prop--block" data-prop="__text">
      <div className="ub-insp-prop__label">
        <label htmlFor={`text-${node.id}`} title="The text shown by this component. Type {{ to insert a variable.">
          Text
        </label>
      </div>
      <span className="ub-insp-prop__tools">
        <button
          type="button"
          className={cx('ub-insp-fx ub-insp-rulesbtn', rules && 'is-on')}
          aria-pressed={!!rules}
          aria-label={rules ? 'Stop using rules for Text' : 'Use rules for Text'}
          title={rules ? 'Stop using rules — keep the “Otherwise” text' : 'Rules — show different text depending on a value'}
          onClick={toggleRules}
        >
          <ListFilter size={12} aria-hidden />
        </button>
      </span>
      <div className="ub-insp-prop__editor">
        {rules ? (
          <RulesEditor node={node} def={TEXT_DEF} ext={ext} value={rules} onChange={changeRules} />
        ) : (
          <TemplateInput
            id={`text-${node.id}`}
            value={text}
            onChange={(t) => setText(node.id, t)}
            ext={ext}
            nodeId={node.id}
            multiline={multiline}
            placeholder="Type text, or {{ variable }}"
            aria-label="Text content"
            replaceableText={createdText}
          />
        )}
      </div>
      {showHelp && !rules && (
        <div className="ub-insp-prop__desc" id={helpId}>
          The words it shows. Click <span className="ub-insp-kbd">{'{ }'}</span> to show a CRM property or other data in them.
        </div>
      )}
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

/** Creates a state variable shaped by the component's valueBinding and binds the node to it (one undo step). */
export function createBoundVariable(node: UINode, def: ComponentDef): string | null {
  const vb = def.valueBinding;
  if (!vb) return null;
  return asOneUndoStep(() => {
    const st = useEditor.getState();
    const v = st.addStateVar({
      name: bindingVariableName(node, def),
      type: vb.stateType,
      initial: JSON.parse(JSON.stringify(vb.initial)) as JsonValue,
      description: `Bound to ${nodeLabel(node, def.label)}`,
    });
    st.updateNode(node.id, { binding: { state: v.name } });
    return v.name;
  });
}

/**
 * The event that delivers the bound value on every edit when the binding's own event only fires
 * on commit: text fields update their binding `onChange` (blur / Enter) and fire `onInput` with
 * the same value while typing. Null for other components (e.g. Select's onInput is search text).
 */
export function liveBindingEvent(def: ComponentDef): EventDef | null {
  const vb = def.valueBinding;
  if (!vb || vb.prop !== 'value') return null;
  const change = def.events?.find((e) => e.name === vb.event);
  const live = def.events?.find((e) => e.name === 'onInput');
  if (!change || !live || !change.params[0] || live.params[0]?.description !== change.params[0].description) return null;
  return live;
}

/** The step "Update while typing" adds to the live event: set <state> to the event's value. */
function isLiveBindingStep(step: ActionStep, state: string): boolean {
  return step.type === 'setState' && step.state === state && step.value.trim() === 'value';
}

/** Whether the node also updates its bound variable on every edit. */
export function updatesWhileTyping(node: UINode, def: ComponentDef): boolean {
  const live = liveBindingEvent(def);
  const state = node.binding?.state;
  return !!live && !!state && (node.events?.[live.name] ?? []).some((s) => isLiveBindingStep(s, state));
}

/** Turns "Update while typing" on or off (adds / removes the live set-variable step). */
export function setUpdateWhileTyping(node: UINode, def: ComponentDef, on: boolean): void {
  const live = liveBindingEvent(def);
  const state = node.binding?.state;
  if (!live || !state) return;
  const steps = node.events?.[live.name] ?? [];
  const rest = steps.filter((s) => !isLiveBindingStep(s, state));
  const next: ActionStep[] = on ? [...rest, { id: newId('a'), type: 'setState', state, value: 'value' }] : rest;
  useEditor.getState().setEvent(node.id, live.name, next);
}

/**
 * Binds / unbinds the node (one undo step). An "Update while typing" step follows the binding:
 * it moves to the new variable, or is removed when the node is unbound.
 */
export function setBinding(node: UINode, def: ComponentDef, state: string | undefined): void {
  const live = liveBindingEvent(def);
  const prev = node.binding?.state;
  asOneUndoStep(() => {
    const st = useEditor.getState();
    st.updateNode(node.id, { binding: state ? { state } : undefined });
    if (!live || !prev || prev === state) return;
    const steps = node.events?.[live.name] ?? [];
    if (!steps.some((s) => isLiveBindingStep(s, prev))) return;
    const next = state
      ? steps.map((s) => (isLiveBindingStep(s, prev) ? { ...s, state } : s))
      : steps.filter((s) => !isLiveBindingStep(s, prev));
    st.setEvent(node.id, live.name, next);
  });
}

function BindingSection({ node, def, ext, forceOpen }: { node: UINode; def: ComponentDef; ext: Extension; forceOpen?: boolean }) {
  const vb = def.valueBinding!;
  const current = node.binding?.state ?? '';
  const vars = ext.state.filter((s) => compatibleStateType(s.type, vb.stateType) || s.name === current);
  const missing = current && !ext.state.some((s) => s.name === current);
  const propLabel = def.props.find((p) => p.name === vb.prop)?.label ?? vb.prop;
  const live = liveBindingEvent(def);
  const typing = updatesWhileTyping(node, def);
  // Text areas commit on blur only (Enter adds a line).
  const commitWhen = def.type === 'TextArea' ? 'when the field loses focus' : 'when the user presses Enter or leaves the field';
  return (
    <InspectorSection
      id="binding"
      title={
        <>
          <Link2 size={13} aria-hidden /> Value binding
        </>
      }
      meta={current ? <Badge tone="select">{current}</Badge> : null}
      forceOpen={forceOpen}
    >
      <div className="ub-insp-help">
        Links <strong>{propLabel}</strong> to a variable (state) so the rest of the card can use it, both ways.
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
            onChange={(v) => setBinding(node, def, v || undefined)}
            options={[
              ...vars.map((s) => ({ value: s.name, label: `${s.name} (${s.type})` })),
              ...(missing ? [{ value: current, label: `${current} (missing)` }] : []),
            ]}
          />
          {current ? (
            <Button size="sm" variant="ghost" onClick={() => setBinding(node, def, undefined)}>
              Unbind
            </Button>
          ) : null}
        </div>
        {missing && <div className="ub-field__error">State variable “{current}” no longer exists.</div>}
        {live && !typing && (
          <div className="ub-field__hint">
            Updates {current ? <code>{current}</code> : 'the variable'} {commitWhen} — not on every keystroke.
          </div>
        )}
      </div>
      {live && current && !missing && (
        <div className="ub-insp-field">
          <Switch
            checked={typing}
            onChange={(on) => setUpdateWhileTyping(node, def, on)}
            label="Update while typing"
          />
          <div className="ub-field__hint">
            Also sets <code>{current}</code> from {live.label} on every keystroke, e.g. for a live search filter. HubSpot recommends
            updating state on change for most fields.
          </div>
        </div>
      )}
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

function SlotSection({
  node,
  def,
  slotName,
  ext,
  forceOpen,
}: {
  node: UINode;
  def: ComponentDef;
  slotName: string;
  ext: Extension;
  forceOpen?: boolean;
}) {
  const slot = def.slots!.find((s) => s.name === slotName)!;
  const ids = node.slots?.[slot.name] ?? [];
  const full = slot.max !== undefined && ids.length >= slot.max;
  const addable = full ? [] : slot.accepts.filter((t) => canAccept(ext, node.id, t, slot.name).ok);
  const st = useEditor.getState;
  // Buttons can get a ready-made confirmation modal (first for destructive buttons).
  const destructive = node.props.variant === 'destructive';
  const canConfirm = slot.name === 'overlay' && addable.includes('Modal') && /Button/.test(node.type);
  const confirmFirst = canConfirm && destructive;
  const confirmButton = canConfirm ? (
    <Button
      size="sm"
      icon={<ShieldAlert size={13} />}
      title="Ask “Are you sure?” in a modal before the action runs"
      onClick={() => {
        const tpl = confirmModalTemplate(node.text, destructive);
        if (tpl) st().insertNode(tpl, { parentId: node.id, slot: slot.name, index: 0 });
      }}
    >
      Add confirmation
    </Button>
  ) : null;
  return (
    <InspectorSection
      id={`slot:${slot.name}`}
      title={slot.label}
      meta={ids.length ? <span className="ub-insp-setcount">{ids.length}</span> : null}
      forceOpen={forceOpen}
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
      {(addable.length > 0 || canConfirm) && (
        <div className="ub-insp-row-actions">
          {confirmFirst && confirmButton}
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
          {!confirmFirst && confirmButton}
        </div>
      )}
      {ids.length === 0 && addable.length === 0 && <div className="ub-insp-muted">Nothing can be attached here on this card.</div>}
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

/** "Inside this layout box", "Inside these tabs". */
export function insideTitle(def: ComponentDef): string {
  const label = def.label.toLowerCase();
  return /[^s]s$/.test(label) ? `Inside these ${label}` : `Inside this ${label}`;
}

function ChildrenSection({ node, def, ext, forceOpen }: { node: UINode; def: ComponentDef; ext: Extension; forceOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const types = useMemo(() => addableChildTypes(ext, node, def), [ext, node, def]);
  const st = useEditor.getState;
  const count = node.children.length;
  return (
    <InspectorSection
      id="children"
      title={insideTitle(def)}
      meta={<span className="ub-insp-setcount">{count}</span>}
      forceOpen={forceOpen}
      className="ub-insp-inside"
    >
      {count === 0 ? (
        <div className="ub-insp-empty">
          Nothing inside yet. Drag components here from the left, or click <strong>Add inside</strong>.
        </div>
      ) : (
        <>
          <div className="ub-insp-help">Click one to change it.</div>
          <ul className="ub-insp-children" aria-label={insideTitle(def)}>
            {node.children.map((cid) => {
              const child = ext.nodes[cid];
              if (!child) return null;
              const cdef = getComponent(child.type);
              const Icon = cdef?.icon ?? MousePointerClick;
              const hints = nodeHints(child, cdef).slice(0, 2);
              return (
                <li key={cid}>
                  <button
                    type="button"
                    className="ub-insp-noderow is-button is-child"
                    onClick={() => st().select(cid)}
                    onMouseEnter={() => st().hover(cid)}
                    onMouseLeave={() => st().hover(null)}
                    onFocus={() => st().hover(cid)}
                    onBlur={() => st().hover(null)}
                    title={`Select ${nodeLabel(child, cdef?.label)}`}
                  >
                    <Icon size={14} aria-hidden />
                    <span className="ub-insp-noderow__text">
                      <span className="ub-insp-noderow__label">{nodeLabel(child, cdef?.label)}</span>
                      {hints.length > 0 && <span className="ub-insp-noderow__hint">{hints.map((h) => h.text).join(' · ')}</span>}
                    </span>
                    <ChevronRight size={14} aria-hidden className="ub-insp-noderow__go" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {def.children.required && count === 0 && <div className="ub-field__error">{def.label} needs at least one component inside.</div>}
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
          <ArrowDownToLine size={13} aria-hidden /> Add inside
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

function CustomPropsSection({ node, def, ext, forceOpen }: { node: UINode; def: ComponentDef; ext: Extension; forceOpen?: boolean }) {
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
      forceOpen={forceOpen && custom.length > 0}
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
