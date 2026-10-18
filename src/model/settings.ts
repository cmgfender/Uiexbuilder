/**
 * "Copy settings" / "Paste settings" between components of the same type, and the settings several
 * selected components share (multi-edit). Pure helpers used by the store and the inspector.
 *
 * Settings are a component's props (including rules and expressions, which are stored as props)
 * and its text — never what identifies it: an overlay's `id`, an input's form `name`, `testId`, a
 * Tab's `tabId`, a statistics item's `id` (ComponentDef.identityProps).
 * Events, conditions, repeats and bindings belong to the component's logic and are not copied.
 */
import { getComponent } from '../registry';
import type { ComponentDef } from '../registry/types';
import type { JsonValue, PropValue, UINode } from './types';

export interface SettingsClipboard {
  /** Component type the settings were copied from (they paste onto the same type). */
  type: string;
  props: Record<string, PropValue>;
  /** Text content (components whose children are text). */
  text?: string;
  /** Plain-language name of the source, e.g. "Button “Save”". */
  label: string;
}

/** Props that identify a component (kept on paste, never copied). */
export function identityProps(def: ComponentDef | undefined): Set<string> {
  const out = new Set<string>(['testId']);
  if (def?.overlay) out.add(def.overlay.idProp);
  // Form inputs submit their value under `name`: two inputs with one name would clash.
  if (def?.valueBinding) out.add('name');
  // Declared by the component, e.g. a Tab's `tabId` or a statistics item's `id`.
  for (const name of def?.identityProps ?? []) out.add(name);
  return out;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The settings of a node (props without identity props, and text). */
export function settingsOf(node: UINode, label: string): SettingsClipboard {
  const def = getComponent(node.type);
  const skip = identityProps(def);
  const props: Record<string, PropValue> = {};
  for (const [k, v] of Object.entries(node.props)) if (!skip.has(k) && v !== undefined) props[k] = clone(v);
  const out: SettingsClipboard = { type: node.type, props, label };
  if (def?.children?.mode === 'text' && typeof node.text === 'string') out.text = node.text;
  return out;
}

/** Whether copied settings can be pasted onto a node. */
export function canPasteSettings(clip: SettingsClipboard | null, node: UINode | undefined): boolean {
  return !!clip && !!node && node.type === clip.type;
}

/**
 * Applies copied settings to a node (mutates it, e.g. an immer draft): its props become the copied
 * ones, keeping its own identity props; its text is replaced when the settings carry text.
 */
export function applySettings(node: UINode, clip: SettingsClipboard): void {
  const def = getComponent(node.type);
  const keep = identityProps(def);
  for (const k of Object.keys(node.props)) if (!keep.has(k)) delete node.props[k];
  for (const [k, v] of Object.entries(clip.props)) if (!keep.has(k)) node.props[k] = clone(v);
  if (clip.text !== undefined && def?.children?.mode === 'text') node.text = clip.text;
}

// ---------------------------------------------------------------------------
// Multi-edit
// ---------------------------------------------------------------------------

/** A value shared by several nodes, or `mixed` when they differ. */
export type SharedValue<T> = { mixed: false; value: T } | { mixed: true };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The value of a prop across nodes (absent counts as its own value). */
export function sharedProp(nodes: UINode[], name: string): SharedValue<PropValue | undefined> {
  const first = nodes[0]?.props[name];
  return nodes.every((n) => same(n.props[name], first)) ? { mixed: false, value: first } : { mixed: true };
}

/** The text across nodes. */
export function sharedText(nodes: UINode[]): SharedValue<string> {
  const first = nodes[0]?.text ?? '';
  return nodes.every((n) => (n.text ?? '') === first) ? { mixed: false, value: first } : { mixed: true };
}

/**
 * Props several nodes have in common (by name, with the same kind of value; enums with the same
 * options), in the first node's order — what multi-edit can change at once. Identity props and
 * props hidden for any node are left out.
 */
export function commonPropDefs(nodes: UINode[]): ComponentDef['props'] {
  const defs = nodes.map((n) => getComponent(n.type));
  if (!nodes.length || defs.some((d) => !d)) return [];
  const [first, ...rest] = defs as ComponentDef[];
  const skip = new Set<string>();
  for (const d of defs) identityProps(d).forEach((k) => skip.add(k));
  const visible = (def: ComponentDef['props'][number], node: UINode) => {
    try {
      return !def.visibleWhen || def.visibleWhen(node.props as Record<string, JsonValue>);
    } catch {
      return true;
    }
  };
  return first.props.filter((p) => {
    if (skip.has(p.name) || p.deprecated) return false;
    if (!nodes.every((n, i) => visible(defs[i]!.props.find((x) => x.name === p.name) ?? p, n))) return false;
    return rest.every((d) => {
      const q = d.props.find((x) => x.name === p.name);
      if (!q || q.type.kind !== p.type.kind) return false;
      if (p.type.kind === 'enum' && q.type.kind === 'enum') return same(p.type.options.map((o) => o.value), q.type.options.map((o) => o.value));
      return true;
    });
  });
}

/** Whether every node has text content (children mode 'text'). */
export function allHaveText(nodes: UINode[]): boolean {
  return nodes.length > 0 && nodes.every((n) => getComponent(n.type)?.children?.mode === 'text');
}
