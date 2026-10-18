/**
 * Literal value editors, one per PropType kind. Each editor receives the stored literal (or
 * undefined when unset) and reports the next literal (undefined = unset / remove the prop).
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, RotateCcw, WandSparkles } from 'lucide-react';
import { resolveCreateTemplate } from '../model/store';
import type { Extension, JsonValue, NodeId } from '../model/types';
import { getComponent } from '../registry';
import type { EnumOption, OptionSwatch, PropDef } from '../registry/types';
import { Button, cx, IconButton, NumberField, Segmented, Select, Switch, TextArea } from '../ui';
import { ChipsInput } from './ChipsInput';
import { TemplateInput } from './controls';
import { crmPropertyField, isCrmObjectTypeIdProp, isPipelineStepsProp } from './crmFields';
import { IconPicker } from './IconPicker';
import { OptionsEditor } from './OptionsEditor';
import {
  AddStatisticPanel,
  CrmObjectTypeEditor,
  CrmPropertyListEditor,
  CrmPropertyNameEditor,
  isStatisticsProp,
  PipelineStagesButton,
} from './PortalFields';
import {
  dateToInput,
  formatDefault,
  inputToDate,
  inputToTime,
  isPlainObject,
  isPropRequired,
  isPropVisible,
  matchesKind,
  optionLabel,
  prettyJson,
  timeToInput,
  urlHint,
} from './propValue';

export interface LiteralEditorProps {
  id: string;
  def: PropDef;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  ext: Extension;
  nodeId: NodeId | null;
  required: boolean;
}

/** Enum options short enough for a segmented control (full panel width). */
export function prefersSegmented(options: EnumOption[]): boolean {
  if (options.length < 2 || options.length > 4) return false;
  const labels = options.map(optionLabel);
  return labels.every((l) => l.length <= 12) && labels.join('').length <= 30;
}

/** Enum choices drawn as visual chips: color swatches, spacing samples or direction arrows. */
export function enumChips(type: PropDef['type']): 'swatch' | 'spacing' | 'direction' | null {
  if (type.kind !== 'enum') return null;
  if (type.display === 'spacing' && type.options.every((o) => SPACING_PX[String(o.value)] !== undefined)) return 'spacing';
  if (type.display === 'direction') return 'direction';
  if (type.options.length <= 8 && type.options.some((o) => o.swatch)) return 'swatch';
  return null;
}

/** Whether an editor sits next to its label ('inline') or below it ('block'). */
export function editorLayout(def: PropDef): 'inline' | 'block' {
  switch (def.type.kind) {
    case 'boolean':
    case 'number':
    case 'icon':
    case 'date':
    case 'time':
      return 'inline';
    case 'enum': {
      if (enumChips(def.type) || prefersSegmented(def.type.options)) return 'block';
      // A dropdown next to its label only fits short choices ("Start (default)" would be cut off).
      const longest = Math.max(0, ...def.type.options.map((o) => optionLabel(o).length));
      return longest + (def.defaultValue !== undefined ? 10 : 0) <= 18 ? 'inline' : 'block';
    }
    default:
      return 'block';
  }
}

export function LiteralEditor(props: LiteralEditorProps) {
  const { def, value } = props;
  // CRM components get portal-aware pickers for property names and object types.
  const nodeType = props.nodeId ? props.ext.nodes[props.nodeId]?.type : undefined;
  const component = nodeType ? getComponent(nodeType) : undefined;
  // A stored value with an unexpected shape is shown as raw JSON instead of being lost.
  if (
    value !== undefined &&
    def.type.kind !== 'json' &&
    !matchesKind(value, def.type) &&
    !(typeof value === 'string' && isStringLike(def))
  ) {
    return <JsonEditor {...props} mismatch />;
  }
  switch (def.type.kind) {
    case 'string': {
      const text = typeof value === 'string' ? value : '';
      if (!text.includes('{{')) {
        if (isCrmObjectTypeIdProp(component, def)) {
          return <CrmObjectTypeEditor id={props.id} def={def} value={text} onChange={props.onChange} required={props.required} />;
        }
        const field = crmPropertyField(component, def);
        if (field?.mode === 'single') {
          return (
            <CrmPropertyNameEditor
              id={props.id}
              def={def}
              value={text}
              onChange={props.onChange}
              ext={props.ext}
              nodeId={props.nodeId}
              field={field}
              required={props.required}
            />
          );
        }
      }
      return <StringEditor {...props} />;
    }
    case 'number':
      return <NumberEditor {...props} />;
    case 'boolean':
      return <BooleanEditor {...props} />;
    case 'enum':
      return <EnumEditor {...props} />;
    case 'href':
      return <HrefEditor {...props} />;
    case 'url':
      return <UrlEditor {...props} />;
    case 'icon':
      return (
        <IconPicker
          id={props.id}
          value={typeof value === 'string' ? value : undefined}
          placeholder={typeof def.defaultValue === 'string' ? def.defaultValue : undefined}
          onChange={props.onChange}
          allowClear={!props.required}
        />
      );
    case 'options':
      return (
        <OptionsEditor
          id={props.id}
          value={value}
          onChange={props.onChange}
          optionFields={def.type.optionFields}
          objectTypes={props.ext.kind === 'card' ? props.ext.objectTypes : []}
        />
      );
    case 'stringList': {
      const field = crmPropertyField(component, def);
      if (field?.mode === 'multiple') {
        return <CrmPropertyListEditor id={props.id} def={def} value={value} onChange={props.onChange} ext={props.ext} nodeId={props.nodeId} field={field} />;
      }
      return <StringListEditor {...props} pipelineSteps={isPipelineStepsProp(component, def)} />;
    }
    case 'date':
      return <DateEditor {...props} />;
    case 'time':
      return <TimeEditor {...props} />;
    case 'json':
      return (
        <JsonEditor
          {...props}
          extra={
            isStatisticsProp(nodeType, def) ? <AddStatisticPanel ext={props.ext} nodeId={props.nodeId} value={value} onChange={props.onChange} /> : undefined
          }
        />
      );
    case 'object':
      return <ObjectEditor {...props} />;
    default:
      return <JsonEditor {...props} />;
  }
}

/**
 * The text (no `prop`) or string prop value a component is created with (registry `create()` /
 * `children.defaultText`, as inserted by the store), e.g. "Heading" for a Heading's text. Used to
 * let a picked variable replace untouched default text.
 */
export function createdDefaultText(nodeType: string | undefined, prop?: string): string | undefined {
  if (!nodeType) return undefined;
  try {
    const tpl = resolveCreateTemplate(nodeType);
    if (tpl.type !== nodeType) return undefined;
    const v = prop === undefined ? tpl.text : tpl.props?.[prop];
    return typeof v === 'string' && v.trim() !== '' && !v.includes('{{') ? v : undefined;
  } catch {
    return undefined;
  }
}

function isStringLike(def: PropDef): boolean {
  return def.type.kind === 'string' || def.type.kind === 'url' || def.type.kind === 'href';
}

// ---------------------------------------------------------------------------

function StringEditor({ id, def, value, onChange, ext, nodeId, required }: LiteralEditorProps) {
  const type = def.type.kind === 'string' ? def.type : { kind: 'string' as const };
  const placeholder = type.placeholder ?? (typeof def.defaultValue === 'string' ? def.defaultValue : undefined);
  const nodeType = nodeId ? ext.nodes[nodeId]?.type : undefined;
  const createdText = useMemo(() => createdDefaultText(nodeType, def.name), [nodeType, def.name]);
  return (
    <TemplateInput
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={(s) => onChange(s === '' && !required ? undefined : s)}
      ext={ext}
      nodeId={nodeId}
      multiline={type.multiline}
      placeholder={placeholder}
      aria-label={def.label}
      replaceableText={createdText}
    />
  );
}

function NumberEditor({ id, def, value, onChange }: LiteralEditorProps) {
  const t = def.type.kind === 'number' ? def.type : { kind: 'number' as const };
  const n = typeof value === 'number' ? value : undefined;
  const outOfRange = n !== undefined && ((t.min !== undefined && n < t.min) || (t.max !== undefined && n > t.max));
  const notInteger = n !== undefined && t.integer && !Number.isInteger(n);
  return (
    <div className="ub-insp-num">
      <NumberField
        id={id}
        value={n}
        min={t.min}
        max={t.max}
        step={t.step ?? (t.integer ? 1 : undefined)}
        placeholder={def.defaultValue !== undefined ? String(def.defaultValue) : '—'}
        aria-label={def.label}
        aria-invalid={outOfRange || notInteger || undefined}
        className={cx((outOfRange || notInteger) && 'ub-input--invalid')}
        onChange={onChange}
      />
      {(outOfRange || notInteger) && (
        <div className="ub-field__error">
          {notInteger
            ? 'Use a whole number.'
            : t.min !== undefined && t.max !== undefined
              ? `Between ${t.min} and ${t.max}.`
              : t.min !== undefined
                ? `At least ${t.min}.`
                : `At most ${t.max}.`}
        </div>
      )}
    </div>
  );
}

function BooleanEditor({ id, def, value, onChange, required }: LiteralEditorProps) {
  const fallback = def.defaultValue === true;
  const checked = typeof value === 'boolean' ? value : fallback;
  return (
    <Switch
      id={id}
      checked={checked}
      onChange={(c) => {
        // Only store values that differ from HubSpot's default.
        if (!required && c === fallback) onChange(undefined);
        else onChange(c);
      }}
    />
  );
}

function EnumEditor({ id, def, value, onChange, required }: LiteralEditorProps) {
  const options = def.type.kind === 'enum' ? def.type.options : [];
  const defIndex = options.findIndex((o) => o.value === def.defaultValue);
  const curIndex = options.findIndex((o) => o.value === value);
  const name = useId();
  const choose = (key: string) => {
    if (key === '') return onChange(undefined);
    const o = options[Number(key)];
    if (!o) return;
    if (!required && def.defaultValue !== undefined && o.value === def.defaultValue) onChange(undefined);
    else onChange(o.value);
  };
  const chips = enumChips(def.type);
  if (chips) {
    const effective = curIndex !== -1 ? curIndex : required ? -1 : defIndex;
    return (
      <div className={cx('ub-insp-choices', `is-${chips}`)} role="radiogroup" aria-label={def.label} id={id}>
        {options.map((o, i) => {
          const label = optionLabel(o);
          const short = chips === 'spacing' ? SPACING_SHORT[String(o.value)] : undefined;
          const checked = i === effective;
          return (
            <label
              key={i}
              className={cx('ub-insp-choice', checked && 'is-on')}
              title={`${label}${String(o.value) !== label ? ` (${String(o.value)})` : ''}${i === defIndex ? ' — HubSpot default' : ''}`}
            >
              <input
                type="radio"
                className="ub-insp-choice__input"
                name={name}
                value={String(i)}
                checked={checked}
                aria-label={short ? `${short} (${label.toLowerCase()})` : undefined}
                onChange={() => choose(String(i))}
              />
              {chips === 'swatch' && <SwatchSample swatch={o.swatch} />}
              {chips === 'spacing' && <SpacingSample px={SPACING_PX[String(o.value)]} />}
              {chips === 'direction' && <DirectionSample value={String(o.value)} />}
              <span className="ub-insp-choice__label" aria-hidden={short ? true : undefined}>
                {short ?? label}
              </span>
              {i === defIndex && <span className="ub-insp-defdot" aria-label="(default)" title="HubSpot default" />}
            </label>
          );
        })}
      </div>
    );
  }
  if (prefersSegmented(options)) {
    const effective = curIndex !== -1 ? curIndex : defIndex;
    return (
      <div className="ub-insp-seg" id={id}>
        <Segmented
          aria-label={def.label}
          value={effective === -1 ? '' : String(effective)}
          onChange={choose}
          options={options.map((o, i) => ({
            value: String(i),
            label: (
              <>
                {optionLabel(o)}
                {i === defIndex && <span className="ub-insp-defdot" aria-label="(default)" title="HubSpot default" />}
              </>
            ),
            title: i === defIndex ? `${optionLabel(o)} (default)` : optionLabel(o),
          }))}
        />
      </div>
    );
  }
  // Unset shows HubSpot's default option (choosing it again keeps the prop unset).
  const effective = curIndex !== -1 ? curIndex : required ? -1 : defIndex;
  return (
    <Select
      id={id}
      aria-label={def.label}
      value={effective === -1 ? '' : String(effective)}
      onChange={choose}
      placeholder={effective === -1 ? (required ? 'Choose…' : 'Not set') : undefined}
      options={options.map((o, i) => ({
        value: String(i),
        // "Default (default)" says nothing more: only mark labels that don't already say it.
        label: i === defIndex && !/^default\b/i.test(optionLabel(o)) ? `${optionLabel(o)} (default)` : optionLabel(o),
      }))}
    />
  );
}

/** HubSpot's spacing scale in pixels (Flex gap, Divider / Spacer size). */
const SPACING_PX: Record<string, number> = { flush: 0, 'extra-small': 4, small: 8, medium: 16, large: 24, 'extra-large': 32 };
const SPACING_SHORT: Record<string, string> = { flush: 'None', 'extra-small': 'XS', small: 'S', medium: 'M', large: 'L', 'extra-large': 'XL' };

function SwatchSample({ swatch }: { swatch?: OptionSwatch }) {
  if (!swatch) return <span className="ub-insp-swatch is-none" aria-hidden />;
  return (
    <span
      className={cx('ub-insp-swatch', swatch.text && 'is-text')}
      style={{ background: swatch.fill, borderColor: swatch.border ?? swatch.fill, color: swatch.text }}
      aria-hidden
    >
      {swatch.text ? 'Aa' : null}
    </span>
  );
}

/** Two small blocks the option's spacing apart (scaled down). */
function SpacingSample({ px }: { px: number }) {
  return (
    <span className="ub-insp-space" aria-hidden>
      <i />
      <i style={{ marginLeft: Math.round(px / 2.5) }} />
    </span>
  );
}

function DirectionSample({ value }: { value: string }) {
  const down = value === 'column' || value === 'vertical';
  const Icon = down ? ArrowDown : ArrowRight;
  return <Icon size={13} aria-hidden className="ub-insp-dir" />;
}

function HrefEditor({ id, def, value, onChange, ext, nodeId, required }: LiteralEditorProps) {
  const url = typeof value === 'string' ? value : isPlainObject(value) && typeof value.url === 'string' ? value.url : '';
  const external = isPlainObject(value) && value.external === true;
  const emit = (u: string, ext0: boolean) => {
    if (!u && !ext0) onChange(required ? '' : undefined);
    else onChange(ext0 ? { url: u, external: true } : u);
  };
  const hint = urlHint(url);
  return (
    <div className="ub-insp-stack">
      <TemplateInput
        id={id}
        value={url}
        onChange={(u) => emit(u, external)}
        ext={ext}
        nodeId={nodeId}
        placeholder="https://…"
        aria-label={def.label}
      />
      {hint && <div className="ub-field__hint ub-insp-warn">{hint}</div>}
      <Switch checked={external} onChange={(c) => emit(url, c)} label="Open in new tab (external)" />
    </div>
  );
}

function UrlEditor({ id, def, value, onChange, ext, nodeId, required }: LiteralEditorProps) {
  const url = typeof value === 'string' ? value : '';
  const hint = urlHint(url);
  return (
    <div className="ub-insp-stack">
      <TemplateInput
        id={id}
        value={url}
        onChange={(u) => onChange(u === '' && !required ? undefined : u)}
        ext={ext}
        nodeId={nodeId}
        placeholder={typeof def.defaultValue === 'string' ? def.defaultValue : 'https://…'}
        aria-label={def.label}
      />
      {hint && <div className="ub-field__hint ub-insp-warn">{hint}</div>}
    </div>
  );
}

function StringListEditor({ id, def, value, onChange, pipelineSteps }: LiteralEditorProps & { pipelineSteps?: boolean }) {
  const t = def.type.kind === 'stringList' ? def.type : { kind: 'stringList' as const };
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const options = 'options' in t && t.options ? t.options.map((o) => ({ value: String(o.value), label: optionLabel(o) })) : undefined;
  const chips = (
    <ChipsInput
      id={id}
      value={list}
      options={options}
      placeholder={'placeholder' in t ? t.placeholder : undefined}
      aria-label={def.label}
      onChange={(next) => onChange(next.length ? next : undefined)}
    />
  );
  if (!pipelineSteps) return chips;
  return (
    <div className="ub-insp-stack">
      {chips}
      <PipelineStagesButton onApply={(labels) => onChange(labels.length ? labels : undefined)} />
    </div>
  );
}

function DateEditor({ id, def, value, onChange }: LiteralEditorProps) {
  return (
    <input
      id={id}
      type="date"
      className="ub-input ub-insp-native"
      aria-label={def.label}
      value={dateToInput(value)}
      onChange={(e) => onChange(inputToDate(e.target.value))}
    />
  );
}

function TimeEditor({ id, def, value, onChange }: LiteralEditorProps) {
  return (
    <input
      id={id}
      type="time"
      className="ub-input ub-insp-native"
      aria-label={def.label}
      value={timeToInput(value)}
      onChange={(e) => onChange(inputToTime(e.target.value))}
    />
  );
}

/** JSON text editor with live validation. Invalid text is kept locally and not stored. */
export function JsonEditor({ id, def, value, onChange, mismatch, extra }: LiteralEditorProps & { mismatch?: boolean; extra?: ReactNode }) {
  const template = def.type.kind === 'json' ? def.type.template : undefined;
  const hint = def.type.kind === 'json' ? def.type.hint : undefined;
  const pretty = (v: JsonValue | undefined) => (v === undefined ? '' : prettyJson(v));
  const [draft, setDraft] = useState(() => pretty(value));
  const [error, setError] = useState<string | null>(null);

  // Follow external changes (undo, reset) unless the draft already represents the value.
  useEffect(() => {
    setDraft((d) => {
      try {
        if (d.trim() && JSON.stringify(JSON.parse(d)) === JSON.stringify(value)) return d;
      } catch {
        /* draft invalid: replace */
      }
      if (!d.trim() && value === undefined) return d;
      return pretty(value);
    });
    setError(null);
  }, [value]);

  const change = (text: string) => {
    setDraft(text);
    if (!text.trim()) {
      setError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(text) as JsonValue;
      setError(null);
      onChange(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^JSON\.parse: /, '') : 'Invalid JSON');
    }
  };

  return (
    <div className="ub-insp-stack">
      {mismatch && (
        <div className="ub-field__hint ub-insp-warn">This value doesn’t match the expected type; edit it as JSON or reset it.</div>
      )}
      <TextArea
        id={id}
        code
        invalid={!!error}
        rows={Math.min(14, Math.max(3, draft.split('\n').length))}
        value={draft}
        onChange={change}
        aria-label={def.label}
        aria-invalid={!!error || undefined}
        placeholder={template !== undefined ? JSON.stringify(template) : 'JSON value'}
      />
      {error ? <div className="ub-field__error">Invalid JSON — {error}</div> : hint ? <div className="ub-field__hint">{hint}</div> : null}
      {template !== undefined && (
        <div className="ub-insp-row-actions">
          <Button
            size="sm"
            variant="ghost"
            icon={<WandSparkles size={13} />}
            onClick={() => {
              const text = prettyJson(template);
              setDraft(text);
              setError(null);
              onChange(template);
            }}
          >
            Insert template
          </Button>
        </div>
      )}
      {extra}
    </div>
  );
}

/** Nested object: each field gets its own editor; unset fields are omitted from the object. */
function ObjectEditor({ def, value, onChange, ext, nodeId }: LiteralEditorProps) {
  const fields = def.type.kind === 'object' ? def.type.fields : [];
  const obj = useMemo(() => (isPlainObject(value) ? value : {}), [value]);
  const setField = (name: string, v: JsonValue | undefined) => {
    const next: Record<string, JsonValue> = { ...obj };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <div className="ub-insp-object">
      {fields
        .filter((f) => isPropVisible(f, obj))
        .map((f) => (
          <FieldRow
            key={f.name}
            def={f}
            value={obj[f.name]}
            onChange={(v) => setField(f.name, v)}
            ext={ext}
            nodeId={nodeId}
            required={isPropRequired(f, obj)}
          />
        ))}
    </div>
  );
}

/** A nested field row (object sub-field): label, editor and reset. No expression mode. */
export function FieldRow({
  def,
  value,
  onChange,
  ext,
  nodeId,
  required,
}: {
  def: PropDef;
  value: JsonValue | undefined;
  onChange: (v: JsonValue | undefined) => void;
  ext: Extension;
  nodeId: NodeId | null;
  required: boolean;
}) {
  const id = useId();
  const layout = editorLayout(def);
  const isSet = value !== undefined;
  const reset = (
    <IconButton
      size="sm"
      label={`Reset ${def.label}`}
      className={cx('ub-insp-reset', !isSet && 'is-hidden')}
      disabled={!isSet}
      onClick={() => onChange(undefined)}
    >
      <RotateCcw size={12} />
    </IconButton>
  );
  return (
    <div className={cx('ub-insp-prop', `ub-insp-prop--${layout}`, isSet && 'is-set')} data-field={def.name}>
      <div className="ub-insp-prop__label">
        <label htmlFor={id} title={describe(def)} className={cx(def.description && 'has-help')}>
          {def.label}
          {required && (
            <span className="ub-insp-req" aria-label="required">
              *
            </span>
          )}
        </label>
      </div>
      <div className="ub-insp-prop__editor">
        <LiteralEditor id={id} def={def} value={value} onChange={onChange} ext={ext} nodeId={nodeId} required={required} />
      </div>
      <span className="ub-insp-prop__tools">{reset}</span>
    </div>
  );
}

/** Tooltip text for a prop label: description + default. */
export function describe(def: PropDef): string | undefined {
  const parts: string[] = [];
  if (def.description) parts.push(def.description);
  const d = formatDefault(def);
  if (d !== undefined) parts.push(`Default: ${d}`);
  return parts.length ? parts.join('\n') : undefined;
}
