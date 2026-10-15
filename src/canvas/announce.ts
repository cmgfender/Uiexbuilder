/**
 * Screen-reader announcements for the design canvas. Keyboard users move the selection and edit
 * the document on the focused stage (arrow keys, Alt+arrows, Delete, Ctrl+D…); these messages are
 * written to a polite live region so each change is spoken (WCAG 4.1.3). Pure: no DOM, no store.
 */
import { buildParentIndex } from '../model/tree';
import { ROOT_TYPE, type Extension, type NodeId, type UINode } from '../model/types';
import { captionedLabel, componentLabel } from './labels';

/** Help text linked to the stage with aria-describedby (mirrors src/shell/shortcuts.ts). */
export const CANVAS_KEYBOARD_HELP =
  'Use the arrow keys to move the selection: Up and Down between siblings, Left to the parent, Right into the first child. ' +
  'Alt+Up and Alt+Down reorder the selected component, Enter edits its text, Delete removes it, ' +
  'Shift+F10 or the Menu key opens its actions, and Escape selects the parent.';

/** `name (Button)` for named layers, else `Button “Trigger”`. */
export function spokenLabel(node: UINode): string {
  return node.name ? `${node.name} (${componentLabel(node.type)})` : captionedLabel(node);
}

function containerName(ext: Extension): string {
  return ext.kind === 'card' ? 'the card' : 'the page';
}

function placeOf(ext: Extension, id: NodeId): { parentId: NodeId; slot?: string; index: number; count: number } | null {
  const ref = buildParentIndex(ext).get(id);
  if (!ref) return null;
  const parent = ext.nodes[ref.parentId];
  const list = ref.slot ? (parent?.slots?.[ref.slot] ?? []) : (parent?.children ?? []);
  return { parentId: ref.parentId, slot: ref.slot, index: ref.index, count: list.length };
}

function whereIs(ext: Extension, place: { parentId: NodeId; slot?: string }): string {
  const parent = ext.nodes[place.parentId];
  if (!parent || parent.type === ROOT_TYPE) return containerName(ext);
  if (place.slot === 'overlay') return `the overlay of ${spokenLabel(parent)}`;
  return spokenLabel(parent);
}

/** "Heading “Hello”, 2 of 3 in Flex, contains 2 components" */
export function describeNode(ext: Extension, id: NodeId): string {
  const node = ext.nodes[id];
  if (!node) return '';
  const parts = [spokenLabel(node)];
  const place = placeOf(ext, id);
  if (place) parts.push(`${place.index + 1} of ${place.count} in ${whereIs(ext, place)}`);
  const kids = node.children.length;
  if (kids > 0) parts.push(`contains ${kids} component${kids === 1 ? '' : 's'}`);
  if (node.locked) parts.push('locked');
  if (node.hiddenInDesigner) parts.push('hidden in the designer');
  return parts.join(', ');
}

export interface CanvasSnapshot {
  ext: Extension;
  selectedId: NodeId | null;
}

/**
 * What changed between two editor states, as one sentence, or null when nothing worth speaking
 * changed (prop edits, another extension, the same selection).
 */
export function describeCanvasChange(prev: CanvasSnapshot, next: CanvasSnapshot): string | null {
  if (prev.ext.id !== next.ext.id) return null;
  const { ext } = next;
  const sel = next.selectedId && ext.nodes[next.selectedId] ? next.selectedId : null;
  const prevNode = prev.selectedId ? prev.ext.nodes[prev.selectedId] : undefined;

  // The previously selected component is gone: deleted (or cut).
  if (prevNode && !ext.nodes[prevNode.id]) {
    return `Deleted ${spokenLabel(prevNode)}. ${sel ? `Selected ${describeNode(ext, sel)}.` : 'Nothing selected.'}`;
  }
  if (sel && !prev.ext.nodes[sel]) {
    const node = ext.nodes[sel];
    const place = placeOf(ext, sel);
    const before = prevNode ? placeOf(prev.ext, prevNode.id) : null;
    const duplicated =
      !!prevNode && !!place && !!before && prevNode.type === node.type && before.parentId === place.parentId && place.index === before.index + 1;
    return `${duplicated ? 'Duplicated' : 'Added'} ${describeNode(ext, sel)}.`;
  }
  if (sel && sel === prev.selectedId) {
    if (prev.ext.nodes === ext.nodes) return null;
    const before = placeOf(prev.ext, sel);
    const after = placeOf(ext, sel);
    if (!before || !after) return null;
    if (before.parentId === after.parentId && before.slot === after.slot && before.index === after.index) return null;
    return `Moved ${spokenLabel(ext.nodes[sel])} to position ${after.index + 1} of ${after.count} in ${whereIs(ext, after)}.`;
  }
  if (sel === (prev.selectedId && prev.ext.nodes[prev.selectedId] ? prev.selectedId : null)) return null;
  return sel ? `Selected ${describeNode(ext, sel)}.` : `Nothing selected — ${containerName(ext)}.`;
}
