/**
 * Small non-modal popover anchored to a button (account menu, record picker, info notes).
 * Portalled to <body>; focus moves inside when it opens; Escape closes it and returns focus to the
 * anchor; a click outside or focus moving elsewhere closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type FocusEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx, tabbableElements } from '../../ui';

export type PopoverCloseReason = 'escape' | 'outside' | 'blur';

export interface PopoverProps {
  anchor: HTMLElement | null;
  onClose: (reason: PopoverCloseReason) => void;
  /** Accessible name of the popover (role="dialog"). */
  label: string;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
  /** Element to focus when it opens (default: the first focusable element). */
  initialFocus?: () => HTMLElement | null | undefined;
  id?: string;
}

export function Popover({ anchor, onClose, label, children, align = 'start', width = 320, className, initialFocus, id }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth || width;
      const h = el.offsetHeight;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      let top = r.bottom + 6;
      if (h && top + h > vh - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, align, width]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = initialFocus?.() ?? tabbableElements(el)[0] ?? el;
    target.focus({ preventScroll: true });
    // Focus moves in once, when the popover opens.
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t || ref.current?.contains(t) || anchor?.contains(t)) return;
      onCloseRef.current('outside');
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [anchor]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // Handled here: an enclosing dialog stays open and global shortcuts ignore it.
    e.preventDefault();
    e.stopPropagation();
    onCloseRef.current('escape');
    anchor?.focus({ preventScroll: true });
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    // Focus left the page (e.g. to the HubSpot window) or stayed with us: keep it open.
    if (!next || ref.current?.contains(next) || anchor?.contains(next)) return;
    onCloseRef.current('blur');
  };

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={cx('ub-cn-popover', className)}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {children}
    </div>,
    document.body,
  );
}
