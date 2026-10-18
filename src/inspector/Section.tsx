/**
 * Collapsible inspector section. Open/closed state is remembered per section key for the session,
 * so collapsing "Appearance" keeps it collapsed while moving between components.
 */
import { useId, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { create } from 'zustand';
import { cx } from '../ui';

interface SectionStore {
  open: Record<string, boolean>;
  setOpen: (key: string, open: boolean) => void;
}

export const useSectionStore = create<SectionStore>()((set) => ({
  open: {},
  setOpen: (key, open) => set((s) => ({ open: { ...s.open, [key]: open } })),
}));

export interface InspectorSectionProps {
  /** Persistence key, e.g. 'group:Appearance'. */
  id: string;
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Small text/badge after the title (e.g. "2 set"). */
  meta?: ReactNode;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  className?: string;
  /** Show the section open whatever was remembered (e.g. while filtering settings). */
  forceOpen?: boolean;
}

export function InspectorSection({ id, title, children, defaultOpen = true, meta, actions, className, forceOpen }: InspectorSectionProps) {
  const stored = useSectionStore((s) => s.open[id]);
  const open = !!forceOpen || (stored ?? defaultOpen);
  const bodyId = useId();
  return (
    <section className={cx('ub-insp-sec', !open && 'is-collapsed', className)} data-section={id}>
      <div className="ub-insp-sec__head">
        <button
          type="button"
          className="ub-insp-sec__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          disabled={forceOpen}
          onClick={() => useSectionStore.getState().setOpen(id, !open)}
        >
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          <span className="ub-insp-sec__title">{title}</span>
          {meta !== undefined && meta !== null && <span className="ub-insp-sec__meta">{meta}</span>}
        </button>
        {actions && <div className="ub-insp-sec__actions">{actions}</div>}
      </div>
      {open && (
        <div className="ub-insp-sec__body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}
