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
  Navigation,
  Package,
  Plus,
  Redo2,
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
} from 'lucide-react';
import * as shortcutsModule from '../shell/shortcuts';
import { useDialogs, type DialogName } from '../shell/dialogs';
import { generateNodeJsx } from '../codegen';
import { canAccept, isAvailableIn } from '../model/rules';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { buildParentIndex, findParent, nodeLabel, walk } from '../model/tree';
import type { DataSourceKind, Extension, ExtensionKind, NodeId, NodeTemplate, StateVar } from '../model/types';
import { addDataSourceOfKind } from '../panels/actions';
import { DATA_SOURCE_KINDS } from '../panels/dataSourceMeta';
import { getComponent, listComponents } from '../registry';
import * as templateActions from '../templates/actions';
import {
  copyToClipboard,
  explainNoTarget,
  goToNode,
  insertBlock as insertBlockFallback,
  insertComponent,
  insertTargetFor,
  showBottomPanel,
  showLeftPanel,
  type Notify,
} from './actions';
import { usePowerUi } from './uiStore';

export type CommandGroup = 'Actions' | 'Insert' | 'Blocks' | 'Go to' | 'Extensions' | 'Data' | 'View' | 'Project';

/** Display order of groups when the query is empty (search results are ordered by score). */
export const GROUP_ORDER: CommandGroup[] = ['Actions', 'Data', 'View', 'Project', 'Extensions', 'Blocks', 'Insert', 'Go to'];

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
}

export interface CommandSources {
  state: Pick<EditorState, 'project' | 'activeExtensionId' | 'selectedNodeId' | 'mode' | 'past' | 'future'>;
  blocks: PaletteBlock[];
}

// ---------------------------------------------------------------------------
// Shortcut hints (the shell module documents every binding in SHORTCUTS)
// ---------------------------------------------------------------------------

interface ShortcutsApi {
  SHORTCUTS?: Array<{ id: string; keys: string }>;
  formatShortcut?: (keys: string) => string;
}
const shortcutsApi = shortcutsModule as unknown as ShortcutsApi;

/** Formatted shortcut of a SHORTCUTS id, or undefined when the shell does not define it. */
export function shortcutHint(id: string): string | undefined {
  const def = Array.isArray(shortcutsApi.SHORTCUTS) ? shortcutsApi.SHORTCUTS.find((s) => s.id === id) : undefined;
  if (!def) return undefined;
  try {
    return typeof shortcutsApi.formatShortcut === 'function' ? shortcutsApi.formatShortcut(def.keys) : def.keys;
  } catch {
    return def.keys;
  }
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
      keywords: ['code', 'tsx', 'clipboard', 'export', 'react'],
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
      run: () => useEditor.getState().undo(),
    },
    {
      id: 'action:redo',
      title: 'Redo',
      group: 'Actions',
      icon: Redo2,
      shortcut: shortcutHint('redo'),
      keywords: ['again', 'forward'],
      disabledReason: state.future.length ? undefined : 'Nothing to redo',
      run: () => useEditor.getState().redo(),
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
  ];
}

function insertCommands(ext: Extension, selected: NodeId | null): Command[] {
  const out: Command[] = [];
  for (const def of listComponents()) {
    if (def.hiddenFromPalette || def.deprecated || !isAvailableIn(def, ext)) continue;
    const target = insertTargetFor(ext, selected, def.type);
    out.push({
      id: `insert:${def.type}`,
      title: `Insert ${def.label}`,
      group: 'Insert',
      icon: def.icon,
      subtitle: def.description,
      keywords: [def.type, def.category, 'add', 'component', ...(def.keywords ?? [])],
      disabledReason: target ? undefined : explainNoTarget(ext, def.type),
      run: ({ notify }) => {
        insertComponent(def.type, notify);
      },
    });
  }
  return out;
}

type BlockFlow = (
  template: NodeTemplate,
  state: Array<Omit<StateVar, 'id'>> | undefined,
  label: string,
) => { ok: boolean; message: string };

/** The templates module's block insertion (single undo step, unique overlay ids) when available. */
const templateInsertBlock = (templateActions as unknown as { insertBlock?: unknown }).insertBlock;

export function runInsertBlock(block: PaletteBlock, notify: Notify): void {
  if (useEditor.getState().mode !== 'design') useEditor.getState().setMode('design');
  if (typeof templateInsertBlock === 'function') {
    const res = (templateInsertBlock as BlockFlow)(block.template, block.state, block.name);
    if (res && typeof res.message === 'string' && res.message) notify(res.message);
    return;
  }
  insertBlockFallback({ template: block.template, label: block.name, state: block.state }, notify);
}

function blockCommands(blocks: PaletteBlock[], ext: Extension, selected: NodeId | null): Command[] {
  return blocks.map((b) => {
    const def = getComponent(b.template.type);
    const target = def && isAvailableIn(def, ext) ? insertTargetFor(ext, selected, b.template.type) : null;
    return {
      id: `${b.user ? 'userblock' : 'block'}:${b.id}`,
      title: `Insert block: ${b.name}`,
      group: 'Blocks' as const,
      icon: b.icon ?? (b.user ? Puzzle : Blocks),
      subtitle: b.user ? 'Saved block' : b.description,
      keywords: ['block', 'template', 'snippet', ...(b.keywords ?? [])],
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
      id: 'dialog:extensionSettings',
      title: 'Manage extensions',
      group: 'Extensions',
      icon: ArrowRightLeft,
      subtitle: 'Rename, move or remove cards and pages',
      keywords: ['extensions', 'cards', 'rename', 'remove', 'location'],
      run: () => openDialog('extensionSettings'),
    },
  );
  return out;
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
      keywords: ['useState', 'variable', 'new'],
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
      keywords: ['data', 'source', 'fetch', 'load', info.kind],
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
      keywords: ['derived', 'formula', 'calculate', 'expression', 'new'],
      run: () => {
        const c = useEditor.getState().addComputed();
        showLeftPanel('data');
        usePowerUi.getState().revealComputed(c.id);
      },
    },
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

function viewCommands(): Command[] {
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
  ];
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
    dialog('export', 'Open export', Package, 'Download the HubSpot project (.zip)', ['export', 'download', 'zip', 'deploy', 'upload'], 'export'),
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
  return [
    ...generalCommands(src, ext),
    ...dataCommands(ext),
    ...viewCommands(),
    ...projectCommands(),
    ...extensionCommands(src),
    ...blockCommands(src.blocks, ext, selected),
    ...insertCommands(ext, selected),
    ...goToCommands(ext),
  ];
}
