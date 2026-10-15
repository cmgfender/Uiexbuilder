/**
 * Startup loading and autosave. On startup the last project saved in this browser is restored
 * (falling back to the default project); afterwards every document change is saved 500 ms after
 * the last edit. A first-visit flag drives the welcome card.
 */
import { useEffect } from 'react';
import { useEditor } from '../model/store';
import { loadLastProject, saveProject } from '../model/persistence';
import { PREF_KEYS, readPref, writePref } from './prefs';
import { applyStoredLayout, persistLayoutChanges, useShell } from './shellStore';

export const AUTOSAVE_DEBOUNCE_MS = 500;

let bootstrapped = false;

/**
 * Loads the last project and the stored layout. Idempotent: only the first call does anything
 * (pass `force` in tests to run it again).
 */
export function bootstrapEditor(opts: { force?: boolean } = {}): void {
  if (bootstrapped && !opts.force) return;
  bootstrapped = true;
  const last = loadLastProject();
  if (last) {
    useEditor.getState().loadProject(last);
    const savedAt = Date.parse(last.updatedAt);
    useShell.setState({ saveStatus: 'saved', lastSavedAt: Number.isFinite(savedAt) ? savedAt : Date.now() });
  } else {
    useShell.getState().setSaveStatus('idle');
  }
  applyStoredLayout();
}

/** Saves the project after edits (debounced) and persists layout changes. Mount once. */
export function useAutosave(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const ok = saveProject(useEditor.getState().project);
      useShell.getState().setSaveStatus(ok ? 'saved' : 'error');
    };
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      useShell.getState().setSaveStatus('pending');
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });
    const unsubLayout = persistLayoutChanges();
    const onUnload = () => {
      if (timer) flush();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      unsubLayout();
      window.removeEventListener('beforeunload', onUnload);
      // Don't lose the last edit when the shell unmounts.
      if (timer) flush();
    };
  }, []);
}

export function isWelcomeDismissed(): boolean {
  return readPref<boolean>(PREF_KEYS.welcomeDismissed, false) === true;
}

export function dismissWelcome(): void {
  writePref(PREF_KEYS.welcomeDismissed, true);
}
