/**
 * Shell-only UI state: sidebar collapse, bottom panel height, palette focus requests and the
 * autosave status. Layout is persisted to localStorage. Document state lives in `useEditor`.
 */
import { create } from 'zustand';
import { useEditor, type BottomPanelTab, type LeftPanelTab, type RightPanelTab } from '../model/store';
import { PREF_KEYS, readPref, writePref } from './prefs';

export type BottomTab = Exclude<BottomPanelTab, null>;
export type SaveStatus = 'idle' | 'pending' | 'saved' | 'error';

export const BOTTOM_MIN_HEIGHT = 120;
export const BOTTOM_DEFAULT_HEIGHT = 280;
/** Height of the bottom panel's tab strip (visible while collapsed). */
export const BOTTOM_STRIP_HEIGHT = 34;
export const LEFT_WIDTH = 280;
export const RIGHT_WIDTH = 320;
export const RAIL_WIDTH = 44;

export interface ShellLayout {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomHeight: number;
  /** Last open bottom tab (restored when the panel is re-opened). */
  bottomTab: BottomTab;
  bottomOpen: boolean;
}

const DEFAULT_LAYOUT: ShellLayout = {
  leftCollapsed: false,
  rightCollapsed: false,
  bottomHeight: BOTTOM_DEFAULT_HEIGHT,
  bottomTab: 'code',
  bottomOpen: false,
};

const BOTTOM_TABS: BottomTab[] = ['code', 'problems', 'console'];

export function loadLayout(): ShellLayout {
  const raw = readPref<Partial<ShellLayout> | null>(PREF_KEYS.layout, null);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT };
  return {
    leftCollapsed: raw.leftCollapsed === true,
    rightCollapsed: raw.rightCollapsed === true,
    bottomHeight:
      typeof raw.bottomHeight === 'number' && Number.isFinite(raw.bottomHeight)
        ? Math.max(BOTTOM_MIN_HEIGHT, Math.round(raw.bottomHeight))
        : BOTTOM_DEFAULT_HEIGHT,
    bottomTab: BOTTOM_TABS.includes(raw.bottomTab as BottomTab) ? (raw.bottomTab as BottomTab) : 'code',
    bottomOpen: raw.bottomOpen === true,
  };
}

interface ShellState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomHeight: number;
  lastBottomTab: BottomTab;
  /** Incremented to ask the palette to focus its search box. */
  paletteFocusNonce: number;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
  setBottomHeight: (h: number) => void;
  setLastBottomTab: (t: BottomTab) => void;
  requestPaletteFocus: () => void;
  setSaveStatus: (s: SaveStatus) => void;
}

export const useShell = create<ShellState>()((set) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  bottomHeight: BOTTOM_DEFAULT_HEIGHT,
  lastBottomTab: 'code',
  paletteFocusNonce: 0,
  saveStatus: 'idle',
  lastSavedAt: null,
  setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed }),
  setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
  setBottomHeight: (h) => set({ bottomHeight: Math.max(BOTTOM_MIN_HEIGHT, Math.round(h)) }),
  setLastBottomTab: (lastBottomTab) => set({ lastBottomTab }),
  requestPaletteFocus: () => set((s) => ({ paletteFocusNonce: s.paletteFocusNonce + 1 })),
  setSaveStatus: (saveStatus) =>
    set(saveStatus === 'saved' ? { saveStatus, lastSavedAt: Date.now() } : { saveStatus }),
}));

/** Applies persisted layout to the shell and editor stores (called once at startup). */
export function applyStoredLayout(): void {
  const layout = loadLayout();
  useShell.setState({
    leftCollapsed: layout.leftCollapsed,
    rightCollapsed: layout.rightCollapsed,
    bottomHeight: layout.bottomHeight,
    lastBottomTab: layout.bottomTab,
  });
  useEditor.getState().setBottomPanel(layout.bottomOpen ? layout.bottomTab : null);
}

/** Persists layout whenever it changes. Returns an unsubscribe function. */
export function persistLayoutChanges(): () => void {
  const save = () => {
    const shell = useShell.getState();
    const bottom = useEditor.getState().bottomPanel;
    const layout: ShellLayout = {
      leftCollapsed: shell.leftCollapsed,
      rightCollapsed: shell.rightCollapsed,
      bottomHeight: shell.bottomHeight,
      bottomTab: bottom ?? shell.lastBottomTab,
      bottomOpen: bottom !== null,
    };
    writePref(PREF_KEYS.layout, layout);
  };
  const unsubShell = useShell.subscribe((s, prev) => {
    if (
      s.leftCollapsed !== prev.leftCollapsed ||
      s.rightCollapsed !== prev.rightCollapsed ||
      s.bottomHeight !== prev.bottomHeight ||
      s.lastBottomTab !== prev.lastBottomTab
    ) {
      save();
    }
  });
  const unsubEditor = useEditor.subscribe((s, prev) => {
    if (s.bottomPanel !== prev.bottomPanel) {
      if (s.bottomPanel) useShell.getState().setLastBottomTab(s.bottomPanel);
      save();
    }
  });
  return () => {
    unsubShell();
    unsubEditor();
  };
}

// ---------------------------------------------------------------------------
// Panel helpers used by the top bar, shortcuts and problems panel
// ---------------------------------------------------------------------------

export function toggleBottomPanel(): void {
  const editor = useEditor.getState();
  if (editor.bottomPanel) editor.setBottomPanel(null);
  else editor.setBottomPanel(useShell.getState().lastBottomTab);
}

export function openBottomTab(tab: BottomTab): void {
  useEditor.getState().setBottomPanel(tab);
}

/** Shows a left sidebar tab, expanding the sidebar when collapsed. */
export function showLeftTab(tab: LeftPanelTab): void {
  useEditor.getState().setLeftPanel(tab);
  if (useShell.getState().leftCollapsed) useShell.getState().setLeftCollapsed(false);
}

/** Shows an inspector tab, expanding the right sidebar when collapsed. */
export function showRightTab(tab: RightPanelTab): void {
  useEditor.getState().setRightPanel(tab);
  if (useShell.getState().rightCollapsed) useShell.getState().setRightCollapsed(false);
}

/** Focuses the palette search (switching to the Components tab first). */
export function focusPaletteSearch(): void {
  showLeftTab('components');
  useShell.getState().requestPaletteFocus();
}
