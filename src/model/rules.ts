/**
 * Structural placement rules derived from the component registry.
 * Used by drag & drop, paste, the palette (disabled items) and validation.
 */
import { getComponent } from '../registry';
import type { ComponentDef } from '../registry/types';
import { isAncestor } from './tree';
import type { Extension, ExtensionLocation, NodeId } from './types';
import { ROOT_TYPE } from './types';

/** The hubspot.extend location an extension renders in. */
export function extensionLocation(ext: Extension): ExtensionLocation {
  if (ext.kind === 'settings') return 'settings';
  if (ext.kind === 'home') return 'home';
  return ext.location;
}

/** Whether a component may be used at all in this extension (location / kind restrictions). */
export function isAvailableIn(def: ComponentDef, ext: Extension): boolean {
  if (def.kinds && !def.kinds.includes(ext.kind)) return false;
  if (def.locations && !def.locations.includes(extensionLocation(ext))) return false;
  return true;
}

export interface AcceptResult {
  ok: boolean;
  reason?: string;
}

/**
 * Can a node of `childType` be placed in `parentId` (children list, or `slot` when given)?
 * Pass `movingId` when moving an existing node so cycles are rejected.
 */
export function canAccept(
  ext: Extension,
  parentId: NodeId,
  childType: string,
  slot?: string,
  movingId?: NodeId,
): AcceptResult {
  const parent = ext.nodes[parentId];
  if (!parent) return { ok: false, reason: 'Unknown parent' };
  const childDef = getComponent(childType);
  if (!childDef) return { ok: false, reason: `Unknown component ${childType}` };
  if (movingId && (movingId === parentId || isAncestor(ext, movingId, parentId))) {
    return { ok: false, reason: 'Cannot move a component inside itself' };
  }
  if (!isAvailableIn(childDef, ext)) {
    return { ok: false, reason: `${childDef.label} is not available in this extension location` };
  }

  if (slot) {
    if (parent.type === ROOT_TYPE) return { ok: false, reason: 'Root has no slots' };
    const parentDef = getComponent(parent.type);
    const slotDef = parentDef?.slots?.find((s) => s.name === slot);
    if (!slotDef) return { ok: false, reason: `${parent.type} has no ${slot} slot` };
    if (!slotDef.accepts.includes(childType)) {
      return { ok: false, reason: `${slotDef.label} accepts ${slotDef.accepts.join(' or ')}` };
    }
    const current = (parent.slots?.[slot] ?? []).filter((id) => id !== movingId);
    if (slotDef.max !== undefined && current.length >= slotDef.max) {
      return { ok: false, reason: `${slotDef.label} already has content` };
    }
    return { ok: true };
  }

  // Overlay components (Modal/Panel/Tooltip) only live in an `overlay` slot.
  if (childDef.overlay || childDef.slotOnly) {
    return { ok: false, reason: `${childDef.label} must be attached to a button, link or image as its overlay` };
  }

  if (parent.type === ROOT_TYPE) {
    if (childDef.parents && childDef.parents.length > 0) {
      return { ok: false, reason: `${childDef.label} must be placed inside ${childDef.parents.join(' or ')}` };
    }
    return { ok: true };
  }

  const parentDef = getComponent(parent.type);
  if (!parentDef) return { ok: false, reason: `Unknown component ${parent.type}` };
  if (parentDef.children.mode !== 'nodes') {
    return { ok: false, reason: `${parentDef.label} cannot contain components` };
  }
  if (parentDef.children.accepts && !parentDef.children.accepts.includes(childType)) {
    return { ok: false, reason: `${parentDef.label} only accepts ${parentDef.children.accepts.join(', ')}` };
  }
  if (childDef.parents && childDef.parents.length > 0 && !childDef.parents.includes(parent.type)) {
    return { ok: false, reason: `${childDef.label} must be placed inside ${childDef.parents.join(' or ')}` };
  }
  return { ok: true };
}

/** True when the node type is a container that can hold child components. */
export function isContainerType(type: string): boolean {
  if (type === ROOT_TYPE) return true;
  return getComponent(type)?.children.mode === 'nodes';
}
