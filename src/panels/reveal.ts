/**
 * Requests to reveal a state variable or data source in the Data panel (e.g. from the Problems
 * panel): the section expands the item, scrolls it into view and flashes it.
 */
import { create } from 'zustand';

export type DataRevealKind = 'state' | 'dataSource';

interface DataRevealState {
  target: { kind: DataRevealKind; id: string } | null;
}

export const useDataReveal = create<DataRevealState>(() => ({ target: null }));

/** Asks the Data panel to open and show an item. */
export function revealDataItem(kind: DataRevealKind, id: string): void {
  useDataReveal.setState({ target: { kind, id } });
}

/**
 * Handles a pending reveal for one section: when it targets one of `ids`, calls `open(id)`,
 * then scrolls the row (`[data-pn-item="<id>"]`) into view and flashes it.
 */
export function consumeDataReveal(kind: DataRevealKind, ids: string[], open: (id: string) => void): void {
  const target = useDataReveal.getState().target;
  if (!target || target.kind !== kind || !ids.includes(target.id)) return;
  useDataReveal.setState({ target: null });
  open(target.id);
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  frame(() =>
    frame(() => {
      const el = document.querySelector<HTMLElement>(`[data-pn-item="${CSS.escape(target.id)}"]`);
      if (!el) return;
      el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      el.classList.add('ub-pn-item--flash');
      setTimeout(() => el.classList.remove('ub-pn-item--flash'), 1400);
    }),
  );
}
