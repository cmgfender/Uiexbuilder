/**
 * Pure drag & drop target computation for the canvas.
 *
 * The DOM adapter (./domHit.ts) turns the element under the pointer into a "hit chain": the node
 * element under the pointer and its rendered node ancestors (deepest first), each with its rect,
 * its rendered children's rects and the layout axis of those children. This module turns a hit
 * chain + pointer into an `InsertTarget` using only rects and a small model interface, so every
 * rule is unit-testable without a browser:
 *
 *  (a) over an empty-container placeholder        -> inside that parent / slot;
 *  (b) over a container that accepts the type     -> index among its children (pointer vs. child
 *                                                    rects along the container's main axis);
 *  (c) near the edge (8px) of a node, or over a   -> before / after it in its parent, along the
 *      non-container                                 parent's axis;
 *  (d) dragging an overlay type (Modal/Panel/     -> the trigger's `overlay` slot ("Attach as
 *      Tooltip) over a component with an overlay     overlay");
 *      slot
 *  ...walking up the ancestors until `accept()` passes. If nothing accepts, the result carries the
 *  most specific rejection reason.
 */
import { buildParentIndex, isAncestor, type InsertTarget } from '../model/tree';
import { canAccept, isAvailableIn, isContainerType, type AcceptResult } from '../model/rules';
import { getComponent } from '../registry';
import type { Extension, NodeId } from '../model/types';
import { captionedLabel, componentLabel } from './labels';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How a container lays out its children:
 *  - 'vertical'   stacked top to bottom (block flow, flex column, table body rows)
 *  - 'horizontal' left to right on one line (flex row, table row cells)
 *  - 'grid'       2-D flow (CSS grid, wrapping flex rows, inline flow)
 */
export type Axis = 'vertical' | 'horizontal' | 'grid';

/** Distance (px) from a node's edge within which a drop goes before/after it rather than inside. */
export const EDGE_ZONE = 8;

export interface ChildBox {
  id: NodeId;
  rect: Rect;
}

/** One rendered node (or the extension root) under the pointer. */
export interface HitLevel {
  nodeId: NodeId;
  rect: Rect;
  /** Rendered children of this element, in DOM order (one box per child node). */
  readonly children: ChildBox[];
  /** Layout axis of the children. */
  readonly childAxis: Axis;
}

/** What the target computation needs to know about the document. */
export interface DropModel {
  rootId: NodeId;
  /** Type being dropped. */
  type: string;
  /** Node being moved (moves only). */
  movingId?: NodeId | null;
  /** The dragged type is a Modal / Panel / Tooltip (only attachable to an `overlay` slot). */
  isOverlayType: boolean;
  parentOf(id: NodeId): { parentId: NodeId; slot?: string; index: number } | null;
  /** Model order of a parent's children (or slot content). */
  childIds(parentId: NodeId, slot?: string): NodeId[];
  isContainer(id: NodeId): boolean;
  /** The node's component declares an `overlay` slot. */
  hasOverlaySlot(id: NodeId): boolean;
  /** canAccept() for the dragged type (and moving node). */
  accept(parentId: NodeId, slot?: string): AcceptResult;
}

export interface PlaceholderHit {
  parentId: NodeId;
  slot?: string;
  rect: Rect;
}

export interface DropQuery {
  point: Point;
  /** Deepest first. Ends with the root level when the pointer is over the card. */
  chain: HitLevel[];
  placeholder?: PlaceholderHit | null;
  edge?: number;
}

export interface DropAccepted {
  ok: true;
  target: InsertTarget;
  /** 'line' = insertion bar between siblings, 'inside' = highlight an (empty) container or slot. */
  mode: 'line' | 'inside';
  /** Orientation of the insertion bar. */
  orientation: 'horizontal' | 'vertical';
  /** Bar or highlight rect (same coordinate space as the inputs). */
  rect: Rect;
  /** Optional hint shown with the indicator (e.g. "Attach as overlay"). */
  label?: string;
}

export interface DropRejected {
  ok: false;
  /** Why nothing accepts the drop here ('' when nothing is under the pointer). */
  reason: string;
  /** The element the pointer is over (for the rejection outline). */
  rect: Rect | null;
}

export type DropResult = DropAccepted | DropRejected;

export const ATTACH_OVERLAY_LABEL = 'Attach as overlay';
const BAR = 2;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;
const centerX = (r: Rect) => r.left + r.width / 2;
const centerY = (r: Rect) => r.top + r.height / 2;

export function unionRect(a: Rect, b: Rect): Rect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return { left, top, width: Math.max(right(a), right(b)) - left, height: Math.max(bottom(a), bottom(b)) - top };
}

export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= right(r) && p.y >= r.top && p.y <= bottom(r);
}

function distanceSq(r: Rect, p: Point): number {
  const dx = Math.max(r.left - p.x, 0, p.x - right(r));
  const dy = Math.max(r.top - p.y, 0, p.y - bottom(r));
  return dx * dx + dy * dy;
}

const overlapsX = (a: Rect, b: Rect) => a.left < right(b) && b.left < right(a);
const overlapsY = (a: Rect, b: Rect) => a.top < bottom(b) && b.top < bottom(a);

// ---------------------------------------------------------------------------
// Axis detection
// ---------------------------------------------------------------------------

export interface LayoutStyle {
  display: string;
  flexDirection?: string;
  flexWrap?: string;
  /** Tag name of the element that directly contains the children (fallback for table parts). */
  tagName?: string;
}

/** Layout axis of an element's children, from its computed style. */
export function detectAxis(style: LayoutStyle): Axis {
  const display = (style.display || '').trim().toLowerCase();
  const tag = (style.tagName || '').toUpperCase();
  if (display === 'flex' || display === 'inline-flex') {
    const dir = (style.flexDirection || 'row').trim().toLowerCase();
    if (dir.startsWith('column')) return 'vertical';
    const wrap = (style.flexWrap || 'nowrap').trim().toLowerCase();
    return wrap === 'nowrap' ? 'horizontal' : 'grid';
  }
  if (display === 'grid' || display === 'inline-grid') return 'grid';
  if (display === 'table-row' || (!display && tag === 'TR')) return 'horizontal';
  if (
    display === 'table' ||
    display === 'inline-table' ||
    display === 'table-row-group' ||
    display === 'table-header-group' ||
    display === 'table-footer-group'
  ) {
    return 'vertical';
  }
  if (tag === 'TR') return 'horizontal';
  return 'vertical';
}

/**
 * Infers an axis from the children's rects when the style is not conclusive (block containers
 * whose children are inline / floated). Returns null with fewer than two measurable children.
 */
export function inferAxisFromRects(rects: Rect[]): Axis | null {
  const boxes = rects.filter((r) => r.width > 0 || r.height > 0);
  if (boxes.length < 2) return null;
  let sameLine = 0;
  let stacked = 0;
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    if (overlapsY(a, b) && b.left >= right(a) - 1) sameLine++;
    else stacked++;
  }
  if (sameLine === 0) return 'vertical';
  return stacked === 0 ? 'horizontal' : 'grid';
}

// ---------------------------------------------------------------------------
// Placement among siblings
// ---------------------------------------------------------------------------

export interface Side {
  before: boolean;
  /** Orientation of the insertion bar for this side. */
  orientation: 'horizontal' | 'vertical';
}

/** Whether the pointer is in the first ("before") or second half of `rect` along `axis`. */
export function sideOf(point: Point, rect: Rect, axis: Axis): Side {
  if (axis === 'vertical') return { before: point.y < centerY(rect), orientation: 'horizontal' };
  if (axis === 'horizontal') return { before: point.x < centerX(rect), orientation: 'vertical' };
  // Grid: above / below the item -> previous / next row; on the item's row -> left / right half.
  if (point.y < rect.top) return { before: true, orientation: 'horizontal' };
  if (point.y > bottom(rect)) return { before: false, orientation: 'horizontal' };
  return { before: point.x < centerX(rect), orientation: 'vertical' };
}

/** True when the pointer is within `edge` px of the node's edges along `axis`. */
export function inEdgeZone(point: Point, rect: Rect, axis: Axis, edge = EDGE_ZONE): boolean {
  const ey = Math.min(edge, rect.height / 4);
  const ex = Math.min(edge, rect.width / 4);
  const nearY = point.y - rect.top < ey || bottom(rect) - point.y < ey;
  const nearX = point.x - rect.left < ex || right(rect) - point.x < ex;
  if (axis === 'vertical') return nearY;
  if (axis === 'horizontal') return nearX;
  return nearX || nearY;
}

interface OrderedBox extends ChildBox {
  /** Index in the model's children list. */
  index: number;
}

/** Rendered children that exist in the model list, sorted by model order. */
export function orderVisible(children: ChildBox[], modelIds: NodeId[]): OrderedBox[] {
  const pos = new Map(modelIds.map((id, i) => [id, i]));
  // Hidden children (inactive tab panels, collapsed sections) measure 0x0; ignore them unless
  // nothing is measurable at all (e.g. layout-less environments).
  const measurable = children.some((c) => c.rect.width > 0 || c.rect.height > 0);
  const out: OrderedBox[] = [];
  const seen = new Set<NodeId>();
  for (const c of children) {
    const index = pos.get(c.id);
    if (index === undefined || seen.has(c.id)) continue;
    if (measurable && c.rect.width <= 0 && c.rect.height <= 0) continue;
    seen.add(c.id);
    out.push({ ...c, index });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Insertion bar next to `anchor` on `side`. When the neighbouring sibling on that side sits on the
 * same line (stacked for horizontal bars, same row for vertical bars) the bar is centred in the gap.
 */
export function barRect(anchor: Rect, side: Side, neighbour?: Rect | null): Rect {
  if (side.orientation === 'horizontal') {
    let y = side.before ? anchor.top : bottom(anchor);
    let left = anchor.left;
    let width = anchor.width;
    if (neighbour && overlapsX(anchor, neighbour)) {
      y = side.before ? (bottom(neighbour) + anchor.top) / 2 : (bottom(anchor) + neighbour.top) / 2;
      left = Math.min(anchor.left, neighbour.left);
      width = Math.max(right(anchor), right(neighbour)) - left;
    }
    return { left, top: y - BAR / 2, width, height: BAR };
  }
  let x = side.before ? anchor.left : right(anchor);
  let top = anchor.top;
  let height = anchor.height;
  if (neighbour && overlapsY(anchor, neighbour)) {
    x = side.before ? (right(neighbour) + anchor.left) / 2 : (right(anchor) + neighbour.left) / 2;
    top = Math.min(anchor.top, neighbour.top);
    height = Math.max(bottom(anchor), bottom(neighbour)) - top;
  }
  return { left: x - BAR / 2, top, width: BAR, height };
}

export interface Placement {
  /** Insert index in the model list. */
  index: number;
  /** Insertion bar, or null when there is no rendered child to position against. */
  line: Rect | null;
  orientation: 'horizontal' | 'vertical';
}

/** Index among a container's rendered children for a pointer position. */
export function placeAmong(children: ChildBox[], modelIds: NodeId[], axis: Axis, point: Point): Placement {
  const visible = orderVisible(children, modelIds);
  if (visible.length === 0) return { index: modelIds.length, line: null, orientation: 'horizontal' };

  let anchorPos: number;
  let side: Side;
  if (axis === 'grid') {
    // Row-major: prefer items on the pointer's row, then the nearest item overall.
    anchorPos = 0;
    let best = Infinity;
    const onRow = visible.some((c) => point.y >= c.rect.top && point.y <= bottom(c.rect));
    visible.forEach((c, i) => {
      if (onRow && (point.y < c.rect.top || point.y > bottom(c.rect))) return;
      const d = distanceSq(c.rect, point);
      if (d < best) {
        best = d;
        anchorPos = i;
      }
    });
    side = sideOf(point, visible[anchorPos].rect, 'grid');
  } else {
    const firstAfter = visible.findIndex((c) => (axis === 'vertical' ? point.y < centerY(c.rect) : point.x < centerX(c.rect)));
    if (firstAfter === -1) {
      anchorPos = visible.length - 1;
      side = { before: false, orientation: axis === 'vertical' ? 'horizontal' : 'vertical' };
    } else {
      anchorPos = firstAfter;
      side = { before: true, orientation: axis === 'vertical' ? 'horizontal' : 'vertical' };
    }
  }
  const anchor = visible[anchorPos];
  const neighbour = visible[anchorPos + (side.before ? -1 : 1)];
  return {
    index: anchor.index + (side.before ? 0 : 1),
    line: barRect(anchor.rect, side, neighbour?.rect),
    orientation: side.orientation,
  };
}

// ---------------------------------------------------------------------------
// Target computation
// ---------------------------------------------------------------------------

const GENERIC_REJECTION = 'This component cannot be dropped here';

export function computeDropTarget(query: DropQuery, model: DropModel): DropResult {
  const edge = query.edge ?? EDGE_ZONE;
  const { point } = query;
  let chain = query.chain;
  let placeholder = query.placeholder ?? null;

  // A node can't be dropped into its own subtree: treat the moving node as the deepest hit.
  if (model.movingId) {
    const at = chain.findIndex((l) => l.nodeId === model.movingId);
    if (at > 0) {
      chain = chain.slice(at);
      placeholder = null;
    } else if (at === 0 && placeholder?.parentId === model.movingId) {
      placeholder = null;
    }
  }
  if (chain.length === 0) return { ok: false, reason: '', rect: null };

  const first = chain[0];
  const isRoot = (id: NodeId) => id === model.rootId;
  let reason: string | undefined;
  const note = (r: AcceptResult) => {
    if (!r.ok && reason === undefined) reason = r.reason ?? GENERIC_REJECTION;
  };
  const reject = (): DropRejected => ({ ok: false, reason: reason ?? GENERIC_REJECTION, rect: first.rect });

  // (d) Overlays attach to the nearest trigger with an overlay slot.
  if (model.isOverlayType) {
    for (const level of chain) {
      if (isRoot(level.nodeId)) break;
      if (!model.hasOverlaySlot(level.nodeId)) continue;
      const r = model.accept(level.nodeId, 'overlay');
      if (r.ok) {
        return {
          ok: true,
          target: { parentId: level.nodeId, slot: 'overlay', index: 0 },
          mode: 'inside',
          orientation: 'horizontal',
          rect: level.rect,
          label: ATTACH_OVERLAY_LABEL,
        };
      }
      note(r);
    }
    if (reason === undefined) note(model.accept(model.rootId));
    return reject();
  }

  const parentLevel = (i: number): HitLevel | null => {
    const ref = model.parentOf(chain[i].nodeId);
    const up = chain[i + 1];
    return ref && up && up.nodeId === ref.parentId && !ref.slot ? up : null;
  };
  const parentAxis = (i: number): Axis => parentLevel(i)?.childAxis ?? 'vertical';

  const inside = (i: number): DropAccepted | null => {
    const level = chain[i];
    if (!isRoot(level.nodeId) && !model.isContainer(level.nodeId)) return null;
    const r = model.accept(level.nodeId);
    if (!r.ok) {
      note(r);
      return null;
    }
    const placement = placeAmong(level.children, model.childIds(level.nodeId), level.childAxis, point);
    if (!placement.line) {
      return { ok: true, target: { parentId: level.nodeId, index: placement.index }, mode: 'inside', orientation: 'horizontal', rect: level.rect };
    }
    return {
      ok: true,
      target: { parentId: level.nodeId, index: placement.index },
      mode: 'line',
      orientation: placement.orientation,
      rect: placement.line,
    };
  };

  const beside = (i: number): DropAccepted | null => {
    const level = chain[i];
    const ref = model.parentOf(level.nodeId);
    if (!ref) return null;
    const r = model.accept(ref.parentId, ref.slot);
    if (!r.ok) {
      note(r);
      return null;
    }
    const up = parentLevel(i);
    const side = sideOf(point, level.rect, up?.childAxis ?? 'vertical');
    let neighbour: Rect | null = null;
    if (up) {
      const siblings = orderVisible(up.children, model.childIds(ref.parentId, ref.slot));
      const at = siblings.findIndex((s) => s.id === level.nodeId);
      if (at !== -1) neighbour = siblings[at + (side.before ? -1 : 1)]?.rect ?? null;
    }
    const target: InsertTarget = { parentId: ref.parentId, index: ref.index + (side.before ? 0 : 1) };
    if (ref.slot) target.slot = ref.slot;
    return { ok: true, target, mode: 'line', orientation: side.orientation, rect: barRect(level.rect, side, neighbour) };
  };

  const attempts: Array<() => DropAccepted | null> = [];
  if (placeholder) {
    const ph = placeholder;
    const insidePlaceholder = (): DropAccepted | null => {
      const r = model.accept(ph.parentId, ph.slot);
      if (!r.ok) {
        note(r);
        return null;
      }
      const target: InsertTarget = { parentId: ph.parentId, index: 0 };
      if (ph.slot) target.slot = ph.slot;
      return { ok: true, target, mode: 'inside', orientation: 'horizontal', rect: ph.rect };
    };
    const ownsPlaceholder = first.nodeId === ph.parentId;
    const nearEdge = ownsPlaceholder && !isRoot(first.nodeId) && inEdgeZone(point, first.rect, parentAxis(0), edge);
    if (nearEdge) attempts.push(() => beside(0), insidePlaceholder);
    else attempts.push(insidePlaceholder);
    if (!nearEdge && !isRoot(first.nodeId)) attempts.push(() => beside(0));
  } else if (isRoot(first.nodeId)) {
    attempts.push(() => inside(0));
  } else {
    const container = model.isContainer(first.nodeId);
    const nearEdge = inEdgeZone(point, first.rect, parentAxis(0), edge);
    if (container && !nearEdge) attempts.push(() => inside(0), () => beside(0));
    else if (container) attempts.push(() => beside(0), () => inside(0));
    else attempts.push(() => beside(0));
  }
  // Walk up: before / after each ancestor in its own parent.
  for (let i = 1; i < chain.length; i++) {
    const prevRef = model.parentOf(chain[i - 1].nodeId);
    // Slot content (overlays in the storyboard) never spills into the trigger's parent.
    if (!prevRef || prevRef.slot) break;
    // Inside the root at this position == beside the top-level node: already tried.
    if (isRoot(chain[i].nodeId)) break;
    const at = i;
    attempts.push(() => beside(at));
  }

  for (const attempt of attempts) {
    const result = attempt();
    if (result) return result;
  }
  return reject();
}

// ---------------------------------------------------------------------------
// Model adapter
// ---------------------------------------------------------------------------

/**
 * Why `type` can't go into `parentId`'s `slot` when the only problem is that the slot is already
 * full (e.g. a trigger's single `overlay`): names the occupant so the user knows what to remove.
 * Null when the slot has room or does not accept the type at all.
 */
export function fullSlotReason(ext: Extension, parentId: NodeId, slot: string, type: string, movingId?: NodeId | null): string | null {
  const parent = ext.nodes[parentId];
  const childDef = getComponent(type);
  const slotDef = parent ? getComponent(parent.type)?.slots?.find((s) => s.name === slot) : undefined;
  if (!parent || !childDef || !slotDef || slotDef.max === undefined || !slotDef.accepts.includes(type)) return null;
  // Other reasons canAccept checks first take precedence.
  if (!isAvailableIn(childDef, ext)) return null;
  if (movingId && (movingId === parentId || isAncestor(ext, movingId, parentId))) return null;
  const current = (parent.slots?.[slot] ?? []).filter((id) => id !== movingId);
  if (current.length < slotDef.max) return null;
  const occupant = ext.nodes[current[0]];
  const what = occupant ? captionedLabel(occupant) : 'another component';
  if (slot === 'overlay') {
    return `${captionedLabel(parent)} already has an overlay (${what}) — remove it first to attach a ${componentLabel(type)}`;
  }
  return `${captionedLabel(parent)}’s ${slotDef.label.toLowerCase()} already holds ${what} — remove it first`;
}

/** Builds the DropModel for dropping `type` (or moving `movingId`) into an extension. */
export function createDropModel(ext: Extension, type: string, movingId?: NodeId | null): DropModel {
  const parents = buildParentIndex(ext);
  const def = getComponent(type);
  return {
    rootId: ext.rootId,
    type,
    movingId: movingId ?? null,
    isOverlayType: !!def && (!!def.overlay || !!def.slotOnly),
    parentOf: (id) => parents.get(id) ?? null,
    childIds: (parentId, slot) => {
      const node = ext.nodes[parentId];
      if (!node) return [];
      return slot ? (node.slots?.[slot] ?? []) : node.children;
    },
    isContainer: (id) => {
      const node = ext.nodes[id];
      return !!node && isContainerType(node.type);
    },
    hasOverlaySlot: (id) => {
      const node = ext.nodes[id];
      return !!node && !!getComponent(node.type)?.slots?.some((s) => s.name === 'overlay');
    },
    accept: (parentId, slot) => {
      const r = canAccept(ext, parentId, type, slot, movingId ?? undefined);
      if (r.ok || !slot) return r;
      // canAccept checks the slot's type list before its capacity, so this only rewords "full".
      return { ok: false, reason: fullSlotReason(ext, parentId, slot, type, movingId) ?? r.reason };
    },
  };
}
