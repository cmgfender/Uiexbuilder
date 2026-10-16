import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createProject } from '../model/factory';
import { saveProject } from '../model/persistence';
import { useEditor } from '../model/store';
import {
  AUTOSAVE_DEBOUNCE_MS,
  BOOT_SETTLE_MS,
  bootstrapEditor,
  dismissWelcome,
  isWelcomeDismissed,
  loadStoredVersion,
  pruneOrphanLiveData,
  readBootGuard,
  reportEditorCrash,
  resumeAutosave,
  saveCurrentProject,
  useAutosave,
  useBootSettled,
} from './persistence';
import { PREF_KEYS } from './prefs';
import { LIVE_DATA_KEY_PREFIX, resetLiveDataForTests, useLiveData } from '../connect/records';
import { loadLayout, useShell } from './shellStore';
import { resetEditor, rootChildren } from './testUtils';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('persistence', () => {
  it('restores the last saved project and the stored layout on startup', () => {
    resetEditor();
    const saved = createProject('Restored App');
    saveProject(saved);
    window.localStorage.setItem(
      PREF_KEYS.layout,
      JSON.stringify({ leftCollapsed: true, rightCollapsed: false, bottomHeight: 333, bottomTab: 'console', bottomOpen: true }),
    );
    bootstrapEditor({ force: true });
    expect(useEditor.getState().project.id).toBe(saved.id);
    expect(useShell.getState().leftCollapsed).toBe(true);
    expect(useShell.getState().bottomHeight).toBe(333);
    expect(useEditor.getState().bottomPanel).toBe('console');
    expect(useShell.getState().saveStatus).toBe('saved');
  });

  it('falls back to the default project when nothing is saved', () => {
    resetEditor();
    const before = useEditor.getState().project.id;
    bootstrapEditor({ force: true });
    expect(useEditor.getState().project.id).toBe(before);
    expect(useShell.getState().saveStatus).toBe('idle');
  });

  it('autosaves 500ms after the last change and persists layout changes', async () => {
    resetEditor();
    const { unmount } = renderHook(() => useAutosave());
    const id = useEditor.getState().project.id;
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    expect(useShell.getState().saveStatus).toBe('pending');
    expect(window.localStorage.getItem(`uiex-builder:project:${id}`)).toBeNull();
    await act(() => wait(AUTOSAVE_DEBOUNCE_MS + 50));
    expect(useShell.getState().saveStatus).toBe('saved');
    const stored = JSON.parse(window.localStorage.getItem(`uiex-builder:project:${id}`)!);
    expect(stored.extensions[0].nodes[stored.extensions[0].rootId].children).toHaveLength(0);

    act(() => useShell.getState().setBottomHeight(410));
    act(() => useEditor.getState().setBottomPanel('problems'));
    expect(loadLayout()).toMatchObject({ bottomHeight: 410, bottomTab: 'problems', bottomOpen: true });
    unmount();
  });

  it('keeps the live-data choice of the untouched starter project across a reload (saves it on the first choice)', () => {
    resetEditor();
    resetLiveDataForTests();
    useShell.getState().setSaveStatus('idle');
    const { unmount } = renderHook(() => useAutosave());
    const id = useEditor.getState().project.id;
    act(() => useLiveData.getState().loadProject(id));
    expect(window.localStorage.getItem(`uiex-builder:project:${id}`)).toBeNull();
    act(() => useLiveData.getState().setMode('live'));
    // Saved right away, so the next start restores this project (and its id's live-data choice).
    expect(window.localStorage.getItem(`uiex-builder:project:${id}`)).not.toBeNull();
    expect(window.localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}${id}`)).toContain('"live"');
    expect(useShell.getState().saveStatus).toBe('saved');
    unmount();
    resetLiveDataForTests();
    bootstrapEditor({ force: true });
    expect(useEditor.getState().project.id).toBe(id);
  });

  it('removes live-data choices of projects that no longer exist', () => {
    resetEditor();
    const kept = createProject('Kept');
    saveProject(kept);
    window.localStorage.setItem(`${LIVE_DATA_KEY_PREFIX}${kept.id}`, '{"v":1,"mode":"live","records":{}}');
    window.localStorage.setItem(`${LIVE_DATA_KEY_PREFIX}p_gone`, '{"v":1,"mode":"live","records":{}}');
    window.localStorage.setItem(`${LIVE_DATA_KEY_PREFIX}p_open`, '{"v":1,"mode":"live","records":{}}');
    expect(pruneOrphanLiveData('p_open')).toBe(1);
    expect(window.localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}p_gone`)).toBeNull();
    expect(window.localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}${kept.id}`)).not.toBeNull();
    expect(window.localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}p_open`)).not.toBeNull();
  });

  it('guards startup: a project that never settled or crashed is not restored again', async () => {
    resetEditor();
    const saved = createProject('Fragile App');
    saveProject(saved);
    const res = bootstrapEditor({ force: true, search: '' });
    expect(res).toEqual({ kind: 'restored', projectId: saved.id });
    expect(readBootGuard()).toMatchObject({ projectId: saved.id, reason: 'boot' });

    // The page died before the editor settled: the next start shows the recovery screen.
    resetEditor();
    saveProject(saved);
    window.localStorage.setItem('uiex-builder:boot-guard', JSON.stringify({ projectId: saved.id, reason: 'boot', at: '' }));
    const before = useEditor.getState().project.id;
    const next = bootstrapEditor({ force: true, search: '' });
    expect(next).toMatchObject({ kind: 'recovery', safeMode: false, guard: { projectId: saved.id } });
    expect(useEditor.getState().project.id).toBe(before);

    // After the editor ran for a moment the guard is cleared.
    resetEditor();
    saveProject(saved);
    bootstrapEditor({ force: true, search: '' });
    const { unmount } = renderHook(() => useBootSettled());
    await act(() => wait(BOOT_SETTLE_MS + 50));
    expect(readBootGuard()).toBeNull();
    unmount();

    // Leaving the page normally right after opening is not a failed start either.
    bootstrapEditor({ force: true, search: '' });
    const second = renderHook(() => useBootSettled());
    expect(readBootGuard()).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(readBootGuard()).toBeNull();
    second.unmount();
  });

  it('?safe=1 starts without restoring the last project', () => {
    resetEditor();
    const saved = createProject('Last App');
    saveProject(saved);
    const res = bootstrapEditor({ force: true, search: '?safe=1' });
    expect(res).toMatchObject({ kind: 'recovery', safeMode: true, guard: null });
    expect(useEditor.getState().project.id).not.toBe(saved.id);
  });

  it('a crash suspends autosave: the broken document is not flushed on unmount', () => {
    resetEditor();
    const { unmount } = renderHook(() => useAutosave());
    const id = useEditor.getState().project.id;
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    reportEditorCrash(new Error('boom'));
    unmount();
    expect(window.localStorage.getItem(`uiex-builder:project:${id}`)).toBeNull();
    expect(readBootGuard()).toMatchObject({ projectId: id, reason: 'crash', message: 'boom' });
    resumeAutosave();
  });

  it('never overwrites a version another tab saved; asks instead', async () => {
    resetEditor();
    const { unmount } = renderHook(() => useAutosave());
    const project = useEditor.getState().project;
    const key = `uiex-builder:project:${project.id}`;
    act(() => {
      saveCurrentProject();
    });
    // Another tab saves its own edit of the same project.
    const other = { ...project, name: 'Edited elsewhere', updatedAt: '2099-01-01T00:00:00.000Z' };
    window.localStorage.setItem(key, JSON.stringify(other));
    // This tab edits; autosave must hold back.
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    await act(() => wait(AUTOSAVE_DEBOUNCE_MS + 50));
    expect(JSON.parse(window.localStorage.getItem(key)!).name).toBe('Edited elsewhere');
    expect(useShell.getState().saveStatus).toBe('conflict');
    expect(useShell.getState().conflict).toMatchObject({ projectId: project.id });

    // Loading the latest version resolves it.
    act(() => {
      loadStoredVersion();
    });
    expect(useEditor.getState().project.name).toBe('Edited elsewhere');
    expect(useShell.getState().conflict).toBeNull();
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    await act(() => wait(AUTOSAVE_DEBOUNCE_MS + 50));
    expect(useShell.getState().saveStatus).toBe('saved');
    unmount();
  });

  it('a storage event from another tab raises the conflict right away; "keep mine" overwrites', () => {
    resetEditor();
    const { unmount } = renderHook(() => useAutosave());
    const project = useEditor.getState().project;
    const key = `uiex-builder:project:${project.id}`;
    const theirs = JSON.stringify({ ...project, updatedAt: '2099-01-01T00:00:00.000Z' });
    window.localStorage.setItem(key, theirs);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: theirs }));
    });
    expect(useShell.getState().conflict).toMatchObject({ projectId: project.id });
    // Our own write echoed back is not a conflict.
    act(() => useShell.getState().setConflict(null));
    act(() => {
      expect(saveCurrentProject({ force: true })).toBe('saved');
    });
    const ours = window.localStorage.getItem(key)!;
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: ours }));
    });
    expect(useShell.getState().conflict).toBeNull();
    expect(JSON.parse(ours).updatedAt).toBe(project.updatedAt);
    unmount();
  });

  it('remembers that the welcome card was dismissed', () => {
    resetEditor();
    expect(isWelcomeDismissed()).toBe(false);
    dismissWelcome();
    expect(isWelcomeDismissed()).toBe(true);
  });
});
