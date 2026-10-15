/**
 * Node commands shared by the canvas context menu, the selection quick toolbar and the
 * storyboard. Everything goes through store actions (undo history); these helpers only decide
 * what is allowed and compute targets.
 */
import { getComponent } from '../registry';
import { canAccept } from '../model/rules';
import { buildParentIndex, collectSubtree, findParent, nodeLabel } from '../model/tree';
import { findUsages } from '../panels/findUsages';
import { selectActiveExtension, useEditor } from '../model/store';
import { ROOT_TYPE, type Extension, type NodeId, type StateVar, type UINode } from '../model/types';
import { componentLabel } from './labels';

export const WRAPPER_TYPES = ['Flex', 'Box', 'Tile'] as const;
const OVERLAY_ORDER = ['Modal', 'Panel', 'Tooltip'];

export { componentLabel };

/** Layer-style label: name, or "<Component>: <text>". */
export function displayLabel(node: UINode): string {
  return nodeLabel(node, componentLabel(node.type));
}

export function isTextNode(node: UINode | undefined): boolean {
  return !!node && getComponent(node.type)?.children.mode === 'text';
}

export function isNodeContainer(node: UINode | undefined): boolean {
  return !!node && getComponent(node.type)?.children.mode === 'nodes';
}

export function activeExtension(): Extension {
  return selectActiveExtension(useEditor.getState());
}

/** Whether `id` can be wrapped in a new `wrapperType` container (mirrors store.wrapNode). */
export function canWrap(ext: Extension, id: NodeId, wrapperType: string): boolean {
  const node = ext.nodes[id];
  if (!node || node.locked) return false;
  const ref = findParent(ext, id);
  if (!ref || ref.slot) return false;
  if (!canAccept(ext, ref.parentId, wrapperType).ok) return false;
  const wrapper = getComponent(wrapperType);
  const child = getComponent(node.type);
  if (!wrapper || !child || wrapper.children.mode !== 'nodes') return false;
  if (wrapper.children.accepts && !wrapper.children.accepts.includes(node.type)) return false;
  if (child.parents && child.parents.length > 0 && !child.parents.includes(wrapperType)) return false;
  return true;
}

/** Overlay types that can be added to the node's empty `overlay` slot. */
export function addableOverlays(ext: Extension, id: NodeId): string[] {
  const node = ext.nodes[id];
  if (!node) return [];
  const slot = getComponent(node.type)?.slots?.find((s) => s.name === 'overlay');
  if (!slot || (node.slots?.overlay?.length ?? 0) > 0) return [];
  return OVERLAY_ORDER.filter((t) => slot.accepts.includes(t) && canAccept(ext, id, t, 'overlay').ok);
}

export interface NodeCapabilities {
  node: UINode;
  parentId: NodeId | null;
  /** Parent is a real component (not the extension root). */
  hasParentNode: boolean;
  inSlot: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** A copy fits next to the node (slots such as `overlay` hold a single node). */
  canDuplicate: boolean;
  locked: boolean;
  isText: boolean;
}

export function nodeCapabilities(ext: Extension, id: NodeId): NodeCapabilities | null {
  const node = ext.nodes[id];
  if (!node || node.type === ROOT_TYPE) return null;
  const ref = findParent(ext, id);
  const parent = ref ? ext.nodes[ref.parentId] : undefined;
  const list = ref && parent ? (ref.slot ? (parent.slots?.[ref.slot] ?? []) : parent.children) : [];
  const locked = !!node.locked;
  return {
    node,
    parentId: ref?.parentId ?? null,
    hasParentNode: !!ref && ref.parentId !== ext.rootId,
    inSlot: !!ref?.slot,
    canMoveUp: !!ref && !locked && ref.index > 0,
    canMoveDown: !!ref && !locked && ref.index < list.length - 1,
    canDuplicate: !!ref && canAccept(ext, ref.parentId, node.type, ref.slot).ok,
    locked,
    isText: isTextNode(node),
  };
}

/** Moves a node one position earlier (-1) or later (+1) among its siblings. */
export function moveSibling(id: NodeId, dir: -1 | 1): boolean {
  const ext = activeExtension();
  const caps = nodeCapabilities(ext, id);
  if (!caps || (dir < 0 ? !caps.canMoveUp : !caps.canMoveDown)) return false;
  const ref = findParent(ext, id);
  if (!ref) return false;
  // moveNode interprets the index against the list before removal.
  const index = dir < 0 ? ref.index - 1 : ref.index + 2;
  const ok = useEditor.getState().moveNode(id, { parentId: ref.parentId, index, ...(ref.slot ? { slot: ref.slot } : {}) });
  if (ok) useEditor.getState().select(id);
  return ok;
}

export function selectParent(id: NodeId): void {
  const ext = activeExtension();
  const ref = findParent(ext, id);
  if (!ref || ref.parentId === ext.rootId) return;
  useEditor.getState().select(ref.parentId);
}

/** Duplicates a node right after itself when a copy fits there. */
export function duplicateNode(id: NodeId): NodeId | null {
  const caps = nodeCapabilities(activeExtension(), id);
  if (!caps?.canDuplicate) return null;
  return useEditor.getState().duplicateNode(id);
}

/** Deletes a node unless it is locked. */
export function deleteNode(id: NodeId): boolean {
  const ext = activeExtension();
  const node = ext.nodes[id];
  if (!node || node.locked) return false;
  useEditor.getState().removeNode(id);
  return true;
}

export function addOverlay(id: NodeId, type: string): NodeId | null {
  return useEditor.getState().insertNode(type, { parentId: id, slot: 'overlay', index: 0 });
}

/**
 * State variables a node subtree needs when it is saved as a block: those its expressions,
 * `{{ }}` templates, conditions, repeats and action steps reference as identifiers (setters such as
 * `setCount` included), or that it binds / targets by name. Literal text, option values and object
 * keys never count (one scanner shared with "Find usages").
 */
export function usedStateVars(ext: Extension, nodeId: NodeId): Array<Omit<StateVar, 'id'>> {
  if (!ext.nodes[nodeId]) return [];
  const subtree = new Set(collectSubtree(ext, nodeId));
  return ext.state
    .filter((v) => findUsages(ext, v.name).some((u) => u.nodeId !== undefined && subtree.has(u.nodeId)))
    .map(({ id: _id, ...rest }) => rest);
}

/** Ancestor chain of a node, outermost first (root excluded), ending with the node itself. */
export function ancestorChain(ext: Extension, id: NodeId): NodeId[] {
  if (!ext.nodes[id]) return [];
  const index = buildParentIndex(ext);
  const out: NodeId[] = [id];
  let cur = index.get(id);
  while (cur && cur.parentId !== ext.rootId) {
    out.unshift(cur.parentId);
    cur = index.get(cur.parentId);
  }
  return out;
}

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

export function shortcut(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}
