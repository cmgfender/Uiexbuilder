/**
 * Global keyboard shortcuts. `SHORTCUTS` documents every binding (shown in the shortcuts dialog and
 * usable by other modules, e.g. the command palette); `useGlobalShortcuts()` installs the handler.
 *
 * Bindings use Cmd on macOS and Ctrl elsewhere (either modifier is accepted). Events are ignored
 * while focus is in a text field / contenteditable, or while a dialog or menu is open — except
 * Cmd+S, which always saves. Cmd+K belongs to the command palette and is not handled here.
 *
 * Single-key editing shortcuts (Delete / Backspace, Escape, the arrow keys and Alt+arrows) act on
 * the canvas selection only while focus is "on the canvas" (see `isShortcutScope`): nothing
 * focused, the design canvas stage, or an element marked `data-shortcuts-scope` (the layers tree).
 * Elsewhere — inspector controls, buttons, switches, the code viewer — those keys keep their usual
 * meaning, so a keyboard user can never delete a component by pressing Backspace on a switch.
 */
import { useEffect } from 'react';
import { selectActiveExtension, useEditor, type LeftPanelTab } from '../model/store';
import { useDialogs } from './dialogs';
import { useToast } from '../ui';
import {
  cutNodeSafe,
  duplicateNodeSafe,
  historyStep,
  moveSelectedAmongSiblings,
  pasteAt,
  removeNodeSafe,
  selectFirstChild,
  selectParent,
  selectParentStrict,
  selectSibling,
  wrapNodeSafe,
  type Notify,
} from './actions';
import { saveCurrentProject, saveErrorMessage } from './persistence';
import { focusPaletteSearch, showLeftTab, toggleBottomPanel, useShell } from './shellStore';

export type ShortcutGroup = 'General' | 'Edit' | 'Selection' | 'View';

export interface ShortcutDef {
  id: string;
  /** Display keys, e.g. 'Cmd+Z' (rendered with platform symbols by formatShortcut). */
  keys: string;
  description: string;
  group: ShortcutGroup;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'commandPalette', keys: 'Cmd+K', description: 'Open the command palette', group: 'General' },
  { id: 'save', keys: 'Cmd+S', description: 'Save the project in this browser', group: 'General' },
  { id: 'export', keys: 'Shift+Cmd+E', description: 'Publish to HubSpot (or download the project)', group: 'General' },
  { id: 'shortcuts', keys: '?', description: 'Show keyboard shortcuts', group: 'General' },
  { id: 'togglePreview', keys: 'Cmd+Enter', description: 'Switch between Design and Preview', group: 'General' },

  { id: 'undo', keys: 'Cmd+Z', description: 'Undo', group: 'Edit' },
  { id: 'redo', keys: 'Shift+Cmd+Z', description: 'Redo', group: 'Edit' },
  { id: 'redoAlt', keys: 'Cmd+Y', description: 'Redo (alternative)', group: 'Edit' },
  { id: 'delete', keys: 'Delete', description: 'Delete the selected component', group: 'Edit' },
  { id: 'duplicate', keys: 'Cmd+D', description: 'Duplicate the selected component', group: 'Edit' },
  { id: 'copy', keys: 'Cmd+C', description: 'Copy the selected component', group: 'Edit' },
  { id: 'cut', keys: 'Cmd+X', description: 'Cut the selected component', group: 'Edit' },
  { id: 'paste', keys: 'Cmd+V', description: 'Paste after the selection (or inside a selected container)', group: 'Edit' },
  { id: 'wrap', keys: 'Cmd+G', description: 'Wrap the selection in a Flex', group: 'Edit' },
  { id: 'moveUp', keys: 'Alt+ArrowUp', description: 'Move the selection up among its siblings', group: 'Edit' },
  { id: 'moveDown', keys: 'Alt+ArrowDown', description: 'Move the selection down among its siblings', group: 'Edit' },
  { id: 'rename', keys: 'F2', description: 'Rename the selected layer (in Layers)', group: 'Edit' },

  { id: 'selectParent', keys: 'Escape', description: 'Select the parent (deselect at the top level)', group: 'Selection' },
  { id: 'prevSibling', keys: 'ArrowUp', description: 'Select the previous sibling', group: 'Selection' },
  { id: 'nextSibling', keys: 'ArrowDown', description: 'Select the next sibling', group: 'Selection' },
  { id: 'parent', keys: 'ArrowLeft', description: 'Select the parent', group: 'Selection' },
  { id: 'firstChild', keys: 'ArrowRight', description: 'Select the first child', group: 'Selection' },

  { id: 'focusSearch', keys: 'Cmd+/', description: 'Search components', group: 'View' },
  { id: 'tabComponents', keys: 'Cmd+1', description: 'Show Components', group: 'View' },
  { id: 'tabLayers', keys: 'Cmd+2', description: 'Show Layers', group: 'View' },
  { id: 'tabTemplates', keys: 'Cmd+3', description: 'Show Templates', group: 'View' },
  { id: 'tabData', keys: 'Cmd+4', description: 'Show Data', group: 'View' },
  { id: 'toggleBottom', keys: 'Cmd+J', description: 'Show or hide the code / problems / console panel', group: 'View' },
];

export const SHORTCUT_GROUPS: ShortcutGroup[] = ['General', 'Edit', 'Selection', 'View'];

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const MAC_SYMBOLS: Record<string, string> = {
  Cmd: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Ctrl: '⌃',
  Enter: '↵',
  Escape: 'Esc',
  Delete: '⌫',
  Backspace: '⌫',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const PC_NAMES: Record<string, string> = {
  Cmd: 'Ctrl',
  Escape: 'Esc',
  Delete: 'Del',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Splits display keys into platform-specific key caps, e.g. 'Shift+Cmd+Z' -> ['⇧', '⌘', 'Z']. */
export function shortcutKeys(keys: string, mac = isMacPlatform()): string[] {
  // '+' itself is never a key in our bindings, so a plain split is safe.
  return keys.split('+').map((k) => (mac ? MAC_SYMBOLS[k] ?? k : PC_NAMES[k] ?? k));
}

/** Compact display string, e.g. '⌘Z' on macOS and 'Ctrl+Z' elsewhere. */
export function formatShortcut(keys: string, mac = isMacPlatform()): string {
  const parts = shortcutKeys(keys, mac);
  return mac ? parts.join('') : parts.join('+');
}

/** Display string for a shortcut id (for tooltips and menus). */
export function shortcutLabel(id: string): string {
  const def = SHORTCUTS.find((s) => s.id === id);
  return def ? formatShortcut(def.keys) : '';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** True for text fields, selects and contenteditable regions (their keys belong to them). */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const html = el as HTMLElement;
  if (html.isContentEditable) return true;
  const tag = html.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = ((html as HTMLInputElement).type || 'text').toLowerCase();
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  return !!html.closest('[contenteditable="true"], [contenteditable=""]');
}

/**
 * True when single-key editing shortcuts may act on the selection: focus is nowhere (body), on the
 * design canvas stage, or inside an element that opts in with `data-shortcuts-scope`.
 */
export function isShortcutScope(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return true;
  if (typeof document !== 'undefined' && (el === document.body || el === document.documentElement)) return true;
  return !!el.closest('.ub-cv-stage, [data-shortcuts-scope]');
}

/** Elements that handle arrow keys themselves (lists, menus, trees, sliders...). */
function ownsArrowKeys(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  return !!el.closest(
    '[role="tree"], [role="listbox"], [role="menu"], [role="menubar"], [role="grid"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="radiogroup"], [role="tablist"], [role="separator"]',
  );
}

/**
 * A builder dialog, menu or the command palette is open. Dialogs drawn by HubSpot component
 * previews (Modal / Panel / date pickers inside the card) don't count, and neither do popovers
 * that never block the editor (`data-uiex-nonblocking`, e.g. the coach-mark tour).
 */
export function isOverlayOpen(): boolean {
  if (useDialogs.getState().current) return true;
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [role="menu"]')).some(
    (el) => !el.closest('.hsp-overlay-host, [data-node-id], [class*="hsp-"], [data-uiex-nonblocking]'),
  );
}

function activeElement(e: KeyboardEvent): EventTarget | null {
  return (typeof document !== 'undefined' && document.activeElement) || e.target;
}

function hasTextSelection(): boolean {
  try {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    return !!sel && !sel.isCollapsed && sel.toString().length > 0;
  } catch {
    return false;
  }
}

const LEFT_TABS: LeftPanelTab[] = ['components', 'layers', 'templates', 'data'];

/**
 * Saves immediately (Cmd+S) and reports the result. When another tab saved a different version
 * of the project meanwhile, nothing is overwritten: the conflict dialog asks which one to keep.
 */
export function saveNow(notify: Notify): boolean {
  const outcome = saveCurrentProject();
  if (outcome === 'conflict') {
    const conflict = useShell.getState().conflict;
    if (conflict) useShell.getState().setConflict({ ...conflict, dismissed: false });
    notify('Not saved — this project changed in another tab');
    return false;
  }
  notify(outcome === 'saved' ? 'Saved in this browser' : `Could not save. ${saveErrorMessage()}`);
  return outcome === 'saved';
}

/**
 * Handles one keydown. Returns true when the event was consumed (the caller prevents default).
 * Exported for tests.
 */
export function handleGlobalKeyDown(e: KeyboardEvent, notify: Notify): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  // Cmd+S works everywhere (also inside inputs and dialogs).
  if (mod && !e.altKey && !e.shiftKey && key === 's') {
    saveNow(notify);
    return true;
  }

  const focus = activeElement(e);
  if (isEditableTarget(focus) || isEditableTarget(e.target)) return false;
  if (isOverlayOpen()) return false;

  const editor = useEditor.getState();
  const selected = editor.selectedNodeId;
  const ext = selectActiveExtension(editor);
  const hasSelection = !!selected && !!ext.nodes[selected];
  const designing = editor.mode === 'design';

  if (mod && !e.altKey) {
    switch (key) {
      case 'z':
        historyStep(e.shiftKey ? 'redo' : 'undo', notify);
        return true;
      case 'y':
        if (e.shiftKey) return false;
        historyStep('redo', notify);
        return true;
      case 'Enter':
        editor.setMode(editor.mode === 'design' ? 'preview' : 'design');
        return true;
      case 'e':
        if (!e.shiftKey) return false;
        useDialogs.getState().open('export');
        return true;
      case '/':
        focusPaletteSearch();
        return true;
      case 'j':
        if (e.shiftKey) return false;
        toggleBottomPanel();
        return true;
      case '1':
      case '2':
      case '3':
      case '4':
        if (e.shiftKey) return false;
        showLeftTab(LEFT_TABS[Number(key) - 1]);
        return true;
      default:
        break;
    }
    if (e.shiftKey || !designing) return false;
    switch (key) {
      case 'd':
        if (hasSelection) duplicateNodeSafe(selected, notify);
        return true; // always swallow (browser bookmark)
      case 'c':
        if (!hasSelection || hasTextSelection()) return false;
        editor.copyNode(selected);
        return true;
      case 'x':
        if (!hasSelection || hasTextSelection()) return false;
        cutNodeSafe(selected, notify);
        return true;
      case 'v':
        if (!editor.clipboard) return false;
        pasteAt(hasSelection ? selected : null, notify);
        return true;
      case 'g':
        if (hasSelection) wrapNodeSafe(selected, 'Flex', notify);
        return true;
      default:
        return false;
    }
  }

  if (e.ctrlKey || e.metaKey) return false;

  if (!e.altKey && key === '?') {
    useDialogs.getState().open('shortcuts');
    return true;
  }

  if (!designing) return false;
  // Delete / Escape / arrows only act on the selection while focus is on the canvas (or nowhere).
  if (!isShortcutScope(focus)) return false;

  if (e.altKey && !e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    if (ownsArrowKeys(focus) || !hasSelection) return false;
    moveSelectedAmongSiblings(key === 'ArrowUp' ? -1 : 1, notify);
    return true;
  }
  if (e.altKey || e.shiftKey) return false;

  switch (key) {
    case 'Delete':
    case 'Backspace':
      if (!hasSelection) return false;
      removeNodeSafe(selected, notify);
      return true;
    case 'Escape':
      if (!selected) return false;
      selectParent();
      return true;
    case 'ArrowUp':
    case 'ArrowDown':
      if (ownsArrowKeys(focus)) return false;
      return selectSibling(key === 'ArrowUp' ? -1 : 1);
    case 'ArrowLeft':
      if (ownsArrowKeys(focus) || !hasSelection) return false;
      selectParentStrict();
      return true;
    case 'ArrowRight':
      if (ownsArrowKeys(focus) || !hasSelection) return false;
      selectFirstChild();
      return true;
    default:
      return false;
  }
}

/** Installs the global shortcut handler (mount once, inside <ToastProvider>). */
export function useGlobalShortcuts(): void {
  const toast = useToast();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (handleGlobalKeyDown(e, toast)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toast]);
}
