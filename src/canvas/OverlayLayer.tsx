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
import { NODE_SELECTOR, OBSTACLE_ATTR, childNodeElements, findNodeElement, findNodeElements, nodeIdOf } from './domHit';
import { TOOLBAR_H, boxesIntersect, placeSelectionChrome, type ChromePlacement } from './chromePlacement';
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
  /** The hovered element contains or is inside the selected one. */
  hoverRelated: boolean;
  select: Box | null;
  /** Content around the selection that its chrome should not cover. */
  obstacles: Box[];
  clones: Box[];
  /** Direct children of the selected container (dashed, so what is inside is obvious). */
  kids: Box[];
  /** The other components of a multi-selection (Shift/Cmd/Ctrl-click), besides the primary one. */
  multi: Box[];
  moving: Box | null;
  flags: Flag[];
  clipRight: number;
  clipBottom: number;
  /** Visible size of the overlay layer. */
  width: number;
  height: number;
}

const EMPTY: Measured = {
  hover: null,
  hoverRelated: false,
  select: null,
  obstacles: [],
  clones: [],
  kids: [],
  multi: [],
  moving: null,
  flags: [],
  clipRight: 0,
  clipBottom: 0,
  width: 0,
  height: 0,
};
const MAX_CLONES = 50;
const MAX_KIDS = 60;
const MAX_FLAGS = 120;
const MAX_OBSTACLES = 200;
const OBSTACLE_SELECTOR = `${NODE_SELECTOR}, [${OBSTACLE_ATTR}]`;

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
  /** Components directly inside (containers). */
  childCount: number;
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
    childCount: node.children.length,
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

/** Matches any descendant that is not inline text formatting (makes an element "not plain text"). */
const NOT_INLINE_TEXT = ['span', 'strong', 'em', 'b', 'i', 'u', 's', 'small', 'code', 'mark', 'sub', 'sup', 'br', 'abbr']
  .map((tag) => `:not(${tag})`)
  .join('');

function isTransparent(color: string): boolean {
  return !color || color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color.replace(/\s+/g, ''));
}

/**
 * The line boxes of an element that is plain text (only text and inline formatting, no own
 * background or border), else null. A Text or Heading block is as wide as its container while its
 * words may take a fraction of it; covering the empty part hides nothing.
 */
function textLineRects(el: Element): DOMRect[] | null {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (!view || typeof doc.createRange !== 'function') return null;
  if (el.querySelector(NOT_INLINE_TEXT)) return null;
  const cs = view.getComputedStyle(el);
  if (!isTransparent(cs.backgroundColor) || (cs.backgroundImage !== 'none' && cs.backgroundImage !== '')) return null;
  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (parseFloat(cs.getPropertyValue(`border-${side}-width`)) > 0) return null;
  }
  const range = doc.createRange();
  range.selectNodeContents(el);
  const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
  return rects.length > 0 ? rects : null;
}

interface OverlayLayerProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
}

export const OverlayLayer = memo(function OverlayLayer({ viewportRef, stageRef, surfaceRef }: OverlayLayerProps) {
  const mode = useEditor((s) => s.mode);
  const hoveredId = useEditor((s) => s.hoveredNodeId);
  const selectedId = useEditor((s) => s.selectedNodeId);
  const multiIds = useEditor((s) => s.selectedNodeIds);
  const hoverText = useEditor(hoverLabel);
  const selKey = useEditor(selectionKey);
  const indicator = useDragStore((s) => (s.indicator && s.indicator.source === CANVAS_INDICATOR_SOURCE ? s.indicator : null));
  const movingId = useDragStore((s) => (s.payload?.kind === 'move' ? s.payload.nodeId : null));
  const dragKind = useDragStore((s) => s.payload?.kind ?? null);
  const [m, setM] = useState<Measured>(EMPTY);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    const surface = surfaceRef.current;
    if (!vp || !surface) return;
    const st = useEditor.getState();
    const base = vp.getBoundingClientRect();
    const rectBox = (r: { left: number; top: number; width: number; height: number }): Box | null => {
      if (r.width <= 0 && r.height <= 0) return null;
      return {
        left: Math.round((r.left - base.left) * 10) / 10,
        top: Math.round((r.top - base.top) * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
      };
    };
    const toBox = (el: Element): Box | null => rectBox(el.getBoundingClientRect());
    const stage = stageRef.current;
    const clipRight = stage ? Math.max(0, stage.offsetWidth - stage.clientWidth) : 0;
    const clipBottom = stage ? Math.max(0, stage.offsetHeight - stage.clientHeight) : 0;
    const next: Measured = {
      ...EMPTY,
      obstacles: [],
      clones: [],
      kids: [],
      multi: [],
      flags: [],
      clipRight,
      clipBottom,
      width: Math.max(0, vp.clientWidth - clipRight),
      height: Math.max(0, vp.clientHeight - clipBottom),
    };
    if (st.mode === 'design') {
      const sel = st.selectedNodeId;
      let selEl: HTMLElement | null = null;
      if (sel) {
        const els = findNodeElements(surface, sel);
        selEl = els[0] ?? null;
        if (selEl) next.select = toBox(selEl);
        for (const el of els.slice(1, MAX_CLONES + 1)) {
          const b = toBox(el);
          if (b) next.clones.push(b);
        }
      }
      for (const id of st.selectedNodeIds) {
        if (id === sel) continue;
        const el = findNodeElement(surface, id);
        const b = el ? toBox(el) : null;
        if (b) next.multi.push(b);
      }
      if (selEl && !st.selectedNodeIds.length) {
        // What is inside the selected container: one dashed box per child (repeat copies once).
        const seen = new Set<string>();
        for (const el of childNodeElements(selEl)) {
          const id = nodeIdOf(el);
          if (seen.has(id) || el.hasAttribute('data-uiex-clone')) continue;
          seen.add(id);
          const b = toBox(el);
          if (b) next.kids.push(b);
          if (next.kids.length >= MAX_KIDS) break;
        }
      }
      const box = next.select;
      if (selEl && box) {
        // Only content in the band the chrome can occupy (above / below the outline) matters.
        const top = box.top - TOOLBAR_H - 4;
        const bottom = box.top + box.height + TOOLBAR_H + 4;
        for (const el of Array.from(surface.querySelectorAll(OBSTACLE_SELECTOR))) {
          if (el === selEl || el.contains(selEl) || selEl.contains(el)) continue;
          const b = toBox(el);
          if (!b || b.top > bottom || b.top + b.height < top) continue;
          // Plain text only occupies its lines, not its whole (often full-width) block.
          const lines = textLineRects(el);
          if (lines) {
            for (const r of lines) {
              const lb = rectBox(r);
              if (lb) next.obstacles.push(lb);
            }
          } else {
            next.obstacles.push(b);
          }
          if (next.obstacles.length >= MAX_OBSTACLES) break;
        }
      }
      const hov = st.hoveredNodeId;
      if (hov && hov !== sel) {
        const el = findNodeElement(surface, hov);
        if (el) {
          next.hover = toBox(el);
          next.hoverRelated = !!selEl && (el.contains(selEl) || selEl.contains(el));
        }
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
  }, [measure, mode, hoveredId, selectedId, multiIds, selKey, movingId]);

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
  const dragging = !!dragKind;

  return (
    <div className="ub-cv-overlay" style={{ right: m.clipRight, bottom: m.clipBottom }}>
      {m.flags.map((f, i) => (
        <div key={`f${i}`} className={cx('ub-cv-flag', `ub-cv-flag--${f.kind}`)} style={px(f.box)}>
          <span className="ub-cv-flag__tag">
            {f.kind === 'cond' ? <EyeOff size={11} aria-hidden /> : <Repeat size={11} aria-hidden />}
            {f.kind === 'cond' ? 'Hidden right now' : 'Repeats over empty list'}
          </span>
        </div>
      ))}
      {m.clones.map((b, i) => (
        <div key={`c${i}`} className="ub-cv-clone-outline" style={px(b)} />
      ))}
      {!dragging &&
        m.kids.map((b, i) => <div key={`k${i}`} className="ub-cv-child-outline" style={px(b)} data-testid="canvas-child-outline" />)}
      {m.multi.map((b, i) => (
        <div key={`m${i}`} className="ub-cv-select is-multi" style={px(b)} data-testid="canvas-multi-outline" />
      ))}
      {m.hover && (
        <div className="ub-cv-hover" style={px(m.hover)}>
          {hoverText && <span className={cx('ub-cv-hover__label', m.hover.top < 18 && 'ub-cv-hover__label--inside')}>{hoverText}</span>}
        </div>
      )}
      {m.moving && <div className="ub-cv-moving" style={px(m.moving)} />}
      {m.select && sel && (
        <SelectionChrome
          box={m.select}
          info={sel}
          viewport={{ width: m.width, height: m.height }}
          obstacles={m.obstacles}
          peek={m.hover && !m.hoverRelated ? m.hover : null}
          dragging={dragging}
          focusStage={() => stageRef.current?.focus({ preventScroll: true })}
        />
      )}
      {indicator && base && <DropIndicatorView indicator={indicator} base={base} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Selection chrome: outline, label chip with badges, quick toolbar
// ---------------------------------------------------------------------------

const TOOLBAR_W = 168;
/** How long the pointer rests on covered content before the chrome fades out of its way. */
const PEEK_DELAY = 250;

interface SelectionChromeProps {
  box: Box;
  info: SelectionInfo;
  viewport: { width: number; height: number };
  obstacles: Box[];
  /** Hovered component (not the selection or one of its ancestors / descendants). */
  peek: Box | null;
  /** A drag is in progress: the chrome must not intercept drops on the content below it. */
  dragging: boolean;
  /** Puts keyboard focus back on the canvas stage. */
  focusStage: () => void;
}

function SelectionChrome({ box, info, viewport, obstacles, peek, dragging, focusStage }: SelectionChromeProps) {
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
  // Outside the outline, on the side that hides the least of the surrounding content.
  const placement: ChromePlacement = placeSelectionChrome({
    box,
    chipWidth: sizes.chip,
    toolbarWidth: sizes.quick,
    viewport,
    obstacles,
  });
  const { chip, toolbar } = placement;

  // Resting the pointer on content the chrome covers fades the chrome and lets clicks through,
  // so the content can be seen and selected; entering the toolbar first keeps it usable.
  const covering = !!peek && (boxesIntersect(peek, chip) || boxesIntersect(peek, toolbar));
  const [peeking, setPeeking] = useState(false);
  const inToolbar = useRef(false);
  /** Bumped when the pointer leaves the toolbar: re-arms the fade for content still hovered. */
  const [leftToolbar, setLeftToolbar] = useState(0);
  useEffect(() => {
    if (!covering) {
      setPeeking(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      if (!inToolbar.current) setPeeking(true);
    }, PEEK_DELAY);
    return () => clearTimeout(timer);
  }, [covering, leftToolbar]);
  const faded = (peeking && covering) || dragging;
  const nodeId = info.id;
  /**
   * After a toolbar action, focus must not drop to <body>: a move button that became disabled
   * (the end of the list) hands focus to the other one; a deleted / replaced selection, to the stage.
   */
  const keepFocus = (from: 'up' | 'down' | 'other') => {
    requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const lost = !active || active === document.body || !active.isConnected || (active as HTMLButtonElement).disabled === true;
      if (!lost) return;
      const other = from === 'other' ? null : quickRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${from === 'up' ? 'Move down' : 'Move up'}"]`);
      if (other && !other.disabled) other.focus();
      else focusStage();
    });
  };
  return (
    <>
      <div className={cx('ub-cv-select', info.locked && 'ub-cv-select--locked')} style={px(box)} />
      <div
        ref={chipRef}
        className={cx(
          'ub-cv-chip',
          chip.side === 'inside' && 'ub-cv-chip--inside',
          chip.side === 'below' && 'ub-cv-chip--below',
          faded && 'ub-cv-chrome--peek',
        )}
        style={{ left: chip.left, top: chip.top }}
        data-testid="canvas-selection-chip"
        data-side={chip.side}
      >
        {Icon && <Icon size={11} aria-hidden />}
        <span className="ub-cv-chip__label">{info.name || info.label}</span>
        {info.name && <span className="ub-cv-chip__type">{info.label}</span>}
        {info.childCount > 0 && (
          <span className="ub-cv-chip__type" title="Click a component inside to change it">
            · {info.childCount} inside
          </span>
        )}
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
        className={cx('ub-cv-quick', faded && 'ub-cv-chrome--peek')}
        style={{ left: toolbar.left, top: toolbar.top }}
        role="toolbar"
        aria-label={`${info.label} actions`}
        data-side={toolbar.side}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerEnter={() => {
          inToolbar.current = true;
        }}
        onPointerLeave={() => {
          inToolbar.current = false;
          setLeftToolbar((n) => n + 1);
        }}
      >
        <IconButton size="sm" label="Select parent" disabled={!info.hasParentNode} onClick={() => selectParent(nodeId)}>
          <CornerLeftUp size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label="Move up"
          disabled={!info.canMoveUp}
          onClick={() => {
            moveSibling(nodeId, -1);
            keepFocus('up');
          }}
        >
          <ArrowUp size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label="Move down"
          disabled={!info.canMoveDown}
          onClick={() => {
            moveSibling(nodeId, 1);
            keepFocus('down');
          }}
        >
          <ArrowDown size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label="Duplicate"
          disabled={!info.canDuplicate}
          onClick={() => {
            duplicateNode(nodeId);
            keepFocus('other');
          }}
        >
          <CopyPlus size={13} />
        </IconButton>
        <IconButton
          size="sm"
          label={info.locked ? 'Delete (locked)' : 'Delete'}
          disabled={info.locked}
          className="ub-cv-quick__danger"
          onClick={() => {
            deleteNode(nodeId);
            keepFocus('other');
          }}
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
