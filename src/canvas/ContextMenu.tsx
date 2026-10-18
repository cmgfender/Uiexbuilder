/**
 * Canvas context menu (right-click on a component or on the empty canvas) and the "Save as block"
 * name prompt. Items act through store actions; unavailable actions are disabled, not hidden, so
 * the menu stays predictable.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ClipboardPaste,
  Code2,
  Copy,
  CopyPlus,
  CornerLeftUp,
  Database,
  LayoutTemplate,
  PencilLine,
  Scissors,
  Shapes,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { canPasteSettings } from '../model/settings';
import { selectActiveExtension, useEditor } from '../model/store';
import { pasteAt, removeNodesSafe } from '../shell/actions';
import { shortcutLabel } from '../shell/shortcuts';
import { toTemplate } from '../model/tree';
import { getComponent } from '../registry';
import { saveUserBlock } from '../templates';
import { Button, Dialog, Field, Menu, TextInput, useToast, type MenuItem } from '../ui';
import { beginInlineEdit } from './InlineTextEditor';
import {
  WRAPPER_TYPES,
  addOverlay,
  addableOverlays,
  canWrap,
  componentLabel,
  deleteNode,
  displayLabel,
  duplicateNode,
  moveSibling,
  nodeCapabilities,
  selectParent,
  shortcut,
  usedStateVars,
} from './nodeActions';
import { useCanvasUi } from './stores';

const ICON = 14;
const INPUT_ID = 'ub-cv-block-name';

function icon(node: ReactNode) {
  return <span className="ub-cv-menu-icon">{node}</span>;
}

function TypeIcon({ type }: { type: string }) {
  const Icon = getComponent(type)?.icon;
  return Icon ? <Icon size={ICON} aria-hidden /> : null;
}

/** Menu items for a component. Exported for tests and other surfaces (e.g. layers tree). */
export function nodeMenuItems(nodeId: string, surface: HTMLElement | null, notify?: (message: string) => void): MenuItem[] {
  const st = useEditor.getState();
  const ext = selectActiveExtension(st);
  const caps = nodeCapabilities(ext, nodeId);
  if (!caps) return [];
  const { locked } = caps;
  // Right-clicking one of several selected components acts on all of them where that makes sense.
  const multi = st.selectedNodeIds.length > 1 && st.selectedNodeIds.includes(nodeId) ? st.selectedNodeIds : null;
  const clip = st.settingsClipboard;
  const pasteTargets = (multi ?? [nodeId]).filter((id) => canPasteSettings(clip, ext.nodes[id]));
  const items: MenuItem[] = [];
  if (caps.isText) {
    items.push({
      label: 'Edit text',
      icon: icon(<PencilLine size={ICON} aria-hidden />),
      shortcut: 'Enter',
      onSelect: () => beginInlineEdit(nodeId, surface),
    });
    items.push({ label: '', separator: true });
  }
  items.push(
    {
      label: 'Duplicate',
      icon: icon(<CopyPlus size={ICON} aria-hidden />),
      shortcut: shortcut('D'),
      disabled: !caps.canDuplicate,
      onSelect: () => duplicateNode(nodeId),
    },
    { label: 'Copy', icon: icon(<Copy size={ICON} aria-hidden />), shortcut: shortcut('C'), onSelect: () => st.copyNode(nodeId) },
    {
      label: 'Cut',
      icon: icon(<Scissors size={ICON} aria-hidden />),
      shortcut: shortcut('X'),
      disabled: locked,
      onSelect: () => useEditor.getState().cutNode(nodeId),
    },
    {
      label: 'Paste',
      icon: icon(<ClipboardPaste size={ICON} aria-hidden />),
      shortcut: shortcut('V'),
      disabled: !st.clipboard,
      // Explains a refused paste (wrong place, component not available in this location).
      onSelect: () => pasteAt(nodeId, notify),
    },
    multi
      ? {
          label: `Delete ${multi.length} selected`,
          icon: icon(<Trash2 size={ICON} aria-hidden />),
          shortcut: 'Del',
          danger: true,
          onSelect: () => removeNodesSafe(multi, notify),
        }
      : {
          label: locked ? 'Delete (locked)' : 'Delete',
          icon: icon(<Trash2 size={ICON} aria-hidden />),
          shortcut: 'Del',
          danger: true,
          disabled: locked,
          onSelect: () => deleteNode(nodeId),
        },
    { label: '', separator: true },
    {
      label: 'Copy settings',
      icon: icon(<SlidersHorizontal size={ICON} aria-hidden />),
      shortcut: shortcutLabel('copySettings'),
      onSelect: () => {
        const c = useEditor.getState().copySettings(nodeId);
        if (c) notify?.(`Copied the settings of ${c.label}`);
      },
    },
    {
      label: multi ? `Paste settings onto ${multi.length} selected` : 'Paste settings',
      icon: icon(<ClipboardPaste size={ICON} aria-hidden />),
      shortcut: shortcutLabel('pasteSettings'),
      disabled: !pasteTargets.length,
      onSelect: () => {
        const n = useEditor.getState().pasteSettings(pasteTargets);
        notify?.(n ? `Pasted the settings of ${clip!.label} onto ${n} component${n === 1 ? '' : 's'}` : 'They already have these settings');
      },
    },
    { label: '', separator: true },
  );
  for (const wrapper of WRAPPER_TYPES) {
    items.push({
      label: `Wrap in ${componentLabel(wrapper)}`,
      icon: icon(<TypeIcon type={wrapper} />),
      disabled: !canWrap(ext, nodeId, wrapper),
      onSelect: () => useEditor.getState().wrapNode(nodeId, wrapper),
    });
  }
  items.push(
    { label: '', separator: true },
    {
      label: 'Select parent',
      icon: icon(<CornerLeftUp size={ICON} aria-hidden />),
      disabled: !caps.hasParentNode,
      onSelect: () => selectParent(nodeId),
    },
    { label: 'Move up', icon: icon(<ArrowUp size={ICON} aria-hidden />), disabled: !caps.canMoveUp, onSelect: () => moveSibling(nodeId, -1) },
    { label: 'Move down', icon: icon(<ArrowDown size={ICON} aria-hidden />), disabled: !caps.canMoveDown, onSelect: () => moveSibling(nodeId, 1) },
  );
  const overlays = addableOverlays(ext, nodeId);
  if (overlays.length > 0) {
    items.push({ label: '', separator: true });
    for (const type of overlays) {
      items.push({
        label: `Add ${componentLabel(type)}`,
        icon: icon(<TypeIcon type={type} />),
        onSelect: () => addOverlay(nodeId, type),
      });
    }
  }
  items.push(
    { label: '', separator: true },
    {
      label: 'Save as block…',
      icon: icon(<BookmarkPlus size={ICON} aria-hidden />),
      onSelect: () => useCanvasUi.getState().setSaveBlockFor(nodeId),
    },
    {
      label: 'View code',
      icon: icon(<Code2 size={ICON} aria-hidden />),
      onSelect: () => {
        useEditor.getState().select(nodeId);
        useEditor.getState().setBottomPanel('code');
      },
    },
  );
  return items;
}

/** Menu items for the empty canvas / card background. */
export function canvasMenuItems(notify?: (message: string) => void): MenuItem[] {
  const st = useEditor.getState();
  return [
    {
      label: 'Paste',
      icon: icon(<ClipboardPaste size={ICON} aria-hidden />),
      shortcut: shortcut('V'),
      disabled: !st.clipboard,
      onSelect: () => pasteAt(null, notify),
    },
    { label: '', separator: true },
    { label: 'Browse components', icon: icon(<Shapes size={ICON} aria-hidden />), onSelect: () => st.setLeftPanel('components') },
    { label: 'Start from a template', icon: icon(<LayoutTemplate size={ICON} aria-hidden />), onSelect: () => st.setLeftPanel('templates') },
    { label: 'Add data', icon: icon(<Database size={ICON} aria-hidden />), onSelect: () => st.setLeftPanel('data') },
    { label: '', separator: true },
    {
      label: 'View code',
      icon: icon(<Code2 size={ICON} aria-hidden />),
      onSelect: () => useEditor.getState().setBottomPanel('code'),
    },
  ];
}

const MENU_ITEM_SELECTOR = '.ub-menu [role="menuitem"]:not(:disabled)';

export function CanvasContextMenu({
  surfaceRef,
  returnFocus,
}: {
  surfaceRef: { current: HTMLElement | null };
  /** Called after a keyboard-opened menu closes (puts focus back on the stage). */
  returnFocus?: () => void;
}) {
  const menu = useCanvasUi((s) => s.menu);
  const toast = useToast();
  // Stable: the Menu re-registers its outside-click / Escape listeners when onClose changes.
  const close = useCallback(() => {
    const fromKeyboard = !!useCanvasUi.getState().menu?.keyboard;
    useCanvasUi.getState().closeMenu();
    if (fromKeyboard) returnFocus?.();
  }, [returnFocus]);
  const keyboard = !!menu?.keyboard;
  useEffect(() => {
    if (!keyboard) return;
    // Keyboard users land on the first available action (the menu is portalled to <body>).
    const items = document.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR);
    items[0]?.focus();
  }, [keyboard, menu]);
  if (!menu) return null;
  const items = menu.nodeId ? nodeMenuItems(menu.nodeId, surfaceRef.current, toast) : canvasMenuItems(toast);
  if (items.length === 0) return null;
  return <Menu x={menu.x} y={menu.y} items={items} onClose={close} />;
}

export function SaveBlockDialog() {
  const nodeId = useCanvasUi((s) => s.saveBlockFor);
  const setFor = useCanvasUi((s) => s.setSaveBlockFor);
  const toast = useToast();
  const [name, setName] = useState('');
  const defaultName = useEditor((s) => {
    if (!nodeId) return '';
    const node = selectActiveExtension(s).nodes[nodeId];
    return node ? displayLabel(node) : '';
  });
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (nodeId !== openedFor) {
    // The prompt (re)opened: start from the node's label.
    setOpenedFor(nodeId);
    if (nodeId) setName(defaultName);
  }
  useEffect(() => {
    if (!nodeId) return;
    // Runs after the Dialog focused itself: put the caret in the name field.
    const input = document.getElementById(INPUT_ID) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, [nodeId]);

  // Stable: the Dialog re-runs its focus effect whenever onClose changes.
  const close = useCallback(() => setFor(null), [setFor]);
  const save = () => {
    const trimmed = name.trim();
    if (!nodeId || !trimmed) return;
    const ext = selectActiveExtension(useEditor.getState());
    if (!ext.nodes[nodeId]) {
      close();
      return;
    }
    const state = usedStateVars(ext, nodeId);
    saveUserBlock(trimmed, toTemplate(ext, nodeId), state.length > 0 ? state : undefined);
    toast(`Saved “${trimmed}” to My blocks`);
    close();
  };

  return (
    <Dialog
      open={!!nodeId}
      onClose={close}
      title="Save as block"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            Save block
          </Button>
        </>
      }
    >
      <form
        className="ub-cv-save-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Block name"
          htmlFor={INPUT_ID}
          hint="Saved blocks appear in the Templates panel under My blocks, ready to drag onto any card. State variables the block uses are saved with it."
        >
          <TextInput id={INPUT_ID} value={name} onChange={setName} placeholder="e.g. Contact header" />
        </Field>
      </form>
    </Dialog>
  );
}
