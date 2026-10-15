/**
 * Canvas-local state (never part of the document):
 *  - useCanvasView: zoom, HubSpot chrome toggle, sidebar collapse (persisted per browser).
 *  - useCanvasUi:   transient interaction state (context menu, inline text editor, save-block prompt).
 */
import { create } from 'zustand';
import type { NodeId } from '../model/types';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 1.5;
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5];
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5];

const VIEW_KEY = 'uiex-builder:canvas-view';

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 100) / 100;
}

export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;
}

interface PersistedView {
  zoom: number;
  chrome: boolean;
}

function loadView(): PersistedView {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PersistedView>;
      return { zoom: clampZoom(typeof v.zoom === 'number' ? v.zoom : 1), chrome: v.chrome !== false };
    }
  } catch {
    /* storage unavailable */
  }
  return { zoom: 1, chrome: true };
}

function saveView(v: PersistedView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

interface CanvasViewState {
  zoom: number;
  chrome: boolean;
  /** Sidebar-style frames: the card section is collapsed. */
  collapsed: boolean;
  /** Bumped to ask the mounted canvas to fit the frame to the stage width. */
  fitRequest: number;
  setZoom: (zoom: number) => void;
  setChrome: (chrome: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  requestFit: () => void;
}

export const useCanvasView = create<CanvasViewState>()((set, get) => ({
  ...loadView(),
  collapsed: false,
  fitRequest: 0,
  setZoom: (zoom) => {
    const z = clampZoom(zoom);
    if (z === get().zoom) return;
    set({ zoom: z });
    saveView({ zoom: z, chrome: get().chrome });
  },
  setChrome: (chrome) => {
    set({ chrome });
    saveView({ zoom: get().zoom, chrome });
  },
  setCollapsed: (collapsed) => set({ collapsed }),
  requestFit: () => set({ fitRequest: get().fitRequest + 1 }),
}));

export interface InlineEditState {
  nodeId: NodeId;
  /** Text when editing started (raw template string). */
  initial: string;
  /** Box in the zoom surface's local (unscaled) coordinates. */
  box: { left: number; top: number; width: number; height: number };
  /** Typography copied from the edited element. */
  style: Record<string, string>;
}

export interface MenuState {
  x: number;
  y: number;
  /** Node the menu is about; null for the canvas background menu. */
  nodeId: NodeId | null;
}

interface CanvasUiState {
  menu: MenuState | null;
  editing: InlineEditState | null;
  /** Node whose subtree is being saved as a block (name prompt open). */
  saveBlockFor: NodeId | null;
  openMenu: (menu: MenuState) => void;
  closeMenu: () => void;
  setEditing: (editing: InlineEditState | null) => void;
  setSaveBlockFor: (id: NodeId | null) => void;
}

export const useCanvasUi = create<CanvasUiState>()((set) => ({
  menu: null,
  editing: null,
  saveBlockFor: null,
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setEditing: (editing) => set({ editing }),
  setSaveBlockFor: (saveBlockFor) => set({ saveBlockFor }),
}));
