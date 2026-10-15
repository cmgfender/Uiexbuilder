/**
 * Editor commands shared by the keyboard shortcuts, the layers tree and the palette. Each reads the
 * latest store state (so it can run from event handlers without stale closures) and reports
 * user-facing problems through `notify` (a toast).
 */
import { usedStateVars } from '../canvas/nodeActions';
import { selectActiveExtension, unavailableComponents, useEditor } from '../model/store';
import { canAccept, extensionLocation } from '../model/rules';
import { findParent, type InsertTarget } from '../model/tree';
import type { Extension, ExtensionKind, ExtensionLocation, NodeId, StateVar } from '../model/types';
import { getComponent } from '../registry';
import type { ComponentDef } from '../registry/types';
import { smartInsertTarget, type DragPayload } from '../dnd/dragState';
import { insertBlock } from '../templates/actions';

export type Notify = (message: string) => void;

const noop: Notify = () => {};

function activeExt(): Extension {
  return selectActiveExtension(useEditor.getState());
}

/** Label of a node's component type (registry label, else the raw type). */
export function typeLabel(type: string): string {
  return getComponent(type)?.label ?? type;
}

// ---------------------------------------------------------------------------
// Location labels
// ---------------------------------------------------------------------------

export const LOCATION_LABELS: Record<ExtensionLocation, string> = {
  'crm.record.tab': 'Record tab',
  'crm.record.sidebar': 'Record sidebar',
  'crm.preview': 'Preview panel',
  'helpdesk.sidebar': 'Help desk sidebar',
  settings: 'Settings page',
  home: 'App home',
};

export const KIND_LABELS: Record<ExtensionKind, string> = {
  card: 'App card',
  settings: 'Settings page',
  home: 'App home page',
};

export function extensionLocationLabel(ext: Extension): string {
  return LOCATION_LABELS[extensionLocation(ext)];
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Plain-language reason a component is unavailable in the extension (see isAvailableIn). */
export function unavailableReason(def: ComponentDef, ext: Extension): string {
  const here = extensionLocationLabel(ext).toLowerCase();
  if (def.kinds && !def.kinds.includes(ext.kind)) {
    return `${def.label} can only be used on ${listJoin(def.kinds.map((k) => KIND_LABELS[k].toLowerCase() + 's'))} — not on this ${here}.`;
  }
  if (def.locations) {
    const where = listJoin(def.locations.map((l) => LOCATION_LABELS[l].toLowerCase()));
    return `${def.label} only works in CRM locations (${where}) — not on this ${here}.`;
  }
  return `${def.label} is not available here.`;
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/**
 * Where a palette click should insert `type`: `smartInsertTarget`, or — for overlay components
 * (Modal, Panel, Tooltip) — the overlay slot of the selected trigger (or its nearest ancestor).
 */
export function paletteInsertTarget(ext: Extension, selectedId: NodeId | null, type: string): InsertTarget | null {
  const smart = smartInsertTarget(ext, selectedId, type);
  if (smart) return smart;
  let cur: NodeId | null = selectedId && ext.nodes[selectedId] ? selectedId : null;
  while (cur && cur !== ext.rootId) {
    const node = ext.nodes[cur];
    const def = getComponent(node.type);
    for (const slot of def?.slots ?? []) {
      if (canAccept(ext, cur, type, slot.name).ok) {
        return { parentId: cur, slot: slot.name, index: node.slots?.[slot.name]?.length ?? 0 };
      }
    }
    cur = findParent(ext, cur)?.parentId ?? null;
  }
  return null;
}

/** Explains why a component could not be inserted anywhere (shown as a toast). */
export function explainNoTarget(ext: Extension, type: string): string {
  const def = getComponent(type);
  if (!def) return `Unknown component ${type}`;
  if (def.overlay || def.slotOnly) {
    return `Select a button, link or image first — ${def.label} opens from it as an overlay.`;
  }
  if (def.parents?.length) {
    return `Select a ${listJoin(def.parents.map(typeLabel))} first — ${def.label} goes inside it.`;
  }
  return canAccept(ext, ext.rootId, type).reason ?? `${def.label} can't be added here.`;
}

/** Inserts a component where a palette click would put it. Returns the new node id or null. */
export function insertComponent(type: string, notify: Notify = noop): NodeId | null {
  const state = useEditor.getState();
  const ext = activeExt();
  const def = getComponent(type);
  if (!def) return null;
  const target = paletteInsertTarget(ext, state.selectedNodeId, type);
  if (!target) {
    notify(explainNoTarget(ext, type));
    return null;
  }
  const id = state.insertNode(type, target);
  if (!id) notify(`${def.label} can't be added here.`);
  return id;
}

/** Applies a drag payload at a target (palette item, block template or existing node). */
export function applyDropPayload(payload: DragPayload, target: InsertTarget, notify: Notify = noop): boolean {
  const state = useEditor.getState();
  const ext = activeExt();
  if (payload.kind === 'move') {
    const node = ext.nodes[payload.nodeId];
    if (!node) return false;
    if (node.locked) {
      notify(`“${node.name ?? typeLabel(node.type)}” is locked — unlock it to move it.`);
      return false;
    }
    const ok = state.moveNode(payload.nodeId, target);
    if (ok) state.select(payload.nodeId);
    return ok;
  }
  if (payload.kind === 'new') return state.insertNode(payload.componentType, target) !== null;
  // Block template: the block and the state it needs are added in one undo step (nothing for a
  // rejected drop).
  if (!canAccept(ext, target.parentId, payload.template.type, target.slot).ok) return false;
  const res = insertBlock(payload.template, payload.state, payload.label, target);
  if (!res.ok) notify(res.message);
  return res.ok;
}

// ---------------------------------------------------------------------------
// Node commands
// ---------------------------------------------------------------------------

function displayName(ext: Extension, id: NodeId): string {
  const node = ext.nodes[id];
  return node ? node.name ?? typeLabel(node.type) : 'Component';
}

/** Removes a node unless it is locked. */
export function removeNodeSafe(id: NodeId, notify: Notify = noop): boolean {
  const ext = activeExt();
  const node = ext.nodes[id];
  if (!node || id === ext.rootId) return false;
  if (node.locked) {
    notify(`“${displayName(ext, id)}” is locked — unlock it to delete it.`);
    return false;
  }
  useEditor.getState().removeNode(id);
  return true;
}

export function cutNodeSafe(id: NodeId, notify: Notify = noop): boolean {
  const ext = activeExt();
  const node = ext.nodes[id];
  if (!node || id === ext.rootId) return false;
  if (node.locked) {
    notify(`“${displayName(ext, id)}” is locked — unlock it to cut it.`);
    return false;
  }
  useEditor.getState().cutNode(id);
  return true;
}

export function duplicateNodeSafe(id: NodeId, notify: Notify = noop): NodeId | null {
  const ext = activeExt();
  if (!ext.nodes[id] || id === ext.rootId) return null;
  const node = ext.nodes[id];
  const ref = findParent(ext, id);
  // A slot with max 1 (overlay) cannot hold a duplicate.
  if (ref?.slot) {
    const check = canAccept(ext, ref.parentId, node.type, ref.slot);
    if (!check.ok) {
      notify(check.reason ?? `Can't duplicate ${displayName(ext, id)} here.`);
      return null;
    }
  }
  return useEditor.getState().duplicateNode(id);
}

export function wrapNodeSafe(id: NodeId, wrapperType: string, notify: Notify = noop): NodeId | null {
  const ext = activeExt();
  if (!ext.nodes[id] || id === ext.rootId) return null;
  if (ext.nodes[id].locked) {
    notify(`“${displayName(ext, id)}” is locked — unlock it to wrap it.`);
    return null;
  }
  const res = useEditor.getState().wrapNode(id, wrapperType);
  if (!res) notify(`Can't wrap ${displayName(ext, id)} in a ${typeLabel(wrapperType)} here.`);
  return res;
}

/**
 * Undo / redo that says when the step changed another extension than the one on screen (the
 * store switches to it so the change is visible).
 */
export function historyStep(kind: 'undo' | 'redo', notify: Notify = noop): void {
  const before = useEditor.getState().activeExtensionId;
  if (kind === 'undo') useEditor.getState().undo();
  else useEditor.getState().redo();
  const st = useEditor.getState();
  if (st.activeExtensionId !== before) {
    const ext = selectActiveExtension(st);
    notify(`${kind === 'undo' ? 'Undid' : 'Redid'} a change on “${ext.name || 'Untitled'}”`);
  }
}

export function pasteAt(afterId: NodeId | null | undefined, notify: Notify = noop): NodeId | null {
  const state = useEditor.getState();
  if (!state.clipboard) {
    notify('Nothing to paste — copy a component first.');
    return null;
  }
  const id = state.paste(afterId);
  if (!id) {
    const unavailable = unavailableComponents(activeExt(), state.clipboard);
    notify(
      unavailable.length
        ? `Can't paste ${typeLabel(state.clipboard.type)} here: it contains ${unavailable.join(', ')}, which ${unavailable.length === 1 ? 'isn’t' : 'aren’t'} available on this ${activeExt().kind === 'card' ? 'card location' : activeExt().kind === 'settings' ? 'settings page' : 'app home page'}.`
        : `Can't paste ${typeLabel(state.clipboard.type)} here.`,
    );
  }
  return id;
}

// ---------------------------------------------------------------------------
// Selection navigation
// ---------------------------------------------------------------------------

/** Escape: select the parent (the owner for slot content), or clear the selection at top level. */
export function selectParent(): void {
  const state = useEditor.getState();
  const id = state.selectedNodeId;
  if (!id) return;
  const ext = activeExt();
  const ref = findParent(ext, id);
  if (!ref || ref.parentId === ext.rootId) state.select(null);
  else state.select(ref.parentId);
}

/** Selects the parent if there is one below the root (ArrowLeft). Returns whether it moved. */
export function selectParentStrict(): boolean {
  const state = useEditor.getState();
  const id = state.selectedNodeId;
  if (!id) return false;
  const ext = activeExt();
  const ref = findParent(ext, id);
  if (!ref || ref.parentId === ext.rootId) return false;
  state.select(ref.parentId);
  return true;
}

function siblingsOf(ext: Extension, id: NodeId): { list: NodeId[]; index: number } | null {
  const ref = findParent(ext, id);
  if (!ref) return null;
  const parent = ext.nodes[ref.parentId];
  const list = ref.slot ? parent.slots?.[ref.slot] ?? [] : parent.children;
  return { list, index: ref.index };
}

/** Selects the previous (-1) or next (+1) sibling. With nothing selected, picks the first/last top-level node. */
export function selectSibling(delta: 1 | -1): boolean {
  const state = useEditor.getState();
  const ext = activeExt();
  const id = state.selectedNodeId;
  if (!id || !ext.nodes[id]) {
    const top = ext.nodes[ext.rootId].children;
    if (!top.length) return false;
    state.select(delta === 1 ? top[0] : top[top.length - 1]);
    return true;
  }
  const sib = siblingsOf(ext, id);
  if (!sib) return false;
  const next = sib.list[sib.index + delta];
  if (!next) return false;
  state.select(next);
  return true;
}

/** Selects the first child (or the first slot content) of the selection. */
export function selectFirstChild(): boolean {
  const state = useEditor.getState();
  const ext = activeExt();
  const id = state.selectedNodeId;
  if (!id || !ext.nodes[id]) return false;
  const node = ext.nodes[id];
  const first = node.children[0] ?? Object.values(node.slots ?? {}).find((ids) => ids.length > 0)?.[0];
  if (!first) return false;
  state.select(first);
  return true;
}

/** Moves the selection up (-1) or down (+1) among its siblings. */
export function moveSelectedAmongSiblings(delta: 1 | -1, notify: Notify = noop): boolean {
  const state = useEditor.getState();
  const ext = activeExt();
  const id = state.selectedNodeId;
  if (!id || !ext.nodes[id]) return false;
  if (ext.nodes[id].locked) {
    notify(`“${displayName(ext, id)}” is locked — unlock it to move it.`);
    return false;
  }
  const ref = findParent(ext, id);
  if (!ref) return false;
  const parent = ext.nodes[ref.parentId];
  const list = ref.slot ? parent.slots?.[ref.slot] ?? [] : parent.children;
  if (delta === -1 && ref.index === 0) return false;
  if (delta === 1 && ref.index >= list.length - 1) return false;
  // moveNode interprets the index before removal: +2 places it after the next sibling.
  const index = delta === -1 ? ref.index - 1 : ref.index + 2;
  return state.moveNode(id, { parentId: ref.parentId, slot: ref.slot, index });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * State variables a node subtree uses (bindings, expressions, templates, conditions, repeats and
 * action steps — never object keys or literal text). Shared with the canvas “Save as block”.
 */
export function stateVarsUsedBy(ext: Extension, id: NodeId): Array<Omit<StateVar, 'id'>> {
  return usedStateVars(ext, id);
}
