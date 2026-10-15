/**
 * Ready-made overlays the inspector's Overlay section can attach to a trigger in one click
 * ("Add confirmation"), built from the drop-in block library so both stay alike.
 */
import type { ActionStep, NodeTemplate, PropValue } from '../model/types';
import { BLOCK_TEMPLATES } from '../templates/blockTemplates';

const CONFIRM_BLOCK_ID = 'confirm-button';
const DELETE_RE = /\b(delete|remove|erase|discard)\b/i;

function confirmBlockModal(): NodeTemplate | null {
  const block = BLOCK_TEMPLATES.find((b) => b.id === CONFIRM_BLOCK_ID);
  const modal = block?.template.slots?.overlay?.[0];
  return modal ? (JSON.parse(JSON.stringify(modal)) as NodeTemplate) : null;
}

/** Plain, short trigger text usable in a title ("Delete record"), or '' for dynamic / long text. */
function plainLabel(text: string | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t || t.includes('{{') || t.length > 48) return '';
  return t.replace(/[.?!…:]+$/, '');
}

/**
 * Confirmation modal for a trigger button: titled after the button ("Delete record?"), with a
 * confirm button labelled like the trigger and a Cancel button, both closing the modal (add the
 * real work to the confirm button's On click). Destructive triggers get the danger styling. The
 * modal's `id` is made unique by `insertNode`.
 */
export function confirmModalTemplate(triggerText: string | undefined, destructive: boolean): NodeTemplate | null {
  const block = confirmBlockModal();
  if (!block) return null;
  const label = plainLabel(triggerText);
  const deleting = DELETE_RE.test(label);
  // Name the modal after the action ("confirm-archive-deal"); closeOverlay refs follow.
  const blockId = typeof block.props?.id === 'string' ? block.props.id : '';
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const id = slug ? `confirm-${slug}` : 'confirm';
  const modal = blockId
    ? (JSON.parse(JSON.stringify(block).split(JSON.stringify(`@${blockId}`)).join(JSON.stringify(`@${id}`))) as NodeTemplate)
    : block;
  const props: Record<string, PropValue> = { ...(modal.props ?? {}), id };
  props.title = label ? `${label}?` : 'Are you sure?';
  if (destructive) props.variant = 'danger';
  else delete props.variant;
  modal.props = props;

  const [body, footer] = modal.children ?? [];
  if (body?.children?.[0]) {
    body.children[0] = { ...body.children[0], text: deleting ? 'This can’t be undone.' : 'Do you want to continue?' };
  }
  const confirm = footer?.children?.[0];
  if (confirm) {
    confirm.text = label || 'Confirm';
    confirm.props = { ...(confirm.props ?? {}), variant: destructive ? 'destructive' : 'primary' };
    // Only close the modal: the block's sample "Record deleted" alert would report work that
    // hasn't been added yet.
    const close = (confirm.events?.onClick ?? []).filter((s: ActionStep) => s.type === 'closeOverlay');
    confirm.events = { ...(confirm.events ?? {}), onClick: close };
  }
  return modal;
}
