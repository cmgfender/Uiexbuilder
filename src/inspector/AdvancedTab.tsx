/**
 * Advanced tab: visibility condition, repeat (render once per item), layer settings and node info.
 */
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ClipboardCopy, ClipboardPaste, Copy, Eye, EyeOff, ListFilter, Repeat } from 'lucide-react';
import { isValidIdentifier, uniqueName } from '../model/ids';
import { canPasteSettings } from '../model/settings';
import { getComponent } from '../registry';
import { useEditor } from '../model/store';
import type { Extension, RepeatConfig, UINode } from '../model/types';
import type { ComponentDef } from '../registry/types';
import type { Scope } from '../runtime';
import { Button, cx, IconButton, Select, Switch, TextInput, useToast } from '../ui';
import { ExpressionInput, usePreviewScope, useScopeVariables } from './controls';
import { copyText } from './clipboard';
import { isMacPlatform } from '../shell/shortcuts';
import { formatPreviewValue } from './propValue';
import { ConditionBuilder } from './power-ConditionBuilder';
import { asOneUndoStep } from './history';
import { addShapedList, listSourceOf } from '../power/actions';
import { parseShape, shapeToExpr } from '../power/shape';
import { ShapeEditor } from '../power/ShapeEditor';
import { safeEvaluate } from './scope';
import { InspectorSection } from './Section';

export interface AdvancedTabProps {
  node: UINode;
  def: ComponentDef;
  ext: Extension;
}

export function AdvancedTab({ node, def, ext }: AdvancedTabProps) {
  return (
    <div className="ub-insp-tabpanel">
      <ConditionSection node={node} ext={ext} />
      <RepeatSection node={node} ext={ext} />
      <ReuseSection node={node} def={def} />
      <LayerSection node={node} def={def} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Condition presets: data source loading flags and truthy state variables. */
export function conditionPresets(ext: Extension): Array<{ label: string; expr: string }> {
  const out: Array<{ label: string; expr: string }> = [];
  for (const ds of ext.dataSources) {
    out.push({ label: `while ${ds.name} is loading`, expr: `${ds.name}Loading` });
    out.push({ label: `when ${ds.name} has loaded`, expr: `!${ds.name}Loading && !${ds.name}Error` });
  }
  for (const s of ext.state) out.push({ label: `when ${s.name} is truthy`, expr: s.name });
  for (const s of ext.state)
    if (s.type === 'boolean' || s.type === 'any') out.push({ label: `when ${s.name} is false`, expr: `!${s.name}` });
  return out;
}

function ConditionSection({ node, ext }: { node: UINode; ext: Extension }) {
  const updateNode = useEditor((s) => s.updateNode);
  const scope = usePreviewScope(ext, node.id);
  const cond = node.condition ?? '';
  const presets = useMemo(() => conditionPresets(ext), [ext]);
  const result = useMemo(() => (cond.trim() ? safeEvaluate(cond, scope) : null), [cond, scope]);
  return (
    <div data-adv="condition">
      <InspectorSection id="adv:condition" title="Visibility" meta={cond ? <span className="ub-insp-setcount">on</span> : null}>
        <div className="ub-insp-help">Show this component only when the checks below are true — e.g. once the data has loaded, or for big deals.</div>
        <ConditionBuilder
          ext={ext}
          nodeId={node.id}
          value={cond}
          onChange={(t) => updateNode(node.id, { condition: t.trim() ? t : undefined })}
          label="Show when"
          codeLabel="Visibility condition"
          addLabel="Add a condition"
        />
        {cond.trim() ? (
          <div className={cx('ub-insp-live', result?.ok ? (result.value ? 'is-on' : 'is-off') : 'is-unknown')} role="status">
            {result === null ? (
              <>Live result not shown for this expression.</>
            ) : result.ok ? (
              result.value ? (
                <>
                  <Eye size={13} aria-hidden /> Currently: shown
                </>
              ) : (
                <>
                  <EyeOff size={13} aria-hidden /> Currently: hidden
                </>
              )
            ) : (
              <>Can’t evaluate: {result.error}</>
            )}
          </div>
        ) : (
          <div className="ub-insp-muted">Always shown.</div>
        )}
        {presets.length > 0 && (
          <Select
            value=""
            aria-label="Condition presets"
            placeholder="Quick condition…"
            onChange={(expr) => expr && updateNode(node.id, { condition: expr })}
            options={presets.map((p) => ({ value: p.expr, label: p.label }))}
          />
        )}
      </InspectorSection>
    </div>
  );
}

// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[$]/g, '\\$&');

/**
 * Array-valued things worth offering as repeat sources (the first one is the default):
 *  1. computed values that are lists derived from another list (e.g. `filtered` from `items`) —
 *     the usual "filter a list" pattern, so repeating over them is what the user wants;
 *  2. array state, CRM list data sources and fetch / function sources whose data is a list;
 *  3. other computed values that are lists.
 * Computed values and fetch / function data are checked with their current preview values.
 */
export function repeatPresets(ext: Extension, scope?: Scope | null): Array<{ label: string; expr: string }> {
  const lists: Array<{ label: string; expr: string }> = [];
  const isArrayNow = (name: string) => !!scope && Object.prototype.hasOwnProperty.call(scope, name) && Array.isArray(scope[name]);
  for (const s of ext.state) if (s.type === 'array') lists.push({ label: s.name, expr: s.name });
  for (const ds of ext.dataSources) {
    const list = ds.kind === 'associations' || ds.kind === 'crmSearch' || ((ds.kind === 'fetch' || ds.kind === 'function') && isArrayNow(ds.name));
    if (list) lists.push({ label: ds.name, expr: `${ds.name} ?? []` });
  }
  const derived: Array<{ label: string; expr: string }> = [];
  const other: Array<{ label: string; expr: string }> = [];
  const taken = new Set(lists.map((l) => l.label));
  for (const c of ext.computed ?? []) {
    if (taken.has(c.name) || !isArrayNow(c.name)) continue;
    taken.add(c.name);
    const fromList = lists.some((l) => new RegExp(`(?<![\\w$.])${escapeRe(l.label)}(?![\\w$])`).test(c.expr));
    (fromList ? derived : other).push({ label: c.name, expr: c.name });
  }
  return [...derived, ...lists, ...other];
}

function IdentifierInput({
  value,
  onCommit,
  label,
  taken,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  taken: string[];
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = !isValidIdentifier(draft)
    ? 'Use letters, digits, _ or $ (not a reserved word).'
    : taken.includes(draft)
      ? `“${draft}” is already used in this scope.`
      : null;
  return (
    <div className="ub-insp-field">
      <div className="ub-insp-field__label">
        <label>{label}</label>
      </div>
      <TextInput
        code
        value={draft}
        aria-label={label}
        invalid={!!error}
        onChange={(v) => {
          setDraft(v);
          if (isValidIdentifier(v) && !taken.includes(v)) onCommit(v);
        }}
        onBlur={() => setDraft(value)}
      />
      {error && <div className="ub-field__error">{error}</div>}
    </div>
  );
}

/**
 * Whether a repeat's items can be shaped as a computed value: a list declared at the top of the card
 * (state, data, computed value), not a repeat item of an outer repeat (computed values can't see those).
 */
export function canShapeItems(ext: Extension, items: string): boolean {
  const src = listSourceOf(items);
  const root = /^[A-Za-z_$][\w$]*/.exec(src)?.[0];
  if (!root || !src) return false;
  return ext.state.some((v) => v.name === root) || ext.dataSources.some((d) => d.name === root) || (ext.computed ?? []).some((c) => c.name === root);
}

function RepeatSection({ node, ext }: { node: UINode; ext: Extension }) {
  const updateNode = useEditor((s) => s.updateNode);
  const [shapeOpen, setShapeOpen] = useState(true);
  const r = node.repeat;
  const scopeVars = useScopeVariables(ext, node.id);
  // The preview scope binds this repeat's first item; evaluate items in the parent's terms.
  const scope = usePreviewScope(ext, node.id);
  const presets = useMemo(() => repeatPresets(ext, scope), [ext, scope]);
  const outerNames = useMemo(
    () =>
      scopeVars
        .filter((v) => !v.name.includes('.') && !(r && (v.name === r.itemName || v.name === r.indexName) && v.kind === 'repeat'))
        .map((v) => v.name),
    [scopeVars, r],
  );
  const set = (patch: Partial<RepeatConfig>) => r && updateNode(node.id, { repeat: { ...r, ...patch } });
  const items = useMemo(() => (r?.items.trim() ? safeEvaluate(r.items, scope) : null), [r, scope]);
  // Repeating over a shaped list (computed value): edit its filter / sort / formats right here.
  const shaped = r ? (ext.computed ?? []).find((c) => c.name === r.items.trim()) : undefined;
  const shape = useMemo(() => (shaped ? parseShape(shaped.expr) : null), [shaped]);
  const shapeItems = () => {
    if (!r) return;
    asOneUndoStep(() => {
      const c = addShapedList(r.items);
      updateNode(node.id, { repeat: { ...r, items: c.name } });
    });
  };

  const enable = (on: boolean) => {
    if (!on) return updateNode(node.id, { repeat: undefined });
    updateNode(node.id, {
      repeat: {
        items: presets[0]?.expr ?? '',
        itemName: uniqueName('item', outerNames),
        indexName: uniqueName('index', outerNames),
      },
    });
  };

  return (
    <div data-adv="repeat">
      <InspectorSection
        id="adv:repeat"
        title={
          <>
            <Repeat size={13} aria-hidden /> Repeat
          </>
        }
        meta={r ? <span className="ub-insp-setcount">on</span> : null}
      >
        <Switch checked={!!r} onChange={enable} label="Repeat for each item in a list" />
        {r && (
          <>
            <div className="ub-insp-field">
              <div className="ub-insp-field__label">
                <label>Items</label>
              </div>
              <ExpressionInput
                value={r.items}
                onChange={(t) => set({ items: t })}
                ext={ext}
                nodeId={node.id}
                placeholder="An array, e.g. contacts"
                aria-label="Repeat items"
                hidePreview
              />
              <div className={cx('ub-insp-live', items?.ok && Array.isArray(items.value) ? 'is-on' : 'is-unknown')} role="status">
                {!r.items.trim()
                  ? 'Choose the list to repeat over.'
                  : items === null
                    ? 'Live count not shown for this expression.'
                    : items.ok
                      ? Array.isArray(items.value)
                        ? `${items.value.length} item${items.value.length === 1 ? '' : 's'} right now`
                        : `Not a list (got ${formatPreviewValue(items.value, 40)})`
                      : `Can’t evaluate: ${items.error}`}
              </div>
              {shaped && shape ? (
                <div className="ub-pw-repeatshape">
                  <button type="button" className="ub-pw-repeatshape__toggle" aria-expanded={shapeOpen} onClick={() => setShapeOpen((o) => !o)}>
                    {shapeOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                    <ListFilter size={13} aria-hidden /> Filter, sort & format <code>{shaped.name}</code>
                  </button>
                  {shapeOpen && (
                    <ShapeEditor
                      ext={ext}
                      shape={shape}
                      computedId={shaped.id}
                      name={shaped.name}
                      itemName={r.itemName}
                      onChange={(next) => useEditor.getState().updateComputed(shaped.id, { expr: shapeToExpr(next) })}
                    />
                  )}
                </div>
              ) : (
                r.items.trim() &&
                canShapeItems(ext, r.items) && (
                  <button type="button" className="ub-btn ub-btn--sm ub-pw-repeatshape__add" onClick={shapeItems}>
                    <ListFilter size={13} aria-hidden /> Filter, sort & limit…
                  </button>
                )
              )}
              {presets.length > 0 && (
                <div className="ub-insp-quick" aria-label="Lists">
                  {presets.map((p) => (
                    <button
                      key={p.expr}
                      type="button"
                      className="ub-insp-quick__btn"
                      onClick={() => set({ items: p.expr })}
                      title={`Repeat over ${p.label}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="ub-insp-grid2">
              <IdentifierInput
                label="Item name"
                value={r.itemName}
                onCommit={(v) => set({ itemName: v })}
                taken={[...outerNames, r.indexName]}
              />
              <IdentifierInput
                label="Index name"
                value={r.indexName}
                onCommit={(v) => set({ indexName: v })}
                taken={[...outerNames, r.itemName]}
              />
            </div>
            <div className="ub-insp-field">
              <div className="ub-insp-field__label">
                <label>Key (optional)</label>
              </div>
              <ExpressionInput
                value={r.key ?? ''}
                onChange={(t) => set({ key: t.trim() ? t : undefined })}
                ext={ext}
                nodeId={node.id}
                placeholder={`${r.indexName} — or a unique id, e.g. ${r.itemName}.id`}
                aria-label="Repeat key"
              />
              <div className="ub-field__hint">
                Use <code>{r.itemName}</code> and <code>{r.indexName}</code> in this component’s props, text and children.
              </div>
            </div>
          </>
        )}
      </InspectorSection>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Copy settings / Paste settings: give another component of the same kind this one's look, text and rules. */
function ReuseSection({ node, def }: { node: UINode; def: ComponentDef }) {
  const clip = useEditor((s) => s.settingsClipboard);
  const toast = useToast();
  const canPaste = canPasteSettings(clip, node);
  return (
    <InspectorSection id="adv:reuse" title="Reuse settings">
      <div className="ub-insp-help">
        Copy this {def.label.toLowerCase()}’s settings — look, text and rules, not its id — and paste them onto another {def.label.toLowerCase()}.
        Shift-click (or {isMacPlatform() ? 'Cmd' : 'Ctrl'}-click) several components on the canvas or in Layers to change a setting on all of them.
      </div>
      <div className="ub-pw-reuse">
        <Button
          size="sm"
          icon={<ClipboardCopy size={13} aria-hidden />}
          onClick={() => {
            const c = useEditor.getState().copySettings(node.id);
            if (c) toast(`Copied the settings of ${c.label} — select another ${def.label.toLowerCase()} and paste them`);
          }}
        >
          Copy settings
        </Button>
        <Button
          size="sm"
          icon={<ClipboardPaste size={13} aria-hidden />}
          disabled={!canPaste}
          title={
            !clip
              ? 'Copy the settings of another component first'
              : canPaste
                ? `Paste the settings of ${clip.label}`
                : `The copied settings are for a ${getComponent(clip.type)?.label.toLowerCase() ?? clip.type}`
          }
          onClick={() => {
            const n = useEditor.getState().pasteSettings([node.id]);
            toast(n ? `Pasted the settings of ${clip!.label}` : 'It already has these settings');
          }}
        >
          Paste settings
        </Button>
      </div>
    </InspectorSection>
  );
}

// ---------------------------------------------------------------------------

function LayerSection({ node, def }: { node: UINode; def: ComponentDef }) {
  const updateNode = useEditor((s) => s.updateNode);
  const toast = useToast();
  return (
    <InspectorSection id="adv:layer" title="Layer">
      <div className="ub-insp-field">
        <div className="ub-insp-field__label">
          <label htmlFor={`layer-name-${node.id}`}>Layer name</label>
        </div>
        <TextInput
          id={`layer-name-${node.id}`}
          value={node.name ?? ''}
          placeholder={def.label}
          onChange={(name) => updateNode(node.id, { name: name || undefined })}
        />
      </div>
      <Switch
        checked={!!node.hiddenInDesigner}
        onChange={(c) => updateNode(node.id, { hiddenInDesigner: c || undefined })}
        label="Hidden in designer (still rendered in HubSpot)"
      />
      <Switch
        checked={!!node.locked}
        onChange={(c) => updateNode(node.id, { locked: c || undefined })}
        label="Locked (can’t be moved or deleted on the canvas)"
      />
      <div className="ub-insp-idrow">
        <span className="ub-insp-muted">Node id</span>
        <code>{node.id}</code>
        <IconButton
          size="sm"
          label="Copy node id"
          onClick={async () => toast((await copyText(node.id)) ? 'Node id copied' : 'Could not copy to the clipboard')}
        >
          <Copy size={12} />
        </IconButton>
      </div>
      {def.docsUrl && (
        <Button
          size="sm"
          variant="ghost"
          icon={<BookOpen size={13} />}
          onClick={() => window.open(def.docsUrl, '_blank', 'noopener,noreferrer')}
        >
          {def.label} documentation
        </Button>
      )}
    </InspectorSection>
  );
}
