/**
 * Shell-only UI state: sidebar collapse, bottom panel height, palette focus requests, the
 * autosave status and the compact (narrow window) layout. Layout is persisted to localStorage.
 * Document state lives in `useEditor`.
 *
 * Compact layout: below `COMPACT_BREAKPOINT` the left sidebar starts collapsed to its icon rail
 * (`leftAutoCollapsed`, not persisted) so the canvas, the inspector and the top bar's Export
 * button fit on small laptops and split screens. Opening it again (rail, top bar, Cmd+1…4)
 * pushes the canvas narrower; widening the window restores the user's own setting.
 */
import { create } from 'zustand';
import { useEditor, type BottomPanelTab, type LeftPanelTab, type RightPanelTab } from '../model/store';
import { PREF_KEYS, readPref, writePref } from './prefs';

export type BottomTab = Exclude<BottomPanelTab, null>;
/** 'conflict': another tab saved the open project; autosave waits until the user decides. */
export type SaveStatus = 'idle' | 'pending' | 'saved' | 'error' | 'conflict';

export const BOTTOM_MIN_HEIGHT = 120;
export const BOTTOM_DEFAULT_HEIGHT = 280;
/** Height of the bottom panel's tab strip (visible while collapsed). */
export const BOTTOM_STRIP_HEIGHT = 34;
/** Default sidebar widths; the user can drag them between SIDEBAR_MIN_WIDTH and SIDEBAR_MAX_WIDTH. */
export const LEFT_WIDTH = 280;
export const RIGHT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 560;

export function clampSidebarWidth(w: number, fallback: number): number {
  if (!Number.isFinite(w)) return fallback;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(w)));
}
export const RAIL_WIDTH = 44;
/** Windows narrower than this use the compact layout (left sidebar starts as a rail). */
export const COMPACT_BREAKPOINT = 1180;

export interface ShellLayout {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  /** Last open bottom tab (restored when the panel is re-opened). */
  bottomTab: BottomTab;
  bottomOpen: boolean;
}

const DEFAULT_LAYOUT: ShellLayout = {
  leftCollapsed: false,
  rightCollapsed: false,
  leftWidth: LEFT_WIDTH,
  rightWidth: RIGHT_WIDTH,
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
    leftWidth: typeof raw.leftWidth === 'number' ? clampSidebarWidth(raw.leftWidth, LEFT_WIDTH) : LEFT_WIDTH,
    rightWidth: typeof raw.rightWidth === 'number' ? clampSidebarWidth(raw.rightWidth, RIGHT_WIDTH) : RIGHT_WIDTH,
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
  /** Sidebar widths in px (persisted; see clampSidebarWidth). */
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  lastBottomTab: BottomTab;
  /** Incremented to ask the palette to focus its search box. */
  paletteFocusNonce: number;
  /** Text to search for with that request ('' = keep the current search). Additive. */
  paletteFocusQuery: string;
  saveStatus: SaveStatus;
  lastSavedAt: number | null;
  /** Why the last save failed (shown while saveStatus is 'error'). */
  saveError: 'quota' | 'unavailable' | 'error' | null;
  /** Another tab saved a different version of the open project (see ProjectConflictDialog). */
  conflict: { projectId: string; dismissed?: boolean } | null;
  /** The window is narrower than COMPACT_BREAKPOINT. */
  compact: boolean;
  /** The left sidebar is shown as a rail because the window is compact (not persisted). */
  leftAutoCollapsed: boolean;
  /** The user's choice (persisted); see `isLeftCollapsed` for what is shown. */
  setLeftCollapsed: (v: boolean) => void;
  setRightCollapsed: (v: boolean) => void;
  setSidebarWidth: (side: 'left' | 'right', width: number) => void;
  setBottomHeight: (h: number) => void;
  setLastBottomTab: (t: BottomTab) => void;
  requestPaletteFocus: (query?: string) => void;
  setSaveStatus: (s: SaveStatus, error?: ShellState['saveError']) => void;
  setConflict: (c: { projectId: string; dismissed?: boolean } | null) => void;
  setCompact: (compact: boolean) => void;
}

export const useShell = create<ShellState>()((set) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  leftWidth: LEFT_WIDTH,
  rightWidth: RIGHT_WIDTH,
  bottomHeight: BOTTOM_DEFAULT_HEIGHT,
  lastBottomTab: 'code',
  paletteFocusNonce: 0,
  paletteFocusQuery: '',
  saveStatus: 'idle',
  lastSavedAt: null,
  saveError: null,
  conflict: null,
  compact: false,
  leftAutoCollapsed: false,
  setLeftCollapsed: (leftCollapsed) => set({ leftCollapsed, leftAutoCollapsed: false }),
  setRightCollapsed: (rightCollapsed) => set({ rightCollapsed }),
  setSidebarWidth: (side, width) =>
    set(side === 'left' ? { leftWidth: clampSidebarWidth(width, LEFT_WIDTH) } : { rightWidth: clampSidebarWidth(width, RIGHT_WIDTH) }),
  setBottomHeight: (h) => set({ bottomHeight: Math.max(BOTTOM_MIN_HEIGHT, Math.round(h)) }),
  setLastBottomTab: (lastBottomTab) => set({ lastBottomTab }),
  requestPaletteFocus: (query = '') => set((s) => ({ paletteFocusNonce: s.paletteFocusNonce + 1, paletteFocusQuery: query })),
  setSaveStatus: (saveStatus, error = null) =>
    set(
      saveStatus === 'saved'
        ? { saveStatus, lastSavedAt: Date.now(), saveError: null }
        : { saveStatus, saveError: saveStatus === 'error' ? error ?? 'error' : null },
    ),
  setConflict: (conflict) => set({ conflict }),
  setCompact: (compact) =>
    set((s) => {
      if (compact === s.compact) return {};
      // Entering compact collapses the left sidebar to its rail; leaving it restores the user's setting.
      return { compact, leftAutoCollapsed: compact };
    }),
}));

/**
 * Shows or hides the left sidebar. In the compact layout hiding it is temporary (the user's
 * wide-window setting is kept).
 */
export function setLeftSidebarOpen(open: boolean): void {
  const s = useShell.getState();
  if (open) s.setLeftCollapsed(false);
  else if (s.compact && !s.leftCollapsed) useShell.setState({ leftAutoCollapsed: true });
  else s.setLeftCollapsed(true);
}

/** Whether the left sidebar shows as a rail (the user collapsed it, or the window is compact). */
export function isLeftCollapsed(s: Pick<ShellState, 'leftCollapsed' | 'leftAutoCollapsed'>): boolean {
  return s.leftCollapsed || s.leftAutoCollapsed;
}

/** Tracks the window width and switches the compact layout on and off. Mount once. */
export function watchCompactLayout(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(`(max-width: ${COMPACT_BREAKPOINT - 0.02}px)`);
  const apply = () => useShell.getState().setCompact(query.matches);
  apply();
  query.addEventListener?.('change', apply);
  return () => query.removeEventListener?.('change', apply);
}

/** Applies persisted layout to the shell and editor stores (called once at startup). */
export function applyStoredLayout(): void {
  const layout = loadLayout();
  useShell.setState({
    leftCollapsed: layout.leftCollapsed,
    rightCollapsed: layout.rightCollapsed,
    leftWidth: layout.leftWidth,
    rightWidth: layout.rightWidth,
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
      leftWidth: shell.leftWidth,
      rightWidth: shell.rightWidth,
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
      s.leftWidth !== prev.leftWidth ||
      s.rightWidth !== prev.rightWidth ||
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
  if (isLeftCollapsed(useShell.getState())) useShell.getState().setLeftCollapsed(false);
}

/** Shows an inspector tab, expanding the right sidebar when collapsed. */
export function showRightTab(tab: RightPanelTab): void {
  useEditor.getState().setRightPanel(tab);
  if (useShell.getState().rightCollapsed) useShell.getState().setRightCollapsed(false);
}

/** Focuses the palette search (switching to the Components tab first), optionally searching for `query`. */
export function focusPaletteSearch(query?: string): void {
  showLeftTab('components');
  useShell.getState().requestPaletteFocus(query);
}
