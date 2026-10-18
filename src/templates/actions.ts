/**
 * Template flows used by the Templates panel, the new-project dialog and the command palette:
 * insert a block (adding the state it needs in the same undo step), add a starter extension to the
 * project, replace the active extension with a starter, and create a project from a starter.
 */
import type { Draft } from 'immer';
import { setBlockAnchor, smartInsertTarget } from '../dnd/dragState';
import { createProject } from '../model/factory';
import { newId } from '../model/ids';
import { canAccept } from '../model/rules';
import { selectActiveExtension, unavailableComponents, useEditor } from '../model/store';
import { insertSubtree, instantiateTemplate, type InsertTarget } from '../model/tree';
import type { AppFunction, DataSource, Extension, NodeId, NodeTemplate, Project, StateVar, UINode } from '../model/types';
import { appFunctionsUnsupported } from '../model/validate';
import { getComponent } from '../registry';
import { freshBlockTemplate, instantiateExtensionTemplate, templateConflict, type BlockTemplate, type ExtensionTemplate } from './catalog';

export type FlowResult<T = undefined> = { ok: true; value: T; message: string } | { ok: false; message: string };

/** A note for the confirmation when a starter brings app functions the app can't upload. */
function functionSupportNote(project: Project, functions: AppFunction[]): string {
  const problem = functions.length ? appFunctionsUnsupported(project) : null;
  return problem ? ` Note: ${problem} — see Problems.` : '';
}

function kindLabel(ext: Extension): string {
  return ext.kind === 'settings' ? 'settings page' : ext.kind === 'home' ? 'app home page' : 'card';
}

/**
 * Inserts a block into the active extension at `at` (a drop target) or else the smart insert
 * target (inside the selected container, after the selection, or at the end). Missing state
 * variables (by name) are added in the same undo step. Overlay ids are made unique first.
 */
/** “A”, “A and B”, “A, B and C”. */
function listLabels(labels: string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * A block ready to insert into the active card: data blocks (`create`) are built for it (their
 * data sources get names that don't clash), other blocks are used as they are.
 */
export function prepareBlock(block: Pick<BlockTemplate, 'template' | 'state' | 'create'>): {
  template: NodeTemplate;
  state: Array<Omit<StateVar, 'id'>> | undefined;
  dataSources: DataSource[];
} {
  const editor = useEditor.getState();
  const ext = selectActiveExtension(editor);
  if (block.create && ext) {
    const built = block.create(ext, editor.project);
    return { template: built.template, state: block.state, dataSources: built.dataSources };
  }
  return { template: block.template, state: block.state, dataSources: [] };
}

/**
 * `dataSources`: data sources the block reads (from `prepareBlock`), added in the same undo step;
 * one whose name is already declared is skipped.
 */
export function insertBlock(
  template: NodeTemplate,
  state: Array<Omit<StateVar, 'id'>> | undefined,
  label: string,
  at?: InsertTarget,
  dataSources: DataSource[] = [],
): FlowResult<NodeId> {
  const editor = useEditor.getState();
  const ext = selectActiveExtension(editor);
  if (!ext) return { ok: false, message: 'There is no card to add the block to.' };
  const tpl = freshBlockTemplate(template, ext);
  const unavailable = unavailableComponents(ext, tpl);
  if (unavailable.length) {
    return { ok: false, message: `“${label}” contains ${listLabels(unavailable)}, which ${unavailable.length === 1 ? 'isn’t' : 'aren’t'} available on this ${kindLabel(ext)}.` };
  }
  let target: InsertTarget | null;
  if (at) {
    const check = canAccept(ext, at.parentId, tpl.type, at.slot);
    if (!check.ok) return { ok: false, message: `“${label}” can’t go here${check.reason ? `: ${check.reason.replace(/\.$/, '')}` : ''}.` };
    target = at;
  } else {
    target = smartInsertTarget(ext, editor.selectedNodeId, tpl.type);
  }
  if (!target) {
    const reason = canAccept(ext, ext.rootId, tpl.type).reason;
    return { ok: false, message: `“${label}” can’t be added to this ${kindLabel(ext)}${reason ? `: ${reason.replace(/\.$/, '')}` : ''}.` };
  }
  const taken = new Set([...ext.state.map((s) => s.name), ...ext.dataSources.map((d) => d.name), ...(ext.computed ?? []).map((c) => c.name)]);
  const missing = (state ?? []).filter((v) => !taken.has(v.name));
  const sources = dataSources.filter((ds) => !taken.has(ds.name) && !ext.dataSources.some((x) => x.id === ds.id));
  const sub = instantiateTemplate(tpl);
  editor.commit((d) => {
    const draft = d.extensions.find((e) => e.id === ext.id);
    if (!draft) return;
    for (const v of missing) {
      draft.state.push({ ...(JSON.parse(JSON.stringify(v)) as Omit<StateVar, 'id'>), id: newId('s') } as Draft<StateVar>);
    }
    for (const ds of sources) draft.dataSources.push(JSON.parse(JSON.stringify(ds)) as Draft<DataSource>);
    insertSubtree(draft as Extension, sub, target);
  });
  const live = selectActiveExtension(useEditor.getState());
  const main = live ? mainComponentOf(live, sub.rootId) : sub.rootId;
  useEditor.getState().select(main);
  if (main !== sub.rootId) anchorAfterBlock(main, sub.rootId);
  const added = missing.length ? ` and state ${missing.map((v) => `“${v.name}”`).join(', ')}` : '';
  const mainNode = main !== sub.rootId && live ? live.nodes[main] : undefined;
  const editing = mainNode ? ` Its ${(getComponent(mainNode.type)?.label ?? mainNode.type).toLowerCase()} is selected: change it on the right.` : '';
  return { ok: true, value: sub.rootId, message: `Added “${label}”${added}.${editing}` };
}

/** Layout wrappers and plain text: never the "main" component of a block. */
const WRAPPER_TYPES = new Set(['Flex', 'Box', 'Inline', 'AutoGrid', 'Text', 'Heading', 'Divider', 'Spacer']);
/** Loading / error / empty placeholders: the main component only when nothing else is there. */
const STATE_TYPES = new Set(['LoadingSpinner', 'ErrorState', 'EmptyState']);

/** Lower is more likely what the person wants to edit: content, then actions, then placeholders. */
function mainRank(n: UINode): number {
  // A conditional alert is an error / status message, like the placeholders.
  if (STATE_TYPES.has(n.type) || (n.type === 'Alert' && !!n.condition)) return 3;
  return getComponent(n.type)?.category === 'Buttons & links' ? 2 : 1;
}

/**
 * The component a person most likely wants to edit after inserting a block: the block itself
 * unless it is a plain layout wrapper; inside a wrapper, its first real content (e.g. the progress
 * bar of "Progress tracker", the table of "Associated records"), else its first button, else a
 * loading / error / empty placeholder. A wrapper of only layout and text stays selected.
 */
export function mainComponentOf(ext: Extension, rootId: NodeId): NodeId {
  const root = ext.nodes[rootId];
  if (!root || !WRAPPER_TYPES.has(root.type)) return rootId;
  let best: UINode | null = null;
  for (const id of root.children) {
    const n = ext.nodes[id];
    if (!n || WRAPPER_TYPES.has(n.type)) continue;
    if (!best || mainRank(n) < mainRank(best)) best = n;
  }
  return best?.id ?? rootId;
}

let anchorUnsubscribe: (() => void) | null = null;

/** The next click-to-add goes after the whole block until the selection changes. */
function anchorAfterBlock(selectedId: NodeId, blockId: NodeId): void {
  anchorUnsubscribe?.();
  setBlockAnchor({ selectedId, blockId });
  anchorUnsubscribe = useEditor.subscribe((s, prev) => {
    if (s.selectedNodeId === prev.selectedNodeId && s.activeExtensionId === prev.activeExtensionId) return;
    setBlockAnchor(null);
    anchorUnsubscribe?.();
    anchorUnsubscribe = null;
  });
}

/** Adds a starter extension (and the app functions it needs) to the project and opens it. */
export function addTemplateToProject(tpl: ExtensionTemplate): FlowResult<string> {
  const editor = useEditor.getState();
  const conflict = templateConflict(tpl, editor.project.extensions);
  if (conflict) return { ok: false, message: conflict };
  const { extension, functions } = instantiateExtensionTemplate(tpl, editor.project);
  if (functions.length === 0) {
    editor.addExtensionFromObject(extension);
  } else {
    editor.commit((d) => {
      d.functions.push(...(functions as Draft<AppFunction>[]));
      d.extensions.push(extension as Draft<Extension>);
    });
    useEditor.getState().setActiveExtension(extension.id);
  }
  const fnNote = functions.length ? ` with app function ${functions.map((f) => `“${f.uid}”`).join(', ')}` : '';
  return { ok: true, value: extension.id, message: `Added “${extension.name}”${fnNote}.${functionSupportNote(editor.project, functions)}` };
}

/** Replaces the active extension with a starter (one undo step). */
export function replaceActiveWithTemplate(tpl: ExtensionTemplate): FlowResult<string> {
  const editor = useEditor.getState();
  const current = selectActiveExtension(editor);
  if (!current) return addTemplateToProject(tpl);
  const conflict = templateConflict(tpl, editor.project.extensions, current.id);
  if (conflict) return { ok: false, message: conflict };
  const others = editor.project.extensions.filter((e) => e.id !== current.id);
  const { extension, functions } = instantiateExtensionTemplate(tpl, {
    extensions: others,
    functions: editor.project.functions,
    app: editor.project.app,
  });
  editor.commit((d) => {
    const index = d.extensions.findIndex((e) => e.id === current.id);
    if (index === -1) d.extensions.push(extension as Draft<Extension>);
    else d.extensions[index] = extension as Draft<Extension>;
    d.functions.push(...(functions as Draft<AppFunction>[]));
  });
  useEditor.getState().setActiveExtension(extension.id);
  return {
    ok: true,
    value: extension.id,
    message: `Replaced “${current.name}” with “${tpl.name}”.${functionSupportNote(editor.project, functions)}`,
  };
}

/** A new project named `appName` whose only extension comes from `tpl` (plus its functions). */
export function projectFromTemplate(appName: string, tpl: ExtensionTemplate): Project {
  const name = appName.trim() || 'My UI Extensions App';
  const project = createProject(name, []);
  const { extension, functions } = instantiateExtensionTemplate(tpl, project);
  project.extensions = [extension];
  project.functions = functions;
  return project;
}
