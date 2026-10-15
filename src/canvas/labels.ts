/**
 * Human-readable component captions for canvas messages (storyboard titles, drop rejections,
 * screen-reader announcements). Pure: depends on the registry only.
 */
import { getComponent } from '../registry';
import type { UINode } from '../model/types';

export function componentLabel(type: string): string {
  return getComponent(type)?.label ?? type;
}

/** ` “text”` (truncated) or '' when the text is blank. */
export function quoteCaption(text: string | undefined, max = 32): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return ` “${t.length > max ? `${t.slice(0, max)}…` : t}”`;
}

/** What identifies an overlay (Modal / Panel title, Tooltip text, else its id). */
export function overlayCaption(node: UINode): string {
  const title = node.props.title;
  if (typeof title === 'string' && title.trim()) return title;
  if (node.text?.trim()) return node.text;
  const id = node.props.id;
  return typeof id === 'string' ? id : '';
}

/** What the designer sees on a component (its text / label), else its layer name. */
export function triggerCaption(node: UINode): string {
  if (node.text?.trim()) return node.text;
  for (const key of ['label', 'alt', 'title']) {
    const v = node.props[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return node.name ?? '';
}

/** `Button “Trigger”`, `Modal “Edit details”`, `Flex`. */
export function captionedLabel(node: UINode): string {
  const def = getComponent(node.type);
  const caption = def?.overlay || def?.slotOnly ? overlayCaption(node) : triggerCaption(node);
  return `${componentLabel(node.type)}${quoteCaption(caption)}`;
}
