/**
 * Per-browser shell preferences (layout, palette state, first-visit flags). Every storage access is
 * wrapped in try/catch: the editor must work when storage is unavailable (private windows, tests).
 */

export const PREF_KEYS = {
  layout: 'uiex-builder:shell-layout',
  recentComponents: 'uiex-builder:palette-recent',
  collapsedCategories: 'uiex-builder:palette-collapsed',
  welcomeDismissed: 'uiex-builder:welcome-dismissed',
  codeFormat: 'uiex-builder:code-format',
} as const;

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

export function removePref(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
