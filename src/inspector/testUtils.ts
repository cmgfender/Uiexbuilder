/** Test helpers for inspector tests (not imported by app code). */
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import type { Extension, NodeTemplate, Project, UINode } from '../model/types';
import { useSectionStore } from './Section';

/** Loads a project with one extension holding `content`; returns the project. */
export function loadWith(content: NodeTemplate[], kind: 'card' | 'settings' | 'home' = 'card', patch: Partial<Extension> = {}): Project {
  const ext = { ...createExtension({ kind, name: 'Test Card', content }), ...patch };
  const project = createProject('Test App', [ext]);
  useEditor.getState().loadProject(project);
  useEditor.setState({ rightPanel: 'properties', selectedNodeId: null, clipboard: null });
  useSectionStore.setState({ open: {} });
  return project;
}

export function ext(): Extension {
  return selectActiveExtension(useEditor.getState());
}

/** The n-th top-level node. */
export function topNode(n = 0): UINode {
  const e = ext();
  return e.nodes[e.nodes[e.rootId].children[n]];
}

export function nodeById(id: string): UINode {
  return ext().nodes[id];
}

export function selectTop(n = 0): UINode {
  const node = topNode(n);
  useEditor.getState().select(node.id);
  return node;
}
