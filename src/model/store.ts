/**
 * Global editor store (zustand). Document mutations go through `commit`, which records undo
 * history (immer structural sharing keeps snapshots cheap) and supports coalescing rapid edits
 * (e.g. typing in an inspector field) into a single undo step.
 */
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import { newId, toIdentifier, uniqueName } from './ids';
import { createAppFunction, createExtension, createProject, type CreateExtensionOptions } from './factory';
import {
  detach,
  duplicateNode as duplicateNodeOp,
  findParent,
  insertSubtree,
  instantiateTemplate,
  moveNode as moveNodeOp,
  removeSubtree,
  toTemplate,
  type InsertTarget,
} from './tree';
import { canAccept } from './rules';
import { getComponent } from '../registry';
import type {
  ActionStep,
  AppConfig,
  AppFunction,
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
  duplicateNode: (id: NodeId) => NodeId | null;
  setProp: (id: NodeId, name: string, value: PropValue | undefined) => void;
  setProps: (id: NodeId, patch: Record<string, PropValue | undefined>) => void;
  setText: (id: NodeId, text: string) => void;
  updateNode: (id: NodeId, patch: Partial<Pick<UINode, 'name' | 'condition' | 'repeat' | 'binding' | 'locked' | 'hiddenInDesigner'>>) => void;
  setEvent: (id: NodeId, eventName: string, steps: ActionStep[] | undefined) => void;
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

const initialProject = createProject();

export const useEditor = create<EditorState>()((set, get) => {
  const mutateActive = (recipe: (ext: Draft<Extension>, project: Draft<Project>) => void, opts?: CommitOptions) => {
    const activeId = get().activeExtensionId;
    get().commit((draft) => recipe(activeDraft(draft, activeId), draft), opts);
  };

  return {
    project: initialProject,
    activeExtensionId: initialProject.extensions[0].id,
    selectedNodeId: null,
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

    loadProject: (project) =>
      set({
        project,
        activeExtensionId: project.extensions[0]?.id ?? '',
        selectedNodeId: null,
        hoveredNodeId: null,
        past: [],
        future: [],
        lastCommitKey: null,
        mode: 'design',
      }),
    newProject: (project) => get().loadProject(project ?? createProject()),

    commit: (recipe, opts = {}) => {
      const { project, past, lastCommitKey, lastCommitAt } = get();
      const next = produce(project, (draft) => {
        recipe(draft);
        draft.updatedAt = new Date().toISOString();
      });
      if (next === project) return;
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
      const stillActive = prev.extensions.some((e) => e.id === activeExtensionId);
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        lastCommitKey: null,
        activeExtensionId: stillActive ? activeExtensionId : prev.extensions[0]?.id ?? '',
        selectedNodeId: validSelection(prev, get().selectedNodeId),
      });
    },
    redo: () => {
      const { past, project, future, activeExtensionId } = get();
      if (!future.length) return;
      const next = future[0];
      const stillActive = next.extensions.some((e) => e.id === activeExtensionId);
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        lastCommitKey: null,
        activeExtensionId: stillActive ? activeExtensionId : next.extensions[0]?.id ?? '',
        selectedNodeId: validSelection(next, get().selectedNodeId),
      });
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    setMode: (mode) => set({ mode, hoveredNodeId: null, previewResetKey: get().previewResetKey + 1 }),
    setLeftPanel: (leftPanel) => set({ leftPanel }),
    setRightPanel: (rightPanel) => set({ rightPanel }),
    setBottomPanel: (bottomPanel) => set({ bottomPanel }),
    select: (selectedNodeId) => set({ selectedNodeId }),
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

    setActiveExtension: (id) => set({ activeExtensionId: id, selectedNodeId: null, hoveredNodeId: null }),
    addExtension: (opts = {}) => {
      const ext = createExtension({ ...opts, existing: get().project.extensions });
      get().commit((d) => {
        d.extensions.push(ext as Draft<Extension>);
      });
      set({ activeExtensionId: ext.id, selectedNodeId: null });
      return ext.id;
    },
    addExtensionFromObject: (ext) => {
      get().commit((d) => {
        d.extensions.push(ext as Draft<Extension>);
      });
      set({ activeExtensionId: ext.id, selectedNodeId: null });
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
        set({ activeExtensionId: get().project.extensions[0].id, selectedNodeId: null });
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
      // Rebuild nodes with fresh ids from the source tree.
      const root = src.nodes[src.rootId];
      const nodes: Record<NodeId, UINode> = { [copy.rootId]: { ...copy.nodes[copy.rootId], children: [] } };
      for (const cid of root.children) {
        const sub = instantiateTemplate(toTemplate(src, cid));
        Object.assign(nodes, sub.nodes);
        nodes[copy.rootId].children.push(sub.rootId);
      }
      const full: Extension = {
        ...copy,
        description: src.description,
        state: JSON.parse(JSON.stringify(src.state)),
        dataSources: JSON.parse(JSON.stringify(src.dataSources)),
        mock: JSON.parse(JSON.stringify(src.mock)),
        nodes,
      };
      return get().addExtensionFromObject(full);
    },

    insertNode: (what, target, opts = {}) => {
      const tpl = typeof what === 'string' ? resolveCreateTemplate(what) : what;
      const ext = selectActiveExtension(get());
      if (!opts.force) {
        const check = canAccept(ext, target.parentId, tpl.type, target.slot);
        if (!check.ok) return null;
      }
      const sub = instantiateTemplate(tpl);
      mutateActive((d) => insertSubtree(d as Extension, sub, target));
      if (opts.select !== false) set({ selectedNodeId: sub.rootId });
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
    },
    duplicateNode: (id) => {
      let newRoot: NodeId | null = null;
      mutateActive((d) => {
        newRoot = duplicateNodeOp(d as Extension, id);
      });
      if (newRoot) set({ selectedNodeId: newRoot });
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
      set({ selectedNodeId: sub.rootId });
      return sub.rootId;
    },
    copyNode: (id) => {
      const ext = selectActiveExtension(get());
      if (!ext.nodes[id] || id === ext.rootId) return;
      set({ clipboard: toTemplate(ext, id) });
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
      const taken = [...ext.state.map((s) => s.name), ...ext.dataSources.map((d) => d.name)];
      const v: StateVar = {
        id: newId('s'),
        name: uniqueName(toIdentifier(partial.name ?? 'value'), taken),
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
  };
});

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
