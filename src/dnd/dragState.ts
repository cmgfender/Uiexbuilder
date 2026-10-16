/**
 * Drag & drop contract shared by the palette, templates panel, layers tree and canvas.
 *
 * We use native HTML5 drag & drop. Because `dataTransfer` contents are not readable during
 * `dragover`, the active payload is also kept in this small store. Drop targets compute an
 * `InsertTarget` and validate it with `canAccept` (src/model/rules.ts) using `payloadType()`.
 */
import { create } from 'zustand';
import type { DragEvent as ReactDragEvent } from 'react';
import type { InsertTarget } from '../model/tree';
import { findParent } from '../model/tree';
import { canAccept } from '../model/rules';
import type { DataSource, Extension, NodeId, NodeTemplate, StateVar, UINode } from '../model/types';
import { getComponent } from '../registry';

export const DND_MIME = 'application/x-uiex-dnd';

export type DragPayload =
  /** A new component from the palette (inserted with its registry `create()` template). */
  | { kind: 'new'; componentType: string }
  /**
   * A prebuilt block / snippet. `state` lists state variables the block relies on; the drop
   * handler adds any that the extension does not already have (matched by name).
   */
  | {
      kind: 'template';
      template: NodeTemplate;
      label: string;
      state?: Array<Omit<StateVar, 'id'>>;
      /** Data sources the block reads (e.g. "Associated records"), added with it (additive). */
      dataSources?: DataSource[];
    }
  /** An existing node being moved. */
  | { kind: 'move'; nodeId: NodeId };

/** Visual drop indicator, in viewport coordinates (canvas converts as needed). */
export interface DropIndicator {
  target: InsertTarget;
  /** 'line' = insertion bar between siblings, 'inside' = highlight an (empty) container or slot. */
  mode: 'line' | 'inside';
  /** For 'line': orientation of the bar ('horizontal' in column layouts). */
  orientation: 'horizontal' | 'vertical';
  rect: { left: number; top: number; width: number; height: number };
  /** Message when the drop would be rejected (shown near the pointer). */
  rejectReason?: string;
  /** Optional hint shown with the indicator, e.g. "Attach as overlay" (additive). */
  label?: string;
  /** Which drop surface computed the indicator, e.g. 'canvas' or 'layers' (additive). */
  source?: string;
}

interface DragState {
  payload: DragPayload | null;
  indicator: DropIndicator | null;
  setPayload: (payload: DragPayload | null) => void;
  setIndicator: (indicator: DropIndicator | null) => void;
}

export const useDragStore = create<DragState>()((set, get) => ({
  payload: null,
  indicator: null,
  setPayload: (payload) => set({ payload, indicator: payload ? get().indicator : null }),
  setIndicator: (indicator) => {
    const cur = get().indicator;
    if (
      cur &&
      indicator &&
      cur.mode === indicator.mode &&
      cur.target.parentId === indicator.target.parentId &&
      cur.target.index === indicator.target.index &&
      cur.target.slot === indicator.target.slot &&
      cur.rect.left === indicator.rect.left &&
      cur.rect.top === indicator.rect.top &&
      cur.rect.width === indicator.rect.width &&
      cur.rect.height === indicator.rect.height &&
      cur.rejectReason === indicator.rejectReason &&
      cur.label === indicator.label &&
      cur.source === indicator.source
    ) {
      return;
    }
    if (cur === indicator) return;
    set({ indicator });
  },
}));

/** Starts a drag: writes the payload to dataTransfer and the store. */
export function startDrag(e: ReactDragEvent, payload: DragPayload, dragImageLabel?: string): void {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  // Some browsers require text/plain for drag to start.
  e.dataTransfer.setData('text/plain', payload.kind === 'move' ? payload.nodeId : payload.kind === 'new' ? payload.componentType : payload.label);
  e.dataTransfer.effectAllowed = payload.kind === 'move' ? 'move' : 'copy';
  if (dragImageLabel && typeof document !== 'undefined') {
    const ghost = document.createElement('div');
    ghost.textContent = dragImageLabel;
    ghost.style.cssText =
      'position:fixed;top:-1000px;left:-1000px;padding:4px 10px;border-radius:6px;background:#2f6bff;color:#fff;font:600 12px Inter,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.2);';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  }
  useDragStore.getState().setPayload(payload);
}

/** Ends a drag (call from dragend and after drop). */
export function endDrag(): void {
  useDragStore.getState().setPayload(null);
  useDragStore.getState().setIndicator(null);
}

/** Reads the payload during drop (falls back to the store). */
export function readPayload(e: ReactDragEvent | DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer?.getData(DND_MIME);
    if (raw) return JSON.parse(raw) as DragPayload;
  } catch {
    /* ignore */
  }
  return useDragStore.getState().payload;
}

/** Whether a drag event carries one of our payloads. */
export function isOurDrag(e: ReactDragEvent | DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(DND_MIME);
}

/** The component type a payload would insert (for canAccept checks). */
export function payloadType(payload: DragPayload, ext: Extension): string | null {
  if (payload.kind === 'new') return payload.componentType;
  if (payload.kind === 'template') return payload.template.type;
  return ext.nodes[payload.nodeId]?.type ?? null;
}

/** Containers a Form typically wraps its fields in (click-to-add goes inside them). */
const FORM_WRAPPERS = new Set(['Flex', 'Box']);
/** Button-like components that make up a form's action area. */
const ACTION_TYPES = new Set(['Button', 'LoadingButton', 'ButtonRow']);
/** Containers that may hold a form's action buttons (e.g. Submit and Cancel side by side). */
const ACTION_GROUPS = new Set(['ButtonRow', 'Flex', 'Inline', 'Box']);

function isSubmitOrReset(node: UINode | undefined): boolean {
  if (!node || (node.type !== 'Button' && node.type !== 'LoadingButton')) return false;
  const t = node.props.type;
  return t === 'submit' || t === 'reset';
}

/** A submit / reset button, or a group of buttons containing one (ButtonRow, a row of buttons). */
function isFormAction(ext: Extension, node: UINode | undefined): boolean {
  if (!node) return false;
  if (isSubmitOrReset(node)) return true;
  if (!ACTION_GROUPS.has(node.type) || node.children.length === 0) return false;
  const kids = node.children.map((id) => ext.nodes[id]);
  return kids.every((k) => !!k && ACTION_TYPES.has(k.type)) && kids.some(isSubmitOrReset);
}

function isButtonLike(ext: Extension, node: UINode | undefined): boolean {
  return !!node && (ACTION_TYPES.has(node.type) || isFormAction(ext, node));
}

/**
 * Index where a form's trailing action area (its last submit / reset button and the buttons right
 * before it, e.g. Cancel) starts among `parentId`'s children, or -1 when it has none.
 */
export function formActionsStart(ext: Extension, parentId: NodeId): number {
  const children = ext.nodes[parentId]?.children ?? [];
  let last = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    if (isFormAction(ext, ext.nodes[children[i]])) {
      last = i;
      break;
    }
  }
  if (last === -1) return -1;
  let start = last;
  while (start > 0 && isButtonLike(ext, ext.nodes[children[start - 1]])) start--;
  return start;
}

function insideForm(ext: Extension, id: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur) {
    if (ext.nodes[cur]?.type === 'Form') return true;
    const ref = findParent(ext, cur);
    if (!ref || ref.slot) return false;
    cur = ref.parentId;
  }
  return false;
}

/**
 * Inside a form, new fields and content go before the trailing submit / reset buttons rather
 * than after them (buttons themselves still go where they were asked to).
 */
function beforeFormActions(ext: Extension, target: InsertTarget, type: string): InsertTarget {
  if (target.slot || ACTION_TYPES.has(type) || !insideForm(ext, target.parentId)) return target;
  const start = formActionsStart(ext, target.parentId);
  return start !== -1 && target.index > start ? { ...target, index: start } : target;
}

/**
 * Click-to-add into a Form: the Form's fields usually live in a layout Flex (the registry
 * template is Form > Flex > [fields…, Submit]), so the new component joins them — before the
 * submit / reset buttons — instead of landing after the Flex.
 */
function intoForm(ext: Extension, formId: NodeId, type: string): InsertTarget {
  let target = beforeFormActions(ext, { parentId: formId, index: ext.nodes[formId].children.length }, type);
  for (let depth = 0; depth < 4; depth++) {
    const parent = ext.nodes[target.parentId];
    const prev = target.index > 0 ? ext.nodes[parent.children[target.index - 1]] : undefined;
    if (!prev || !FORM_WRAPPERS.has(prev.type) || isFormAction(ext, prev) || !canAccept(ext, prev.id, type).ok) break;
    target = beforeFormActions(ext, { parentId: prev.id, index: prev.children.length }, type);
  }
  return target;
}

/** Component categories that want the card's full width (tables, CRM data, charts, lists of facts). */
const FULL_WIDTH_CATEGORIES = new Set(['CRM data', 'Charts', 'Tables', 'Data display']);
const FULL_WIDTH_TYPES = new Set(['Form', 'Tabs', 'Accordion', 'Alert', 'EmptyState', 'ErrorState', 'Divider', 'Tile']);

/** A component that reads best across the card's width (it shouldn't squeeze into a row's cell). */
export function isFullWidthComponent(type: string): boolean {
  if (FULL_WIDTH_TYPES.has(type)) return true;
  const category = getComponent(type)?.category;
  return !!category && FULL_WIDTH_CATEGORIES.has(category);
}

/** A container that lays its children out side by side (a Flex row — HubSpot's default — Inline, AutoGrid). */
export function isSideBySide(node: UINode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'Inline' || node.type === 'AutoGrid') return true;
  if (node.type !== 'Flex') return false;
  const direction = node.props?.direction;
  return direction === undefined || direction === 'row';
}

/**
 * The card's main column: the root's only child when it is a Flex column (how starters and most
 * cards are laid out). New content belongs at its end rather than after it.
 */
export function mainColumn(ext: Extension): NodeId | null {
  const root = ext.nodes[ext.rootId];
  if (!root || root.children.length !== 1) return null;
  const only = ext.nodes[root.children[0]];
  return only && only.type === 'Flex' && only.props?.direction === 'column' ? only.id : null;
}

/**
 * Where a click-to-add (palette click, paste-like insert) should go:
 * into the selected node if it is a container accepting the type, else after the selected node
 * in its parent, else at the end of the card's main column (or of the root). Returns null if
 * nowhere accepts it.
 *
 * Full-width components (tables, CRM data, charts, forms…) added next to something inside a row
 * (e.g. a name beside a status tag) go after the row instead of squeezing into it.
 *
 * Forms get special care: adding to a Form goes into its fields' layout Flex, and inside a form
 * new content goes before the trailing submit / reset buttons.
 */
export function smartInsertTarget(ext: Extension, selectedId: NodeId | null, type: string): InsertTarget | null {
  if (selectedId && ext.nodes[selectedId]) {
    const sel = ext.nodes[selectedId];
    if (canAccept(ext, selectedId, type).ok) {
      if (sel.type === 'Form') return intoForm(ext, selectedId, type);
      return beforeFormActions(ext, { parentId: selectedId, index: sel.children.length }, type);
    }
    const wide = isFullWidthComponent(type);
    let fallback: InsertTarget | null = null;
    let cur: NodeId | null = selectedId;
    // Walk up: after the selected node, then after its ancestors.
    while (cur) {
      const ref = findParent(ext, cur);
      if (!ref) break;
      if (!ref.slot && canAccept(ext, ref.parentId, type).ok) {
        const target = beforeFormActions(ext, { parentId: ref.parentId, index: ref.index + 1 }, type);
        if (!wide || !insideSideBySide(ext, ref.parentId)) return target;
        fallback ??= target;
      }
      cur = ref.parentId;
    }
    if (fallback) return fallback;
  }
  const main = mainColumn(ext);
  if (main && canAccept(ext, main, type).ok) return beforeFormActions(ext, { parentId: main, index: ext.nodes[main].children.length }, type);
  const root = ext.nodes[ext.rootId];
  if (canAccept(ext, ext.rootId, type).ok) return { parentId: ext.rootId, index: root.children.length };
  return null;
}

const COLUMN_TYPES = new Set(['Flex', 'Box', 'Tile']);

/**
 * A row of columns the admin laid out on purpose (e.g. the "Two columns" block: every child is a
 * container). Its columns are real places for content; other rows (a name next to a status tag,
 * a row of buttons) are not.
 */
function isColumnsLayout(ext: Extension, row: UINode): boolean {
  return row.children.length >= 2 && row.children.every((id) => COLUMN_TYPES.has(ext.nodes[id]?.type ?? ''));
}

/** `id` is a side-by-side row, or sits inside one that isn't a deliberate columns layout. */
function insideSideBySide(ext: Extension, id: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur && cur !== ext.rootId) {
    const node = ext.nodes[cur];
    if (isSideBySide(node)) return cur === id || !isColumnsLayout(ext, node);
    const ref = findParent(ext, cur);
    if (!ref || ref.slot) return false;
    cur = ref.parentId;
  }
  return false;
}
