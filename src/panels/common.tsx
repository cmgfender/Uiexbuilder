/**
 * Shared widgets of the panels module: commit-on-blur inputs, chip editors with suggestions,
 * JSON editors, URL list editors and copy buttons. All styles use the `ub-pn-` prefix.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Plus, TriangleAlert, X } from 'lucide-react';
import type { JsonValue } from '../model/types';
import { Button, IconButton, TextArea, TextInput, cx } from '../ui';
import { copyText } from './utils';

// ---------------------------------------------------------------------------
// CommitInput: edits a value locally and commits on Enter / blur when valid
// ---------------------------------------------------------------------------

export interface CommitInputProps {
  value: string;
  onCommit: (value: string) => void;
  /** Returns an error message, or null when valid. */
  validate?: (value: string) => string | null;
  'aria-label': string;
  placeholder?: string;
  code?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  /** Text shown after the input (e.g. `.tsx`). */
  suffix?: ReactNode;
  disabled?: boolean;
  /** Hide the inline error message (the input still turns red). */
  hideError?: boolean;
  id?: string;
}

export function CommitInput({
  value,
  onCommit,
  validate,
  placeholder,
  code,
  className,
  inputRef,
  autoFocus,
  suffix,
  disabled,
  hideError,
  id,
  ...rest
}: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = (revertInvalid: boolean) => {
    const next = code ? draft.trim() : draft;
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const err = validate?.(next) ?? null;
    if (err) {
      if (revertInvalid) {
        setDraft(value);
        setError(null);
      } else setError(err);
      return;
    }
    setError(null);
    onCommit(next);
  };

  return (
    <div className={cx('ub-pn-commit', className)}>
      <div className="ub-pn-commit__row">
        <input
          id={id}
          ref={inputRef}
          className={cx('ub-input', code && 'ub-input--code', error && 'ub-input--invalid')}
          value={draft}
          spellCheck={code ? false : undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={rest['aria-label']}
          aria-invalid={error ? true : undefined}
          aria-describedby={error && !hideError ? errorId : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            const trimmed = code ? v.trim() : v;
            setError(trimmed === value ? null : validate?.(trimmed) ?? null);
          }}
          onBlur={() => commit(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(false);
            } else if (e.key === 'Escape' && draft !== value) {
              // Revert the draft (and keep an enclosing dialog open).
              e.preventDefault();
              e.stopPropagation();
              setDraft(value);
              setError(null);
            }
          }}
        />
        {suffix && <span className="ub-pn-commit__suffix">{suffix}</span>}
      </div>
      {error && !hideError && (
        <div className="ub-field__error" id={errorId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suggestion list (shared by ChipInput and SuggestInput)
// ---------------------------------------------------------------------------

export interface Suggestion {
  value: string;
  /** Secondary text, e.g. a property label or scope description. */
  detail?: string;
}

function filterSuggestions(suggestions: Suggestion[], query: string, exclude: Set<string>, limit = 8): Suggestion[] {
  const q = query.trim().toLowerCase();
  const exact: Suggestion[] = [];
  const out: Suggestion[] = [];
  const later: Suggestion[] = [];
  for (const s of suggestions) {
    if (exclude.has(s.value)) continue;
    const v = s.value.toLowerCase();
    const d = (s.detail ?? '').toLowerCase();
    if (q && v === q) exact.push(s);
    else if (!q || v.startsWith(q)) out.push(s);
    else if (v.includes(q) || d.includes(q)) later.push(s);
  }
  return [...exact, ...out, ...later].slice(0, limit);
}

/** Position of a floating list under its anchor (viewport coordinates), kept in sync on scroll/resize. */
function useAnchorRect(anchor: RefObject<HTMLElement>, active: boolean): { left: number; top: number; width: number; flip: boolean } | null {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; flip: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const flip = below < 200 && r.top > below;
      setRect({ left: r.left, top: flip ? r.top - 4 : r.bottom + 4, width: r.width, flip });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor, active]);
  return rect;
}

function SuggestionList({
  id,
  items,
  active,
  onPick,
  onHover,
  anchor,
}: {
  id: string;
  items: Suggestion[];
  active: number;
  onPick: (value: string) => void;
  onHover: (index: number) => void;
  anchor: RefObject<HTMLElement>;
}) {
  const rect = useAnchorRect(anchor, items.length > 0);
  if (items.length === 0 || !rect) return null;
  return createPortal(
    <ul
      className="ub-pn-suggest"
      id={id}
      role="listbox"
      style={{
        left: rect.left,
        width: Math.max(rect.width, 200),
        ...(rect.flip ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
      }}
    >
      {items.map((s, i) => (
        <li
          key={s.value}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          className={cx('ub-pn-suggest__item', i === active && 'ub-pn-suggest__item--active')}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(s.value);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="ub-pn-suggest__value">{s.value}</span>
          {s.detail && <span className="ub-pn-suggest__detail">{s.detail}</span>}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

/**
 * Keyboard handling for a suggestion list. Returns true when the key was consumed. With
 * `highlightFirst`, the first item is active whenever the list opens or changes (a combobox where
 * Enter takes the visible suggestion).
 */
function useSuggestionNav(items: Suggestion[], wantOpen: boolean, highlightFirst = false) {
  const [active, setActive] = useState(-1);
  // Escape hides the list until the suggestions change (typing) or the field is re-focused.
  const [dismissed, setDismissed] = useState(false);
  const open = wantOpen && !dismissed;
  const signature = items.map((i) => i.value).join('\n');
  useEffect(() => setActive(highlightFirst && open && items.length > 0 ? 0 : -1), [signature, items.length, open, highlightFirst]);
  useEffect(() => setDismissed(false), [signature]);
  useEffect(() => {
    if (!wantOpen) setDismissed(false);
  }, [wantOpen]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open || items.length === 0) return false;
    if (e.key === 'Escape') {
      // Close only the list; keep an enclosing dialog open.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
      return true;
    }
    return false;
  };
  return { active, setActive, onKey, open };
}

// ---------------------------------------------------------------------------
// ChipInput: a list of strings edited as chips, with autocomplete
// ---------------------------------------------------------------------------

export interface ChipWarning {
  message: string;
  /** A replacement value offered as a one-click fix. */
  fix?: string;
}

export interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: Suggestion[];
  placeholder?: string;
  validate?: (value: string) => string | null;
  /** Non-blocking warning for an added value (shown on the chip and below the field). */
  warn?: (value: string) => ChipWarning | null;
  'aria-label': string;
  /** Monospace chips (identifiers, scopes). Default true. */
  mono?: boolean;
  /** Tooltip / secondary text for a chip. */
  describe?: (value: string) => string | undefined;
  disabled?: boolean;
}

/**
 * Chips with autocomplete. While suggestions are shown for typed text, the first one is
 * highlighted and Enter / Tab add it (as in any combobox); Shift+Enter, or Escape then Enter, adds
 * the text as typed. Text matching no suggestion is added on Enter, Tab, comma or blur. Leaving
 * the field with text that only partly matches suggestions keeps it as a draft instead of adding
 * a half-typed value.
 */
export function ChipInput({
  values,
  onChange,
  suggestions = [],
  placeholder = 'Add…',
  validate,
  warn,
  mono = true,
  describe,
  disabled,
  ...rest
}: ChipInputProps) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const noticeId = useId();
  const present = useMemo(() => new Set(values), [values]);
  const items = useMemo(() => filterSuggestions(suggestions, draft, present), [suggestions, draft, present]);
  const nav = useSuggestionNav(items, focused && items.length > 0, draft.trim() !== '');
  const open = nav.open;
  const warnings = useMemo(
    () => (warn ? values.map((v) => ({ value: v, warning: warn(v) })).filter((w): w is { value: string; warning: ChipWarning } => !!w.warning) : []),
    [values, warn],
  );

  const add = useCallback(
    (raw: string | string[]): boolean => {
      const list = (Array.isArray(raw) ? raw : [raw]).map((v) => v.trim()).filter(Boolean);
      if (list.length === 0) return false;
      const next = [...values];
      for (const v of list) {
        const err = validate?.(v) ?? null;
        if (err) {
          setError(`${v}: ${err}`);
          return false;
        }
        if (!next.includes(v)) next.push(v);
      }
      setError(null);
      setNotice(null);
      if (next.length !== values.length) onChange(next);
      setDraft('');
      return true;
    },
    [values, onChange, validate],
  );

  const remove = (v: string) => onChange(values.filter((x) => x !== v));
  const replace = (from: string, to: string) => {
    const next: string[] = [];
    for (const v of values) {
      const value = v === from ? to : v;
      if (!next.includes(value)) next.push(value);
    }
    onChange(next);
  };

  /** Typed text that matches suggestions only partly (e.g. `life` while `lifecyclestage` is offered). */
  const isPartialMatch = (text: string): boolean => {
    const q = text.trim().toLowerCase();
    if (!q) return false;
    const candidates = filterSuggestions(suggestions, text, present);
    return candidates.length > 0 && !candidates.some((s) => s.value.toLowerCase() === q);
  };

  return (
    <div className="ub-pn-chips-wrap">
      <div
        ref={boxRef}
        className={cx('ub-pn-chips', focused && 'ub-pn-chips--focus', error && 'ub-pn-chips--invalid', disabled && 'ub-pn-chips--disabled')}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {values.map((v) => {
          const warning = warnings.find((w) => w.value === v)?.warning;
          return (
            <span
              key={v}
              className={cx('ub-pn-chip', mono && 'ub-pn-chip--mono', warning && 'ub-pn-chip--warn')}
              title={warning?.message ?? describe?.(v)}
            >
              {warning && <TriangleAlert size={11} aria-hidden className="ub-pn-chip__icon" />}
              <span className="ub-pn-chip__text">{v}</span>
              {!disabled && (
                <button type="button" className="ub-pn-chip__remove" aria-label={`Remove ${v}`} title={`Remove ${v}`} onClick={() => remove(v)}>
                  <X size={11} aria-hidden />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <input
            ref={inputRef}
            className={cx('ub-pn-chips__input', mono && 'ub-pn-chips__input--mono')}
            value={draft}
            placeholder={values.length ? '' : placeholder}
            aria-label={rest['aria-label']}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && nav.active >= 0 ? `${listId}-${nav.active}` : undefined}
            aria-describedby={notice ? noticeId : undefined}
            spellCheck={false}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (!draft.trim()) return;
              // Never save half-typed text that is the start of a suggestion: keep it as a draft.
              if (suggestions.length > 0 && isPartialMatch(draft)) {
                setNotice(`“${draft.trim()}” was not added. Pick a suggestion, or press Shift+Enter to add it as typed.`);
                return;
              }
              add(draft);
            }}
            onChange={(e) => {
              setError(null);
              setNotice(null);
              const v = e.target.value;
              if (/[,\n]/.test(v)) add(v.split(/[,\n]/));
              else setDraft(v);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              if (/[,\s]/.test(text.trim())) {
                e.preventDefault();
                add(text.split(/[,\s]+/));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter: the text exactly as typed.
                if (draft.trim()) {
                  e.preventDefault();
                  add(draft);
                }
                return;
              }
              if (nav.onKey(e)) return;
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (open && nav.active >= 0 && items[nav.active]) {
                  e.preventDefault();
                  add(items[nav.active].value);
                } else if (draft.trim()) {
                  e.preventDefault();
                  add(draft);
                }
              } else if (e.key === 'Backspace' && draft === '' && values.length) {
                remove(values[values.length - 1]);
              }
            }}
          />
        )}
      </div>
      {open && (
        <SuggestionList id={listId} anchor={boxRef} items={items} active={nav.active} onPick={(v) => add(v)} onHover={nav.setActive} />
      )}
      {error && (
        <div className="ub-field__error" role="alert">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="ub-field__hint ub-pn-chips__notice" id={noticeId} role="status">
          {notice}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="ub-pn-chip-warnings" aria-label="Warnings">
          {warnings.map(({ value, warning }) => (
            <li key={value} className="ub-pn-chip-warning">
              <TriangleAlert size={12} aria-hidden className="ub-pn-chip-warning__icon" />
              <span>
                {warning.message}
                {warning.fix && !disabled && (
                  <>
                    {' '}
                    <button type="button" className="ub-pn-link" onClick={() => replace(value, warning.fix!)}>
                      Use “{warning.fix}”
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SuggestInput: single value text input with suggestions
// ---------------------------------------------------------------------------

export interface SuggestInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: Suggestion[];
  placeholder?: string;
  'aria-label': string;
  code?: boolean;
}

export function SuggestInput({ value, onChange, suggestions, placeholder, code = true, ...rest }: SuggestInputProps) {
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const items = useMemo(
    () => filterSuggestions(suggestions, value, new Set(suggestions.some((s) => s.value === value) ? [value] : [])),
    [suggestions, value],
  );
  const nav = useSuggestionNav(items, focused && items.length > 0);
  const open = nav.open;
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div className="ub-pn-chips-wrap" ref={wrapRef}>
      <TextInput
        value={value}
        code={code}
        placeholder={placeholder}
        aria-label={rest['aria-label']}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open && nav.active >= 0 ? `${listId}-${nav.active}` : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={onChange}
        onKeyDown={(e) => {
          if (nav.onKey(e)) return;
          if (e.key === 'Enter' && open && nav.active >= 0) {
            e.preventDefault();
            onChange(items[nav.active].value);
            setFocused(false);
          }
        }}
      />
      {open && (
        <SuggestionList
          id={listId}
          anchor={wrapRef}
          items={items}
          active={nav.active}
          onPick={(v) => {
            onChange(v);
            setFocused(false);
          }}
          onHover={nav.setActive}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JsonEditor
// ---------------------------------------------------------------------------

export interface JsonEditorProps {
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
  'aria-label': string;
  placeholder?: string;
  rows?: number;
  /** Called when the text is cleared (instead of reporting an error). */
  onClear?: () => void;
}

function stringify(value: JsonValue | undefined): string {
  return value === undefined ? '' : JSON.stringify(value, null, 2);
}

/** JSON text editor: commits parsed values while valid and shows parse errors inline. */
export function JsonEditor({ value, onChange, placeholder, rows = 4, onClear, ...rest }: JsonEditorProps) {
  const serialized = useMemo(() => (value === undefined ? undefined : JSON.stringify(value)), [value]);
  const [draft, setDraft] = useState(() => stringify(value));
  const [error, setError] = useState<string | null>(null);
  const lastCommitted = useRef(serialized);
  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      lastCommitted.current = serialized;
      setDraft(stringify(value));
      setError(null);
    }
  }, [serialized, value]);

  const pretty = useMemo(() => {
    if (draft.trim() === '') return null;
    try {
      return stringify(JSON.parse(draft) as JsonValue);
    } catch {
      return null;
    }
  }, [draft]);

  const update = (text: string) => {
    setDraft(text);
    if (text.trim() === '') {
      if (onClear) {
        setError(null);
        lastCommitted.current = undefined;
        onClear();
      } else setError('Enter a JSON value (e.g. "", 0, [] or {})');
      return;
    }
    try {
      const parsed = JSON.parse(text) as JsonValue;
      setError(null);
      lastCommitted.current = JSON.stringify(parsed);
      onChange(parsed);
    } catch (e) {
      setError((e as Error).message.replace(/^JSON\.parse: /, ''));
    }
  };

  return (
    <div className="ub-pn-json">
      <TextArea
        code
        value={draft}
        rows={Math.max(rows, Math.min(14, draft.split('\n').length))}
        placeholder={placeholder}
        invalid={!!error}
        aria-label={rest['aria-label']}
        aria-invalid={error ? true : undefined}
        onChange={update}
      />
      <div className="ub-pn-json__foot">
        {error ? (
          <span className="ub-field__error" role="alert">
            Invalid JSON — {error}
          </span>
        ) : (
          <span className="ub-field__hint">JSON</span>
        )}
        {!error && pretty !== null && pretty !== draft && (
          <button type="button" className="ub-pn-link" onClick={() => setDraft(pretty)}>
            Format
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      size={size}
      onClick={() => {
        void copyText(text).then((ok) => setCopied(ok));
      }}
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
    </IconButton>
  );
}

/** A code snippet with a copy button (inline or block). */
export function Snippet({ code, label, block }: { code: string; label?: string; block?: boolean }) {
  return (
    <span className={cx('ub-pn-snippet', block && 'ub-pn-snippet--block')}>
      <code className="ub-pn-snippet__code">{code}</code>
      <CopyButton text={code} label={label ?? `Copy ${code}`} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// ListEditor: editable list of strings (URLs) with validation
// ---------------------------------------------------------------------------

export interface ListEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  validate?: (value: string) => string | null;
  placeholder?: string;
  'aria-label': string;
  addLabel?: string;
  emptyText?: string;
}

export function ListEditor({ values, onChange, validate, placeholder, addLabel = 'Add', emptyText, ...rest }: ListEditorProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = rest['aria-label'];
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    const err = validate?.(v) ?? null;
    if (err) {
      setError(err);
      return;
    }
    if (values.includes(v)) {
      setError('Already in the list');
      return;
    }
    onChange([...values, v]);
    setDraft('');
    setError(null);
  };
  return (
    <div className="ub-pn-list" role="group" aria-label={label}>
      {values.length === 0 && emptyText && <div className="ub-pn-muted">{emptyText}</div>}
      {values.map((v, i) => (
        <div key={`${v}-${i}`} className="ub-pn-list__row">
          <CommitInput
            code
            value={v}
            aria-label={`${label} ${i + 1}`}
            validate={(next) => validate?.(next) ?? (values.some((x, j) => j !== i && x === next) ? 'Already in the list' : null)}
            onCommit={(next) => onChange(values.map((x, j) => (j === i ? next : x)))}
          />
          <IconButton label={`Remove ${v}`} size="sm" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            <X size={13} aria-hidden />
          </IconButton>
        </div>
      ))}
      <div className="ub-pn-list__row">
        <TextInput
          code
          value={draft}
          placeholder={placeholder}
          invalid={!!error}
          aria-label={`New ${label}`}
          onChange={(v) => {
            setDraft(v);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button size="sm" icon={<Plus size={13} aria-hidden />} onClick={add} disabled={!draft.trim()}>
          {addLabel}
        </Button>
      </div>
      {error && (
        <div className="ub-field__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

export function Callout({
  tone = 'info',
  icon,
  children,
  role,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  icon?: ReactNode;
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className={cx('ub-pn-callout', `ub-pn-callout--${tone}`)} role={role}>
      {icon && <span className="ub-pn-callout__icon">{icon}</span>}
      <div className="ub-pn-callout__body">{children}</div>
    </div>
  );
}

/** Toggle chips acting like checkboxes (e.g. HTTP methods). */
export function ToggleChips<T extends string>({
  options,
  values,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: T[];
  values: T[];
  onChange: (values: T[]) => void;
  'aria-label': string;
}) {
  return (
    <div className="ub-pn-toggles" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = values.includes(o);
        return (
          <button
            key={o}
            type="button"
            role="checkbox"
            aria-checked={on}
            className={cx('ub-pn-toggle', on && 'ub-pn-toggle--on')}
            onClick={() => onChange(on ? values.filter((v) => v !== o) : options.filter((x) => x === o || values.includes(x)))}
          >
            {on && <Check size={11} aria-hidden />}
            {o}
          </button>
        );
      })}
    </div>
  );
}
