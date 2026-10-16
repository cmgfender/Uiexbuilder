/**
 * Dropdown menu state for a trigger button (wraps the ui kit's useMenu): toggles on click without
 * the close-then-reopen flicker and remembers the trigger so the kit Menu returns focus to it when
 * it closes (pass `returnFocus` to <Menu>). The keyboard model (focus the first item, arrow keys,
 * Home / End, Tab, Escape) lives in the kit Menu itself.
 */
import { useCallback, useRef } from 'react';
import { useMenu } from '../ui';

/**
 * The last mouse press anywhere (capture phase, registered before any menu mounts, so it is seen
 * before a menu's own "press outside closes me" listener): where it was and when.
 */
let lastPress = { at: 0, inMenu: false };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousedown',
    (e) => {
      const target = e.target instanceof Element ? e.target : null;
      lastPress = { at: Date.now(), inMenu: !!target?.closest('[role="menu"]') };
    },
    true,
  );
}

export function useAnchoredMenu() {
  const menu = useMenu();
  const closedAt = useRef(0);
  const suppressClick = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const { close: rawClose, openAt } = menu;
  const close = useCallback(() => {
    // Only a close caused by a press outside the menu (the menu closes on any mousedown outside it)
    // can be the press on the trigger; closing by choosing an item or with the keyboard must not
    // swallow the next click on the trigger, however quickly it follows.
    const byPressOutside = !lastPress.inMenu && Date.now() - lastPress.at < 50;
    closedAt.current = byPressOutside ? Date.now() : 0;
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
  /** The trigger that opened the menu (focus returns there when the menu closes). */
  const returnFocus = useCallback(() => trigger.current, []);
  return { position: menu.position, close, toggle, onTriggerMouseDown, returnFocus };
}
