/**
 * Data panel sections of the power module (both edit the ACTIVE extension through store actions):
 *
 *  - ComputedSection: derived values (`const total = items.length * price`) — name with identifier
 *    validation (renaming updates references), expression with autocomplete, a live value from the
 *    preview runtime (or the error it raised), description, reorder and delete.
 *  - HelpersSection: module-level helper functions — a code editor with a syntax check, an
 *    "insert examples" button and the list of helper names it declares.
 *
 * Both offer "Open in a large editor" (CodeEditorDialog): the helpers in a highlighted editor with
 * line numbers, a computed expression in a roomy expression field with autocomplete — bound live
 * to the same store value, for code that does not fit the sidebar.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, Maximize2, Plus, Sigma, SquareFunction, Trash2, WandSparkles } from 'lucide-react';
import { selectActiveExtension, useActiveExtension, useEditor } from '../model/store';
import type { ComputedValue, Extension } from '../model/types';
import { findUsages, renameConflictMessage } from '../panels/findUsages';
import { buildScopeWithDiagnostics, initialStateValues, resolveDataSources, useOptionalRuntime, type Scope, type ScopeDiagnostics } from '../runtime';
import { ExpressionInput } from '../inspector/controls';
import { Badge, Button, Field, IconButton, Section, TextInput, cx, useToast } from '../ui';
import { renameComputed } from './actions';
import { CodeEditor, CodeEditorDialog, handleCodeKeyDown } from './CodeEditor';
import { usableComputed, validateComputedName } from './computed';
import { appendHelperExamples, checkHelpersSyntax, compileHelpers, helperNames } from './helpers';
import { codeExecutionAllowed } from '../model/trust';
import { guardLoops } from '../runtime/loopGuard';
import { usePowerUi } from './uiStore';
import './power.css';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

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

/** Short one-line rendering of a runtime value (strings quoted, arrays with their length). */
export function formatValue(value: unknown, max = 60): string {
  let s: string;
  if (value === undefined) s = 'undefined';
  else if (typeof value === 'function') s = `ƒ ${(value as { name?: string }).name || 'function'}()`;
  else if (typeof value === 'string') s = JSON.stringify(value);
  else if (typeof value === 'object' && value !== null) {
    try {
      s = JSON.stringify(value) ?? String(value);
    } catch {
      s = String(value);
    }
    if (Array.isArray(value)) s = `(${value.length}) ${s}`;
  } else s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

interface LiveScope {
  scope: Scope;
  diagnostics: ScopeDiagnostics;
}

const noop = () => {};

/**
 * The scope of the running preview when the runtime shows this extension (live state values),
 * otherwise one built from initial values.
 */
function useLiveScope(ext: Extension): LiveScope {
  const runtime = useOptionalRuntime();
  const project = useEditor((s) => s.project);
  const live = runtime && runtime.extension.id === ext.id && runtime.diagnostics ? runtime : null;
  const fallback = useMemo(() => {
    if (live) return null;
    const setters: Record<string, (v: unknown) => void> = {};
    for (const v of ext.state ?? []) setters[v.name] = noop;
    try {
      return buildScopeWithDiagnostics({
        project,
        extension: ext,
        stateValues: initialStateValues(ext.state ?? []),
        setters,
        dataSources: resolveDataSources(ext, {}),
      });
    } catch {
      return { scope: {}, diagnostics: { helpersError: null, computedErrors: {} } };
    }
  }, [live, project, ext]);
  if (live) return { scope: live.scope, diagnostics: live.diagnostics! };
  return fallback!;
}

/** Inline confirmation shown before deleting something that is still referenced. */
function ConfirmDelete({
  name,
  usages,
  onCancel,
  onConfirm,
}: {
  name: string;
  usages: string[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="ub-pw-confirm" role="alertdialog" aria-label={`Delete ${name}?`}>
      <div className="ub-pw-confirm__title">
        <CircleAlert size={14} aria-hidden />“{name}” is used in {usages.length} {usages.length === 1 ? 'place' : 'places'}
      </div>
      <ul className="ub-pw-confirm__list">
        {usages.slice(0, 4).map((u, i) => (
          <li key={i}>{u}</li>
        ))}
        {usages.length > 4 && <li>and {usages.length - 4} more…</li>}
      </ul>
      <div className="ub-pw-row ub-pw-row--end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" autoFocus onClick={onConfirm}>
          Delete anyway
        </Button>
      </div>
    </div>
  );
}

/** Text input that commits on Enter / blur when valid (Escape reverts). */
function NameInput({
  id,
  value,
  validate,
  onCommit,
  inputRef,
}: {
  id: string;
  value: string;
  validate: (v: string) => string | null;
  onCommit: (v: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);
  const commit = (revert: boolean) => {
    const next = draft.trim();
    if (next === value) {
      setDraft(value);
      setError(null);
      return;
    }
    const err = validate(next);
    if (err) {
      if (revert) {
        setDraft(value);
        setError(null);
      } else setError(err);
      return;
    }
    onCommit(next);
  };
  return (
    <>
      <input
        id={id}
        ref={inputRef}
        className={cx('ub-input ub-input--code', error && 'ub-input--invalid')}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const t = e.target.value.trim();
          setError(t === value ? null : validate(t));
        }}
        onBlur={() => commit(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(false);
          } else if (e.key === 'Escape' && draft !== value) {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && (
        <div id={errorId} className="ub-field__error" role="status">
          {error}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// ComputedSection
// ---------------------------------------------------------------------------

export function ComputedSection() {
  const ext = useActiveExtension();
  const toast = useToast();
  const list = useMemo(() => ext.computed ?? [], [ext.computed]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const reveal = usePowerUi((s) => s.revealComputedId);
  const { scope, diagnostics } = useLiveScope(ext);
  const usable = useMemo(() => new Set(usableComputed(ext).map((c) => c.id)), [ext]);

  // "Add computed value" from the command palette: expand and focus the new item.
  useEffect(() => {
    if (!reveal || !list.some((c) => c.id === reveal)) return;
    setOpenId(reveal);
    setFocusId(reveal);
    usePowerUi.getState().revealComputed(null);
  }, [reveal, list]);

  const add = () => {
    const c = useEditor.getState().addComputed();
    setOpenId(c.id);
    setFocusId(c.id);
  };
  const toggle = useCallback((id: string) => {
    setOpenId((cur) => (cur === id ? null : id));
    setFocusId(null);
  }, []);
  const renamed = useCallback(
    (n: number, name: string) => {
      if (n > 0) toast(`Renamed to “${name}” and updated ${n} reference${n === 1 ? '' : 's'}`);
    },
    [toast],
  );

  return (
    <Section
      title={
        <span className="ub-pw-title">
          Computed <span className="ub-pw-count">{list.length}</span>
        </span>
      }
      actions={
        <IconButton label="Add computed value" size="sm" className="ub-pw-icon" onClick={add}>
          <Plus size={14} aria-hidden />
        </IconButton>
      }
    >
      {list.length === 0 ? (
        <div className="ub-pw-empty">
          <Sigma size={18} aria-hidden />
          <div>
            <div className="ub-pw-strong">No computed values</div>
            <div className="ub-pw-muted">
              Derive values from state and data — totals, labels, filtered lists — and use them anywhere by name.
            </div>
          </div>
          <button type="button" className="ub-pw-link" onClick={add}>
            Add a computed value
          </button>
        </div>
      ) : (
        <div className="ub-pw-items" role="list" aria-label="Computed values">
          {list.map((c, i) => (
            <ComputedRow
              key={c.id}
              ext={ext}
              c={c}
              index={i}
              count={list.length}
              open={openId === c.id}
              autoFocus={focusId === c.id}
              inactive={!usable.has(c.id)}
              value={c.name in scope ? scope[c.name] : undefined}
              error={diagnostics.computedErrors[c.id] ?? null}
              onToggle={toggle}
              onRenamed={renamed}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

interface ComputedRowProps {
  ext: Extension;
  c: ComputedValue;
  index: number;
  count: number;
  open: boolean;
  autoFocus: boolean;
  /** Not declared (invalid or conflicting name) — the problems panel explains why. */
  inactive: boolean;
  value: unknown;
  error: string | null;
  onToggle: (id: string) => void;
  onRenamed: (references: number, name: string) => void;
}

const ComputedRow = memo(function ComputedRow({
  ext,
  c,
  index,
  count,
  open,
  autoFocus,
  inactive,
  value,
  error,
  onToggle,
  onRenamed,
}: ComputedRowProps) {
  const uid = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  useEffect(() => {
    if (open && autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [open, autoFocus]);
  useEffect(() => {
    if (!open) setConfirm(null);
  }, [open]);

  const store = useEditor.getState;
  const empty = !c.expr || !c.expr.trim();
  let status: ReactNode;
  if (inactive) status = <Badge tone="warning">inactive</Badge>;
  else if (error) status = <Badge tone="danger" title={error}>error</Badge>;
  else if (empty) status = <span className="ub-pw-item__meta ub-pw-item__meta--empty">no expression</span>;
  else
    status = (
      <span className="ub-pw-item__meta" title={formatValue(value, 400)}>
        = {formatValue(value, 40)}
      </span>
    );

  const [bigEditor, setBigEditor] = useState(false);
  const valueLine = (
    <div className={cx('ub-pw-value', error && 'ub-pw-value--error')} role="status" aria-live="polite">
      {inactive ? (
        'Not available: rename it so it does not clash with another name.'
      ) : error ? (
        <>
          <CircleAlert size={12} aria-hidden /> {error}
        </>
      ) : empty ? (
        'Write a JavaScript expression using state, data, helpers or the values above.'
      ) : (
        <>
          <span className="ub-pw-value__label">Value now</span>
          <code>{formatValue(value, 200)}</code>
        </>
      )}
    </div>
  );

  const move = (delta: number) => store().moveComputed(c.id, index + delta);
  const remove = () => {
    const usages = findUsages(ext, c.name).map((u) => u.location);
    if (usages.length === 0) store().removeComputed(c.id);
    else setConfirm(usages);
  };

  return (
    <div className={cx('ub-pw-item', open && 'ub-pw-item--open')} role="listitem">
      <div className="ub-pw-item__head">
        <button
          type="button"
          className="ub-pw-item__toggle"
          aria-expanded={open}
          aria-controls={`${uid}-body`}
          title={c.description || undefined}
          onClick={() => onToggle(c.id)}
        >
          {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
          <span className="ub-pw-item__name">{c.name || <em>unnamed</em>}</span>
          {status}
        </button>
        <span className="ub-pw-item__actions">
          <IconButton label="Move up" size="sm" className="ub-pw-icon" disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp size={13} aria-hidden />
          </IconButton>
          <IconButton label="Move down" size="sm" className="ub-pw-icon" disabled={index === count - 1} onClick={() => move(1)}>
            <ArrowDown size={13} aria-hidden />
          </IconButton>
        </span>
      </div>
      {open && (
        <div className="ub-pw-item__body" id={`${uid}-body`}>
          <Field label="Name" htmlFor={`${uid}-name`}>
            <NameInput
              id={`${uid}-name`}
              inputRef={nameRef}
              value={c.name}
              validate={(name) => {
                const current = selectActiveExtension(useEditor.getState());
                const problem = validateComputedName(current, name, c.id);
                if (problem) return problem;
                // A repeat item, event param or custom-code name would capture the new name where
                // the computed value is used (renames are scope-aware, see panels/findUsages).
                return c.name && name.trim() !== c.name ? renameConflictMessage(current, c.name, name.trim()) : null;
              }}
              onCommit={(name) => onRenamed(renameComputed(c.id, name), name)}
            />
          </Field>
          <Field
            label="Expression"
            htmlFor={`${uid}-expr`}
            actions={
              <IconButton label={`Open ${c.name || 'the expression'} in a large editor`} size="sm" className="ub-pw-icon" onClick={() => setBigEditor(true)}>
                <Maximize2 size={13} aria-hidden />
              </IconButton>
            }
          >
            <ExpressionInput
              id={`${uid}-expr`}
              ext={ext}
              value={c.expr}
              multiline
              hidePreview
              placeholder="e.g. items.length * price"
              aria-label={`Expression of ${c.name}`}
              onChange={(expr) => store().updateComputed(c.id, { expr })}
            />
            {valueLine}
          </Field>
          <Field label="Description" htmlFor={`${uid}-desc`} hint="Optional — shown as a comment in the generated code.">
            <TextInput
              id={`${uid}-desc`}
              value={c.description ?? ''}
              placeholder="What does it represent?"
              onChange={(description) => store().updateComputed(c.id, { description })}
            />
          </Field>
          <div className="ub-pw-hint">
            Use <code>{`{{ ${c.name} }}`}</code> in text or <code>{c.name}</code> in expressions. Computed values below this one can use
            it; data sources cannot.
          </div>
          {bigEditor && (
            <CodeEditorDialog
              open
              onClose={() => setBigEditor(false)}
              title={
                <span className="ub-pw-title">
                  <Sigma size={16} aria-hidden /> Computed value <code>{c.name}</code>
                </span>
              }
              intro={
                <>
                  A JavaScript expression using state, data, context, helpers and the computed values above it. Type a name for suggestions;
                  wrap longer logic in a helper function.
                </>
              }
              status={valueLine}
              keys={
                <>
                  Changes apply as you type · type a name for suggestions · <kbd>Esc</kbd> closes
                </>
              }
            >
              <ExpressionInput
                className="ub-pw-bigexpr"
                ext={ext}
                value={c.expr}
                multiline
                hidePreview
                placeholder="e.g. items.filter((item) => item.done).length"
                aria-label={`Expression of ${c.name} (large editor)`}
                onChange={(expr) => store().updateComputed(c.id, { expr })}
              />
            </CodeEditorDialog>
          )}
          {confirm ? (
            <ConfirmDelete
              name={c.name}
              usages={confirm}
              onCancel={() => setConfirm(null)}
              onConfirm={() => store().removeComputed(c.id)}
            />
          ) : (
            <div className="ub-pw-row ub-pw-row--end">
              <Button size="sm" variant="ghost" className="ub-pw-danger" icon={<Trash2 size={13} aria-hidden />} onClick={remove}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// HelpersSection
// ---------------------------------------------------------------------------

const HELPERS_PLACEHOLDER = `function formatMoney(value) {
  return '$' + Number(value).toFixed(2);
}`;

const setHelpers = (code: string) => useEditor.getState().setHelpers(code);

/**
 * Syntax check, run error and declared names of helper code — checked once typing pauses, so a
 * half-typed line does not flash an error.
 */
function useHelpersStatus(extId: string, code: string) {
  const runtime = useOptionalRuntime();
  const settled = useSettled(code, 600);
  const syntaxError = useMemo(() => checkHelpersSyntax(settled), [settled]);
  const names = useMemo(() => helperNames(settled), [settled]);
  const runError =
    syntaxError ? null : runtime && runtime.extension.id === extId && runtime.diagnostics
      ? runtime.diagnostics.helpersError
      : codeExecutionAllowed()
        ? compileHelpers(guardLoops(settled)).error
        : null;
  return { syntaxError, runError, names, stale: settled !== code };
}

function HelpersStatus({ status }: { status: ReturnType<typeof useHelpersStatus> }) {
  const { syntaxError, runError, names } = status;
  return (
    <div
      className={cx('ub-pw-status', syntaxError ? 'ub-pw-status--error' : runError ? 'ub-pw-status--warn' : 'ub-pw-status--ok')}
      role="status"
      aria-live="polite"
    >
      {syntaxError ? (
        <>
          <CircleAlert size={12} aria-hidden /> Syntax error: {syntaxError}
        </>
      ) : runError ? (
        <>
          <CircleAlert size={12} aria-hidden /> Error while running the helpers: {runError}
        </>
      ) : names.length === 0 ? (
        'No helpers declared yet — use function name() {…} or const name = …'
      ) : (
        <>
          <span>Available:</span>
          {names.map((n) => (
            <code key={n} className="ub-pw-chip">
              {n}
            </code>
          ))}
        </>
      )}
    </div>
  );
}

/** The helper code in the large editor (highlighting, line numbers), bound to the same value. */
function HelpersEditorDialog({ extId, code, onClose }: { extId: string; code: string; onClose: () => void }) {
  const status = useHelpersStatus(extId, code);
  const statusId = useId();
  return (
    <CodeEditorDialog
      open
      onClose={onClose}
      title={
        <span className="ub-pw-title">
          <SquareFunction size={16} aria-hidden /> Helper functions
        </span>
      }
      intro={
        <>
          Module-level JavaScript or TypeScript that every expression can call, e.g. <code>formatMoney(amount)</code>. Helpers can't see
          state or data — pass values in as arguments.
        </>
      }
      status={
        code.trim() !== '' && (
          <div id={statusId}>
            <HelpersStatus status={status} />
          </div>
        )
      }
    >
      <CodeEditor
        value={code}
        onChange={setHelpers}
        language="ts"
        aria-label="Helper code (large editor)"
        aria-describedby={code.trim() ? statusId : undefined}
        invalid={!!status.syntaxError && !status.stale}
        placeholder={HELPERS_PLACEHOLDER}
      />
    </CodeEditorDialog>
  );
}

export function HelpersSection() {
  const extId = useEditor((s) => s.activeExtensionId);
  const code = useEditor((s) => selectActiveExtension(s).helpers ?? '');
  const toast = useToast();
  const editorId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const focusPending = usePowerUi((s) => s.helpersFocusPending);
  const status = useHelpersStatus(extId, code);
  const { syntaxError, names, stale } = status;
  const [bigEditor, setBigEditor] = useState(false);

  // The section starts collapsed while empty (beginners never need it); inserting examples or a
  // focus request (command palette, Problems panel) re-mounts it expanded, then focuses the
  // editor once that render has committed (the textarea only exists while the section is open).
  const [expandKey, setExpandKey] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const expandAndFocus = useCallback(() => {
    setExpandKey((k) => k + 1);
    setFocusRequest((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!focusPending) return;
    usePowerUi.getState().clearHelpersFocus();
    expandAndFocus();
  }, [focusPending, expandAndFocus]);
  useEffect(() => {
    if (focusRequest === 0) return;
    const el = textRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }, [focusRequest]);

  const insertExamples = () => {
    const res = appendHelperExamples(useEditor.getState().project.extensions.find((e) => e.id === extId)?.helpers);
    if (res.added.length === 0) {
      toast('The example helpers are already there');
      return;
    }
    setHelpers(res.code);
    toast(`Added ${res.added.join(', ')}`);
    expandAndFocus();
  };

  const lines = code.split('\n').length;

  return (
    <>
      <Section
        key={expandKey}
        defaultOpen={expandKey > 0 || !!code.trim()}
        title={
          <span className="ub-pw-title">
            Helpers <span className="ub-pw-count">{names.length}</span>
          </span>
        }
        actions={
          <>
            <IconButton label="Insert example helpers" size="sm" className="ub-pw-icon" onClick={insertExamples}>
              <WandSparkles size={14} aria-hidden />
            </IconButton>
            <IconButton label="Open helpers in a large editor" size="sm" className="ub-pw-icon" onClick={() => setBigEditor(true)}>
              <Maximize2 size={13} aria-hidden />
            </IconButton>
          </>
        }
      >
        {!code.trim() && (
          <div className="ub-pw-muted ub-pw-intro">
            <SquareFunction size={14} aria-hidden /> Reusable functions any expression can call, e.g. <code>formatMoney(amount)</code>. JavaScript or
            TypeScript.{' '}
            <button type="button" className="ub-pw-link" onClick={insertExamples}>
              Insert examples
            </button>
          </div>
        )}
        <div className="ub-pw-code">
          <label htmlFor={editorId} className="ub-pw-sr">
            Helper code
          </label>
          <textarea
            id={editorId}
            ref={textRef}
            className={cx('ub-textarea ub-textarea--code ub-pw-code__input', syntaxError && !stale && 'ub-input--invalid')}
            value={code}
            rows={Math.min(22, Math.max(5, lines + 1))}
            placeholder={HELPERS_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={syntaxError && !stale ? true : undefined}
            onChange={(e) => setHelpers(e.target.value)}
            onKeyDown={(e) => handleCodeKeyDown(e, setHelpers)}
          />
        </div>
        {code.trim() !== '' && <HelpersStatus status={status} />}
        {code.trim() !== '' && (
          <div className="ub-pw-hint">
            Helpers can't see state or data — pass values in as arguments. Parameters without a type are exported as <code>any</code>.
          </div>
        )}
      </Section>
      {bigEditor && <HelpersEditorDialog extId={extId} code={code} onClose={() => setBigEditor(false)} />}
    </>
  );
}
