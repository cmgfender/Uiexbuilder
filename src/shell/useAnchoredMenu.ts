/**
 * Dropdown menu state for a trigger button (wraps the ui kit's useMenu): toggles on click without
 * the close-then-reopen flicker, moves focus into the menu, supports arrow keys and returns focus
 * to the trigger when closed.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useMenu } from '../ui';

const ITEM_SELECTOR = '.ub-menu [role="menuitem"]:not(:disabled)';

function menuItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
}

/** Arrow-key navigation inside an open ui-kit Menu; focuses its first item when it opens. */
export function useMenuKeyboard(open: boolean, onClosed?: () => void): void {
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => menuItems()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      const items = menuItems();
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (e.key === 'ArrowDown') next = i === -1 ? 0 : (i + 1) % items.length;
      else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'Tab') {
        e.preventDefault();
        next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      items[next]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      onClosedRef.current?.();
    };
  }, [open]);
}

export function useAnchoredMenu() {
  const menu = useMenu();
  const closedAt = useRef(0);
  const suppressClick = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const { close: rawClose, openAt } = menu;
  const close = useCallback(() => {
    closedAt.current = Date.now();
    rawClose();
  }, [rawClose]);
  /**
   * The open menu closes itself on any mousedown outside it — including one on the trigger. Remember
   * that so the click that follows doesn't immediately re-open it.
   */
  const onTriggerMouseDown = useCallback(() => {
    suppressClick.current = Date.now() - closedAt.current < 100;
  }, []);
  const toggle = useCallback(
    (el: HTMLElement) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (menu.position) {
        close();
        return;
      }
      trigger.current = el;
      openAt(el);
    },
    [menu.position, close, openAt],
  );
  useMenuKeyboard(!!menu.position, () => {
    // Return focus to the trigger when focus was inside the (now removed) menu.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body) trigger.current?.focus();
    });
  });
  return { position: menu.position, close, toggle, onTriggerMouseDown };
}
