/**
 * Inspector preferences kept in this browser: whether settings show their help text (a short
 * description under each setting). On by default; power users can hide it from the inspector
 * header.
 */
import { create } from 'zustand';

const KEY = 'uiex-builder:inspector-help';

function readShowHelp(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

interface InspectorPrefs {
  showHelp: boolean;
  setShowHelp: (on: boolean) => void;
}

export const useInspectorPrefs = create<InspectorPrefs>()((set) => ({
  showHelp: readShowHelp(),
  setShowHelp: (on) => {
    try {
      if (on) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, 'off');
    } catch {
      /* storage unavailable: keep the choice for this session */
    }
    set({ showHelp: on });
  },
}));
