/**
 * Anchored popover rendered in a portal (position: fixed) so it is never clipped by the
 * inspector's scroll container. Flips above the anchor when there is no room below, follows the
 * anchor on scroll/resize and closes on outside pointer down.
 *
 * Interactive popovers (pickers, menus) pass `autoFocus`: once the popover is positioned (its
 * first render is hidden off-screen, where `focus()` fails) focus moves to the element marked
 * `data-autofocus` (else the first input / menu item / button), and Escape closes it and returns
 * focus to the anchor. Escape is caught in the capture phase so the global shortcuts (deselect)
 * and an enclosing dialog never see it. Passive popovers (autocomplete lists) leave focus and
 * keys to their owner.
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
  /** Move focus into the popover when it opens; Escape closes it and refocuses the anchor. */
  autoFocus?: boolean;
  /**
   * The rectangle to place the popover against instead of the anchor's box (e.g. the caret's line
   * in a multi-line field, so suggestions don't cover the line being typed). Null falls back to
   * the anchor. Re-read whenever `anchorKey` changes and on scroll / resize.
   */
  anchorRect?: () => { left: number; top: number; right: number; bottom: number; width: number } | null;
  anchorKey?: unknown;
}

interface Pos {
  left: number;
  top: number;
  width?: number;
  maxHeight: number;
}

/** Element that should receive focus when an interactive popover opens. */
export const AUTOFOCUS_SELECTOR = '[data-autofocus]';
const FOCUSABLE_SELECTOR =
  'input:not([disabled]), textarea:not([disabled]), [role="menuitem"]:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Popover({
  anchor,
  open,
  onClose,
  children,
  width,
  maxHeight = 320,
  align = 'start',
  className,
  autoFocus,
  anchorRect,
  anchorKey,
  ...rest
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const anchorRectRef = useRef(anchorRect);
  anchorRectRef.current = anchorRect;
  const [pos, setPos] = useState<Pos | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPos(null);
      return;
    }
    const update = () => {
      const box = anchor.getBoundingClientRect();
      const r = anchorRectRef.current?.() ?? box;
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
  }, [open, anchor, width, maxHeight, align, anchorKey]);

  // Focus the content once it is visible (autoFocus on a hidden element is a no-op).
  const visible = open && !!anchor && pos !== null;
  useLayoutEffect(() => {
    if (!autoFocus || !visible) return;
    const el = ref.current;
    if (!el || el.contains(document.activeElement)) return;
    const target = el.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR) ?? el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    target?.focus({ preventScroll: true });
  }, [autoFocus, visible]);

  useEffect(() => {
    if (!open || !autoFocus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as Node | null;
      const inside = !!t && (!!ref.current?.contains(t) || !!anchor?.contains(t));
      if (!inside) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
      anchor?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, autoFocus, anchor]);

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
