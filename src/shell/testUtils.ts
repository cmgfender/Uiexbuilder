/** Test helpers for shell tests (not imported by app code). */
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import type { NodeTemplate, Project } from '../model/types';
import { useDialogs } from './dialogs';
import { useProblems } from './problems';
import { useShell } from './shellStore';
import { resetRecentComponentsCache } from './paletteModel';

/** Resets every store to a fresh project (optionally with given top-level content). */
export function resetEditor(project?: Project): Project {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  resetRecentComponentsCache();
  const p = project ?? createProject();
  useEditor.getState().loadProject(p);
  useEditor.setState({
    clipboard: null,
    mode: 'design',
    leftPanel: 'components',
    rightPanel: 'properties',
    bottomPanel: null,
    previewResetKey: 0,
  });
  useDialogs.getState().close();
  useProblems.getState().setIssues([]);
  useShell.setState({ leftCollapsed: false, rightCollapsed: false, saveStatus: 'idle', paletteFocusNonce: 0 });
  return p;
}

/** A project with one card whose root holds the given templates. */
export function projectWith(content: NodeTemplate[], kind: 'card' | 'settings' | 'home' = 'card'): Project {
  const ext = createExtension({ kind, name: kind === 'card' ? 'Test Card' : undefined, content });
  return createProject('Test App', [ext]);
}

/** Active extension's root children ids. */
export function rootChildren(): string[] {
  const s = useEditor.getState();
  const ext = s.project.extensions.find((e) => e.id === s.activeExtensionId)!;
  return ext.nodes[ext.rootId].children;
}

export function activeNodes() {
  const s = useEditor.getState();
  return s.project.extensions.find((e) => e.id === s.activeExtensionId)!.nodes;
}
