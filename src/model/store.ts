/**
 * Global editor store (zustand). Document mutations go through `commit`, which records undo
 * history (immer structural sharing keeps snapshots cheap) and supports coalescing rapid edits
 * (e.g. typing in an inspector field) into a single undo step.
 */
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import { isValidIdentifier, newId, toIdentifier } from './ids';
import { createAppFunction, createExtension, createProject, type CreateExtensionOptions } from './factory';
import {
  detach,
  duplicateNode as duplicateNodeOp,
  findParent,
  nodeLabel,
  insertSubtree,
  instantiateTemplate,
  moveNode as moveNodeOp,
  removeSubtree,
  templateTypes,
  toTemplate,
  uniquifyOverlayIds,
  type InsertTarget,
  type OverlayIdPropOf,
} from './tree';
import { canAccept, isAvailableIn } from './rules';
import { getComponent } from '../registry';
import { uniqueComputedName } from '../power/computed';
import { validateDeclaredName } from '../panels/names';
import { setActiveCodeProject } from './trust';
import { applySettings, canPasteSettings, settingsOf, type SettingsClipboard } from './settings';
import type {
  ActionStep,
  AppConfig,
  AppFunction,
  ComputedValue,
  DataSource,
  Extension,
  JsonValue,
  NodeId,
  NodeTemplate,
  PreviewMockData,
  Project,
  PropValue,
  StateVar,
  UINode,
} from './types';

export type EditorMode = 'design' | 'preview';
export type LeftPanelTab = 'components' | 'layers' | 'templates' | 'data';
export type RightPanelTab = 'properties' | 'events' | 'advanced';
export type BottomPanelTab = 'code' | 'problems' | 'console' | null;

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

export interface CommitOptions {
  /** Edits with the same key within COALESCE_MS merge into one undo step. */
  coalesceKey?: string;
  /** Skip history entirely (e.g. mock data tweaks). */
  skipHistory?: boolean;
}

export interface EditorState {
  project: Project;
  activeExtensionId: string;
  selectedNodeId: NodeId | null;
  /**
   * Multi-selection: every selected node of the active extension while more than one is selected
   * (it includes `selectedNodeId`, the primary one); empty otherwise. `select` clears it.
   */
  selectedNodeIds: NodeId[];
  /** Settings copied with "Copy settings" (props and text of one component, see model/settings). */
  settingsClipboard: SettingsClipboard | null;
  hoveredNodeId: NodeId | null;
  mode: EditorMode;
  leftPanel: LeftPanelTab;
  rightPanel: RightPanelTab;
  bottomPanel: BottomPanelTab;
  /** Detached subtree copied with Ctrl/Cmd+C. */
  clipboard: NodeTemplate | null;
  /** Bumped when the preview runtime should reset (state back to initial values). */
  previewResetKey: number;
  past: Project[];
  future: Project[];
  lastCommitKey: string | null;
  lastCommitAt: number;

  // ---- document lifecycle
  loadProject: (project: Project) => void;
  newProject: (project?: Project) => void;
  commit: (recipe: (draft: Draft<Project>) => void, opts?: CommitOptions) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // ---- UI state
  setMode: (mode: EditorMode) => void;
  setLeftPanel: (tab: LeftPanelTab) => void;
  setRightPanel: (tab: RightPanelTab) => void;
  setBottomPanel: (tab: BottomPanelTab) => void;
  select: (id: NodeId | null) => void;
  /** Adds a node to the selection, or removes it (Shift / Cmd-click). It becomes the primary one when added. */
  toggleSelection: (id: NodeId) => void;
  /** Selects several nodes (the last one is the primary selection). */
  selectMany: (ids: NodeId[]) => void;
  hover: (id: NodeId | null) => void;
  resetPreview: () => void;

  // ---- project / app
  updateProjectMeta: (patch: Partial<Pick<Project, 'name' | 'platformVersion'>>) => void;
  updateApp: (patch: Partial<AppConfig>, coalesceKey?: string) => void;

  // ---- extensions
  setActiveExtension: (id: string) => void;
  addExtension: (opts?: CreateExtensionOptions) => string;
  addExtensionFromObject: (ext: Extension) => string;
  updateExtension: (id: string, patch: Partial<Omit<Extension, 'id' | 'nodes' | 'rootId'>>, coalesceKey?: string) => void;
  removeExtension: (id: string) => void;
  duplicateExtension: (id: string) => string | null;

  // ---- nodes (operate on the active extension)
  /** Inserts a component (by type, using its registry `create()` default) or a template. Returns new id or null if not allowed. */
  insertNode: (what: string | NodeTemplate, target: InsertTarget, opts?: { select?: boolean; force?: boolean }) => NodeId | null;
  moveNode: (id: NodeId, target: InsertTarget) => boolean;
  removeNode: (id: NodeId) => void;
  /** Removes several nodes (a multi-selection) in one undo step; nothing stays selected. */
  removeNodes: (ids: NodeId[]) => void;
  duplicateNode: (id: NodeId) => NodeId | null;
  setProp: (id: NodeId, name: string, value: PropValue | undefined) => void;
  setProps: (id: NodeId, patch: Record<string, PropValue | undefined>) => void;
  setText: (id: NodeId, text: string) => void;
  updateNode: (id: NodeId, patch: Partial<Pick<UINode, 'name' | 'condition' | 'repeat' | 'binding' | 'locked' | 'hiddenInDesigner'>>) => void;
  setEvent: (id: NodeId, eventName: string, steps: ActionStep[] | undefined) => void;
  /** Sets props on several nodes at once (multi-edit; one undo step while typing). */
  setPropsMany: (ids: NodeId[], patch: Record<string, PropValue | undefined>) => void;
  /** Sets the text of several nodes at once (multi-edit). */
  setTextMany: (ids: NodeId[], text: string) => void;
  /** Copies a node's settings (props and text, not ids). Returns them, or null. */
  copySettings: (id: NodeId) => SettingsClipboard | null;
  /** Pastes the copied settings onto every node of the same type in `ids` (one undo step); returns how many changed. */
  pasteSettings: (ids: NodeId[]) => number;
  wrapNode: (id: NodeId, wrapperType: string) => NodeId | null;
  copyNode: (id: NodeId) => void;
  cutNode: (id: NodeId) => void;
  /** Pastes the clipboard after `afterId` (or into the selected container / root). */
  paste: (afterId?: NodeId | null) => NodeId | null;

  // ---- state, data, functions, mock data (active extension unless noted)
  addStateVar: (partial?: Partial<StateVar>) => StateVar;
  updateStateVar: (id: string, patch: Partial<StateVar>) => void;
  removeStateVar: (id: string) => void;
  addDataSource: (ds: Omit<DataSource, 'id'> & { id?: string }) => DataSource;
  updateDataSource: (id: string, patch: Partial<DataSource>) => void;
  removeDataSource: (id: string) => void;
  addFunction: (name?: string) => AppFunction;
  updateFunction: (id: string, patch: Partial<AppFunction>) => void;
  removeFunction: (id: string) => void;
  updateMock: (recipe: (mock: Draft<PreviewMockData>) => void) => void;

  // ---- computed values & helper code (active extension; power features)
  /**
   * Appends a computed value. The name (default base `computed`) is made a unique, valid
   * identifier that does not clash with state, data sources, other computed values or helpers.
   */
  addComputed: (partial?: Partial<Omit<ComputedValue, 'id'>>) => ComputedValue;
  /** Updates a computed value (rapid edits of the same fields coalesce into one undo step). */
  updateComputed: (id: string, patch: Partial<Omit<ComputedValue, 'id'>>) => void;
  removeComputed: (id: string) => void;
  /** Moves a computed value to `index` in the list (declaration order matters). */
  moveComputed: (id: string, index: number) => void;
  /** Replaces the helper code (typing coalesces into one undo step). Empty code removes it. */
  setHelpers: (code: string) => void;
}

/** Returns the active extension of a state snapshot. */
export function selectActiveExtension(s: Pick<EditorState, 'project' | 'activeExtensionId'>): Extension {
  return s.project.extensions.find((e) => e.id === s.activeExtensionId) ?? s.project.extensions[0];
}

function activeDraft(draft: Draft<Project>, activeId: string): Draft<Extension> {
  const ext = draft.extensions.find((e) => e.id === activeId) ?? draft.extensions[0];
  if (!ext) throw new Error('Project has no extensions');
  return ext;
}

/** Resolves a bare component type into its default subtree (registry `create()`), or `{ type }`. */
export function resolveCreateTemplate(type: string): NodeTemplate {
  const def = getComponent(type);
  if (def?.create) return def.create();
  if (def?.children.mode === 'text' && def.children.defaultText !== undefined) {
    return { type, text: def.children.defaultText };
  }
  return { type };
}

/** Overlay id prop of a component type (registry `overlay.idProp`). */
const overlayIdPropOf: OverlayIdPropOf = (type) => getComponent(type)?.overlay?.idProp;

/**
 * Labels of components in `tpl` (root, descendants and slot content) that are not available in
 * the extension's location — e.g. a CRM property list inside a pasted Tile on a settings page.
 */
export function unavailableComponents(ext: Extension, tpl: NodeTemplate): string[] {
  const out: string[] = [];
  for (const type of templateTypes(tpl)) {
    const def = getComponent(type);
    if (def && !isAvailableIn(def, ext) && !out.includes(def.label)) out.push(def.label);
  }
  return out;
}

/**
 * The extension an undo / redo step changes, so the editor can show it: the active extension when
 * it changed, else the first extension whose content differs (immer keeps untouched extensions
 * referentially equal). Null when only project-level data changed.
 */
function changedExtensionId(from: Project, to: Project, activeId: string): string | null {
  const before = new Map(from.extensions.map((e) => [e.id, e]));
  const changed: string[] = [];
  for (const e of to.extensions) if (before.get(e.id) !== e) changed.push(e.id);
  if (changed.includes(activeId)) return activeId;
  if (changed.length) return changed[0];
  return null;
}

const initialProject = createProject();
setActiveCodeProject(initialProject.id);

export const useEditor = create<EditorState>()((set, get) => {
  const mutateActive = (recipe: (ext: Draft<Extension>, project: Draft<Project>) => void, opts?: CommitOptions) => {
    const activeId = get().activeExtensionId;
    get().commit((draft) => recipe(activeDraft(draft, activeId), draft), opts);
  };
  /** Drops multi-selected nodes that no longer exist (after delete / undo). */
  const pruneSelection = () => {
    const { selectedNodeIds, selectedNodeId } = get();
    if (!selectedNodeIds.length) return;
    const ext = selectActiveExtension(get());
    const left = selectedNodeIds.filter((id) => !!ext.nodes[id]);
    if (left.length === selectedNodeIds.length) return;
    set({ selectedNodeIds: left.length > 1 ? left : [], selectedNodeId: selectedNodeId && ext.nodes[selectedNodeId] ? selectedNodeId : (left[left.length - 1] ?? null) });
  };

  return {
    project: initialProject,
    activeExtensionId: initialProject.extensions[0].id,
    selectedNodeId: null,
    selectedNodeIds: [],
    settingsClipboard: null,
    hoveredNodeId: null,
    mode: 'design',
    leftPanel: 'components',
    rightPanel: 'properties',
    bottomPanel: null,
    clipboard: null,
    previewResetKey: 0,
    past: [],
    future: [],
    lastCommitKey: null,
    lastCommitAt: 0,

    loadProject: (project) => {
      // The code policy follows the shown project (imported, untrusted projects run no code).
      setActiveCodeProject(project.id);
      set({
        project,
        activeExtensionId: project.extensions[0]?.id ?? '',
        selectedNodeId: null,
        selectedNodeIds: [],
        hoveredNodeId: null,
        past: [],
        future: [],
        lastCommitKey: null,
        mode: 'design',
      });
    },
    newProject: (project) => get().loadProject(project ?? createProject()),

    commit: (recipe, opts = {}) => {
      const { project, past, lastCommitKey, lastCommitAt } = get();
      const changed = produce(project, (draft) => {
        recipe(draft);
      });
      // A recipe that changes nothing is a no-op: no history entry, no timestamp, no autosave.
      if (changed === project) return;
      const next = produce(changed, (draft) => {
        draft.updatedAt = new Date().toISOString();
      });
      if (opts.skipHistory) {
        set({ project: next });
        return;
      }
      const now = Date.now();
      const coalesce = !!opts.coalesceKey && opts.coalesceKey === lastCommitKey && now - lastCommitAt < COALESCE_MS;
      set({
        project: next,
        past: coalesce ? past : [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        lastCommitKey: opts.coalesceKey ?? null,
        lastCommitAt: now,
      });
    },

    undo: () => {
      const { past, project, future, activeExtensionId } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        lastCommitKey: null,
        ...historyFocus(project, prev, activeExtensionId, get().selectedNodeId),
      });
      pruneSelection();
    },
    redo: () => {
      const { past, project, future, activeExtensionId } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        lastCommitKey: null,
        ...historyFocus(project, next, activeExtensionId, get().selectedNodeId),
      });
      pruneSelection();
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    setMode: (mode) => set({ mode, hoveredNodeId: null, previewResetKey: get().previewResetKey + 1 }),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    setRightPanel: (rightPanel) => set({ rightPanel }),
    setBottomPanel: (bottomPanel) => set({ bottomPanel }),
    select: (selectedNodeId) => set({ selectedNodeId, selectedNodeIds: [] }),
    toggleSelection: (id) => {
      const ext = selectActiveExtension(get());
      if (!ext.nodes[id] || id === ext.rootId) return;
      const { selectedNodeId, selectedNodeIds } = get();
      const current = selectedNodeIds.length ? selectedNodeIds : selectedNodeId && ext.nodes[selectedNodeId] ? [selectedNodeId] : [];
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      const primary = current.includes(id) ? (selectedNodeId === id ? (next[next.length - 1] ?? null) : selectedNodeId) : id;
      set({ selectedNodeId: primary, selectedNodeIds: next.length > 1 ? next : [] });
    },
    selectMany: (ids) => {
      const ext = selectActiveExtension(get());
      const list = [...new Set(ids)].filter((id) => !!ext.nodes[id] && id !== ext.rootId);
      set({ selectedNodeId: list[list.length - 1] ?? null, selectedNodeIds: list.length > 1 ? list : [] });
    },
    hover: (hoveredNodeId) => {
      if (get().hoveredNodeId !== hoveredNodeId) set({ hoveredNodeId });
    },
    resetPreview: () => set({ previewResetKey: get().previewResetKey + 1 }),

    updateProjectMeta: (patch) =>
      get().commit((d) => {
        Object.assign(d, patch);
      }, { coalesceKey: `project:${Object.keys(patch).join(',')}` }),
    updateApp: (patch, coalesceKey) =>
      get().commit((d) => {
        Object.assign(d.app, patch);
      }, { coalesceKey: coalesceKey ?? `app:${Object.keys(patch).join(',')}` }),

    setActiveExtension: (id) => set({ activeExtensionId: id, selectedNodeId: null, selectedNodeIds: [], hoveredNodeId: null }),
    addExtension: (opts = {}) => {
      const ext = createExtension({ ...opts, existing: get().project.extensions });
      get().commit((d) => {
        d.extensions.push(ext as Draft<Extension>);
      });
      set({ activeExtensionId: ext.id, selectedNodeId: null, selectedNodeIds: [] });
      return ext.id;
    },
    addExtensionFromObject: (ext) => {
      get().commit((d) => {
        d.extensions.push(ext as Draft<Extension>);
      });
      set({ activeExtensionId: ext.id, selectedNodeId: null, selectedNodeIds: [] });
      return ext.id;
    },
    updateExtension: (id, patch, coalesceKey) =>
      get().commit((d) => {
        const ext = d.extensions.find((e) => e.id === id);
        if (ext) Object.assign(ext, patch);
      }, { coalesceKey: coalesceKey ?? `ext:${id}:${Object.keys(patch).join(',')}` }),
    removeExtension: (id) => {
      const { project, activeExtensionId } = get();
      if (project.extensions.length <= 1) return;
      get().commit((d) => {
        d.extensions = d.extensions.filter((e) => e.id !== id);
      });
      if (activeExtensionId === id) {
        set({ activeExtensionId: get().project.extensions[0].id, selectedNodeId: null, selectedNodeIds: [] });
      }
    },
    duplicateExtension: (id) => {
      const src = get().project.extensions.find((e) => e.id === id);
      if (!src) return null;
      const copy = createExtension({
        kind: src.kind,
        name: `${src.name} copy`,
        location: src.location,
        objectTypes: [...src.objectTypes],
        existing: get().project.extensions,
      });
      // Rebuild the whole tree with fresh ids in one go, so close-overlay steps anywhere in the
      // copy target the copied Modals / Panels (overlay ids stay unique per extension).
      const sub = instantiateTemplate(toTemplate(src, src.rootId, overlayIdPropOf));
      const nodes: Record<NodeId, UINode> = sub.nodes;
      const full: Extension = {
        ...copy,
        rootId: sub.rootId,
        description: src.description,
        state: JSON.parse(JSON.stringify(src.state)),
        dataSources: JSON.parse(JSON.stringify(src.dataSources)),
        ...(src.computed?.length ? { computed: JSON.parse(JSON.stringify(src.computed)) as ComputedValue[] } : {}),
        ...(src.helpers ? { helpers: src.helpers } : {}),
        mock: JSON.parse(JSON.stringify(src.mock)),
        nodes,
      };
      return get().addExtensionFromObject(full);
    },

    insertNode: (what, target, opts = {}) => {
      const ext = selectActiveExtension(get());
      // Copies keep working on their own: overlay ids are made unique (with their references).
      const tpl = uniquifyOverlayIds(typeof what === 'string' ? resolveCreateTemplate(what) : what, ext, overlayIdPropOf);
      if (!opts.force) {
        const check = canAccept(ext, target.parentId, tpl.type, target.slot);
        if (!check.ok) return null;
        // Nested components must be available here too (e.g. CRM components on a settings page).
        if (unavailableComponents(ext, tpl).length) return null;
      }
      const sub = instantiateTemplate(tpl);
      mutateActive((d) => insertSubtree(d as Extension, sub, target));
      if (opts.select !== false) set({ selectedNodeId: sub.rootId, selectedNodeIds: [] });
      return sub.rootId;
    },
    moveNode: (id, target) => {
      const ext = selectActiveExtension(get());
      const node = ext.nodes[id];
      if (!node) return false;
      const check = canAccept(ext, target.parentId, node.type, target.slot, id);
      if (!check.ok) return false;
      let ok = false;
      mutateActive((d) => {
        ok = moveNodeOp(d as Extension, id, target);
      });
      return ok;
    },
    removeNode: (id) => {
      const ext = selectActiveExtension(get());
      if (id === ext.rootId || !ext.nodes[id]) return;
      const ref = findParent(ext, id);
      mutateActive((d) => removeSubtree(d as Extension, id));
      // Select a sensible neighbour.
      if (get().selectedNodeId === id || !selectActiveExtension(get()).nodes[get().selectedNodeId ?? '']) {
        let nextSel: NodeId | null = null;
        if (ref) {
          const parent = selectActiveExtension(get()).nodes[ref.parentId];
          const list = ref.slot ? parent?.slots?.[ref.slot] ?? [] : parent?.children ?? [];
          nextSel = list[Math.min(ref.index, list.length - 1)] ?? (ref.parentId === ext.rootId ? null : ref.parentId);
        }
        set({ selectedNodeId: nextSel });
      }
      pruneSelection();
    },
    removeNodes: (ids) => {
      const ext = selectActiveExtension(get());
      const targets = ids.filter((id) => id !== ext.rootId && !!ext.nodes[id]);
      if (!targets.length) return;
      mutateActive((d) => {
        // A node inside another removed one is already gone.
        for (const id of targets) if ((d as Extension).nodes[id]) removeSubtree(d as Extension, id);
      });
      set({ selectedNodeId: null, selectedNodeIds: [] });
    },
    duplicateNode: (id) => {
      let newRoot: NodeId | null = null;
      mutateActive((d) => {
        newRoot = duplicateNodeOp(d as Extension, id, overlayIdPropOf);
      });
      if (newRoot) set({ selectedNodeId: newRoot, selectedNodeIds: [] });
      return newRoot;
    },
    setProp: (id, name, value) =>
      mutateActive(
        (d) => {
          const node = d.nodes[id];
          if (!node) return;
          if (value === undefined) delete node.props[name];
          else node.props[name] = value as Draft<PropValue>;
        },
        { coalesceKey: `prop:${id}:${name}` },
      ),
    setProps: (id, patch) =>
      mutateActive(
        (d) => {
          const node = d.nodes[id];
          if (!node) return;
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete node.props[k];
            else node.props[k] = v as Draft<PropValue>;
          }
        },
        { coalesceKey: `props:${id}:${Object.keys(patch).join(',')}` },
      ),
    setText: (id, text) =>
      mutateActive(
        (d) => {
          const node = d.nodes[id];
          if (node) node.text = text;
        },
        { coalesceKey: `text:${id}` },
      ),
    updateNode: (id, patch) =>
      mutateActive(
        (d) => {
          const node = d.nodes[id];
          if (!node) return;
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') delete (node as Record<string, unknown>)[k];
            else (node as Record<string, unknown>)[k] = v;
          }
        },
        { coalesceKey: `node:${id}:${Object.keys(patch).join(',')}` },
      ),
    setEvent: (id, eventName, steps) =>
      mutateActive(
        (d) => {
          const node = d.nodes[id];
          if (!node) return;
          if (!steps || steps.length === 0) {
            if (node.events) {
              delete node.events[eventName];
              if (Object.keys(node.events).length === 0) delete node.events;
            }
            return;
          }
          node.events = node.events ?? {};
          node.events[eventName] = steps as Draft<ActionStep>[];
        },
        { coalesceKey: `event:${id}:${eventName}` },
      ),
    setPropsMany: (ids, patch) =>
      mutateActive(
        (d) => {
          for (const id of ids) {
            const node = d.nodes[id];
            if (!node) continue;
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) delete node.props[k];
              else node.props[k] = JSON.parse(JSON.stringify(v)) as Draft<PropValue>;
            }
          }
        },
        { coalesceKey: `propsMany:${ids.join(',')}:${Object.keys(patch).join(',')}` },
      ),
    setTextMany: (ids, text) =>
      mutateActive(
        (d) => {
          for (const id of ids) {
            const node = d.nodes[id];
            if (node) node.text = text;
          }
        },
        { coalesceKey: `textMany:${ids.join(',')}` },
      ),
    copySettings: (id) => {
      const ext = selectActiveExtension(get());
      const node = ext.nodes[id];
      if (!node || id === ext.rootId) return null;
      const clip = settingsOf(node, nodeLabel(node, getComponent(node.type)?.label));
      set({ settingsClipboard: clip });
      return clip;
    },
    pasteSettings: (ids) => {
      const clip = get().settingsClipboard;
      const ext = selectActiveExtension(get());
      const targets = ids.filter((id) => canPasteSettings(clip, ext.nodes[id]));
      if (!clip || !targets.length) return 0;
      let changed = 0;
      mutateActive((d) => {
        for (const id of targets) {
          const node = d.nodes[id] as UINode | undefined;
          if (!node) continue;
          const before = JSON.stringify([node.props, node.text]);
          applySettings(node, clip);
          if (JSON.stringify([node.props, node.text]) !== before) changed++;
        }
      });
      return changed;
    },
    wrapNode: (id, wrapperType) => {
      const ext = selectActiveExtension(get());
      const ref = findParent(ext, id);
      if (!ref || ref.slot) return null;
      const node = ext.nodes[id];
      if (!canAccept(ext, ref.parentId, wrapperType).ok) return null;
      const wrapperTpl = resolveCreateTemplate(wrapperType);
      const sub = instantiateTemplate({ ...wrapperTpl, children: [] });
      // The wrapper must accept the node as a child.
      const probe: Extension = { ...ext, nodes: { ...ext.nodes, ...sub.nodes } };
      if (!canAccept(probe, sub.rootId, node.type).ok) return null;
      mutateActive((d) => {
        const dext = d as Extension;
        detach(dext, id);
        insertSubtree(dext, sub, { parentId: ref.parentId, index: ref.index });
        dext.nodes[sub.rootId].children.push(id);
      });
      set({ selectedNodeId: sub.rootId, selectedNodeIds: [] });
      return sub.rootId;
    },
    copyNode: (id) => {
      const ext = selectActiveExtension(get());
      if (!ext.nodes[id] || id === ext.rootId) return;
      set({ clipboard: toTemplate(ext, id, overlayIdPropOf) });
    },
    cutNode: (id) => {
      get().copyNode(id);
      get().removeNode(id);
    },
    paste: (afterId) => {
      const { clipboard } = get();
      if (!clipboard) return null;
      const ext = selectActiveExtension(get());
      const anchor = afterId ?? get().selectedNodeId;
      // 1) Paste into the anchor if it is a container accepting the clipboard type.
      if (anchor && ext.nodes[anchor] && canAccept(ext, anchor, clipboard.type).ok) {
        return get().insertNode(clipboard, { parentId: anchor, index: ext.nodes[anchor].children.length });
      }
      // 2) Paste after the anchor in its parent.
      if (anchor && ext.nodes[anchor]) {
        const ref = findParent(ext, anchor);
        if (ref && !ref.slot && canAccept(ext, ref.parentId, clipboard.type).ok) {
          return get().insertNode(clipboard, { parentId: ref.parentId, index: ref.index + 1 });
        }
      }
      // 3) Fallback: end of root.
      const root = ext.nodes[ext.rootId];
      return get().insertNode(clipboard, { parentId: ext.rootId, index: root.children.length });
    },

    addStateVar: (partial = {}) => {
      const ext = selectActiveExtension(get());
      const v: StateVar = {
        id: newId('s'),
        name: freeStateName(ext, partial.name ?? 'value'),
        type: partial.type ?? 'string',
        initial: partial.initial ?? ((partial.type ?? 'string') === 'string' ? '' : null),
        ...(partial.description ? { description: partial.description } : {}),
      };
      mutateActive((d) => {
        d.state.push(v as Draft<StateVar>);
      });
      return v;
    },
    updateStateVar: (id, patch) =>
      mutateActive(
        (d) => {
          const v = d.state.find((s) => s.id === id);
          if (!v) return;
          const oldName = v.name;
          Object.assign(v, patch);
          // Keep two-way bindings pointing at the renamed variable.
          if (patch.name && patch.name !== oldName) {
            for (const n of Object.values(d.nodes)) {
              if (n.binding?.state === oldName) n.binding.state = patch.name;
            }
          }
        },
        { coalesceKey: `state:${id}:${Object.keys(patch).join(',')}` },
      ),
    removeStateVar: (id) =>
      mutateActive((d) => {
        const v = d.state.find((s) => s.id === id);
        d.state = d.state.filter((s) => s.id !== id);
        if (v) {
          for (const n of Object.values(d.nodes)) {
            if (n.binding?.state === v.name) delete n.binding;
          }
        }
      }),
    addDataSource: (ds) => {
      const full = { ...ds, id: ds.id ?? newId('d') } as DataSource;
      mutateActive((d) => {
        d.dataSources.push(full as Draft<DataSource>);
      });
      return full;
    },
    updateDataSource: (id, patch) =>
      mutateActive(
        (d) => {
          const ds = d.dataSources.find((x) => x.id === id);
          if (ds) Object.assign(ds, patch);
        },
        { coalesceKey: `ds:${id}:${Object.keys(patch).join(',')}` },
      ),
    removeDataSource: (id) =>
      mutateActive((d) => {
        d.dataSources = d.dataSources.filter((x) => x.id !== id);
        delete d.mock.dataSources[id];
        if (d.mock.simulate) {
          delete d.mock.simulate[id];
          if (Object.keys(d.mock.simulate).length === 0) delete d.mock.simulate;
        }
      }),
    addFunction: (name) => {
      const fn = createAppFunction(get().project.functions, name);
      get().commit((d) => {
        d.functions.push(fn as Draft<AppFunction>);
      });
      return fn;
    },
    updateFunction: (id, patch) =>
      get().commit(
        (d) => {
          const fn = d.functions.find((f) => f.id === id);
          if (fn) Object.assign(fn, patch);
        },
        { coalesceKey: `fn:${id}:${Object.keys(patch).join(',')}` },
      ),
    removeFunction: (id) =>
      get().commit((d) => {
        d.functions = d.functions.filter((f) => f.id !== id);
        for (const e of d.extensions) delete e.mock.functions[id];
      }),
    updateMock: (recipe) => mutateActive((d) => recipe(d.mock), { coalesceKey: 'mock' }),

    addComputed: (partial = {}) => {
      const ext = selectActiveExtension(get());
      const c: ComputedValue = {
        id: `c_${newId('n').slice(2)}`,
        name: uniqueComputedName(ext, partial.name?.trim() || 'computed'),
        expr: partial.expr ?? '',
        ...(partial.description ? { description: partial.description } : {}),
      };
      mutateActive((d) => {
        if (!d.computed) d.computed = [];
        d.computed.push(c as Draft<ComputedValue>);
      });
      return c;
    },
    updateComputed: (id, patch) =>
      mutateActive(
        (d) => {
          const c = d.computed?.find((x) => x.id === id);
          if (!c) return;
          for (const [k, v] of Object.entries(patch)) {
            if (k === 'id') continue;
            if (v === undefined || (k === 'description' && v === '')) delete (c as Record<string, unknown>)[k];
            else (c as Record<string, unknown>)[k] = v;
          }
        },
        { coalesceKey: `computed:${id}:${Object.keys(patch).join(',')}` },
      ),
    removeComputed: (id) =>
      mutateActive((d) => {
        if (!d.computed) return;
        d.computed = d.computed.filter((c) => c.id !== id);
        if (d.computed.length === 0) delete d.computed;
      }),
    moveComputed: (id, index) =>
      mutateActive((d) => {
        const list = d.computed;
        if (!list) return;
        const from = list.findIndex((c) => c.id === id);
        const to = Math.max(0, Math.min(index, list.length - 1));
        if (from === -1 || from === to) return;
        const [item] = list.splice(from, 1);
        list.splice(to, 0, item);
      }),
    setHelpers: (code) =>
      mutateActive(
        (d) => {
          if (code.trim() === '') delete d.helpers;
          else d.helpers = code;
        },
        { coalesceKey: `helpers:${get().activeExtensionId}` },
      ),
  };
});

/**
 * A state variable name for `requested`: kept as typed when it is a valid identifier (e.g.
 * `first_name`), otherwise converted (`First name` -> `firstName`); then made unique against
 * everything the extension declares (state + setters, data sources + Loading/Error/setters,
 * computed values, helpers, reserved names) by appending 2, 3, ...
 */
export function freeStateName(ext: Extension, requested: string): string {
  const trimmed = requested.trim();
  const base = isValidIdentifier(trimmed) ? trimmed : toIdentifier(trimmed, 'value');
  const entity = { kind: 'state' as const, id: '' };
  if (!validateDeclaredName(ext, base, entity)) return base;
  for (let i = 2; i < 1000; i++) {
    if (!validateDeclaredName(ext, `${base}${i}`, entity)) return `${base}${i}`;
  }
  return `${base}_${Date.now().toString(36)}`;
}

/**
 * After undo / redo: show the extension the step changed (otherwise the change happens out of
 * view, or the active extension disappears) and keep the selection only when it still exists.
 */
function historyFocus(
  from: Project,
  to: Project,
  activeId: string,
  selectedId: NodeId | null,
): Pick<EditorState, 'activeExtensionId' | 'selectedNodeId'> {
  const changed = changedExtensionId(from, to, activeId);
  const stillActive = to.extensions.some((e) => e.id === activeId);
  let next = activeId;
  if (changed && changed !== activeId && to.extensions.some((e) => e.id === changed)) next = changed;
  else if (!stillActive) next = to.extensions[0]?.id ?? '';
  const ext = to.extensions.find((e) => e.id === next);
  const selection = next === activeId ? validSelection(to, selectedId) : null;
  return { activeExtensionId: next, selectedNodeId: selection && ext?.nodes[selection] ? selection : null };
}

function validSelection(project: Project, id: NodeId | null): NodeId | null {
  if (!id) return null;
  return project.extensions.some((e) => !!e.nodes[id]) ? id : null;
}

/** Convenience hook: the active extension. */
export function useActiveExtension(): Extension {
  return useEditor((s) => selectActiveExtension(s));
}

/** Convenience hook: the selected node of the active extension (or null). */
export function useSelectedNode(): UINode | null {
  return useEditor((s) => {
    const id = s.selectedNodeId;
    if (!id) return null;
    return selectActiveExtension(s).nodes[id] ?? null;
  });
}

export type { InsertTarget } from './tree';
export type { JsonValue };
