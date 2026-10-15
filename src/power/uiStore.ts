/**
 * UI state of the power module: whether the command palette is open, and one-shot requests to
 * reveal (expand + scroll to + focus) a computed value or the helpers editor in the Data panel —
 * e.g. after "Add computed value" / "Edit helper functions" in the palette, or from a problem.
 * The sections consume a request once they have rendered the field, so a request made while the
 * Data panel is still closed is handled when it opens (and only once).
 */
import { create } from 'zustand';

interface PowerUiState {
  paletteOpen: boolean;
  /** Computed value id the ComputedSection should expand and focus (cleared once handled). */
  revealComputedId: string | null;
  /** The HelpersSection should expand, scroll into view and focus its editor (cleared once handled). */
  helpersFocusPending: boolean;
  setPaletteOpen: (open: boolean) => void;
  revealComputed: (id: string | null) => void;
  /** Asks the Data panel's Helpers section to expand and focus its code editor. */
  focusHelpers: () => void;
  /** Marks the helpers focus request as handled. */
  clearHelpersFocus: () => void;
}

export const usePowerUi = create<PowerUiState>()((set) => ({
  paletteOpen: false,
  revealComputedId: null,
  helpersFocusPending: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  revealComputed: (revealComputedId) => set({ revealComputedId }),
  focusHelpers: () => set({ helpersFocusPending: true }),
  clearHelpersFocus: () => set({ helpersFocusPending: false }),
}));

/** Opens the command palette (same as pressing ⌘K / Ctrl+K). */
export function openCommandPalette(): void {
  usePowerUi.getState().setPaletteOpen(true);
}

/** Closes the command palette. */
export function closeCommandPalette(): void {
  usePowerUi.getState().setPaletteOpen(false);
}
