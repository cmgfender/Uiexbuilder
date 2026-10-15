/**
 * Store-level operations of the power module (shared by the Data panel sections and the command
 * palette). Each reads the latest store state, so they can run from any event handler.
 */
import * as shellStore from '../shell/shellStore';
import { smartInsertTarget } from '../dnd/dragState';
import { canAccept } from '../model/rules';
import { selectActiveExtension, useEditor, type BottomPanelTab, type LeftPanelTab } from '../model/store';
import { findParent, type InsertTarget } from '../model/tree';
import type { Extension, NodeId, NodeTemplate, StateVar } from '../model/types';
import { renameReferences } from '../panels/findUsages';
import { getComponent } from '../registry';

export type Notify = (message: string) => void;

function activeExt(): Extension {
  return selectActiveExtension(useEditor.getState());
}

// ---------------------------------------------------------------------------
// Computed values
// ---------------------------------------------------------------------------

/**
 * Renames a computed value and every reference to it (one undo step). Returns the number of
 * updated references.
 */
export function renameComputed(id: string, name: string): number {
  const ext = activeExt();
  const c = ext.computed?.find((x) => x.id === id);
  if (!c || c.name === name) return 0;
  const old = c.name;
  let changed = 0;
  useEditor.getState().commit((draft) => {
    const e = draft.extensions.find((x) => x.id === ext.id);
    const dc = e?.computed?.find((x) => x.id === id);
    if (!e || !dc) return;
    dc.name = name;
    changed = renameReferences(e as Extension, old, name);
  });
  return changed;
}

// ---------------------------------------------------------------------------
// Panels (the shell's helpers expand collapsed sidebars; fall back to the store)
// ---------------------------------------------------------------------------

const shell = shellStore as unknown as Record<string, unknown>;

/** Shows a left sidebar tab (expanding the sidebar when the shell supports it). */
export function showLeftPanel(tab: LeftPanelTab): void {
  const fn = shell.showLeftTab;
  if (typeof fn === 'function') (fn as (t: LeftPanelTab) => void)(tab);
  else useEditor.getState().setLeftPanel(tab);
}

/** Opens a bottom panel tab (code / problems / console). */
export function showBottomPanel(tab: Exclude<BottomPanelTab, null>): void {
  const fn = shell.openBottomTab;
  if (typeof fn === 'function') (fn as (t: Exclude<BottomPanelTab, null>) => void)(tab);
  else useEditor.getState().setBottomPanel(tab);
}

// ---------------------------------------------------------------------------
// Insertion
// ---------------------------------------------------------------------------

/**
 * Where a component of `type` goes: `smartInsertTarget` (into / after the selection, else the end
 * of the root) or, for overlays (Modal, Panel, Tooltip), the free overlay slot of the selected
 * trigger or its nearest ancestor that has one.
 */
export function insertTargetFor(ext: Extension, selectedId: NodeId | null, type: string): InsertTarget | null {
  const smart = smartInsertTarget(ext, selectedId, type);
  if (smart) return smart;
  let cur: NodeId | null = selectedId && ext.nodes[selectedId] ? selectedId : null;
  const seen = new Set<NodeId>();
  while (cur && cur !== ext.rootId && !seen.has(cur)) {
    seen.add(cur);
    const node = ext.nodes[cur];
    for (const slot of getComponent(node.type)?.slots ?? []) {
      if (canAccept(ext, cur, type, slot.name).ok) return { parentId: cur, slot: slot.name, index: node.slots?.[slot.name]?.length ?? 0 };
    }
    cur = findParent(ext, cur)?.parentId ?? null;
  }
  return null;
}

/** Why nothing accepts `type` right now (plain language, for a toast). */
export function explainNoTarget(ext: Extension, type: string): string {
  const def = getComponent(type);
  if (!def) return `Unknown component ${type}`;
  if (def.overlay || def.slotOnly) return `Select a button, link or image first — ${def.label} opens from it.`;
  if (def.parents?.length) {
    const labels = def.parents.map((p) => getComponent(p)?.label ?? p);
    return `Select a ${labels.join(' or ')} first — ${def.label} goes inside it.`;
  }
  return canAccept(ext, ext.rootId, type).reason ?? `${def.label} can't be added here.`;
}

function ensureDesignMode(): void {
  const s = useEditor.getState();
  if (s.mode !== 'design') s.setMode('design');
}

/** Inserts a component (registry default template) where a palette click would. Returns the new id. */
export function insertComponent(type: string, notify: Notify): NodeId | null {
  ensureDesignMode();
  const state = useEditor.getState();
  const ext = activeExt();
  const target = insertTargetFor(ext, state.selectedNodeId, type);
  if (!target) {
    notify(explainNoTarget(ext, type));
    return null;
  }
  const id = state.insertNode(type, target, { select: true });
  if (!id) notify(`${getComponent(type)?.label ?? type} can't be added here.`);
  return id;
}

/**
 * Inserts a block (template subtree). State variables the block relies on are added first when
 * the extension does not have them (matched by name) — only once the insert position is known.
 */
export function insertBlock(
  block: { template: NodeTemplate; label: string; state?: Array<Omit<StateVar, 'id'>> },
  notify: Notify,
): NodeId | null {
  ensureDesignMode();
  const state = useEditor.getState();
  const ext = activeExt();
  const target = insertTargetFor(ext, state.selectedNodeId, block.template.type);
  if (!target) {
    notify(`“${block.label}” can't be added here. ${explainNoTarget(ext, block.template.type)}`);
    return null;
  }
  const added: string[] = [];
  for (const v of block.state ?? []) {
    if (activeExt().state.some((s) => s.name === v.name)) continue;
    useEditor.getState().addStateVar({ ...v });
    added.push(v.name);
  }
  const id = useEditor.getState().insertNode(block.template, target, { select: true });
  if (!id) notify(`“${block.label}” can't be added here.`);
  else if (added.length) notify(`Added “${block.label}” and state ${added.map((n) => `“${n}”`).join(', ')}`);
  return id;
}

/** Selects a node of the active extension (switching to design mode so the canvas reveals it). */
export function goToNode(id: NodeId): void {
  ensureDesignMode();
  useEditor.getState().select(id);
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Copies text to the system clipboard. Resolves false when the browser refuses. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}
