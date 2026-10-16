/**
 * Minimal builder-chrome UI kit. All editor panels use these primitives (styles: src/styles/app.css)
 * so the GUI stays consistent. Keep components small and dependency-free.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'default', size = 'md', block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'ub-btn',
        variant !== 'default' && `ub-btn--${variant}`,
        size === 'sm' && 'ub-btn--sm',
        block && 'ub-btn--block',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label; also used as tooltip. */
  label: string;
  active?: boolean;
  size?: 'md' | 'sm';
}

export function IconButton({ label, active, size = 'md', className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx('ub-icon-btn', active && 'ub-icon-btn--active', size === 'sm' && 'ub-icon-btn--sm', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, htmlFor, children, actions, className }: FieldProps) {
  return (
    <div className={cx('ub-field', className)}>
      {(label || actions) && (
        <div className="ub-field__label" style={{ justifyContent: 'space-between' }}>
          {label ? <label htmlFor={htmlFor}>{label}</label> : <span />}
          {actions && <span style={{ display: 'inline-flex', gap: 2 }}>{actions}</span>}
        </div>
      )}
      {children}
      {error ? <div className="ub-field__error">{error}</div> : hint ? <div className="ub-field__hint">{hint}</div> : null}
    </div>
  );
}

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  code?: boolean;
}

export function TextInput({ value, onChange, invalid, code, className, ...rest }: TextInputProps) {
  return (
    <input
      className={cx('ub-input', invalid && 'ub-input--invalid', code && 'ub-input--code', className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={code ? false : undefined}
      {...rest}
    />
  );
}

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

/** Number field that allows transient empty / partial input while typing. */
export function NumberField({ value, onChange, className, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setDraft((d) => (Number(d) === value && d !== '' ? d : value === undefined ? '' : String(value)));
  }, [value]);
  return (
    <input
      type="number"
      className={cx('ub-input', className)}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value === '') onChange(undefined);
        else if (!Number.isNaN(Number(e.target.value))) onChange(Number(e.target.value));
      }}
      {...rest}
    />
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  code?: boolean;
  invalid?: boolean;
}

export function TextArea({ value, onChange, code, invalid, className, ...rest }: TextAreaProps) {
  return (
    <textarea
      className={cx('ub-textarea', code && 'ub-textarea--code', invalid && 'ub-input--invalid', className)}
      value={value}
      spellCheck={code ? false : undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // Allow tab indentation in code editors.
        if (code && e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const t = e.currentTarget;
          const { selectionStart, selectionEnd } = t;
          const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
          onChange(next);
          requestAnimationFrame(() => t.setSelectionRange(selectionStart + 2, selectionStart + 2));
        }
      }}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder, className, ...rest }: SelectProps) {
  return (
    <select className={cx('ub-select', className)} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <label className="ub-switch" style={disabled ? { opacity: 0.5 } : undefined}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ub-switch__track" aria-hidden />
      {label && <span>{label}</span>}
    </label>
  );
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  'aria-label'?: string;
}

export function Segmented<T extends string>({ value, onChange, options, ...rest }: SegmentedProps<T>) {
  return (
    <div className="ub-segmented" role="group" aria-label={rest['aria-label']}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs & sections
// ---------------------------------------------------------------------------

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<{ value: T; label: ReactNode; icon?: ReactNode; badge?: ReactNode }>;
  className?: string;
  'aria-label'?: string;
  /**
   * Id prefix linking the tabs to the panel the caller renders: each tab gets the id
   * `${idBase}-tab-${value}` and `aria-controls="${idBase}-panel"`; spread
   * `tabPanelProps(idBase, value)` on the panel element.
   */
  idBase?: string;
}

/** Props for the panel element that belongs to `<Tabs idBase>` (id, role and accessible name). */
export function tabPanelProps(idBase: string, value: string) {
  return { id: `${idBase}-panel`, role: 'tabpanel' as const, 'aria-labelledby': `${idBase}-tab-${value}` };
}

/**
 * Moves between the tabs of a tablist with Left/Right (wrapping), Home and End, and returns the
 * index to activate (null for other keys). Shared by the kit Tabs and hand-built tab strips.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return index <= 0 ? count - 1 : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * ARIA tabs: one Tab stop (the selected tab, roving tabindex); Left/Right/Home/End move to and
 * activate the neighbouring tab.
 */
export function Tabs<T extends string>({ value, onChange, tabs, className, idBase, ...rest }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = tabs.findIndex((t) => t.value === value);
  return (
    <div
      ref={listRef}
      className={cx('ub-tabs', className)}
      role="tablist"
      aria-label={rest['aria-label']}
      onKeyDown={(e) => {
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const buttons = Array.from(listRef.current?.querySelectorAll<HTMLElement>(':scope > [role="tab"]') ?? []);
        const current = buttons.indexOf(e.target as HTMLElement);
        if (current === -1) return;
        const next = tabKeyTarget(e.key, current, tabs.length);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        buttons[next]?.focus();
        if (tabs[next].value !== value) onChange(tabs[next].value);
      }}
    >
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={idBase ? `${idBase}-tab-${t.value}` : undefined}
            aria-controls={idBase ? `${idBase}-panel` : undefined}
            aria-selected={selected}
            tabIndex={selected || (selectedIndex === -1 && i === 0) ? 0 : -1}
            className="ub-tab"
            onClick={() => onChange(t.value)}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

export interface SectionProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}

export function Section({ title, children, defaultOpen = true, actions }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ub-section">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button type="button" className="ub-section__header" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {title}
          </span>
        </button>
        {actions && <div style={{ paddingRight: 8, display: 'flex', gap: 2 }}>{actions}</div>}
      </div>
      {open && <div className="ub-section__body">{children}</div>}
    </div>
  );
}

export function Badge({ tone, children, title }: { tone?: 'accent' | 'select' | 'danger' | 'warning' | 'success'; children: ReactNode; title?: string }) {
  return (
    <span className={cx('ub-badge', tone && `ub-badge--${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ub-empty">
      {icon}
      <div className="ub-empty__title">{title}</div>
      {children && <div>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Focus helpers
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  '[tabindex]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(', ');

function isRendered(el: HTMLElement): boolean {
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  // jsdom has no layout (and no checkVisibility): treat everything as rendered there.
  return typeof check === 'function' ? check.call(el, { visibilityProperty: true }) : !el.closest('[hidden]');
}

/** Elements inside `root` that Tab can reach, in DOM order (skips tabindex=-1, disabled, inert and hidden). */
export function tabbableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex >= 0 && !el.closest('[inert]') && isRendered(el),
  );
}

/** The element focused when a kit Menu last closed (the menu's opener), for dialogs opened from a menu item. */
let lastMenuReturn: { el: HTMLElement; at: number } | null = null;

function recentMenuOpener(maxAgeMs = 1000): HTMLElement | null {
  if (!lastMenuReturn || Date.now() - lastMenuReturn.at > maxAgeMs) return null;
  return lastMenuReturn.el.isConnected ? lastMenuReturn.el : null;
}

/** Background (`#root`) is made inert while at least one kit dialog is open. */
let openDialogs = 0;

function setBackgroundInert(inert: boolean): void {
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (!root) return;
  if (inert) root.setAttribute('inert', '');
  else root.removeAttribute('inert');
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/**
 * Modal dialog (portalled to <body>). While open: Tab / Shift+Tab cycle inside it, the app behind
 * it (`#root`) is inert, Escape closes the topmost dialog. On open the dialog keeps focus on an
 * autofocused field or focuses itself (announcing its title); on close focus returns to the
 * opener — the menu trigger when the dialog was opened from a menu item.
 */
export function Dialog({ open, onClose, title, children, footer, wide }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the open effect (which moves focus) on every render.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // The opener: the focused element outside this dialog, else the trigger of the menu whose item
    // opened it (the menu item itself is gone by now).
    let restore = active && active !== document.body && !node?.contains(active) ? active : null;
    if (!restore) restore = recentMenuOpener();
    const onKey = (e: KeyboardEvent) => {
      // Bubble phase: widgets inside the dialog (autocomplete lists, menus, inline editors) handle
      // Escape first and mark it handled with preventDefault().
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Only the topmost dialog closes when dialogs are stacked.
      const backdrops = document.querySelectorAll('.ub-dialog-backdrop');
      if (backdrops.length && backdrops[backdrops.length - 1] !== backdropRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    openDialogs++;
    setBackgroundInert(true);
    // Keep focus on a field the content focused itself (autoFocus); otherwise focus the dialog.
    if (node && !node.contains(document.activeElement)) node.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      openDialogs = Math.max(0, openDialogs - 1);
      if (openDialogs === 0) setBackgroundInert(false);
      // Return focus to where it was (e.g. the button that opened the dialog).
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected || (node?.contains(now) ?? false);
      if (lost && restore && restore.isConnected) restore.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  /** Focus trap: Tab from the last control wraps to the first, Shift+Tab from the first (or the dialog) to the last. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const node = ref.current;
    if (!node) return;
    const items = tabbableElements(node);
    const active = document.activeElement;
    if (items.length === 0) {
      e.preventDefault();
      node.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = !!active && node.contains(active);
    if (e.shiftKey && (!inside || active === first || active === node)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div ref={backdropRef} className="ub-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={cx('ub-dialog', wide && 'ub-dialog--wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ub-dialog__header">
          <h2 className="ub-dialog__title" id={titleId}>
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="ub-dialog__body">{children}</div>
        {footer && <div className="ub-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Menu (context menu / dropdown)
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface MenuProps {
  /** Viewport coordinates of the menu's top-left corner. */
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /**
   * Where focus goes when the menu closes while focus is inside it (Escape, choosing an item):
   * an element, or a function resolved at close time. Default: the element that was focused when
   * the menu opened (its trigger).
   */
  returnFocus?: HTMLElement | null | (() => HTMLElement | null | undefined);
  'aria-label'?: string;
}

/**
 * Menu with the ARIA menu keyboard model: it focuses its first enabled item when it opens,
 * Up/Down (wrapping), Home/End and Tab / Shift+Tab move between items, Escape closes it, and
 * closing returns focus to the opener.
 */
export function Menu({ x, y, items, onClose, returnFocus, ...rest }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // The element focused when the menu opened (read during the first render, before the menu
  // moves focus to its first item).
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  const returnFocusRef = useRef(returnFocus);
  useLayoutEffect(() => {
    returnFocusRef.current = returnFocus;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);
  useEffect(() => {
    const el = ref.current;
    enabledMenuItems(el)[0]?.focus({ preventScroll: true });
    return () => {
      const rf = returnFocusRef.current;
      const resolved = typeof rf === 'function' ? rf() : rf;
      const target = resolved && resolved.isConnected ? resolved : opener && opener.isConnected ? opener : null;
      lastMenuReturn = target ? { el: target, at: Date.now() } : null;
      // Only when focus was in the menu (now removed): an item that moved focus on purpose
      // (an inline rename field, a dialog's autofocus) keeps it.
      const active = document.activeElement;
      const lost = !active || active === document.body || !active.isConnected || (el?.contains(active) ?? false);
      if (lost && target) target.focus({ preventScroll: true });
    };
    // Mount / unmount only: focus moves into the menu once.
  }, []);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handled: an enclosing dialog stays open and global shortcuts ignore it.
        e.preventDefault();
        onClose();
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const list = enabledMenuItems(ref.current);
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const n = list.length;
      let next: number;
      switch (e.key) {
        case 'ArrowDown':
          next = i === -1 ? 0 : (i + 1) % n;
          break;
        case 'ArrowUp':
          next = i <= 0 ? n - 1 : i - 1;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = n - 1;
          break;
        case 'Tab':
          next = e.shiftKey ? (i <= 0 ? n - 1 : i - 1) : (i + 1) % n;
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
      list[next].focus();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="ub-menu" role="menu" aria-label={rest['aria-label']} style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ub-menu__sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={cx('ub-menu__item', item.danger && 'ub-menu__item--danger')}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect?.();
            }}
          >
            {item.icon}
            {item.label}
            {item.shortcut && <span className="ub-menu__shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

function enabledMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')) : [];
}

/** Hook for a dropdown menu anchored to a button. */
export function useMenu() {
  const [state, setState] = useState<{ x: number; y: number } | null>(null);
  const openAt = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setState({ x: r.left, y: r.bottom + 4 });
  }, []);
  const openAtPoint = useCallback((x: number, y: number) => setState({ x, y }), []);
  const close = useCallback(() => setState(null), []);
  return { position: state, openAt, openAtPoint, close };
}

// ---------------------------------------------------------------------------
// Toasts (builder notifications, not HubSpot alerts)
// ---------------------------------------------------------------------------

export interface ToastOptions {
  /** A button in the toast (e.g. "Reconnect"); clicking it also dismisses the toast. */
  action?: { label: string; onClick: () => void };
  /** How long the toast stays (default 2.6 s; toasts with an action stay 8 s). */
  durationMs?: number;
}

interface ToastCtx {
  toast: (message: string, options?: ToastOptions) => void;
}
const ToastContext = createContext<ToastCtx>({ toast: () => {} });

interface ToastItem {
  id: number;
  message: string;
  action?: ToastOptions['action'];
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, action: options.action }]);
      setTimeout(() => dismiss(id), options.durationMs ?? (options.action ? 8000 : 2600));
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="ub-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={cx('ub-toast', t.action && 'ub-toast--action')}>
              <span>{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="ub-toast__action"
                  onClick={() => {
                    dismiss(t.id);
                    t.action?.onClick();
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx['toast'] {
  return useContext(ToastContext).toast;
}
