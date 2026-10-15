/**
 * UI state of the power module: whether the command palette is open, and a one-shot request to
 * reveal (expand + focus) a computed value in the Data panel (e.g. after "Add computed value").
 */
import { create } from 'zustand';

interface PowerUiState {
  paletteOpen: boolean;
  /** Computed value id the ComputedSection should expand and focus (cleared once handled). */
  revealComputedId: string | null;
  /** Bumped to ask the HelpersSection to focus its editor. */
  helpersFocusNonce: number;
  setPaletteOpen: (open: boolean) => void;
  revealComputed: (id: string | null) => void;
  focusHelpers: () => void;
}

export const usePowerUi = create<PowerUiState>()((set) => ({
  paletteOpen: false,
  revealComputedId: null,
  helpersFocusNonce: 0,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  revealComputed: (revealComputedId) => set({ revealComputedId }),
  focusHelpers: () => set((s) => ({ helpersFocusNonce: s.helpersFocusNonce + 1 })),
}));

/** Opens the command palette (same as pressing ⌘K / Ctrl+K). */
export function openCommandPalette(): void {
  usePowerUi.getState().setPaletteOpen(true);
}

/** Closes the command palette. */
export function closeCommandPalette(): void {
  usePowerUi.getState().setPaletteOpen(false);
}
