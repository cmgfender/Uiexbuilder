/**
 * Finishing the guided setup: creates the project with the chosen card (record type and location
 * set), opens it, remembers the sample record and switches the preview to live data when HubSpot is
 * connected. The untouched starter project is replaced; real work is saved first and stays in
 * Project › Open….
 */
import { createProject } from '../model/factory';
import { deleteSavedProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { ROOT_TYPE, type Extension, type NodeId, type Project } from '../model/types';
import { useLiveData } from '../connect/records';
import type { CrmRecordSummary } from '../connect/types';
import { isUntouchedStarterProject, readStoredProjectText, saveCurrentProject } from '../shell/persistence';
import { FIRST_RUN_APP_NAME, type StarterOption } from './starters';

export interface FinishSetupInput {
  starter: StarterOption;
  /** The connected account (live data), or null for sample data. */
  portalId: number | null;
  record: CrmRecordSummary | null;
}

export type FinishSetupResult =
  | { ok: true; project: Project; extensionId: string; keptPrevious: boolean }
  | { ok: false; message: string };

/** The open project is the untouched starter project (nothing of the person's in it). */
export function openProjectIsPristine(): boolean {
  return isUntouchedStarterProject();
}

/** The first text the admin can edit (a heading or text), else the first component. */
export function firstEditableNode(ext: Extension): NodeId | null {
  const root = ext.nodes[ext.rootId];
  if (!root) return null;
  const queue: NodeId[] = [...root.children];
  while (queue.length) {
    const id = queue.shift()!;
    const node = ext.nodes[id];
    if (!node || node.type === ROOT_TYPE) continue;
    if (node.type === 'Heading' || node.type === 'Text') return id;
    queue.push(...node.children);
  }
  return root.children[0] ?? null;
}

export function finishSetup(input: FinishSetupInput): FinishSetupResult {
  const pristine = openProjectIsPristine();
  const previousId = useEditor.getState().project.id;
  if (!pristine && saveCurrentProject() === 'conflict') {
    return { ok: false, message: 'The open project changed in another tab — choose which version to keep first.' };
  }
  const project = createProject(FIRST_RUN_APP_NAME, []);
  const { extension, functions } = input.starter.create(project);
  project.extensions = [extension];
  project.functions = functions;

  const editor = useEditor.getState();
  editor.loadProject(project);
  editor.setMode('design');
  // The untouched starter project may have been saved (choosing live data saves it): it holds
  // nothing of the admin's, so it doesn't stay behind in Project › Open….
  if (pristine && readStoredProjectText(previousId) !== null) deleteSavedProject(previousId);

  // Preview data for the new project: live with the picked record when connected, else mock.
  const live = useLiveData.getState();
  live.loadProject(project.id);
  if (input.portalId !== null) {
    live.setMode('live');
    if (input.record) live.setRecord(extension.id, input.record, input.portalId);
  } else {
    live.setMode('mock');
  }

  // Nothing selected: the inspector shows the card's settings in plain words (not a component's
  // expression), and a click on a component in the palette adds it at the end of the card
  // instead of squeezing it in next to whatever happened to be selected.
  useEditor.getState().select(null);
  return { ok: true, project, extensionId: extension.id, keptPrevious: !pristine };
}
