/**
 * Overlay layer drawn above the stage: hover outline, selection outline with label chip and quick
 * toolbar, condition / empty-repeat flags, repeat-copy outlines and drag & drop indicators.
 *
 * It never re-renders the node tree: element rects are read imperatively and recomputed (rAF
 * throttled) on scroll, resize, zoom and DOM mutations of the surface.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CopyPlus,
  CornerLeftUp,
  EyeOff,
  GitBranch,
  GripVertical,
  Link2,
  Lock,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { getComponent } from '../registry';
import { endDrag, startDrag, useDragStore } from '../dnd/dragState';
import { IconButton, cx } from '../ui';
import { findNodeElement, findNodeElements } from './domHit';
import { componentLabel, deleteNode, displayLabel, duplicateNode, moveSibling, nodeCapabilities, selectParent } from './nodeActions';
import { useCanvasView } from './stores';

export const CANVAS_INDICATOR_SOURCE = 'canvas';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Flag {
  box: Box;
  kind: 'cond' | 'empty';
}

interface Measured {
  hover: Box | null;
  select: Box | null;
  clones: Box[];
  moving: Box | null;
  flags: Flag[];
  clipRight: number;
  clipBottom: number;
}

const EMPTY: Measured = { hover: null, select: null, clones: [], moving: null, flags: [], clipRight: 0, clipBottom: 0 };
const MAX_CLONES = 50;
const MAX_FLAGS = 120;

const requestFrame = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

function sameMeasured(a: Measured, b: Measured): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface SelectionInfo {
  id: string;
  label: string;
  name: string;
  type: string;
  condition: boolean;
  repeat: boolean;
  binding: boolean;
  events: boolean;
  locked: boolean;
  hasParentNode: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDuplicate: boolean;
}

const selectionCache = new WeakMap<object, { id: string; key: string }>();

function selectionKey(s: EditorState): string {
  const id = s.selectedNodeId;
  if (!id || s.mode !== 'design') return '';
  const ext = selectActiveExtension(s);
  const cached = selectionCache.get(ext.nodes);
  if (cached && cached.id === id) return cached.key;
  const caps = nodeCapabilities(ext, id);
  if (!caps) return '';
  const { node } = caps;
  const info: SelectionInfo = {
    id,
    label: componentLabel(node.type),
    name: node.name ?? '',
    type: node.type,
    condition: !!node.condition?.trim(),
    repeat: !!node.repeat,
    binding: !!node.binding,
    events: !!node.events && Object.values(node.events).some((steps) => steps.length > 0),
    locked: caps.locked,
    hasParentNode: caps.hasParentNode,
    canMoveUp: caps.canMoveUp,
    canMoveDown: caps.canMoveDown,
    canDuplicate: caps.canDuplicate,
  };
  const key = JSON.stringify(info);
  selectionCache.set(ext.nodes, { id, key });
  return key;
}

function hoverLabel(s: EditorState): string {
  const id = s.hoveredNodeId;
  if (!id || s.mode !== 'design' || id === s.selectedNodeId) return '';
  const node = selectActiveExtension(s).nodes[id];
  return node ? componentLabel(node.type) : '';
}

const px = (b: Box) => ({ left: b.left, top: b.top, width: b.width, height: b.height });

interface OverlayLayerProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
}

export const OverlayLayer = memo(function OverlayLayer({ viewportRef, stageRef, surfaceRef }: OverlayLayerProps) {
  const mode = useEditor((s) => s.mode);
  const hoveredId = useEditor((s) => s.hoveredNodeId);
  const selectedId = useEditor((s) => s.selectedNodeId);
  const hoverText = useEditor(hoverLabel);
  const selKey = useEditor(selectionKey);
  const indicator = useDragStore((s) => (s.indicator && s.indicator.source === CANVAS_INDICATOR_SOURCE ? s.indicator : null));
  const movingId = useDragStore((s) => (s.payload?.kind === 'move' ? s.payload.nodeId : null));
  const [m, setM] = useState<Measured>(EMPTY);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const surface = surfaceRef.current;
    if (!vp || !surface) return;
    const st = useEditor.getState();
    const base = vp.getBoundingClientRect();
    const toBox = (el: Element): Box | null => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return null;
      return {
        left: Math.round((r.left - base.left) * 10) / 10,
        top: Math.round((r.top - base.top) * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      };
    };
    const stage = stageRef.current;
    const next: Measured = {
      ...EMPTY,
      clones: [],
      flags: [],
      clipRight: stage ? Math.max(0, stage.offsetWidth - stage.clientWidth) : 0,
      clipBottom: stage ? Math.max(0, stage.offsetHeight - stage.clientHeight) : 0,
    };
    if (st.mode === 'design') {
      const sel = st.selectedNodeId;
      if (sel) {
        const els = findNodeElements(surface, sel);
        if (els[0]) next.select = toBox(els[0]);
        for (const el of els.slice(1, MAX_CLONES + 1)) {
          const b = toBox(el);
          if (b) next.clones.push(b);
        }
      }
      const hov = st.hoveredNodeId;
      if (hov && hov !== sel) {
        const el = findNodeElement(surface, hov);
        if (el) next.hover = toBox(el);
      }
      const payload = useDragStore.getState().payload;
      if (payload?.kind === 'move') {
        const el = findNodeElement(surface, payload.nodeId);
        if (el) next.moving = toBox(el);
      }
      const flagged = surface.querySelectorAll('[data-uiex-cond="false"], [data-uiex-repeat-empty]');
      for (const el of Array.from(flagged).slice(0, MAX_FLAGS)) {
        const b = toBox(el);
        if (b) next.flags.push({ box: b, kind: el.getAttribute('data-uiex-cond') === 'false' ? 'cond' : 'empty' });
      }
    }
    setM((prev) => (sameMeasured(prev, next) ? prev : next));
  }, [viewportRef, stageRef, surfaceRef]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  // Synchronous re-measure when what we outline changes (no one-frame lag).
  useLayoutEffect(() => {
    measure();
  }, [measure, mode, hoveredId, selectedId, selKey, movingId]);

  useEffect(() => {
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    stage?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
    if (mo && surface) mo.observe(surface, { subtree: true, childList: true, attributes: true, characterData: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (ro) {
      if (stage) ro.observe(stage);
      if (surface) ro.observe(surface);
    }
    const unsubView = useCanvasView.subscribe(schedule);
    const unsubDoc = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.activeExtensionId !== prev.activeExtensionId) schedule();
    });
    return () => {
      stage?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mo?.disconnect();
      ro?.disconnect();
      unsubView();
      unsubDoc();
      if (frame.current !== null) cancelFrame(frame.current);
      frame.current = null;
    };
  }, [schedule, stageRef, surfaceRef]);

  if (mode !== 'design') return null;
  const sel: SelectionInfo | null = selKey ? (JSON.parse(selKey) as SelectionInfo) : null;
  const base = viewportRef.current?.getBoundingClientRect();
  const vpWidth = viewportRef.current?.clientWidth ?? 0;

  return (
    <div className="ub-cv-overlay" style={{ right: m.clipRight, bottom: m.clipBottom }}>
      {m.flags.map((f, i) => (
        <div key={`f${i}`} className={cx('ub-cv-flag', `ub-cv-flag--${f.kind}`)} style={px(f.box)}>
          <span className="ub-cv-flag__tag">
            {f.kind === 'cond' ? <EyeOff size={11} aria-hidden /> : <Repeat size={11} aria-hidden />}
            {f.kind === 'cond' ? 'Hidden by condition' : 'Repeats over empty list'}
          </span>
        </div>
      ))}
      {m.clones.map((b, i) => (
        <div key={`c${i}`} className="ub-cv-clone-outline" style={px(b)} />
      ))}
      {m.hover && (
        <div className="ub-cv-hover" style={px(m.hover)}>
          {hoverText && <span className={cx('ub-cv-hover__label', m.hover.top < 18 && 'ub-cv-hover__label--inside')}>{hoverText}</span>}
        </div>
      )}
      {m.moving && <div className="ub-cv-moving" style={px(m.moving)} />}
      {m.select && sel && <SelectionChrome box={m.select} info={sel} viewportWidth={vpWidth} />}
      {indicator && base && <DropIndicatorView indicator={indicator} base={base} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Selection chrome: outline, label chip with badges, quick toolbar
// ---------------------------------------------------------------------------

const TOOLBAR_W = 168;
const TOOLBAR_H = 28;
const CHIP_H = 20;

function SelectionChrome({ box, info, viewportWidth }: { box: Box; info: SelectionInfo; viewportWidth: number }) {
  const Icon = getComponent(info.type)?.icon;
  const chipRef = useRef<HTMLDivElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState({ chip: 96, quick: TOOLBAR_W });
  useLayoutEffect(() => {
    const chip = chipRef.current?.offsetWidth || 0;
    const quick = quickRef.current?.offsetWidth || 0;
    setSizes((prev) =>
      (chip === 0 || chip === prev.chip) && (quick === 0 || quick === prev.quick)
        ? prev
        : { chip: chip || prev.chip, quick: quick || prev.quick },
    );
  });
  const chipInside = box.top < CHIP_H + 4;
  // Toolbar: above the outline, right-aligned but never over the label chip; below when there is
  // no room above.
  const above = !chipInside && box.top >= TOOLBAR_H + 6;
  const maxLeft = Math.max(4, (viewportWidth || Infinity) - sizes.quick - 4);
  const toolbarLeft = above
    ? Math.min(Math.max(box.left + box.width - sizes.quick, box.left + sizes.chip + 6), maxLeft)
    : Math.min(Math.max(4, box.left + box.width - sizes.quick), maxLeft);
  const toolbarTop = above ? box.top - TOOLBAR_H - 2 : box.top + box.height + 6;
  const nodeId = info.id;
  return (
    <>
      <div className={cx('ub-cv-select', info.locked && 'ub-cv-select--locked')} style={px(box)} />
      <div
        ref={chipRef}
        className={cx('ub-cv-chip', chipInside && 'ub-cv-chip--inside')}
        style={{ left: box.left, top: chipInside ? box.top + 2 : box.top - CHIP_H - 2 }}
        data-testid="canvas-selection-chip"
      >
        {Icon && <Icon size={11} aria-hidden />}
        <span className="ub-cv-chip__label">{info.name || info.label}</span>
        {info.name && <span className="ub-cv-chip__type">{info.label}</span>}
        {info.condition && (
          <span className="ub-cv-chip__badge" title="Shown only when its condition is true">
            <GitBranch size={10} aria-label="Condition" />
          </span>
        )}
        {info.repeat && (
          <span className="ub-cv-chip__badge" title="Repeats for each item of a list">
            <Repeat size={10} aria-label="Repeat" />
          </span>
        )}
        {info.binding && (
          <span className="ub-cv-chip__badge" title="Value bound to a state variable">
            <Link2 size={10} aria-label="Binding" />
          </span>
        )}
        {info.events && (
          <span className="ub-cv-chip__badge" title="Has event actions">
            <Zap size={10} aria-label="Events" />
          </span>
        )}
        {info.locked && (
          <span className="ub-cv-chip__badge" title="Locked: can't be moved or deleted">
            <Lock size={10} aria-label="Locked" />
          </span>
        )}
      </div>
      <div
        ref={quickRef}
        className="ub-cv-quick"
        style={{ left: toolbarLeft, top: toolbarTop }}
        role="toolbar"
        aria-label={`${info.label} actions`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <IconButton size="sm" label="Select parent" disabled={!info.hasParentNode} onClick={() => selectParent(nodeId)}>
          <CornerLeftUp size={13} />
        </IconButton>
        <IconButton size="sm" label="Move up" disabled={!info.canMoveUp} onClick={() => moveSibling(nodeId, -1)}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton size="sm" label="Move down" disabled={!info.canMoveDown} onClick={() => moveSibling(nodeId, 1)}>
          <ArrowDown size={13} />
        </IconButton>
        <IconButton size="sm" label="Duplicate" disabled={!info.canDuplicate} onClick={() => duplicateNode(nodeId)}>
          <CopyPlus size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label={info.locked ? 'Delete (locked)' : 'Delete'}
          disabled={info.locked}
          className="ub-cv-quick__danger"
          onClick={() => deleteNode(nodeId)}
        >
          <Trash2 size={13} />
        </IconButton>
        <span className="ub-cv-quick__sep" aria-hidden />
        <div
          role="button"
          tabIndex={-1}
          aria-label={info.locked ? 'Locked — cannot be dragged' : 'Drag to move'}
          aria-disabled={info.locked || undefined}
          title={info.locked ? 'Locked — unlock it to move' : 'Drag to move'}
          className={cx('ub-cv-quick__grip', info.locked && 'ub-cv-quick__grip--disabled')}
          draggable={!info.locked}
          onDragStart={(e) => {
            if (info.locked) {
              e.preventDefault();
              return;
            }
            const ext = selectActiveExtension(useEditor.getState());
            const node = ext.nodes[nodeId];
            startDrag(e, { kind: 'move', nodeId }, node ? displayLabel(node) : info.label);
          }}
          onDragEnd={() => endDrag()}
        >
          <GripVertical size={14} aria-hidden />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Drop indicator
// ---------------------------------------------------------------------------

function DropIndicatorView({
  indicator,
  base,
}: {
  indicator: NonNullable<ReturnType<typeof useDragStore.getState>['indicator']>;
  base: DOMRect;
}) {
  const r = indicator.rect;
  const box = { left: r.left - base.left, top: r.top - base.top, width: r.width, height: r.height };
  if (indicator.rejectReason) {
    return (
      <div className="ub-cv-drop-reject" style={box} data-testid="canvas-drop-reject">
        <span className={cx('ub-cv-drop-tip', 'ub-cv-drop-tip--reject', box.top < 26 && 'ub-cv-drop-tip--inside')} role="status">
          <Ban size={12} aria-hidden />
          {indicator.rejectReason}
        </span>
      </div>
    );
  }
  if (indicator.mode === 'line') {
    return (
      <div
        className={cx('ub-cv-drop-line', indicator.orientation === 'vertical' ? 'ub-cv-drop-line--v' : 'ub-cv-drop-line--h')}
        style={box}
        data-testid="canvas-drop-line"
      />
    );
  }
  return (
    <div className={cx('ub-cv-drop-inside', indicator.target.slot && 'ub-cv-drop-inside--slot')} style={box} data-testid="canvas-drop-inside">
      {indicator.label && (
        <span className={cx('ub-cv-drop-tip', box.top < 26 && 'ub-cv-drop-tip--inside')} role="status">
          {indicator.label}
        </span>
      )}
    </div>
  );
}
