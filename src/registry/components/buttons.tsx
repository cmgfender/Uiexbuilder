/**
 * Buttons & links: Button, LoadingButton, ButtonRow, Dropdown, Dropdown.ButtonItem, Link.
 * See text.tsx for the reference conventions (exact @hubspot/ui-extensions prop names, inspector
 * metadata, previews that spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/components/
 *   button.synced.d.ts (Button, LoadingButton), button-row.synced.d.ts, dropdown.synced.d.ts,
 *   link.synced.d.ts, and shared.synced.d.ts (HrefProp, TShirtSizes, OverlayComponentProps).
 *
 * Design-mode note: hubspot.css makes `<button>` / `<a>` elements inert in design mode
 * (`pointer-events: none`). A preview whose *root* is such an element could then never be clicked
 * to select it, so in design mode these previews render the same face on a `<span>` instead
 * (see `Pressable`). In preview mode they are real buttons / anchors.
 */
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Copy,
  Download,
  ExternalLink,
  GalleryHorizontalEnd,
  Info,
  Link as LinkIcon,
  LoaderCircle,
  Mail,
  MousePointerClick,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Settings,
  SquareChevronDown,
  SquareMenu,
  Star,
  ThumbsUp,
  Trash,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import type { ComponentDef, EnumOption, EventDef, PreviewProps, PreviewRootProps, PropDef, SlotDef } from '../types';
import { HS_SWATCH, STANDARD_DOCS } from '../constants';
import { cx, hrefUrl, normalizeSize, str } from '../../preview/util';
import '../../preview/styles/buttons.css';

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

/** Own-property lookup so names like "constructor" never resolve to Object.prototype members. */
function lookup<V>(table: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Text prop with a HubSpot default that applies only when the prop is absent (not when ''). */
function textOr(v: unknown, fallback: string): string {
  return v === undefined || v === null ? fallback : str(v);
}

// ---------------------------------------------------------------------------
// Shared button vocabulary
// ---------------------------------------------------------------------------

const BUTTON_VARIANTS = ['primary', 'secondary', 'destructive', 'transparent'] as const;
const LOADING_BUTTON_VARIANTS = ['primary', 'secondary', 'destructive'] as const;
/** Variants of the Dropdown button and of the ButtonRow overflow ("More") button. */
const MENU_BUTTON_VARIANTS = ['primary', 'secondary', 'transparent'] as const;
const BUTTON_TYPES = ['button', 'submit', 'reset'] as const;
const LINK_VARIANTS = ['primary', 'destructive', 'light', 'dark'] as const;

type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
type ButtonSize = 'extra-small' | 'small' | 'medium';
type ButtonType = (typeof BUTTON_TYPES)[number];

const VARIANT_LABELS: Record<ButtonVariant, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  destructive: 'Destructive',
  transparent: 'Transparent',
};
const variantOptions = (values: readonly ButtonVariant[]): EnumOption[] =>
  values.map((value) => ({ value, label: VARIANT_LABELS[value], swatch: HS_SWATCH[value] }));

/**
 * `TShirtSizes['xs' | 'sm' | 'md']` accepts both aliases ('xs' | 'extra-small', ...). We offer the
 * long names; HubSpot's documented default `"md"` is the alias of 'medium'.
 */
const BUTTON_SIZE_OPTIONS: EnumOption[] = [
  { value: 'extra-small', label: 'Extra small' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
];

/** Resolves a TShirt size (either alias) to one of the three button sizes; anything else -> medium. */
function buttonSize(v: unknown): ButtonSize {
  const size = normalizeSize(v, 'medium');
  return size === 'extra-small' || size === 'small' ? size : 'medium';
}

/** Pixel size for small inline glyphs (caret, spinner, icons) per button size. */
const GLYPH_SIZE: Record<ButtonSize, number> = { 'extra-small': 12, small: 12, medium: 14 };

interface ButtonLook {
  variant: string;
  size: ButtonSize;
  /** Greyed-out disabled appearance. */
  disabled: boolean;
  mode: 'design' | 'preview';
  truncate?: boolean;
  loading?: boolean;
}

/** Class list shared by every button-like face (Button, LoadingButton, Dropdown & "More" buttons). */
function buttonClass(look: ButtonLook, ...extra: Array<string | false | undefined>): string {
  return cx(
    'hsp-button',
    `hsp-button--${look.variant}`,
    `hsp-button--${look.size}`,
    look.disabled && 'hsp-button--disabled',
    look.truncate && 'hsp-button--truncate',
    look.loading && 'hsp-button--loading',
    // Hover / active feedback only where the button can actually be pressed.
    look.mode === 'preview' && !look.disabled && !look.loading && 'hsp-button--interactive',
    ...extra,
  );
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // randomUUID throws outside secure contexts in some browsers; fall through.
    }
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mirrors HubSpot's `ExtensionEvent` ({ type, bubbles, timeStamp, id }) passed as the first
 * argument of `onClick: ReactionsHandler<ExtensionEvent>` (the id is a fresh UUID per event).
 */
function extensionEvent(e: { type: string; bubbles: boolean; timeStamp: number }) {
  return { type: e.type, bubbles: e.bubbles, timeStamp: e.timeStamp, id: randomId() };
}

// ---------------------------------------------------------------------------
// Hrefs
// ---------------------------------------------------------------------------

interface ResolvedHref {
  /** The URL as configured. */
  url: string;
  /** Safe URL the preview may open in a new tab (http(s), mailto, tel); undefined otherwise. */
  navigable?: string;
  /** Show HubSpot's external-link icon after the label. */
  external: boolean;
}

function isHubSpotHost(url: string): boolean {
  try {
    return /(^|\.)hubspot(qa)?\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Resolves a HubSpot `HrefProp` (string | { url, external }). Per the JSDoc, links outside the
 * HubSpot app show an external icon (and open in a new tab) unless `external` says otherwise.
 * The builder never navigates its own window: relative HubSpot app paths and non-web schemes
 * (e.g. `javascript:`) are not navigable in the preview.
 */
function resolveHref(href: unknown): ResolvedHref | null {
  const url = hrefUrl(href)?.trim();
  if (!url) return null;
  const explicit = isRecord(href) && typeof href.external === 'boolean' ? href.external : undefined;
  const web = /^https?:\/\//i.test(url);
  const navigable = web || /^(mailto|tel):/i.test(url) ? url : undefined;
  return { url, navigable, external: explicit ?? (web && !isHubSpotHost(url)) };
}

function ExternalGlyph({ size }: { size: number }) {
  return <ExternalLink className="hsp-link-external" size={size} strokeWidth={2.25} aria-label="Opens in a new tab" />;
}

// ---------------------------------------------------------------------------
// Pressable: the element behind every clickable face
// ---------------------------------------------------------------------------

type PressableProps = Omit<HTMLAttributes<HTMLElement>, 'onClick'> &
  Partial<Pick<PreviewRootProps, 'data-node-id' | 'data-node-type' | 'data-uiex-clone' | 'data-uiex-cond'>> & {
    mode: 'design' | 'preview';
    /** Blocks activation (disabled or loading). Rendered as aria-disabled so hover still works. */
    inactive?: boolean;
    htmlType?: ButtonType;
    /** Navigable URL: rendered as an anchor opening a new tab. */
    href?: string;
    onActivate?: (e: ReactMouseEvent<HTMLElement>) => void;
  };

/**
 * Renders a clickable face:
 *  - design mode: a `<span>` (selectable in the canvas, no behaviour);
 *  - with a navigable `href`: an `<a target="_blank">` (HubSpot runs both href and onClick);
 *  - otherwise a native `<button type=…>` so a Form preview built on `<form>` receives submit/reset.
 * Inactive faces use `aria-disabled` (not `disabled`) so Tooltip hover handlers keep working; the
 * click (including a form's implicit submission) is cancelled instead.
 */
function Pressable({ mode, inactive, htmlType = 'button', href, onActivate, children, ...rest }: PressableProps) {
  if (mode === 'design') {
    return (
      <span {...rest} aria-disabled={inactive || undefined}>
        {children}
      </span>
    );
  }
  const onClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (inactive) {
      e.preventDefault();
      return;
    }
    onActivate?.(e);
  };
  if (href && !inactive) {
    return (
      <a {...rest} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <button {...rest} type={htmlType} aria-disabled={inactive || undefined} onClick={onClick}>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Popup menus (Dropdown, ButtonRow overflow)
// ---------------------------------------------------------------------------

/** Closes an open popup on outside mousedown or Escape. */
function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) dismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, ref]);
}

/**
 * Keeps an open menu inside the card: when a left-aligned menu would stick out past the right
 * edge of the card (`.hsp-root`), it is aligned to the right edge of its trigger instead.
 */
function useMenuAlignment(open: boolean, menuRef: RefObject<HTMLElement | null>, defaultRight = false): boolean {
  const [alignRight, setAlignRight] = useState(defaultRight);
  useLayoutEffect(() => {
    if (!open) {
      setAlignRight(defaultRight);
      return;
    }
    const menu = menuRef.current;
    const bounds = menu?.closest('.hsp-root')?.getBoundingClientRect();
    if (!menu || !bounds || bounds.width === 0) return;
    const rect = menu.getBoundingClientRect();
    if (!defaultRight && rect.right > bounds.right + 0.5) setAlignRight(true);
    if (defaultRight && rect.left < bounds.left - 0.5) setAlignRight(false);
  }, [open, menuRef, defaultRight]);
  return alignRight;
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

function ButtonPreview({ props, text, rootProps, mode, trigger }: PreviewProps) {
  const size = buttonSize(props.size);
  const disabled = bool(props.disabled);
  const truncate = bool(props.truncate);
  const link = resolveHref(props.href);
  return (
    <Pressable
      {...rootProps}
      mode={mode}
      className={buttonClass(
        { variant: oneOf(props.variant, BUTTON_VARIANTS, 'secondary'), size, disabled, truncate, mode },
        rootProps.className,
      )}
      inactive={disabled}
      htmlType={oneOf(props.type, BUTTON_TYPES, 'button')}
      href={link?.navigable}
      title={rootProps.title ?? (truncate && text ? text : undefined)}
      onActivate={(e) => trigger('onClick', extensionEvent(e))}
    >
      <span className="hsp-button-label">{text}</span>
      {link?.external && <ExternalGlyph size={GLYPH_SIZE[size]} />}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// LoadingButton
// ---------------------------------------------------------------------------

/** How long the result icon stays visible after `loading` turns false. */
export const LOADING_RESULT_MS = 2000;

/** Lucide stand-ins for the HubSpot icon names most likely used as a `resultIconName`. */
const RESULT_ICONS: Record<string, LucideIcon> = {
  success: Check,
  checkCircle: CircleCheck,
  x: X,
  xCircle: CircleX,
  filledXCircleIcon: CircleX,
  remove: X,
  warning: TriangleAlert,
  exclamation: TriangleAlert,
  info: Info,
  star: Star,
  thumbsUp: ThumbsUp,
  save: Save,
  send: Send,
  refresh: RefreshCw,
  upload: Upload,
  download: Download,
  email: Mail,
  copy: Copy,
  delete: Trash,
  edit: Pencil,
  add: Plus,
};

/** True for a moment after `loading` goes from true to false (HubSpot shows the result icon). */
function useLoadingResult(loading: boolean): boolean {
  const [showResult, setShowResult] = useState(false);
  const wasLoading = useRef(loading);
  useEffect(() => {
    const finished = wasLoading.current && !loading;
    wasLoading.current = loading;
    if (!finished) {
      if (loading) setShowResult(false);
      return;
    }
    setShowResult(true);
    const timer = setTimeout(() => setShowResult(false), LOADING_RESULT_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return showResult && !loading;
}

function LoadingButtonPreview({ props, text, rootProps, mode, trigger }: PreviewProps) {
  const size = buttonSize(props.size);
  const disabled = bool(props.disabled);
  const loading = bool(props.loading);
  const truncate = bool(props.truncate);
  const link = resolveHref(props.href);
  const showResult = useLoadingResult(loading);
  const ResultIcon =
    (typeof props.resultIconName === 'string' ? lookup(RESULT_ICONS, props.resultIconName) : undefined) ?? Check;
  return (
    <Pressable
      {...rootProps}
      mode={mode}
      className={buttonClass(
        { variant: oneOf(props.variant, LOADING_BUTTON_VARIANTS, 'secondary'), size, disabled, truncate, loading, mode },
        rootProps.className,
      )}
      inactive={disabled || loading}
      aria-busy={loading || undefined}
      htmlType={oneOf(props.type, BUTTON_TYPES, 'button')}
      href={link?.navigable}
      title={rootProps.title ?? (truncate && text ? text : undefined)}
      onActivate={(e) => trigger('onClick', extensionEvent(e))}
    >
      {loading && (
        <span
          className="hsp-button-spinner"
          style={{ width: GLYPH_SIZE[size], height: GLYPH_SIZE[size] }}
          role="progressbar"
          aria-label="Loading"
        />
      )}
      {showResult && (
        <ResultIcon className="hsp-button-result" size={GLYPH_SIZE[size] + 2} strokeWidth={2.5} aria-label="Done" />
      )}
      <span className="hsp-button-label">{text}</span>
      {link?.external && <ExternalGlyph size={GLYPH_SIZE[size]} />}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ButtonRow
// ---------------------------------------------------------------------------

/** Horizontal gap between buttons in a ButtonRow (px; mirrored in buttons.css). */
const ROW_GAP = 8;
/** Width assumed for the "More" button before it has been measured. */
const MORE_WIDTH_ESTIMATE = 88;

/**
 * How many leading items of a ButtonRow fit on one line. When not all of them fit, room is kept
 * for the overflow ("More") button. An unmeasured row (width 0, e.g. not laid out) keeps all.
 */
export function fitButtonRow(widths: number[], available: number, gap: number, moreWidth: number): number {
  if (!(available > 0)) return widths.length;
  const total = widths.reduce((sum, w, i) => sum + w + (i > 0 ? gap : 0), 0);
  if (total <= available + 0.5) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const w of widths) {
    if (used + gap + w > available + 0.5) break;
    used += gap + w;
    count++;
  }
  return count;
}

interface RowItem {
  key: string;
  node: ReactNode;
}

/** Flattens children (unwrapping fragments) into keyed items; one item per child component. */
function rowItems(children: ReactNode, prefix = ''): RowItem[] {
  const out: RowItem[] = [];
  Children.toArray(children).forEach((child, index) => {
    const key = `${prefix}${isValidElement(child) && child.key !== null ? child.key : index}`;
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...rowItems((child.props as { children?: ReactNode }).children, `${key}/`));
    } else {
      out.push({ key, node: child });
    }
  });
  return out;
}

function ButtonRowPreview(p: PreviewProps) {
  // Separate components so hooks stay unconditional; switching modes remounts the row.
  return p.mode === 'design' ? <ButtonRowDesign {...p} /> : <ButtonRowLive {...p} />;
}

/** Design mode: every button stays visible (wrapping) so each one can be selected and edited. */
function ButtonRowDesign({ children, rootProps }: PreviewProps) {
  return (
    <div {...rootProps} className={cx('hsp-button-row', 'hsp-button-row--wrap', rootProps.className)}>
      {children}
    </div>
  );
}

/**
 * Preview mode: like HubSpot, buttons that don't fit on one line collapse into a dropdown menu
 * button at the end of the row (configured with `dropDownButtonOptions`, inert when
 * `disableDropdown`). Widths are measured after each render (before paint) and cached per item, so
 * items currently in the menu can return once the row grows.
 */
function ButtonRowLive({ props, children, rootProps }: PreviewProps) {
  const items = rowItems(children);
  const keys = items.map((i) => i.key);
  const rowRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const moreWidth = useRef<number | null>(null);
  const [visible, setVisible] = useState(Number.POSITIVE_INFINITY);
  const [open, setOpen] = useState(false);

  const options = isRecord(props.dropDownButtonOptions) ? props.dropDownButtonOptions : {};
  const moreText = textOr(options.text, 'More');
  const moreSize = buttonSize(options.size);
  const disableDropdown = bool(props.disableDropdown);

  const keysRef = useRef(keys);
  keysRef.current = keys;
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    for (const el of Array.from(row.children)) {
      const key = el instanceof HTMLElement ? el.dataset.rowKey : undefined;
      if (key !== undefined) widths.current.set(key, el.getBoundingClientRect().width);
    }
    if (moreRef.current) moreWidth.current = moreRef.current.getBoundingClientRect().width;
    // Forget items that are gone (e.g. deleted buttons) so the cache stays bounded.
    for (const key of Array.from(widths.current.keys())) if (!keysRef.current.includes(key)) widths.current.delete(key);
    const known = keysRef.current.map((k) => widths.current.get(k));
    // A new item that has never been laid out: render everything inline once to measure it.
    if (known.some((w) => w === undefined)) {
      setVisible(Number.POSITIVE_INFINITY);
      return;
    }
    const next = fitButtonRow(known as number[], row.clientWidth, ROW_GAP, moreWidth.current ?? MORE_WIDTH_ESTIMATE);
    setVisible(next >= known.length ? Number.POSITIVE_INFINITY : next);
  }, []);

  // Re-measure after every render (children or labels may have changed); setState bails out when equal.
  useLayoutEffect(measure);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure]);

  const shown = items.slice(0, visible);
  const overflow = items.slice(shown.length);
  // Drop a stale "open" once the menu is unavailable, so it doesn't pop back up later.
  if (open && (overflow.length === 0 || disableDropdown)) setOpen(false);
  const isOpen = open && overflow.length > 0 && !disableDropdown;
  useDismiss(isOpen, moreRef, () => setOpen(false));
  // The overflow button sits at the end of the row, so its menu opens towards the left.
  const alignRight = useMenuAlignment(isOpen, menuRef, true);

  return (
    <div {...rootProps} ref={rowRef} className={cx('hsp-button-row', rootProps.className)}>
      {shown.map((item) => (
        <span key={item.key} className="hsp-button-row-item" data-row-key={item.key}>
          {item.node}
        </span>
      ))}
      {overflow.length > 0 && (
        <div ref={moreRef} className="hsp-button-row-more">
          <Pressable
            mode="preview"
            className={buttonClass({
              variant: oneOf(options.variant, MENU_BUTTON_VARIANTS, 'secondary'),
              size: moreSize,
              disabled: disableDropdown,
              mode: 'preview',
            })}
            inactive={disableDropdown}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-label={moreText ? undefined : 'More actions'}
            onActivate={() => setOpen((o) => !o)}
          >
            {moreText ? (
              <span className="hsp-button-label">{moreText}</span>
            ) : (
              <Settings size={GLYPH_SIZE[moreSize] + 2} aria-hidden="true" />
            )}
            <ChevronDown className="hsp-button-caret" size={GLYPH_SIZE[moreSize]} strokeWidth={2.5} aria-hidden="true" />
          </Pressable>
          <div
            ref={menuRef}
            role="menu"
            hidden={!isOpen}
            className={cx(
              'hsp-dropdown-menu',
              'hsp-button-row-menu',
              alignRight ? 'hsp-dropdown-menu--right' : 'hsp-dropdown-menu--left',
            )}
            // A click on an item (after its own handler) closes the menu, as in HubSpot — except
            // the toggle of a Dropdown that overflowed into this menu, which opens its own menu.
            onClick={(e) => {
              if (e.target instanceof Element && e.target.closest('[aria-haspopup="menu"]')) return;
              setOpen(false);
            }}
          >
            {overflow.map((item) => (
              <div key={item.key} className="hsp-button-row-menu-item">
                {item.node}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dropdown & Dropdown.ButtonItem
// ---------------------------------------------------------------------------

function DropdownPreview({ props, children, rootProps, mode }: PreviewProps) {
  const size = buttonSize(props.buttonSize);
  const disabled = bool(props.disabled);
  const text = textOr(props.buttonText, 'More');
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  if (open && (mode === 'design' || disabled)) setOpen(false);
  const isOpen = open && mode === 'preview' && !disabled;
  useDismiss(isOpen, rootRef, () => setOpen(false));
  const alignRight = useMenuAlignment(isOpen, menuRef);

  const face = (
    <Pressable
      mode={mode}
      className={buttonClass({ variant: oneOf(props.variant, MENU_BUTTON_VARIANTS, 'secondary'), size, disabled, mode })}
      inactive={disabled}
      aria-haspopup="menu"
      aria-expanded={mode === 'preview' ? isOpen : undefined}
      onActivate={() => setOpen((o) => !o)}
    >
      {text && <span className="hsp-button-label">{text}</span>}
      <ChevronDown className="hsp-button-caret" size={GLYPH_SIZE[size]} strokeWidth={2.5} aria-hidden="true" />
    </Pressable>
  );

  if (mode === 'design') {
    // Menu items are always shown (in flow, framed) so they can be selected, edited and dropped.
    return (
      <div {...rootProps} ref={rootRef} className={cx('hsp-dropdown', 'hsp-dropdown--design', rootProps.className)}>
        {face}
        <div className="hsp-dropdown-menu hsp-dropdown-menu--design" role="menu">
          <span className="hsp-dropdown-caption">Menu · opens on click</span>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div {...rootProps} ref={rootRef} className={cx('hsp-dropdown', rootProps.className)}>
      {face}
      {/* Kept mounted while closed so item state survives; `hidden` is honoured by buttons.css. */}
      <div
        ref={menuRef}
        role="menu"
        hidden={!isOpen}
        className={cx('hsp-dropdown-menu', alignRight ? 'hsp-dropdown-menu--right' : 'hsp-dropdown-menu--left')}
        // Clicking an item runs its onClick (which may open its overlay) and closes the menu.
        onClick={() => setOpen(false)}
      >
        {children}
      </div>
    </div>
  );
}

function DropdownButtonItemPreview({ text, rootProps, mode, trigger }: PreviewProps) {
  return (
    <Pressable
      {...rootProps}
      mode={mode}
      role="menuitem"
      className={cx('hsp-dropdown-item', mode === 'preview' && 'hsp-dropdown-item--interactive', rootProps.className)}
      onActivate={(e) => trigger('onClick', extensionEvent(e))}
    >
      {text || (mode === 'design' ? <span className="hsp-buttons-placeholder">Menu item</span> : null)}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

function LinkPreview({ props, text, rootProps, mode, trigger }: PreviewProps) {
  const variant = oneOf(props.variant, LINK_VARIANTS, 'primary');
  const link = resolveHref(props.href);
  const className = cx(
    'hsp-link',
    `hsp-link--${variant}`,
    mode === 'preview' ? 'hsp-link--interactive' : 'hsp-link--design',
    rootProps.className,
  );
  const content = (
    <>
      {text || (mode === 'design' ? <span className="hsp-buttons-placeholder">Link text</span> : null)}
      {link?.external && <ExternalGlyph size={12} />}
    </>
  );

  if (mode === 'design') {
    return (
      <span {...rootProps} className={className} title={rootProps.title ?? link?.url}>
        {content}
      </span>
    );
  }

  const navigable = link?.navigable;
  const activate = (e: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) => {
    // `preventDefault` cancels navigation before onClick runs; unsafe/app-relative URLs never navigate.
    if (bool(props.preventDefault) || !navigable) e.preventDefault();
    trigger('onClick', extensionEvent(e));
  };
  return (
    <a
      {...rootProps}
      className={className}
      href={navigable}
      target={navigable ? '_blank' : undefined}
      rel={navigable ? 'noopener noreferrer' : undefined}
      // An anchor without href is not focusable/activatable by default.
      role={navigable ? undefined : 'link'}
      tabIndex={navigable ? undefined : 0}
      title={rootProps.title ?? (link && !navigable ? `HubSpot link: ${link.url}` : undefined)}
      onClick={activate}
      onKeyDown={(e) => {
        if (!navigable && e.key === 'Enter') activate(e);
      }}
    >
      {content}
    </a>
  );
}

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

/** Overlay triggers: clicking opens the attached Modal/Panel; a Tooltip shows on hover. */
const OVERLAY_SLOT: SlotDef = {
  name: 'overlay',
  label: 'Overlay',
  accepts: ['Modal', 'Panel', 'Tooltip'],
  max: 1,
  description: 'A Modal or Panel opened on click, or a Tooltip shown on hover.',
};

/** `onClick: ReactionsHandler<ExtensionEvent>` — HubSpot passes (event, reactions). */
const ON_CLICK_EVENT: EventDef = {
  name: 'onClick',
  label: 'On click',
  description: 'Runs when the component is clicked.',
  params: [{ name: 'event', description: 'ExtensionEvent { type, bubbles, timeStamp, id }' }],
};

const sizeProp = (name: string, label: string, description: string): PropDef => ({
  name,
  label,
  type: { kind: 'enum', options: BUTTON_SIZE_OPTIONS },
  defaultValue: 'medium',
  group: 'Appearance',
  description,
});

const DISABLED_PROP: PropDef = {
  name: 'disabled',
  label: 'Disabled',
  type: { kind: 'boolean' },
  defaultValue: false,
  group: 'Behavior',
  description: 'Greys the button out so it can’t be clicked. Use Rules or fx to disable it only sometimes.',
};

const BUTTON_TYPE_PROP: PropDef = {
  name: 'type',
  label: 'Button type',
  type: {
    kind: 'enum',
    options: [
      { value: 'button', label: 'Button' },
      { value: 'submit', label: 'Submit' },
      { value: 'reset', label: 'Reset' },
    ],
  },
  defaultValue: 'button',
  group: 'Behavior',
  description: 'Submit sends the form it is in; Reset empties the form. Leave it on Button for anything else.',
};

const BUTTON_HREF_PROP: PropDef = {
  name: 'href',
  label: 'Open a web page',
  type: { kind: 'href' },
  group: 'Behavior',
  description: 'Opens this web address when clicked (its click actions still run). Sites outside HubSpot open in a new tab.',
};

const TRUNCATE_PROP: PropDef = {
  name: 'truncate',
  label: 'Cut off long text',
  type: { kind: 'boolean' },
  defaultValue: false,
  group: 'Layout',
  description: 'Shortens long button text with “…”; the full text appears on hover.',
};

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const buttonComponents: ComponentDef[] = [
  {
    type: 'Button',
    label: 'Button',
    category: 'Buttons & links',
    description: 'A button that runs actions, submits a form, opens a URL or opens a modal/panel.',
    icon: MousePointerClick,
    docsUrl: `${STANDARD_DOCS}/button`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['action', 'cta', 'submit', 'click', 'primary', 'call to action'],
    children: { mode: 'text', defaultText: 'Click me' },
    create: () => ({ type: 'Button', props: { variant: 'primary' }, text: 'Click me' }),
    props: [
      {
        name: 'variant',
        label: 'Style',
        type: { kind: 'enum', options: variantOptions(BUTTON_VARIANTS) },
        defaultValue: 'secondary',
        group: 'Appearance',
        description: 'Primary is the main (orange) button, secondary is outlined, destructive (red) is for deleting, transparent looks like a link.',
      },
      sizeProp('size', 'Size', 'The size of the button.'),
      BUTTON_TYPE_PROP,
      BUTTON_HREF_PROP,
      DISABLED_PROP,
      TRUNCATE_PROP,
      TEST_ID_PROP,
    ],
    events: [{ ...ON_CLICK_EVENT, description: 'Runs when the button is clicked (also opens its overlay).' }],
    slots: [OVERLAY_SLOT],
    preview: ButtonPreview,
  },
  {
    type: 'LoadingButton',
    label: 'Loading button',
    category: 'Buttons & links',
    description: 'A button with a built-in loading spinner and a result icon once loading finishes.',
    icon: LoaderCircle,
    docsUrl: `${STANDARD_DOCS}/loading-button`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['spinner', 'async', 'progress', 'busy', 'save', 'submit', 'pending'],
    children: { mode: 'text', defaultText: 'Save changes' },
    create: () => ({ type: 'LoadingButton', props: { variant: 'primary' }, text: 'Save changes' }),
    props: [
      {
        name: 'variant',
        label: 'Style',
        type: { kind: 'enum', options: variantOptions(LOADING_BUTTON_VARIANTS) },
        defaultValue: 'secondary',
        group: 'Appearance',
        description: 'Primary is the main (orange) button, secondary is outlined, destructive (red) is for deleting.',
      },
      sizeProp('size', 'Size', 'The size of the button.'),
      {
        name: 'loading',
        label: 'Loading',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Shows a spinner and stops clicks while something runs. Usually linked to a variable your click actions set.',
      },
      {
        name: 'resultIconName',
        label: 'Icon when done',
        type: { kind: 'icon' },
        defaultValue: 'success',
        group: 'Appearance',
        description: 'The icon shown after loading finishes (a check mark unless you pick another).',
      },
      BUTTON_TYPE_PROP,
      BUTTON_HREF_PROP,
      DISABLED_PROP,
      {
        name: 'overlayOptions',
        label: 'Overlay options',
        group: 'Behavior',
        description: 'Configures when the attached overlay opens.',
        type: {
          kind: 'object',
          fields: [
            {
              name: 'openBehavior',
              label: 'Open overlay',
              type: {
                kind: 'enum',
                options: [
                  { value: 'onClick', label: 'On click' },
                  { value: 'onLoadingFinish', label: 'When loading finishes' },
                ],
              },
              defaultValue: 'onClick',
              description: 'Open the overlay as soon as the button is clicked, or once loading is done.',
            },
          ],
        },
      },
      TRUNCATE_PROP,
      TEST_ID_PROP,
    ],
    events: [{ ...ON_CLICK_EVENT, description: 'Runs when the button is clicked. Set Loading while the work runs.' }],
    slots: [OVERLAY_SLOT],
    preview: LoadingButtonPreview,
  },
  {
    type: 'ButtonRow',
    label: 'Button row',
    category: 'Buttons & links',
    description: "A row of buttons. Buttons that don't fit collapse into a dropdown menu.",
    icon: GalleryHorizontalEnd,
    docsUrl: `${STANDARD_DOCS}/button-row`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['buttons', 'actions', 'toolbar', 'group', 'row', 'footer'],
    children: {
      mode: 'nodes',
      accepts: ['Button', 'LoadingButton', 'Dropdown'],
      required: true,
      placeholder: 'Drop buttons here',
    },
    create: () => ({
      type: 'ButtonRow',
      children: [
        { type: 'Button', props: { variant: 'primary' }, text: 'Save' },
        { type: 'Button', text: 'Cancel' },
      ],
    }),
    props: [
      {
        name: 'disableDropdown',
        label: 'No “More” menu',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Buttons that don’t fit are not collected into a “More” menu.',
      },
      {
        name: 'dropDownButtonOptions',
        label: '“More” button',
        group: 'Appearance',
        description: 'The button that collects buttons that don’t fit in the row.',
        type: {
          kind: 'object',
          fields: [
            {
              name: 'text',
              label: 'Text',
              type: { kind: 'string', placeholder: 'More' },
              defaultValue: 'More',
              description: 'Button text. An empty value shows a gear icon.',
            },
            {
              name: 'size',
              label: 'Size',
              type: { kind: 'enum', options: BUTTON_SIZE_OPTIONS },
              defaultValue: 'medium',
            },
            {
              name: 'variant',
              label: 'Variant',
              type: { kind: 'enum', options: variantOptions(MENU_BUTTON_VARIANTS) },
              defaultValue: 'secondary',
            },
          ],
        },
      },
      TEST_ID_PROP,
    ],
    preview: ButtonRowPreview,
  },
  {
    type: 'Dropdown',
    label: 'Dropdown',
    category: 'Buttons & links',
    description: 'A button or link that opens a menu of actions (Dropdown.ButtonItem children).',
    icon: SquareChevronDown,
    docsUrl: `${STANDARD_DOCS}/dropdown`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['menu', 'actions', 'more', 'options', 'popover', 'overflow', 'kebab'],
    // The deprecated `options` prop (label + onClick functions) is intentionally not offered:
    // functions cannot live in the document, and Dropdown.ButtonItem children replace it.
    children: { mode: 'nodes', accepts: ['Dropdown.ButtonItem'], placeholder: 'Drop menu items here' },
    create: () => ({
      type: 'Dropdown',
      props: { buttonText: 'Actions' },
      children: [
        { type: 'Dropdown.ButtonItem', text: 'Edit record' },
        { type: 'Dropdown.ButtonItem', text: 'Archive' },
      ],
    }),
    props: [
      {
        name: 'buttonText',
        label: 'Button text',
        type: { kind: 'string', placeholder: 'More' },
        defaultValue: 'More',
        group: 'Content',
        description: 'The text of the dropdown button.',
      },
      {
        name: 'variant',
        label: 'Style',
        type: { kind: 'enum', options: variantOptions(MENU_BUTTON_VARIANTS) },
        defaultValue: 'secondary',
        group: 'Appearance',
        description: 'How the menu button looks; transparent shows it as a link.',
      },
      sizeProp('buttonSize', 'Button size', 'The size of the dropdown button.'),
      {
        ...DISABLED_PROP,
        description: 'Prevents the dropdown button from being focused or clicked.',
      },
      TEST_ID_PROP,
    ],
    preview: DropdownPreview,
  },
  {
    type: 'Dropdown.ButtonItem',
    importName: 'Dropdown',
    label: 'Dropdown item',
    category: 'Buttons & links',
    description: 'A single action in a Dropdown menu. Can open a modal or panel.',
    icon: SquareMenu,
    docsUrl: `${STANDARD_DOCS}/dropdown`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['menu item', 'option', 'action', 'dropdown'],
    parents: ['Dropdown'],
    children: { mode: 'text', defaultText: 'Menu item' },
    create: () => ({ type: 'Dropdown.ButtonItem', text: 'Menu item' }),
    props: [TEST_ID_PROP],
    events: [{ ...ON_CLICK_EVENT, description: 'Runs when the menu item is clicked (also opens its overlay).' }],
    slots: [{ ...OVERLAY_SLOT, accepts: ['Modal', 'Panel'], description: 'A Modal or Panel opened on click.' }],
    preview: DropdownButtonItemPreview,
  },
  {
    type: 'Link',
    label: 'Link',
    category: 'Buttons & links',
    description: 'A clickable hyperlink to an external page or another part of HubSpot.',
    icon: LinkIcon,
    docsUrl: `${STANDARD_DOCS}/link`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['hyperlink', 'url', 'anchor', 'href', 'navigate', 'external'],
    children: { mode: 'text', defaultText: 'Learn more' },
    create: () => ({ type: 'Link', props: { href: 'https://developers.hubspot.com/docs' }, text: 'Learn more' }),
    props: [
      {
        name: 'href',
        label: 'Web address',
        type: { kind: 'href' },
        required: true,
        group: 'Content',
        description: 'Where the link goes. Sites outside HubSpot open in a new tab with an external-link icon.',
      },
      {
        name: 'variant',
        label: 'Color',
        type: {
          kind: 'enum',
          options: [
            { value: 'primary', label: 'Blue (primary)', swatch: HS_SWATCH.link },
            { value: 'destructive', label: 'Red (destructive)', swatch: { fill: 'transparent', text: '#f2545b' } },
            { value: 'light', label: 'Light', swatch: HS_SWATCH.light },
            { value: 'dark', label: 'Dark', swatch: HS_SWATCH.dark },
          ],
        },
        defaultValue: 'primary',
        group: 'Appearance',
        description: 'The link’s color. Light is for dark backgrounds.',
      },
      {
        name: 'preventDefault',
        label: 'Don’t open the address',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Clicking runs the link’s actions (Events) without opening the web address.',
      },
      TEST_ID_PROP,
    ],
    events: [{ ...ON_CLICK_EVENT, description: 'Runs when the link is clicked (also opens its overlay).' }],
    slots: [OVERLAY_SLOT],
    preview: LinkPreview,
  },
];
