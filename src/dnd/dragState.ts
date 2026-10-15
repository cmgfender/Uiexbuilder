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
import type { Extension, NodeId, NodeTemplate, StateVar } from '../model/types';

export const DND_MIME = 'application/x-uiex-dnd';

export type DragPayload =
  /** A new component from the palette (inserted with its registry `create()` template). */
  | { kind: 'new'; componentType: string }
  /**
   * A prebuilt block / snippet. `state` lists state variables the block relies on; the drop
   * handler adds any that the extension does not already have (matched by name).
   */
  | { kind: 'template'; template: NodeTemplate; label: string; state?: Array<Omit<StateVar, 'id'>> }
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

/**
 * Where a click-to-add (palette click, paste-like insert) should go:
 * into the selected node if it is a container accepting the type, else after the selected node
 * in its parent, else at the end of the root. Returns null if nowhere accepts it.
 */
export function smartInsertTarget(ext: Extension, selectedId: NodeId | null, type: string): InsertTarget | null {
  if (selectedId && ext.nodes[selectedId]) {
    const sel = ext.nodes[selectedId];
    if (canAccept(ext, selectedId, type).ok) return { parentId: selectedId, index: sel.children.length };
    let cur: NodeId | null = selectedId;
    // Walk up: after the selected node, then after its ancestors.
    while (cur) {
      const ref = findParent(ext, cur);
      if (!ref) break;
      if (!ref.slot && canAccept(ext, ref.parentId, type).ok) return { parentId: ref.parentId, index: ref.index + 1 };
      cur = ref.parentId;
    }
  }
  const root = ext.nodes[ext.rootId];
  if (canAccept(ext, ext.rootId, type).ok) return { parentId: ext.rootId, index: root.children.length };
  return null;
}
