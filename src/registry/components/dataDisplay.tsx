/**
 * Tables, data display and feedback components:
 *   Tables            Table, TableHead, TableBody, TableFooter, TableRow, TableHeader, TableCell
 *   Data display      DescriptionList, DescriptionListItem, Statistics, StatisticsItem,
 *                     StatisticsTrend, ProgressBar, ScoreCircle, StepIndicator
 *   Feedback & status Alert, EmptyState, ErrorState, LoadingSpinner
 *
 * See text.tsx for the reference conventions (exact @hubspot/ui-extensions prop names, inspector
 * metadata, previews that spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/components/
 *   table, description-list, statistics, progress-bar, score, step-indicator, alert, empty-state,
 *   error-state, loading-spinner (.synced.d.ts).
 *
 * Table previews render real <table>/<thead>/<tbody>/<tfoot>/<tr>/<th>/<td> elements with
 * `rootProps` on each, so canvas selection outlines line up with rows and cells. Structure-aware
 * fallbacks keep the DOM valid when a part is rendered out of place (see `useTablePlacement`).
 */
import { Children, createContext, createElement, useContext, useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BlocksIcon,
  BoxesIcon,
  BoxIcon,
  Building2Icon,
  CalendarDaysIcon,
  ChartColumnIcon,
  ChartColumnIncreasingIcon,
  ChartNoAxesColumnIncreasingIcon,
  ChevronFirstIcon,
  ChevronLastIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleGaugeIcon,
  ClipboardListIcon,
  CodeIcon,
  ContactIcon,
  FlaskConicalIcon,
  GitCommitHorizontalIcon,
  GoalIcon,
  HandshakeIcon,
  HashIcon,
  HeadingIcon,
  HeadsetIcon,
  LayersIcon,
  LayoutListIcon,
  LightbulbIcon,
  LoaderCircleIcon,
  LockIcon,
  MailCheckIcon,
  MailOpenIcon,
  MegaphoneIcon,
  PackageOpenIcon,
  PanelBottomIcon,
  PanelTopIcon,
  PlugIcon,
  RocketIcon,
  Rows3Icon,
  ServerCrashIcon,
  Share2Icon,
  ShapesIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  SignatureIcon,
  SlidersHorizontalIcon,
  SmileIcon,
  SquareCheckBigIcon,
  StoreIcon,
  Table2Icon,
  TableCellsMergeIcon,
  TableRowsSplitIcon,
  TargetIcon,
  TextQuoteIcon,
  TicketIcon,
  TrafficConeIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
  VoteIcon,
} from 'lucide-react';
import type { ChildrenDef, ComponentDef, EnumOption, EventDef, PreviewProps, PreviewRootProps, PropDef } from '../types';
import { ALERT_VARIANTS, HS_SWATCH, SIZE_ALL, SIZE_XS_MD, STANDARD_DOCS, enumOptions } from '../constants';
import type { NodeTemplate, PropValue, UINode } from '../../model/types';
import { cx, normalizeSize, str, usePreviewValue } from '../../preview/util';
import '../../preview/styles/dataDisplay.css';

// ---------------------------------------------------------------------------
// Shared definition pieces
// ---------------------------------------------------------------------------

const TEST_ID_PROP: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

const TABLE_DOCS = `${STANDARD_DOCS}/table`;
const STATISTICS_DOCS = `${STANDARD_DOCS}/statistics`;
const DESCRIPTION_LIST_DOCS = `${STANDARD_DOCS}/description-list`;

// ---------------------------------------------------------------------------
// Defensive prop readers (props may come from arbitrary user expressions)
// ---------------------------------------------------------------------------

/** Boolean prop: true only for `true` (or the string 'true' produced by text templates). */
function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

/** Boolean prop with a HubSpot default that applies when the prop is absent (undefined/null). */
function boolOr(v: unknown, fallback: boolean): boolean {
  return v === undefined || v === null ? fallback : bool(v);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Finite number from a number or numeric string (templates may yield strings); else undefined. */
function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Positive integer (>= 1) or undefined. */
function posInt(v: unknown): number | undefined {
  const n = num(v);
  return n !== undefined && n >= 1 ? Math.floor(n) : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hasEvent(node: UINode, name: string): boolean {
  return (node.events?.[name]?.length ?? 0) > 0;
}

/** Own-property lookup so names like "constructor" never resolve to Object.prototype members. */
function lookup<V>(table: Record<string, V>, key: unknown): V | undefined {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** 'electronicSignatureEmptyState' -> 'Electronic signature empty state'. */
/** Alert colors in plain words (the values stay HubSpot's). */
const ALERT_LABELS: Record<string, string> = {
  info: 'Blue (info)',
  warning: 'Yellow (warning)',
  success: 'Green (success)',
  error: 'Red (error)',
  danger: 'Red (danger)',
  tip: 'Purple (tip)',
};

function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------
// Template helpers for create()
// ---------------------------------------------------------------------------

const textNode = (value: string): NodeTemplate => ({ type: 'Text', text: value });

function tableCell(value: string, props?: Record<string, PropValue>): NodeTemplate {
  return { type: 'TableCell', ...(props ? { props } : {}), children: [textNode(value)] };
}

function tableHeader(label: string, props?: Record<string, PropValue>): NodeTemplate {
  return { type: 'TableHeader', ...(props ? { props } : {}), text: label };
}

function tableRow(...cells: NodeTemplate[]): NodeTemplate {
  return { type: 'TableRow', children: cells };
}

function descriptionItem(label: string, value: string): NodeTemplate {
  return { type: 'DescriptionListItem', props: { label }, children: [textNode(value)] };
}

function statisticsItem(label: string, number: string | number, trend: NodeTemplate): NodeTemplate {
  return { type: 'StatisticsItem', props: { label, number }, children: [trend] };
}

function statisticsTrend(direction: 'increase' | 'decrease', value: string): NodeTemplate {
  return { type: 'StatisticsTrend', props: { value, direction } };
}

// ---------------------------------------------------------------------------
// Table structure
// ---------------------------------------------------------------------------

/**
 * Where we are in a table's DOM: 'none' = normal flow (outside a table or inside a cell),
 * 'table' = direct child of <table>, 'section' = inside thead/tbody/tfoot, 'row' = inside <tr>.
 */
type TableLevel = 'none' | 'table' | 'section' | 'row';
type WrapperTag = 'table' | 'tbody' | 'tr' | 'td';
type TableSection = 'head' | 'body' | 'footer';
type TableDensity = 'default' | 'condensed' | 'compact';

interface TableSettings {
  density: TableDensity;
  bordered: boolean;
}

const TableLevelContext = createContext<TableLevel>('none');
const TableSectionContext = createContext<TableSection | null>(null);
const TableSettingsContext = createContext<TableSettings>({ density: 'default', bordered: true });

/** The element that moves the DOM one structural level deeper, and the level it leads to. */
const LEVEL_STEP: Record<TableLevel, { tag: WrapperTag; next: TableLevel }> = {
  none: { tag: 'table', next: 'table' },
  table: { tag: 'tbody', next: 'section' },
  section: { tag: 'tr', next: 'row' },
  row: { tag: 'td', next: 'none' },
};

const WRAPPER_CLASS: Record<WrapperTag, string> = {
  table: 'hsp-table hsp-table-standalone',
  tbody: 'hsp-tbody',
  tr: 'hsp-tr',
  td: 'hsp-table-slot-cell',
};

/** Wrapper cells span "all" columns; empty extra columns collapse to zero width. */
const SPAN_ALL = 100;

/** Wrapper tags (outermost first) needed to get from level `from` to level `to`. */
function wrapperTags(from: TableLevel, to: TableLevel): WrapperTag[] {
  const tags: WrapperTag[] = [];
  for (let level = from; level !== to; level = LEVEL_STEP[level].next) tags.push(LEVEL_STEP[level].tag);
  return tags;
}

/** Nests `content` in `tags` (outermost first); the outermost wrapper receives `outerProps`. */
function nest(tags: WrapperTag[], content: ReactNode, outerProps?: PreviewRootProps): ReactNode {
  return tags.reduceRight<ReactNode>((inner, tag, index) => {
    const extra = index === 0 ? outerProps : undefined;
    return createElement(
      tag,
      { ...extra, className: cx(WRAPPER_CLASS[tag], extra?.className), colSpan: tag === 'td' ? SPAN_ALL : undefined },
      inner,
    );
  }, content);
}

/**
 * Places a table element that must live at structural level `needs` (e.g. a <tr> needs 'section').
 * When rendered elsewhere (a TableRow outside a table section, a Table inside a row...), minimal
 * table/tbody/tr/td wrappers keep the DOM valid and `rootProps` move to the outermost wrapper, so
 * the node's root is always its outermost element.
 */
function useTablePlacement(needs: TableLevel, rootProps: PreviewRootProps) {
  const level = useContext(TableLevelContext);
  const tags = wrapperTags(level, needs);
  const direct = tags.length === 0;
  return {
    /** Root props for the element itself ({} when a wrapper carries them). */
    own: (direct ? rootProps : {}) as Partial<PreviewRootProps>,
    place: (element: ReactElement): ReactElement => (direct ? element : <>{nest(tags, element, rootProps)}</>),
  };
}

/**
 * Content of a table container whose children must sit at `inner` level. An empty container only
 * receives the design-mode drop placeholder (a <div>), which is wrapped in cells to stay valid.
 */
function tableContainerContent(inner: TableLevel, node: UINode, children: ReactNode): ReactNode {
  if (node.children.length > 0 || Children.count(children) === 0) return children;
  return nest(wrapperTags(inner, 'none'), children);
}

/** Children of a cell are regular flow content: reset the table structure contexts. */
function CellContent({ children }: { children: ReactNode }) {
  return (
    <TableLevelContext.Provider value="none">
      <TableSectionContext.Provider value={null}>{children}</TableSectionContext.Provider>
    </TableLevelContext.Provider>
  );
}

const TABLE_DENSITIES = ['default', 'condensed', 'compact'] as const;
const CELL_ALIGNS = ['left', 'center', 'right'] as const;

/** Classes + inline style shared by TableHeader and TableCell. */
function cellPresentation(props: Record<string, unknown>, settings: TableSettings, section: TableSection | null) {
  const width = props.width;
  const pixels = num(width);
  const style: CSSProperties = { textAlign: oneOf(props.align, CELL_ALIGNS, 'left') };
  if (typeof width !== 'string' && pixels !== undefined && pixels > 0) {
    style.width = pixels;
    style.minWidth = pixels;
  }
  const className = cx(
    'hsp-tcell',
    settings.density !== 'default' && `hsp-tcell-${settings.density}`,
    settings.bordered && 'hsp-tcell-bordered',
    section === 'footer' && 'hsp-tfoot-cell',
    width === 'min' && 'hsp-tcell-min',
    width === 'max' && 'hsp-tcell-max',
  );
  return { className, style };
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

/** HubSpot does not document a default; five page buttons keeps the footer compact. */
const DEFAULT_MAX_PAGE_BUTTONS = 5;

/** A window of at most `max` consecutive page numbers containing `page`, centred when possible. */
function visiblePages(page: number, pageCount: number, max: number): number[] {
  const size = Math.max(1, Math.min(max, pageCount));
  const start = Math.min(Math.max(1, page - Math.floor((size - 1) / 2)), pageCount - size + 1);
  return Array.from({ length: size }, (_, i) => start + i);
}

interface PageStepProps {
  label: string;
  icon: LucideIcon;
  iconAfter?: boolean;
  showLabel: boolean;
  disabled: boolean;
  onClick: () => void;
}

function PageStep({ label, icon: Icon, iconAfter, showLabel, disabled, onClick }: PageStepProps) {
  const icon = <Icon size={14} strokeWidth={2.25} aria-hidden />;
  return (
    <button
      type="button"
      className="hsp-table-page hsp-table-page-step"
      disabled={disabled}
      aria-label={showLabel ? undefined : label}
      onClick={onClick}
    >
      {!iconAfter && icon}
      {showLabel && <span>{label}</span>}
      {iconAfter && icon}
    </button>
  );
}

/**
 * Pagination footer: First / Prev / page numbers / Next / Last. `page` is controlled when the
 * prop is set (bound to state or an expression); otherwise the preview tracks it locally.
 */
function TablePagination({ props, trigger }: { props: Record<string, unknown>; trigger: PreviewProps['trigger'] }) {
  const pageCount = posInt(props.pageCount) ?? 1;
  const [rawPage, setPage] = usePreviewValue<unknown>(props.page, undefined, 1);
  const page = clamp(posInt(rawPage) ?? 1, 1, pageCount);
  const maxButtons = posInt(props.maxVisiblePageButtons) ?? DEFAULT_MAX_PAGE_BUTTONS;
  const showLabels = boolOr(props.showButtonLabels, true);
  const showFirstLast = bool(props.showFirstLastButtons);

  const go = (target: number) => {
    if (target < 1 || target > pageCount || target === page) return;
    setPage(target);
    trigger('onPageChange', target);
  };

  return (
    <nav className="hsp-table-pagination" aria-label="Pagination">
      {showFirstLast && (
        <PageStep label="First" icon={ChevronFirstIcon} showLabel={showLabels} disabled={page <= 1} onClick={() => go(1)} />
      )}
      <PageStep label="Prev" icon={ChevronLeftIcon} showLabel={showLabels} disabled={page <= 1} onClick={() => go(page - 1)} />
      {visiblePages(page, pageCount, maxButtons).map((n) => (
        <button
          key={n}
          type="button"
          className={cx('hsp-table-page', n === page && 'hsp-table-page-current')}
          aria-current={n === page ? 'page' : undefined}
          onClick={() => go(n)}
        >
          {n}
        </button>
      ))}
      <PageStep
        label="Next"
        icon={ChevronRightIcon}
        iconAfter
        showLabel={showLabels}
        disabled={page >= pageCount}
        onClick={() => go(page + 1)}
      />
      {showFirstLast && (
        <PageStep
          label="Last"
          icon={ChevronLastIcon}
          iconAfter
          showLabel={showLabels}
          disabled={page >= pageCount}
          onClick={() => go(pageCount)}
        />
      )}
    </nav>
  );
}

function TablePreview({ node, props, children, rootProps, trigger }: PreviewProps) {
  const density = oneOf(props.density, TABLE_DENSITIES, 'default');
  const bordered = boolOr(props.bordered, true);
  const settings = useMemo<TableSettings>(() => ({ density, bordered }), [density, bordered]);
  const { own, place } = useTablePlacement('none', rootProps);
  return place(
    <div {...own} className={cx('hsp-table-container', bool(props.flush) && 'hsp-table-flush', own.className)}>
      <div className="hsp-table-scroll">
        <table className={cx('hsp-table', bordered && 'hsp-table-bordered')}>
          <TableSettingsContext.Provider value={settings}>
            <TableSectionContext.Provider value={null}>
              <TableLevelContext.Provider value="table">{tableContainerContent('table', node, children)}</TableLevelContext.Provider>
            </TableSectionContext.Provider>
          </TableSettingsContext.Provider>
        </table>
      </div>
      {bool(props.paginated) && <TablePagination props={props} trigger={trigger} />}
    </div>,
  );
}

// ---------------------------------------------------------------------------
// TableHead / TableBody / TableFooter
// ---------------------------------------------------------------------------

const SECTION_TAG: Record<TableSection, 'thead' | 'tbody' | 'tfoot'> = { head: 'thead', body: 'tbody', footer: 'tfoot' };

function TableSectionPreview({ section, node, children, rootProps }: PreviewProps & { section: TableSection }) {
  const { own, place } = useTablePlacement('table', rootProps);
  const tag = SECTION_TAG[section];
  return place(
    createElement(
      tag,
      { ...own, className: cx(`hsp-${tag}`, own.className) },
      <TableSectionContext.Provider value={section}>
        <TableLevelContext.Provider value="section">{tableContainerContent('section', node, children)}</TableLevelContext.Provider>
      </TableSectionContext.Provider>,
    ),
  );
}

const TableHeadPreview = (p: PreviewProps) => <TableSectionPreview {...p} section="head" />;
const TableBodyPreview = (p: PreviewProps) => <TableSectionPreview {...p} section="body" />;
const TableFooterPreview = (p: PreviewProps) => <TableSectionPreview {...p} section="footer" />;

// ---------------------------------------------------------------------------
// TableRow / TableHeader / TableCell
// ---------------------------------------------------------------------------

function TableRowPreview({ node, children, rootProps }: PreviewProps) {
  const { own, place } = useTablePlacement('section', rootProps);
  return place(
    <tr {...own} className={cx('hsp-tr', own.className)}>
      <TableLevelContext.Provider value="row">{tableContainerContent('row', node, children)}</TableLevelContext.Provider>
    </tr>,
  );
}

/** TableHeader `sortDirection`: 'never' (or absent) = not sortable; the others draw sort arrows. */
const SORT_DIRECTIONS = ['never', 'none', 'ascending', 'descending'] as const;
type ActiveSort = 'none' | 'ascending' | 'descending';
/** Clicking a sortable header cycles none -> ascending -> descending -> none. */
const NEXT_SORT: Record<ActiveSort, ActiveSort> = { none: 'ascending', ascending: 'descending', descending: 'none' };

const isSortable = (props: Record<string, unknown>): boolean =>
  props.sortDirection === 'none' || props.sortDirection === 'ascending' || props.sortDirection === 'descending';

function SortIcon({ direction }: { direction: ActiveSort }) {
  return (
    <svg className="hsp-th-sort-icon" width="8" height="12" viewBox="0 0 8 12" aria-hidden>
      <path d="M4 0 8 5H0Z" className={direction === 'ascending' ? 'hsp-th-sort-active' : undefined} />
      <path d="M4 12 0 7h8Z" className={direction === 'descending' ? 'hsp-th-sort-active' : undefined} />
    </svg>
  );
}

function TableHeaderPreview({ props, text, rootProps, trigger }: PreviewProps) {
  const settings = useContext(TableSettingsContext);
  const section = useContext(TableSectionContext);
  const { own, place } = useTablePlacement('row', rootProps);
  const direction = oneOf(props.sortDirection, SORT_DIRECTIONS, 'never');
  const { className, style } = cellPresentation(props, settings, section);
  return place(
    <th
      {...own}
      scope="col"
      aria-sort={direction === 'never' ? undefined : direction}
      className={cx(className, 'hsp-th', own.className)}
      style={style}
    >
      {direction === 'never' ? (
        text
      ) : (
        <button
          type="button"
          className="hsp-th-sort"
          disabled={bool(props.disabled)}
          onClick={() => trigger('onSortChange', NEXT_SORT[direction])}
        >
          <span>{text}</span>
          <SortIcon direction={direction} />
        </button>
      )}
    </th>,
  );
}

function TableCellPreview({ props, children, rootProps }: PreviewProps) {
  const settings = useContext(TableSettingsContext);
  const section = useContext(TableSectionContext);
  const { own, place } = useTablePlacement('row', rootProps);
  const { className, style } = cellPresentation(props, settings, section);
  return place(
    <td {...own} colSpan={posInt(props.colSpan)} className={cx(className, own.className)} style={style}>
      <CellContent>{children}</CellContent>
    </td>,
  );
}

// ---------------------------------------------------------------------------
// DescriptionList / DescriptionListItem
// ---------------------------------------------------------------------------

const DL_DIRECTIONS = ['row', 'column'] as const;
const DescriptionListContext = createContext<(typeof DL_DIRECTIONS)[number]>('column');

function DescriptionListPreview({ props, children, rootProps }: PreviewProps) {
  const direction = oneOf(props.direction, DL_DIRECTIONS, 'column');
  return (
    <dl {...rootProps} className={cx('hsp-dl', `hsp-dl-${direction}`, rootProps.className)}>
      <DescriptionListContext.Provider value={direction}>{children}</DescriptionListContext.Provider>
    </dl>
  );
}

function DescriptionListItemPreview({ props, children, rootProps }: PreviewProps) {
  const direction = useContext(DescriptionListContext);
  return (
    <div {...rootProps} className={cx('hsp-dl-item', `hsp-dl-item-${direction}`, rootProps.className)}>
      <dt className="hsp-dl-label">{str(props.label)}</dt>
      {/* The value may contain another DescriptionList, which provides its own direction. */}
      <dd className="hsp-dl-value">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics / StatisticsItem / StatisticsTrend
// ---------------------------------------------------------------------------

function StatisticsPreview({ children, rootProps }: PreviewProps) {
  return (
    <div {...rootProps} className={cx('hsp-stats', rootProps.className)}>
      {children}
    </div>
  );
}

function StatisticsItemPreview({ props, children, rootProps }: PreviewProps) {
  return (
    <div {...rootProps} className={cx('hsp-stat', rootProps.className)}>
      <div className="hsp-stat-label">{str(props.label)}</div>
      <div className="hsp-stat-number">{str(props.number)}</div>
      {Children.count(children) > 0 && <div className="hsp-stat-extra">{children}</div>}
    </div>
  );
}

const TREND_DIRECTIONS = ['increase', 'decrease'] as const;
const TREND_COLORS = ['red', 'green'] as const;

function StatisticsTrendPreview({ props, rootProps }: PreviewProps) {
  const direction = oneOf(props.direction, TREND_DIRECTIONS, 'increase');
  // Without an explicit color, increases are green and decreases red.
  const color = oneOf(props.color, TREND_COLORS, direction === 'increase' ? 'green' : 'red');
  return (
    <span {...rootProps} className={cx('hsp-stat-trend', rootProps.className)}>
      <svg
        className={cx('hsp-stat-trend-arrow', `hsp-stat-trend-${color}`)}
        width="10"
        height="8"
        viewBox="0 0 10 8"
        aria-hidden
      >
        <path d={direction === 'increase' ? 'M5 0 10 8H0Z' : 'M5 8 0 0h10Z'} fill="currentColor" />
      </svg>
      <span className="hsp-dd-sr-only">{direction === 'increase' ? 'Increased by' : 'Decreased by'}</span>
      <span>{str(props.value)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

const PROGRESS_VARIANTS = ['success', 'danger', 'warning'] as const;

function ProgressBarPreview({ props, rootProps }: PreviewProps) {
  const maxValue = num(props.maxValue) ?? 100;
  const value = num(props.value) ?? 0;
  const percent = maxValue > 0 ? clamp((value / maxValue) * 100, 0, 100) : 0;
  const variant = oneOf(props.variant, PROGRESS_VARIANTS, 'success');
  const title = str(props.title);
  const valueDescription = str(props.valueDescription);
  const showPercentage = bool(props.showPercentage);
  const ariaLabel = str(props['aria-label']) || title || undefined;
  return (
    <div {...rootProps} className={cx('hsp-progress', rootProps.className)}>
      {(title || valueDescription || showPercentage) && (
        <div className="hsp-progress-header">
          {title && <span className="hsp-progress-title">{title}</span>}
          {(valueDescription || showPercentage) && (
            <span className="hsp-progress-meta">
              {valueDescription && <span className="hsp-progress-description">{valueDescription}</span>}
              {showPercentage && <span className="hsp-progress-percent">{Math.round(percent)}%</span>}
            </span>
          )}
        </div>
      )}
      <div
        className="hsp-progress-track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={maxValue}
        aria-valuenow={value}
        aria-valuetext={valueDescription || undefined}
      >
        <div className={cx('hsp-progress-fill', `hsp-progress-${variant}`)} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreCircle
// ---------------------------------------------------------------------------

const SCORE_RADIUS = 20;
const SCORE_CIRCUMFERENCE = 2 * Math.PI * SCORE_RADIUS;

/** HubSpot bands: 0-32 alert (red), 33-65 warning (yellow), 66-100 success (green). */
function scoreBand(score: number): 'alert' | 'warning' | 'success' {
  if (score <= 32) return 'alert';
  if (score <= 65) return 'warning';
  return 'success';
}

function ScoreCirclePreview({ props, rootProps }: PreviewProps) {
  const raw = num(props.score);
  // Decimals round to the nearest integer; values are kept within 0-100.
  const score = raw === undefined ? undefined : clamp(Math.round(raw), 0, 100);
  const filled = score ?? 0;
  return (
    <div
      {...rootProps}
      role="img"
      aria-label={score === undefined ? 'Score' : `Score: ${score} out of 100`}
      className={cx('hsp-score-circle', `hsp-score-circle-${scoreBand(filled)}`, rootProps.className)}
    >
      <svg className="hsp-score-circle-svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden>
        <circle className="hsp-score-circle-track" cx="24" cy="24" r={SCORE_RADIUS} strokeWidth="4" />
        <circle
          className="hsp-score-circle-arc"
          cx="24"
          cy="24"
          r={SCORE_RADIUS}
          strokeWidth="4"
          strokeDasharray={SCORE_CIRCUMFERENCE}
          strokeDashoffset={SCORE_CIRCUMFERENCE * (1 - filled / 100)}
          transform="rotate(-90 24 24)"
          visibility={filled > 0 ? 'visible' : 'hidden'}
        />
      </svg>
      <span className="hsp-score-circle-value">{score ?? '–'}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

const STEP_DIRECTIONS = ['horizontal', 'vertical'] as const;
const STEP_VARIANTS = ['default', 'compact', 'flush'] as const;
/** Circle diameter per AllSizes value. */
const STEP_DOT_SIZE: Record<string, number> = { 'extra-small': 10, small: 14, medium: 20, large: 26, 'extra-large': 32 };

type StepStatus = 'complete' | 'current' | 'upcoming';

function StepIndicatorPreview({ node, props, rootProps, trigger, mode }: PreviewProps) {
  const names = Array.isArray(props.stepNames) ? props.stepNames.map((name: unknown) => str(name)) : [];
  const direction = oneOf(props.direction, STEP_DIRECTIONS, 'horizontal');
  const variant = oneOf(props.variant, STEP_VARIANTS, 'default');
  const dotSize = lookup(STEP_DOT_SIZE, normalizeSize(props.circleSize, 'small')) ?? STEP_DOT_SIZE.small;
  const rawCurrent = num(props.currentStep);
  // Steps are zero-based. Without currentStep no step is active (all upcoming); a value past the
  // last step shows every step as complete.
  const current = rawCurrent === undefined ? -1 : Math.floor(rawCurrent);
  const clickable = hasEvent(node, 'onClick') || Boolean(node.binding);
  const last = names.length - 1;
  const status = (i: number): StepStatus => (i < current ? 'complete' : i === current ? 'current' : 'upcoming');
  const labelVisible = (i: number) => variant === 'default' || i === current;
  const currentName = current >= 0 && current <= last ? names[current] : '';
  // Horizontal compact/flush variants show only the active step's title, as a caption.
  const caption = direction === 'horizontal' && variant !== 'default' && currentName;
  const layout = direction === 'vertical' ? 'vertical' : variant === 'flush' ? 'rail' : 'columns';

  const dot = (i: number) => (
    <span
      className={cx('hsp-steps-dot', `hsp-steps-dot-${status(i)}`)}
      style={{ width: dotSize, height: dotSize }}
      aria-hidden
    />
  );
  const label = (i: number) =>
    labelVisible(i) && (
      <span className={cx('hsp-steps-label', i === current && 'hsp-steps-label-current')}>{names[i]}</span>
    );
  const buttonProps = (i: number) => ({
    type: 'button' as const,
    className: cx('hsp-steps-button', clickable && 'hsp-steps-clickable'),
    'aria-current': i === current ? ('step' as const) : undefined,
    'aria-label': labelVisible(i) ? undefined : names[i],
    onClick: () => trigger('onClick', i),
  });

  let items: ReactNode;
  if (layout === 'vertical') {
    items = names.map((_, i) => (
      <li key={i} className="hsp-steps-item">
        <button {...buttonProps(i)}>
          <span className="hsp-steps-vrail">
            {dot(i)}
            <span className={cx('hsp-steps-vline', i === last && 'hsp-steps-line-hidden', i < current && 'hsp-steps-line-done')} />
          </span>
          {label(i)}
        </button>
      </li>
    ));
  } else if (layout === 'rail') {
    // Flush: circles sit at the very edges, joined by stretching lines.
    items = names.map((_, i) => (
      <li key={i} className={cx('hsp-steps-item', i < last && 'hsp-steps-item-grow')}>
        <button {...buttonProps(i)}>{dot(i)}</button>
        {i < last && <span className={cx('hsp-steps-line', i < current && 'hsp-steps-line-done')} />}
      </li>
    ));
  } else {
    // Equal columns with the circle centred over each step's title.
    items = names.map((_, i) => (
      <li key={i} className="hsp-steps-item">
        <button {...buttonProps(i)}>
          <span className="hsp-steps-track">
            <span className={cx('hsp-steps-line', i === 0 && 'hsp-steps-line-hidden', i <= current && 'hsp-steps-line-done')} />
            {dot(i)}
            <span className={cx('hsp-steps-line', i === last && 'hsp-steps-line-hidden', i < current && 'hsp-steps-line-done')} />
          </span>
          {variant === 'default' && label(i)}
        </button>
      </li>
    ));
  }

  return (
    <div
      {...rootProps}
      className={cx(
        'hsp-steps',
        `hsp-steps-${direction}`,
        `hsp-steps-${layout}`,
        `hsp-steps-variant-${variant}`,
        rootProps.className,
      )}
    >
      {names.length === 0 ? (
        mode === 'design' && <span className="hsp-steps-empty">Add step names to show the indicator</span>
      ) : (
        <ol className="hsp-steps-list">{items}</ol>
      )}
      {caption && <div className="hsp-steps-caption">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------

const ALERT_VARIANT_VALUES = ['info', 'warning', 'success', 'error', 'danger', 'tip'] as const;

function AlertPreview({ props, text, rootProps }: PreviewProps) {
  const variant = oneOf(props.variant, ALERT_VARIANT_VALUES, 'info');
  const title = str(props.title);
  const urgent = variant === 'error' || variant === 'danger' || variant === 'warning';
  return (
    <div
      {...rootProps}
      role={urgent ? 'alert' : 'status'}
      className={cx('hsp-alert-box', `hsp-alert-box-${variant}`, rootProps.className)}
    >
      {title && <div className="hsp-alert-box-title">{title}</div>}
      {text && <div className="hsp-alert-box-body">{text}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spot illustrations (EmptyState / ErrorState)
// ---------------------------------------------------------------------------

type SpotTone = 'teal' | 'orange' | 'yellow' | 'purple' | 'green' | 'red';

interface SpotSpec {
  icon: LucideIcon;
  tone: SpotTone;
}

/**
 * A HubSpot-style spot illustration drawn inline (no external assets): a soft tinted blob with a
 * card holding a themed icon, a ground shadow and a few accent sparks. viewBox is 200x150.
 */
function SpotIllustration({ icon: Icon, tone }: SpotSpec) {
  return (
    <svg className={cx('hsp-spot', `hsp-spot-${tone}`)} viewBox="0 0 200 150" aria-hidden focusable="false">
      <ellipse className="hsp-spot-ground" cx="100" cy="134" rx="64" ry="7" />
      <circle className="hsp-spot-blob" cx="100" cy="72" r="54" />
      <rect className="hsp-spot-card" x="66" y="42" width="68" height="60" rx="8" strokeWidth="2" />
      <Icon className="hsp-spot-icon" x={76} y={48} size={48} strokeWidth={1.6} />
      <circle className="hsp-spot-spark-a" cx="152" cy="36" r="5" />
      <circle className="hsp-spot-spark-b" cx="48" cy="104" r="4" />
      <path className="hsp-spot-spark-c" d="M44 34v12M38 40h12" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Keys of `EmptyStateImageName` in @hubspot/ui-extensions 0.17.x (d.ts order). */
const EMPTY_STATE_IMAGE_NAMES = [
  'addOnReporting',
  'announcement',
  'api',
  'automatedTesting',
  'beta',
  'building',
  'callingSetUp',
  'companies',
  'components',
  'cone',
  'contacts',
  'contentStrategy',
  'customObjects',
  'customerExperience',
  'customerSupport',
  'deals',
  'developerSecurityUpdate',
  'electronicSignature',
  'electronicSignatureEmptyState',
  'emailConfirmation',
  'emptyStateCharts',
  'idea',
  'integrations',
  'leads',
  'lock',
  'meetings',
  'missedGoal',
  'multipleObjects',
  'object',
  'productsShoppingCart',
  'registration',
  'sandboxAddOn',
  'social',
  'store',
  'storeDisabled',
  'successfullyConnectedEmail',
  'target',
  'task',
  'tickets',
  'voteAndSearch',
] as const;
type EmptyStateImageName = (typeof EMPTY_STATE_IMAGE_NAMES)[number];

/** Themed stand-ins for HubSpot's empty-state artwork, one per image name. */
const EMPTY_STATE_IMAGES: Record<EmptyStateImageName, SpotSpec> = {
  addOnReporting: { icon: ChartColumnIncreasingIcon, tone: 'teal' },
  announcement: { icon: MegaphoneIcon, tone: 'orange' },
  api: { icon: CodeIcon, tone: 'purple' },
  automatedTesting: { icon: FlaskConicalIcon, tone: 'green' },
  beta: { icon: RocketIcon, tone: 'purple' },
  building: { icon: Building2Icon, tone: 'yellow' },
  callingSetUp: { icon: HeadsetIcon, tone: 'teal' },
  companies: { icon: Building2Icon, tone: 'teal' },
  components: { icon: BlocksIcon, tone: 'purple' },
  cone: { icon: TrafficConeIcon, tone: 'orange' },
  contacts: { icon: UsersIcon, tone: 'teal' },
  contentStrategy: { icon: ClipboardListIcon, tone: 'yellow' },
  customObjects: { icon: ShapesIcon, tone: 'purple' },
  customerExperience: { icon: SmileIcon, tone: 'green' },
  customerSupport: { icon: HeadsetIcon, tone: 'green' },
  deals: { icon: HandshakeIcon, tone: 'orange' },
  developerSecurityUpdate: { icon: ShieldCheckIcon, tone: 'purple' },
  electronicSignature: { icon: SignatureIcon, tone: 'teal' },
  electronicSignatureEmptyState: { icon: SignatureIcon, tone: 'yellow' },
  emailConfirmation: { icon: MailCheckIcon, tone: 'green' },
  emptyStateCharts: { icon: ChartColumnIcon, tone: 'teal' },
  idea: { icon: LightbulbIcon, tone: 'yellow' },
  integrations: { icon: PlugIcon, tone: 'purple' },
  leads: { icon: ContactIcon, tone: 'orange' },
  lock: { icon: LockIcon, tone: 'yellow' },
  meetings: { icon: CalendarDaysIcon, tone: 'teal' },
  missedGoal: { icon: GoalIcon, tone: 'red' },
  multipleObjects: { icon: BoxesIcon, tone: 'purple' },
  object: { icon: BoxIcon, tone: 'teal' },
  productsShoppingCart: { icon: ShoppingCartIcon, tone: 'orange' },
  registration: { icon: SquareCheckBigIcon, tone: 'green' },
  sandboxAddOn: { icon: LayersIcon, tone: 'yellow' },
  social: { icon: Share2Icon, tone: 'teal' },
  store: { icon: StoreIcon, tone: 'orange' },
  storeDisabled: { icon: StoreIcon, tone: 'red' },
  successfullyConnectedEmail: { icon: MailOpenIcon, tone: 'green' },
  target: { icon: TargetIcon, tone: 'orange' },
  task: { icon: SquareCheckBigIcon, tone: 'teal' },
  tickets: { icon: TicketIcon, tone: 'purple' },
  voteAndSearch: { icon: VoteIcon, tone: 'yellow' },
};

// ---------------------------------------------------------------------------
// EmptyState / ErrorState
// ---------------------------------------------------------------------------

const EMPTY_LAYOUTS = ['horizontal', 'vertical'] as const;
const DEFAULT_IMAGE_WIDTH = 250;

function EmptyStatePreview({ props, children, rootProps }: PreviewProps) {
  const layout = oneOf(props.layout, EMPTY_LAYOUTS, 'horizontal');
  const reverse = bool(props.reverseOrder);
  const imageWidth = num(props.imageWidth);
  const width = imageWidth !== undefined && imageWidth > 0 ? imageWidth : DEFAULT_IMAGE_WIDTH;
  const spot = lookup(EMPTY_STATE_IMAGES, props.imageName) ?? EMPTY_STATE_IMAGES.emptyStateCharts;
  const title = str(props.title);

  const image = (
    <div
      key="image"
      className="hsp-empty-state-image"
      style={{ maxWidth: width, flexBasis: layout === 'horizontal' ? width : undefined }}
    >
      <SpotIllustration {...spot} />
    </div>
  );
  const content = (
    <div key="content" className="hsp-empty-state-content">
      {title && <h3 className="hsp-empty-state-title">{title}</h3>}
      <div className="hsp-empty-state-body">{children}</div>
    </div>
  );
  return (
    <div
      {...rootProps}
      className={cx(
        'hsp-empty-state',
        `hsp-empty-state-${layout}`,
        reverse && 'hsp-empty-state-reverse',
        bool(props.flush) && 'hsp-empty-state-flush',
        rootProps.className,
      )}
    >
      {/* reverseOrder puts the primary (text) content first, visually and for screen readers. */}
      {reverse ? [content, image] : [image, content]}
    </div>
  );
}

const ERROR_TYPES = ['error', 'support', 'lock'] as const;
const ERROR_IMAGES: Record<(typeof ERROR_TYPES)[number], SpotSpec> = {
  error: { icon: ServerCrashIcon, tone: 'red' },
  support: { icon: HeadsetIcon, tone: 'teal' },
  lock: { icon: LockIcon, tone: 'yellow' },
};

function ErrorStatePreview({ props, children, rootProps }: PreviewProps) {
  const type = oneOf(props.type, ERROR_TYPES, 'error');
  const title = str(props.title);
  return (
    <div {...rootProps} className={cx('hsp-error-state', `hsp-error-state-${type}`, rootProps.className)}>
      <div className="hsp-error-state-image">
        <SpotIllustration {...ERROR_IMAGES[type]} />
      </div>
      {title && <h3 className="hsp-error-state-title">{title}</h3>}
      <div className="hsp-error-state-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadingSpinner
// ---------------------------------------------------------------------------

const SPINNER_LAYOUTS = ['inline', 'centered'] as const;
const SPINNER_SIZE: Record<string, number> = { 'extra-small': 16, small: 24, medium: 36 };

function LoadingSpinnerPreview({ props, rootProps }: PreviewProps) {
  const layout = oneOf(props.layout, SPINNER_LAYOUTS, 'inline');
  const size = lookup(SPINNER_SIZE, normalizeSize(props.size, 'small')) ?? SPINNER_SIZE.small;
  const label = str(props.label);
  const Root = layout === 'centered' ? 'div' : 'span';
  return (
    <Root
      {...rootProps}
      role="status"
      className={cx('hsp-loading-spinner', `hsp-loading-spinner-${layout}`, rootProps.className)}
    >
      <svg className="hsp-loading-spinner-svg" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="hsp-loading-spinner-track" cx="12" cy="12" r="10" strokeWidth="3" />
        <path className="hsp-loading-spinner-arc" d="M12 2a10 10 0 0 1 10 10" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {bool(props.showLabel) ? (
        <span className="hsp-loading-spinner-label">{label}</span>
      ) : (
        label && <span className="hsp-dd-sr-only">{label}</span>
      )}
    </Root>
  );
}

// ---------------------------------------------------------------------------
// Definition pieces
// ---------------------------------------------------------------------------

/** Pagination props only apply (and only type-check) when `paginated` is true. */
const isPaginated = (props: Record<string, unknown>): boolean => props.paginated === true;
/** Show pagination props for `true` and for expressions; hide when unset or false. */
const paginationVisible = (props: Record<string, unknown>): boolean =>
  props.paginated !== undefined && props.paginated !== false;

const ALIGN_PROP: PropDef = {
  name: 'align',
  label: 'Align',
  type: { kind: 'enum', options: enumOptions('left', 'center', 'right') },
  group: 'Layout',
  description: 'Horizontal alignment of the content.',
};

const WIDTH_PROP: PropDef = {
  name: 'width',
  label: 'Width',
  type: {
    kind: 'enum',
    options: [
      { value: 'min', label: 'Min (fit content)' },
      { value: 'max', label: 'Max (fill space)' },
      { value: 'auto', label: 'Auto' },
    ],
  },
  group: 'Layout',
  description:
    'min: only as wide as the content (may scroll); max: takes all available width; auto: adjusts to the available space. Use an expression for a pixel number.',
};

/** TableHead / TableBody / TableFooter hold one or more TableRows (TS `children: ReactNode`). */
const tableSectionChildren = (placeholder: string): ChildrenDef => ({
  mode: 'nodes',
  accepts: ['TableRow'],
  required: true,
  placeholder,
});

const TREND_DIRECTION_OPTIONS: EnumOption[] = [
  { value: 'increase', label: 'Increase' },
  { value: 'decrease', label: 'Decrease' },
];

const ON_PAGE_CHANGE_EVENT: EventDef = {
  name: 'onPageChange',
  label: 'On page change',
  description: 'Runs when a pagination button is clicked. Required when the table is paginated.',
  params: [{ name: 'pageNumber', description: 'The page number that was selected (1-based).' }],
  requiredWhen: isPaginated,
};

const ON_SORT_CHANGE_EVENT: EventDef = {
  name: 'onSortChange',
  label: 'On sort change',
  description: 'Runs when the header is clicked. Required when the header is sortable.',
  params: [{ name: 'sortDirection', description: "The requested direction: 'ascending', 'descending' or 'none'." }],
  requiredWhen: isSortable,
};

const ON_STEP_CLICK_EVENT: EventDef = {
  name: 'onClick',
  label: 'On step click',
  description: 'Runs when a step is clicked. Use it to update the current step.',
  params: [{ name: 'stepIndex', description: 'Zero-based index of the clicked step.' }],
};

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const dataDisplayComponents: ComponentDef[] = [
  // ---- Tables ---------------------------------------------------------------
  {
    type: 'Table',
    label: 'Table',
    category: 'Tables',
    description: 'A table with header, body and footer sections. Supports borders, density, sortable headers and pagination.',
    icon: Table2Icon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['grid', 'rows', 'columns', 'data table', 'pagination', 'sortable', 'list'],
    children: {
      mode: 'nodes',
      accepts: ['TableHead', 'TableBody', 'TableFooter'],
      required: true,
      placeholder: 'Drop a table head, body or footer here',
    },
    create: () => ({
      type: 'Table',
      children: [
        { type: 'TableHead', children: [tableRow(tableHeader('Company'), tableHeader('Stage'), tableHeader('Amount', { align: 'right' }))] },
        {
          type: 'TableBody',
          children: [
            tableRow(tableCell('Acme Corp'), tableCell('Negotiation'), tableCell('$12,500', { align: 'right' })),
            tableRow(tableCell('Globex Inc.'), tableCell('Closed won'), tableCell('$48,000', { align: 'right' })),
          ],
        },
      ],
    }),
    props: [
      {
        name: 'bordered',
        label: 'Borders',
        type: { kind: 'boolean' },
        defaultValue: true,
        group: 'Appearance',
        description: 'Draws lines around the table and between its cells.',
      },
      {
        name: 'density',
        label: 'Row spacing',
        type: {
          kind: 'enum',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'condensed', label: 'Condensed' },
            { value: 'compact', label: 'Compact' },
          ],
        },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'Default rows are roomy; condensed and compact fit more rows.',
      },
      {
        name: 'flush',
        label: 'No space below',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Removes the space under the table.',
      },
      {
        name: 'paginated',
        label: 'Split into pages',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Shows page buttons under the table. Then set the number of pages and what happens on a page change (Events).',
      },
      {
        name: 'pageCount',
        label: 'Number of pages',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Behavior',
        description: 'How many pages there are in total.',
        requiredWhen: isPaginated,
        visibleWhen: paginationVisible,
      },
      {
        name: 'page',
        label: 'Current page',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Behavior',
        description: 'Which page is showing (the first page is 1). Link it to a variable under “Value binding”.',
        visibleWhen: paginationVisible,
      },
      {
        name: 'showButtonLabels',
        label: 'Show button labels',
        type: { kind: 'boolean' },
        defaultValue: true,
        group: 'Behavior',
        description: 'Show the First/Prev/Next text labels (they stay available to screen readers).',
        visibleWhen: paginationVisible,
      },
      {
        name: 'showFirstLastButtons',
        label: 'Show first/last buttons',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Show buttons that jump to the first and last page.',
        visibleWhen: paginationVisible,
      },
      {
        name: 'maxVisiblePageButtons',
        label: 'Page number buttons',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Behavior',
        description: 'How many page number buttons are shown at most.',
        visibleWhen: paginationVisible,
      },
      TEST_ID_PROP,
    ],
    events: [ON_PAGE_CHANGE_EVENT],
    valueBinding: { prop: 'page', event: 'onPageChange', stateType: 'number', initial: 1 },
    preview: TablePreview,
  },
  {
    type: 'TableHead',
    label: 'Table head',
    category: 'Tables',
    description: 'The header section of a table, containing a row of column labels.',
    icon: PanelTopIcon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['thead', 'header row', 'column labels'],
    parents: ['Table'],
    children: tableSectionChildren('Drop a header row here'),
    create: () => ({
      type: 'TableHead',
      children: [tableRow(tableHeader('Name'), tableHeader('Status'), tableHeader('Amount', { align: 'right' }))],
    }),
    props: [TEST_ID_PROP],
    preview: TableHeadPreview,
  },
  {
    type: 'TableBody',
    label: 'Table body',
    category: 'Tables',
    description: 'The body of a table, holding its rows of cells.',
    icon: Rows3Icon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['tbody', 'rows', 'data'],
    parents: ['Table'],
    children: tableSectionChildren('Drop table rows here'),
    create: () => ({
      type: 'TableBody',
      children: [tableRow(tableCell('Initech'), tableCell('Active'), tableCell('$8,200', { align: 'right' }))],
    }),
    props: [TEST_ID_PROP],
    preview: TableBodyPreview,
  },
  {
    type: 'TableFooter',
    label: 'Table footer',
    category: 'Tables',
    description: 'A footer section for a table, typically used for totals or other summary information.',
    icon: PanelBottomIcon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['tfoot', 'totals', 'summary'],
    parents: ['Table'],
    children: tableSectionChildren('Drop a footer row here'),
    create: () => ({
      type: 'TableFooter',
      children: [tableRow(tableCell('Total', { colSpan: 2 }), tableCell('$68,700', { align: 'right' }))],
    }),
    props: [TEST_ID_PROP],
    preview: TableFooterPreview,
  },
  {
    type: 'TableRow',
    label: 'Table row',
    category: 'Tables',
    description: 'A row within a table head, body or footer. Holds table headers (in the head) or table cells.',
    icon: TableRowsSplitIcon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['tr', 'record', 'line'],
    parents: ['TableHead', 'TableBody', 'TableFooter'],
    children: {
      mode: 'nodes',
      accepts: ['TableHeader', 'TableCell'],
      required: true,
      placeholder: 'Drop table cells or headers here',
    },
    create: () => tableRow(tableCell('Initech'), tableCell('Active'), tableCell('$8,200', { align: 'right' })),
    props: [TEST_ID_PROP],
    preview: TableRowPreview,
  },
  {
    type: 'TableHeader',
    label: 'Table header',
    category: 'Tables',
    description: 'A bold column label inside the table head. Can be made sortable with a sort direction.',
    icon: HeadingIcon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['th', 'column', 'sort', 'label'],
    parents: ['TableRow'],
    children: { mode: 'text', defaultText: 'Column' },
    create: () => tableHeader('Column'),
    props: [
      {
        // TableHeaderProps is a union: omitted/'never' = not sortable; otherwise onSortChange is required.
        name: 'sortDirection',
        label: 'Sort direction',
        type: {
          kind: 'enum',
          options: [
            { value: 'never', label: 'Not sortable' },
            { value: 'none', label: 'Sortable, unsorted' },
            { value: 'ascending', label: 'Ascending' },
            { value: 'descending', label: 'Descending' },
          ],
        },
        defaultValue: 'never',
        group: 'Behavior',
        description:
          'Shows sort arrows and makes the header clickable. Bind it to state and update it in On sort change. "Not sortable" removes sorting.',
      },
      {
        name: 'disabled',
        label: 'Disable sorting',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Prevent users from changing the sort order. Has no effect when the header is not sortable.',
        visibleWhen: (props) => props.sortDirection !== undefined && props.sortDirection !== 'never',
      },
      ALIGN_PROP,
      WIDTH_PROP,
      TEST_ID_PROP,
    ],
    events: [ON_SORT_CHANGE_EVENT],
    valueBinding: { prop: 'sortDirection', event: 'onSortChange', stateType: 'string', initial: 'none' },
    preview: TableHeaderPreview,
  },
  {
    type: 'TableCell',
    label: 'Table cell',
    category: 'Tables',
    description: 'A cell within a table row. Can hold text or other components such as links, tags and buttons.',
    icon: TableCellsMergeIcon,
    docsUrl: TABLE_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['td', 'value', 'column'],
    parents: ['TableRow'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop cell content here' },
    create: () => tableCell('Value'),
    props: [
      ALIGN_PROP,
      WIDTH_PROP,
      {
        name: 'colSpan',
        label: 'Column span',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Layout',
        description: 'The number of columns the cell spans.',
      },
      TEST_ID_PROP,
    ],
    preview: TableCellPreview,
  },

  // ---- Data display ---------------------------------------------------------
  {
    type: 'DescriptionList',
    label: 'Description list',
    category: 'Data display',
    description: 'Pairs of labels and values that are easy to read at a glance.',
    icon: LayoutListIcon,
    docsUrl: DESCRIPTION_LIST_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['key value', 'properties', 'details', 'fields', 'summary', 'dl'],
    children: {
      mode: 'nodes',
      accepts: ['DescriptionListItem'],
      required: true,
      placeholder: 'Drop description list items here',
    },
    create: () => ({
      type: 'DescriptionList',
      children: [
        descriptionItem('Email', 'alex.morgan@acme.com'),
        descriptionItem('Phone', '+1 (555) 013-4422'),
        descriptionItem('Lifecycle stage', 'Customer'),
      ],
    }),
    props: [
      {
        name: 'direction',
        label: 'Arrange',
        type: {
          kind: 'enum',
          options: [
            { value: 'column', label: 'Label above value' },
            { value: 'row', label: 'Label beside value' },
          ],
          display: 'direction',
        },
        defaultValue: 'column',
        group: 'Layout',
        description: 'Each label above its value, or label and value side by side.',
      },
      TEST_ID_PROP,
    ],
    preview: DescriptionListPreview,
  },
  {
    type: 'DescriptionListItem',
    label: 'Description list item',
    category: 'Data display',
    description: 'A single label and value pair inside a description list. Put the value components inside.',
    icon: TextQuoteIcon,
    docsUrl: DESCRIPTION_LIST_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['key value', 'property', 'field', 'label', 'dt', 'dd'],
    parents: ['DescriptionList'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop the value here' },
    create: () => descriptionItem('Owner', 'Jamie Rivera'),
    props: [
      {
        name: 'label',
        label: 'Label',
        type: { kind: 'string', placeholder: 'e.g. Email' },
        required: true,
        group: 'Content',
        description: 'Text to display as the label.',
      },
      TEST_ID_PROP,
    ],
    preview: DescriptionListItemPreview,
  },
  {
    type: 'Statistics',
    label: 'Statistics',
    category: 'Data display',
    description: 'A visual spotlight of one or more data points, such as counts, totals and trends.',
    icon: ChartNoAxesColumnIncreasingIcon,
    docsUrl: STATISTICS_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['kpi', 'metrics', 'numbers', 'stats', 'dashboard', 'summary'],
    children: { mode: 'nodes', accepts: ['StatisticsItem'], required: true, placeholder: 'Drop statistics items here' },
    create: () => ({
      type: 'Statistics',
      children: [
        statisticsItem('Open deals', 12, statisticsTrend('increase', '8.5%')),
        statisticsItem('Pipeline value', '$48,200', statisticsTrend('decrease', '2.1%')),
      ],
    }),
    props: [TEST_ID_PROP],
    preview: StatisticsPreview,
  },
  {
    type: 'StatisticsItem',
    label: 'Statistics item',
    category: 'Data display',
    description: 'A single data point inside Statistics: a label and a large number, optionally with a trend or text.',
    icon: HashIcon,
    docsUrl: STATISTICS_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['kpi', 'metric', 'number', 'stat', 'count', 'total'],
    parents: ['Statistics'],
    children: { mode: 'nodes', accepts: ['StatisticsTrend', 'Text'], placeholder: 'Drop a trend or text here' },
    create: () => statisticsItem('Open deals', 12, statisticsTrend('increase', '8.5%')),
    identityProps: ['id'],
    props: [
      {
        name: 'label',
        label: 'Label',
        type: { kind: 'string', placeholder: 'e.g. Open deals' },
        required: true,
        group: 'Content',
        description: "The item's label.",
      },
      {
        // TS type is `string | number`; the inspector edits text, expressions can yield numbers.
        name: 'number',
        label: 'Number',
        type: { kind: 'string', placeholder: 'e.g. 1,250 or {{ dealCount }}' },
        required: true,
        group: 'Content',
        description: 'The big number. Type it, or click { } to show a CRM property or other data.',
      },
      {
        name: 'id',
        label: 'ID',
        type: { kind: 'string' },
        group: 'Advanced',
        description: "The statistic item's unique identifier.",
      },
      TEST_ID_PROP,
    ],
    preview: StatisticsItemPreview,
  },
  {
    type: 'StatisticsTrend',
    label: 'Statistics trend',
    category: 'Data display',
    description: 'A trend value with an up or down arrow, shown inside a statistics item.',
    icon: TrendingUpIcon,
    docsUrl: STATISTICS_DOCS,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['trend', 'change', 'percent', 'increase', 'decrease', 'delta'],
    parents: ['StatisticsItem'],
    children: { mode: 'none' },
    create: () => statisticsTrend('increase', '12.5%'),
    props: [
      {
        name: 'value',
        label: 'Value',
        type: { kind: 'string', placeholder: 'e.g. 12.5%' },
        required: true,
        group: 'Content',
        description: 'The change, e.g. 12.5%.',
      },
      {
        name: 'direction',
        label: 'Arrow',
        type: { kind: 'enum', options: TREND_DIRECTION_OPTIONS },
        required: true,
        defaultValue: 'increase',
        group: 'Appearance',
        description: 'An up arrow (increase) or a down arrow (decrease).',
      },
      {
        name: 'color',
        label: 'Arrow color',
        type: {
          kind: 'enum',
          options: [
            { value: 'green', label: 'Green', swatch: HS_SWATCH.success },
            { value: 'red', label: 'Red', swatch: HS_SWATCH.danger },
          ],
        },
        group: 'Appearance',
        description: 'When not set, up arrows are green and down arrows red. Pick one to show a drop as good news (e.g. fewer tickets).',
      },
      TEST_ID_PROP,
    ],
    preview: StatisticsTrendPreview,
  },
  {
    type: 'ProgressBar',
    label: 'Progress bar',
    category: 'Data display',
    description: 'Shows progress as a bar, with an optional title, value description and completion percentage.',
    icon: SlidersHorizontalIcon,
    tips: [
      { text: 'Change the color at different percentages, e.g. green from 80%, red below 40%', action: { kind: 'rules', prop: 'variant' } },
      { text: 'Fill the bar from a CRM property or other data', action: { kind: 'data', prop: 'value' } },
      { text: 'Show different text at different percentages', action: { kind: 'rules', prop: 'valueDescription' } },
    ],
    docsUrl: `${STANDARD_DOCS}/progress-bar`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['progress', 'completion', 'percent', 'meter', 'goal', 'quota'],
    children: { mode: 'none' },
    create: () => ({
      type: 'ProgressBar',
      props: {
        title: 'Onboarding progress',
        value: 3,
        maxValue: 5,
        valueDescription: '3 of 5 steps complete',
        showPercentage: true,
      },
    }),
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: 'The text above the bar.',
      },
      {
        name: 'value',
        label: 'Value',
        type: { kind: 'number', min: 0 },
        defaultValue: 0,
        group: 'Content',
        description: 'How far along it is, e.g. 3 (of a maximum of 5). Click fx to use a CRM property.',
      },
      {
        name: 'maxValue',
        label: 'Maximum',
        type: { kind: 'number', min: 0 },
        defaultValue: 100,
        group: 'Content',
        description: 'The value that means complete (100%).',
      },
      {
        name: 'valueDescription',
        label: 'Value text',
        type: { kind: 'string', placeholder: 'e.g. 150 out of 250' },
        group: 'Content',
        description: 'Words that explain the value, e.g. “3 of 5 milestones”.',
      },
      {
        name: 'showPercentage',
        label: 'Show percentage',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Appearance',
        description: 'Shows the percentage complete next to the title.',
      },
      {
        name: 'variant',
        label: 'Color',
        type: {
          kind: 'enum',
          options: [
            { value: 'success', label: 'Green (success)', swatch: HS_SWATCH.success },
            { value: 'warning', label: 'Yellow (warning)', swatch: HS_SWATCH.warning },
            { value: 'danger', label: 'Red (danger)', swatch: HS_SWATCH.danger },
          ],
        },
        defaultValue: 'success',
        group: 'Content',
        description: 'The bar’s color. To change it at different percentages (e.g. green from 80%, yellow from 40%, red below), click Rules next to it.',
      },
      {
        name: 'aria-label',
        label: 'Accessibility label',
        type: { kind: 'string' },
        group: 'Advanced',
        description: 'The accessibility label read by screen readers.',
      },
      TEST_ID_PROP,
    ],
    preview: ProgressBarPreview,
  },
  {
    type: 'ScoreCircle',
    label: 'Score circle',
    category: 'Data display',
    description: 'A 0-100 score shown as a color-coded circle: red up to 32, yellow up to 65, green above.',
    icon: CircleGaugeIcon,
    tips: [{ text: 'Show a score from a CRM property, e.g. the lead score', action: { kind: 'data', prop: 'score' } }],
    docsUrl: `${STANDARD_DOCS}/scorecircle`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['score', 'rating', 'health', 'lead score', 'gauge', 'grade'],
    children: { mode: 'none' },
    create: () => ({ type: 'ScoreCircle', props: { score: 75 } }),
    props: [
      {
        name: 'score',
        label: 'Score',
        type: { kind: 'number', min: 0, max: 100, step: 1, integer: true },
        required: true,
        group: 'Content',
        description: 'A number from 0 to 100. HubSpot colors it: red up to 32, yellow up to 65, green above.',
      },
      TEST_ID_PROP,
    ],
    preview: ScoreCirclePreview,
  },
  {
    type: 'StepIndicator',
    label: 'Step indicator',
    category: 'Data display',
    description: 'Shows the current step of a multi-step process. Steps can be clicked to navigate.',
    icon: GitCommitHorizontalIcon,
    docsUrl: `${STANDARD_DOCS}/step-indicator`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['steps', 'wizard', 'stepper', 'progress', 'stages', 'pipeline', 'multi-step'],
    children: { mode: 'none' },
    create: () => ({
      type: 'StepIndicator',
      props: { stepNames: ['Qualify', 'Propose', 'Negotiate', 'Close'], currentStep: 1 },
    }),
    props: [
      {
        name: 'stepNames',
        label: 'Step names',
        type: { kind: 'stringList', placeholder: 'Step name' },
        required: true,
        group: 'Content',
        description: 'The name of each step, in order. Type a name and press Enter to add it.',
      },
      {
        name: 'currentStep',
        label: 'Current step',
        type: { kind: 'number', min: 0, step: 1, integer: true },
        group: 'Content',
        description: 'Which step is active. The first step is 0, the second 1, and so on.',
      },
      {
        name: 'direction',
        label: 'Arrange',
        type: { kind: 'enum', options: [{ value: 'horizontal', label: 'In a row' }, { value: 'vertical', label: 'Stacked' }], display: 'direction' },
        defaultValue: 'horizontal',
        group: 'Layout',
        description: 'Steps in a row, or one under the other.',
      },
      {
        name: 'circleSize',
        label: 'Circle size',
        type: { kind: 'enum', options: SIZE_ALL },
        defaultValue: 'small',
        group: 'Appearance',
        description: 'The size of the step circles.',
      },
      {
        name: 'variant',
        label: 'Style',
        type: {
          kind: 'enum',
          options: [
            { value: 'default', label: 'Default' },
            { value: 'compact', label: 'Compact (active title only)' },
            { value: 'flush', label: 'Flush (active title only, no side margins)' },
          ],
        },
        defaultValue: 'default',
        group: 'Appearance',
        description: 'Compact shows only the active step’s name; flush also removes the side margins.',
      },
      TEST_ID_PROP,
    ],
    events: [ON_STEP_CLICK_EVENT],
    valueBinding: { prop: 'currentStep', event: 'onClick', stateType: 'number', initial: 0 },
    preview: StepIndicatorPreview,
  },

  // ---- Feedback & status ----------------------------------------------------
  {
    type: 'Alert',
    label: 'Alert',
    category: 'Feedback & status',
    description: 'A colored alert for usage guidance, action results or warnings about potential issues.',
    icon: TriangleAlertIcon,
    docsUrl: `${STANDARD_DOCS}/alert`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['banner', 'notice', 'message', 'warning', 'error', 'callout', 'info'],
    children: { mode: 'text', defaultText: 'This contact has an open support ticket.' },
    create: () => ({
      type: 'Alert',
      props: { title: 'Heads up' },
      text: 'This contact has an open support ticket.',
    }),
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        required: true,
        group: 'Content',
        description: 'The bold first line of the alert.',
      },
      {
        name: 'variant',
        label: 'Color',
        type: {
          kind: 'enum',
          options: ALERT_VARIANTS.map((o) => ({ ...o, label: ALERT_LABELS[String(o.value)] ?? humanize(String(o.value)), swatch: HS_SWATCH[o.value as keyof typeof HS_SWATCH] ?? (o.value === 'error' ? HS_SWATCH.danger : undefined) })),
        },
        defaultValue: 'info',
        group: 'Appearance',
        description: 'Blue for information, yellow for warnings, green for success, red for errors, purple for tips.',
      },
      TEST_ID_PROP,
    ],
    preview: AlertPreview,
  },
  {
    type: 'EmptyState',
    label: 'Empty state',
    category: 'Feedback & status',
    description: 'An illustrated message for when there is no content or data yet, guiding users on what to do next.',
    icon: PackageOpenIcon,
    docsUrl: `${STANDARD_DOCS}/empty-state`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['no data', 'no results', 'blank', 'placeholder', 'zero state', 'illustration'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop the empty state message here' },
    create: () => ({
      type: 'EmptyState',
      props: { title: 'No deals yet' },
      children: [textNode('Create a deal to start tracking revenue for this record.')],
    }),
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: 'The heading, e.g. “No deals yet”.',
      },
      {
        name: 'imageName',
        label: 'Picture',
        type: {
          kind: 'enum',
          options: EMPTY_STATE_IMAGE_NAMES.map((value) => ({ value, label: humanize(value) })),
        },
        defaultValue: 'emptyStateCharts',
        group: 'Appearance',
        description: 'Which HubSpot illustration to show.',
      },
      {
        name: 'imageWidth',
        label: 'Picture width (px)',
        type: { kind: 'number', min: 0, step: 1 },
        defaultValue: DEFAULT_IMAGE_WIDTH,
        group: 'Appearance',
        description: 'The largest width of the picture, in pixels.',
      },
      {
        name: 'layout',
        label: 'Layout',
        type: { kind: 'enum', options: enumOptions('horizontal', 'vertical') },
        defaultValue: 'horizontal',
        group: 'Layout',
        description: 'Picture and text side by side, or one above the other.',
      },
      {
        name: 'reverseOrder',
        label: 'Text first',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Shows the text before the picture (screen readers read it first too).',
      },
      {
        name: 'flush',
        label: 'No space around',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Removes the space above and below.',
      },
      TEST_ID_PROP,
    ],
    preview: EmptyStatePreview,
  },
  {
    type: 'ErrorState',
    label: 'Error state',
    category: 'Feedback & status',
    description: 'An illustrated error message that guides users through resolving errors your extension encounters.',
    icon: ServerCrashIcon,
    docsUrl: `${STANDARD_DOCS}/error-state`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['error', 'failure', 'problem', 'retry', 'something went wrong', 'illustration'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop the error message and actions here' },
    create: () => ({
      type: 'ErrorState',
      props: { title: 'Something went wrong' },
      children: [
        textNode("We couldn't load this data. Please try again in a moment."),
        { type: 'Button', text: 'Try again' },
      ],
    }),
    props: [
      {
        name: 'title',
        label: 'Title',
        type: { kind: 'string' },
        group: 'Content',
        description: 'The text of the header.',
      },
      {
        name: 'type',
        label: 'Picture',
        type: {
          kind: 'enum',
          options: [
            { value: 'error', label: 'Error' },
            { value: 'support', label: 'Support' },
            { value: 'lock', label: 'Lock' },
          ],
        },
        defaultValue: 'error',
        group: 'Appearance',
        description: 'Which illustration to show: an error, support, or a lock (no access).',
      },
      TEST_ID_PROP,
    ],
    preview: ErrorStatePreview,
  },
  {
    type: 'LoadingSpinner',
    label: 'Loading spinner',
    category: 'Feedback & status',
    description: 'A spinner that shows the extension is loading or processing data.',
    icon: LoaderCircleIcon,
    tips: [{ text: 'Show it only while data is loading', action: { kind: 'condition' } }],
    docsUrl: `${STANDARD_DOCS}/loading-spinner`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['loading', 'spinner', 'busy', 'wait', 'progress', 'pending'],
    children: { mode: 'none' },
    create: () => ({ type: 'LoadingSpinner', props: { label: 'Loading...', showLabel: true } }),
    props: [
      {
        name: 'label',
        label: 'Label',
        type: { kind: 'string' },
        required: true,
        group: 'Content',
        description: 'What is loading, e.g. “Loading deals…”. Screen readers always read it.',
      },
      {
        name: 'showLabel',
        label: 'Show label',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Appearance',
        description: 'Shows the text next to the spinner.',
      },
      {
        name: 'size',
        label: 'Size',
        type: { kind: 'enum', options: SIZE_XS_MD },
        defaultValue: 'small',
        group: 'Appearance',
        description: 'The size of the spinner.',
      },
      {
        name: 'layout',
        label: 'Layout',
        type: { kind: 'enum', options: enumOptions('inline', 'centered') },
        defaultValue: 'inline',
        group: 'Layout',
        description: 'Next to other content, or centered in the space.',
      },
      TEST_ID_PROP,
    ],
    preview: LoadingSpinnerPreview,
  },
];
