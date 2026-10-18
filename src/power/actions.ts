/**
 * Store-level operations of the power module (shared by the Data panel sections and the command
 * palette). Each reads the latest store state, so they can run from any event handler.
 *
 * Inserting components and blocks is not duplicated here: the palette uses the shell's
 * `insertComponent` / `paletteInsertTarget` / `explainNoTarget` (src/shell/actions) and the
 * templates module's `insertBlock`, like the component palette and the canvas do.
 */
import { openBottomTab, showLeftTab } from '../shell/shellStore';
import { selectActiveExtension, useEditor, type BottomPanelTab, type LeftPanelTab } from '../model/store';
import type { ComputedValue, Extension, NodeId } from '../model/types';
import { renameReferences } from '../panels/findUsages';
import { shapeToExpr } from './shape';

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

/** `deals` for `deals`, `deals ?? []`, `weather.items` → `weatherItems`. */
function listBaseName(source: string): string {
  const s = source.replace(/\s*\?\?\s*\[\s*\]\s*$/, '').trim();
  const parts = s.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  if (!parts.length) return 'list';
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

/** The list a repeat / source expression stands for (`deals ?? []` → `deals`). */
export function listSourceOf(expr: string): string {
  return expr.replace(/\s*\?\?\s*\[\s*\]\s*$/, '').trim();
}

/**
 * Adds a shaped list (filter / sort / limit / format, see shape.ts) of `source` as a computed
 * value at the end of the list — after everything it can read — named like `dealsView`.
 */
export function addShapedList(source: string): ComputedValue {
  const src = listSourceOf(source);
  return useEditor.getState().addComputed({
    name: `${listBaseName(src)}View`,
    expr: shapeToExpr({ source: src }),
    description: `${src}, filtered and sorted`,
  });
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

/** Shows a left sidebar tab (expanding the sidebar when it is collapsed). */
export function showLeftPanel(tab: LeftPanelTab): void {
  showLeftTab(tab);
}

/** Opens a bottom panel tab (code / problems / console). */
export function showBottomPanel(tab: Exclude<BottomPanelTab, null>): void {
  openBottomTab(tab);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Switches the canvas to design mode (inserting and selecting only make sense there). */
export function ensureDesignMode(): void {
  const s = useEditor.getState();
  if (s.mode !== 'design') s.setMode('design');
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
