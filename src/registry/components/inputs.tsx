/**
 * Forms & inputs: Form, Input, TextArea, NumberInput, CurrencyInput, StepperInput, DateInput,
 * TimeInput, Select, MultiSelect, SearchInput, Checkbox, RadioButton, Toggle, ToggleGroup.
 * See text.tsx for the reference conventions (exact @hubspot/ui-extensions prop names, inspector
 * metadata, previews that spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/components/
 *   form.synced.d.ts, inputs.synced.d.ts, selects.synced.d.ts, toggleInputs.synced.d.ts and
 *   toggle.synced.d.ts (+ remoteComponents.synced.d.ts, whose exported ToggleGroup requires
 *   `toggleType`).
 *
 * Preview behaviour follows HubSpot's documented semantics:
 *  - Text and number inputs fire `onInput` on every edit and `onChange` when the value is
 *    committed: on blur and on Enter (so before the form submits). Pickers, selects, checkboxes
 *    and toggles commit immediately.
 *  - Every input renders its `name` on a form element. <Form> renders a real <form>; on submit
 *    (e.g. a Button with type="submit") it collects the values by name into
 *    `event.targetValue` without reloading the page. Typed values (numbers, dates, lists, ...)
 *    travel as JSON in the `data-hsp-value` attribute (FORM_VALUE_ATTR).
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  CalendarDaysIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDollarSignIcon,
  CircleDotIcon,
  ClockIcon,
  DiffIcon,
  HashIcon,
  InfoIcon,
  LetterTextIcon,
  ListChecksIcon,
  ListTodoIcon,
  MinusIcon,
  NotebookPenIcon,
  PlusIcon,
  SearchIcon,
  SquareCheckIcon,
  SquareChevronDownIcon,
  TextCursorInputIcon,
  ToggleRightIcon,
  XIcon,
} from 'lucide-react';
import type { ComponentDef, EventDef, PreviewProps, PreviewRootProps, PropDef, PropType } from '../types';
import type { NodeTemplate } from '../../model/types';
import { STANDARD_DOCS } from '../constants';
import { cx, normalizeSize, str, usePreviewValue } from '../../preview/util';
import '../../preview/styles/inputs.css';

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

/** Finite number from a number or numeric string; undefined otherwise. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Rounded integer within [min, max], or undefined when not numeric. */
function int(v: unknown, min: number, max: number): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.min(max, Math.max(min, Math.round(n)));
}

/** Non-blank display text, or undefined. */
function text(v: unknown): string | undefined {
  const s = str(v);
  return s.trim() === '' ? undefined : s;
}

function jsonKey(v: unknown): string {
  try {
    return JSON.stringify(v) ?? 'undefined';
  } catch {
    return String(v);
  }
}

/**
 * Returns a referentially stable copy of a JSON-like value: the same object until its JSON
 * changes. Resolved props (dates, option lists) are fresh objects on every runtime render; feeding
 * them to usePreviewValue as defaults would otherwise reset local state on unrelated re-renders.
 */
function useStableValue<T>(value: T): T {
  const key = jsonKey(value);
  // Deliberately keyed on the JSON, not the reference.
  return useMemo(() => value, [key]);
}

function within(container: Element, node: EventTarget | null): boolean {
  return node instanceof Node && container.contains(node);
}

/** Checkbox / RadioButton / ToggleGroup size: TShirtSizes sm | md (+ deprecated `variant`). */
function checkSize(size: unknown, deprecatedVariant: unknown): 'small' | 'medium' {
  if (size === undefined) return deprecatedVariant === 'small' ? 'small' : 'medium';
  return normalizeSize(size) === 'small' ? 'small' : 'medium';
}

// ---------------------------------------------------------------------------
// Form submission plumbing
// ---------------------------------------------------------------------------

/**
 * Attribute carrying a field's typed value (JSON) for Form submission. Inputs whose DOM value is
 * not the HubSpot value (numbers, selects, dates, lists, ...) set it next to their `name`.
 */
export const FORM_VALUE_ATTR = 'data-hsp-value';

function formValueAttrs(value: unknown): Record<string, string> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'number' && !Number.isFinite(value)) return {};
  try {
    const json = JSON.stringify(value);
    return json === undefined ? {} : { [FORM_VALUE_ATTR]: json };
  } catch {
    return {};
  }
}

function parseJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

/**
 * Collects a preview form's values keyed by input `name` (HubSpot's `event.targetValue`):
 *  - checkboxes/radios: the `value` attribute when checked (true when it has none); an unchecked
 *    checkbox without a value attribute contributes `false`;
 *  - elements with FORM_VALUE_ATTR: the parsed JSON (numbers, option values, dates, arrays);
 *  - anything else: the element's DOM value (text).
 */
export function collectFormValues(form: HTMLFormElement): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) continue;
    if (!el.name || el.disabled) continue;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (el.checked) values[el.name] = el.hasAttribute('value') ? el.value : true;
      else if (el.type === 'checkbox' && !el.hasAttribute('value') && !Object.hasOwn(values, el.name)) values[el.name] = false;
      continue;
    }
    const typed = el.getAttribute(FORM_VALUE_ATTR);
    values[el.name] = typed !== null ? parseJson(typed, el.value) : el.value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Field chrome: label (+ required asterisk, tooltip), description, validation message
// ---------------------------------------------------------------------------

interface FieldChrome {
  label?: string;
  required: boolean;
  tooltip?: string;
  description?: string;
  error: boolean;
  validationMessage?: string;
}

function readChrome(props: Record<string, unknown>): FieldChrome {
  return {
    label: text(props.label),
    required: bool(props.required),
    tooltip: text(props.tooltip),
    description: text(props.description),
    error: bool(props.error),
    validationMessage: text(props.validationMessage),
  };
}

/** The (i) icon next to a label; shows the tooltip text in a bubble on hover/focus. */
function LabelTooltip({ text: tip }: { text: string }) {
  return (
    <span className="hsp-input-tip" tabIndex={0} aria-label={tip}>
      <InfoIcon size={14} aria-hidden="true" />
      <span className="hsp-input-tip-bubble" role="tooltip">
        {tip}
      </span>
    </span>
  );
}

/** In design mode a click must only select the node: cancel label activation (focus/toggle). */
function cancelInDesign(design: boolean) {
  return design ? (e: ReactMouseEvent) => e.preventDefault() : undefined;
}

interface FieldShellProps {
  rootProps: PreviewRootProps;
  className?: string;
  chrome: FieldChrome;
  design: boolean;
  /** id of a labelable control (input/textarea/button): the label becomes `<label htmlFor>`. */
  controlId?: string;
  /** Otherwise the label is a caption with this id (for aria-labelledby). */
  labelId?: string;
  /** Render as role="group" labelled by the caption (ToggleGroup). */
  group?: boolean;
  children: ReactNode;
}

/** HubSpot form-field layout: label row, description, control, validation message. */
function FieldShell({ rootProps, className, chrome, design, controlId, labelId, group, children }: FieldShellProps) {
  const labelContent = (
    <>
      {chrome.label}
      {chrome.required && (
        <span className="hsp-field-required" aria-hidden="true">
          *
        </span>
      )}
    </>
  );
  const hasLabelRow = chrome.label !== undefined || chrome.tooltip !== undefined;
  return (
    <div
      {...rootProps}
      className={cx('hsp-field', 'hsp-input', chrome.error && 'hsp-input-has-error', className, rootProps.className)}
      role={group ? 'group' : undefined}
      aria-labelledby={group && chrome.label !== undefined ? labelId : undefined}
    >
      {hasLabelRow && (
        <div className="hsp-input-label-row">
          {chrome.label !== undefined &&
            (controlId ? (
              <label className="hsp-field-label" htmlFor={controlId} onClick={cancelInDesign(design)}>
                {labelContent}
              </label>
            ) : (
              <span className="hsp-field-label" id={labelId}>
                {labelContent}
              </span>
            ))}
          {chrome.tooltip !== undefined && <LabelTooltip text={chrome.tooltip} />}
        </div>
      )}
      {chrome.description !== undefined && <span className="hsp-field-description">{chrome.description}</span>}
      {children}
      {chrome.validationMessage !== undefined && (
        <span className={chrome.error ? 'hsp-field-error' : 'hsp-field-success'} role={chrome.error ? 'alert' : undefined}>
          {chrome.validationMessage}
        </span>
      )}
    </div>
  );
}

/** Classes of the bordered "shell" that holds a bare input plus prefix/suffix/icons. */
function shellClass(chrome: FieldChrome, readOnly: boolean, extra?: string): string {
  return cx('hsp-input-shell', chrome.error && 'hsp-invalid', readOnly && 'hsp-input-readonly', extra);
}

// ---------------------------------------------------------------------------
// Popovers (select menus, calendar, time list): positioned inside the field, closed on outside
// mousedown or Escape. Only enabled in preview mode.
// ---------------------------------------------------------------------------

function usePopover(enabled: boolean) {
  const [requested, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = requested && enabled;
  useEffect(() => {
    if (!isOpen) return;
    const doc = ref.current?.ownerDocument ?? document;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !within(ref.current, e.target)) setOpen(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    doc.addEventListener('mousedown', onMouseDown);
    doc.addEventListener('keydown', onKeyDown);
    return () => {
      doc.removeEventListener('mousedown', onMouseDown);
      doc.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);
  return { ref, isOpen, setOpen };
}

/** Clicking inside a popover must not blur the field (which would commit / fire onBlur). */
function keepFocus(e: ReactMouseEvent) {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
}

// ---------------------------------------------------------------------------
// Input, TextArea, SearchInput (string values)
// ---------------------------------------------------------------------------

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function optionalText(v: unknown): string | undefined {
  return v === undefined ? undefined : str(v);
}

/**
 * Draft/commit model of HubSpot text inputs: the field edits a local draft (onInput per edit);
 * the value is committed with onChange on blur / Enter. `value` (bound state) wins when set.
 */
function useTextField({ props, trigger, mode }: PreviewProps) {
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const [committed, setCommitted] = usePreviewValue<string>(optionalText(props.value), optionalText(props.defaultValue), '');
  const [draft, setDraft] = useState(committed);
  const last = useRef(committed);
  useEffect(() => {
    setDraft(committed);
    last.current = committed;
  }, [committed]);

  const commit = (next: string) => {
    if (next === last.current) return;
    last.current = next;
    setCommitted(next);
    trigger('onChange', next);
  };
  const edit = (next: string) => {
    setDraft(next);
    trigger('onInput', next);
  };
  return {
    draft,
    readOnly,
    design,
    commit,
    edit,
    controlProps: {
      value: draft,
      readOnly,
      tabIndex: design ? -1 : undefined,
      onChange: (e: ChangeEvent<TextControl>) => {
        if (!readOnly && !design) edit(e.target.value);
      },
      onFocus: () => trigger('onFocus', draft),
      onBlur: () => {
        commit(draft);
        trigger('onBlur', draft);
      },
    },
  };
}

function InputPreview(p: PreviewProps) {
  const id = useId();
  const chrome = readChrome(p.props);
  const field = useTextField(p);
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-text-input" chrome={chrome} design={field.design} controlId={id}>
      <input
        id={id}
        className={cx('hsp-control', chrome.error && 'hsp-invalid')}
        type={p.props.type === 'password' ? 'password' : 'text'}
        name={text(p.props.name)}
        placeholder={text(p.props.placeholder)}
        aria-invalid={chrome.error || undefined}
        aria-required={chrome.required || undefined}
        {...field.controlProps}
        onKeyDown={(e) => {
          if (e.key === 'Enter') field.commit(field.draft);
        }}
      />
    </FieldShell>
  );
}

const RESIZE_VALUES = ['vertical', 'horizontal', 'both', 'none'] as const;

function TextAreaPreview(p: PreviewProps) {
  const id = useId();
  const chrome = readChrome(p.props);
  const field = useTextField(p);
  const cols = int(p.props.cols, 1, 1000);
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-textarea-field" chrome={chrome} design={field.design} controlId={id}>
      <textarea
        id={id}
        className={cx('hsp-control', 'hsp-textarea', chrome.error && 'hsp-invalid')}
        name={text(p.props.name)}
        placeholder={text(p.props.placeholder)}
        rows={int(p.props.rows, 1, 200) ?? 3}
        cols={cols}
        maxLength={int(p.props.maxLength, 0, 10_000_000)}
        style={{ resize: oneOf(p.props.resize, RESIZE_VALUES, 'both'), width: cols !== undefined ? 'auto' : undefined }}
        aria-invalid={chrome.error || undefined}
        aria-required={chrome.required || undefined}
        {...field.controlProps}
      />
    </FieldShell>
  );
}

function SearchInputPreview(p: PreviewProps) {
  const id = useId();
  const chrome = readChrome(p.props);
  const field = useTextField(p);
  // HubSpot: "When set to true, shows a clear button to clear the input. Default is true."
  const clearable = p.props.clearable === undefined ? true : bool(p.props.clearable);
  const clear = () => {
    field.edit('');
    field.commit('');
  };
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-search-input" chrome={chrome} design={field.design} controlId={id}>
      <div className={shellClass(chrome, field.readOnly)}>
        <input
          id={id}
          className="hsp-input-bare"
          type="text"
          role="searchbox"
          name={text(p.props.name)}
          placeholder={text(p.props.placeholder)}
          aria-invalid={chrome.error || undefined}
          aria-required={chrome.required || undefined}
          {...field.controlProps}
          onKeyDown={(e) => {
            if (e.key === 'Enter') field.commit(field.draft);
          }}
        />
        {clearable && field.draft !== '' && !field.readOnly && (
          <button
            type="button"
            className="hsp-input-icon-button"
            aria-label="Clear search"
            // Keep focus in the field so clearing does not first commit the old text via blur.
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        )}
        <SearchIcon className="hsp-input-icon" size={16} aria-hidden="true" />
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// NumberInput, CurrencyInput, StepperInput (number values)
// ---------------------------------------------------------------------------

/** Parses user-typed number text, ignoring grouping, currency symbols and a % suffix. */
function parseNumberText(raw: string): number | 'empty' | 'invalid' {
  if (raw.trim() === '') return 'empty';
  const cleaned = raw.replace(/[^\d.eE+-]/g, '');
  if (cleaned === '') return 'invalid';
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 'invalid';
}

function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf('.');
  return dot < 0 || s.includes('e') ? 0 : s.length - dot - 1;
}

function roundTo(n: number, digits: number | undefined): number {
  if (digits === undefined) return n;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let out = n;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/** en-US display with grouping; fixed fraction digits when a precision is known. */
function formatNumber(n: number | null, fractionDigits: number | undefined): string {
  if (n === null) return '';
  try {
    const options: Intl.NumberFormatOptions =
      fractionDigits === undefined
        ? { maximumFractionDigits: 10 }
        : { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits };
    return new Intl.NumberFormat('en-US', options).format(n);
  } catch {
    return String(n);
  }
}

/** Controlled/initial number: undefined = not set, null = set but empty/invalid. */
function optionalNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  return num(v) ?? null;
}

const editText = (n: number | null): string => (n === null ? '' : String(n));

interface NumberConfig {
  min?: number;
  max?: number;
  /** Decimal places values are rounded to on commit. */
  precision?: number;
  /** Fraction digits shown while the field is not focused. */
  displayDigits?: number;
}

/**
 * Number inputs edit a raw draft while focused (shown formatted otherwise) and commit on blur /
 * Enter: the draft is parsed, clamped to min/max and rounded to `precision`. A cleared field
 * commits `undefined`; unparseable text reverts to the last value.
 */
function useNumberField({ props, trigger, mode }: PreviewProps, config: NumberConfig) {
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const [committed, setCommitted] = usePreviewValue<number | null>(
    optionalNumber(props.value),
    optionalNumber(props.defaultValue) ?? undefined,
    null,
  );
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const last = useRef(committed);
  useEffect(() => {
    last.current = committed;
  }, [committed]);

  const setValue = (next: number | null) => {
    if (focused) setDraft(editText(next));
    if (Object.is(next, last.current)) return;
    last.current = next;
    setCommitted(next);
    trigger('onChange', next ?? undefined);
  };
  const commitDraft = (): number | null => {
    if (!dirty) return last.current;
    setDirty(false);
    const parsed = parseNumberText(draft);
    if (parsed === 'invalid') {
      setDraft(editText(last.current));
      return last.current;
    }
    const next = parsed === 'empty' ? null : roundTo(clamp(parsed, config.min, config.max), config.precision);
    setValue(next);
    return next;
  };
  const typed = focused && dirty ? parseNumberText(draft) : committed;
  return {
    committed,
    readOnly,
    design,
    setValue,
    current: () => last.current,
    /** Value submitted with a Form (the parsed draft while editing). */
    formValue: typeof typed === 'number' ? typed : null,
    inputProps: {
      type: 'text',
      inputMode: 'decimal' as const,
      value: focused ? draft : formatNumber(committed, config.displayDigits),
      readOnly,
      tabIndex: design ? -1 : undefined,
      onFocus: () => {
        setFocused(true);
        setDraft(editText(committed));
        setDirty(false);
        trigger('onFocus', committed ?? undefined);
      },
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        if (readOnly || design) return;
        setDraft(e.target.value);
        setDirty(true);
      },
      onBlur: () => {
        const v = commitDraft();
        setFocused(false);
        trigger('onBlur', v ?? undefined);
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') commitDraft();
      },
    },
  };
}

function NumberInputPreview(p: PreviewProps) {
  const id = useId();
  const chrome = readChrome(p.props);
  const precision = int(p.props.precision, 0, 20);
  const field = useNumberField(p, { min: num(p.props.min), max: num(p.props.max), precision, displayDigits: precision });
  const percent = p.props.formatStyle === 'percentage';
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-number-input" chrome={chrome} design={field.design} controlId={id}>
      <div className={shellClass(chrome, field.readOnly)}>
        <input
          id={id}
          className="hsp-input-bare"
          name={text(p.props.name)}
          placeholder={text(p.props.placeholder)}
          style={{ textAlign: p.props.textAlign === 'right' ? 'right' : 'left' }}
          aria-invalid={chrome.error || undefined}
          aria-required={chrome.required || undefined}
          {...field.inputProps}
          {...formValueAttrs(field.formValue)}
        />
        {percent && (
          <span className="hsp-input-suffix" aria-hidden="true">
            %
          </span>
        )}
      </div>
    </FieldShell>
  );
}

/** Symbol and default fraction digits of an ISO 4217 code (falls back to USD for junk). */
function currencyInfo(code: unknown): { code: string; symbol: string; digits: number } {
  const iso = typeof code === 'string' && /^[A-Za-z]{3}$/.test(code.trim()) ? code.trim().toUpperCase() : 'USD';
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: iso });
    const symbol = nf.formatToParts(0).find((part) => part.type === 'currency')?.value ?? iso;
    return { code: iso, symbol, digits: nf.resolvedOptions().maximumFractionDigits ?? 2 };
  } catch {
    return { code: iso, symbol: iso, digits: 2 };
  }
}

function CurrencyInputPreview(p: PreviewProps) {
  const id = useId();
  const chrome = readChrome(p.props);
  const currency = currencyInfo(p.props.currency);
  // "If not provided, defaults to currency-specific precision" (e.g. USD 2, JPY 0).
  const precision = int(p.props.precision, 0, 20) ?? currency.digits;
  const field = useNumberField(p, { min: num(p.props.min), max: num(p.props.max), precision, displayDigits: precision });
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-currency-input" chrome={chrome} design={field.design} controlId={id}>
      <div className={shellClass(chrome, field.readOnly)}>
        <span className="hsp-input-prefix" title={currency.code}>
          {currency.symbol}
        </span>
        <input
          id={id}
          className="hsp-input-bare"
          name={text(p.props.name)}
          placeholder={text(p.props.placeholder)}
          aria-invalid={chrome.error || undefined}
          aria-required={chrome.required || undefined}
          {...field.inputProps}
          {...formValueAttrs(field.formValue)}
        />
      </div>
    </FieldShell>
  );
}

function StepperInputPreview(p: PreviewProps) {
  const { props } = p;
  const id = useId();
  const chrome = readChrome(props);
  const min = num(props.min);
  const max = num(props.max);
  const precision = int(props.precision, 0, 20);
  const stepSize = Math.abs(num(props.stepSize) ?? 1) || 1;
  const field = useNumberField(p, { min, max, precision, displayDigits: precision });
  const percent = props.formatStyle === 'percentage';
  const value = field.committed;
  const atMin = value !== null && min !== undefined && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;
  const locked = field.readOnly || field.design;

  const step = (direction: 1 | -1) => {
    if (locked) return;
    const base = field.current() ?? 0;
    const digits = precision ?? Math.max(decimalsOf(base), decimalsOf(stepSize));
    field.setValue(roundTo(clamp(base + direction * stepSize, min, max), digits));
  };
  const stepButton = (direction: 1 | -1) => {
    const reached = direction < 0 ? atMin : atMax;
    const tip = reached ? text(direction < 0 ? props.minValueReachedTooltip : props.maxValueReachedTooltip) : undefined;
    return (
      // The tooltip lives on a wrapper: disabled buttons do not receive hover events.
      <span className="hsp-stepper-step" title={tip}>
        <button
          type="button"
          className="hsp-stepper-button"
          aria-label={direction < 0 ? 'Decrease' : 'Increase'}
          disabled={reached || field.readOnly}
          tabIndex={field.design ? -1 : undefined}
          onClick={() => step(direction)}
        >
          {direction < 0 ? <MinusIcon size={14} aria-hidden="true" /> : <PlusIcon size={14} aria-hidden="true" />}
        </button>
      </span>
    );
  };
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-stepper-input" chrome={chrome} design={field.design} controlId={id}>
      <div className="hsp-stepper">
        <div className={shellClass(chrome, field.readOnly)}>
          <input
            id={id}
            className="hsp-input-bare"
            name={text(props.name)}
            placeholder={text(props.placeholder)}
            aria-invalid={chrome.error || undefined}
            aria-required={chrome.required || undefined}
            {...field.inputProps}
            {...formValueAttrs(field.formValue)}
          />
          {percent && (
            <span className="hsp-input-suffix" aria-hidden="true">
              %
            </span>
          )}
        </div>
        {stepButton(-1)}
        {stepButton(1)}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// DateInput ({ year, month (0-based), date })
// ---------------------------------------------------------------------------

interface DateValue {
  year: number;
  month: number;
  date: number;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DATE_FORMATS = ['YYYY-MM-DD', 'L', 'LL', 'll', 'short', 'long', 'medium', 'standard'] as const;
type DateFormat = (typeof DATE_FORMATS)[number];

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Shown while a DateInput is empty (HubSpot's DateInput has no placeholder prop). */
const DATE_FORMAT_HINTS: Record<DateFormat, string> = {
  short: 'MM/DD/YYYY',
  L: 'MM/DD/YYYY',
  medium: 'Mon D, YYYY',
  ll: 'Mon D, YYYY',
  long: 'Month D, YYYY',
  LL: 'Month D, YYYY',
  standard: 'YYYY-MM-DD',
  'YYYY-MM-DD': 'YYYY-MM-DD',
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month] ?? 31;
}

/** 0 = Sunday. */
function weekdayOf(year: number, month: number, date: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, date);
  return d.getUTCDay();
}

/** Validates a BaseDate-like object; null for anything else. */
function toDateValue(v: unknown): DateValue | null {
  if (!isRecord(v)) return null;
  const year = num(v.year);
  const month = num(v.month);
  const date = num(v.date);
  if (year === undefined || month === undefined || date === undefined) return null;
  if (![year, month, date].every(Number.isInteger)) return null;
  if (year < 1 || year > 9999 || month < 0 || month > 11 || date < 1 || date > daysInMonth(year, month)) return null;
  return { year, month, date };
}

const dateKey = (d: DateValue) => d.year * 10000 + d.month * 100 + d.date;
const sameDate = (a: DateValue | null, b: DateValue | null) => (a && b ? dateKey(a) === dateKey(b) : a === b);

function todayValue(): DateValue {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), date: now.getDate() };
}

/** Mirrors the documented DateInput formats (en-US). */
function formatDate(d: DateValue, format: DateFormat): string {
  switch (format) {
    case 'long':
    case 'LL':
      return `${MONTH_NAMES[d.month]} ${d.date}, ${d.year}`;
    case 'medium':
    case 'll':
      return `${MONTH_NAMES[d.month].slice(0, 3)} ${d.date}, ${d.year}`;
    case 'standard':
    case 'YYYY-MM-DD':
      return `${pad(d.year, 4)}-${pad(d.month + 1)}-${pad(d.date)}`;
    default:
      return `${pad(d.month + 1)}/${pad(d.date)}/${pad(d.year, 4)}`;
  }
}

/** Parses typed dates in any of the display formats. */
function parseDateText(raw: string): DateValue | 'empty' | 'invalid' {
  const s = raw.trim();
  if (s === '') return 'empty';
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return toDateValue({ year: +iso[1], month: +iso[2] - 1, date: +iso[3] }) ?? 'invalid';
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return toDateValue({ year: +us[3], month: +us[1] - 1, date: +us[2] }) ?? 'invalid';
  const named = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (named) {
    const prefix = named[1].slice(0, 3).toLowerCase();
    const month = MONTH_NAMES.findIndex((m) => m.slice(0, 3).toLowerCase() === prefix);
    if (month >= 0) return toDateValue({ year: +named[3], month, date: +named[2] }) ?? 'invalid';
  }
  return 'invalid';
}

interface CalendarProps {
  view: { year: number; month: number };
  onView: (view: { year: number; month: number }) => void;
  selected: DateValue | null;
  rangeError: (d: DateValue) => string | null | undefined;
  todayLabel: string;
  clearLabel: string;
  onSelect: (d: DateValue | null) => void;
}

/** The DateInput popover: month navigation, day grid, Today / Clear buttons. */
function Calendar({ view, onView, selected, rangeError, todayLabel, clearLabel, onSelect }: CalendarProps) {
  const today = todayValue();
  const leading = weekdayOf(view.year, view.month, 1);
  const total = daysInMonth(view.year, view.month);
  const shift = (delta: number) => {
    const index = view.year * 12 + view.month + delta;
    onView({ year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 });
  };
  const todayBlocked = rangeError(today) !== null;
  return (
    <div className="hsp-input-popover hsp-calendar" onMouseDown={keepFocus} role="dialog" aria-label="Choose date">
      <div className="hsp-calendar-header">
        <button type="button" className="hsp-calendar-nav" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeftIcon size={16} aria-hidden="true" />
        </button>
        <span className="hsp-calendar-title" aria-live="polite">
          {MONTH_NAMES[view.month]} {view.year}
        </span>
        <button type="button" className="hsp-calendar-nav" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRightIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="hsp-calendar-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="hsp-calendar-weekday">
            {w}
          </span>
        ))}
        {Array.from({ length: leading }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const day: DateValue = { year: view.year, month: view.month, date: i + 1 };
          const blocked = rangeError(day);
          const isSelected = sameDate(day, selected);
          return (
            <button
              key={day.date}
              type="button"
              className={cx(
                'hsp-calendar-day',
                isSelected && 'is-selected',
                sameDate(day, today) && 'is-today',
                blocked !== null && 'is-blocked',
              )}
              aria-label={formatDate(day, 'long')}
              aria-pressed={isSelected}
              // aria-disabled (not disabled) so the min/max validation message shows on hover.
              aria-disabled={blocked !== null || undefined}
              title={blocked ?? undefined}
              onClick={() => {
                if (blocked === null) onSelect(day);
              }}
            >
              {day.date}
            </button>
          );
        })}
      </div>
      <div className="hsp-calendar-footer">
        <button
          type="button"
          className="hsp-calendar-link"
          aria-disabled={todayBlocked || undefined}
          onClick={() => {
            if (!todayBlocked) onSelect(today);
          }}
        >
          {todayLabel}
        </button>
        <button type="button" className="hsp-calendar-link" onClick={() => onSelect(null)}>
          {clearLabel}
        </button>
      </div>
    </div>
  );
}

function DateInputPreview(p: PreviewProps) {
  const { props, trigger, mode } = p;
  const id = useId();
  const chrome = readChrome(props);
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const format = oneOf(props.format, DATE_FORMATS, 'short');
  const min = toDateValue(props.min);
  const max = toDateValue(props.max);
  const defaultDate = useStableValue(toDateValue(props.defaultValue) ?? undefined);
  const [committed, setCommitted] = usePreviewValue<DateValue | null>(
    props.value === undefined ? undefined : toDateValue(props.value),
    defaultDate,
    null,
  );
  const last = useRef(committed);
  useEffect(() => {
    last.current = committed;
  }, [committed]);
  const popover = usePopover(!design && !readOnly);
  /** Text being typed; null while not editing (the formatted value is shown). */
  const [draft, setDraft] = useState<string | null>(null);
  const [view, setView] = useState<{ year: number; month: number }>(() => committed ?? todayValue());

  /** The onChange/onBlur/onFocus payload: BaseDate plus `formattedDate`; null when empty. */
  const payload = (d: DateValue | null) => (d ? { ...d, formattedDate: formatDate(d, format) } : null);
  const rangeError = (d: DateValue): string | null => {
    if (min && dateKey(d) < dateKey(min)) return text(props.minValidationMessage) ?? 'Date is before the earliest allowed date';
    if (max && dateKey(d) > dateKey(max)) return text(props.maxValidationMessage) ?? 'Date is after the latest allowed date';
    return null;
  };
  const commit = (d: DateValue | null) => {
    setDraft(null);
    if (sameDate(d, last.current)) return;
    last.current = d;
    setCommitted(d);
    trigger('onChange', payload(d));
  };
  /** Commits typed text; invalid or out-of-range text reverts. Returns the resulting value. */
  const commitDraft = (): DateValue | null => {
    if (draft === null) return last.current;
    const parsed = parseDateText(draft);
    if (parsed === 'empty') commit(null);
    else if (parsed !== 'invalid' && rangeError(parsed) === null) commit(parsed);
    else setDraft(null);
    return last.current;
  };
  const openCalendar = () => {
    if (popover.isOpen) return;
    setView(last.current ?? todayValue());
    popover.setOpen(true);
  };

  return (
    <FieldShell rootProps={p.rootProps} className="hsp-date-input" chrome={chrome} design={design} controlId={id}>
      <div
        className="hsp-input-anchor"
        ref={popover.ref}
        onFocus={(e: ReactFocusEvent<HTMLDivElement>) => {
          if (!within(e.currentTarget, e.relatedTarget)) trigger('onFocus', payload(last.current));
        }}
        onBlur={(e: ReactFocusEvent<HTMLDivElement>) => {
          if (within(e.currentTarget, e.relatedTarget)) return;
          const v = commitDraft();
          popover.setOpen(false);
          trigger('onBlur', payload(v));
        }}
      >
        <div className={shellClass(chrome, readOnly)}>
          <input
            id={id}
            className="hsp-input-bare"
            type="text"
            name={text(props.name)}
            value={draft ?? (committed ? formatDate(committed, format) : '')}
            placeholder={DATE_FORMAT_HINTS[format]}
            readOnly={readOnly}
            tabIndex={design ? -1 : undefined}
            aria-invalid={chrome.error || undefined}
            aria-required={chrome.required || undefined}
            aria-haspopup="dialog"
            aria-expanded={popover.isOpen}
            onClick={openCalendar}
            onChange={(e) => {
              if (!readOnly && !design) setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDraft();
                popover.setOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                openCalendar();
              }
            }}
            {...formValueAttrs(committed)}
          />
          <CalendarIcon className="hsp-input-icon" size={16} aria-hidden="true" />
        </div>
        {popover.isOpen && (
          <Calendar
            view={view}
            onView={setView}
            selected={committed}
            rangeError={rangeError}
            todayLabel={text(props.todayButtonLabel) ?? 'Today'}
            clearLabel={text(props.clearButtonLabel) ?? 'Clear'}
            onSelect={(d) => {
              commit(d);
              popover.setOpen(false);
            }}
          />
        )}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// TimeInput ({ hours, minutes })
// ---------------------------------------------------------------------------

interface TimeValue {
  hours: number;
  minutes: number;
}

function toTimeValue(v: unknown): TimeValue | null {
  if (!isRecord(v)) return null;
  const hours = num(v.hours);
  const minutes = num(v.minutes);
  if (hours === undefined || minutes === undefined || !Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

const minutesOf = (t: TimeValue) => t.hours * 60 + t.minutes;
const sameTime = (a: TimeValue | null, b: TimeValue | null) => (a && b ? minutesOf(a) === minutesOf(b) : a === b);

function formatTime(t: TimeValue): string {
  return `${t.hours % 12 || 12}:${pad(t.minutes)} ${t.hours < 12 ? 'AM' : 'PM'}`;
}

/** Parses "9:30 AM", "9 pm", "14:05". */
function parseTimeText(raw: string): TimeValue | 'empty' | 'invalid' {
  const s = raw.trim().toLowerCase();
  if (s === '') return 'empty';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/.exec(s);
  if (!m) return 'invalid';
  let hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  if (m[3]) {
    if (hours < 1 || hours > 12) return 'invalid';
    hours = (hours % 12) + (m[3] === 'p' ? 12 : 0);
  } else if (m[2] === undefined) {
    return 'invalid';
  }
  return toTimeValue({ hours, minutes }) ?? 'invalid';
}

/** Dropdown entries every `interval` minutes from midnight, limited to [min, max]. */
function timeSlots(interval: number, min: TimeValue | null, max: TimeValue | null): TimeValue[] {
  const from = min ? minutesOf(min) : 0;
  const to = max ? minutesOf(max) : 24 * 60 - 1;
  const slots: TimeValue[] = [];
  for (let m = 0; m < 24 * 60; m += interval) {
    if (m >= from && m <= to) slots.push({ hours: Math.floor(m / 60), minutes: m % 60 });
  }
  return slots;
}

function TimeInputPreview(p: PreviewProps) {
  const { props, trigger, mode } = p;
  const id = useId();
  const listId = useId();
  const chrome = readChrome(props);
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const min = toTimeValue(props.min);
  const max = toTimeValue(props.max);
  const interval = int(props.interval, 1, 24 * 60) ?? 30;
  const defaultTime = useStableValue(toTimeValue(props.defaultValue) ?? undefined);
  const [committed, setCommitted] = usePreviewValue<TimeValue | null>(
    props.value === undefined ? undefined : toTimeValue(props.value),
    defaultTime,
    null,
  );
  const last = useRef(committed);
  useEffect(() => {
    last.current = committed;
  }, [committed]);
  const popover = usePopover(!design && !readOnly);
  const [draft, setDraft] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const slots = timeSlots(interval, min, max);

  // Bring the selected entry into view when the list opens (scrolls the list only).
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && selected) list.scrollTop = Math.max(0, selected.offsetTop - list.clientHeight / 2);
  }, [popover.isOpen]);

  const inRange = (t: TimeValue) => (!min || minutesOf(t) >= minutesOf(min)) && (!max || minutesOf(t) <= minutesOf(max));
  const commit = (t: TimeValue | null) => {
    setDraft(null);
    if (sameTime(t, last.current)) return;
    last.current = t;
    setCommitted(t);
    trigger('onChange', t ? { ...t } : null);
  };
  const commitDraft = (): TimeValue | null => {
    if (draft === null) return last.current;
    const parsed = parseTimeText(draft);
    if (parsed === 'empty') commit(null);
    else if (parsed !== 'invalid' && inRange(parsed)) commit(parsed);
    else setDraft(null);
    return last.current;
  };

  return (
    <FieldShell rootProps={p.rootProps} className="hsp-time-input" chrome={chrome} design={design} controlId={id}>
      <div
        className="hsp-input-anchor"
        ref={popover.ref}
        onFocus={(e: ReactFocusEvent<HTMLDivElement>) => {
          if (!within(e.currentTarget, e.relatedTarget)) trigger('onFocus', last.current ? { ...last.current } : null);
        }}
        onBlur={(e: ReactFocusEvent<HTMLDivElement>) => {
          if (within(e.currentTarget, e.relatedTarget)) return;
          const v = commitDraft();
          popover.setOpen(false);
          trigger('onBlur', v ? { ...v } : null);
        }}
      >
        <div className={shellClass(chrome, readOnly)}>
          <input
            id={id}
            className="hsp-input-bare"
            type="text"
            role="combobox"
            name={text(props.name)}
            value={draft ?? (committed ? formatTime(committed) : '')}
            placeholder="--:-- --"
            readOnly={readOnly}
            tabIndex={design ? -1 : undefined}
            aria-invalid={chrome.error || undefined}
            aria-required={chrome.required || undefined}
            aria-expanded={popover.isOpen}
            aria-controls={popover.isOpen ? listId : undefined}
            onClick={() => popover.setOpen(true)}
            onChange={(e) => {
              if (!readOnly && !design) setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDraft();
                popover.setOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                popover.setOpen(true);
              }
            }}
            {...formValueAttrs(committed)}
          />
          <ClockIcon className="hsp-input-icon" size={16} aria-hidden="true" />
        </div>
        {popover.isOpen && (
          <div className="hsp-input-popover hsp-time-menu" onMouseDown={keepFocus}>
            <ul className="hsp-select-options" role="listbox" id={listId} ref={listRef}>
              {slots.map((t) => {
                const selected = sameTime(t, committed);
                return (
                  <li
                    key={minutesOf(t)}
                    role="option"
                    aria-selected={selected}
                    className={cx('hsp-select-option', selected && 'is-selected')}
                    onClick={() => {
                      commit(t);
                      popover.setOpen(false);
                    }}
                  >
                    {formatTime(t)}
                  </li>
                );
              })}
              {slots.length === 0 && <li className="hsp-select-empty">No times available</li>}
            </ul>
          </div>
        )}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Select, MultiSelect (option lists)
// ---------------------------------------------------------------------------

type OptionValue = string | number | boolean;

interface OptionItem {
  label: string;
  value: OptionValue;
  description?: string;
  initialIsChecked: boolean;
  readOnly: boolean;
}

/** Normalises `options` (array of { label, value, ... }; bare primitives are tolerated). */
function readOptions(v: unknown): OptionItem[] {
  if (!Array.isArray(v)) return [];
  const out: OptionItem[] = [];
  for (const o of v) {
    if (isRecord(o)) {
      const value: OptionValue =
        typeof o.value === 'string' || typeof o.value === 'number' || typeof o.value === 'boolean' ? o.value : str(o.value);
      out.push({
        label: text(o.label) ?? str(value),
        value,
        description: text(o.description),
        initialIsChecked: bool(o.initialIsChecked),
        readOnly: bool(o.readOnly) || bool(o.readonly),
      });
    } else if (typeof o === 'string' || typeof o === 'number' || typeof o === 'boolean') {
      out.push({ label: String(o), value: o, initialIsChecked: false, readOnly: false });
    }
  }
  return out;
}

const isPrimitive = (v: unknown): v is OptionValue => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Option value equality, lenient across string/number (expressions often stringify). */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (isPrimitive(a) && isPrimitive(b) && String(a) === String(b));
}

/** HubSpot: "A search bar will be automatically included when there are more than seven options." */
const SEARCH_THRESHOLD = 7;

/** Open state, search, active option and keyboard handling shared by Select and MultiSelect. */
function useOptionMenu(options: OptionItem[], interactive: boolean, onSearch?: (query: string) => void) {
  const popover = usePopover(interactive);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const searchable = options.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visible = searchable && q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const show = (activeIndex = -1) => {
    setQuery('');
    setActive(activeIndex);
    popover.setOpen(true);
  };
  const hide = () => {
    popover.setOpen(false);
    setQuery('');
    setActive(-1);
  };
  const search = (next: string) => {
    setQuery(next);
    setActive(next ? 0 : -1);
    onSearch?.(next);
  };
  const onKeyDown = (e: ReactKeyboardEvent, choose: (o: OptionItem) => void, startIndex = -1) => {
    if (!interactive) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!popover.isOpen) {
        show(startIndex);
        return;
      }
      const n = visible.length;
      const down = e.key === 'ArrowDown';
      setActive((i) => (n === 0 ? -1 : i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n));
    } else if (e.key === 'Enter' && popover.isOpen && visible[active]) {
      e.preventDefault();
      choose(visible[active]);
    }
  };
  return { ref: popover.ref, isOpen: popover.isOpen, query, active, setActive, visible, searchable, show, hide, search, onKeyDown };
}

type OptionMenu = ReturnType<typeof useOptionMenu>;

interface OptionListProps {
  id: string;
  menu: OptionMenu;
  multiple: boolean;
  isSelected: (o: OptionItem) => boolean;
  onChoose: (o: OptionItem) => void;
}

function OptionList({ id, menu, multiple, isSelected, onChoose }: OptionListProps) {
  return (
    <div className="hsp-input-popover hsp-select-menu" onMouseDown={keepFocus}>
      {menu.searchable && (
        <div className="hsp-select-search">
          <SearchIcon className="hsp-select-search-icon" size={14} aria-hidden="true" />
          <input
            className="hsp-control"
            type="text"
            value={menu.query}
            placeholder="Search"
            aria-label="Search options"
            aria-controls={id}
            autoFocus
            onChange={(e) => menu.search(e.target.value)}
            onKeyDown={(e) => menu.onKeyDown(e, onChoose)}
          />
        </div>
      )}
      <ul className="hsp-select-options" role="listbox" id={id} aria-multiselectable={multiple || undefined}>
        {menu.visible.map((o, i) => {
          const selected = isSelected(o);
          return (
            <li
              key={i}
              id={`${id}-${i}`}
              role="option"
              aria-selected={selected}
              className={cx('hsp-select-option', i === menu.active && 'is-active', selected && 'is-selected')}
              onMouseEnter={() => menu.setActive(i)}
              onClick={() => onChoose(o)}
            >
              {multiple && <CheckVisual radio={false} checked={selected} />}
              <span className="hsp-select-option-label">{o.label}</span>
              {!multiple && selected && <CheckIcon className="hsp-select-option-check" size={14} aria-hidden="true" />}
            </li>
          );
        })}
        {menu.visible.length === 0 && <li className="hsp-select-empty">{menu.query ? 'No results found' : 'No options'}</li>}
      </ul>
    </div>
  );
}

function SelectPreview(p: PreviewProps) {
  const { props, trigger, mode } = p;
  const id = useId();
  const listId = useId();
  const chrome = readChrome(props);
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const options = readOptions(props.options);
  const [value, setValue] = usePreviewValue<unknown>(props.value, undefined, undefined);
  const selectedIndex = options.findIndex((o) => sameValue(o.value, value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const menu = useOptionMenu(options, !design && !readOnly, (q) => trigger('onInput', q));
  const name = text(props.name);
  const placeholder = text(props.placeholder);

  const choose = (o: OptionItem) => {
    menu.hide();
    if (selected && sameValue(selected.value, o.value)) return;
    setValue(o.value);
    trigger('onChange', o.value);
  };
  return (
    <FieldShell
      rootProps={p.rootProps}
      className={cx('hsp-select', props.variant === 'transparent' && 'hsp-select-transparent')}
      chrome={chrome}
      design={design}
      controlId={id}
    >
      <div className="hsp-input-anchor" ref={menu.ref}>
        <button
          type="button"
          id={id}
          className={cx('hsp-control', 'hsp-select-trigger', chrome.error && 'hsp-invalid', readOnly && 'hsp-input-readonly')}
          tabIndex={design ? -1 : undefined}
          aria-haspopup="listbox"
          aria-expanded={menu.isOpen}
          aria-controls={menu.isOpen ? listId : undefined}
          aria-activedescendant={menu.isOpen && menu.active >= 0 ? `${listId}-${menu.active}` : undefined}
          aria-invalid={chrome.error || undefined}
          aria-required={chrome.required || undefined}
          aria-readonly={readOnly || undefined}
          onClick={() => (menu.isOpen ? menu.hide() : menu.show(selectedIndex))}
          onKeyDown={(e) => menu.onKeyDown(e, choose, selectedIndex)}
        >
          <span className={cx('hsp-select-value', !selected && 'hsp-select-placeholder')}>
            {selected ? selected.label : (placeholder ?? '')}
          </span>
          <ChevronDownIcon className="hsp-select-caret" size={16} aria-hidden="true" />
        </button>
        {menu.isOpen && (
          <OptionList id={listId} menu={menu} multiple={false} isSelected={(o) => sameValue(o.value, value)} onChoose={choose} />
        )}
        {name !== undefined && <input type="hidden" name={name} value={str(value)} {...formValueAttrs(value)} />}
      </div>
    </FieldShell>
  );
}

function MultiSelectPreview(p: PreviewProps) {
  const { props, trigger, mode } = p;
  const labelId = useId();
  const listId = useId();
  const chrome = readChrome(props);
  const design = mode === 'design';
  const readOnly = bool(props.readOnly);
  const interactive = !design && !readOnly;
  const options = readOptions(props.options);
  const controlled = props.value === undefined ? undefined : Array.isArray(props.value) ? (props.value as unknown[]) : [];
  const [value, setValue] = usePreviewValue<unknown[]>(controlled, undefined, []);
  const menu = useOptionMenu(options, interactive);
  const name = text(props.name);
  const placeholder = text(props.placeholder);
  const selected = value.map((v) => options.find((o) => sameValue(o.value, v)) ?? { label: str(v), value: v });

  const update = (next: unknown[]) => {
    setValue(next);
    trigger('onChange', next);
  };
  const toggle = (o: OptionItem) => {
    const on = value.some((v) => sameValue(v, o.value));
    update(on ? value.filter((v) => !sameValue(v, o.value)) : [...value, o.value]);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!interactive || e.target !== e.currentTarget) return;
    if (e.key === 'Backspace' && !menu.isOpen && value.length > 0) {
      update(value.slice(0, -1));
    } else if ((e.key === 'Enter' || e.key === ' ') && !menu.isOpen) {
      e.preventDefault();
      menu.show();
    } else {
      menu.onKeyDown(e, toggle);
    }
  };
  return (
    <FieldShell
      rootProps={p.rootProps}
      className={cx('hsp-multiselect', props.variant === 'transparent' && 'hsp-select-transparent')}
      chrome={chrome}
      design={design}
      labelId={labelId}
    >
      <div className="hsp-input-anchor" ref={menu.ref}>
        <div
          className={cx('hsp-control', 'hsp-ms-trigger', chrome.error && 'hsp-invalid', readOnly && 'hsp-input-readonly')}
          role="combobox"
          tabIndex={interactive ? 0 : -1}
          aria-labelledby={chrome.label !== undefined ? labelId : undefined}
          aria-haspopup="listbox"
          aria-expanded={menu.isOpen}
          aria-controls={menu.isOpen ? listId : undefined}
          aria-activedescendant={menu.isOpen && menu.active >= 0 ? `${listId}-${menu.active}` : undefined}
          aria-invalid={chrome.error || undefined}
          aria-required={chrome.required || undefined}
          aria-readonly={readOnly || undefined}
          onClick={() => {
            if (interactive) (menu.isOpen ? menu.hide : menu.show)();
          }}
          onKeyDown={onKeyDown}
        >
          {selected.length === 0 && <span className="hsp-select-placeholder">{placeholder ?? ''}</span>}
          {selected.map((o, i) => (
            <span key={i} className="hsp-ms-tag">
              <span className="hsp-ms-tag-label">{o.label}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="hsp-ms-tag-remove"
                  aria-label={`Remove ${o.label}`}
                  tabIndex={design ? -1 : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (interactive) update(value.filter((_, j) => j !== i));
                  }}
                >
                  <XIcon size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <ChevronDownIcon className="hsp-select-caret" size={16} aria-hidden="true" />
        </div>
        {menu.isOpen && (
          <OptionList
            id={listId}
            menu={menu}
            multiple
            isSelected={(o) => value.some((v) => sameValue(v, o.value))}
            onChoose={toggle}
          />
        )}
        {name !== undefined && <input type="hidden" name={name} value={str(value)} {...formValueAttrs(value)} />}
      </div>
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Checkbox, RadioButton, Toggle, ToggleGroup
// ---------------------------------------------------------------------------

/**
 * The drawn box / circle. Next to a native input its look follows `:checked` (so standalone radio
 * groups stay consistent); in menus pass `checked` explicitly.
 */
function CheckVisual({ radio, checked }: { radio: boolean; checked?: boolean }) {
  return (
    <span className={cx('hsp-check-box', checked && 'is-checked')} aria-hidden="true">
      {radio ? <span className="hsp-check-dot" /> : <CheckIcon className="hsp-check-mark" size={12} strokeWidth={3} />}
    </span>
  );
}

/**
 * Dispatched on the document (detail: the radio input) when a standalone RadioButton is selected,
 * so same-name siblings can clear their local state in the same React batch.
 */
const RADIO_SELECT_EVENT = 'hsp-radio-select';

function CheckablePreview({ preview, kind }: { preview: PreviewProps; kind: 'checkbox' | 'radio' }) {
  const { props, text: labelText, trigger, rootProps, mode } = preview;
  const inputRef = useRef<HTMLInputElement>(null);
  const design = mode === 'design';
  const readOnly = bool(props.readOnly) || bool(props.readonly);
  const name = text(props.name);
  const value = props.value === undefined || props.value === null ? undefined : str(props.value);
  const description = text(props.description);
  const [checked, setChecked] = usePreviewValue<boolean>(
    props.checked === undefined ? undefined : bool(props.checked),
    bool(props.initialIsChecked),
    false,
  );

  // Standalone RadioButtons sharing a name act as a group: when a sibling is selected the browser
  // unchecks this one without a change event. Clear local state in the same React batch as the
  // sibling's update, so React's restore of controlled radios sees consistent props.
  useEffect(() => {
    const input = inputRef.current;
    if (kind !== 'radio' || !name || !input) return;
    const onSiblingSelect = (e: Event) => {
      const other = (e as CustomEvent<unknown>).detail;
      if (other instanceof HTMLInputElement && other !== input && other.name === name && other.form === input.form) {
        setChecked(false);
      }
    };
    const doc = input.ownerDocument;
    doc.addEventListener(RADIO_SELECT_EVENT, onSiblingSelect);
    return () => doc.removeEventListener(RADIO_SELECT_EVENT, onSiblingSelect);
    // `setChecked` is omitted on purpose: it only writes local state through a stable setter.
  }, [kind, name]);

  // Read-only / design: ignore the change; React restores the controlled `checked` afterwards.
  // (Cancelling the click instead would fight that restore and flip the box.)
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (readOnly || design) return;
    const next = kind === 'radio' ? true : e.target.checked;
    setChecked(next);
    if (kind === 'radio') {
      e.target.ownerDocument.dispatchEvent(new CustomEvent(RADIO_SELECT_EVENT, { detail: e.target }));
    }
    // HubSpot: onChange(checked: boolean, value: string).
    trigger('onChange', next, value ?? '');
  };
  return (
    <label
      {...rootProps}
      className={cx(
        'hsp-check',
        `hsp-check-${kind}`,
        checkSize(props.size, props.variant) === 'small' && 'hsp-check-small',
        bool(props.inline) && 'hsp-check-inline',
        readOnly && 'hsp-check-readonly',
        rootProps.className,
      )}
      onClick={cancelInDesign(design)}
    >
      <input
        ref={inputRef}
        type={kind}
        className="hsp-check-input"
        name={name}
        // Only pass `value` when set: React writes value="" for an explicit undefined, which
        // would change what the Form submits for this checkbox.
        {...(value !== undefined ? { value } : {})}
        checked={checked}
        tabIndex={design ? -1 : undefined}
        aria-label={kind === 'checkbox' ? text(props['aria-label']) : undefined}
        aria-readonly={readOnly || undefined}
        onChange={onChange}
      />
      <CheckVisual radio={kind === 'radio'} />
      {(labelText !== '' || description !== undefined) && (
        <span className="hsp-check-text">
          {labelText !== '' && <span className="hsp-check-label">{labelText}</span>}
          {description !== undefined && <span className="hsp-field-description">{description}</span>}
        </span>
      )}
    </label>
  );
}

const CheckboxPreview = (p: PreviewProps) => <CheckablePreview preview={p} kind="checkbox" />;
const RadioButtonPreview = (p: PreviewProps) => <CheckablePreview preview={p} kind="radio" />;

function toggleSize(size: unknown): 'extra-small' | 'small' | 'medium' {
  const s = normalizeSize(size);
  return s === 'extra-small' || s === 'small' ? s : 'medium';
}

function TogglePreview(p: PreviewProps) {
  const { props, trigger, mode, rootProps } = p;
  const id = useId();
  const design = mode === 'design';
  const label = text(props.label);
  const readOnly = bool(props.readOnly) || bool(props.readonly);
  const size = toggleSize(props.size);
  const labelDisplay = oneOf(props.labelDisplay, ['inline', 'top', 'hidden'] as const, 'inline');
  const [checked, setChecked] = usePreviewValue<boolean>(
    props.checked === undefined ? undefined : bool(props.checked),
    bool(props.initialIsChecked),
    false,
  );
  const onText = props.textChecked === undefined ? 'ON' : str(props.textChecked);
  const offText = props.textUnchecked === undefined ? 'OFF' : str(props.textUnchecked);

  // Read-only / design: ignore the change; React restores the controlled `checked`.
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (readOnly || design) return;
    setChecked(e.target.checked);
    trigger('onChange', e.target.checked);
  };
  return (
    <div
      {...rootProps}
      className={cx('hsp-switch', `hsp-switch-${size}`, `hsp-switch-label-${labelDisplay}`, readOnly && 'hsp-switch-readonly', rootProps.className)}
    >
      {labelDisplay === 'top' && label !== undefined && (
        <label className="hsp-field-label" htmlFor={id} onClick={cancelInDesign(design)}>
          {label}
        </label>
      )}
      <label className="hsp-switch-control" onClick={cancelInDesign(design)}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="hsp-switch-input"
          name={text(props.name)}
          checked={checked}
          tabIndex={design ? -1 : undefined}
          aria-label={labelDisplay === 'hidden' ? label : undefined}
          aria-readonly={readOnly || undefined}
          onChange={onChange}
        />
        <span className={cx('hsp-switch-track', checked && 'is-checked')} aria-hidden="true">
          {/* Only medium toggles show the ON/OFF text. */}
          {size === 'medium' && <span className="hsp-switch-text">{checked ? onText : offText}</span>}
          <span className="hsp-switch-thumb" />
        </span>
        {labelDisplay === 'inline' && label !== undefined && <span className="hsp-switch-label">{label}</span>}
      </label>
    </div>
  );
}

/** ToggleGroup value normalised to its toggleType: string[] (checkboxList) or string (radioButtonList). */
function groupValue(v: unknown, radio: boolean): string[] | string {
  if (radio) return Array.isArray(v) ? str(v[0]) : str(v);
  if (Array.isArray(v)) return v.map((x) => str(x));
  return typeof v === 'string' && v !== '' ? [v] : [];
}

function ToggleGroupPreview(p: PreviewProps) {
  const { props, trigger, mode } = p;
  const labelId = useId();
  const chrome = readChrome(props);
  const design = mode === 'design';
  const radio = props.toggleType === 'radioButtonList';
  const options = readOptions(props.options);
  const small = checkSize(props.size, props.variant) === 'small';
  const name = text(props.name);
  const initial = useStableValue(
    radio
      ? str(options.find((o) => o.initialIsChecked)?.value ?? '')
      : options.filter((o) => o.initialIsChecked).map((o) => String(o.value)),
  );
  const [raw, setValue] = usePreviewValue<string[] | string>(
    props.value === undefined ? undefined : groupValue(props.value, radio),
    initial,
    radio ? '' : [],
  );
  // Normalise again: toggleType may have been switched in the designer while local state is kept.
  const current = groupValue(raw, radio);
  const list = Array.isArray(current) ? current : [];

  const onToggle = (o: OptionItem, on: boolean) => {
    if (o.readOnly || design) return;
    const v = String(o.value);
    if (radio) {
      if (!on || current === v) return;
      setValue(v);
      trigger('onChange', v);
      return;
    }
    const set = new Set(on ? [...list, v] : list.filter((x) => x !== v));
    // Report checked values in option order, keeping unknown values at the end.
    const ordered = options.map((x) => String(x.value)).filter((x) => set.has(x));
    const next = [...new Set([...ordered, ...[...set].filter((x) => !ordered.includes(x))])];
    setValue(next);
    trigger('onChange', next);
  };
  return (
    <FieldShell rootProps={p.rootProps} className="hsp-toggle-group" chrome={chrome} design={design} labelId={labelId} group>
      <div className={cx('hsp-toggle-group-options', bool(props.inline) && 'hsp-toggle-group-inline')}>
        {options.map((o, i) => {
          const v = String(o.value);
          const on = radio ? current === v : list.includes(v);
          return (
            <label
              key={i}
              className={cx('hsp-check', radio ? 'hsp-check-radio' : 'hsp-check-checkbox', small && 'hsp-check-small', o.readOnly && 'hsp-check-readonly')}
              onClick={cancelInDesign(design)}
            >
              <input
                type={radio ? 'radio' : 'checkbox'}
                className="hsp-check-input"
                value={v}
                checked={on}
                tabIndex={design ? -1 : undefined}
                aria-readonly={o.readOnly || undefined}
                onChange={(e) => onToggle(o, e.target.checked)}
              />
              <CheckVisual radio={radio} />
              <span className="hsp-check-text">
                <span className="hsp-check-label">{o.label}</span>
                {o.description !== undefined && <span className="hsp-field-description">{o.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {/* The option inputs are unnamed: the group's value is submitted once, as a typed value. */}
      {name !== undefined && <input type="hidden" name={name} value={str(current)} {...formValueAttrs(current)} />}
    </FieldShell>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function FormPreview({ node, props, children, rootProps, trigger }: PreviewProps) {
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // HubSpot always prevents the default submission (no page load) and hands the handler a
    // FormSubmitExtensionEvent whose targetValue holds the values by input name.
    e.preventDefault();
    // Nested <form> previews (invalid in HubSpot too) must not submit their ancestors.
    e.stopPropagation();
    trigger('onSubmit', {
      type: 'submit',
      bubbles: true,
      timeStamp: e.timeStamp,
      id: node.id,
      targetValue: collectFormValues(e.currentTarget),
    });
  };
  return (
    <form
      {...rootProps}
      className={cx('hsp-form', rootProps.className)}
      autoComplete={props.autoComplete === 'off' ? 'off' : 'on'}
      noValidate
      onSubmit={onSubmit}
    >
      {children}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Definition building blocks
// ---------------------------------------------------------------------------

const TEST_ID_PROP: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

const labelProp = (required: boolean, where = 'above the input'): PropDef => ({
  name: 'label',
  label: 'Label',
  type: { kind: 'string' },
  required,
  group: 'Content',
  description: `The text that displays ${where}.`,
});

const nameProp = (required: boolean): PropDef => ({
  name: 'name',
  label: 'Name',
  type: { kind: 'string', placeholder: 'e.g. firstname' },
  required,
  group: 'Content',
  description: 'A short unique name for the field (no spaces). A form’s submitted answers use it, e.g. event.targetValue.firstname.',
});

const PLACEHOLDER_PROP: PropDef = {
  name: 'placeholder',
  label: 'Placeholder',
  type: { kind: 'string' },
  group: 'Content',
  description: 'Greyed-out example text shown while the field is empty.',
};

const DESCRIPTION_PROP: PropDef = {
  name: 'description',
  label: 'Help text',
  type: { kind: 'string', multiline: true },
  group: 'Content',
  description: 'A short explanation shown under the label.',
};

const TOOLTIP_PROP: PropDef = {
  name: 'tooltip',
  label: 'Tooltip',
  type: { kind: 'string' },
  group: 'Content',
  description: 'Extra help shown when hovering the (?) icon next to the label.',
};

const REQUIRED_PROP: PropDef = {
  name: 'required',
  label: 'Required',
  type: { kind: 'boolean' },
  defaultValue: false,
  group: 'Validation',
  description: 'Shows a red * next to the label. It doesn’t stop the form from being sent: check the answer in Events › On submit.',
};

const readOnlyProp = (subject = 'change the value'): PropDef => ({
  name: 'readOnly',
  label: 'Read only',
  type: { kind: 'boolean' },
  defaultValue: false,
  group: 'Behavior',
  description: `When on, users cannot ${subject}.`,
});

const ERROR_PROP: PropDef = {
  name: 'error',
  label: 'Show as error',
  type: { kind: 'boolean' },
  defaultValue: false,
  group: 'Validation',
  description: 'Outlines the field in red and shows the message below as an error. Use Rules or fx to turn it on only when the answer is wrong.',
};

const VALIDATION_MESSAGE_PROP: PropDef = {
  name: 'validationMessage',
  label: 'Message under the field',
  type: { kind: 'string' },
  group: 'Validation',
  description: 'Shown below the field: as an error when “Show as error” is on, otherwise as a success message.',
};

/** BaseInputProps<T>: label, name, (placeholder), description, tooltip, value, defaultValue, ... */
function baseInputProps(valueType: PropType, subject: string, opts: { placeholder?: boolean } = {}): PropDef[] {
  return [
    labelProp(true),
    nameProp(true),
    ...(opts.placeholder === false ? [] : [PLACEHOLDER_PROP]),
    DESCRIPTION_PROP,
    TOOLTIP_PROP,
    {
      name: 'value',
      label: 'Value',
      type: valueType,
      group: 'Data',
      description: `The ${subject} shown in the field. Usually linked to a variable under “Value binding” so the card can use what people enter.`,
    },
    {
      name: 'defaultValue',
      label: 'Starting value',
      type: valueType,
      group: 'Data',
      description: `The ${subject} the field starts with (when Value is not set).`,
    },
    REQUIRED_PROP,
    readOnlyProp('enter a value'),
    ERROR_PROP,
    VALIDATION_MESSAGE_PROP,
  ];
}

const minMaxProps = (type: PropType, subject: string): PropDef[] => {
  const when = type.kind === 'date' || type.kind === 'time';
  return [
    { name: 'min', label: when ? 'Earliest allowed' : 'Lowest allowed', type, group: 'Validation', description: `The ${when ? 'earliest' : 'lowest'} ${subject} people can enter.` },
    { name: 'max', label: when ? 'Latest allowed' : 'Highest allowed', type, group: 'Validation', description: `The ${when ? 'latest' : 'highest'} ${subject} people can enter.` },
  ];
};

const PRECISION_PROP: PropDef = {
  name: 'precision',
  label: 'Decimal places',
  type: { kind: 'number', min: 0, max: 20, step: 1, integer: true },
  group: 'Appearance',
  description: 'How many digits are shown after the decimal point.',
};

const FORMAT_STYLE_PROP: PropDef = {
  name: 'formatStyle',
  label: 'Show as',
  type: {
    kind: 'enum',
    options: [
      { value: 'decimal', label: 'Decimal' },
      { value: 'percentage', label: 'Percentage' },
    ],
  },
  defaultValue: 'decimal',
  group: 'Appearance',
  description: 'A plain number, or a percentage (e.g. 0.25 shows as 25%).',
};

const TIMEZONE_OPTIONS = [
  { value: 'userTz', label: 'The person’s time zone' },
  { value: 'portalTz', label: 'The HubSpot account’s time zone' },
];

const CHECK_SIZE_PROP: PropDef = {
  name: 'size',
  label: 'Size',
  type: {
    kind: 'enum',
    options: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
    ],
  },
  defaultValue: 'medium',
  group: 'Appearance',
  description: 'The size of the control.',
};

type InputEventName = 'onChange' | 'onInput' | 'onBlur' | 'onFocus';

const EVENT_COPY: Record<InputEventName, { label: string; description: string }> = {
  onChange: {
    label: 'On change',
    description: 'Runs when the value is committed: when the field loses focus, on Enter, or when the form is submitted.',
  },
  onInput: {
    label: 'On input',
    description: 'Runs on every edit with the current text. Use it for validation; update state in On change.',
  },
  onBlur: { label: 'On blur', description: 'Runs when the field loses focus.' },
  onFocus: { label: 'On focus', description: 'Runs when the field gains focus.' },
};

/** Input events `(value) => void`, in HubSpot's order. */
function inputEvents(names: InputEventName[], valueDescription: string, changeDescription?: string): EventDef[] {
  return names.map((name) => ({
    name,
    label: EVENT_COPY[name].label,
    description: name === 'onChange' && changeDescription ? changeDescription : EVENT_COPY[name].description,
    params: [{ name: 'value', description: valueDescription }],
  }));
}

const DATE_PAYLOAD = '{ year, month (0-11), date, formattedDate }';
const TIME_PAYLOAD = '{ hours (0-23), minutes }';

/** onChange(checked, value) of Checkbox / RadioButton. */
const CHECK_CHANGE_EVENT: EventDef = {
  name: 'onChange',
  label: 'On change',
  description: 'Runs when the control is selected or cleared.',
  params: [
    { name: 'checked', description: 'boolean: the new checked state' },
    { name: 'value', description: "string: the control's Value prop" },
  ],
};

const OPTIONS_PROP = (optionFields: Array<'description' | 'initialIsChecked' | 'readOnly'>, extra: Partial<PropDef> = {}): PropDef => ({
  name: 'options',
  label: 'Options',
  type: { kind: 'options', optionFields },
  required: true,
  group: 'Content',
  description: 'The choices people can pick. Each has a label (what people see) and a value (what the card and the form receive).',
  ...extra,
});

const SELECT_VARIANT_PROP: PropDef = {
  name: 'variant',
  label: 'Style',
  type: {
    kind: 'enum',
    options: [
      { value: 'input', label: 'Field' },
      { value: 'transparent', label: 'Text only' },
    ],
  },
  defaultValue: 'input',
  group: 'Appearance',
  description: 'A regular field with a border, or a borderless dropdown that looks like text.',
};

/** BaseSelectProps (label and name are optional for selects). */
function baseSelectProps(valueProp: PropDef, optionsProp: PropDef): PropDef[] {
  return [
    labelProp(false),
    nameProp(false),
    PLACEHOLDER_PROP,
    DESCRIPTION_PROP,
    TOOLTIP_PROP,
    optionsProp,
    valueProp,
    SELECT_VARIANT_PROP,
    REQUIRED_PROP,
    readOnlyProp('change the selection'),
    ERROR_PROP,
    VALIDATION_MESSAGE_PROP,
    TEST_ID_PROP,
  ];
}

const checkableProps = (kind: 'checkbox' | 'radio button', plural: string): PropDef[] => [
  nameProp(false),
  {
    name: 'value',
    label: 'Value',
    type: { kind: 'string' },
    group: 'Data',
    description: `The ${kind} value. Not displayed; it is submitted with the form (with the name) and passed to On change.`,
  },
  {
    name: 'checked',
    label: 'Checked',
    type: { kind: 'boolean' },
    defaultValue: false,
    group: 'Data',
    description: `When on, the ${kind} is selected. Bind it to a boolean state variable to control it.`,
  },
  {
    name: 'initialIsChecked',
    label: 'Initially checked',
    type: { kind: 'boolean' },
    defaultValue: false,
    group: 'Data',
    description: `When on, the ${kind} is selected by default (uncontrolled).`,
  },
  DESCRIPTION_PROP,
  readOnlyProp(`select the ${kind}`),
  CHECK_SIZE_PROP,
  {
    name: 'inline',
    label: 'Inline',
    type: { kind: 'boolean' },
    defaultValue: false,
    group: 'Layout',
    description: `Arranges ${plural} side by side instead of stacking them.`,
  },
];

const DEMO_STAGES = [
  { label: 'Appointment scheduled', value: 'appointmentscheduled' },
  { label: 'Qualified to buy', value: 'qualifiedtobuy' },
  { label: 'Closed won', value: 'closedwon' },
];

// ---------------------------------------------------------------------------
// Registry definitions
// ---------------------------------------------------------------------------

export const inputComponents: ComponentDef[] = [
  {
    type: 'Form',
    label: 'Form',
    category: 'Forms & inputs',
    description: 'A form that groups inputs and a submit button. On submit it receives the values of its inputs by name.',
    icon: NotebookPenIcon,
    docsUrl: `${STANDARD_DOCS}/form`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['form', 'submit', 'fields', 'inputs', 'questionnaire', 'collect data'],
    children: { mode: 'nodes', required: true, placeholder: 'Drop inputs and a submit button here' },
    create: (): NodeTemplate => ({
      type: 'Form',
      children: [
        {
          type: 'Flex',
          props: { direction: 'column', gap: 'small', align: 'start' },
          children: [
            { type: 'Input', props: { label: 'First name', name: 'firstname' } },
            { type: 'Input', props: { label: 'Email', name: 'email', required: true, placeholder: 'name@company.com' } },
            { type: 'Button', props: { type: 'submit', variant: 'primary' }, text: 'Submit' },
          ],
        },
      ],
    }),
    props: [
      {
        name: 'autoComplete',
        label: 'Autocomplete',
        type: {
          kind: 'enum',
          options: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ],
        },
        defaultValue: 'on',
        group: 'Behavior',
        description: 'Set to Off to stop browsers and password managers from auto-filling the fields.',
      },
      {
        name: 'preventDefault',
        label: 'Prevent default',
        type: { kind: 'boolean' },
        defaultValue: true,
        deprecated: true,
        group: 'Advanced',
        description: 'Deprecated: HubSpot now always prevents the default submit behaviour. Handle submission in On submit.',
      },
      TEST_ID_PROP,
    ],
    events: [
      {
        name: 'onSubmit',
        label: 'On submit',
        description: 'Runs when the form is submitted (e.g. by a Button with type Submit). The values are in event.targetValue, keyed by input name.',
        params: [{ name: 'event', description: 'FormSubmitExtensionEvent { type, id, timeStamp, targetValue }' }],
      },
    ],
    preview: FormPreview,
  },
  {
    type: 'Input',
    label: 'Input',
    category: 'Forms & inputs',
    description: 'A single-line text field. Use it inside a Form or bind it to a state variable.',
    icon: TextCursorInputIcon,
    docsUrl: `${STANDARD_DOCS}/input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['text field', 'text box', 'textbox', 'password', 'email', 'name', 'field'],
    children: { mode: 'none' },
    create: () => ({ type: 'Input', props: { label: 'First name', name: 'firstname' } }),
    props: [
      ...baseInputProps({ kind: 'string' }, 'text value'),
      {
        name: 'type',
        label: 'Type',
        type: {
          kind: 'enum',
          options: [
            { value: 'text', label: 'Text' },
            { value: 'password', label: 'Password' },
          ],
        },
        defaultValue: 'text',
        group: 'Behavior',
        description: 'The type of input. Password hides the characters that users type.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onInput', 'onBlur', 'onFocus'], 'string: the text'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'string', initial: '' },
    preview: InputPreview,
  },
  {
    type: 'TextArea',
    label: 'Text area',
    category: 'Forms & inputs',
    description: 'A multi-line text field for longer text such as notes or comments.',
    icon: LetterTextIcon,
    docsUrl: `${STANDARD_DOCS}/text-area`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['textarea', 'multiline', 'notes', 'comments', 'message', 'paragraph'],
    children: { mode: 'none' },
    create: () => ({ type: 'TextArea', props: { label: 'Notes', name: 'notes', placeholder: 'Add a note…' } }),
    props: [
      ...baseInputProps({ kind: 'string', multiline: true }, 'text value'),
      {
        name: 'rows',
        label: 'Rows',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Layout',
        description: 'The number of visible text lines.',
      },
      {
        name: 'cols',
        label: 'Columns',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Layout',
        description: 'The visible width of the field, in average character widths.',
      },
      {
        name: 'resize',
        label: 'Resize',
        type: {
          kind: 'enum',
          options: [
            { value: 'both', label: 'Both directions' },
            { value: 'vertical', label: 'Vertical' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'none', label: 'None' },
          ],
        },
        defaultValue: 'both',
        group: 'Layout',
        description: 'Whether and in which directions users can resize the field.',
      },
      {
        name: 'maxLength',
        label: 'Max length',
        type: { kind: 'number', min: 0, step: 1, integer: true },
        group: 'Validation',
        description: 'The maximum number of characters users can enter. Unlimited when not set.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onInput', 'onBlur', 'onFocus'], 'string: the text'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'string', initial: '' },
    preview: TextAreaPreview,
  },
  {
    type: 'NumberInput',
    label: 'Number input',
    category: 'Forms & inputs',
    description: 'A number field with optional min/max, precision and percentage formatting.',
    icon: HashIcon,
    docsUrl: `${STANDARD_DOCS}/number-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['number', 'numeric', 'quantity', 'amount', 'percent', 'percentage', 'decimal', 'integer'],
    children: { mode: 'none' },
    create: () => ({ type: 'NumberInput', props: { label: 'Quantity', name: 'quantity', min: 0 } }),
    props: [
      ...baseInputProps({ kind: 'number' }, 'number value'),
      ...minMaxProps({ kind: 'number' }, 'number'),
      PRECISION_PROP,
      FORMAT_STYLE_PROP,
      {
        name: 'textAlign',
        label: 'Text align',
        type: {
          kind: 'enum',
          options: [
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ],
        },
        defaultValue: 'left',
        group: 'Appearance',
        description: 'Horizontal alignment of the text in the input.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onBlur', 'onFocus'], 'number: the value (undefined when cleared)'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'number', initial: 0 },
    preview: NumberInputPreview,
  },
  {
    type: 'CurrencyInput',
    label: 'Currency input',
    category: 'Forms & inputs',
    description: 'A money amount field with the currency symbol and currency-specific decimals.',
    icon: CircleDollarSignIcon,
    docsUrl: `${STANDARD_DOCS}/currency-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['money', 'price', 'amount', 'dollar', 'euro', 'currency', 'deal amount', 'budget'],
    children: { mode: 'none' },
    create: () => ({ type: 'CurrencyInput', props: { label: 'Deal amount', name: 'amount', currency: 'USD' } }),
    props: [
      ...baseInputProps({ kind: 'number' }, 'amount'),
      {
        name: 'currency',
        label: 'Currency',
        type: { kind: 'string', placeholder: 'USD' },
        defaultValue: 'USD',
        group: 'Appearance',
        description: 'ISO 4217 currency code, e.g. USD, EUR or JPY.',
      },
      {
        ...PRECISION_PROP,
        description: 'Number of decimal places. Defaults to the currency’s precision (e.g. 2 for USD, 0 for JPY).',
      },
      ...minMaxProps({ kind: 'number' }, 'amount'),
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onBlur', 'onFocus'], 'number: the amount (undefined when cleared)'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'number', initial: 0 },
    preview: CurrencyInputPreview,
  },
  {
    type: 'StepperInput',
    label: 'Stepper input',
    category: 'Forms & inputs',
    description: 'A number field with − and + buttons that change the value by a set step.',
    icon: DiffIcon,
    docsUrl: `${STANDARD_DOCS}/stepper-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['stepper', 'counter', 'increment', 'decrement', 'quantity', 'plus minus', 'spinner'],
    children: { mode: 'none' },
    create: () => ({ type: 'StepperInput', props: { label: 'Seats', name: 'seats', min: 1, max: 100, defaultValue: 1 } }),
    props: [
      ...baseInputProps({ kind: 'number' }, 'number value'),
      ...minMaxProps({ kind: 'number' }, 'number'),
      {
        name: 'stepSize',
        label: 'Step size',
        type: { kind: 'number', min: 0, step: 1 },
        defaultValue: 1,
        group: 'Behavior',
        description: 'The amount the value increases or decreases by.',
      },
      PRECISION_PROP,
      FORMAT_STYLE_PROP,
      {
        name: 'minValueReachedTooltip',
        label: 'Min reached tooltip',
        type: { kind: 'string' },
        group: 'Behavior',
        description: 'Tooltip shown on the − button when the minimum value is reached.',
      },
      {
        name: 'maxValueReachedTooltip',
        label: 'Max reached tooltip',
        type: { kind: 'string' },
        group: 'Behavior',
        description: 'Tooltip shown on the + button when the maximum value is reached.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onBlur', 'onFocus'], 'number: the value (undefined when cleared)'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'number', initial: 0 },
    preview: StepperInputPreview,
  },
  {
    type: 'DateInput',
    label: 'Date input',
    category: 'Forms & inputs',
    description: 'A date field with a calendar picker. Values are { year, month (0-based), date } objects.',
    icon: CalendarDaysIcon,
    docsUrl: `${STANDARD_DOCS}/date-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['date', 'calendar', 'day', 'datepicker', 'deadline', 'close date', 'birthday'],
    children: { mode: 'none' },
    create: () => ({ type: 'DateInput', props: { label: 'Close date', name: 'closedate' } }),
    props: [
      ...baseInputProps({ kind: 'date' }, 'date', { placeholder: false }),
      {
        name: 'format',
        label: 'Format',
        type: {
          kind: 'enum',
          options: [
            { value: 'short', label: 'Short (09/04/1986)' },
            { value: 'medium', label: 'Medium (Sep 4, 1986)' },
            { value: 'long', label: 'Long (September 4, 1986)' },
            { value: 'standard', label: 'Standard (1986-09-04)' },
            { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (1986-09-04)' },
            { value: 'L', label: 'L (09/04/1986)' },
            { value: 'LL', label: 'LL (September 4, 1986)' },
            { value: 'll', label: 'll (Sep 4, 1986)' },
          ],
        },
        defaultValue: 'short',
        group: 'Appearance',
        description: 'How the selected date is displayed (and formatted in formattedDate).',
      },
      ...minMaxProps({ kind: 'date' }, 'date'),
      {
        name: 'minValidationMessage',
        label: 'Min validation message',
        type: { kind: 'string' },
        group: 'Validation',
        description: 'Message shown when hovering dates before the min date.',
      },
      {
        name: 'maxValidationMessage',
        label: 'Max validation message',
        type: { kind: 'string' },
        group: 'Validation',
        description: 'Message shown when hovering dates after the max date.',
      },
      {
        name: 'todayButtonLabel',
        label: 'Today button label',
        type: { kind: 'string', placeholder: 'Today' },
        group: 'Content',
        description: "Label of the calendar button that inserts today's date.",
      },
      {
        name: 'clearButtonLabel',
        label: 'Clear button label',
        type: { kind: 'string', placeholder: 'Clear' },
        group: 'Content',
        description: 'Label of the calendar button that clears the date.',
      },
      {
        name: 'timezone',
        label: 'Time zone',
        type: { kind: 'enum', options: TIMEZONE_OPTIONS },
        defaultValue: 'userTz',
        group: 'Behavior',
        description: 'The time zone used to calculate valid dates.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(
      ['onChange', 'onBlur', 'onFocus'],
      `${DATE_PAYLOAD}; null when cleared`,
      'Runs when a date is picked, typed (on blur / Enter) or cleared.',
    ),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'object', initial: null },
    preview: DateInputPreview,
  },
  {
    type: 'TimeInput',
    label: 'Time input',
    category: 'Forms & inputs',
    description: 'A time field with a dropdown of times. Values are { hours, minutes } objects.',
    icon: ClockIcon,
    docsUrl: `${STANDARD_DOCS}/time-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['time', 'clock', 'hour', 'minute', 'timepicker', 'meeting time', 'schedule'],
    children: { mode: 'none' },
    create: () => ({ type: 'TimeInput', props: { label: 'Meeting time', name: 'meetingtime' } }),
    props: [
      ...baseInputProps({ kind: 'time' }, 'time', { placeholder: false }),
      ...minMaxProps({ kind: 'time' }, 'time'),
      {
        name: 'interval',
        label: 'Interval (minutes)',
        type: { kind: 'number', min: 1, max: 1440, step: 1, integer: true },
        defaultValue: 30,
        group: 'Behavior',
        description: 'Minutes between the options in the dropdown.',
      },
      {
        name: 'timezone',
        label: 'Time zone',
        type: { kind: 'enum', options: TIMEZONE_OPTIONS },
        group: 'Behavior',
        description: 'The time zone used to calculate valid times.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(
      ['onChange', 'onBlur', 'onFocus'],
      `${TIME_PAYLOAD}; null when cleared`,
      'Runs when a time is picked, or typed (on blur / Enter).',
    ),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'object', initial: null },
    preview: TimeInputPreview,
  },
  {
    type: 'Select',
    label: 'Select',
    category: 'Forms & inputs',
    description: 'A dropdown to pick a single option. A search box appears automatically with more than 7 options.',
    icon: SquareChevronDownIcon,
    docsUrl: `${STANDARD_DOCS}/select`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['dropdown', 'picklist', 'choose', 'options', 'combobox', 'single select', 'menu'],
    children: { mode: 'none' },
    create: () => ({
      type: 'Select',
      props: { label: 'Deal stage', name: 'dealstage', placeholder: 'Select a stage', options: DEMO_STAGES.map((o) => ({ ...o })) },
    }),
    props: baseSelectProps(
      {
        name: 'value',
        label: 'Value',
        type: { kind: 'string' },
        group: 'Data',
        description: 'The selected option value (string, number or boolean). Bind it to a state variable to control the select.',
      },
      OPTIONS_PROP([]),
    ),
    events: [
      ...inputEvents(['onChange'], 'string | number | boolean: the selected option value', 'Runs when an option is selected.'),
      {
        name: 'onInput',
        label: 'On search input',
        description: 'Runs on every edit of the search box (shown with more than 7 options). Prefer On change to update state.',
        params: [{ name: 'value', description: 'string: the search text' }],
      },
    ],
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'string', initial: '' },
    preview: SelectPreview,
  },
  {
    type: 'MultiSelect',
    label: 'Multi-select',
    category: 'Forms & inputs',
    description: 'A dropdown to pick several options, shown as removable tags.',
    icon: ListChecksIcon,
    docsUrl: `${STANDARD_DOCS}/multi-select`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['multiselect', 'multiple', 'tags', 'dropdown', 'picklist', 'checkboxes', 'options'],
    children: { mode: 'none' },
    create: () => ({
      type: 'MultiSelect',
      props: {
        label: 'Interests',
        name: 'interests',
        placeholder: 'Select interests',
        options: [
          { label: 'Product updates', value: 'product_updates' },
          { label: 'Events', value: 'events' },
          { label: 'Webinars', value: 'webinars' },
        ],
      },
    }),
    props: baseSelectProps(
      {
        name: 'value',
        label: 'Value',
        type: { kind: 'stringList', placeholder: 'Option value' },
        group: 'Data',
        description: 'The selected option values. Bind it to an array state variable to control the select.',
      },
      OPTIONS_PROP([]),
    ),
    events: inputEvents(['onChange'], '(string | number | boolean)[]: the selected option values', 'Runs when options are added or removed.'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'array', initial: [] },
    preview: MultiSelectPreview,
  },
  {
    type: 'SearchInput',
    label: 'Search input',
    category: 'Forms & inputs',
    description: 'A text field styled for search, with a search icon and an optional clear button.',
    icon: SearchIcon,
    docsUrl: `${STANDARD_DOCS}/search-input`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['search', 'filter', 'find', 'query', 'lookup', 'search box'],
    children: { mode: 'none' },
    create: () => ({ type: 'SearchInput', props: { label: 'Search', name: 'search', placeholder: 'Search contacts' } }),
    props: [
      ...baseInputProps({ kind: 'string' }, 'search text'),
      {
        name: 'clearable',
        label: 'Clearable',
        type: { kind: 'boolean' },
        defaultValue: true,
        group: 'Behavior',
        description: 'Shows a button that clears the input.',
      },
      TEST_ID_PROP,
    ],
    events: inputEvents(['onChange', 'onInput', 'onBlur', 'onFocus'], 'string: the search text'),
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'string', initial: '' },
    preview: SearchInputPreview,
  },
  {
    type: 'Checkbox',
    label: 'Checkbox',
    category: 'Forms & inputs',
    description: 'A single checkbox with a text label. For several related checkboxes use a Toggle group.',
    icon: SquareCheckIcon,
    docsUrl: `${STANDARD_DOCS}/checkbox`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['check', 'tick', 'agree', 'consent', 'opt in', 'boolean', 'yes no'],
    children: { mode: 'text', defaultText: 'Subscribe to the newsletter' },
    create: () => ({ type: 'Checkbox', props: { name: 'subscribe' }, text: 'Subscribe to the newsletter' }),
    props: [
      ...checkableProps('checkbox', 'checkboxes'),
      {
        name: 'aria-label',
        label: 'Accessibility label',
        type: { kind: 'string' },
        group: 'Advanced',
        description: "The checkbox's accessible label, for checkboxes without visible text.",
      },
      TEST_ID_PROP,
    ],
    events: [CHECK_CHANGE_EVENT],
    valueBinding: { prop: 'checked', event: 'onChange', stateType: 'boolean', initial: false },
    preview: CheckboxPreview,
  },
  {
    type: 'RadioButton',
    label: 'Radio button',
    category: 'Forms & inputs',
    description: 'A single radio button with a text label. For a list of choices use a Toggle group.',
    icon: CircleDotIcon,
    docsUrl: `${STANDARD_DOCS}/radio-button`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['radio', 'option', 'choice', 'single choice', 'select one'],
    children: { mode: 'text', defaultText: 'Starter plan' },
    create: () => ({ type: 'RadioButton', props: { name: 'plan', value: 'starter' }, text: 'Starter plan' }),
    props: [...checkableProps('radio button', 'radio buttons'), TEST_ID_PROP],
    events: [CHECK_CHANGE_EVENT],
    valueBinding: { prop: 'checked', event: 'onChange', stateType: 'boolean', initial: false },
    preview: RadioButtonPreview,
  },
  {
    type: 'Toggle',
    label: 'Toggle',
    category: 'Forms & inputs',
    description: 'An on/off switch with a label, for settings that take effect immediately.',
    icon: ToggleRightIcon,
    docsUrl: `${STANDARD_DOCS}/toggle`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['switch', 'on off', 'enable', 'disable', 'boolean', 'setting'],
    children: { mode: 'none' },
    create: () => ({ type: 'Toggle', props: { label: 'Email notifications', name: 'notifications' } }),
    props: [
      labelProp(true, 'with the toggle'),
      {
        name: 'labelDisplay',
        label: 'Label display',
        type: {
          kind: 'enum',
          options: [
            { value: 'inline', label: 'Inline' },
            { value: 'top', label: 'Top' },
            { value: 'hidden', label: 'Hidden' },
          ],
        },
        defaultValue: 'inline',
        group: 'Appearance',
        description: 'Show the label next to the toggle, above it, or hide it (still used for accessibility).',
      },
      nameProp(false),
      {
        name: 'checked',
        label: 'Checked',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Data',
        description: 'Whether the toggle is on. Bind it to a boolean state variable to control it.',
      },
      {
        name: 'initialIsChecked',
        label: 'Initially checked',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Data',
        description: 'When on, the toggle is on by default (uncontrolled).',
      },
      readOnlyProp('switch the toggle'),
      {
        name: 'size',
        label: 'Size',
        type: {
          kind: 'enum',
          options: [
            { value: 'extra-small', label: 'Extra small' },
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
          ],
        },
        // HubSpot documents `"md"`, an alias of 'medium' (the registry offers long names).
        defaultValue: 'medium',
        group: 'Appearance',
        description: 'The size of the toggle. Only medium toggles show the ON/OFF text.',
      },
      {
        name: 'textChecked',
        label: 'Text when on',
        type: { kind: 'string', placeholder: 'ON' },
        defaultValue: 'ON',
        group: 'Appearance',
        description: 'Text shown on a medium toggle when it is on.',
      },
      {
        name: 'textUnchecked',
        label: 'Text when off',
        type: { kind: 'string', placeholder: 'OFF' },
        defaultValue: 'OFF',
        group: 'Appearance',
        description: 'Text shown on a medium toggle when it is off.',
      },
      TEST_ID_PROP,
    ],
    events: [
      {
        name: 'onChange',
        label: 'On change',
        description: 'Runs when the toggle is switched.',
        params: [{ name: 'checked', description: 'boolean: the new state' }],
      },
    ],
    valueBinding: { prop: 'checked', event: 'onChange', stateType: 'boolean', initial: false },
    preview: TogglePreview,
  },
  {
    type: 'ToggleGroup',
    label: 'Toggle group',
    category: 'Forms & inputs',
    description: 'A list of checkboxes (pick several) or radio buttons (pick one) built from options.',
    icon: ListTodoIcon,
    docsUrl: `${STANDARD_DOCS}/toggle-group`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['checkbox list', 'radio list', 'radio group', 'checkbox group', 'options', 'choices', 'multiple choice'],
    children: { mode: 'none' },
    create: () => ({
      type: 'ToggleGroup',
      props: {
        toggleType: 'checkboxList',
        name: 'channels',
        label: 'Preferred channels',
        options: [
          { label: 'Email', value: 'email' },
          { label: 'Phone', value: 'phone' },
          { label: 'SMS', value: 'sms' },
        ],
      },
    }),
    props: [
      {
        // Optional in CommonGroupProps, but the exported ToggleGroup is a union whose members
        // both require `toggleType` (remoteComponents.synced.d.ts), so generated code must set it.
        name: 'toggleType',
        label: 'Toggle type',
        type: {
          kind: 'enum',
          options: [
            { value: 'checkboxList', label: 'Checkboxes (pick several)' },
            { value: 'radioButtonList', label: 'Radio buttons (pick one)' },
          ],
        },
        required: true,
        defaultValue: 'checkboxList',
        group: 'Behavior',
        description: 'Checkboxes allow several selections; radio buttons allow only one.',
      },
      labelProp(true, 'above the toggles'),
      nameProp(true),
      TOOLTIP_PROP,
      OPTIONS_PROP(['description', 'initialIsChecked', 'readOnly'], {
        defaultValue: [],
        description:
          'The options to display. Each has a label and a unique value, plus an optional description, initialIsChecked and readOnly.',
      }),
      {
        name: 'value',
        label: 'Value',
        type: { kind: 'json', template: [], hint: 'Checkboxes: an array of option values, e.g. ["email"]. Radio buttons: one value, e.g. "email".' },
        group: 'Data',
        description:
          'The selected value(s): an array of option values for checkboxes, a single value for radio buttons. Bind it to a state variable to control the group.',
      },
      {
        name: 'inline',
        label: 'Inline',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Lays the options out horizontally instead of stacking them.',
      },
      CHECK_SIZE_PROP,
      REQUIRED_PROP,
      ERROR_PROP,
      VALIDATION_MESSAGE_PROP,
      TEST_ID_PROP,
    ],
    events: [
      {
        name: 'onChange',
        label: 'On change',
        description: 'Runs when the selection changes.',
        params: [{ name: 'value', description: 'string[] for checkboxes (checkboxList), string for radio buttons (radioButtonList)' }],
      },
    ],
    // The binding type follows the default toggleType (checkboxList → string[]). For
    // radioButtonList bind a string state variable instead (the value is a single option value).
    valueBinding: { prop: 'value', event: 'onChange', stateType: 'array', initial: [] },
    preview: ToggleGroupPreview,
  },
];
