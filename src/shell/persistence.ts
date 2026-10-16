/**
 * Startup loading, autosave, crash recovery and cross-tab safety.
 *
 * * **Startup**: the last project saved in this browser is restored (falling back to the default
 *   project) — unless the previous session crashed or never finished loading it (the *boot
 *   guard*), or the page was opened with `?safe=1`. Then the app starts on the recovery screen
 *   instead of restoring a document that would crash it again.
 * * **Boot guard** (`uiex-builder:boot-guard`): written before a project is opened at startup and
 *   cleared once the editor has rendered it and settled (`markEditorSettled`); the top-level error
 *   boundary writes it when the editor crashes. A guard still present at startup means "don't
 *   auto-restore this project".
 * * **Autosave**: every document change is saved 500 ms after the last edit. Autosave is suspended
 *   while the editor is crashed, so a document that broke rendering is never flushed on unmount.
 * * **Other tabs**: every version of the open project this tab has had is remembered by its
 *   `updatedAt` stamp. When the stored copy carries a stamp this tab never had, another tab or
 *   window saved it: the save is held back and the shell asks which version to keep (see
 *   ProjectConflictDialog). A `storage` event raises the same question as soon as the other tab
 *   saves. A first-visit flag drives the welcome card.
 * * **Live data choice**: choosing Live data or a sample record saves a project that was never
 *   saved (the untouched starter project), so the choice — stored per project id — survives a
 *   reload. Choices stored for projects that no longer exist are removed at startup.
 */
import { useEffect } from 'react';
import { createProject } from '../model/factory';
import { newId } from '../model/ids';
import { loadLastProject, loadSavedProject, saveProjectResult } from '../model/persistence';
import { useEditor } from '../model/store';
import { copyCodeTrust } from '../model/trust';
import type { Project } from '../model/types';
import { LIVE_DATA_KEY_PREFIX, useLiveData } from '../connect/records';
import { PREF_KEYS, readPref, removePref, writePref } from './prefs';
import { applyStoredLayout, persistLayoutChanges, useShell } from './shellStore';

export const AUTOSAVE_DEBOUNCE_MS = 500;
/**
 * How long after its first commit the editor must keep running before the boot guard is cleared.
 * Render errors are recorded by the error boundary itself ('crash'); the 'boot' guard only has to
 * outlive the first render (a hang there never commits), so this stays short — a quick reload
 * must not be mistaken for a failed start.
 */
export const BOOT_SETTLE_MS = 300;

/** Storage layout of model/persistence: one key per saved project document. */
const PROJECT_KEY_PREFIX = 'uiex-builder:project:';
const BOOT_GUARD_KEY = 'uiex-builder:boot-guard';

// ---------------------------------------------------------------------------
// Boot guard
// ---------------------------------------------------------------------------

export interface BootGuard {
  projectId: string;
  /** 'boot': opened at startup but the editor never settled; 'crash': the editor crashed with it open. */
  reason: 'boot' | 'crash';
  at: string;
  message?: string;
}

export function readBootGuard(): BootGuard | null {
  const raw = readPref<unknown>(BOOT_GUARD_KEY, null);
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  if (typeof g.projectId !== 'string') return null;
  return {
    projectId: g.projectId,
    reason: g.reason === 'crash' ? 'crash' : 'boot',
    at: typeof g.at === 'string' ? g.at : '',
    message: typeof g.message === 'string' ? g.message : undefined,
  };
}

export function writeBootGuard(projectId: string, reason: BootGuard['reason'], message?: string): void {
  writePref(BOOT_GUARD_KEY, { projectId, reason, at: new Date().toISOString(), ...(message ? { message: message.slice(0, 500) } : {}) });
}

export function clearBootGuard(): void {
  removePref(BOOT_GUARD_KEY);
}

/** The editor rendered the open project and kept running: it is safe to restore next time. */
export function markEditorSettled(): void {
  const guard = readBootGuard();
  if (guard && guard.reason === 'boot') clearBootGuard();
}

let autosaveSuspended = false;

/**
 * Called by the top-level error boundary: stops autosave (the crashing document must not be
 * flushed while the editor unmounts) and records the crash so the next startup doesn't reopen it.
 */
export function reportEditorCrash(error: unknown): void {
  autosaveSuspended = true;
  const message = error instanceof Error ? error.message : String(error);
  writeBootGuard(useEditor.getState().project.id, 'crash', message);
}

/** Resumes autosave after the user picked a way out of the recovery screen. */
export function resumeAutosave(): void {
  autosaveSuspended = false;
}

/**
 * Opens a project chosen on the recovery screen (guarded like a startup restore) and saves it
 * right away, so it — not the document that crashed — is what the next startup restores.
 */
export function openProjectFromRecovery(project: Project): void {
  writeBootGuard(project.id, 'boot');
  useEditor.getState().loadProject(project);
  resumeAutosave();
  saveCurrentProject({ force: true });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export type BootResult =
  | { kind: 'restored'; projectId: string }
  | { kind: 'fresh' }
  /** Not restored: the last session crashed with this project (guard) or safe mode was asked for. */
  | { kind: 'recovery'; guard: BootGuard | null; safeMode: boolean };

let bootstrapped = false;
let lastBoot: BootResult = { kind: 'fresh' };
/** The starter project a fresh start opened (nothing was restored), see isUntouchedStarterProject. */
let freshProjectId: string | null = null;

/**
 * The open project is the starter project of a fresh start that nobody edited — it may still have
 * been saved (choosing live data saves it), but it holds nothing of the person's.
 */
export function isUntouchedStarterProject(): boolean {
  const s = useEditor.getState();
  if (s.past.length > 0 || s.future.length > 0) return false;
  if (freshProjectId !== null && s.project.id === freshProjectId) return true;
  return useShell.getState().saveStatus === 'idle';
}

function isSafeMode(search: string): boolean {
  return /(?:^|[?&])safe(?:=(?:1|true|yes))?(?:&|$)/i.test(search);
}

/**
 * Loads the last project and the stored layout. Idempotent: only the first call does anything
 * (pass `force` in tests to run it again; `search` defaults to the page's query string).
 */
export function bootstrapEditor(opts: { force?: boolean; search?: string } = {}): BootResult {
  if (bootstrapped && !opts.force) return lastBoot;
  bootstrapped = true;
  applyStoredLayout();
  const search = opts.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const guard = readBootGuard();
  const safeMode = isSafeMode(search);
  if (guard || safeMode) {
    useShell.getState().setSaveStatus('idle');
    lastBoot = { kind: 'recovery', guard, safeMode };
    return lastBoot;
  }
  const last = loadLastProject();
  if (last) {
    writeBootGuard(last.id, 'boot');
    useEditor.getState().loadProject(last);
    const savedAt = Date.parse(last.updatedAt);
    useShell.setState({ saveStatus: 'saved', lastSavedAt: Number.isFinite(savedAt) ? savedAt : Date.now() });
    lastBoot = { kind: 'restored', projectId: last.id };
  } else {
    useShell.getState().setSaveStatus('idle');
    lastBoot = { kind: 'fresh' };
    freshProjectId = useEditor.getState().project.id;
  }
  pruneOrphanLiveData(useEditor.getState().project.id);
  return lastBoot;
}

/** Removes stored live-data choices of projects that are no longer saved in this browser. */
export function pruneOrphanLiveData(keepProjectId?: string): number {
  const storage = readStorage();
  if (!storage) return 0;
  const orphans: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(LIVE_DATA_KEY_PREFIX)) continue;
      const id = key.slice(LIVE_DATA_KEY_PREFIX.length);
      if (id !== keepProjectId && storage.getItem(PROJECT_KEY_PREFIX + id) === null) orphans.push(key);
    }
    for (const key of orphans) storage.removeItem(key);
  } catch {
    return 0;
  }
  return orphans.length;
}

// ---------------------------------------------------------------------------
// Versions written by this tab
// ---------------------------------------------------------------------------

const own = { projectId: '', stamps: new Set<string>() };

function readStorage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The raw stored document of a project (null when none). */
export function readStoredProjectText(id: string): string | null {
  try {
    return readStorage()?.getItem(PROJECT_KEY_PREFIX + id) ?? null;
  } catch {
    return null;
  }
}

/** `updatedAt` of a stored document text ('' when it has none or can't be read). */
function stampOf(text: string): string {
  try {
    const data = JSON.parse(text) as { updatedAt?: unknown } | null;
    return data && typeof data.updatedAt === 'string' ? data.updatedAt : '';
  } catch {
    return '';
  }
}

/** Records a version of the open project as this tab's own. */
function noteVersion(project: Project): void {
  if (project.id !== own.projectId) {
    own.projectId = project.id;
    own.stamps = new Set();
    // The stored copy at the moment this tab opens a project is the version it started from.
    const stored = readStoredProjectText(project.id);
    if (stored !== null) own.stamps.add(stampOf(stored));
  }
  own.stamps.add(project.updatedAt ?? '');
}

/** True when another tab / window saved the open project since this tab last saw it. */
export function storedByAnotherTab(project: Project): boolean {
  if (own.projectId !== project.id) return false;
  const stored = readStoredProjectText(project.id);
  if (stored === null) return false;
  return !own.stamps.has(stampOf(stored));
}

function raiseConflict(projectId: string): void {
  const current = useShell.getState().conflict;
  if (!current || current.projectId !== projectId) useShell.getState().setConflict({ projectId });
  useShell.getState().setSaveStatus('conflict');
}

export type SaveOutcome = 'saved' | 'error' | 'conflict';

/**
 * Saves the open project unless another tab saved a different version of it meanwhile (then the
 * conflict dialog asks what to do). `force` overwrites the other tab's version.
 */
export function saveCurrentProject(opts: { force?: boolean } = {}): SaveOutcome {
  const project = useEditor.getState().project;
  noteVersion(project);
  if (!opts.force) {
    const conflict = useShell.getState().conflict;
    if ((conflict && conflict.projectId === project.id) || storedByAnotherTab(project)) {
      raiseConflict(project.id);
      return 'conflict';
    }
  }
  const result = saveProjectResult(project);
  if (result.ok) {
    // Overwriting accepts the stored version as seen.
    own.stamps.add(project.updatedAt ?? '');
    useShell.getState().setConflict(null);
    useShell.getState().setSaveStatus('saved');
    return 'saved';
  }
  useShell.getState().setSaveStatus('error', result.reason);
  return 'error';
}

/** Why the last save failed, for toasts and the save indicator. */
export function saveErrorMessage(reason = useShell.getState().saveError): string {
  if (reason === 'quota') {
    return 'Browser storage is full — delete old projects (Project › Open…) or download a .uiex.json to keep your work';
  }
  if (reason === 'unavailable') return 'Browser storage is unavailable — download a .uiex.json to keep your work';
  return 'The project could not be saved in this browser — download a .uiex.json to keep your work';
}

/** Conflict resolution: replace this tab's copy with the version stored by the other tab. */
export function loadStoredVersion(): boolean {
  const id = useEditor.getState().project.id;
  const latest = loadSavedProject(id);
  if (!latest) return false;
  const state = useEditor.getState();
  const selected = state.selectedNodeId;
  const activeExt = state.activeExtensionId;
  own.projectId = '';
  state.loadProject(latest);
  // Keep the user's place when the other version still has it.
  if (latest.extensions.some((e) => e.id === activeExt)) {
    useEditor.getState().setActiveExtension(activeExt);
    const ext = latest.extensions.find((e) => e.id === activeExt);
    if (selected && ext?.nodes[selected]) useEditor.getState().select(selected);
  }
  noteVersion(useEditor.getState().project);
  useShell.getState().setConflict(null);
  useShell.getState().setSaveStatus('saved');
  return true;
}

/** Conflict resolution: keep this tab's version under a new project id (the other stays as saved). */
export function saveOpenProjectAsCopy(): SaveOutcome {
  const project = useEditor.getState().project;
  const copy = copyOfProject(project);
  useShell.getState().setConflict(null);
  useEditor.getState().loadProject(copy);
  return saveCurrentProject();
}

/** A copy of a project with a fresh id (and "(copy)" after its name). Trust carries over. */
export function copyOfProject(project: Project, suffix = ' (copy)'): Project {
  const copy: Project = { ...project, id: newId('p'), name: `${project.name || 'Project'}${suffix}`, updatedAt: new Date().toISOString() };
  copyCodeTrust(project.id, copy.id);
  return copy;
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/** Saves the project after edits (debounced) and persists layout changes. Mount once. */
export function useAutosave(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (autosaveSuspended) return;
      saveCurrentProject();
    };
    noteVersion(useEditor.getState().project);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      if (s.project.id !== prev.project.id) useShell.getState().setConflict(null);
      noteVersion(s.project);
      if (autosaveSuspended) return;
      if (useShell.getState().conflict) return; // held until the user decides (see ProjectConflictDialog)
      useShell.getState().setSaveStatus('pending');
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    });
    const unsubLayout = persistLayoutChanges();
    // Live data / a sample record chosen on a project that was never saved (the untouched starter
    // project): save it now, so the choice (stored under its id) is still there after a reload.
    const unsubLive = useLiveData.subscribe((s, prev) => {
      if (s.projectId !== prev.projectId || s.projectId !== useEditor.getState().project.id) return;
      if (s.mode === prev.mode && s.recordByExtension === prev.recordByExtension) return;
      if (autosaveSuspended || useShell.getState().conflict || useShell.getState().saveStatus !== 'idle') return;
      saveCurrentProject();
    });
    const onUnload = () => {
      if (timer) flush();
    };
    // Another tab saved the open project: ask before this tab overwrites it.
    const onStorage = (e: StorageEvent) => {
      const project = useEditor.getState().project;
      if (e.key !== PROJECT_KEY_PREFIX + project.id || e.newValue === null) return;
      if (own.projectId === project.id && own.stamps.has(stampOf(e.newValue))) return;
      if (timer) clearTimeout(timer);
      timer = null;
      raiseConflict(project.id);
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('storage', onStorage);
    return () => {
      unsub();
      unsubLayout();
      unsubLive();
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('storage', onStorage);
      // Don't lose the last edit when the shell unmounts — unless it unmounts because it crashed.
      if (timer) flush();
    };
  }, []);
}

/**
 * Clears the boot guard once the editor has run for a moment without crashing, or when the page
 * is left normally before that (a reload right after opening is not a failed start). Mount once.
 */
export function useBootSettled(): void {
  useEffect(() => {
    const t = setTimeout(markEditorSettled, BOOT_SETTLE_MS);
    window.addEventListener('pagehide', markEditorSettled);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pagehide', markEditorSettled);
    };
  }, []);
}

/** A blank project for the recovery screen. */
export function blankProject(): Project {
  return createProject();
}

export function isWelcomeDismissed(): boolean {
  return readPref<boolean>(PREF_KEYS.welcomeDismissed, false) === true;
}

export function dismissWelcome(): void {
  writePref(PREF_KEYS.welcomeDismissed, true);
}
