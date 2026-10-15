import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createProject } from '../model/factory';
import { saveProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { AUTOSAVE_DEBOUNCE_MS, bootstrapEditor, dismissWelcome, isWelcomeDismissed, useAutosave } from './persistence';
import { PREF_KEYS } from './prefs';
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

  it('remembers that the welcome card was dismissed', () => {
    resetEditor();
    expect(isWelcomeDismissed()).toBe(false);
    dismissWelcome();
    expect(isWelcomeDismissed()).toBe(true);
  });
});
