/**
 * Overlay storyboard (design mode, below the card): every Modal / Panel / Tooltip attached to a
 * trigger is drawn inline in its own frame, so its content can be selected, edited and dropped into
 * like the card itself (the canvas delegation layer covers the storyboard too).
 */
import { memo, useMemo } from 'react';
import { Layers, MousePointerClick } from 'lucide-react';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { walk } from '../model/tree';
import { NodeRenderer } from '../runtime';
import { getComponent } from '../registry';
import type { Extension } from '../model/types';
import { CHROME_ATTR, OBSTACLE_ATTR, STORYBOARD_ATTR } from './domHit';
import { componentLabel, overlayCaption, quoteCaption, triggerCaption } from './labels';

export interface StoryItem {
  overlayId: string;
  overlayType: string;
  triggerId: string;
  title: string;
  /** Tooltip-like overlays are shown on hover; Modals / Panels open on click. */
  hover: boolean;
  hidden: boolean;
}

/** Storyboard entries in document order (nested overlays included). */
export function storyItems(ext: Extension): StoryItem[] {
  const items: StoryItem[] = [];
  walk(ext, (node) => {
    const overlayId = node.slots?.overlay?.[0];
    const overlay = overlayId ? ext.nodes[overlayId] : undefined;
    if (!overlayId || !overlay) return;
    const def = getComponent(overlay.type);
    const hover = !!def?.slotOnly && !def.overlay;
    const what = `${componentLabel(overlay.type)}${quoteCaption(overlayCaption(overlay))}`;
    const by = `${componentLabel(node.type)}${quoteCaption(triggerCaption(node))}`;
    items.push({
      overlayId,
      overlayType: overlay.type,
      triggerId: node.id,
      title: `${what} · ${hover ? 'shown on hover of' : 'opened by'} ${by}`,
      hover,
      hidden: !!overlay.hiddenInDesigner,
    });
  });
  return items;
}

const keyCache = new WeakMap<object, string>();

function storyKey(s: EditorState): string {
  const ext = selectActiveExtension(s);
  const cached = keyCache.get(ext.nodes);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(storyItems(ext));
  keyCache.set(ext.nodes, key);
  return key;
}

const StoryFrame = memo(function StoryFrame({ item }: { item: StoryItem }) {
  const Icon = getComponent(item.overlayType)?.icon ?? Layers;
  return (
    <div className={`ub-cv-sb-frame${item.hover ? ' ub-cv-sb-frame--tooltip' : ''}`} data-overlay-id={item.overlayId}>
      <button
        type="button"
        className="ub-cv-sb-frame__title"
        title="Select the component that opens this overlay"
        {...{ [CHROME_ATTR]: '', [OBSTACLE_ATTR]: '' }}
        onClick={(e) => {
          e.stopPropagation();
          useEditor.getState().select(item.triggerId);
        }}
        onMouseEnter={() => useEditor.getState().hover(item.triggerId)}
        onMouseLeave={() => useEditor.getState().hover(null)}
      >
        <Icon size={13} aria-hidden />
        <span className="ub-cv-sb-frame__text">{item.title}</span>
        <MousePointerClick size={12} className="ub-cv-sb-frame__go" aria-hidden />
      </button>
      <div className="hsp-root hsp-design ub-cv-sb-frame__body" {...{ [STORYBOARD_ATTR]: item.overlayId }}>
        {item.hidden ? (
          <div className="ub-cv-sb-frame__hidden">Hidden in the designer — show it again from the layers panel.</div>
        ) : (
          <NodeRenderer nodeId={item.overlayId} overlayPresentation="inline" />
        )}
      </div>
    </div>
  );
});

export const Storyboard = memo(function Storyboard() {
  const key = useEditor(storyKey);
  const items = useMemo(() => JSON.parse(key) as StoryItem[], [key]);
  if (items.length === 0) return null;
  return (
    <section className="ub-cv-sb" aria-label="Overlay storyboard">
      <header className="ub-cv-sb__head">
        <Layers size={14} aria-hidden />
        <span className="ub-cv-sb__title">Overlays</span>
        <span className="ub-cv-sb__hint">Modals, panels and tooltips open from their trigger. Edit them here; click a title to select the trigger.</span>
      </header>
      <div className="ub-cv-sb__list">
        {items.map((item) => (
          <StoryFrame key={item.overlayId} item={item} />
        ))}
      </div>
    </section>
  );
});
