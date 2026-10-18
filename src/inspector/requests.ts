/**
 * One-shot requests from inspector shortcuts ("You can also…" tips) to a prop row: switch on
 * Rules, or show data from the card (fx + the variable picker). The request waits in this store
 * until the row is mounted (its section may have been collapsed) and consumes it.
 */
import { create } from 'zustand';
import type { NodeId } from '../model/types';

export type PropRequestAction = 'rules' | 'data';

export interface PropRequest {
  nodeId: NodeId;
  /** Prop name, or '__text' for the text content. */
  prop: string;
  action: PropRequestAction;
}

interface RequestStore {
  pending: PropRequest | null;
  request: (r: PropRequest) => void;
  /** Returns the pending request for this row and clears it, else null. */
  take: (nodeId: NodeId, prop: string) => PropRequest | null;
}

export const usePropRequests = create<RequestStore>()((set, get) => ({
  pending: null,
  request: (r) => set({ pending: r }),
  take: (nodeId, prop) => {
    const p = get().pending;
    if (!p || p.nodeId !== nodeId || p.prop !== prop) return null;
    set({ pending: null });
    return p;
  },
}));

const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

function nextFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
  else setTimeout(cb, 16);
}

/**
 * Scrolls an inspector element into view, flashes it and focuses `focus` inside it (default: the
 * first field or button). Waits two frames so a tab switch / section opening has rendered.
 */
export function revealInInspector(selector: string, focus?: string): void {
  nextFrame(() =>
    nextFrame(() => {
      const el = document.querySelector<HTMLElement>(`.ub-insp ${selector}`);
      if (!el) return;
      el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      el.classList.add('ub-insp-flash');
      setTimeout(() => el.classList.remove('ub-insp-flash'), 1200);
      el.querySelector<HTMLElement>(focus ?? 'input, textarea, select, button')?.focus({ preventScroll: true });
    }),
  );
}

export function propSelector(prop: string): string {
  return `[data-prop="${esc(prop)}"]`;
}
