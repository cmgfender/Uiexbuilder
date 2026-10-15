/**
 * Anchored popover rendered in a portal (position: fixed) so it is never clipped by the
 * inspector's scroll container. Flips above the anchor when there is no room below, follows the
 * anchor on scroll/resize and closes on outside pointer down. Keyboard handling (Escape, arrows)
 * is left to the content / the anchor's owner.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../ui';

export interface PopoverProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Fixed width in px, or 'anchor' to match the anchor's width. */
  width?: number | 'anchor';
  /** Max height in px (content scrolls). */
  maxHeight?: number;
  align?: 'start' | 'end';
  className?: string;
  role?: string;
  'aria-label'?: string;
  id?: string;
}

interface Pos {
  left: number;
  top: number;
  width?: number;
  maxHeight: number;
}

export function Popover({ anchor, open, onClose, children, width, maxHeight = 320, align = 'start', className, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      const el = ref.current;
      const w = width === 'anchor' ? r.width : (width ?? el?.offsetWidth ?? 240);
      const h = Math.min(el?.scrollHeight ?? maxHeight, maxHeight);
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const below = vh - r.bottom - 8;
      const above = r.top - 8;
      const placeAbove = below < Math.min(h, 160) && above > below;
      const avail = Math.max(120, placeAbove ? above - 4 : below - 4);
      let left = align === 'end' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const mh = Math.min(maxHeight, avail);
      const top = placeAbove ? Math.max(8, r.top - 4 - Math.min(h, mh)) : r.bottom + 4;
      setPos((p) =>
        p && p.left === left && p.top === top && p.width === (width === undefined ? undefined : w) && p.maxHeight === mh
          ? p
          : { left, top, width: width === undefined ? undefined : w, maxHeight: mh },
      );
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchor, width, maxHeight, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onCloseRef.current();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [open, anchor]);

  if (!open || !anchor) return null;
  const style: CSSProperties = pos
    ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
    : { left: -9999, top: -9999, visibility: 'hidden' };
  return createPortal(
    <div ref={ref} className={cx('ub-insp-pop', className)} style={style} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
