/**
 * Shared expression / template controls (used by the inspector and the data panels).
 *
 *  - useScopeVariables(ext, nodeId, eventParams): identifiers/paths in scope at a node.
 *  - ExpressionInput: JavaScript expression (or statements) editor with autocomplete, a variable
 *    picker, syntax checking and a live "= value" preview.
 *  - TemplateInput: text with `{{ expression }}` segments; typing `{{` opens the same autocomplete
 *    and a subtle preview line shows the interpolated result.
 *  - VariablePicker: `{x}` button + searchable popover of everything in scope, grouped by kind.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Braces, Search } from 'lucide-react';
import { useEditor } from '../model/store';
import { hasTemplate, parseTemplate, singleExpression, templateExpressions, toText } from '../model/template';
import type { Extension, NodeId } from '../model/types';
import { checkExpressionSyntax, checkStatementsSyntax, createInitialScope, useOptionalRuntime, type Scope } from '../runtime';
import { cx } from '../ui';
import {
  applyExpressionSuggestion,
  applyTemplateSuggestion,
  expressionTokenAt,
  filterSuggestions,
  insertAt,
  liveKeySuggestions,
  mergeVariables,
  templateTokenAt,
  type TemplateTokenInfo,
  type TokenInfo,
} from './autocomplete';
import { Popover } from './Popover';
import { formatPreviewValue } from './propValue';
import {
  buildPreviewScope,
  CUSTOM_CODE_GLOBALS,
  listScopeVariables,
  safeEvaluate,
  SCOPE_KIND_LABELS,
  SCOPE_KIND_ORDER,
  type ScopeVariable,
} from './scope';
import './inspector.css';

export type { ScopeVariable, ScopeVariableKind } from './scope';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Lists identifiers/paths in scope for a node (and optional event params). */
export function useScopeVariables(ext: Extension, nodeId?: NodeId | null, eventParams?: string[]): ScopeVariable[] {
  const paramsKey = eventParams ? eventParams.join('\u0000') : '\u0001';
  return useMemo(
    () => listScopeVariables(ext, nodeId, eventParams),
    [ext.state, ext.computed, ext.dataSources, ext.helpers, ext.nodes, nodeId, paramsKey],
  );
}

/**
 * Scope for live previews at a node: the running preview's values when a RuntimeProvider for this
 * extension is mounted (initial values otherwise), with setters neutralised and the first item of
 * enclosing repeats bound.
 */
export function usePreviewScope(ext: Extension, nodeId?: NodeId | null): Scope {
  const runtime = useOptionalRuntime();
  const project = useEditor((s) => s.project);
  const base = runtime && runtime.extension.id === ext.id ? runtime.scope : null;
  const fallback = useMemo(() => {
    if (base) return null;
    try {
      return createInitialScope(project, ext);
    } catch {
      return {} as Scope;
    }
  }, [base, project, ext]);
  return useMemo(() => buildPreviewScope(ext, base ?? fallback ?? {}, nodeId), [ext, base, fallback, nodeId]);
}

/** `value` once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms, settled]);
  return settled;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

type AnyInput = HTMLInputElement | HTMLTextAreaElement;
type Mode = 'expr' | 'template';

interface AcState {
  items: ScopeVariable[];
  index: number;
  token: TokenInfo | TemplateTokenInfo;
}

function computeSuggestions(
  mode: Mode,
  value: string,
  cursor: number,
  vars: ScopeVariable[],
  scope: Scope,
  force: boolean,
): AcState | null {
  const token = mode === 'expr' ? expressionTokenAt(value, cursor) : templateTokenAt(value, cursor);
  if (!token) {
    if (mode === 'expr' && force) {
      const items = filterSuggestions(vars, '');
      return items.length ? { items, index: 0, token: { start: cursor, end: cursor, text: '' } } : null;
    }
    return null;
  }
  if (mode === 'expr' && !token.text && !force) return null;
  const pool = mergeVariables(vars, liveKeySuggestions(token.text, scope));
  const items = filterSuggestions(pool, token.text);
  return items.length ? { items, index: 0, token } : null;
}

interface AutocompleteOptions {
  mode: Mode;
  value: string;
  onChange: (value: string) => void;
  vars: ScopeVariable[];
  scope: Scope;
  inputRef: React.RefObject<AnyInput>;
}

function useAutocomplete({ mode, value, onChange, vars, scope, inputRef }: AutocompleteOptions) {
  const [ac, setAc] = useState<AcState | null>(null);
  const pendingCursor = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (pendingCursor.current === null || !el) return;
    const c = Math.min(pendingCursor.current, el.value.length);
    pendingCursor.current = null;
    try {
      el.focus();
      el.setSelectionRange(c, c);
    } catch {
      /* element not focusable */
    }
  });

  const close = useCallback(() => setAc(null), []);

  // Close the list when the value changes from outside (undo, reset) — its token would be stale.
  const typed = useRef(value);
  useEffect(() => {
    if (value !== typed.current) {
      typed.current = value;
      setAc(null);
    }
  }, [value]);

  const commit = useCallback(
    (next: string, cursor: number) => {
      pendingCursor.current = cursor;
      onChange(next);
    },
    [onChange],
  );

  const accept = useCallback(
    (state: AcState, index: number) => {
      const item = state.items[index];
      if (!item) return;
      const res =
        mode === 'expr'
          ? applyExpressionSuggestion(value, state.token, item.name)
          : applyTemplateSuggestion(value, state.token as TemplateTokenInfo, item.name);
      setAc(null);
      commit(res.value, res.cursor);
    },
    [mode, value, commit],
  );

  const onInputChange = (e: ChangeEvent<AnyInput>) => {
    const next = e.target.value;
    const cursor = e.target.selectionStart ?? next.length;
    typed.current = next;
    onChange(next);
    setAc(computeSuggestions(mode, next, cursor, vars, scope, false));
  };

  const onKeyDown = (e: ReactKeyboardEvent<AnyInput>): boolean => {
    if (ac) {
      const n = ac.items.length;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index + 1) % n });
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAc({ ...ac, index: (ac.index - 1 + n) % n });
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(ac, ac.index);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setAc(null);
        return true;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setAc(null);
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.code === 'Space')) {
      e.preventDefault();
      const el = e.currentTarget;
      setAc(computeSuggestions(mode, el.value, el.selectionStart ?? el.value.length, vars, scope, true));
      return true;
    }
    return false;
  };

  /** Inserts a picked variable at the cursor (replacing a partially typed name). */
  const insertVariable = (name: string) => {
    const el = inputRef.current;
    const selStart = el?.selectionStart ?? value.length;
    const selEnd = el?.selectionEnd ?? selStart;
    let res;
    if (mode === 'expr') {
      const tok = selStart === selEnd ? expressionTokenAt(value, selStart) : null;
      res = tok ? applyExpressionSuggestion(value, tok, name) : insertAt(value, selStart, selEnd, name);
    } else {
      const tok = selStart === selEnd ? templateTokenAt(value, selStart) : null;
      res = tok ? applyTemplateSuggestion(value, tok, name) : insertAt(value, selStart, selEnd, `{{ ${name} }}`);
    }
    setAc(null);
    commit(res.value, res.cursor);
  };

  return { ac, setAc, close, accept, onInputChange, onKeyDown, insertVariable };
}

function SuggestionList({
  anchor,
  ac,
  listId,
  onPick,
  onClose,
  onHover,
}: {
  anchor: HTMLElement | null;
  ac: AcState | null;
  listId: string;
  onPick: (index: number) => void;
  onClose: () => void;
  onHover: (index: number) => void;
}) {
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [ac?.index]);
  return (
    <Popover
      anchor={anchor}
      open={!!ac}
      onClose={onClose}
      width="anchor"
      maxHeight={240}
      role="listbox"
      id={listId}
      aria-label="Suggestions"
    >
      {ac?.items.map((v, i) => (
        <div
          key={v.name}
          id={`${listId}-${i}`}
          ref={i === ac.index ? activeRef : undefined}
          role="option"
          aria-selected={i === ac.index}
          className={cx('ub-insp-ac__item', i === ac.index && 'is-active')}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(i);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className={cx('ub-insp-kind', `ub-insp-kind--${v.kind}`)} aria-hidden>
            {KIND_GLYPH[v.kind]}
          </span>
          <span className="ub-insp-ac__name">{v.name}</span>
          {v.detail && <span className="ub-insp-ac__detail">{v.detail}</span>}
        </div>
      ))}
    </Popover>
  );
}

const KIND_GLYPH: Record<ScopeVariable['kind'], string> = {
  state: 'S',
  setter: 'ƒ',
  computed: 'C',
  dataSource: 'D',
  property: 'P',
  helper: 'ƒ',
  context: 'X',
  repeat: 'R',
  param: 'E',
  global: 'G',
};

// ---------------------------------------------------------------------------
// ExpressionInput
// ---------------------------------------------------------------------------

export interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  placeholder?: string;
  multiline?: boolean;
  /** Statements mode (custom code) instead of a single expression. */
  statements?: boolean;
  'aria-label'?: string;
  /** Element id (for <label htmlFor>). */
  id?: string;
  /** Force the invalid style (e.g. a validation error reported by the parent). */
  invalid?: boolean;
  /** Hide the live "= value" preview line. */
  hidePreview?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  className?: string;
}

/** JavaScript expression editor. */
export function ExpressionInput(props: ExpressionInputProps) {
  const { value, onChange, ext, nodeId, eventParams, placeholder, multiline, statements, hidePreview, className } = props;
  const baseVars = useScopeVariables(ext, nodeId, eventParams);
  const handlerContext = !!statements || eventParams !== undefined;
  const vars = useMemo(() => {
    const v = handlerContext ? baseVars : baseVars.filter((x) => x.kind !== 'setter');
    return statements ? [...v, ...CUSTOM_CODE_GLOBALS] : v;
  }, [baseVars, handlerContext, statements]);
  const scope = usePreviewScope(ext, nodeId);
  const inputRef = useRef<AnyInput>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const auto = useAutocomplete({ mode: 'expr', value, onChange, vars, scope, inputRef });

  const settled = useSettled(value, 300);
  const error = useMemo(
    () => (settled.trim() ? (statements ? checkStatementsSyntax(settled) : checkExpressionSyntax(settled)) : null),
    [settled, statements],
  );
  const preview = useMemo(() => {
    if (statements || hidePreview || error || !settled.trim()) return null;
    const r = safeEvaluate(settled, scope);
    if (!r || !r.ok) return null;
    return formatPreviewValue(r.value, 160);
  }, [settled, scope, statements, hidePreview, error]);

  const invalid = !!props.invalid || (!!error && settled === value);
  const lines = value.split('\n').length;
  const common = {
    id: props.id,
    className: cx('ub-insp-expr__input', multiline && 'is-multi'),
    value,
    placeholder,
    spellCheck: false,
    autoComplete: 'off',
    autoCapitalize: 'off',
    autoFocus: props.autoFocus,
    'aria-label': props['aria-label'],
    'aria-invalid': invalid || undefined,
    role: 'combobox',
    'aria-autocomplete': 'list' as const,
    'aria-expanded': !!auto.ac,
    'aria-controls': auto.ac ? listId : undefined,
    'aria-activedescendant': auto.ac ? `${listId}-${auto.ac.index}` : undefined,
    onChange: auto.onInputChange,
    onBlur: () => {
      auto.close();
      props.onBlur?.();
    },
    onKeyDown: (e: ReactKeyboardEvent<AnyInput>) => {
      if (auto.onKeyDown(e)) return;
      if (multiline && statements && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const t = e.currentTarget;
        const res = insertAt(value, t.selectionStart ?? value.length, t.selectionEnd ?? value.length, '  ');
        onChange(res.value);
        requestAnimationFrame(() => t.setSelectionRange(res.cursor, res.cursor));
      }
    },
  };

  return (
    <div className={cx('ub-insp-expr', className)}>
      <div ref={boxRef} className={cx('ub-insp-expr__box', invalid && 'is-invalid', multiline && 'is-multi')}>
        <span className="ub-insp-expr__fx" aria-hidden>
          {statements ? '{ }' : 'fx'}
        </span>
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            rows={Math.min(16, Math.max(statements ? 5 : 2, lines + (statements ? 1 : 0)))}
            {...common}
          />
        ) : (
          <input ref={inputRef as React.RefObject<HTMLInputElement>} type="text" {...common} />
        )}
        <VariablePicker
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          onPick={auto.insertVariable}
          extraVariables={statements ? CUSTOM_CODE_GLOBALS : undefined}
          hideSetters={!handlerContext}
        />
      </div>
      {error && settled === value ? (
        <div className="ub-insp-expr__msg is-error" role="status">
          Syntax error: {error}
        </div>
      ) : preview !== null ? (
        <div className="ub-insp-expr__msg is-preview" title={preview}>
          = {preview}
        </div>
      ) : null}
      <SuggestionList
        anchor={boxRef.current}
        ac={auto.ac}
        listId={listId}
        onPick={(i) => auto.ac && auto.accept(auto.ac, i)}
        onClose={auto.close}
        onHover={(i) => auto.ac && auto.setAc({ ...auto.ac, index: i })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// TemplateInput
// ---------------------------------------------------------------------------

export interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  placeholder?: string;
  multiline?: boolean;
  'aria-label'?: string;
  /** Element id (for <label htmlFor>). */
  id?: string;
  invalid?: boolean;
  /** Hide the interpolated preview line. */
  hidePreview?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  className?: string;
}

/** Text editor supporting {{ expression }} segments. */
export function TemplateInput(props: TemplateInputProps) {
  const { value, onChange, ext, nodeId, eventParams, placeholder, multiline, hidePreview, className } = props;
  const baseVars = useScopeVariables(ext, nodeId, eventParams);
  const vars = useMemo(() => baseVars.filter((x) => x.kind !== 'setter'), [baseVars]);
  const scope = usePreviewScope(ext, nodeId);
  const inputRef = useRef<AnyInput>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const auto = useAutocomplete({ mode: 'template', value, onChange, vars, scope, inputRef });
  const settled = useSettled(value, 250);

  const info = useMemo((): { error: string | null; preview: string | null } => {
    if (!hasTemplate(settled)) return { error: null, preview: null };
    for (const code of templateExpressions(settled)) {
      const err = checkExpressionSyntax(code);
      if (err) return { error: `{{ ${code} }}: ${err}`, preview: null };
    }
    if (hidePreview) return { error: null, preview: null };
    const single = singleExpression(settled);
    if (single !== null) {
      const r = safeEvaluate(single, scope);
      if (!r) return { error: null, preview: null };
      return { error: null, preview: r.ok ? formatPreviewValue(r.value, 160) : `(${r.error})` };
    }
    const text = parseTemplate(settled)
      .map((p) => {
        if (p.kind === 'text') return p.value;
        const r = safeEvaluate(p.code, scope);
        return r && r.ok ? toText(r.value) : '…';
      })
      .join('');
    return { error: null, preview: text.length > 160 ? `${text.slice(0, 159)}…` : text };
  }, [settled, scope, hidePreview]);

  const invalid = !!props.invalid || (!!info.error && settled === value);
  const lines = value.split('\n').length;
  const common = {
    id: props.id,
    className: cx('ub-insp-expr__input ub-insp-tpl__input', multiline && 'is-multi'),
    value,
    placeholder,
    autoComplete: 'off',
    autoFocus: props.autoFocus,
    'aria-label': props['aria-label'],
    'aria-invalid': invalid || undefined,
    role: 'combobox',
    'aria-autocomplete': 'list' as const,
    'aria-expanded': !!auto.ac,
    'aria-controls': auto.ac ? listId : undefined,
    'aria-activedescendant': auto.ac ? `${listId}-${auto.ac.index}` : undefined,
    onChange: auto.onInputChange,
    onBlur: () => {
      auto.close();
      props.onBlur?.();
    },
    onKeyDown: (e: ReactKeyboardEvent<AnyInput>) => {
      auto.onKeyDown(e);
    },
  };

  return (
    <div className={cx('ub-insp-expr ub-insp-tpl', className)}>
      <div ref={boxRef} className={cx('ub-insp-expr__box', invalid && 'is-invalid', multiline && 'is-multi')}>
        {multiline ? (
          <textarea ref={inputRef as React.RefObject<HTMLTextAreaElement>} rows={Math.min(10, Math.max(2, lines))} {...common} />
        ) : (
          <input ref={inputRef as React.RefObject<HTMLInputElement>} type="text" {...common} />
        )}
        <VariablePicker
          ext={ext}
          nodeId={nodeId}
          eventParams={eventParams}
          onPick={auto.insertVariable}
          hideSetters
          label="Insert {{ variable }}"
        />
      </div>
      {info.error && settled === value ? (
        <div className="ub-insp-expr__msg is-error" role="status">
          {info.error}
        </div>
      ) : info.preview !== null ? (
        <div className="ub-insp-expr__msg is-preview" title={info.preview}>
          <span aria-hidden>→ </span>
          {info.preview || <em>(empty)</em>}
        </div>
      ) : null}
      <SuggestionList
        anchor={boxRef.current}
        ac={auto.ac}
        listId={listId}
        onPick={(i) => auto.ac && auto.accept(auto.ac, i)}
        onClose={auto.close}
        onHover={(i) => auto.ac && auto.setAc({ ...auto.ac, index: i })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// VariablePicker
// ---------------------------------------------------------------------------

export interface VariablePickerProps {
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  /** Called with the chosen variable path. */
  onPick: (name: string) => void;
  /** Additional entries (e.g. custom code globals). */
  extraVariables?: ScopeVariable[];
  /** Leave state setters out (prop expressions cannot call them). */
  hideSetters?: boolean;
  /** Button tooltip / accessible label. */
  label?: string;
  /** Custom trigger content (defaults to a `{x}` icon). */
  children?: ReactNode;
}

/** Button + menu listing variables in scope. */
export function VariablePicker({
  ext,
  nodeId,
  eventParams,
  onPick,
  extraVariables,
  hideSetters,
  label = 'Insert variable',
  children,
}: VariablePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const base = useScopeVariables(ext, nodeId, eventParams);
  const all = useMemo(() => {
    const v = hideSetters ? base.filter((x) => x.kind !== 'setter') : base;
    return extraVariables ? mergeVariables(v, extraVariables) : v;
  }, [base, extraVariables, hideSetters]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((v) => v.name.toLowerCase().includes(q) || (v.detail ?? '').toLowerCase().includes(q));
  }, [all, query]);
  const groups = useMemo(
    () => SCOPE_KIND_ORDER.map((kind) => ({ kind, items: filtered.filter((v) => v.kind === kind) })).filter((g) => g.items.length > 0),
    [filtered],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) btnRef.current?.focus();
  };
  const pick = (name: string) => {
    close(false);
    onPick(name);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={label}
        aria-label={label}
        className={cx('ub-icon-btn ub-icon-btn--sm ub-insp-varbtn', open && 'ub-icon-btn--active')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        {children ?? <Braces size={13} />}
      </button>
      <Popover
        anchor={btnRef.current}
        open={open}
        onClose={() => close(false)}
        width={280}
        maxHeight={340}
        align="end"
        aria-label="Variables in scope"
      >
        <div
          className="ub-insp-vp"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(flat.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const v = flat[active];
              if (v) pick(v.name);
            }
          }}
        >
          <div className="ub-insp-vp__search">
            <Search size={13} aria-hidden />
            <input
              id={searchId}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search variables…"
              aria-label="Search variables"
              role="combobox"
              aria-expanded
              aria-controls={`${searchId}-list`}
              aria-activedescendant={flat[active] ? `${searchId}-${active}` : undefined}
            />
          </div>
          <div ref={listRef} className="ub-insp-vp__list" role="listbox" id={`${searchId}-list`} aria-label="Variables">
            {flat.length === 0 && (
              <div className="ub-insp-vp__empty">
                {all.length === 0 ? 'Nothing in scope yet. Add state or data sources in the Data panel.' : 'No matching variables.'}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.kind} role="group" aria-label={SCOPE_KIND_LABELS[g.kind]}>
                <div className="ub-insp-vp__group">{SCOPE_KIND_LABELS[g.kind]}</div>
                {g.items.map((v) => {
                  const i = flat.indexOf(v);
                  return (
                    <div
                      key={v.name}
                      id={`${searchId}-${i}`}
                      role="option"
                      aria-selected={i === active}
                      data-active={i === active}
                      className={cx('ub-insp-ac__item', i === active && 'is-active')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(v.name)}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span className={cx('ub-insp-kind', `ub-insp-kind--${v.kind}`)} aria-hidden>
                        {KIND_GLYPH[v.kind]}
                      </span>
                      <span className="ub-insp-ac__name">{v.name}</span>
                      {v.detail && <span className="ub-insp-ac__detail">{v.detail}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
