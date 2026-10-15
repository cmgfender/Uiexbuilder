/**
 * Inline text editing for text-mode components (Text, Heading, Button, Link, Tag, ...): a textarea
 * placed over the element inside the zoom surface (so it scales with the canvas), matching the
 * element's box and typography. Enter commits (Shift+Enter inserts a newline), Escape cancels and
 * blur commits. The raw text is edited, so `{{ expressions }}` stay intact.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { selectActiveExtension, useEditor } from '../model/store';
import { CHROME_ATTR, findNodeElement } from './domHit';
import { displayLabel, isTextNode } from './nodeActions';
import { useCanvasUi, useCanvasView, type InlineEditState } from './stores';

const TYPO_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'color',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const;

function isTransparent(color: string): boolean {
  const c = color.replace(/\s+/g, '').toLowerCase();
  return !c || c === 'transparent' || c === 'rgba(0,0,0,0)' || /rgba\([^)]*,0\)$/.test(c);
}

/** Starts inline editing of a text-mode node. Returns false when it is not editable / not visible. */
export function beginInlineEdit(nodeId: string, surface: HTMLElement | null): boolean {
  if (!surface) return false;
  const ext = selectActiveExtension(useEditor.getState());
  const node = ext.nodes[nodeId];
  if (!node || !isTextNode(node)) return false;
  const el = findNodeElement(surface, nodeId);
  if (!el) return false;
  const zoom = useCanvasView.getState().zoom || 1;
  const r = el.getBoundingClientRect();
  const s = surface.getBoundingClientRect();
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  const style: Record<string, string> = {};
  if (cs) {
    for (const p of TYPO_PROPS) {
      const v = cs[p];
      if (v) style[p] = v;
    }
    style.backgroundColor = isTransparent(cs.backgroundColor) ? '' : cs.backgroundColor;
    style.borderRadius = cs.borderRadius;
  }
  const editing: InlineEditState = {
    nodeId,
    initial: node.text ?? '',
    box: {
      left: (r.left - s.left) / zoom,
      top: (r.top - s.top) / zoom,
      width: r.width / zoom,
      height: r.height / zoom,
    },
    style,
  };
  useEditor.getState().select(nodeId);
  useCanvasUi.getState().setEditing(editing);
  return true;
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

export function InlineTextEditor({ onDone }: { onDone?: () => void }) {
  const editing = useCanvasUi((s) => s.editing);
  if (!editing) return null;
  return <EditorField key={`${editing.nodeId}:${editing.box.left}:${editing.box.top}`} editing={editing} onDone={onDone} />;
}

function EditorField({ editing, onDone }: { editing: InlineEditState; onDone?: () => void }) {
  const [value, setValue] = useState(editing.initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  const exists = useEditor((s) => !!selectActiveExtension(s).nodes[editing.nodeId]);
  const label = useEditor((s) => {
    const node = selectActiveExtension(s).nodes[editing.nodeId];
    return node ? displayLabel(node) : '';
  });

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const text = ref.current?.value ?? value;
    if (commit && text !== editing.initial) useEditor.getState().setText(editing.nodeId, text);
    useCanvasUi.getState().setEditing(null);
    onDone?.();
  };

  // The node disappeared (undo, delete from another panel): drop the editor without committing.
  useEffect(() => {
    if (!exists && !finished.current) {
      finished.current = true;
      useCanvasUi.getState().setEditing(null);
    }
  }, [exists]);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.select();
  }, []);

  // Grow with the content.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(editing.box.height, ta.scrollHeight)}px`;
  }, [value, editing.box.height]);

  const { box, style } = editing;
  const css: CSSProperties = {
    ...(style as CSSProperties),
    left: box.left,
    top: box.top,
    width: Math.max(box.width, 48),
    minHeight: box.height,
    backgroundColor: style.backgroundColor || undefined,
  };

  return (
    <textarea
      ref={ref}
      className="ub-cv-inline-editor"
      style={css}
      value={value}
      rows={1}
      spellCheck
      aria-label={`Edit text of ${label}`}
      {...{ [CHROME_ATTR]: '' }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        }
      }}
      onBlur={() => finish(true)}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onPointerMove={stop}
      onPointerDown={stop}
      onMouseDown={stop}
    />
  );
}
