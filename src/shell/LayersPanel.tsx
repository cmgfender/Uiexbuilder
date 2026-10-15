/**
 * Layers tree of the active extension: selection & hover synced with the canvas, inline rename,
 * hide / lock toggles, logic badges, drag & drop reordering (also accepts palette and block drags),
 * full keyboard control and a context menu.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  Link2,
  Lock,
  LockOpen,
  Pencil,
  Repeat,
  Scissors,
  SquareDashed,
  SquareStack,
  Trash2,
  Zap,
} from 'lucide-react';
import { selectActiveExtension, useActiveExtension, useEditor } from '../model/store';
import { nodeLabel, toTemplate } from '../model/tree';
import type { Extension, NodeId, UINode } from '../model/types';
import { getComponent } from '../registry';
import { endDrag, payloadType, readPayload, startDrag, useDragStore } from '../dnd/dragState';
import { saveUserBlock } from '../templates';
import { Button, Dialog, EmptyState, Field, IconButton, Menu, TextInput, cx, useToast, type MenuItem } from '../ui';
import {
  applyDropPayload,
  cutNodeSafe,
  duplicateNodeSafe,
  moveSelectedAmongSiblings,
  pasteAt,
  removeNodeSafe,
  stateVarsUsedBy,
  typeLabel,
  wrapNodeSafe,
} from './actions';
import {
  ancestorRowKeys,
  flattenLayers,
  nextNodeRowIndex,
  resolveLayerDrop,
  resolveRootDrop,
  slotLabel,
  type ExpandOverrides,
  type LayerDrop,
  type LayerRow,
} from './layersModel';
import { recordRecentComponent } from './paletteModel';
import { showLeftTab } from './shellStore';
import { isEditableTarget, shortcutLabel } from './shortcuts';

const INDENT = 14;
const AUTO_EXPAND_MS = 600;

export function LayersPanel() {
  const toast = useToast();
  const ext = useActiveExtension();
  const selectedId = useEditor((s) => s.selectedNodeId);
  const hoveredId = useEditor((s) => s.hoveredNodeId);
  const hasClipboard = useEditor((s) => s.clipboard !== null);
  const [overrides, setOverrides] = useState<ExpandOverrides>({});
  const [renamingId, setRenamingId] = useState<NodeId | null>(null);
  const [drop, setDrop] = useState<LayerDrop | null>(null);
  const [rootDrop, setRootDrop] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: NodeId } | null>(null);
  const [blockFor, setBlockFor] = useState<NodeId | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const expandTimer = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  // Expansion state is per extension.
  const extId = ext.id;
  useEffect(() => {
    setOverrides({});
    setRenamingId(null);
  }, [extId]);

  const rows = useMemo(() => flattenLayers(ext, overrides), [ext, overrides]);

  /** The row of the selected layer (else the tree's first row): where keyboard focus belongs. */
  const selectedRowElement = useCallback((): HTMLElement | null => {
    const tree = treeRef.current;
    if (!tree) return null;
    const id = useEditor.getState().selectedNodeId;
    return (
      (id ? tree.querySelector<HTMLElement>(`[data-layer-key="${id}"]`) : null) ??
      tree.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
    );
  }, []);
  /** Re-focuses the selected row after the tree re-rendered (e.g. the focused row was deleted or moved). */
  const refocusSelectedRow = useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected && !treeRef.current?.contains(active)) return;
      selectedRowElement()?.focus({ preventScroll: true });
    });
  }, [selectedRowElement]);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);

  // Reveal the selection when it changes: expand its ancestors once, then scroll it into view.
  // (Only on selection changes, so collapsing a parent of the selected layer stays collapsed.)
  const revealFor = useRef<NodeId | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const current = selectActiveExtension(useEditor.getState());
    if (!current.nodes[selectedId]) return;
    const keys = ancestorRowKeys(current, selectedId);
    setOverrides((o) => (keys.every((k) => o[k] === true) ? o : { ...o, ...Object.fromEntries(keys.map((k) => [k, true])) }));
    revealFor.current = selectedId;
  }, [selectedId, extId]);

  useEffect(() => {
    if (!selectedId) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-layer-key="${selectedId}"]`);
    if (!el) return;
    if (revealFor.current === selectedId) {
      revealFor.current = null;
      el.scrollIntoView?.({ block: 'nearest' });
    }
    // Keep keyboard focus on the selected row while navigating the tree.
    const active = document.activeElement;
    if (active && treeRef.current?.contains(active) && active !== el && !isEditableTarget(active)) el.focus();
  }, [selectedId, rows]);

  useEffect(
    () => () => {
      if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    },
    [],
  );

  const setExpanded = useCallback((key: string, value: boolean) => {
    setOverrides((o) => ({ ...o, [key]: value }));
  }, []);

  const expandAll = (value: boolean) => {
    const next: ExpandOverrides = {};
    for (const node of Object.values(ext.nodes)) {
      if (node.id === ext.rootId) continue;
      next[node.id] = value;
      for (const slot of Object.keys(node.slots ?? {})) next[`${node.id}::${slot}`] = value;
    }
    setOverrides(next);
  };

  // ---------------------------------------------------------------- commands
  const commitRename = useCallback(
    (id: NodeId, value: string) => {
      setRenamingId(null);
      const node = getActiveNode(id);
      if (!node) return;
      const name = value.trim();
      if ((node.name ?? '') !== name) useEditor.getState().updateNode(id, { name });
      requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-layer-key="${id}"]`)?.focus());
    },
    [],
  );

  const cancelRename = useCallback((id: NodeId) => {
    setRenamingId(null);
    requestAnimationFrame(() => treeRef.current?.querySelector<HTMLElement>(`[data-layer-key="${id}"]`)?.focus());
  }, []);

  const toggleHidden = useCallback((id: NodeId) => {
    const node = getActiveNode(id);
    if (node) useEditor.getState().updateNode(id, { hiddenInDesigner: node.hiddenInDesigner ? undefined : true });
  }, []);

  const toggleLocked = useCallback((id: NodeId) => {
    const node = getActiveNode(id);
    if (node) useEditor.getState().updateNode(id, { locked: node.locked ? undefined : true });
  }, []);

  // ---------------------------------------------------------------- drag & drop
  const clearDrop = useCallback(() => {
    setDrop(null);
    setRootDrop(null);
    if (expandTimer.current) {
      clearTimeout(expandTimer.current.timer);
      expandTimer.current = null;
    }
  }, []);

  useEffect(() => {
    // Clear indicators when any drag ends (e.g. dropped on the canvas or cancelled).
    return useDragStore.subscribe((s, prev) => {
      if (!s.payload && prev.payload) clearDrop();
    });
  }, [clearDrop]);

  const onRowDragStart = useCallback(
    (row: LayerRow, e: DragEvent<HTMLDivElement>) => {
      const node = ext.nodes[row.nodeId];
      if (row.kind !== 'node' || !node || node.locked) {
        e.preventDefault();
        return;
      }
      e.stopPropagation();
      startDrag(e, { kind: 'move', nodeId: row.nodeId }, nodeLabel(node, typeLabel(node.type)));
    },
    [ext],
  );

  const computeDrop = useCallback(
    (row: LayerRow, e: DragEvent<HTMLElement>): LayerDrop | null => {
      const payload = useDragStore.getState().payload;
      if (!payload) return null;
      const type = payloadType(payload, ext);
      if (!type) return null;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
      const movingId = payload.kind === 'move' ? payload.nodeId : undefined;
      return resolveLayerDrop(ext, row, Math.max(0, Math.min(1, ratio)), type, movingId);
    },
    [ext],
  );

  const onRowDragOver = useCallback(
    (row: LayerRow, e: DragEvent<HTMLDivElement>) => {
      const d = computeDrop(row, e);
      if (!d) return;
      e.stopPropagation();
      if (d.ok) {
        e.preventDefault();
        e.dataTransfer.dropEffect = useDragStore.getState().payload?.kind === 'move' ? 'move' : 'copy';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
      setRootDrop(null);
      setDrop((cur) =>
        cur && cur.rowKey === d.rowKey && cur.position === d.position && cur.ok === d.ok && cur.depth === d.depth ? cur : d,
      );
      // Hovering the middle of a collapsed container expands it after a moment.
      if (row.hasChildren && !row.expanded && d.position === 'inside') {
        if (expandTimer.current?.key !== row.key) {
          if (expandTimer.current) clearTimeout(expandTimer.current.timer);
          expandTimer.current = { key: row.key, timer: setTimeout(() => setExpanded(row.key, true), AUTO_EXPAND_MS) };
        }
      } else if (expandTimer.current) {
        clearTimeout(expandTimer.current.timer);
        expandTimer.current = null;
      }
    },
    [computeDrop, setExpanded],
  );

  const onRowDrop = useCallback(
    (row: LayerRow, e: DragEvent<HTMLDivElement>) => {
      const d = computeDrop(row, e);
      const payload = readPayload(e);
      e.preventDefault();
      e.stopPropagation();
      clearDrop();
      endDrag();
      if (!d || !payload) return;
      if (!d.ok) {
        if (d.reason) toast(d.reason);
        return;
      }
      if (applyDropPayload(payload, d.target, toast) && payload.kind === 'new') recordRecentComponent(payload.componentType);
    },
    [computeDrop, clearDrop, toast],
  );

  const onTailDragOver = (e: DragEvent<HTMLDivElement>) => {
    const payload = useDragStore.getState().payload;
    if (!payload) return;
    const type = payloadType(payload, ext);
    if (!type) return;
    const r = resolveRootDrop(ext, type, payload.kind === 'move' ? payload.nodeId : undefined);
    if (r.ok) {
      e.preventDefault();
      e.dataTransfer.dropEffect = payload.kind === 'move' ? 'move' : 'copy';
    }
    setDrop(null);
    setRootDrop((cur) => (cur && cur.ok === r.ok && cur.reason === r.reason ? cur : { ok: r.ok, reason: r.reason }));
  };

  const onTailDrop = (e: DragEvent<HTMLDivElement>) => {
    const payload = readPayload(e);
    e.preventDefault();
    clearDrop();
    endDrag();
    if (!payload) return;
    const type = payloadType(payload, ext);
    if (!type) return;
    const r = resolveRootDrop(ext, type, payload.kind === 'move' ? payload.nodeId : undefined);
    if (!r.ok) {
      if (r.reason) toast(r.reason);
      return;
    }
    if (applyDropPayload(payload, r.target, toast) && payload.kind === 'new') recordRecentComponent(payload.componentType);
  };

  const onTreeDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) clearDrop();
  };

  // ---------------------------------------------------------------- keyboard
  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(e.target) || e.metaKey || e.ctrlKey) return;
    if (e.altKey) {
      // Alt+Up / Alt+Down reorder the selected layer among its siblings (as on the canvas).
      if (e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      if (moveSelectedAmongSiblings(e.key === 'ArrowUp' ? -1 : 1, toast)) refocusSelectedRow();
      return;
    }
    const state = useEditor.getState();
    const curIndex = selectedId ? rowIndex.get(selectedId) ?? -1 : -1;
    const cur = curIndex >= 0 ? rows[curIndex] : null;
    const selectRow = (i: number) => {
      if (i >= 0 && rows[i]?.kind === 'node') state.select(rows[i].nodeId);
    };
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        selectRow(curIndex === -1 ? nextNodeRowIndex(rows, -1, 1) : nextNodeRowIndex(rows, curIndex, 1));
        break;
      case 'ArrowUp':
        selectRow(curIndex === -1 ? nextNodeRowIndex(rows, rows.length, -1) : nextNodeRowIndex(rows, curIndex, -1));
        break;
      case 'Home':
        selectRow(nextNodeRowIndex(rows, -1, 1));
        break;
      case 'End':
        selectRow(nextNodeRowIndex(rows, rows.length, -1));
        break;
      case 'ArrowLeft':
        if (!cur) break;
        if (cur.hasChildren && cur.expanded) setExpanded(cur.key, false);
        else if (cur.parent && cur.parent.parentId !== ext.rootId) state.select(cur.parent.parentId);
        break;
      case 'ArrowRight':
        if (!cur || !cur.hasChildren) break;
        if (!cur.expanded) setExpanded(cur.key, true);
        else {
          const child = nextNodeRowIndex(rows, curIndex, 1);
          if (child !== -1 && rows[child].depth > cur.depth) selectRow(child);
        }
        break;
      case 'Enter':
      case 'F2':
        if (cur) setRenamingId(cur.nodeId);
        break;
      case 'Delete':
      case 'Backspace':
        // Focus follows the new selection (the focused row is gone).
        if (cur && removeNodeSafe(cur.nodeId, toast)) refocusSelectedRow();
        break;
      case 'ContextMenu':
        if (cur) {
          const el = treeRef.current?.querySelector<HTMLElement>(`[data-layer-key="${cur.key}"]`);
          const r = el?.getBoundingClientRect();
          setMenu({ x: (r?.left ?? 0) + 24, y: r?.bottom ?? 0, id: cur.nodeId });
        }
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---------------------------------------------------------------- context menu
  const menuItems = (id: NodeId): MenuItem[] => {
    const node = ext.nodes[id];
    if (!node) return [];
    const locked = !!node.locked;
    const state = useEditor.getState();
    const parentIsRoot = ext.nodes[ext.rootId].children.includes(id);
    const siblings = siblingPosition(ext, id);
    const move = (delta: 1 | -1) => {
      state.select(id);
      if (moveSelectedAmongSiblings(delta, toast)) refocusSelectedRow();
    };
    return [
      { label: 'Rename', icon: <Pencil size={14} />, shortcut: 'F2', onSelect: () => setRenamingId(id) },
      { label: 'Duplicate', icon: <CopyPlus size={14} />, shortcut: shortcutLabel('duplicate'), onSelect: () => duplicateNodeSafe(id, toast) },
      { separator: true, label: '' },
      { label: 'Copy', icon: <Copy size={14} />, shortcut: shortcutLabel('copy'), onSelect: () => state.copyNode(id) },
      { label: 'Cut', icon: <Scissors size={14} />, shortcut: shortcutLabel('cut'), disabled: locked, onSelect: () => cutNodeSafe(id, toast) },
      { label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: shortcutLabel('paste'), disabled: !hasClipboard, onSelect: () => pasteAt(id, toast) },
      { separator: true, label: '' },
      { label: 'Wrap in Flex', icon: <SquareDashed size={14} />, shortcut: shortcutLabel('wrap'), disabled: locked, onSelect: () => wrapNodeSafe(id, 'Flex', toast) },
      { label: 'Wrap in Box', icon: <SquareDashed size={14} />, disabled: locked, onSelect: () => wrapNodeSafe(id, 'Box', toast) },
      { label: 'Wrap in Tile', icon: <SquareStack size={14} />, disabled: locked, onSelect: () => wrapNodeSafe(id, 'Tile', toast) },
      { label: 'Select parent', icon: <CornerLeftUp size={14} />, disabled: parentIsRoot, onSelect: () => selectParentOf(ext, id) },
      { separator: true, label: '' },
      {
        label: 'Move up',
        icon: <ArrowUp size={14} />,
        shortcut: shortcutLabel('moveUp'),
        disabled: locked || !siblings || siblings.index === 0,
        onSelect: () => move(-1),
      },
      {
        label: 'Move down',
        icon: <ArrowDown size={14} />,
        shortcut: shortcutLabel('moveDown'),
        disabled: locked || !siblings || siblings.index >= siblings.count - 1,
        onSelect: () => move(1),
      },
      { separator: true, label: '' },
      { label: 'Save as block…', icon: <BookmarkPlus size={14} />, onSelect: () => setBlockFor(id) },
      {
        label: node.hiddenInDesigner ? 'Show in designer' : 'Hide in designer',
        icon: node.hiddenInDesigner ? <Eye size={14} /> : <EyeOff size={14} />,
        onSelect: () => toggleHidden(id),
      },
      {
        label: locked ? 'Unlock' : 'Lock',
        icon: locked ? <LockOpen size={14} /> : <Lock size={14} />,
        onSelect: () => toggleLocked(id),
      },
      { separator: true, label: '' },
      { label: 'Delete', icon: <Trash2 size={14} />, shortcut: shortcutLabel('delete'), danger: true, disabled: locked, onSelect: () => removeNodeSafe(id, toast) },
    ];
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  const onRowContextMenu = useCallback((row: LayerRow, e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (row.kind !== 'node') return;
    useEditor.getState().select(row.nodeId);
    setMenu({ x: e.clientX, y: e.clientY, id: row.nodeId });
  }, []);

  const onRowClick = useCallback(
    (row: LayerRow) => {
      if (row.kind === 'slot') {
        setExpanded(row.key, !row.expanded);
        return;
      }
      const state = useEditor.getState();
      if (state.mode !== 'design') state.setMode('design');
      state.select(row.nodeId);
    },
    [setExpanded],
  );

  const rootCount = ext.nodes[ext.rootId]?.children.length ?? 0;
  const nodeCount = Object.keys(ext.nodes).length - 1;
  const focusableKey = selectedId && rowIndex.has(selectedId) ? selectedId : rows.find((r) => r.kind === 'node')?.key;

  return (
    <div className="ub-sh-lyr">
      <div className="ub-sh-lyr-head">
        <span className="ub-sh-lyr-title" title={ext.name}>
          {ext.name}
        </span>
        <span className="ub-sh-lyr-count">{nodeCount === 1 ? '1 layer' : `${nodeCount} layers`}</span>
        <IconButton label="Expand all" size="sm" onClick={() => expandAll(true)} disabled={!rootCount}>
          <ChevronsUpDown size={13} />
        </IconButton>
        <IconButton label="Collapse all" size="sm" onClick={() => expandAll(false)} disabled={!rootCount}>
          <ChevronsDownUp size={13} />
        </IconButton>
      </div>
      <div
        className="ub-sh-lyr-tree ub-scroll"
        role="tree"
        aria-label="Layers"
        data-shortcuts-scope=""
        ref={treeRef}
        onKeyDown={onTreeKeyDown}
        onDragLeave={onTreeDragLeave}
        onMouseLeave={() => useEditor.getState().hover(null)}
      >
        {rows.map((row) => {
          const node = ext.nodes[row.nodeId];
          if (!node) return null;
          return (
            <LayerRowView
              key={row.key}
              row={row}
              node={node}
              label={row.kind === 'slot' ? slotLabel(ext, row.nodeId, row.slot!) : nodeLabel(node, typeLabel(node.type))}
              selected={row.kind === 'node' && row.nodeId === selectedId}
              hovered={row.kind === 'node' && row.nodeId === hoveredId}
              focusable={row.key === focusableKey}
              renaming={row.kind === 'node' && renamingId === row.nodeId}
              drop={drop && drop.rowKey === row.key ? drop : null}
              onClick={onRowClick}
              onToggle={setExpanded}
              onRename={setRenamingId}
              onCommitRename={commitRename}
              onCancelRename={cancelRename}
              onToggleHidden={toggleHidden}
              onToggleLocked={toggleLocked}
              onContextMenu={onRowContextMenu}
              onDragStart={onRowDragStart}
              onDragOver={onRowDragOver}
              onDrop={onRowDrop}
            />
          );
        })}
        <div
          className={cx(
            'ub-sh-lyr-tail',
            rootDrop?.ok && 'ub-sh-lyr-tail--drop',
            rootDrop && !rootDrop.ok && 'ub-sh-lyr-tail--reject',
          )}
          onDragOver={onTailDragOver}
          onDrop={onTailDrop}
          onClick={() => useEditor.getState().select(null)}
        >
          {rootCount === 0 ? (
            <EmptyState icon={<Layers size={22} />} title="No components yet">
              <div>Drag components here or onto the canvas.</div>
              <Button size="sm" style={{ marginTop: 8 }} onClick={() => showLeftTab('components')}>
                Browse components
              </Button>
            </EmptyState>
          ) : (
            rootDrop && <div className="ub-sh-lyr-tail-hint">{rootDrop.ok ? 'Add to the end of the card' : rootDrop.reason}</div>
          )}
        </div>
      </div>
      {menu && (
        <Menu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={closeMenu} returnFocus={selectedRowElement} aria-label="Layer actions" />
      )}
      <SaveBlockDialog
        ext={ext}
        nodeId={blockFor}
        onClose={() => setBlockFor(null)}
        onSaved={(name) => toast(`Saved “${name}” to My blocks (Templates tab)`)}
      />
    </div>
  );
}

function getActiveNode(id: NodeId): UINode | undefined {
  const s = useEditor.getState();
  return s.project.extensions.find((e) => e.id === s.activeExtensionId)?.nodes[id];
}

/** Index of a node among its siblings (children or slot content) and how many there are. */
function siblingPosition(ext: Extension, id: NodeId): { index: number; count: number } | null {
  for (const n of Object.values(ext.nodes)) {
    const lists = [n.children, ...Object.values(n.slots ?? {})];
    for (const list of lists) {
      const index = list.indexOf(id);
      if (index !== -1) return { index, count: list.length };
    }
  }
  return null;
}

function selectParentOf(ext: Extension, id: NodeId) {
  for (const n of Object.values(ext.nodes)) {
    if (n.children.includes(id) || Object.values(n.slots ?? {}).some((ids) => ids.includes(id))) {
      useEditor.getState().select(n.id === ext.rootId ? null : n.id);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  row: LayerRow;
  node: UINode;
  label: string;
  selected: boolean;
  hovered: boolean;
  focusable: boolean;
  renaming: boolean;
  drop: LayerDrop | null;
  onClick: (row: LayerRow) => void;
  onToggle: (key: string, value: boolean) => void;
  onRename: (id: NodeId) => void;
  onCommitRename: (id: NodeId, value: string) => void;
  onCancelRename: (id: NodeId) => void;
  onToggleHidden: (id: NodeId) => void;
  onToggleLocked: (id: NodeId) => void;
  onContextMenu: (row: LayerRow, e: MouseEvent<HTMLDivElement>) => void;
  onDragStart: (row: LayerRow, e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (row: LayerRow, e: DragEvent<HTMLDivElement>) => void;
  onDrop: (row: LayerRow, e: DragEvent<HTMLDivElement>) => void;
}

const LayerRowView = memo(function LayerRowView(p: RowProps) {
  const { row, node } = p;
  const isSlot = row.kind === 'slot';
  const def = getComponent(node.type);
  const Icon = isSlot ? SquareStack : def?.icon ?? SquareDashed;
  const eventNames = Object.entries(node.events ?? {})
    .filter(([, steps]) => steps.length > 0)
    .map(([name]) => name);
  const pad = 6 + row.depth * INDENT;
  const dropLeft = 6 + (p.drop?.depth ?? row.depth) * INDENT + 18;

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={isSlot ? undefined : p.selected}
      aria-label={isSlot ? `${p.label} of ${node.name ?? def?.label ?? node.type}` : undefined}
      tabIndex={!isSlot && (p.selected || p.focusable) ? 0 : -1}
      data-layer-key={row.key}
      className={cx(
        'ub-sh-lyr-row',
        isSlot && 'ub-sh-lyr-row--slot',
        p.selected && 'ub-sh-lyr-row--selected',
        p.hovered && !p.selected && 'ub-sh-lyr-row--hovered',
        !isSlot && node.hiddenInDesigner && 'ub-sh-lyr-row--hidden',
        p.drop?.position === 'inside' && (p.drop.ok ? 'ub-sh-lyr-row--drop-inside' : 'ub-sh-lyr-row--drop-reject'),
      )}
      style={{ paddingLeft: pad }}
      draggable={!isSlot && !node.locked && !p.renaming}
      onClick={() => p.onClick(row)}
      onDoubleClick={(e) => {
        if (isSlot) return;
        e.preventDefault();
        p.onRename(node.id);
      }}
      onMouseEnter={() => useEditor.getState().hover(isSlot ? null : node.id)}
      onContextMenu={(e) => p.onContextMenu(row, e)}
      onDragStart={(e) => p.onDragStart(row, e)}
      onDragEnd={() => endDrag()}
      onDragOver={(e) => p.onDragOver(row, e)}
      onDrop={(e) => p.onDrop(row, e)}
    >
      {Array.from({ length: row.depth }, (_, i) => (
        <span key={i} className="ub-sh-lyr-guide" style={{ left: 6 + i * INDENT + 7 }} aria-hidden />
      ))}
      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          className="ub-sh-lyr-twisty"
          aria-label={row.expanded ? 'Collapse' : 'Expand'}
          title={row.expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggle(row.key, !row.expanded);
          }}
        >
          {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="ub-sh-lyr-twisty ub-sh-lyr-twisty--leaf" aria-hidden />
      )}
      <Icon size={14} strokeWidth={1.75} className="ub-sh-lyr-icon" aria-hidden />
      {p.renaming ? (
        <RenameInput
          initial={node.name ?? ''}
          placeholder={def?.label ?? node.type}
          onCommit={(v) => p.onCommitRename(node.id, v)}
          onCancel={() => p.onCancelRename(node.id)}
        />
      ) : (
        <span className="ub-sh-lyr-label" title={isSlot ? undefined : `${p.label} — ${def?.label ?? node.type}`}>
          {p.label}
        </span>
      )}
      {!isSlot && !p.renaming && (
        <span className="ub-sh-lyr-badges">
          {node.condition && (
            <span className="ub-sh-lyr-badge" title={`Shown only when: ${node.condition}`}>
              <GitBranch size={11} aria-label="Has condition" />
            </span>
          )}
          {node.repeat && (
            <span className="ub-sh-lyr-badge" title={`Repeats for each item of: ${node.repeat.items}`}>
              <Repeat size={11} aria-label="Repeats" />
            </span>
          )}
          {eventNames.length > 0 && (
            <span className="ub-sh-lyr-badge ub-sh-lyr-badge--events" title={`Handles ${eventNames.join(', ')}`}>
              <Zap size={11} aria-label="Events" />
              {eventNames.length}
            </span>
          )}
          {node.binding && (
            <span className="ub-sh-lyr-badge" title={`Bound to state “${node.binding.state}”`}>
              <Link2 size={11} aria-label="Bound to state" />
            </span>
          )}
        </span>
      )}
      {!isSlot && !p.renaming && (
        <span className="ub-sh-lyr-actions">
          <button
            type="button"
            tabIndex={-1}
            className={cx('ub-sh-lyr-act', node.hiddenInDesigner && 'ub-sh-lyr-act--on')}
            aria-label={node.hiddenInDesigner ? 'Show in designer' : 'Hide in designer'}
            title={node.hiddenInDesigner ? 'Show in designer' : 'Hide in designer'}
            aria-pressed={!!node.hiddenInDesigner}
            onClick={(e) => {
              e.stopPropagation();
              p.onToggleHidden(node.id);
            }}
          >
            {node.hiddenInDesigner ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          <button
            type="button"
            tabIndex={-1}
            className={cx('ub-sh-lyr-act', node.locked && 'ub-sh-lyr-act--on')}
            aria-label={node.locked ? 'Unlock' : 'Lock'}
            title={node.locked ? 'Unlock (allow moving and deleting)' : 'Lock (prevent moving and deleting)'}
            aria-pressed={!!node.locked}
            onClick={(e) => {
              e.stopPropagation();
              p.onToggleLocked(node.id);
            }}
          >
            {node.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        </span>
      )}
      {p.drop && p.drop.position !== 'inside' && (
        <span
          className={cx(
            'ub-sh-lyr-dropline',
            p.drop.position === 'before' ? 'ub-sh-lyr-dropline--before' : 'ub-sh-lyr-dropline--after',
            !p.drop.ok && 'ub-sh-lyr-dropline--reject',
          )}
          style={{ left: dropLeft }}
          aria-hidden
        />
      )}
      {p.drop && !p.drop.ok && p.drop.reason && <span className="ub-sh-lyr-reject">{p.drop.reason}</span>}
    </div>
  );
});

function RenameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, []);
  return (
    <div
      ref={ref}
      className="ub-sh-lyr-rename"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          done.current = true;
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
    >
      <TextInput
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        aria-label="Layer name"
        onBlur={() => {
          if (!done.current) {
            done.current = true;
            onCommit(value);
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save as block
// ---------------------------------------------------------------------------

function SaveBlockDialog({
  ext,
  nodeId,
  onClose,
  onSaved,
}: {
  ext: Extension;
  nodeId: NodeId | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const node = nodeId ? ext.nodes[nodeId] : undefined;
  const [name, setName] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (node) {
      setName(node.name ?? `${typeLabel(node.type)} block`);
      requestAnimationFrame(() => formRef.current?.querySelector('input')?.select());
    }
    // Only when the dialog opens for a node.
  }, [nodeId]);
  if (!node || !nodeId) return null;
  const vars = stateVarsUsedBy(ext, nodeId);
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveUserBlock(trimmed, toTemplate(ext, nodeId), vars.length ? vars : undefined);
    onSaved(trimmed);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Save as block"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!name.trim()}>
            Save block
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        className="ub-sh-block-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Block name" hint="Saved blocks appear under Templates → My blocks and can be dropped into any card.">
          <TextInput value={name} onChange={setName} autoFocus aria-label="Block name" />
        </Field>
        <div className="ub-sh-block-summary">
          Includes <strong>{nodeLabel(node, typeLabel(node.type))}</strong> and everything inside it
          {vars.length > 0 && (
            <>
              , plus the state {vars.length === 1 ? 'variable' : 'variables'}{' '}
              {vars.map((v, i) => (
                <span key={v.name}>
                  {i > 0 && ', '}
                  <code>{v.name}</code>
                </span>
              ))}
            </>
          )}
          .
        </div>
      </form>
    </Dialog>
  );
}
