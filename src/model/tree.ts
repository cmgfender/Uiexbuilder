/**
 * Pure tree operations over an extension's flat node map.
 * All mutating helpers are written to work on immer drafts (they mutate in place).
 */
import { newId } from './ids';
import type { ActionStep, Extension, NodeId, NodeTemplate, UINode } from './types';

export interface ParentRef {
  parentId: NodeId;
  /** Slot name when the node lives in a slot (e.g. 'overlay'); undefined for regular children. */
  slot?: string;
  index: number;
}

/** Location to insert at: a parent's children list or one of its slots. */
export interface InsertTarget {
  parentId: NodeId;
  index: number;
  slot?: string;
}

export function getNode(ext: Extension, id: NodeId): UINode | undefined {
  return ext.nodes[id];
}

/** Returns the list (children or a slot) a target refers to, creating the slot list if needed. */
export function getChildList(node: UINode, slot?: string, create = false): NodeId[] {
  if (!slot) return node.children;
  if (!node.slots) {
    if (!create) return [];
    node.slots = {};
  }
  if (!node.slots[slot]) {
    if (!create) return [];
    node.slots[slot] = [];
  }
  return node.slots[slot];
}

export function findParent(ext: Extension, id: NodeId): ParentRef | null {
  for (const node of Object.values(ext.nodes)) {
    const ci = node.children.indexOf(id);
    if (ci !== -1) return { parentId: node.id, index: ci };
    if (node.slots) {
      for (const [slot, ids] of Object.entries(node.slots)) {
        const si = ids.indexOf(id);
        if (si !== -1) return { parentId: node.id, slot, index: si };
      }
    }
  }
  return null;
}

/** Builds a child -> parent index (faster than repeated findParent for whole-tree work). */
export function buildParentIndex(ext: Extension): Map<NodeId, ParentRef> {
  const map = new Map<NodeId, ParentRef>();
  for (const node of Object.values(ext.nodes)) {
    node.children.forEach((cid, index) => map.set(cid, { parentId: node.id, index }));
    if (node.slots) {
      for (const [slot, ids] of Object.entries(node.slots)) {
        ids.forEach((cid, index) => map.set(cid, { parentId: node.id, slot, index }));
      }
    }
  }
  return map;
}

/** Ancestors of `id` from its parent up to the root (root last). */
export function getAncestors(ext: Extension, id: NodeId): NodeId[] {
  const index = buildParentIndex(ext);
  const out: NodeId[] = [];
  let cur = index.get(id);
  while (cur) {
    out.push(cur.parentId);
    cur = index.get(cur.parentId);
  }
  return out;
}

export function isAncestor(ext: Extension, ancestorId: NodeId, id: NodeId): boolean {
  return getAncestors(ext, id).includes(ancestorId);
}

/** All node ids in the subtree rooted at `id` (including `id` and slot content), depth-first. */
export function collectSubtree(ext: Extension, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const visit = (nid: NodeId) => {
    const node = ext.nodes[nid];
    if (!node) return;
    out.push(nid);
    node.children.forEach(visit);
    if (node.slots) Object.values(node.slots).forEach((ids) => ids.forEach(visit));
  };
  visit(id);
  return out;
}

/** Depth-first walk of the whole extension starting at the root. */
export function walk(
  ext: Extension,
  visitor: (node: UINode, depth: number, parent: ParentRef | null) => void | false,
): void {
  const visit = (nid: NodeId, depth: number, parent: ParentRef | null) => {
    const node = ext.nodes[nid];
    if (!node) return;
    if (visitor(node, depth, parent) === false) return;
    node.children.forEach((cid, index) => visit(cid, depth + 1, { parentId: nid, index }));
    if (node.slots) {
      for (const [slot, ids] of Object.entries(node.slots)) {
        ids.forEach((cid, index) => visit(cid, depth + 1, { parentId: nid, slot, index }));
      }
    }
  };
  visit(ext.rootId, 0, null);
}

/** Deep-clones action steps assigning fresh ids (used when duplicating / pasting). */
export function cloneActions(steps: ActionStep[]): ActionStep[] {
  return steps.map((step) => {
    const copy = JSON.parse(JSON.stringify(step)) as ActionStep;
    copy.id = newId('a');
    if (copy.type === 'if') {
      copy.then = cloneActions(copy.then);
      copy.else = cloneActions(copy.else);
    }
    if (copy.type === 'fetch' || copy.type === 'runFunction') {
      if (copy.onSuccess) copy.onSuccess = cloneActions(copy.onSuccess);
      if (copy.onError) copy.onError = cloneActions(copy.onError);
    }
    return copy;
  });
}

export interface InstantiatedSubtree {
  rootId: NodeId;
  nodes: Record<NodeId, UINode>;
}

/** Turns a detached template into concrete nodes with fresh ids. */
export function instantiateTemplate(tpl: NodeTemplate): InstantiatedSubtree {
  const nodes: Record<NodeId, UINode> = {};
  const build = (t: NodeTemplate): NodeId => {
    const id = newId('n');
    const node: UINode = {
      id,
      type: t.type,
      props: t.props ? (JSON.parse(JSON.stringify(t.props)) as UINode['props']) : {},
      children: [],
    };
    if (t.name !== undefined) node.name = t.name;
    if (t.text !== undefined) node.text = t.text;
    if (t.binding) node.binding = { ...t.binding };
    if (t.condition !== undefined) node.condition = t.condition;
    if (t.repeat) node.repeat = { ...t.repeat };
    if (t.events) {
      node.events = {};
      for (const [k, steps] of Object.entries(t.events)) node.events[k] = cloneActions(steps);
    }
    nodes[id] = node;
    node.children = (t.children ?? []).map(build);
    if (t.slots) {
      node.slots = {};
      for (const [slot, list] of Object.entries(t.slots)) node.slots[slot] = list.map(build);
    }
    return id;
  };
  const rootId = build(tpl);
  // Re-point closeOverlay actions that referenced template-local overlays is not possible by id;
  // templates reference overlays by their `id` prop instead (see fixupOverlayRefs).
  fixupOverlayRefs(nodes);
  return { rootId, nodes };
}

/**
 * Templates cannot know generated node ids, so a template's closeOverlay step may set
 * `overlayNodeId` to `"@<overlay id prop>"` (e.g. "@edit-modal"). This rewrites such references
 * to the concrete node id of the Modal/Panel whose `id` prop matches.
 */
export function fixupOverlayRefs(nodes: Record<NodeId, UINode>): void {
  const byOverlayId = new Map<string, NodeId>();
  for (const n of Object.values(nodes)) {
    const idProp = n.props.id;
    if (typeof idProp === 'string') byOverlayId.set(idProp, n.id);
  }
  const fix = (steps: ActionStep[]) => {
    for (const s of steps) {
      if (s.type === 'closeOverlay' && s.overlayNodeId.startsWith('@')) {
        const target = byOverlayId.get(s.overlayNodeId.slice(1));
        if (target) s.overlayNodeId = target;
      }
      if (s.type === 'if') {
        fix(s.then);
        fix(s.else);
      }
      if (s.type === 'fetch' || s.type === 'runFunction') {
        if (s.onSuccess) fix(s.onSuccess);
        if (s.onError) fix(s.onError);
      }
    }
  };
  for (const n of Object.values(nodes)) {
    if (n.events) Object.values(n.events).forEach(fix);
  }
}

/** The `id` prop name of an overlay component (Modal / Panel), or undefined for other types. */
export type OverlayIdPropOf = (type: string) => string | undefined;

/** Default overlay detection (Modal / Panel use their `id` prop); the store passes the registry's. */
export const DEFAULT_OVERLAY_ID_PROP: OverlayIdPropOf = (type) => (type === 'Modal' || type === 'Panel' ? 'id' : undefined);

function mapSteps(steps: ActionStep[], fn: (s: ActionStep) => ActionStep): ActionStep[] {
  return steps.map((step) => {
    let s = fn(step);
    if (s.type === 'if') s = { ...s, then: mapSteps(s.then ?? [], fn), else: mapSteps(s.else ?? [], fn) };
    if (s.type === 'fetch' || s.type === 'runFunction') {
      s = {
        ...s,
        ...(s.onSuccess ? { onSuccess: mapSteps(s.onSuccess, fn) } : {}),
        ...(s.onError ? { onError: mapSteps(s.onError, fn) } : {}),
      };
    }
    return s;
  });
}

/**
 * Converts a live subtree back into a detached template (for copy / duplicate / save as block).
 * Close-overlay steps that target a Modal / Panel inside the subtree become `@<overlay id>`
 * references, so the copy closes its own overlay once instantiated (see fixupOverlayRefs).
 */
export function toTemplate(ext: Extension, id: NodeId, overlayIdPropOf: OverlayIdPropOf = DEFAULT_OVERLAY_ID_PROP): NodeTemplate {
  if (!ext.nodes[id]) throw new Error(`Node ${id} not found`);
  const inside = new Set(collectSubtree(ext, id));
  const localRef = (overlayNodeId: string): string | null => {
    if (!inside.has(overlayNodeId)) return null;
    const target = ext.nodes[overlayNodeId];
    const prop = target ? overlayIdPropOf(target.type) ?? 'id' : 'id';
    const value = target?.props[prop];
    return typeof value === 'string' && value !== '' ? `@${value}` : null;
  };
  const build = (nid: NodeId): NodeTemplate => {
    const node = ext.nodes[nid];
    const tpl: NodeTemplate = { type: node.type };
    if (node.name !== undefined) tpl.name = node.name;
    if (Object.keys(node.props).length) tpl.props = JSON.parse(JSON.stringify(node.props));
    if (node.text !== undefined) tpl.text = node.text;
    if (node.binding) tpl.binding = { ...node.binding };
    if (node.condition !== undefined) tpl.condition = node.condition;
    if (node.repeat) tpl.repeat = { ...node.repeat };
    if (node.events) {
      const events = JSON.parse(JSON.stringify(node.events)) as Record<string, ActionStep[]>;
      for (const key of Object.keys(events)) {
        events[key] = mapSteps(events[key], (s) => {
          if (s.type !== 'closeOverlay') return s;
          const ref = localRef(s.overlayNodeId);
          return ref ? { ...s, overlayNodeId: ref } : s;
        });
      }
      tpl.events = events;
    }
    const children = node.children.filter((cid) => ext.nodes[cid]);
    if (children.length) tpl.children = children.map(build);
    if (node.slots) {
      const slots: Record<string, NodeTemplate[]> = {};
      for (const [slot, ids] of Object.entries(node.slots)) {
        const present = ids.filter((cid) => ext.nodes[cid]);
        if (present.length) slots[slot] = present.map(build);
      }
      if (Object.keys(slots).length) tpl.slots = slots;
    }
    return tpl;
  };
  return build(id);
}

/** Overlay id prop values (Modal / Panel `id`) used anywhere in the extension. */
export function usedOverlayIds(ext: Extension, overlayIdPropOf: OverlayIdPropOf = DEFAULT_OVERLAY_ID_PROP): Set<string> {
  const out = new Set<string>();
  for (const n of Object.values(ext.nodes)) {
    const prop = overlayIdPropOf(n.type);
    const v = prop ? n.props[prop] : undefined;
    if (typeof v === 'string') out.add(v);
  }
  return out;
}

/**
 * A copy of `tpl` whose Modal / Panel ids do not clash with overlays the extension already has
 * (`edit-modal` -> `edit-modal-2`). `@<id>` close-overlay references inside the template are
 * renamed with them. Returns `tpl` itself when nothing clashes.
 */
export function uniquifyOverlayIds(
  tpl: NodeTemplate,
  ext: Extension,
  overlayIdPropOf: OverlayIdPropOf = DEFAULT_OVERLAY_ID_PROP,
): NodeTemplate {
  const taken = usedOverlayIds(ext, overlayIdPropOf);
  const renames = new Map<string, string>();
  const collect = (t: NodeTemplate) => {
    const prop = overlayIdPropOf(t.type);
    const v = prop ? t.props?.[prop] : undefined;
    if (typeof v === 'string' && !renames.has(v)) {
      if (taken.has(v)) {
        let i = 2;
        while (taken.has(`${v}-${i}`)) i++;
        renames.set(v, `${v}-${i}`);
        taken.add(`${v}-${i}`);
      } else {
        taken.add(v);
      }
    }
    t.children?.forEach(collect);
    Object.values(t.slots ?? {}).forEach((list) => list.forEach(collect));
  };
  collect(tpl);
  if (renames.size === 0) return tpl;
  const rename = (t: NodeTemplate): NodeTemplate => {
    const out: NodeTemplate = { ...t };
    const prop = overlayIdPropOf(t.type);
    const v = prop ? t.props?.[prop] : undefined;
    if (prop && typeof v === 'string' && renames.has(v)) out.props = { ...t.props, [prop]: renames.get(v)! };
    if (t.events) {
      out.events = {};
      for (const [key, steps] of Object.entries(t.events)) {
        out.events[key] = mapSteps(steps, (s) => {
          if (s.type !== 'closeOverlay' || !s.overlayNodeId.startsWith('@')) return s;
          const to = renames.get(s.overlayNodeId.slice(1));
          return to ? { ...s, overlayNodeId: `@${to}` } : s;
        });
      }
    }
    if (t.children) out.children = t.children.map(rename);
    if (t.slots) out.slots = Object.fromEntries(Object.entries(t.slots).map(([k, list]) => [k, list.map(rename)]));
    return out;
  };
  return rename(tpl);
}

/** Display types (component labels) of a template and all its descendants, slots included. */
export function templateTypes(tpl: NodeTemplate, out: string[] = []): string[] {
  out.push(tpl.type);
  tpl.children?.forEach((c) => templateTypes(c, out));
  Object.values(tpl.slots ?? {}).forEach((list) => list.forEach((c) => templateTypes(c, out)));
  return out;
}

/** Inserts an instantiated subtree at a target (mutates `ext`). */
export function insertSubtree(ext: Extension, sub: InstantiatedSubtree, target: InsertTarget): void {
  const parent = ext.nodes[target.parentId];
  if (!parent) throw new Error(`Parent ${target.parentId} not found`);
  Object.assign(ext.nodes, sub.nodes);
  const list = getChildList(parent, target.slot, true);
  const index = Math.max(0, Math.min(target.index, list.length));
  list.splice(index, 0, sub.rootId);
}

/** Removes `id` from its parent's list without deleting nodes. Returns the old position. */
export function detach(ext: Extension, id: NodeId): ParentRef | null {
  const ref = findParent(ext, id);
  if (!ref) return null;
  const parent = ext.nodes[ref.parentId];
  const list = getChildList(parent, ref.slot);
  list.splice(ref.index, 1);
  if (ref.slot && parent.slots && parent.slots[ref.slot].length === 0) {
    delete parent.slots[ref.slot];
    if (Object.keys(parent.slots).length === 0) delete parent.slots;
  }
  return ref;
}

/** Deletes a node and its whole subtree (mutates `ext`). The root cannot be removed. */
export function removeSubtree(ext: Extension, id: NodeId): void {
  if (id === ext.rootId) return;
  const ids = collectSubtree(ext, id);
  detach(ext, id);
  for (const nid of ids) delete ext.nodes[nid];
  // Drop closeOverlay references to removed overlays.
  const removed = new Set(ids);
  const prune = (steps: ActionStep[]): ActionStep[] =>
    steps
      .filter((s) => !(s.type === 'closeOverlay' && removed.has(s.overlayNodeId)))
      .map((s) => {
        if (s.type === 'if') return { ...s, then: prune(s.then), else: prune(s.else) };
        if (s.type === 'fetch' || s.type === 'runFunction') {
          return {
            ...s,
            ...(s.onSuccess ? { onSuccess: prune(s.onSuccess) } : {}),
            ...(s.onError ? { onError: prune(s.onError) } : {}),
          };
        }
        return s;
      });
  for (const node of Object.values(ext.nodes)) {
    if (!node.events) continue;
    for (const key of Object.keys(node.events)) node.events[key] = prune(node.events[key]);
  }
}

/**
 * Moves a node to a new target. `target.index` is interpreted against the destination list
 * *before* the node is removed (i.e. as a drop indicator position), and adjusted automatically.
 * Returns false when the move is illegal (moving into itself / its own subtree / the root).
 */
export function moveNode(ext: Extension, id: NodeId, target: InsertTarget): boolean {
  if (id === ext.rootId) return false;
  if (target.parentId === id || isAncestor(ext, id, target.parentId)) return false;
  const ref = findParent(ext, id);
  if (!ref) return false;
  let index = target.index;
  const sameList = ref.parentId === target.parentId && (ref.slot ?? '') === (target.slot ?? '');
  if (sameList && ref.index < index) {
    index -= 1;
  }
  if (sameList) {
    const length = getChildList(ext.nodes[ref.parentId], ref.slot).length;
    // Dropping a node where it already is changes nothing (no history entry, no autosave).
    if (Math.max(0, Math.min(index, length - 1)) === ref.index) return true;
  }
  detach(ext, id);
  const parent = ext.nodes[target.parentId];
  const list = getChildList(parent, target.slot, true);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
  return true;
}

/**
 * Duplicates a node (and subtree) right after itself. Returns the new root id. Overlay ids in the
 * copy are made unique and its close-overlay steps target the copied overlays.
 */
export function duplicateNode(ext: Extension, id: NodeId, overlayIdPropOf: OverlayIdPropOf = DEFAULT_OVERLAY_ID_PROP): NodeId | null {
  const ref = findParent(ext, id);
  if (!ref) return null;
  const tpl = uniquifyOverlayIds(toTemplate(ext, id, overlayIdPropOf), ext, overlayIdPropOf);
  const sub = instantiateTemplate(tpl);
  insertSubtree(ext, sub, { parentId: ref.parentId, slot: ref.slot, index: ref.index + 1 });
  return sub.rootId;
}

/** Display label for a node in layers/breadcrumbs. */
export function nodeLabel(node: UINode, typeLabel?: string): string {
  if (node.name) return node.name;
  const base = typeLabel ?? node.type;
  const text = node.text?.trim();
  if (text) return `${base}: ${text.length > 24 ? `${text.slice(0, 24)}…` : text}`;
  const label = node.props.label ?? node.props.title;
  if (typeof label === 'string' && label.trim()) {
    const t = label.trim();
    return `${base}: ${t.length > 24 ? `${t.slice(0, 24)}…` : t}`;
  }
  return base;
}
