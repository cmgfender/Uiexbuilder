/**
 * Overlays & charts: Modal, ModalBody, ModalFooter, Panel, PanelBody, PanelSection, PanelFooter,
 * BarChart, LineChart.
 * See text.tsx for the reference conventions (exact @hubspot/ui-extensions prop names, inspector
 * metadata, previews that spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/components/
 *   modal.synced.d.ts, panel.synced.d.ts, chart.synced.d.ts (+ TShirtSizes in shared.synced.d.ts).
 *
 * Overlays (Modal / Panel) only live in a trigger's `overlay` slot (enforced by rules.ts through
 * `overlay: { idProp: 'id' }`). Their previews have two presentations (`p.overlay.presentation`):
 *   - 'inline' (or no overlay info): a static dialog / side-sheet block in normal flow, used by the
 *     designer's overlay storyboard so the content can be edited in place;
 *   - 'open': a real overlay absolutely positioned inside the nearest `.hsp-overlay-host` (a modal
 *     centered over a backdrop, a panel docked to the right), with a working close button.
 * While open, the previews fire their own `onOpen` (after the open transition) and `onClose` (when
 * they unmount after having opened) through `trigger`, mirroring HubSpot's "has finished opening /
 * closing" semantics.
 *
 * Charts render real SVG bar / line charts from `data` + `axes` (+ `options`), including grouping by
 * color (`axes.options.groupFieldByColor`), stacking, HubSpot's named chart colors, legend, data
 * labels and hover tooltips. Invalid data degrades to an explanatory empty state.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { customAlphabet } from 'nanoid';
import {
  AppWindow,
  ChartColumn,
  ChartLine,
  PanelBottom,
  PanelBottomDashed,
  PanelRight,
  PanelRightDashed,
  SquareDashedText,
  SquareSplitVertical,
  X,
} from 'lucide-react';
import { newId } from '../../model/ids';
import type { CloseOverlayAction, JsonValue, NodeTemplate } from '../../model/types';
import type { ComponentDef, EnumOption, EventDef, PreviewProps, PropDef } from '../types';
import { STANDARD_DOCS } from '../constants';
import { cx, normalizeSize, str } from '../../preview/util';
import '../../preview/styles/overlaysCharts.css';

// ---------------------------------------------------------------------------
// Defensive prop readers (props may come from arbitrary user expressions)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Boolean prop: true only for `true` (or the string 'true' produced by text templates). */
function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Own-property lookup so keys like "constructor" never resolve to Object.prototype members. */
function own(table: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const TEST_ID_PROP: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

// ===========================================================================
// Overlays
// ===========================================================================

/** Delay after which an open overlay reports `onOpen` (matches the CSS open transition). */
export const OVERLAY_OPEN_MS = 180;

const OVERLAY_WIDTHS = ['small', 'medium', 'large'] as const;
type OverlayWidth = (typeof OVERLAY_WIDTHS)[number];

/** `width` accepts TShirtSizes sm | md | lg in both spellings ('sm' / 'small', ...). Default 'sm'. */
function overlayWidth(v: unknown): OverlayWidth {
  return oneOf(normalizeSize(v, 'small'), OVERLAY_WIDTHS, 'small');
}

/** Short random suffix so every dropped Modal / Panel gets a distinct `id` (e.g. "modal-k3j9"). */
const overlaySuffix = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 4);

/**
 * Fires `onOpen` once the overlay has finished opening and `onClose` when it unmounts after having
 * opened. The timer also absorbs React StrictMode's simulated unmount/remount, so each real
 * open/close cycle reports exactly one onOpen and one onClose.
 */
function useOverlayLifecycle(active: boolean, trigger: PreviewProps['trigger']): void {
  const triggerRef = useRef(trigger);
  useLayoutEffect(() => {
    triggerRef.current = trigger;
  });
  useEffect(() => {
    if (!active) return undefined;
    let opened = false;
    const timer = setTimeout(() => {
      opened = true;
      triggerRef.current('onOpen');
    }, OVERLAY_OPEN_MS);
    return () => {
      clearTimeout(timer);
      if (opened) triggerRef.current('onClose');
    };
  }, [active]);
}

/**
 * Moves keyboard focus into an opened dialog so Escape / Tab work like in HubSpot, and gives it
 * back to the element that had it (usually the trigger button) when the dialog closes.
 */
function useAutoFocus(active: boolean): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return undefined;
    const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    ref.current?.focus({ preventScroll: true });
    const surface = ref.current;
    return () => {
      // Only restore when focus is still in the dialog (or was dropped to <body> by the unmount).
      const current = document.activeElement;
      const lost = !current || current === document.body || (surface?.contains(current) ?? false);
      if (lost && opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside a modal dialog (focus wraps from the last element to the first). */
function trapTab(e: ReactKeyboardEvent<HTMLDivElement>): void {
  if (e.key !== 'Tab') return;
  const surface = e.currentTarget;
  const items = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[aria-hidden="true"]'));
  if (items.length === 0) {
    e.preventDefault();
    surface.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === surface)) {
    e.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!e.shiftKey && (active === last || !surface.contains(active))) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function OverlayHeader({ title, onClose }: { title: string; onClose?: () => void }) {
  return (
    <div className="hsp-overlay-header">
      <h2 className="hsp-overlay-title" title={title || undefined}>
        {title}
      </h2>
      {onClose ? (
        <button type="button" className="hsp-overlay-close" aria-label="Close" onClick={onClose}>
          <X size={20} strokeWidth={2.25} aria-hidden="true" />
        </button>
      ) : (
        // Storyboard rendering: the close affordance is drawn but not interactive.
        <span className="hsp-overlay-close" aria-hidden="true">
          <X size={20} strokeWidth={2.25} />
        </span>
      )}
    </div>
  );
}

interface OverlayFrameProps {
  kind: 'modal' | 'panel';
  preview: PreviewProps;
  /** Extra classes for the dialog / sheet element (variant, width). */
  surfaceClass: string;
  /** Whether the open overlay dims (and blocks) the page underneath. */
  backdrop: boolean;
}

/** Shared rendering of Modal and Panel in both presentations. */
function OverlayFrame({ kind, preview, surfaceClass, backdrop }: OverlayFrameProps) {
  const { props, children, rootProps, overlay, trigger } = preview;
  const open = overlay?.presentation === 'open';
  useOverlayLifecycle(open, trigger);
  const surfaceRef = useAutoFocus(open);
  const title = str(props.title);
  const ariaLabel = str(props['aria-label']) || title || undefined;
  const body = <div className="hsp-overlay-content">{children}</div>;

  if (!open) {
    return (
      <div
        {...rootProps}
        role="group"
        className={cx(`hsp-${kind}`, 'hsp-overlay-inline', surfaceClass, rootProps.className)}
        aria-label={ariaLabel}
      >
        <OverlayHeader title={title} />
        {body}
      </div>
    );
  }

  const close = () => overlay?.close();
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    // Modal dialogs (and modal panels) keep keyboard focus inside, like HubSpot's.
    if (backdrop) trapTab(e);
  };
  return (
    <div
      {...rootProps}
      className={cx('hsp-overlay-layer', `hsp-${kind}-layer`, backdrop && 'hsp-overlay-backdrop', rootProps.className)}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal={backdrop ? 'true' : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cx(`hsp-${kind}`, 'hsp-overlay-open', surfaceClass)}
        onKeyDown={onKeyDown}
      >
        <OverlayHeader title={title} onClose={close} />
        {body}
      </div>
    </div>
  );
}

function ModalPreview(p: PreviewProps) {
  const danger = p.props.variant === 'danger';
  return (
    <OverlayFrame
      kind="modal"
      preview={p}
      backdrop
      surfaceClass={cx(`hsp-modal-${overlayWidth(p.props.width)}`, danger && 'hsp-modal-danger')}
    />
  );
}

function PanelPreview(p: PreviewProps) {
  // The `modal` variant focuses the panel and dims the page; `default` keeps the page usable.
  const modalVariant = p.props.variant === 'modal';
  return (
    <OverlayFrame
      kind="panel"
      preview={p}
      backdrop={modalVariant}
      surfaceClass={cx(`hsp-panel-${overlayWidth(p.props.width)}`, modalVariant && 'hsp-panel-modal')}
    />
  );
}

/** Simple container previews for the overlay building blocks. */
function sectionPreview(className: string, extra?: (props: Record<string, unknown>) => string | false) {
  function SectionPreview({ props, children, rootProps }: PreviewProps) {
    return (
      <div {...rootProps} className={cx(className, extra?.(props), rootProps.className)}>
        {children}
      </div>
    );
  }
  return SectionPreview;
}

const ModalBodyPreview = sectionPreview('hsp-modal-body hsp-overlay-stack');
const ModalFooterPreview = sectionPreview('hsp-modal-footer hsp-overlay-footer');
const PanelBodyPreview = sectionPreview('hsp-panel-body');
const PanelSectionPreview = sectionPreview('hsp-panel-section hsp-overlay-stack', (props) =>
  bool(props.flush) && 'hsp-panel-section-flush',
);
const PanelFooterPreview = sectionPreview('hsp-panel-footer hsp-overlay-footer');

// ---------------------------------------------------------------------------
// Overlay definitions
// ---------------------------------------------------------------------------

const WIDTH_OPTIONS: EnumOption[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const overlayIdProp = (noun: string): PropDef => ({
  name: 'id',
  label: 'ID',
  type: { kind: 'string', placeholder: `e.g. edit-${noun}` },
  required: true,
  group: 'Content',
  description: `Unique identifier of the ${noun}. Pass it to the “Close overlay” action (actions.closeOverlay) to close the ${noun}.`,
});

const overlayWidthProp = (noun: string): PropDef => ({
  name: 'width',
  label: 'Width',
  type: { kind: 'enum', options: WIDTH_OPTIONS },
  defaultValue: 'small',
  group: 'Layout',
  description: `The width of the ${noun}.`,
});

const ariaLabelProp = (noun: string): PropDef => ({
  name: 'aria-label',
  label: 'Accessibility label',
  type: { kind: 'string' },
  group: 'Advanced',
  description: `The ${noun}'s accessibility label, read by screen readers.`,
});

const overlayEvents = (noun: string): EventDef[] => [
  { name: 'onOpen', label: 'On open', description: `Runs when the ${noun} has finished opening.`, params: [] },
  { name: 'onClose', label: 'On close', description: `Runs when the ${noun} has finished closing.`, params: [] },
];

function closeOverlayStep(overlayId: string): CloseOverlayAction {
  // "@<id prop>" is rewritten to the concrete node id on insertion (see fixupOverlayRefs).
  return { id: newId('a'), type: 'closeOverlay', overlayNodeId: `@${overlayId}` };
}

/** Footer buttons following HubSpot's pattern: primary action first, then a secondary Cancel. */
function footerButtons(overlayId: string, primaryLabel: string): NodeTemplate[] {
  return [
    {
      type: 'Button',
      props: { variant: 'primary' },
      text: primaryLabel,
      events: { onClick: [closeOverlayStep(overlayId)] },
    },
    {
      type: 'Button',
      props: { variant: 'secondary' },
      text: 'Cancel',
      events: { onClick: [closeOverlayStep(overlayId)] },
    },
  ];
}

function createModal(): NodeTemplate {
  const id = `modal-${overlaySuffix()}`;
  return {
    type: 'Modal',
    props: { id, title: 'Edit details' },
    children: [
      {
        type: 'ModalBody',
        children: [
          {
            type: 'Text',
            text: 'Use a modal for a short, focused task such as confirming an action or editing a few fields.',
          },
        ],
      },
      { type: 'ModalFooter', children: footerButtons(id, 'Save') },
    ],
  };
}

function createPanel(): NodeTemplate {
  const id = `panel-${overlaySuffix()}`;
  return {
    type: 'Panel',
    props: { id, title: 'Details' },
    children: [
      {
        type: 'PanelBody',
        children: [
          {
            type: 'PanelSection',
            children: [
              {
                type: 'Text',
                text: 'Use a panel for longer forms, multi-step flows or extra context next to the record.',
              },
            ],
          },
        ],
      },
      { type: 'PanelFooter', children: footerButtons(id, 'Save') },
    ],
  };
}

const overlayComponents: ComponentDef[] = [
  {
    type: 'Modal',
    label: 'Modal',
    category: 'Overlays',
    description:
      'A pop-up dialog opened by the button, link, image or tag it is attached to. Close it with the “Close overlay” action.',
    icon: AppWindow,
    docsUrl: `${STANDARD_DOCS}/modal`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['dialog', 'popup', 'pop-up', 'overlay', 'confirm', 'confirmation', 'lightbox'],
    overlay: { idProp: 'id' },
    // `Form` is accepted so the HubSpot "form in a modal" pattern (Form > ModalBody + ModalFooter) works.
    children: { mode: 'nodes', accepts: ['ModalBody', 'ModalFooter', 'Form'], placeholder: 'Drop a modal body and footer here' },
    create: createModal,
    props: [
      overlayIdProp('modal'),
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: "The title displayed in the modal's top bar.",
      },
      {
        name: 'variant',
        label: 'Variant',
        type: {
          kind: 'enum',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'danger', label: 'Danger' },
          ],
        },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'The type of modal. Use danger when the user is about to perform a destructive action.',
      },
      overlayWidthProp('modal'),
      ariaLabelProp('modal'),
      TEST_ID_PROP,
    ],
    events: overlayEvents('modal'),
    preview: ModalPreview,
  },
  {
    type: 'ModalBody',
    label: 'Modal body',
    category: 'Overlays',
    description: 'The main content of a Modal. One modal body is required per modal.',
    icon: SquareDashedText,
    docsUrl: `${STANDARD_DOCS}/modal`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['modal content', 'dialog body', 'overlay'],
    parents: ['Modal', 'Form'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop modal content here' },
    create: () => ({ type: 'ModalBody', children: [{ type: 'Text', text: 'Modal content' }] }),
    props: [TEST_ID_PROP],
    preview: ModalBodyPreview,
  },
  {
    type: 'ModalFooter',
    label: 'Modal footer',
    category: 'Overlays',
    description: 'The footer of a Modal, typically holding its action buttons. Use one per modal.',
    icon: PanelBottom,
    docsUrl: `${STANDARD_DOCS}/modal`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['modal actions', 'dialog footer', 'buttons', 'overlay'],
    parents: ['Modal', 'Form'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop buttons here' },
    create: () => ({
      type: 'ModalFooter',
      children: [
        { type: 'Button', props: { variant: 'primary' }, text: 'Save' },
        { type: 'Button', props: { variant: 'secondary' }, text: 'Cancel' },
      ],
    }),
    props: [TEST_ID_PROP],
    preview: ModalFooterPreview,
  },
  {
    type: 'Panel',
    label: 'Panel',
    category: 'Overlays',
    description:
      'A side panel that slides in from the right, opened by the button, link, image or tag it is attached to. Close it with the “Close overlay” action.',
    icon: PanelRight,
    docsUrl: `${STANDARD_DOCS}/panel`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['side panel', 'drawer', 'sheet', 'sidebar', 'overlay', 'flyout'],
    overlay: { idProp: 'id' },
    // `Form` is accepted so the HubSpot "form in a panel" pattern (Form > PanelBody + PanelFooter) works.
    children: { mode: 'nodes', accepts: ['PanelBody', 'PanelFooter', 'Form'], placeholder: 'Drop a panel body and footer here' },
    create: createPanel,
    props: [
      overlayIdProp('panel'),
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: 'The text displayed at the top of the panel.',
      },
      {
        name: 'variant',
        label: 'Variant',
        type: {
          kind: 'enum',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'modal', label: 'Modal' },
          ],
        },
        defaultValue: 'default',
        group: 'Appearance',
        description:
          'The modal variant dims the page and keeps screen reader and keyboard focus on the panel (recommended for accessibility).',
      },
      overlayWidthProp('panel'),
      ariaLabelProp('panel'),
      TEST_ID_PROP,
    ],
    events: overlayEvents('panel'),
    preview: PanelPreview,
  },
  {
    type: 'PanelBody',
    label: 'Panel body',
    category: 'Overlays',
    description: "A scrollable container for the panel's content. Use one per panel.",
    icon: PanelRightDashed,
    docsUrl: `${STANDARD_DOCS}/panel`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['panel content', 'drawer body', 'overlay'],
    parents: ['Panel', 'Form'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop panel sections here' },
    create: () => ({
      type: 'PanelBody',
      children: [{ type: 'PanelSection', children: [{ type: 'Text', text: 'Panel content' }] }],
    }),
    props: [TEST_ID_PROP],
    preview: PanelBodyPreview,
  },
  {
    type: 'PanelSection',
    label: 'Panel section',
    category: 'Overlays',
    description: 'Groups content inside a panel body, adding padding and bottom spacing between groups.',
    icon: SquareSplitVertical,
    docsUrl: `${STANDARD_DOCS}/panel`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['panel group', 'section', 'overlay'],
    parents: ['PanelBody'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop section content here' },
    create: () => ({ type: 'PanelSection', children: [{ type: 'Text', text: 'Section content' }] }),
    props: [
      {
        name: 'flush',
        label: 'Flush',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Remove the bottom margin of the section.',
      },
      TEST_ID_PROP,
    ],
    preview: PanelSectionPreview,
  },
  {
    type: 'PanelFooter',
    label: 'Panel footer',
    category: 'Overlays',
    description: 'A sticky footer at the bottom of a panel for actions that should always be visible. Use one per panel.',
    icon: PanelBottomDashed,
    docsUrl: `${STANDARD_DOCS}/panel`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['panel actions', 'drawer footer', 'buttons', 'overlay'],
    parents: ['Panel', 'Form'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop buttons here' },
    create: () => ({
      type: 'PanelFooter',
      children: [
        { type: 'Button', props: { variant: 'primary' }, text: 'Save' },
        { type: 'Button', props: { variant: 'secondary' }, text: 'Cancel' },
      ],
    }),
    props: [TEST_ID_PROP],
    preview: PanelFooterPreview,
  },
];

// ===========================================================================
// Charts
// ===========================================================================

/** HubSpot's named chart colors (ChartColor), in HubSpot's default assignment order. */
export const CHART_COLORS = {
  orange: '#ff7a59',
  aqua: '#00bda5',
  purple: '#6a78d1',
  yellow: '#f5c26b',
  pink: '#ea90b1',
  blue: '#00a4bd',
  green: '#4fb06d',
  darkOrange: '#c4532f',
  darkAqua: '#00826e',
  darkPurple: '#4a51a3',
  darkYellow: '#bd8b30',
  darkPink: '#c25586',
  darkBlue: '#00728a',
  darkGreen: '#317a48',
} as const;
export type ChartColorName = keyof typeof CHART_COLORS;
const CHART_COLOR_NAMES = Object.keys(CHART_COLORS) as ChartColorName[];

function isChartColor(v: unknown): v is ChartColorName {
  return typeof v === 'string' && Object.hasOwn(CHART_COLORS, v);
}

const FIELD_TYPES = ['category', 'datetime', 'linear'] as const;
type ChartFieldType = (typeof FIELD_TYPES)[number];

export interface ChartAxisModel {
  field: string;
  fieldType: ChartFieldType;
  /** Display label (falls back to the field name, like HubSpot). */
  label: string;
}

export interface ChartCategory {
  /** Raw x value as a string (grouping key). */
  key: string;
  /** Display label. */
  label: string;
  /** Numeric position for linear / datetime x values (null when not numeric). */
  position: number | null;
}

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  /** One value per category (null = no data point). Duplicate rows are summed. */
  values: Array<number | null>;
}

export interface ChartModel {
  x: ChartAxisModel;
  y: ChartAxisModel;
  categories: ChartCategory[];
  series: ChartSeries[];
  /** Stack grouped series (axes.options.stacking with a groupFieldByColor). */
  stacking: boolean;
  /** Line charts with linear / datetime x values are drawn on a continuous x scale. */
  continuousX: boolean;
}

export type ChartModelResult =
  | { ok: true; model: ChartModel }
  | { ok: false; title: string; detail?: string };

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const NUMBER_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** Number from a number or numeric string ("42000", "1,250.5"); null otherwise. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Timestamp (ms) from a JS timestamp or a parseable date string; null otherwise. */
function toTimestamp(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    if (/^-?\d+$/.test(v.trim())) return Number(v.trim());
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function formatNumber(v: number): string {
  return NUMBER_FORMAT.format(v);
}

/** Compact axis label: 1500 -> "1.5K", 2000000 -> "2M". */
export function formatCompact(v: number): string {
  const abs = Math.abs(v);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${Number((v / size).toFixed(1))}${suffix}`;
  }
  return formatNumber(v);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : DATE_FORMAT.format(d);
}

/** "Nice" axis ticks covering [min, max] with roughly `count` intervals (steps of 1, 2, 2.5, 5 x 10^n). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) {
    if (lo === 0) hi = 1;
    else {
      const pad = Math.abs(lo) * 0.5;
      lo -= pad;
      hi += pad;
    }
  }
  const rawStep = (hi - lo) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const decimals = Math.min(12, Math.max(0, 2 - Math.floor(Math.log10(step))));
  const ticks: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const v = start + i * step;
    if (v > end + step * 1e-6) break;
    ticks.push(Number(v.toFixed(decimals)));
  }
  return ticks;
}

function readAxis(v: unknown): ChartAxisModel | null {
  if (!isRecord(v) || typeof v.field !== 'string' || v.field.trim() === '') return null;
  const label = typeof v.label === 'string' && v.label.trim() !== '' ? v.label : v.field;
  return { field: v.field, fieldType: oneOf(v.fieldType, FIELD_TYPES, 'category'), label };
}

/**
 * Turns HubSpot chart props (`data`, `axes`, `options`) into a render model. Never throws: invalid
 * shapes produce `{ ok: false }` with a user-facing explanation.
 */
export function buildChartModel(data: unknown, axes: unknown, options: unknown, kind: 'bar' | 'line'): ChartModelResult {
  // data: ChartDataRow[] | { data: ChartDataRow[]; options?: { propertyLabels } }
  let source = data;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      source = undefined;
    }
  }
  let rows: unknown[];
  let propertyLabels: Record<string, unknown> = {};
  if (Array.isArray(source)) rows = source;
  else if (isRecord(source) && Array.isArray(source.data)) {
    rows = source.data;
    if (isRecord(source.options) && isRecord(source.options.propertyLabels)) propertyLabels = source.options.propertyLabels;
  } else {
    return {
      ok: false,
      title: 'Chart data is invalid',
      detail: 'Data must be an array of rows, e.g. [{ "month": "Jan", "amount": 42000 }].',
    };
  }

  const axisPair = isRecord(axes) ? axes : {};
  const x = readAxis(axisPair.x);
  const y = readAxis(axisPair.y);
  if (!x || !y) {
    return {
      ok: false,
      title: 'Chart axes are not configured',
      detail: 'Set the x and y axis fields to fields of your data rows.',
    };
  }

  const records = rows.filter(isRecord);
  if (records.length === 0) return { ok: false, title: 'No data to display' };

  /** Applies data.options.propertyLabels[field][value] relabeling. */
  const relabel = (field: string, raw: string): string => {
    const map = own(propertyLabels, field);
    const label = isRecord(map) ? own(map, raw) : undefined;
    return typeof label === 'string' ? label : raw;
  };

  const axisOptions = isRecord(axisPair.options) ? axisPair.options : {};
  const groupField =
    typeof axisOptions.groupFieldByColor === 'string' && axisOptions.groupFieldByColor.trim() !== ''
      ? axisOptions.groupFieldByColor
      : null;

  const categories: ChartCategory[] = [];
  const categoryIndex = new Map<string, number>();
  const seriesOrder: string[] = [];
  const sums = new Map<string, Map<number, number>>();
  let sawX = false;

  for (const row of records) {
    const rawX = own(row, x.field);
    if (rawX === undefined || rawX === null || typeof rawX === 'object') continue;
    sawX = true;
    const value = toNumber(own(row, y.field));
    if (value === null) continue;

    const key = String(rawX);
    let ci = categoryIndex.get(key);
    if (ci === undefined) {
      const position = x.fieldType === 'datetime' ? toTimestamp(rawX) : x.fieldType === 'linear' ? toNumber(rawX) : null;
      let label = relabel(x.field, key);
      if (label === key && position !== null) label = x.fieldType === 'datetime' ? formatDate(position) : formatNumber(position);
      ci = categories.length;
      categories.push({ key, label, position });
      categoryIndex.set(key, ci);
    }

    const rawGroup = groupField ? own(row, groupField) : undefined;
    const seriesKey = groupField ? (rawGroup === undefined || rawGroup === null ? '' : String(rawGroup)) : '';
    let perCategory = sums.get(seriesKey);
    if (!perCategory) {
      perCategory = new Map();
      sums.set(seriesKey, perCategory);
      seriesOrder.push(seriesKey);
    }
    perCategory.set(ci, (perCategory.get(ci) ?? 0) + value);
  }

  if (categories.length === 0) {
    return sawX
      ? {
          ok: false,
          title: `No numeric values in "${y.field}"`,
          detail: 'The y axis field must hold numbers in your data rows.',
        }
      : { ok: false, title: `No values for "${x.field}"`, detail: 'The x axis field must exist in your data rows.' };
  }

  // Colors: options.colorList (or the deprecated options.colors) first, then HubSpot's default order;
  // axes.options.colors pins a color to a specific group value.
  const chartOptions = isRecord(options) ? options : {};
  const preferred = Array.isArray(chartOptions.colorList)
    ? chartOptions.colorList
    : Array.isArray(chartOptions.colors)
      ? chartOptions.colors
      : [];
  const palette = [...new Set([...preferred.filter(isChartColor), ...CHART_COLOR_NAMES])];
  const pinned = isRecord(axisOptions.colors) ? axisOptions.colors : {};

  const series: ChartSeries[] = seriesOrder.map((key, i) => {
    const perCategory = sums.get(key) ?? new Map<number, number>();
    const pin = own(pinned, key);
    const colorName = isChartColor(pin) ? pin : palette[i % palette.length];
    return {
      key,
      name: groupField ? relabel(groupField, key) || '(empty)' : y.label,
      color: CHART_COLORS[colorName],
      values: categories.map((_, ci) => perCategory.get(ci) ?? null),
    };
  });

  const continuousX = kind === 'line' && x.fieldType !== 'category' && categories.every((c) => c.position !== null);
  return {
    ok: true,
    model: { x, y, categories, series, stacking: bool(axisOptions.stacking) && groupField !== null, continuousX },
  };
}

// ---------------------------------------------------------------------------
// Chart rendering
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 300;
/** Width used before the plot has been measured (and in environments without layout). */
const FALLBACK_WIDTH = 560;
/** Matches `.hsp-chart-plot { min-width }`. */
const MIN_WIDTH = 200;
/** Approximate advance of one 12px character, used to reserve room for axis labels. */
const CHAR_WIDTH = 6.8;
const MAX_LABEL_CHARS = 18;
/** Degrees x labels are rotated by when they do not fit their band. */
const LABEL_ROTATION = 38;

function truncateLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

/** Tracks an element's content width (ResizeObserver when available). 0 until measured. */
function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

interface HoverPoint {
  x: number;
  y: number;
  categoryIndex: number;
  seriesIndex: number;
}

interface PlotGeometry {
  width: number;
  height: number;
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  yScale: (v: number) => number;
  /** Center x of a category (band center, or continuous position for line charts). */
  xOf: (categoryIndex: number) => number;
  /** Band width per category (categorical x). */
  band: number;
}

/** Cumulative series values for stacking (null data points contribute 0). */
function stackedValues(model: ChartModel): Array<Array<{ base: number; top: number } | null>> {
  const pos = model.categories.map(() => 0);
  const neg = model.categories.map(() => 0);
  return model.series.map((s) =>
    s.values.map((v, ci) => {
      if (v === null) return null;
      const base = v >= 0 ? pos[ci] : neg[ci];
      const top = base + v;
      if (v >= 0) pos[ci] = top;
      else neg[ci] = top;
      return { base, top };
    }),
  );
}

/** Value range to plot (always includes 0 so bars and lines share a zero baseline). */
function valueExtent(model: ChartModel, stacks: ReturnType<typeof stackedValues> | null): [number, number] {
  const values = stacks
    ? stacks.flatMap((segments) => segments.flatMap((seg) => (seg ? [seg.top] : [])))
    : model.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  return [Math.min(0, ...values), Math.max(0, ...values)];
}

interface ChartSvgProps {
  kind: 'bar' | 'line';
  model: ChartModel;
  width: number;
  showDataLabels: boolean;
  ariaLabel: string;
  onHover: ((point: HoverPoint | null) => void) | null;
}

function ChartSvg({ kind, model, width, showDataLabels, ariaLabel, onHover }: ChartSvgProps) {
  const stacks = model.stacking && model.series.length > 1 ? stackedValues(model) : null;
  const [vMin, vMax] = valueExtent(model, stacks);
  const yTicks = niceTicks(vMin, vMax, 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];
  const yTickLabels = yTicks.map(formatCompact);

  // Room for the y axis title (22px) and the widest y tick label.
  let left = 8 + Math.max(...yTickLabels.map((l) => l.length)) * CHAR_WIDTH + 8 + 22;
  const right = 16;
  let plotW = Math.max(40, width - left - right);
  const n = model.categories.length;
  let band = plotW / n;

  // X axis labels / ticks.
  let xTickItems: Array<{ x: number; label: string }>;
  let rotate = false;
  let xLabelSpace = 22;
  const continuous = kind === 'line' && model.continuousX;
  let xOf: (ci: number) => number;
  if (!continuous) {
    const widest = Math.max(...model.categories.map((c) => truncateLabel(c.label).length)) * CHAR_WIDTH;
    rotate = widest > band - 6;
    if (rotate) {
      // Rotated labels hang down-left from their tick; make sure the first one stays inside.
      const overhang = Math.min(widest, 120) * Math.cos((LABEL_ROTATION * Math.PI) / 180) - band / 2 + 4;
      if (overhang > left) {
        left = overhang;
        plotW = Math.max(40, width - left - right);
        band = plotW / n;
      }
    }
  }
  if (continuous) {
    const positions = model.categories.map((c) => c.position ?? 0);
    const pMin = Math.min(...positions);
    const pMax = Math.max(...positions);
    let domain: [number, number];
    let ticks: number[];
    if (model.x.fieldType === 'linear') {
      ticks = niceTicks(pMin, pMax, Math.max(2, Math.min(6, Math.floor(plotW / 90))));
      domain = [ticks[0], ticks[ticks.length - 1]];
    } else if (pMin === pMax) {
      ticks = [pMin];
      domain = [pMin - 864e5, pMax + 864e5];
    } else {
      const count = Math.max(2, Math.min(5, new Set(positions).size, Math.floor(plotW / 110)));
      ticks = Array.from({ length: count }, (_, i) => pMin + ((pMax - pMin) * i) / (count - 1));
      domain = [pMin, pMax];
    }
    const pad = 12;
    const scale = (v: number) => left + pad + ((v - domain[0]) / (domain[1] - domain[0] || 1)) * (plotW - pad * 2);
    xOf = (ci) => scale(positions[ci]);
    xTickItems = ticks.map((t) => ({
      x: scale(t),
      label: model.x.fieldType === 'datetime' ? formatDate(t) : formatCompact(t),
    }));
  } else {
    const plotLeft = left;
    const bandW = band;
    xOf = (ci) => plotLeft + bandW * (ci + 0.5);
    const labels = model.categories.map((c) => truncateLabel(c.label));
    const widest = Math.max(...labels.map((l) => l.length)) * CHAR_WIDTH;
    // When rotated, keep at least ~16px between labels by skipping some.
    const every = rotate ? Math.max(1, Math.ceil(16 / band)) : 1;
    if (rotate) xLabelSpace = Math.min(widest, 120) * Math.sin((LABEL_ROTATION * Math.PI) / 180) + 14;
    xTickItems = labels.flatMap((label, ci) => (ci % every === 0 ? [{ x: xOf(ci), label }] : []));
  }

  const top = showDataLabels ? 24 : 12;
  const bottom = 8 + xLabelSpace + 22;
  const height = CHART_HEIGHT;
  const plotH = Math.max(40, height - top - bottom);
  const yScale = (v: number) => top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  const geo: PlotGeometry = { width, height, left, top, plotW, plotH, yScale, xOf, band };
  const baseline = top + plotH;

  return (
    <svg className="hsp-chart-svg" width={width} height={height} role="img" aria-label={ariaLabel}>
      <g className="hsp-chart-grid">
        {yTicks.map((t) => (
          <line key={t} x1={left} x2={left + plotW} y1={yScale(t)} y2={yScale(t)} className={t === 0 ? 'hsp-chart-zero' : undefined} />
        ))}
      </g>
      <g className="hsp-chart-axis-labels">
        {yTicks.map((t, i) => (
          <text key={t} x={left - 8} y={yScale(t)} dy="0.32em" textAnchor="end">
            {yTickLabels[i]}
          </text>
        ))}
        {xTickItems.map((tick, i) =>
          rotate ? (
            <text
              key={i}
              x={tick.x}
              y={baseline + 14}
              textAnchor="end"
              transform={`rotate(-${LABEL_ROTATION} ${tick.x} ${baseline + 14})`}
            >
              {tick.label}
            </text>
          ) : (
            <text key={i} x={tick.x} y={baseline + 18} textAnchor="middle">
              {tick.label}
            </text>
          ),
        )}
      </g>
      <line className="hsp-chart-baseline" x1={left} x2={left + plotW} y1={baseline} y2={baseline} />
      <g className="hsp-chart-axis-titles">
        <text x={left + plotW / 2} y={height - 8} textAnchor="middle">
          {model.x.label}
        </text>
        <text x={14} y={top + plotH / 2} textAnchor="middle" transform={`rotate(-90 14 ${top + plotH / 2})`}>
          {model.y.label}
        </text>
      </g>
      {kind === 'bar' ? (
        <BarMarks model={model} geo={geo} stacks={stacks} showDataLabels={showDataLabels} onHover={onHover} />
      ) : (
        <LineMarks model={model} geo={geo} stacks={stacks} showDataLabels={showDataLabels} onHover={onHover} />
      )}
    </svg>
  );
}

interface MarksProps {
  model: ChartModel;
  geo: PlotGeometry;
  stacks: ReturnType<typeof stackedValues> | null;
  showDataLabels: boolean;
  onHover: ((point: HoverPoint | null) => void) | null;
}

function BarMarks({ model, geo, stacks, showDataLabels, onHover }: MarksProps) {
  const { band, yScale } = geo;
  const seriesCount = model.series.length;
  const bars: ReactNode[] = [];
  const labels: ReactNode[] = [];

  model.categories.forEach((_, ci) => {
    const bandLeft = geo.left + band * ci;
    if (stacks) {
      const barW = Math.max(2, Math.min(band * 0.6, 56));
      const x = bandLeft + (band - barW) / 2;
      stacks.forEach((segments, si) => {
        const seg = segments[ci];
        if (!seg) return;
        const y1 = yScale(Math.max(seg.base, seg.top));
        const h = Math.abs(yScale(seg.base) - yScale(seg.top));
        const value = model.series[si].values[ci] ?? 0;
        bars.push(
          <rect
            key={`${si}-${ci}`}
            className="hsp-chart-bar"
            x={x}
            y={y1}
            width={barW}
            height={h}
            fill={model.series[si].color}
            onMouseEnter={onHover ? () => onHover({ x: x + barW / 2, y: y1, categoryIndex: ci, seriesIndex: si }) : undefined}
          />,
        );
        const text = formatCompact(value);
        if (showDataLabels && h >= 16 && text.length * CHAR_WIDTH <= barW + 4) {
          labels.push(
            <text key={`l${si}-${ci}`} className="hsp-chart-data-label hsp-chart-data-label-inside" x={x + barW / 2} y={y1 + h / 2} dy="0.35em" textAnchor="middle">
              {text}
            </text>,
          );
        }
      });
      return;
    }
    const groupW = Math.max(2, Math.min(band * 0.72, seriesCount * 44));
    const slot = groupW / seriesCount;
    const gap = seriesCount > 1 ? Math.min(2, slot * 0.15) : 0;
    model.series.forEach((s, si) => {
      const v = s.values[ci];
      if (v === null) return;
      const x = bandLeft + (band - groupW) / 2 + slot * si + gap / 2;
      const barW = Math.max(1, slot - gap);
      const y0 = yScale(0);
      const yv = yScale(v);
      const y1 = Math.min(y0, yv);
      bars.push(
        <rect
          key={`${si}-${ci}`}
          className="hsp-chart-bar"
          x={x}
          y={y1}
          width={barW}
          height={Math.abs(y0 - yv)}
          fill={s.color}
          onMouseEnter={onHover ? () => onHover({ x: x + barW / 2, y: yv, categoryIndex: ci, seriesIndex: si }) : undefined}
        />,
      );
      if (showDataLabels) {
        labels.push(
          <text key={`l${si}-${ci}`} className="hsp-chart-data-label" x={x + barW / 2} y={v >= 0 ? yv - 6 : yv + 14} textAnchor="middle">
            {formatCompact(v)}
          </text>,
        );
      }
    });
  });

  return (
    <g className="hsp-chart-marks">
      {bars}
      {labels}
    </g>
  );
}

function LineMarks({ model, geo, stacks, showDataLabels, onHover }: MarksProps) {
  const { xOf, yScale } = geo;
  const showMarkers = model.categories.length <= 40;
  return (
    <g className="hsp-chart-marks">
      {model.series.map((s, si) => {
        // Plotted value per category: the stack top when stacking, else the raw value.
        const plotted = s.values.map((v, ci) => (stacks ? stacks[si][ci]?.top ?? null : v));
        let d = '';
        let penDown = false;
        plotted.forEach((v, ci) => {
          if (v === null) {
            penDown = false;
            return;
          }
          d += `${penDown ? 'L' : 'M'}${xOf(ci).toFixed(2)},${yScale(v).toFixed(2)}`;
          penDown = true;
        });

        // Stacked lines fill the band between this series and the one below it.
        let area: ReactNode = null;
        if (stacks) {
          const idx = plotted.map((v, ci) => (v === null ? -1 : ci)).filter((ci) => ci >= 0);
          if (idx.length > 1) {
            const upper = idx.map((ci) => `${xOf(ci).toFixed(2)},${yScale(stacks[si][ci]?.top ?? 0).toFixed(2)}`);
            const lower = [...idx].reverse().map((ci) => `${xOf(ci).toFixed(2)},${yScale(stacks[si][ci]?.base ?? 0).toFixed(2)}`);
            area = <polygon className="hsp-chart-area" points={[...upper, ...lower].join(' ')} fill={s.color} />;
          }
        }

        return (
          <g key={s.key || si} className="hsp-chart-series">
            {area}
            {d && <path className="hsp-chart-line" d={d} stroke={s.color} />}
            {plotted.map((v, ci) => {
              if (v === null) return null;
              const cx0 = xOf(ci);
              const cy0 = yScale(v);
              const raw = s.values[ci] ?? 0;
              return (
                <g key={ci}>
                  {showMarkers && <circle className="hsp-chart-point" cx={cx0} cy={cy0} r={3.5} fill={s.color} />}
                  {onHover && (
                    <circle
                      className="hsp-chart-hit"
                      cx={cx0}
                      cy={cy0}
                      r={10}
                      onMouseEnter={() => onHover({ x: cx0, y: cy0, categoryIndex: ci, seriesIndex: si })}
                    />
                  )}
                  {showDataLabels && (
                    <text className="hsp-chart-data-label" x={cx0} y={cy0 - 9} textAnchor="middle">
                      {formatCompact(raw)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function ChartEmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="hsp-chart-empty" style={{ height: CHART_HEIGHT }}>
      <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden="true" className="hsp-chart-empty-art">
        <line x1="4" y1="40" x2="52" y2="40" />
        <rect x="9" y="24" width="8" height="16" rx="1" />
        <rect x="21" y="14" width="8" height="26" rx="1" />
        <rect x="33" y="20" width="8" height="20" rx="1" />
        <rect x="45" y="8" width="6" height="32" rx="1" />
      </svg>
      <div className="hsp-chart-empty-title">{title}</div>
      {detail && <div className="hsp-chart-empty-detail">{detail}</div>}
    </div>
  );
}

function ChartPreview({ kind, preview }: { kind: 'bar' | 'line'; preview: PreviewProps }) {
  const { props, rootProps, mode } = preview;
  const options = isRecord(props.options) ? props.options : {};
  const title = str(options.title);
  const showLegend = bool(options.showLegend);
  const showDataLabels = bool(options.showDataLabels);
  const showTooltips = bool(options.showTooltips) && mode === 'preview';

  const result = useMemo(
    () => buildChartModel(props.data, props.axes, props.options, kind),
    [props.data, props.axes, props.options, kind],
  );
  const plotRef = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(plotRef);
  const width = Math.max(MIN_WIDTH, measured || FALLBACK_WIDTH);
  const [hover, setHover] = useState<HoverPoint | null>(null);

  const model = result.ok ? result.model : null;
  // Resolve the hovered point against the current model (it may have changed since the hover).
  const tooltip = (() => {
    if (!showTooltips || !model || !hover) return null;
    const series = model.series[hover.seriesIndex];
    const category = model.categories[hover.categoryIndex];
    const value = series?.values[hover.categoryIndex];
    if (!series || !category || typeof value !== 'number') return null;
    return { series, category, value };
  })();

  return (
    <div {...rootProps} className={cx('hsp-chart', `hsp-chart-${kind}`, rootProps.className)}>
      {title && <div className="hsp-chart-title">{title}</div>}
      {model && showLegend && (
        <div className="hsp-chart-legend">
          {model.series.map((s, si) => (
            <span key={s.key || si} className="hsp-chart-legend-item">
              <span className={cx('hsp-chart-swatch', kind === 'line' && 'hsp-chart-swatch-line')} style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div ref={plotRef} className="hsp-chart-plot" onMouseLeave={showTooltips ? () => setHover(null) : undefined}>
        {result.ok ? (
          <ChartSvg
            kind={kind}
            model={result.model}
            width={width}
            showDataLabels={showDataLabels}
            ariaLabel={title || (kind === 'bar' ? 'Bar chart' : 'Line chart')}
            onHover={showTooltips ? setHover : null}
          />
        ) : (
          <ChartEmptyState title={result.title} detail={result.detail} />
        )}
        {tooltip && hover && (
          <div
            className="hsp-chart-tooltip"
            role="tooltip"
            style={{ left: Math.min(Math.max(hover.x, 70), width - 70), top: hover.y }}
          >
            <div className="hsp-chart-tooltip-title">{tooltip.category.label}</div>
            <div className="hsp-chart-tooltip-row">
              <span className="hsp-chart-swatch" style={{ background: tooltip.series.color }} />
              <span>{tooltip.series.name}:</span>
              <strong>{formatNumber(tooltip.value)}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BarChartPreview(p: PreviewProps) {
  return <ChartPreview kind="bar" preview={p} />;
}

function LineChartPreview(p: PreviewProps) {
  return <ChartPreview kind="line" preview={p} />;
}

// ---------------------------------------------------------------------------
// Chart definitions
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

/** Closed-won deal amounts per month (BarChart default). */
const BAR_SAMPLE_DATA: JsonValue = [42000, 38500, 51200, 46800, 58300, 63900].map((amount, i) => ({
  month: MONTHS[i],
  amount,
}));

/** Monthly revenue this year vs last year, grouped by `period` (LineChart default). */
const LINE_SAMPLE_DATA: JsonValue = MONTHS.flatMap((month, i) => [
  { month, revenue: [52000, 48500, 61000, 58800, 67400, 72900][i], period: 'This year' },
  { month, revenue: [41000, 43500, 47200, 45100, 52600, 55300][i], period: 'Last year' },
]);

const FIELD_TYPE_OPTIONS: EnumOption[] = [
  { value: 'category', label: 'Category' },
  { value: 'datetime', label: 'Date / time' },
  { value: 'linear', label: 'Linear (number)' },
];

const COLOR_NAMES_TEXT = CHART_COLOR_NAMES.join(', ');

function axisField(axis: 'x' | 'y'): PropDef {
  const orientation = axis === 'x' ? 'horizontal' : 'vertical';
  return {
    name: axis,
    label: `${axis.toUpperCase()} axis`,
    required: true,
    description: `The field graphed on the ${orientation} ${axis}-axis.`,
    type: {
      kind: 'object',
      fields: [
        {
          name: 'field',
          label: 'Field',
          type: { kind: 'string', placeholder: axis === 'x' ? 'e.g. month' : 'e.g. amount' },
          required: true,
          description: 'The field of your data rows to graph on this axis.',
        },
        {
          name: 'fieldType',
          label: 'Field type',
          type: { kind: 'enum', options: FIELD_TYPE_OPTIONS },
          required: true,
          description:
            'category for categorical data (e.g. stages, months), datetime for dates / JS timestamps, linear for numbers.',
        },
        {
          name: 'label',
          label: 'Label',
          type: { kind: 'string' },
          description: 'The axis label, also used in the legend and tooltips. Defaults to the field name.',
        },
      ],
    },
  };
}

function chartProps(noun: 'bars' | 'lines', sample: JsonValue): PropDef[] {
  return [
    {
      name: 'data',
      label: 'Data',
      type: {
        kind: 'json',
        template: sample,
        hint: 'An array of rows such as [{ "month": "Jan", "amount": 42000 }], displayed in the order given. Also accepts { "data": [...], "options": { "propertyLabels": { "field": { "value": "Label" } } } }.',
      },
      required: true,
      group: 'Data',
      description: 'The rows to chart: objects of field/value pairs (numbers or strings).',
    },
    {
      name: 'axes',
      label: 'Axes',
      required: true,
      group: 'Data',
      description: 'Which data fields the x and y axes show, plus optional grouping by color and stacking.',
      type: {
        kind: 'object',
        fields: [
          axisField('x'),
          axisField('y'),
          {
            name: 'options',
            label: 'Axis options',
            description: 'Group data by a field (one color per value) and optionally stack the groups.',
            type: {
              kind: 'object',
              fields: [
                {
                  name: 'groupFieldByColor',
                  label: 'Group by color',
                  type: { kind: 'string', placeholder: 'e.g. pipeline' },
                  description: 'A data field whose values are drawn in different colors.',
                },
                {
                  name: 'stacking',
                  label: 'Stacking',
                  type: { kind: 'boolean' },
                  defaultValue: false,
                  description: `Stack grouped data instead of rendering separate ${noun}.`,
                },
                {
                  name: 'colors',
                  label: 'Colors per value',
                  type: {
                    kind: 'json',
                    template: { 'Group value': 'orange' },
                    hint: `Maps values of the group-by field to chart colors: ${COLOR_NAMES_TEXT}.`,
                  },
                  description: 'Assign a specific chart color to values of the group-by field.',
                },
              ],
            },
          },
        ],
      },
    },
    {
      name: 'options',
      label: 'Chart options',
      group: 'Appearance',
      description: 'Title, legend, data labels, tooltips and color order.',
      type: {
        kind: 'object',
        fields: [
          { name: 'title', label: 'Title', type: { kind: 'string' }, description: 'A title rendered above the chart.' },
          {
            name: 'showLegend',
            label: 'Show legend',
            type: { kind: 'boolean' },
            defaultValue: false,
            description: 'Display a legend above the chart.',
          },
          {
            name: 'showDataLabels',
            label: 'Show data labels',
            type: { kind: 'boolean' },
            defaultValue: false,
            description: 'Display value labels directly on the data points.',
          },
          {
            name: 'showTooltips',
            label: 'Show tooltips',
            type: { kind: 'boolean' },
            defaultValue: false,
            description: 'Display tooltips when hovering over data points.',
          },
          {
            name: 'colorList',
            label: 'Color order',
            // Typed ChartColor[]: only the named chart colors are valid items.
            type: { kind: 'stringList', placeholder: 'e.g. aqua', options: CHART_COLOR_NAMES.map((value) => ({ value })) },
            description: `The order in which chart colors are assigned to your data. Allowed: ${COLOR_NAMES_TEXT}.`,
          },
        ],
      },
    },
    TEST_ID_PROP,
  ];
}

const chartComponents: ComponentDef[] = [
  {
    type: 'BarChart',
    label: 'Bar chart',
    category: 'Charts',
    description: 'A bar chart, best suited for comparing categorical data. Group by a field for colored or stacked bars.',
    icon: ChartColumn,
    docsUrl: `${STANDARD_DOCS}/charts/bar-chart`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['chart', 'graph', 'column', 'histogram', 'report', 'visualization', 'data viz', 'compare'],
    children: { mode: 'none' },
    create: () => ({
      type: 'BarChart',
      props: {
        data: BAR_SAMPLE_DATA,
        axes: {
          x: { field: 'month', fieldType: 'category', label: 'Month' },
          y: { field: 'amount', fieldType: 'linear', label: 'Closed won ($)' },
        },
        options: { title: 'Closed won by month', showTooltips: true },
      },
    }),
    props: chartProps('bars', BAR_SAMPLE_DATA),
    preview: BarChartPreview,
  },
  {
    type: 'LineChart',
    label: 'Line chart',
    category: 'Charts',
    description: 'A line chart, best suited for time series and trends. Group by a field to compare several lines.',
    icon: ChartLine,
    docsUrl: `${STANDARD_DOCS}/charts/line-chart`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['chart', 'graph', 'trend', 'time series', 'report', 'visualization', 'data viz', 'over time'],
    children: { mode: 'none' },
    create: () => ({
      type: 'LineChart',
      props: {
        data: LINE_SAMPLE_DATA,
        axes: {
          x: { field: 'month', fieldType: 'category', label: 'Month' },
          y: { field: 'revenue', fieldType: 'linear', label: 'Revenue ($)' },
          options: { groupFieldByColor: 'period' },
        },
        options: { title: 'Revenue trend', showLegend: true, showTooltips: true },
      },
    }),
    props: chartProps('lines', LINE_SAMPLE_DATA),
    preview: LineChartPreview,
  },
];

export const overlayChartComponents: ComponentDef[] = [...overlayComponents, ...chartComponents];
