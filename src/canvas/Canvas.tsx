/**
 * The design surface: a scrollable stage with the card drawn inside a HubSpot-like location frame,
 * the overlay storyboard below it, and an overlay layer for hover / selection / drop indicators.
 *
 * Interaction is delegated: one set of pointer / mouse / drag handlers on the stage resolves the
 * node under the pointer through the runtime's DOM contract (`data-node-id`, ...), so no handler
 * is attached per node and hover / selection never re-render the node tree. The RuntimeProvider is
 * mounted above the canvas by the shell.
 */
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Database, LayoutTemplate, Shapes } from 'lucide-react';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { extensionLocation } from '../model/rules';
import { ROOT_TYPE, type Extension, type NodeId } from '../model/types';
import type { InsertTarget } from '../model/tree';
import { ExtensionRenderer, PreviewHost } from '../runtime';
import { UIEX_REVEAL_EVENT } from '../registry/components/layout';
import { endDrag, payloadType, readPayload, useDragStore, type DragPayload } from '../dnd/dragState';
import { Button, cx, useToast } from '../ui';
import { CanvasToolbar } from './Toolbar';
import { LocationFrame, type FrameInfo } from './LocationFrame';
import { OverlayLayer, CANVAS_INDICATOR_SOURCE } from './OverlayLayer';
import { Storyboard } from './Storyboard';
import { InlineTextEditor, beginInlineEdit } from './InlineTextEditor';
import { CanvasContextMenu, SaveBlockDialog } from './ContextMenu';
import { computeDropTarget, createDropModel, type DropModel, type DropResult } from './dropTarget';
import {
  CARD_ROOT_ATTR,
  CHROME_ATTR,
  buildHitChain,
  closestNodeElement,
  deepestNodeAt,
  findNodeElement,
  isChromeTarget,
  nodeIdOf,
} from './domHit';
import { componentLabel, isNodeContainer, isTextNode } from './nodeActions';
import { CANVAS_KEYBOARD_HELP, describeCanvasChange, describeNode, type CanvasSnapshot } from './announce';
import { useCanvasUi, useCanvasView } from './stores';
import { renderStats } from './renderStats';
import { insertBlock } from '../templates/actions';
import './canvas.css';

const STAGE_PADDING = 32;
const HOME_MIN = 640;
const HOME_MAX = 1200;
/** Settings pages are responsive up to this width. */
const SETTINGS_MAX = 960;
/** Full record page frame: summary column (260) + tab padding (2 × 24) + card (720) + borders. */
const RECORD_FRAME_WIDTH = 260 + 48 + 720 + 2;

const requestFrame = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

// ---------------------------------------------------------------------------
// Frame info selector (primitives only, compared shallowly)
// ---------------------------------------------------------------------------

const OBJECT_LABEL: Record<string, string> = {
  contacts: 'contact',
  companies: 'company',
  deals: 'deal',
  tickets: 'ticket',
  '0-1': 'contact',
  '0-2': 'company',
  '0-3': 'deal',
  '0-5': 'ticket',
};

interface FrameSelection extends FrameInfo {
  empty: boolean;
  kind: Extension['kind'];
}

function frameSelector(s: EditorState): FrameSelection {
  const ext = selectActiveExtension(s);
  const p = ext.mock?.properties ?? {};
  const location = extensionLocation(ext);
  const objectType = ext.objectTypes?.[0] ?? 'contacts';
  const objectLabel = OBJECT_LABEL[objectType] ?? 'record';
  let recordName = '';
  let recordDetail = '';
  if (location === 'helpdesk.sidebar' || objectLabel === 'ticket') {
    recordName = p.subject || 'Support ticket';
    recordDetail = p.hs_ticket_priority ? `Priority: ${p.hs_ticket_priority.toLowerCase()}` : '';
  } else if (objectLabel === 'company') {
    recordName = p.name || 'Company';
    recordDetail = p.domain || '';
  } else if (objectLabel === 'deal') {
    recordName = p.dealname || 'Deal';
    recordDetail = p.amount ? `Amount: ${p.amount}` : '';
  } else {
    recordName = [p.firstname, p.lastname].filter(Boolean).join(' ') || p.name || 'Sample record';
    recordDetail = p.jobtitle || p.email || '';
  }
  return {
    location,
    extName: ext.name,
    appName: s.project.app.name,
    recordName,
    recordDetail,
    objectLabel,
    empty: (ext.nodes[ext.rootId]?.children.length ?? 0) === 0,
    kind: ext.kind,
  };
}

// ---------------------------------------------------------------------------
// Card body (memoised: never re-renders on hover / selection / zoom)
// ---------------------------------------------------------------------------

function EmptyCardHero({ kind }: { kind: Extension['kind'] }) {
  const setLeftPanel = useEditor((s) => s.setLeftPanel);
  const what = kind === 'settings' ? 'settings page' : kind === 'home' ? 'app home page' : 'card';
  return (
    <div className="ub-cv-empty" {...{ [CHROME_ATTR]: '' }}>
      <div className="ub-cv-empty__lead">
        Your {what} is empty. Drag a component onto it, or pick a starting point:
      </div>
      <div className="ub-cv-empty__actions">
        <Button icon={<Shapes size={14} aria-hidden />} onClick={() => setLeftPanel('components')}>
          Browse components
        </Button>
        <Button icon={<LayoutTemplate size={14} aria-hidden />} onClick={() => setLeftPanel('templates')}>
          Start from a template
        </Button>
        <Button icon={<Database size={14} aria-hidden />} onClick={() => setLeftPanel('data')}>
          Add data
        </Button>
      </div>
    </div>
  );
}

const CardBody = memo(function CardBody({ mode, empty, kind }: { mode: 'design' | 'preview'; empty: boolean; kind: Extension['kind'] }) {
  renderStats.cardBody += 1;
  const design = mode === 'design';
  return (
    <div className={cx('ub-cv-card-body', design && empty && 'ub-cv-card-body--empty')}>
      <div
        className={cx('hsp-root', design ? 'hsp-design' : 'hsp-live', 'ub-cv-card-root')}
        data-testid="card-root"
        {...{ [CARD_ROOT_ATTR]: '' }}
      >
        <ExtensionRenderer />
        <PreviewHost />
      </div>
      {design && empty && <EmptyCardHero kind={kind} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scrollIntoViewIfNeeded(stage: HTMLElement, el: Element) {
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.width <= 0 && r.height <= 0) return;
  const m = 24;
  let dy = 0;
  let dx = 0;
  if (r.top < s.top + m) dy = r.top - s.top - m;
  else if (r.bottom > s.bottom - m) dy = Math.min(r.top - s.top - m, r.bottom - s.bottom + m);
  if (r.left < s.left + m) dx = r.left - s.left - m;
  else if (r.right > s.right - m) dx = Math.min(r.left - s.left - m, r.right - s.right + m);
  if (dx === 0 && dy === 0) return;
  if (typeof stage.scrollBy === 'function') stage.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
  else {
    stage.scrollLeft += dx;
    stage.scrollTop += dy;
  }
}

function createAutoScroller(getStage: () => HTMLElement | null) {
  let vx = 0;
  let vy = 0;
  let raf: number | null = null;
  const tick = () => {
    raf = null;
    const stage = getStage();
    if (!stage || (vx === 0 && vy === 0)) return;
    stage.scrollLeft += vx;
    stage.scrollTop += vy;
    raf = requestFrame(tick);
  };
  return {
    update(x: number, y: number) {
      const stage = getStage();
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const zone = 48;
      const max = 18;
      const speed = (d: number) => (d < zone ? Math.ceil(max * (1 - Math.max(d, 0) / zone)) : 0);
      vy = speed(r.bottom - y) - speed(y - r.top);
      vx = speed(r.right - x) - speed(x - r.left);
      if ((vx !== 0 || vy !== 0) && raf === null) raf = requestFrame(tick);
    },
    stop() {
      vx = 0;
      vy = 0;
      if (raf !== null) cancelFrame(raf);
      raf = null;
    },
  };
}

/**
 * A context menu requested from the keyboard (Shift+F10 / the Menu key) targets the focused stage
 * itself and carries no pointer button (Chromium reports button -1); a right-click targets the
 * element under the pointer with button 2.
 */
export function isKeyboardContextMenu(e: { target: EventTarget | null; button: number; ctrlKey?: boolean }, stage: Element | null): boolean {
  // Ctrl+click (macOS secondary click) reports button 0: still a pointer.
  return !!stage && e.target === stage && e.button !== 2 && !e.ctrlKey;
}

/** Where a keyboard-opened menu appears: below the selected element's top-left corner, kept on the stage. */
function keyboardMenuPoint(stage: HTMLElement, el: Element | null): { x: number; y: number } {
  const s = stage.getBoundingClientRect();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const r = el?.getBoundingClientRect();
  if (!r || (r.width <= 0 && r.height <= 0)) return { x: s.left + 16, y: s.top + 16 };
  return { x: clamp(r.left + 4, s.left + 4, s.right - 16), y: clamp(r.bottom + 2, s.top + 8, s.bottom - 16) };
}

/** Applies a validated drop. Returns the inserted / moved node id. */
export function applyDrop(payload: DragPayload, target: InsertTarget): NodeId | null {
  const st = useEditor.getState();
  if (payload.kind === 'new') return st.insertNode(payload.componentType, target);
  if (payload.kind === 'template') {
    // One undo step for the block and any state variables it needs.
    const res = insertBlock(payload.template, payload.state, payload.label, target, payload.dataSources);
    return res.ok ? res.value : null;
  }
  const ok = st.moveNode(payload.nodeId, target);
  if (ok) useEditor.getState().select(payload.nodeId);
  return ok ? payload.nodeId : null;
}

const KIND_TARGET: Record<Extension['kind'], string> = { card: 'Add to card', settings: 'Add to page', home: 'Add to page' };

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export function Canvas() {
  const mode = useEditor((s) => s.mode);
  const frame = useEditor(useShallow(frameSelector));
  const chrome = useCanvasView((s) => s.chrome);
  const zoom = useCanvasView((s) => s.zoom);
  const collapsed = useCanvasView((s) => s.collapsed);
  const fitRequest = useCanvasView((s) => s.fitRequest);
  const toast = useToast();

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ---- responsive frames: pages follow the stage width; the record page drops its summary column
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setStageWidth(stage.clientWidth));
    ro.observe(stage);
    setStageWidth(stage.clientWidth);
    return () => ro.disconnect();
  }, []);
  const pageMax = frame.location === 'settings' ? SETTINGS_MAX : HOME_MAX;
  const homeWidth = stageWidth > 0 ? Math.round(Math.min(pageMax, Math.max(HOME_MIN, stageWidth / zoom - STAGE_PADDING * 2))) : pageMax;
  const compactFrame = frame.location === 'crm.record.tab' && stageWidth > 0 && stageWidth / zoom < RECORD_FRAME_WIDTH + STAGE_PADDING * 2;

  // ---- zoom: scale the surface, size the box to the scaled size (so the stage scrolls correctly)
  useLayoutEffect(() => {
    const box = boxRef.current;
    const surface = surfaceRef.current;
    if (!box || !surface) return undefined;
    const apply = () => {
      const z = useCanvasView.getState().zoom;
      if (z === 1) {
        box.style.width = '';
        box.style.height = '';
        return;
      }
      box.style.width = `${surface.offsetWidth * z}px`;
      box.style.height = `${surface.offsetHeight * z}px`;
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    ro?.observe(surface);
    return () => ro?.disconnect();
  }, [zoom]);

  // ---- automatic zoom: a card frame wider than the stage (e.g. the record tab in a small window)
  // starts zoomed out to fit instead of being clipped; pages follow the stage width themselves.
  const zoomAuto = useCanvasView((s) => s.auto);
  const responsiveFrame = frame.location === 'settings' || frame.location === 'home';
  useLayoutEffect(() => {
    if (!zoomAuto) return;
    const view = useCanvasView.getState();
    if (responsiveFrame) {
      view.setAutoZoom(1);
      return;
    }
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface || stageWidth <= 0 || surface.offsetWidth <= 0) return;
    const available = stage.clientWidth - STAGE_PADDING * 2;
    view.setAutoZoom(Math.min(1, Math.floor((available / surface.offsetWidth) * 20) / 20));
  }, [zoomAuto, responsiveFrame, stageWidth, frame.location, compactFrame, chrome, collapsed]);

  useEffect(() => {
    if (!fitRequest) return;
    const stage = stageRef.current;
    const surface = surfaceRef.current;
    if (!stage || !surface || surface.offsetWidth <= 0) return;
    const available = stage.clientWidth - STAGE_PADDING * 2;
    useCanvasView.getState().setZoom(Math.floor((available / surface.offsetWidth) * 20) / 20);
  }, [fitRequest]);

  // Ctrl / Cmd + wheel zooms the canvas (needs a non-passive native listener).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const view = useCanvasView.getState();
      view.setZoom(view.zoom * Math.exp(-e.deltaY * 0.002));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // ---- leaving design mode closes transient UI
  useEffect(() => {
    if (mode !== 'design') {
      useCanvasUi.getState().setEditing(null);
      useCanvasUi.getState().closeMenu();
    }
  }, [mode]);

  // ---- selection: reveal inside collapsed Tabs / Accordions, then scroll into view
  useEffect(() => {
    const reveal = (id: NodeId, attempt: number) => {
      requestFrame(() => {
        const st = useEditor.getState();
        if (st.selectedNodeId !== id || st.mode !== 'design') return;
        const el = findNodeElement(surfaceRef.current, id);
        if (!el) {
          if (attempt < 2) reveal(id, attempt + 1);
          return;
        }
        el.dispatchEvent(new CustomEvent(UIEX_REVEAL_EVENT, { bubbles: true }));
        requestFrame(() => {
          const target = findNodeElement(surfaceRef.current, id);
          if (target && stageRef.current) scrollIntoViewIfNeeded(stageRef.current, target);
        });
      });
    };
    return useEditor.subscribe((s, prev) => {
      if (s.selectedNodeId === prev.selectedNodeId && s.mode === prev.mode) return;
      if (s.activeExtensionId !== prev.activeExtensionId) useCanvasUi.getState().setEditing(null);
      const id = s.selectedNodeId;
      if (!id || s.mode !== 'design' || s.selectedNodeId === prev.selectedNodeId) return;
      if (useCanvasView.getState().collapsed) useCanvasView.getState().setCollapsed(false);
      reveal(id, 0);
    });
  }, []);

  // ---- screen-reader announcements for keyboard work on the focused stage
  const helpId = useId();
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => {
    // Alternate a trailing no-break space so repeating the same sentence is spoken again.
    setAnnouncement((prev) => (prev === message ? `${message}\u00a0` : message));
  }, []);
  useEffect(() => {
    // Store actions may update in several steps (duplicate = insert, then select): compare the
    // state before the first step with the state after the last one (end of the current task).
    let base: CanvasSnapshot | null = null;
    let alive = true;
    const flush = () => {
      const from = base;
      base = null;
      if (!alive || !from) return;
      const st = useEditor.getState();
      const stage = stageRef.current;
      if (st.mode !== 'design' || !stage || typeof document === 'undefined' || document.activeElement !== stage) return;
      const message = describeCanvasChange(from, { ext: selectActiveExtension(st), selectedId: st.selectedNodeId });
      if (message) announce(message);
    };
    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (s.mode !== 'design' || prev.mode !== 'design') return;
      if (s.selectedNodeId === prev.selectedNodeId && s.project === prev.project && s.activeExtensionId === prev.activeExtensionId) return;
      if (base) return;
      base = { ext: selectActiveExtension(prev), selectedId: prev.selectedNodeId };
      queueMicrotask(flush);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [announce]);
  const onStageFocus = useCallback(
    (e: ReactFocusEvent) => {
      if (modeRef.current !== 'design' || e.target !== stageRef.current) return;
      const st = useEditor.getState();
      const ext = selectActiveExtension(st);
      const id = st.selectedNodeId;
      if (id && ext.nodes[id]) announce(`Selected ${describeNode(ext, id)}.`);
    },
    [announce],
  );

  // ---- drag & drop
  const autoScroll = useMemo(() => createAutoScroller(() => stageRef.current), []);
  const modelCache = useRef<{ ext: Extension; key: string; model: DropModel } | null>(null);

  const clearCanvasIndicator = useCallback(() => {
    autoScroll.stop();
    const ind = useDragStore.getState().indicator;
    if (ind?.source === CANVAS_INDICATOR_SOURCE) useDragStore.getState().setIndicator(null);
  }, [autoScroll]);

  useEffect(() => {
    window.addEventListener('dragend', clearCanvasIndicator);
    window.addEventListener('drop', clearCanvasIndicator);
    return () => {
      window.removeEventListener('dragend', clearCanvasIndicator);
      window.removeEventListener('drop', clearCanvasIndicator);
      autoScroll.stop();
    };
  }, [clearCanvasIndicator, autoScroll]);

  const resolveDrop = useCallback((e: ReactDragEvent, payload: DragPayload): DropResult => {
    const surface = surfaceRef.current;
    if (!surface) return { ok: false, reason: '', rect: null };
    const ext = selectActiveExtension(useEditor.getState());
    if (payload.kind === 'move') {
      const node = ext.nodes[payload.nodeId];
      if (!node) return { ok: false, reason: '', rect: null };
      if (node.locked) {
        const el = findNodeElement(surface, payload.nodeId);
        const r = el?.getBoundingClientRect();
        return {
          ok: false,
          reason: 'Locked components can’t be moved — unlock it in the layers panel first',
          rect: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
        };
      }
    }
    const type = payloadType(payload, ext);
    if (!type) return { ok: false, reason: '', rect: null };
    const movingId = payload.kind === 'move' ? payload.nodeId : null;
    const key = `${type}|${movingId ?? ''}`;
    let model = modelCache.current?.ext === ext && modelCache.current.key === key ? modelCache.current.model : null;
    if (!model) {
      model = createDropModel(ext, type, movingId);
      modelCache.current = { ext, key, model };
    }
    const point = { x: e.clientX, y: e.clientY };
    const { chain, placeholder } = buildHitChain({ target: e.target, point, surface, rootId: ext.rootId });
    return computeDropTarget({ point, chain, placeholder }, model);
  }, []);

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (modeRef.current !== 'design') return;
      const payload = useDragStore.getState().payload;
      if (!payload) return;
      autoScroll.update(e.clientX, e.clientY);
      const st = useEditor.getState();
      if (st.hoveredNodeId) st.hover(null);
      const res = resolveDrop(e, payload);
      const drag = useDragStore.getState();
      if (res.ok) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = payload.kind === 'move' ? 'move' : 'copy';
        let label = res.label;
        if (!label && res.mode === 'inside') {
          const ext = selectActiveExtension(st);
          const parent = ext.nodes[res.target.parentId];
          label = !parent || parent.type === ROOT_TYPE ? KIND_TARGET[ext.kind] : `Into ${componentLabel(parent.type)}`;
        }
        drag.setIndicator({
          target: res.target,
          mode: res.mode,
          orientation: res.orientation,
          rect: res.rect,
          label,
          source: CANVAS_INDICATOR_SOURCE,
        });
      } else {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
        drag.setIndicator(
          res.reason && res.rect
            ? {
                target: { parentId: '', index: -1 },
                mode: 'inside',
                orientation: 'horizontal',
                rect: res.rect,
                rejectReason: res.reason,
                source: CANVAS_INDICATOR_SOURCE,
              }
            : null,
        );
      }
    },
    [autoScroll, resolveDrop],
  );

  const onDragLeave = useCallback(
    (e: ReactDragEvent) => {
      const stage = stageRef.current;
      const related = e.relatedTarget as Node | null;
      if (stage && related && stage.contains(related)) return;
      clearCanvasIndicator();
    },
    [clearCanvasIndicator],
  );

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      if (modeRef.current !== 'design') return;
      const payload = readPayload(e);
      if (!payload) return;
      e.preventDefault();
      e.stopPropagation();
      autoScroll.stop();
      const res = resolveDrop(e, payload);
      endDrag();
      if (!res.ok) {
        if (res.reason) toast(res.reason);
        return;
      }
      applyDrop(payload, res.target);
      stageRef.current?.focus({ preventScroll: true });
    },
    [autoScroll, resolveDrop, toast],
  );

  // ---- pointer / mouse delegation
  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (modeRef.current !== 'design' || useDragStore.getState().payload) return;
    if (isChromeTarget(e.target)) return;
    const el = closestNodeElement(e.target, surfaceRef.current);
    useEditor.getState().hover(el ? nodeIdOf(el) : null);
  }, []);

  const onPointerLeave = useCallback(() => {
    if (modeRef.current === 'design') useEditor.getState().hover(null);
  }, []);

  const onClick = useCallback((e: ReactMouseEvent) => {
    if (modeRef.current !== 'design' || isChromeTarget(e.target)) return;
    e.stopPropagation();
    const el = closestNodeElement(e.target, surfaceRef.current);
    useEditor.getState().select(el ? nodeIdOf(el) : null);
  }, []);

  const onDoubleClick = useCallback((e: ReactMouseEvent) => {
    if (modeRef.current !== 'design' || isChromeTarget(e.target)) return;
    const el = closestNodeElement(e.target, surfaceRef.current);
    if (!el) return;
    e.stopPropagation();
    const id = nodeIdOf(el);
    const node = selectActiveExtension(useEditor.getState()).nodes[id];
    if (isTextNode(node)) {
      beginInlineEdit(id, surfaceRef.current);
      return;
    }
    if (isNodeContainer(node)) {
      const deepest = deepestNodeAt(el, { x: e.clientX, y: e.clientY });
      if (deepest) useEditor.getState().select(nodeIdOf(deepest));
    }
  }, []);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    if (modeRef.current !== 'design' || isChromeTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const stage = stageRef.current;
    if (stage && isKeyboardContextMenu(e, stage)) {
      // Shift+F10 / Menu key: the menu of the current selection, at the selected element.
      const st = useEditor.getState();
      const ext = selectActiveExtension(st);
      const id = st.selectedNodeId && ext.nodes[st.selectedNodeId] && st.selectedNodeId !== ext.rootId ? st.selectedNodeId : null;
      const { x, y } = keyboardMenuPoint(stage, id ? findNodeElement(surfaceRef.current, id) : null);
      useCanvasUi.getState().openMenu({ x, y, nodeId: id, keyboard: true });
      return;
    }
    const el = closestNodeElement(e.target, surfaceRef.current);
    const id = el ? nodeIdOf(el) : null;
    useEditor.getState().select(id);
    useCanvasUi.getState().openMenu({ x: e.clientX, y: e.clientY, nodeId: id });
  }, []);

  const onKeyDown = useCallback((e: ReactKeyboardEvent) => {
    if (modeRef.current !== 'design' || e.target !== stageRef.current) return;
    if (e.key !== 'Enter' && e.key !== 'F2') return;
    const id = useEditor.getState().selectedNodeId;
    if (id && beginInlineEdit(id, surfaceRef.current)) e.preventDefault();
  }, []);

  const focusStage = useCallback(() => stageRef.current?.focus({ preventScroll: true }), []);
  const toggleCollapsed = useCallback(() => {
    const view = useCanvasView.getState();
    view.setCollapsed(!view.collapsed);
  }, []);

  const info: FrameInfo = useMemo(
    () => ({
      location: frame.location,
      extName: frame.extName,
      appName: frame.appName,
      recordName: frame.recordName,
      recordDetail: frame.recordDetail,
      objectLabel: frame.objectLabel,
    }),
    [frame.location, frame.extName, frame.appName, frame.recordName, frame.recordDetail, frame.objectLabel],
  );

  const design = mode === 'design';
  return (
    <div className={cx('ub-cv', design ? 'ub-cv--design' : 'ub-cv--preview')} data-testid="canvas">
      <CanvasToolbar />
      <div className="ub-cv-viewport" ref={viewportRef}>
        <div
          ref={stageRef}
          className="ub-cv-stage"
          tabIndex={0}
          role="region"
          aria-label={design ? 'Design canvas' : 'Card preview'}
          aria-roledescription={design ? 'design canvas' : undefined}
          aria-describedby={design ? helpId : undefined}
          onFocus={onStageFocus}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="ub-cv-stage-inner">
            <div ref={boxRef} className={cx('ub-cv-zoom-box', zoom !== 1 && 'ub-cv-zoom-box--scaled')}>
              <div
                ref={surfaceRef}
                className="ub-cv-surface"
                style={zoom !== 1 ? { transform: `scale(${zoom})` } : undefined}
                data-location={frame.location}
              >
                <LocationFrame
                  info={info}
                  chrome={chrome}
                  homeWidth={homeWidth}
                  compact={compactFrame}
                  collapsed={collapsed}
                  onToggleCollapsed={toggleCollapsed}
                >
                  <CardBody mode={mode} empty={frame.empty} kind={frame.kind} />
                </LocationFrame>
                {design && <Storyboard />}
                {design && <InlineTextEditor onDone={focusStage} />}
              </div>
            </div>
          </div>
        </div>
        <OverlayLayer viewportRef={viewportRef} stageRef={stageRef} surfaceRef={surfaceRef} />
      </div>
      <CanvasContextMenu surfaceRef={surfaceRef} returnFocus={focusStage} />
      <SaveBlockDialog />
      <div id={helpId} className="ub-cv-sr-only">
        {CANVAS_KEYBOARD_HELP}
      </div>
      <div className="ub-cv-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="canvas-announcer">
        {design ? announcement : ''}
      </div>
    </div>
  );
}
