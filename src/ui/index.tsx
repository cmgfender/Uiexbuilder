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
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: TabsProps<T>) {
  return (
    <div className={cx('ub-tabs', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          className="ub-tab"
          onClick={() => onChange(t.value)}
        >
          {t.icon}
          {t.label}
          {t.badge}
        </button>
      ))}
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

export function Dialog({ open, onClose, title, children, footer, wide }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="ub-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={cx('ub-dialog', wide && 'ub-dialog--wide')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
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
}

export function Menu({ x, y, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
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
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
    <div ref={ref} className="ub-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ub-menu__sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
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

interface ToastCtx {
  toast: (message: string) => void;
}
const ToastContext = createContext<ToastCtx>({ toast: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([]);
  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);
  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="ub-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="ub-toast">
              {t.message}
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
