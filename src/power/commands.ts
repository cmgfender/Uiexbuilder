/**
 * Command palette commands, built from the current editor state. Pure data + `run` callbacks that
 * go through store actions (and the dialogs store), so they can be listed, searched and tested
 * without rendering anything.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpToLine,
  Blocks,
  ClipboardCopy,
  ClipboardPaste,
  ListFilter,
  SlidersHorizontal,
  Code,
  CopyPlus,
  Database,
  Eye,
  FilePlus,
  FolderOpen,
  Group,
  House,
  Keyboard,
  Layers,
  LayoutPanelTop,
  LayoutTemplate,
  Maximize2,
  Navigation,
  Package,
  Plus,
  Redo2,
  ScanSearch,
  Settings,
  Sigma,
  SquareFunction,
  SquareTerminal,
  Component as ComponentIcon,
  Trash2,
  TriangleAlert,
  Undo2,
  Variable,
  Puzzle,
  ArrowRightLeft,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM, nextZoom, useCanvasView } from '../canvas/stores';
import { generateNodeJsx } from '../codegen';
import { smartInsertTarget } from '../dnd/dragState';
import { availableActionKinds, createStep, eventWhen, type ActionContext } from '../inspector/actionModel';
import { canAccept, isAvailableIn } from '../model/rules';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { buildParentIndex, findParent, nodeLabel, walk } from '../model/tree';
import type { DataSourceKind, Extension, ExtensionKind, NodeId, NodeTemplate, StateVar } from '../model/types';
import { addDataSourceOfKind } from '../panels/actions';
import { DATA_SOURCE_KINDS } from '../panels/dataSourceMeta';
import { getComponent, listComponents } from '../registry';
import { explainNoTarget, historyStep, insertComponent, paletteInsertTarget } from '../shell/actions';
import { useDialogs, type DialogName } from '../shell/dialogs';
import { showRightTab } from '../shell/shellStore';
import { formatShortcut, SHORTCUTS } from '../shell/shortcuts';
import { insertBlock, prepareBlock } from '../templates/actions';
import type { BlockTemplate } from '../templates/catalog';
import { addShapedList, copyToClipboard, ensureDesignMode, goToNode, showBottomPanel, showLeftPanel, type Notify } from './actions';
import { usePowerUi } from './uiStore';

export type CommandGroup = 'Actions' | 'Events' | 'Insert' | 'Blocks' | 'Go to' | 'Extensions' | 'Data' | 'View' | 'Project';

/** Display order of groups when the query is empty (search results are ordered by score). */
export const GROUP_ORDER: CommandGroup[] = ['Actions', 'Data', 'View', 'Project', 'Extensions', 'Events', 'Blocks', 'Insert', 'Go to'];

export interface CommandEnv {
  /** Shows a short message (toast). */
  notify: Notify;
}

export interface Command {
  /** Stable id (used for "recent commands"). */
  id: string;
  title: string;
  group: CommandGroup;
  icon?: LucideIcon;
  /** Secondary text: a description, a node path, ... */
  subtitle?: string;
  /** Keyboard shortcut hint, already formatted for the platform (e.g. "⌘Z" / "Ctrl+Z"). */
  shortcut?: string;
  /** Extra search terms. */
  keywords?: string[];
  /** When set, the command is listed but cannot run; the reason is shown instead. */
  disabledReason?: string;
  run: (env: CommandEnv) => void | Promise<void>;
}

/** A block the palette can insert (catalog blocks and the user's saved blocks). */
export interface PaletteBlock {
  id: string;
  name: string;
  description?: string;
  icon?: LucideIcon;
  template: NodeTemplate;
  state?: Array<Omit<StateVar, 'id'>>;
  keywords?: string[];
  /** True for blocks the user saved ("Save as block"). */
  user?: boolean;
  /** Data blocks: built for the card they go into (BlockTemplate.create). */
  create?: BlockTemplate['create'];
}

export interface CommandSources {
  state: Pick<EditorState, 'project' | 'activeExtensionId' | 'selectedNodeId' | 'mode' | 'past' | 'future'>;
  blocks: PaletteBlock[];
  /** Canvas zoom (1 = 100%); defaults to the canvas view store's current zoom. */
  zoom?: number;
}

// ---------------------------------------------------------------------------
// Shortcut hints (the shell module documents every binding in SHORTCUTS)
// ---------------------------------------------------------------------------

/** Formatted shortcut of a SHORTCUTS id, or undefined when the shell does not define it. */
export function shortcutHint(id: string): string | undefined {
  const def = SHORTCUTS.find((s) => s.id === id);
  return def ? formatShortcut(def.keys) : undefined;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const KIND_LABELS: Record<ExtensionKind, string> = { card: 'App card', settings: 'Settings page', home: 'App home page' };

function typeLabel(type: string): string {
  return getComponent(type)?.label ?? type;
}

function nodeTitle(ext: Extension, id: NodeId): string {
  const node = ext.nodes[id];
  return node ? nodeLabel(node, typeLabel(node.type)) : 'Component';
}

const activeExt = () => selectActiveExtension(useEditor.getState());

function openDialog(name: DialogName): void {
  useDialogs.getState().open(name);
}

function selectionCommands(ext: Extension, selected: NodeId | null): Command[] {
  const node = selected ? ext.nodes[selected] : undefined;
  const noSelection = 'Select a component on the canvas first';
  const label = node ? nodeTitle(ext, node.id) : '';
  const locked = node?.locked ? `“${label}” is locked — unlock it first` : undefined;
  const parentRef = node ? findParent(ext, node.id) : null;
  const subtitle = node ? label : undefined;

  const duplicateBlocked = (() => {
    if (!node || !parentRef?.slot) return undefined;
    const check = canAccept(ext, parentRef.parentId, node.type, parentRef.slot);
    return check.ok ? undefined : check.reason;
  })();
  const wrapBlocked = (() => {
    if (!node || !parentRef) return undefined;
    if (parentRef.slot) return `${typeLabel(node.type)} is attached as an overlay and can't be wrapped`;
    const check = canAccept(ext, parentRef.parentId, 'Flex');
    return check.ok ? undefined : check.reason;
  })();

  return [
    {
      id: 'action:duplicate',
      title: 'Duplicate selection',
      group: 'Actions',
      icon: CopyPlus,
      subtitle,
      shortcut: shortcutHint('duplicate'),
      keywords: ['copy', 'clone', 'repeat'],
      disabledReason: !node ? noSelection : duplicateBlocked,
      run: () => {
        useEditor.getState().duplicateNode(selected!);
      },
    },
    {
      id: 'action:delete',
      title: 'Delete selection',
      group: 'Actions',
      icon: Trash2,
      subtitle,
      shortcut: shortcutHint('delete'),
      keywords: ['remove', 'erase'],
      disabledReason: !node ? noSelection : locked,
      run: () => useEditor.getState().removeNode(selected!),
    },
    {
      id: 'action:wrap',
      title: 'Wrap selection in Flex',
      group: 'Actions',
      icon: Group,
      subtitle,
      shortcut: shortcutHint('wrap'),
      keywords: ['group', 'container', 'flex', 'stack'],
      disabledReason: !node ? noSelection : locked ?? wrapBlocked,
      run: ({ notify }) => {
        if (!useEditor.getState().wrapNode(selected!, 'Flex')) notify(`Can't wrap ${label} in a Flex here.`);
      },
    },
    {
      id: 'action:selectParent',
      title: 'Select parent',
      group: 'Actions',
      icon: ArrowUpToLine,
      subtitle: node && parentRef && parentRef.parentId !== ext.rootId ? nodeTitle(ext, parentRef.parentId) : subtitle,
      shortcut: shortcutHint('parent'),
      keywords: ['up', 'container', 'navigate'],
      disabledReason: !node ? noSelection : !parentRef || parentRef.parentId === ext.rootId ? `${label} is at the top level` : undefined,
      run: () => {
        if (parentRef) goToNode(parentRef.parentId);
      },
    },
    {
      id: 'action:copyJsx',
      title: 'Copy JSX of selection',
      group: 'Actions',
      icon: ClipboardCopy,
      subtitle,
      keywords: ['copy code', 'code', 'jsx', 'tsx', 'snippet', 'markup', 'clipboard', 'export', 'react'],
      disabledReason: !node ? noSelection : undefined,
      run: async ({ notify }) => {
        const { project } = useEditor.getState();
        const jsx = generateNodeJsx(project, activeExt(), selected!);
        if (!jsx) {
          notify('Nothing to copy for this component.');
          return;
        }
        notify((await copyToClipboard(jsx)) ? `Copied the JSX of ${label}` : 'Could not copy — open the code panel and copy it from there');
      },
    },
  ];
}

/**
 * Copy settings / Paste settings (model/settings): the selected component's props, text and rules
 * onto other components of the same type — the whole multi-selection when several are selected.
 */
function settingsCommands(ext: Extension, selected: NodeId | null): Command[] {
  const { settingsClipboard: clip, selectedNodeIds } = useEditor.getState();
  const node = selected ? ext.nodes[selected] : undefined;
  const targets = (selectedNodeIds.length > 1 ? selectedNodeIds : selected ? [selected] : []).filter((id) => !!ext.nodes[id]);
  const matching = clip ? targets.filter((id) => ext.nodes[id].type === clip.type) : [];
  return [
    {
      id: 'action:copySettings',
      title: 'Copy settings',
      group: 'Actions',
      icon: SlidersHorizontal,
      subtitle: node ? `${nodeTitle(ext, node.id)} — look, text and rules (not its id)` : undefined,
      keywords: ['copy style', 'copy properties', 'format painter', 'props', 'reuse'],
      shortcut: shortcutHint('copySettings'),
      disabledReason: node ? undefined : 'Select a component on the canvas first',
      run: ({ notify }) => {
        const c = useEditor.getState().copySettings(selected!);
        if (c) notify(`Copied the settings of ${c.label}`);
      },
    },
    {
      id: 'action:pasteSettings',
      title: targets.length > 1 ? `Paste settings onto ${targets.length} components` : 'Paste settings',
      group: 'Actions',
      icon: ClipboardPaste,
      subtitle: clip ? `From ${clip.label}` : undefined,
      keywords: ['paste style', 'paste properties', 'format painter', 'apply', 'props'],
      shortcut: shortcutHint('pasteSettings'),
      disabledReason: !clip
        ? 'Copy the settings of a component first'
        : !targets.length
          ? 'Select a component on the canvas first'
          : !matching.length
            ? `The copied settings are for a ${typeLabel(clip.type)}`
            : undefined,
      run: ({ notify }) => {
        const n = useEditor.getState().pasteSettings(matching);
        notify(n ? `Pasted the settings of ${clip!.label} onto ${n} component${n === 1 ? '' : 's'}` : 'They already have these settings');
      },
    },
  ];
}

function generalCommands(src: CommandSources, ext: Extension): Command[] {
  const { state } = src;
  const designing = state.mode === 'design';
  return [
    {
      id: 'action:undo',
      title: 'Undo',
      group: 'Actions',
      icon: Undo2,
      shortcut: shortcutHint('undo'),
      keywords: ['back', 'revert'],
      disabledReason: state.past.length ? undefined : 'Nothing to undo',
      run: ({ notify }) => historyStep('undo', notify),
    },
    {
      id: 'action:redo',
      title: 'Redo',
      group: 'Actions',
      icon: Redo2,
      shortcut: shortcutHint('redo'),
      keywords: ['again', 'forward'],
      disabledReason: state.future.length ? undefined : 'Nothing to redo',
      run: ({ notify }) => historyStep('redo', notify),
    },
    {
      id: 'action:togglePreview',
      title: 'Toggle preview',
      group: 'Actions',
      icon: Eye,
      subtitle: designing ? 'Run the card with live state, actions and mock data' : 'Back to design mode',
      shortcut: shortcutHint('togglePreview'),
      keywords: ['preview', 'design', 'run', 'play', 'test', 'mode', 'interactive'],
      run: () => {
        const s = useEditor.getState();
        s.setMode(s.mode === 'design' ? 'preview' : 'design');
      },
    },
    ...selectionCommands(ext, state.selectedNodeId && ext.nodes[state.selectedNodeId] ? state.selectedNodeId : null),
    ...settingsCommands(ext, state.selectedNodeId && ext.nodes[state.selectedNodeId] ? state.selectedNodeId : null),
  ];
}

function insertCommands(ext: Extension, selected: NodeId | null): Command[] {
  const out: Command[] = [];
  for (const def of listComponents()) {
    if (def.hiddenFromPalette || def.deprecated || !isAvailableIn(def, ext)) continue;
    const target = paletteInsertTarget(ext, selected, def.type);
    out.push({
      id: `insert:${def.type}`,
      title: `Insert ${def.label}`,
      group: 'Insert',
      icon: def.icon,
      subtitle: def.description,
      keywords: [def.type, def.category, 'add', 'new', 'component', ...(def.keywords ?? [])],
      disabledReason: target ? undefined : explainNoTarget(ext, def.type),
      run: ({ notify }) => {
        ensureDesignMode();
        insertComponent(def.type, notify);
      },
    });
  }
  return out;
}

/**
 * Inserts a block (template subtree) with the state it needs in one undo step, at the smart
 * target (into / after the selection), through the templates module like the canvas does.
 */
export function runInsertBlock(block: PaletteBlock, notify: Notify): void {
  ensureDesignMode();
  const built = prepareBlock(block);
  const res = insertBlock(built.template, built.state, block.name, undefined, built.dataSources);
  if (res.message) notify(res.message);
}

function blockCommands(blocks: PaletteBlock[], ext: Extension, selected: NodeId | null): Command[] {
  return blocks.map((b) => {
    const def = getComponent(b.template.type);
    // The same target the templates module's insertBlock uses (into / after the selection).
    const target = def && isAvailableIn(def, ext) ? smartInsertTarget(ext, selected, b.template.type) : null;
    return {
      id: `${b.user ? 'userblock' : 'block'}:${b.id}`,
      title: `Insert block: ${b.name}`,
      group: 'Blocks' as const,
      icon: b.icon ?? (b.user ? Puzzle : Blocks),
      subtitle: b.user ? 'Saved block' : b.description,
      keywords: ['block', 'template', 'snippet', 'insert', ...(b.keywords ?? [])],
      disabledReason: target ? undefined : `“${b.name}” can't be added here`,
      run: ({ notify }) => runInsertBlock(b, notify),
    };
  });
}

function goToCommands(ext: Extension): Command[] {
  const out: Command[] = [];
  const parents = buildParentIndex(ext);
  walk(ext, (node) => {
    if (node.id === ext.rootId) return;
    const path: string[] = [];
    let cur = parents.get(node.id)?.parentId;
    const seen = new Set<NodeId>();
    while (cur && cur !== ext.rootId && !seen.has(cur)) {
      seen.add(cur);
      path.unshift(nodeTitle(ext, cur));
      cur = parents.get(cur)?.parentId;
    }
    const def = getComponent(node.type);
    out.push({
      id: `goto:${node.id}`,
      title: `Go to ${nodeTitle(ext, node.id)}`,
      group: 'Go to',
      icon: def?.icon ?? Navigation,
      subtitle: path.length ? path.join(' › ') : 'Top level',
      keywords: [node.type, def?.label ?? '', node.name ?? '', 'select', 'find', 'layer'],
      run: () => goToNode(node.id),
    });
  });
  return out;
}

function extensionCommands(src: CommandSources): Command[] {
  const { project, activeExtensionId } = src.state;
  const active = project.extensions.find((e) => e.id === activeExtensionId);
  const out: Command[] = [];
  for (const e of project.extensions) {
    if (e.id === activeExtensionId) continue;
    out.push({
      id: `ext:switch:${e.id}`,
      title: `Switch to ${e.name}`,
      group: 'Extensions',
      icon: e.kind === 'home' ? House : e.kind === 'settings' ? Settings : LayoutPanelTop,
      subtitle: KIND_LABELS[e.kind],
      keywords: ['open', 'extension', 'card', e.fileName],
      run: () => useEditor.getState().setActiveExtension(e.id),
    });
  }
  const hasSettings = project.extensions.some((e) => e.kind === 'settings');
  const hasHome = project.extensions.some((e) => e.kind === 'home');
  const add = (kind: ExtensionKind, notify: Notify) => {
    useEditor.getState().addExtension({ kind });
    const added = selectActiveExtension(useEditor.getState());
    notify(`Added “${added.name}”`);
  };
  out.push(
    {
      id: 'ext:add:card',
      title: 'Add card',
      group: 'Extensions',
      icon: Plus,
      subtitle: 'A new app card for CRM records',
      keywords: ['new', 'extension', 'app card'],
      run: ({ notify }) => add('card', notify),
    },
    {
      id: 'ext:add:settings',
      title: 'Add settings page',
      group: 'Extensions',
      icon: Settings,
      subtitle: 'The app’s settings page',
      keywords: ['new', 'extension', 'settings'],
      disabledReason: hasSettings ? 'This project already has a settings page' : undefined,
      run: ({ notify }) => add('settings', notify),
    },
    {
      id: 'ext:add:home',
      title: 'Add app home',
      group: 'Extensions',
      icon: House,
      subtitle: 'The app’s home page',
      keywords: ['new', 'extension', 'home page'],
      disabledReason: hasHome ? 'This project already has an app home page' : undefined,
      run: ({ notify }) => add('home', notify),
    },
    {
      id: 'ext:duplicate',
      title: active?.kind === 'card' ? 'Duplicate this card' : 'Duplicate this extension',
      group: 'Extensions',
      icon: CopyPlus,
      subtitle: active ? `Opens a copy of “${active.name}”` : undefined,
      keywords: ['copy', 'clone', 'duplicate card', 'extension', 'card'],
      disabledReason: !active
        ? 'There is no extension to duplicate'
        : active.kind !== 'card'
          ? `A project can only have one ${KIND_LABELS[active.kind].toLowerCase()}`
          : undefined,
      run: ({ notify }) => {
        if (!active) return;
        const id = useEditor.getState().duplicateExtension(active.id);
        if (!id) return;
        notify(`Duplicated “${active.name}” as “${selectActiveExtension(useEditor.getState()).name}”`);
      },
    },
    {
      id: 'dialog:extensionSettings',
      title: 'Manage extensions',
      group: 'Extensions',
      icon: ArrowRightLeft,
      subtitle: 'Rename, duplicate, move or remove cards and pages',
      keywords: ['extensions', 'cards', 'rename', 'duplicate', 'remove', 'delete', 'location'],
      run: () => openDialog('extensionSettings'),
    },
  );
  return out;
}

/** Search words per data source kind (only the API source matches "fetch"). */
const DATA_SOURCE_KEYWORDS: Partial<Record<DataSourceKind, string[]>> = {
  crmProperties: ['crmProperties', 'record', 'properties', 'fields', 'useCrmProperties'],
  associations: ['associations', 'associated', 'related', 'useAssociations'],
  crmSearch: ['crmSearch', 'search', 'query', 'filter', 'list', 'useCrmSearch'],
  fetch: ['fetch', 'api', 'http', 'rest', 'url', 'request', 'external', 'hubspot.fetch'],
  function: ['function', 'serverless', 'backend', 'server', 'hubspot.serverless'],
};

/** "Filter or sort <list>": a shaped list (power/shape) of each CRM list data source and list variable. */
function listCommands(ext: Extension): Command[] {
  const lists = [
    ...ext.dataSources.filter((d) => d.kind === 'associations' || d.kind === 'crmSearch').map((d) => d.name),
    ...ext.state.filter((v) => v.type === 'array').map((v) => v.name),
  ];
  return lists.map((name) => ({
    id: `data:shape:${name}`,
    title: `Filter or sort ${name}`,
    group: 'Data' as const,
    icon: ListFilter,
    subtitle: 'Only some rows, in an order, the first few, formatted values — no code',
    keywords: ['filter', 'sort', 'order', 'limit', 'top', 'format', 'currency', 'date', 'list', 'rows', 'view'],
    run: ({ notify }: CommandEnv) => {
      const c = addShapedList(name);
      showLeftPanel('data');
      usePowerUi.getState().revealComputed(c.id);
      notify(`Added “${c.name}” — choose filters, sorting and formats under Computed`);
    },
  }));
}

function dataCommands(ext: Extension): Command[] {
  const crm = ext.kind === 'card';
  const out: Command[] = [
    {
      id: 'data:addState',
      title: 'Add state variable',
      group: 'Data',
      icon: Variable,
      subtitle: 'A value that changes while the card is open',
      keywords: ['useState', 'variable', 'new variable', 'new', 'state', 'value', 'store'],
      run: ({ notify }) => {
        const v = useEditor.getState().addStateVar({ name: 'value', type: 'string', initial: '' });
        showLeftPanel('data');
        notify(`Added state variable “${v.name}”`);
      },
    },
  ];
  for (const info of DATA_SOURCE_KINDS) {
    out.push({
      id: `data:addSource:${info.kind}`,
      title: `Add data source: ${info.label}`,
      group: 'Data',
      icon: info.icon ?? Database,
      subtitle: info.description,
      keywords: ['data', 'source', 'load', 'new', ...(DATA_SOURCE_KEYWORDS[info.kind] ?? [info.kind])],
      disabledReason: info.crmOnly && !crm ? 'Only available on app cards (CRM records)' : undefined,
      run: ({ notify }) => {
        showLeftPanel('data');
        const ds = addDataSourceOfKind(info.kind as DataSourceKind);
        notify(`Added data source “${ds.name}”`);
      },
    });
  }
  out.push(
    {
      id: 'data:addComputed',
      title: 'Add computed value',
      group: 'Data',
      icon: Sigma,
      subtitle: 'Derive a value from state and data',
      keywords: ['computed', 'derived', 'formula', 'calculate', 'expression', 'new', 'useMemo'],
      run: () => {
        const c = useEditor.getState().addComputed();
        showLeftPanel('data');
        usePowerUi.getState().revealComputed(c.id);
      },
    },
    ...listCommands(ext),
    {
      id: 'data:helpers',
      title: 'Edit helper functions',
      group: 'Data',
      icon: SquareFunction,
      subtitle: 'Reusable functions any expression can call',
      keywords: ['helpers', 'functions', 'code', 'utils', 'javascript', 'typescript'],
      run: () => {
        showLeftPanel('data');
        usePowerUi.getState().focusHelpers();
      },
    },
  );
  return out;
}

function viewCommands(zoom: number): Command[] {
  const bottom = (id: 'code' | 'problems' | 'console', title: string, icon: LucideIcon, keywords: string[]): Command => ({
    id: `view:${id}`,
    title,
    group: 'View',
    icon,
    shortcut: undefined,
    keywords: ['panel', 'bottom', ...keywords],
    run: () => showBottomPanel(id),
  });
  const left = (
    tab: 'components' | 'layers' | 'templates' | 'data',
    title: string,
    icon: LucideIcon,
    shortcutId: string,
    keywords: string[],
  ): Command => ({
    id: `view:${tab}`,
    title,
    group: 'View',
    icon,
    shortcut: shortcutHint(shortcutId),
    keywords: ['panel', 'sidebar', 'tab', ...keywords],
    run: () => showLeftPanel(tab),
  });
  return [
    bottom('code', 'Show code', Code, ['tsx', 'generated', 'source', 'view']),
    bottom('problems', 'Show problems', TriangleAlert, ['errors', 'warnings', 'validation', 'issues']),
    bottom('console', 'Show console', SquareTerminal, ['logs', 'log', 'debug', 'output']),
    left('components', 'Show components', ComponentIcon, 'tabComponents', ['palette', 'library']),
    left('layers', 'Show layers', Layers, 'tabLayers', ['tree', 'outline', 'hierarchy']),
    left('templates', 'Show templates', LayoutTemplate, 'tabTemplates', ['blocks', 'starters']),
    left('data', 'Show data', Database, 'tabData', ['state', 'data sources', 'computed', 'helpers', 'mock']),
    ...zoomCommands(zoom),
  ];
}

const pct = (z: number) => `${Math.round(z * 100)}%`;

function zoomCommands(zoom: number): Command[] {
  const view = () => useCanvasView.getState();
  const now = `The canvas is at ${pct(zoom)}`;
  return [
    {
      id: 'view:zoomIn',
      title: 'Zoom in',
      group: 'View',
      icon: ZoomIn,
      subtitle: now,
      keywords: ['zoom', 'bigger', 'larger', 'magnify', 'enlarge', 'canvas', 'scale'],
      disabledReason: zoom >= MAX_ZOOM - 0.001 ? `Already at the largest zoom (${pct(MAX_ZOOM)})` : undefined,
      run: () => view().setZoom(nextZoom(view().zoom, 1)),
    },
    {
      id: 'view:zoomOut',
      title: 'Zoom out',
      group: 'View',
      icon: ZoomOut,
      subtitle: now,
      keywords: ['zoom', 'smaller', 'shrink', 'canvas', 'scale'],
      disabledReason: zoom <= MIN_ZOOM + 0.001 ? `Already at the smallest zoom (${pct(MIN_ZOOM)})` : undefined,
      run: () => view().setZoom(nextZoom(view().zoom, -1)),
    },
    {
      id: 'view:zoomReset',
      title: 'Zoom to 100%',
      group: 'View',
      icon: ScanSearch,
      subtitle: now,
      keywords: ['zoom', 'reset zoom', 'actual size', '100', 'canvas', 'scale'],
      disabledReason: Math.abs(zoom - 1) < 0.001 ? 'The canvas is already at 100%' : undefined,
      run: () => view().setZoom(1),
    },
    {
      id: 'view:zoomFit',
      title: 'Zoom to fit width',
      group: 'View',
      icon: Maximize2,
      subtitle: 'Scale the card so it fits the canvas',
      keywords: ['zoom', 'fit', 'fit to width', 'canvas', 'scale', 'screen'],
      run: () => view().requestFit(),
    },
  ];
}

/**
 * "Add action: …" for the selected component: appends a step (with the inspector's smart
 * defaults) to its first event — the click of a button, the change of an input — and opens the
 * Events tab to configure it. Listed (disabled, with the reason) when nothing with events is
 * selected, so searching "fetch" or "alert" still explains how to get there.
 */
function eventCommands(ext: Extension, selected: NodeId | null): Command[] {
  const node = selected ? ext.nodes[selected] : undefined;
  const def = node ? getComponent(node.type) : undefined;
  const ev = def?.events?.[0];
  const label = node ? nodeTitle(ext, node.id) : '';
  const disabledReason = !node
    ? 'Select a button, input or other interactive component first'
    : !ev
      ? `${typeLabel(node.type)} has no events — select a button, link or input`
      : undefined;
  const subtitle = node && ev ? `${eventWhen(ev.label)} — ${label}${def!.events!.length > 1 ? ` (${ev.name})` : ''}` : undefined;
  return availableActionKinds(ext).map((kind) => ({
    id: `event:add:${kind.type}`,
    title: `Add action: ${kind.label}`,
    group: 'Events' as const,
    icon: kind.icon,
    subtitle: subtitle ?? kind.description,
    keywords: ['action', 'event', 'handler', 'when', 'on click', kind.type, kind.group.toLowerCase(), ...(ev ? [ev.name] : [])],
    disabledReason,
    run: ({ notify }) => {
      if (!node || !ev) return;
      const editor = useEditor.getState();
      const current = selectActiveExtension(editor);
      const steps = current.nodes[node.id]?.events?.[ev.name] ?? [];
      const ctx: ActionContext = { project: editor.project, ext: current, nodeId: node.id, eventParams: ev.params.map((p) => p.name) };
      editor.setEvent(node.id, ev.name, [...steps, createStep(kind.type, ctx)]);
      ensureDesignMode();
      showRightTab('events');
      notify(`Added “${kind.label}” to ${label} (${eventWhen(ev.label).toLowerCase()})`);
    },
  }));
}

function projectCommands(): Command[] {
  const dialog = (id: DialogName, title: string, icon: LucideIcon, subtitle: string, keywords: string[], shortcutId?: string): Command => ({
    id: `dialog:${id}`,
    title,
    group: 'Project',
    icon,
    subtitle,
    keywords,
    shortcut: shortcutId ? shortcutHint(shortcutId) : undefined,
    run: () => openDialog(id),
  });
  return [
    dialog('appSettings', 'Open app settings', Settings, 'Name, scopes, permitted URLs, support info', ['app', 'scopes', 'urls', 'auth', 'config']),
    dialog('functions', 'Open app functions', SquareFunction, 'Server-side functions (hubspot.serverless)', ['serverless', 'backend', 'functions']),
    dialog('export', 'Publish to HubSpot', Package, 'Publish your cards, or download the HubSpot project (.zip)', ['export', 'download', 'zip', 'deploy', 'upload', 'publish'], 'export'),
    dialog('projects', 'Open projects', FolderOpen, 'Saved projects, import a .uiex.json', ['open', 'load', 'import', 'saved']),
    dialog('newProject', 'New project', FilePlus, 'Start from a template or a blank project', ['create', 'template', 'start']),
    dialog('shortcuts', 'Open keyboard shortcuts', Keyboard, 'Every shortcut of the editor', ['keys', 'help', 'hotkeys'], 'shortcuts'),
  ];
}

/** Every command for the current state, in default display order within each group. */
export function buildCommands(src: CommandSources): Command[] {
  const ext = selectActiveExtension(src.state);
  if (!ext) return [];
  const selected = src.state.selectedNodeId && ext.nodes[src.state.selectedNodeId] ? src.state.selectedNodeId : null;
  const zoom = src.zoom ?? useCanvasView.getState().zoom;
  return [
    ...generalCommands(src, ext),
    ...dataCommands(ext),
    ...viewCommands(zoom),
    ...projectCommands(),
    ...extensionCommands(src),
    ...eventCommands(ext, selected),
    ...blockCommands(src.blocks, ext, selected),
    ...insertCommands(ext, selected),
    ...goToCommands(ext),
  ];
}
