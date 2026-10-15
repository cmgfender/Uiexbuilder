/**
 * Pure logic of the layers tree: flattening the node tree into visible rows (with "Overlay"
 * pseudo-rows for slot content) and resolving drop positions into store insert targets.
 */
import { buildParentIndex, type InsertTarget } from '../model/tree';
import { canAccept } from '../model/rules';
import type { Extension, NodeId } from '../model/types';
import { getComponent } from '../registry';

/** Nodes at a depth below this start expanded (root children are depth 0). */
export const DEFAULT_EXPAND_DEPTH = 3;

export interface LayerRow {
  /** Node id for node rows; `<ownerId>::<slot>` for slot pseudo-rows. */
  key: string;
  kind: 'node' | 'slot';
  /** The node (node rows) or the slot owner (slot rows). */
  nodeId: NodeId;
  /** Slot rows: the slot name. */
  slot?: string;
  depth: number;
  /** Node rows: where the node lives. */
  parent: { parentId: NodeId; slot?: string; index: number } | null;
  hasChildren: boolean;
  expanded: boolean;
}

export function slotRowKey(ownerId: NodeId, slot: string): string {
  return `${ownerId}::${slot}`;
}

export type ExpandOverrides = Record<string, boolean>;

export function isRowExpanded(overrides: ExpandOverrides, key: string, depth: number): boolean {
  return overrides[key] ?? depth < DEFAULT_EXPAND_DEPTH;
}

/** Visible rows of an extension's tree in display order. */
export function flattenLayers(ext: Extension, overrides: ExpandOverrides): LayerRow[] {
  const rows: LayerRow[] = [];
  const visitList = (ids: NodeId[], depth: number, parentId: NodeId, slot?: string) => {
    ids.forEach((id, index) => visitNode(id, depth, { parentId, slot, index }));
  };
  const visitNode = (id: NodeId, depth: number, parent: LayerRow['parent']) => {
    const node = ext.nodes[id];
    if (!node) return;
    const slots = Object.entries(node.slots ?? {}).filter(([, ids]) => ids.length > 0);
    const hasChildren = node.children.length > 0 || slots.length > 0;
    const expanded = hasChildren && isRowExpanded(overrides, id, depth);
    rows.push({ key: id, kind: 'node', nodeId: id, depth, parent, hasChildren, expanded });
    if (!expanded) return;
    visitList(node.children, depth + 1, id);
    for (const [slot, ids] of slots) {
      const key = slotRowKey(id, slot);
      const slotExpanded = isRowExpanded(overrides, key, depth + 1);
      rows.push({ key, kind: 'slot', nodeId: id, slot, depth: depth + 1, parent: null, hasChildren: true, expanded: slotExpanded });
      if (slotExpanded) visitList(ids, depth + 2, id, slot);
    }
  };
  const root = ext.nodes[ext.rootId];
  if (root) visitList(root.children, 0, ext.rootId);
  return rows;
}

/** Row keys that must be expanded for `id` to be visible (its ancestors and slot pseudo-rows). */
export function ancestorRowKeys(ext: Extension, id: NodeId): string[] {
  const index = buildParentIndex(ext);
  const keys: string[] = [];
  let ref = index.get(id);
  while (ref) {
    if (ref.slot) keys.push(slotRowKey(ref.parentId, ref.slot));
    if (ref.parentId !== ext.rootId) keys.push(ref.parentId);
    ref = index.get(ref.parentId);
  }
  return keys;
}

/** Label of a slot pseudo-row (registry slot label, e.g. "Overlay"). */
export function slotLabel(ext: Extension, ownerId: NodeId, slot: string): string {
  const owner = ext.nodes[ownerId];
  const def = owner ? getComponent(owner.type) : undefined;
  return def?.slots?.find((s) => s.name === slot)?.label ?? slot.charAt(0).toUpperCase() + slot.slice(1);
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

export type DropPosition = 'before' | 'after' | 'inside';

export interface LayerDrop {
  rowKey: string;
  position: DropPosition;
  target: InsertTarget;
  ok: boolean;
  reason?: string;
  /** Indentation depth of the indicator line (before/after). */
  depth: number;
}

/** Zone of a row hit by the pointer: top 30% before, bottom 30% after, middle inside. */
export function zoneForOffset(ratio: number, allowInside: boolean): DropPosition {
  if (allowInside) {
    if (ratio < 0.3) return 'before';
    if (ratio > 0.7) return 'after';
    return 'inside';
  }
  return ratio < 0.5 ? 'before' : 'after';
}

/** First slot of `ownerId` that accepts `type` (with room), as an insert target. */
function slotTargetFor(ext: Extension, ownerId: NodeId, type: string, movingId?: NodeId): InsertTarget | null {
  const owner = ext.nodes[ownerId];
  const def = owner ? getComponent(owner.type) : undefined;
  for (const slot of def?.slots ?? []) {
    if (canAccept(ext, ownerId, type, slot.name, movingId).ok) {
      const list = owner.slots?.[slot.name] ?? [];
      return { parentId: ownerId, slot: slot.name, index: list.filter((x) => x !== movingId).length };
    }
  }
  return null;
}

/**
 * Resolves where a drag of `type` over `row` (at vertical `ratio` 0..1 of its height) would drop.
 * `movingId` is the dragged node when reordering existing nodes.
 */
export function resolveLayerDrop(
  ext: Extension,
  row: LayerRow,
  ratio: number,
  type: string,
  movingId?: NodeId,
): LayerDrop {
  if (row.kind === 'slot') {
    const owner = ext.nodes[row.nodeId];
    const list = owner?.slots?.[row.slot!] ?? [];
    const target: InsertTarget = { parentId: row.nodeId, slot: row.slot, index: list.length };
    const check = canAccept(ext, row.nodeId, type, row.slot, movingId);
    return { rowKey: row.key, position: 'inside', target, ok: check.ok, reason: check.reason, depth: row.depth + 1 };
  }

  const node = ext.nodes[row.nodeId];
  const inside = canAccept(ext, row.nodeId, type, undefined, movingId);
  const slotTarget = inside.ok ? null : slotTargetFor(ext, row.nodeId, type, movingId);
  const position = zoneForOffset(ratio, inside.ok || !!slotTarget);

  if (position === 'inside') {
    const target: InsertTarget = slotTarget ?? { parentId: row.nodeId, index: node.children.length };
    return { rowKey: row.key, position, target, ok: true, depth: row.depth + 1 };
  }

  // Dropping below an expanded container that shows children: insert as its first child.
  if (position === 'after' && row.expanded && node.children.length > 0 && inside.ok) {
    return { rowKey: row.key, position, target: { parentId: row.nodeId, index: 0 }, ok: true, depth: row.depth + 1 };
  }

  const p = row.parent!;
  const target: InsertTarget = { parentId: p.parentId, slot: p.slot, index: position === 'before' ? p.index : p.index + 1 };
  const check = canAccept(ext, p.parentId, type, p.slot, movingId);
  // Re-dropping a node next to itself is a harmless no-op.
  return { rowKey: row.key, position, target, ok: check.ok, reason: check.reason, depth: row.depth };
}

/** Target for dropping into the empty area below the rows: the end of the root. */
export function resolveRootDrop(ext: Extension, type: string, movingId?: NodeId): { target: InsertTarget; ok: boolean; reason?: string } {
  const root = ext.nodes[ext.rootId];
  const check = canAccept(ext, ext.rootId, type, undefined, movingId);
  return { target: { parentId: ext.rootId, index: root.children.length }, ok: check.ok, reason: check.reason };
}

/** Index of the next / previous selectable (node) row from `fromIndex`. */
export function nextNodeRowIndex(rows: LayerRow[], fromIndex: number, delta: 1 | -1): number {
  for (let i = fromIndex + delta; i >= 0 && i < rows.length; i += delta) {
    if (rows[i].kind === 'node') return i;
  }
  return -1;
}
