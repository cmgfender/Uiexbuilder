/**
 * Layout components: Flex, Box, Inline, AutoGrid, Tile, Divider, Spacer, Accordion, Tabs, Tab.
 * See text.tsx for the reference conventions (exact @hubspot/ui-extensions prop names, inspector
 * metadata, previews that spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/components/
 *   layouts.synced.d.ts (Flex, Box, Inline, AutoGrid), tile, divider, spacer, accordion, tabs.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import {
  AlignHorizontalSpaceAround,
  Box as BoxIcon,
  ChevronRight,
  Columns3,
  LayoutGrid,
  ListCollapse,
  MoveVertical,
  PanelTop,
  PanelsTopLeft,
  RectangleHorizontal,
  SeparatorHorizontal,
} from 'lucide-react';
import type { ComponentDef, PropDef, PreviewProps } from '../types';
import {
  DISTANCE_OPTIONS,
  FLEX_ALIGN,
  FLEX_JUSTIFY,
  SIZE_ALL,
  SIZE_XS_MD,
  STANDARD_DOCS,
  enumOptions,
} from '../constants';
import { cx, normalizeSize, space, str } from '../../preview/util';
import '../../preview/styles/layout.css';

/**
 * Designer "reveal" event. The canvas may dispatch
 * `el.dispatchEvent(new CustomEvent(UIEX_REVEAL_EVENT, { bubbles: true }))` on a node's element
 * when it is selected (e.g. from the layers tree). Collapsible layout previews (Tabs, Accordion)
 * listen for it in design mode and switch to / expand the section that contains the element, so
 * the selection becomes visible and editable. Dispatching it is optional; nothing breaks without.
 */
export const UIEX_REVEAL_EVENT = 'uiex:reveal';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const JUSTIFY_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  around: 'space-around',
  between: 'space-between',
};
const ALIGN_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  baseline: 'baseline',
  end: 'flex-end',
  stretch: 'stretch',
  auto: 'auto',
};

/** Looks up a CSS keyword for a HubSpot enum value; unknown / non-string values get the fallback. */
function css(map: Record<string, string>, value: unknown, fallback?: string): string | undefined {
  return typeof value === 'string' && map[value] ? map[value] : fallback;
}

/**
 * Maps Box `flex` ('initial' | 'auto' | 'none' | number) to the CSS `flex` shorthand.
 * Mirrors the semantics documented in layouts.synced.d.ts (default 'auto').
 */
function flexCss(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return String(value);
  // Numbers bound through `{{ }}` templates may arrive as numeric strings.
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  if (value === 'initial') return '0 1 auto';
  if (value === 'none') return '0 0 auto';
  return '1 1 auto';
}

/** Coerces resolved prop values to a boolean the way JSX would (undefined/null -> fallback). */
function bool(value: unknown, fallback = false): boolean {
  return value === undefined || value === null ? fallback : Boolean(value);
}

const testIdProp: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

// ---------------------------------------------------------------------------
// Flex
// ---------------------------------------------------------------------------

function FlexPreview({ props, children, rootProps }: PreviewProps) {
  const direction = props.direction === 'column' ? 'column' : 'row';
  const wrap = props.wrap === true || props.wrap === 'wrap';
  return (
    <div
      {...rootProps}
      className={cx('hsp-flex', rootProps.className)}
      style={{
        display: 'flex',
        flexDirection: direction,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: space(props.gap),
        justifyContent: css(JUSTIFY_CSS, props.justify, 'flex-start'),
        alignItems: css(ALIGN_CSS, props.align, 'stretch'),
        alignSelf: css(ALIGN_CSS, props.alignSelf),
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Box
// ---------------------------------------------------------------------------

function BoxPreview({ props, children, rootProps }: PreviewProps) {
  return (
    <div
      {...rootProps}
      className={cx('hsp-box', rootProps.className)}
      style={{ alignSelf: css(ALIGN_CSS, props.alignSelf, 'auto'), flex: flexCss(props.flex) }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

function InlinePreview({ props, children, rootProps }: PreviewProps) {
  return (
    <div
      {...rootProps}
      // `hsp-inline` is already a Text modifier class (text.css), hence `hsp-inline-row`.
      className={cx('hsp-inline-row', rootProps.className)}
      style={{
        gap: space(props.gap),
        justifyContent: css(JUSTIFY_CSS, props.justify, 'flex-start'),
        alignItems: css(ALIGN_CSS, props.align, 'stretch'),
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutoGrid
// ---------------------------------------------------------------------------

const DEFAULT_COLUMN_WIDTH = 200;

function AutoGridPreview({ props, children, rootProps }: PreviewProps) {
  const raw = typeof props.columnWidth === 'string' ? Number(props.columnWidth) : props.columnWidth;
  const width = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COLUMN_WIDTH;
  // `min(.., 100%)` keeps a wide column inside narrow card locations (e.g. the sidebar).
  const track = `min(${width}px, 100%)`;
  const columns = bool(props.flexible) ? `repeat(auto-fill, minmax(${track}, 1fr))` : `repeat(auto-fill, ${track})`;
  return (
    <div
      {...rootProps}
      className={cx('hsp-autogrid', rootProps.className)}
      style={{ gridTemplateColumns: columns, gap: space(props.gap) }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

function TilePreview({ props, children, rootProps }: PreviewProps) {
  return (
    <div
      {...rootProps}
      className={cx(
        'hsp-tile',
        bool(props.compact) && 'hsp-tile--compact',
        bool(props.flush) && 'hsp-tile--flush',
        rootProps.className,
      )}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Divider & Spacer
// ---------------------------------------------------------------------------

function DividerPreview({ props, rootProps }: PreviewProps) {
  // `distance` is the deprecated alias of `size`; honour it for imported documents.
  const gap = space(props.size ?? props.distance, 'var(--hsp-space-sm)');
  return (
    <div
      {...rootProps}
      role="separator"
      className={cx('hsp-divider', rootProps.className)}
      // The spacing is padding (not margin) so the whole area is selectable in the designer.
      style={{ paddingTop: gap, paddingBottom: gap }}
    >
      <div className="hsp-divider-line" />
    </div>
  );
}

function SpacerPreview({ props, rootProps, mode }: PreviewProps) {
  return (
    <div
      {...rootProps}
      aria-hidden="true"
      className={cx('hsp-spacer', mode === 'design' && 'hsp-spacer--design', rootProps.className)}
      style={{ height: space(props.size, 'var(--hsp-space-sm)') }}
    />
  );
}

// ---------------------------------------------------------------------------
// Accordion
// ---------------------------------------------------------------------------

/**
 * Local (user-toggled) state that is discarded whenever `resetKey` changes. In design mode the key
 * includes the relevant props, so editing them in the inspector drops a local override; switching
 * between design and preview also resets it. Uses React's "adjust state while rendering" pattern
 * (no effect, so there is no frame showing the stale value).
 */
function useKeyedLocal<T>(resetKey: string): [T | undefined, (value: T) => void] {
  const [local, setLocal] = useState<{ resetKey: string; value: T | undefined }>({ resetKey, value: undefined });
  if (local.resetKey !== resetKey) setLocal({ resetKey, value: undefined });
  const value = local.resetKey === resetKey ? local.value : undefined;
  const set = useCallback((v: T) => setLocal({ resetKey, value: v }), [resetKey]);
  return [value, set];
}

/** Calls `handler` for UIEX_REVEAL_EVENTs dispatched inside `ref` while `enabled`. */
function useRevealListener(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  handler: (target: EventTarget | null) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const listener = (e: Event) => handlerRef.current(e.target);
    el.addEventListener(UIEX_REVEAL_EVENT, listener);
    return () => el.removeEventListener(UIEX_REVEAL_EVENT, listener);
  }, [ref, enabled]);
}

const ACCORDION_CARET: Record<string, number> = { 'extra-small': 12, small: 14, medium: 16 };

function AccordionPreview({ props, children, rootProps, mode, trigger }: PreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const title = str(props.title);
  const disabled = bool(props.disabled);
  const normalized = normalizeSize(props.size, 'small');
  const size = normalized === 'extra-small' || normalized === 'medium' ? normalized : 'small';
  const controlledOpen = props.open === undefined || props.open === null ? undefined : Boolean(props.open);
  const defaultOpen = bool(props.defaultOpen);

  const resetKey = mode === 'design' ? `design|${String(controlledOpen)}|${defaultOpen}` : 'preview';
  const [localOpen, setLocalOpen] = useKeyedLocal<boolean>(resetKey);
  // Preview mode is faithful to React semantics: `open` (controlled) wins over local state.
  // Design mode lets the designer expand/collapse locally regardless, to edit the content.
  const isOpen =
    mode === 'design' ? (localOpen ?? controlledOpen ?? defaultOpen) : (controlledOpen ?? localOpen ?? defaultOpen);

  const toggleFromHeader = () => {
    // In design mode clicking the title selects the Accordion; only the caret toggles it.
    if (mode === 'design' || disabled) return;
    if (controlledOpen === undefined) setLocalOpen(!isOpen);
    trigger('onClick');
  };
  const toggleFromCaret = () => {
    if (mode === 'design') setLocalOpen(!isOpen);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (mode === 'design') toggleFromCaret();
    else toggleFromHeader();
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useRevealListener(rootRef, mode === 'design', (target) => {
    if (!isOpen && target instanceof Node && bodyRef.current?.contains(target)) setLocalOpen(true);
  });

  return (
    <div
      {...rootProps}
      ref={rootRef}
      className={cx(
        'hsp-accordion',
        `hsp-accordion--${size}`,
        isOpen && 'hsp-accordion--open',
        disabled && 'hsp-accordion--disabled',
        rootProps.className,
      )}
    >
      <div
        className="hsp-accordion-header"
        role="button"
        tabIndex={disabled && mode !== 'design' ? -1 : 0}
        aria-expanded={isOpen}
        aria-disabled={disabled || undefined}
        onClick={toggleFromHeader}
        onKeyDown={onKeyDown}
      >
        <span
          className={cx('hsp-accordion-caret', mode === 'design' && 'hsp-accordion-caret--toggle')}
          onClick={toggleFromCaret}
          title={mode === 'design' ? (isOpen ? 'Collapse in designer' : 'Expand in designer') : undefined}
        >
          <ChevronRight size={ACCORDION_CARET[size]} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className={cx('hsp-accordion-title', !title && 'hsp-accordion-title--empty')}>
          {title || 'Accordion title'}
        </span>
      </div>
      {/* Kept mounted while collapsed so nested state survives and reveal events can find nodes. */}
      <div ref={bodyRef} className="hsp-accordion-body" hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs & Tab
// ---------------------------------------------------------------------------

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
const TOOLTIP_PLACEMENTS: TooltipPlacement[] = ['top', 'bottom', 'left', 'right'];

/** What a rendered Tab tells its Tabs so the header bar can be drawn. */
interface TabInfo {
  /** Unique per rendered Tab: `<node id>:<repeat clone index>`. */
  key: string;
  nodeId: string;
  clone: number;
  tabId: string | number | undefined;
  title: string;
  disabled: boolean;
  tooltip: string;
  tooltipPlacement: TooltipPlacement;
}

interface OrderedTab extends TabInfo {
  /** Value used for selected/defaultSelected matching and onSelectedChange: tabId, else index. */
  id: string | number;
  index: number;
}

interface TabsContextValue {
  /** Unique per Tabs instance, so nested Tabs don't capture each other's panels. */
  ownerId: string;
  activeKey: string | undefined;
  register: (info: TabInfo) => void;
  unregister: (key: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

/** Tab ids are `string | number`; anything else (or '') counts as "not set". */
function asTabId(value: unknown): string | number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') return value;
  return undefined;
}

function sameTab(a: TabInfo | undefined, b: TabInfo): boolean {
  return (
    !!a &&
    a.key === b.key &&
    a.nodeId === b.nodeId &&
    a.clone === b.clone &&
    a.tabId === b.tabId &&
    a.title === b.title &&
    a.disabled === b.disabled &&
    a.tooltip === b.tooltip &&
    a.tooltipPlacement === b.tooltipPlacement
  );
}

/**
 * Orders registered tabs like the document: by the Tab node's position among the Tabs node's
 * children, then by repeat clone index, then by registration order (for unknown nodes).
 */
function orderTabs(registry: Record<string, TabInfo>, childOrder: string[], seq: Map<string, number>): OrderedTab[] {
  const position = (nodeId: string) => {
    const i = childOrder.indexOf(nodeId);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return Object.values(registry)
    .sort(
      (a, b) =>
        position(a.nodeId) - position(b.nodeId) ||
        a.clone - b.clone ||
        (seq.get(a.key) ?? 0) - (seq.get(b.key) ?? 0),
    )
    .map((info, index) => ({ ...info, index, id: info.tabId ?? index }));
}

/** Finds the Tab panel (owned by `ownerId`) that contains `target`, skipping nested Tabs' panels. */
function findOwnPanelKey(target: EventTarget | null, ownerId: string): string | null {
  let el = target instanceof Element ? target.closest('[data-hsp-tab-key]') : null;
  while (el && el.getAttribute('data-hsp-tabs-owner') !== ownerId) {
    el = el.parentElement ? el.parentElement.closest('[data-hsp-tab-key]') : null;
  }
  return el ? el.getAttribute('data-hsp-tab-key') : null;
}

function TabsPreview({ node, props, children, rootProps, mode, trigger }: PreviewProps) {
  const ownerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerEls = useRef(new Map<string, HTMLDivElement>());

  // Registry of rendered Tab children (they register from a layout effect, see TabPreview).
  const [registry, setRegistry] = useState<Record<string, TabInfo>>({});
  const seqRef = useRef(new Map<string, number>());
  const register = useCallback((info: TabInfo) => {
    if (!seqRef.current.has(info.key)) seqRef.current.set(info.key, seqRef.current.size);
    setRegistry((prev) => (sameTab(prev[info.key], info) ? prev : { ...prev, [info.key]: info }));
  }, []);
  const unregister = useCallback((key: string) => {
    setRegistry((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const childOrder = Array.isArray(node?.children) ? node.children : [];
  const tabs = orderTabs(registry, childOrder, seqRef.current);

  const variant = props.variant === 'enclosed' ? 'enclosed' : 'default';
  const selected = asTabId(props.selected);
  const defaultSelected = asTabId(props.defaultSelected);
  const controlled = selected !== undefined;

  const resetKey = mode === 'design' ? `design|${String(selected)}|${String(defaultSelected)}` : 'preview';
  const [localKey, setLocalKey] = useKeyedLocal<string>(resetKey);

  const byKey = (key: string | undefined) => (key === undefined ? undefined : tabs.find((t) => t.key === key));
  const byId = (id: string | number | undefined) =>
    id === undefined ? undefined : tabs.find((t) => String(t.id) === String(id));
  // Design mode: a header click (local) wins so any tab can be shown and edited.
  // Preview mode: `selected` controls the tabs (React semantics); otherwise local, then default.
  const chosen =
    mode === 'design'
      ? (byKey(localKey) ?? byId(selected) ?? byId(defaultSelected))
      : controlled
        ? byId(selected)
        : (byKey(localKey) ?? byId(defaultSelected));
  const active = chosen ?? tabs.find((t) => !t.disabled) ?? tabs[0];

  const selectTab = (tab: OrderedTab) => {
    if (mode !== 'design' && tab.disabled) return;
    if (mode === 'design' || !controlled) setLocalKey(tab.key);
    // Designer clicks only change which tab is shown for editing; they never fire events.
    if (mode !== 'design' && tab.key !== active?.key) trigger('onSelectedChange', tab.id);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, tab: OrderedTab) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectTab(tab);
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const usable = tabs.filter((t) => mode === 'design' || !t.disabled || t.key === tab.key);
    const i = usable.findIndex((t) => t.key === tab.key);
    if (i === -1 || usable.length < 2) return;
    const next = usable[(i + (e.key === 'ArrowRight' ? 1 : -1) + usable.length) % usable.length];
    e.preventDefault();
    selectTab(next);
    triggerEls.current.get(next.key)?.focus();
  };

  useRevealListener(rootRef, mode === 'design', (target) => {
    const key = findOwnPanelKey(target, ownerId);
    if (key && key !== active?.key) setLocalKey(key);
  });

  const ctx = useMemo<TabsContextValue>(
    () => ({ ownerId, activeKey: active?.key, register, unregister }),
    [ownerId, active?.key, register, unregister],
  );

  return (
    <div
      {...rootProps}
      ref={rootRef}
      className={cx(
        'hsp-tabs',
        `hsp-tabs--${variant}`,
        bool(props.fill) && 'hsp-tabs--fill',
        rootProps.className,
      )}
    >
      {tabs.length > 0 && (
        <div className="hsp-tabs-list" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.key === active?.key;
            return (
              <div
                key={tab.key}
                ref={(el) => {
                  if (el) triggerEls.current.set(tab.key, el);
                  else triggerEls.current.delete(tab.key);
                }}
                role="tab"
                aria-selected={isActive}
                aria-disabled={tab.disabled || undefined}
                tabIndex={isActive ? 0 : -1}
                className={cx(
                  'hsp-tabs-trigger',
                  isActive && 'hsp-tabs-trigger--active',
                  tab.disabled && 'hsp-tabs-trigger--disabled',
                )}
                onClick={(e: ReactMouseEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  selectTab(tab);
                }}
                onKeyDown={(e) => onTriggerKeyDown(e, tab)}
              >
                <span className={cx('hsp-tabs-label', !tab.title && 'hsp-tabs-label--untitled')}>
                  {tab.title || `Tab ${tab.index + 1}`}
                </span>
                {tab.tooltip && (
                  <span aria-hidden="true" className={cx('hsp-tabs-tip', `hsp-tabs-tip--${tab.tooltipPlacement}`)}>
                    {tab.tooltip}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="hsp-tabs-panels">
        <TabsContext.Provider value={ctx}>{children}</TabsContext.Provider>
      </div>
    </div>
  );
}

function TabPreview({ node, props, children, rootProps }: PreviewProps) {
  const ctx = useContext(TabsContext);
  const nodeId = node?.id ?? rootProps['data-node-id'];
  const clone = Number(rootProps['data-uiex-clone'] ?? 0) || 0;
  const key = `${nodeId}:${clone}`;
  const tabId = asTabId(props.tabId);
  const title = str(props.title);
  const disabled = bool(props.disabled);
  const tooltip = str(props.tooltip);
  const tooltipPlacement = TOOLTIP_PLACEMENTS.includes(props.tooltipPlacement) ? (props.tooltipPlacement as TooltipPlacement) : 'top';

  const register = ctx?.register;
  const unregister = ctx?.unregister;
  // Layout effect: the parent's header bar is updated before the browser paints.
  useLayoutEffect(() => {
    if (!register || !unregister) return;
    register({ key, nodeId, clone, tabId, title, disabled, tooltip, tooltipPlacement });
    return () => unregister(key);
  }, [register, unregister, key, nodeId, clone, tabId, title, disabled, tooltip, tooltipPlacement]);

  // Outside a Tabs (should not happen; placement rules forbid it) the panel is simply shown.
  const hidden = ctx ? ctx.activeKey !== key : false;
  return (
    <div
      {...rootProps}
      role={ctx ? 'tabpanel' : undefined}
      className={cx('hsp-tab-panel', rootProps.className)}
      hidden={hidden}
      data-hsp-tab-key={ctx ? key : undefined}
      data-hsp-tabs-owner={ctx?.ownerId}
    >
      {children}
    </div>
  );
}

/** A short random suffix so Tabs dropped one after another get distinct `tabId`s. */
function newTabId(): string {
  return `tab-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const flexDirectionOptions = [
  { value: 'row', label: 'Side by side' },
  { value: 'column', label: 'Stacked' },
];
const boxAlignSelfOptions = [...FLEX_ALIGN, { value: 'auto', label: 'Like the others' }];
const boxFlexOptions = [
  { value: 'initial', label: 'Fit its content (shrink only)' },
  { value: 'auto', label: 'Grow and shrink (auto)' },
  { value: 'none', label: 'Fixed size' },
  { value: 1, label: 'Fill: 1 share (equal columns)' },
  { value: 2, label: 'Fill: 2 shares' },
  { value: 3, label: 'Fill: 3 shares' },
  { value: 4, label: 'Fill: 4 shares' },
];

export const layoutComponents: ComponentDef[] = [
  {
    type: 'Flex',
    label: 'Layout box',
    category: 'Layout',
    description: 'Arranges the components inside it side by side or stacked, with even space between them.',
    icon: Columns3,
    docsUrl: `${STANDARD_DOCS}/flex`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['flex', 'row', 'column', 'stack', 'container', 'layout', 'flexbox', 'group', 'box', 'side by side'],
    children: { mode: 'nodes', placeholder: 'Drop components here' },
    create: () => ({ type: 'Flex', props: { direction: 'column', gap: 'small' } }),
    props: [
      {
        name: 'direction',
        label: 'Arrange',
        type: { kind: 'enum', options: flexDirectionOptions, display: 'direction' },
        defaultValue: 'row',
        group: 'Layout',
        description: 'Side by side puts the components in a row; stacked puts them one under the other.',
      },
      {
        name: 'gap',
        label: 'Space between',
        type: { kind: 'enum', options: DISTANCE_OPTIONS, display: 'spacing' },
        defaultValue: 'flush',
        group: 'Layout',
        description: 'How much space separates the components inside.',
      },
      {
        name: 'justify',
        label: 'Distribute',
        type: { kind: 'enum', options: FLEX_JUSTIFY },
        defaultValue: 'start',
        group: 'Layout',
        description: 'Where the components sit in the direction they are arranged: at the start, center or end, or spread out with space around or between them.',
      },
      {
        name: 'align',
        label: 'Align',
        type: { kind: 'enum', options: FLEX_ALIGN },
        defaultValue: 'stretch',
        group: 'Layout',
        description: 'How the components line up the other way: stacked, from left to right (stretch = full width); side by side, from top to bottom.',
      },
      {
        name: 'alignSelf',
        label: 'Align in parent',
        type: { kind: 'enum', options: FLEX_ALIGN },
        group: 'Layout',
        description: 'Lines up this layout box differently from the components next to it, when it sits inside another layout box.',
      },
      {
        name: 'wrap',
        label: 'When it doesn’t fit',
        type: { kind: 'enum', options: [{ value: 'nowrap', label: 'Keep on one line' }, { value: 'wrap', label: 'Wrap to next line' }] },
        defaultValue: 'nowrap',
        group: 'Layout',
        description: 'Side by side components that don’t fit: squeeze them onto one line, or move the rest onto the next line.',
      },
      testIdProp,
    ],
    preview: FlexPreview,
  },
  {
    type: 'Box',
    label: 'Box',
    category: 'Layout',
    description: 'Wraps a component inside a layout box to control how much room it takes (e.g. equal columns).',
    icon: BoxIcon,
    docsUrl: `${STANDARD_DOCS}/box`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['wrapper', 'flex item', 'grow', 'container', 'div'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop content here' },
    create: () => ({ type: 'Box', children: [{ type: 'Text', text: 'Box content' }] }),
    props: [
      {
        name: 'alignSelf',
        label: 'Align in parent',
        type: { kind: 'enum', options: boxAlignSelfOptions },
        defaultValue: 'auto',
        group: 'Layout',
        description: 'Lines this box up differently from the components next to it in its layout box.',
      },
      {
        name: 'flex',
        label: 'Room it takes',
        type: { kind: 'enum', options: boxFlexOptions },
        defaultValue: 'auto',
        group: 'Layout',
        description: 'How much free space the box takes in its layout box. Give two boxes the same share for equal columns.',
      },
      testIdProp,
    ],
    preview: BoxPreview,
  },
  {
    type: 'Inline',
    label: 'Inline row',
    category: 'Layout',
    description: 'Lines up components side by side, moving them to the next line when they don’t fit.',
    icon: AlignHorizontalSpaceAround,
    docsUrl: `${STANDARD_DOCS}/inline`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['row', 'horizontal', 'side by side', 'wrap', 'layout'],
    children: { mode: 'nodes', placeholder: 'Drop components to line them up' },
    create: () => ({ type: 'Inline', props: { gap: 'small', align: 'center' } }),
    props: [
      {
        name: 'gap',
        label: 'Space between',
        type: { kind: 'enum', options: DISTANCE_OPTIONS, display: 'spacing' },
        defaultValue: 'flush',
        group: 'Layout',
        description: 'How much space separates the components.',
      },
      {
        name: 'justify',
        label: 'Distribute',
        type: { kind: 'enum', options: FLEX_JUSTIFY },
        defaultValue: 'start',
        group: 'Layout',
        description: 'Where the components sit from left to right: start, center or end, or spread out.',
      },
      {
        name: 'align',
        label: 'Align',
        type: { kind: 'enum', options: FLEX_ALIGN },
        defaultValue: 'stretch',
        group: 'Layout',
        description: 'How the components line up from top to bottom within the row.',
      },
      testIdProp,
    ],
    preview: InlinePreview,
  },
  {
    type: 'AutoGrid',
    label: 'Auto grid',
    category: 'Layout',
    description: 'A responsive grid that fits as many columns of a given width as the space allows.',
    icon: LayoutGrid,
    docsUrl: `${STANDARD_DOCS}/autogrid`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['grid', 'columns', 'responsive', 'cards', 'gallery'],
    children: { mode: 'nodes', placeholder: 'Drop grid items here' },
    create: () => ({
      type: 'AutoGrid',
      props: { columnWidth: 180, gap: 'small', flexible: true },
      children: ['Item 1', 'Item 2', 'Item 3'].map((label) => ({
        type: 'Tile',
        props: { compact: true },
        children: [{ type: 'Text', text: label }],
      })),
    }),
    props: [
      {
        name: 'columnWidth',
        label: 'Column width (px)',
        type: { kind: 'number', min: 1, step: 10, integer: true },
        required: true,
        group: 'Layout',
        description: 'Width of each column in pixels. When flexible, the minimum width before columns expand.',
      },
      {
        name: 'gap',
        label: 'Space between',
        type: { kind: 'enum', options: DISTANCE_OPTIONS, display: 'spacing' },
        defaultValue: 'flush',
        group: 'Layout',
        description: 'How much space separates the grid items.',
      },
      {
        name: 'flexible',
        label: 'Stretch columns',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'When on, the columns stretch to fill the width (the column width becomes the minimum).',
      },
      testIdProp,
    ],
    preview: AutoGridPreview,
  },
  {
    type: 'Tile',
    label: 'Tile',
    category: 'Layout',
    description: 'A bordered container that groups related components.',
    icon: RectangleHorizontal,
    docsUrl: `${STANDARD_DOCS}/tile`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['card', 'panel', 'box', 'group', 'border', 'container'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop tile content here' },
    create: () => ({
      type: 'Tile',
      children: [
        { type: 'Text', props: { format: { fontWeight: 'bold' } }, text: 'Tile title' },
        { type: 'Text', text: 'Group related information inside a tile.' },
      ],
    }),
    props: [
      {
        name: 'compact',
        label: 'Less padding',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Appearance',
        description: 'Makes the space inside the tile smaller.',
      },
      {
        name: 'flush',
        label: 'No side padding',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Appearance',
        description: 'Lets the content reach the tile’s left and right edges.',
      },
      testIdProp,
    ],
    preview: TilePreview,
  },
  {
    type: 'Divider',
    label: 'Divider',
    category: 'Layout',
    description: 'A grey horizontal line that separates sections of content.',
    icon: SeparatorHorizontal,
    docsUrl: `${STANDARD_DOCS}/divider`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['separator', 'line', 'hr', 'rule', 'section'],
    children: { mode: 'none' },
    props: [
      {
        name: 'size',
        label: 'Space around',
        type: { kind: 'enum', options: DISTANCE_OPTIONS, display: 'spacing' },
        defaultValue: 'small',
        group: 'Layout',
        description: 'The space between the line and the content above and below it.',
      },
      testIdProp,
    ],
    preview: DividerPreview,
  },
  {
    type: 'Spacer',
    label: 'Spacer',
    category: 'Layout',
    description: 'Adds consistent vertical space between components.',
    icon: MoveVertical,
    docsUrl: `${STANDARD_DOCS}/spacer`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['space', 'gap', 'margin', 'vertical', 'whitespace'],
    children: { mode: 'none' },
    props: [
      {
        name: 'size',
        label: 'Height',
        type: { kind: 'enum', options: SIZE_ALL, display: 'spacing' },
        defaultValue: 'small',
        group: 'Layout',
        description: 'How much empty space it adds.',
      },
      testIdProp,
    ],
    preview: SpacerPreview,
  },
  {
    type: 'Accordion',
    label: 'Accordion',
    category: 'Layout',
    description: 'An expandable and collapsible section with a title, for saving space.',
    icon: ListCollapse,
    docsUrl: `${STANDARD_DOCS}/accordion`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['collapse', 'expand', 'disclosure', 'toggle', 'section', 'details'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop accordion content here' },
    create: () => ({
      type: 'Accordion',
      props: { title: 'More details', defaultOpen: true },
      children: [{ type: 'Text', text: 'Content shown when the accordion is expanded.' }],
    }),
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        required: true,
        group: 'Content',
        description: "The accordion's title text.",
      },
      {
        name: 'defaultOpen',
        label: 'Open at first',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Shows the content when the card opens; people can still close it.',
      },
      {
        name: 'open',
        label: 'Open (from a variable)',
        type: { kind: 'boolean' },
        group: 'Behavior',
        description: 'Opens or closes it from a variable (state), e.g. after a button click. Wins over “Open at first”.',
      },
      {
        name: 'disabled',
        label: 'Disabled',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'People can’t open or close it.',
      },
      {
        name: 'size',
        label: 'Title size',
        type: { kind: 'enum', options: SIZE_XS_MD },
        defaultValue: 'small',
        group: 'Appearance',
        description: 'The size of the accordion title.',
      },
      testIdProp,
    ],
    events: [
      {
        name: 'onClick',
        label: 'On title click',
        description: 'Runs when the accordion title is clicked. Receives no arguments.',
        params: [],
      },
    ],
    preview: AccordionPreview,
  },
  {
    type: 'Tabs',
    label: 'Tabs',
    category: 'Layout',
    description: 'Groups related content into tabs so users can switch views without leaving the page.',
    icon: PanelsTopLeft,
    docsUrl: `${STANDARD_DOCS}/tabs`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['tab', 'tabs', 'views', 'navigation', 'sections', 'switch'],
    children: { mode: 'nodes', accepts: ['Tab'], placeholder: 'Drop Tab components here' },
    create: () => ({
      type: 'Tabs',
      props: { defaultSelected: 'overview' },
      children: [
        {
          type: 'Tab',
          props: { tabId: 'overview', title: 'Overview' },
          children: [{ type: 'Text', text: 'Overview content goes here.' }],
        },
        {
          type: 'Tab',
          props: { tabId: 'activity', title: 'Activity' },
          children: [{ type: 'Text', text: 'Activity content goes here.' }],
        },
      ],
    }),
    props: [
      {
        name: 'defaultSelected',
        label: 'Tab shown first',
        type: { kind: 'string', placeholder: 'tabId of a Tab' },
        group: 'Behavior',
        description: 'The Tab ID of the tab shown when the card opens.',
      },
      {
        name: 'selected',
        label: 'Selected tab (from a variable)',
        type: { kind: 'string', placeholder: 'tabId of a Tab' },
        group: 'Behavior',
        description: 'Switches tabs from a variable (state). Link it under “Value binding” so clicking a tab updates the variable.',
      },
      {
        name: 'variant',
        label: 'Style',
        type: { kind: 'enum', options: [{ value: 'default', label: 'Default' }, { value: 'enclosed', label: 'Enclosed' }] },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'Default shows underlined tab titles; enclosed puts the tabs in a box.',
      },
      {
        name: 'fill',
        label: 'Full width',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Stretches the tab titles across the whole width.',
      },
      testIdProp,
    ],
    events: [
      {
        name: 'onSelectedChange',
        label: 'On tab change',
        description: 'Runs when the selected tab changes.',
        params: [{ name: 'selectedId', description: 'The tabId of the newly selected tab.' }],
      },
    ],
    valueBinding: { prop: 'selected', event: 'onSelectedChange', stateType: 'string', initial: 'overview' },
    preview: TabsPreview,
  },
  {
    type: 'Tab',
    label: 'Tab',
    category: 'Layout',
    description: 'A single tab (view) inside Tabs. Its children are shown when the tab is selected.',
    icon: PanelTop,
    docsUrl: `${STANDARD_DOCS}/tabs`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['tab', 'view', 'pane', 'section'],
    parents: ['Tabs'],
    children: { mode: 'nodes', placeholder: 'Drop tab content here' },
    create: () => ({ type: 'Tab', props: { tabId: newTabId(), title: 'New tab' } }),
    identityProps: ['tabId'],
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: "The tab's title text.",
      },
      {
        name: 'tabId',
        label: 'Tab ID',
        type: { kind: 'string' },
        group: 'Content',
        description: 'A unique name for this tab (no spaces), used by “Tab shown first”.',
      },
      {
        name: 'disabled',
        label: 'Disabled',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Greys the tab out and makes it unclickable.',
      },
      {
        name: 'tooltip',
        label: 'Tooltip',
        type: { kind: 'string' },
        group: 'Content',
        description: 'Text shown in a tooltip when hovering the tab.',
      },
      {
        name: 'tooltipPlacement',
        label: 'Tooltip placement',
        type: { kind: 'enum', options: enumOptions('top', 'bottom', 'left', 'right') },
        defaultValue: 'top',
        group: 'Appearance',
        description: 'Where the tooltip appears, relative to the tab.',
        visibleWhen: (p) => p.tooltip !== undefined && p.tooltip !== '',
      },
      testIdProp,
    ],
    preview: TabPreview,
  },
];

