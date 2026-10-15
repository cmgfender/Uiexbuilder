/** Kind-specific editors for data sources (CRM properties, associations, search, fetch, function). */
import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Plus, SquarePen, X } from 'lucide-react';
import { staticOrigin } from '../../codegen/requirements';
import { ExpressionInput, TemplateInput } from '../../inspector/controls';
import { RequestOptions } from '../../inspector/RequestOptions';
import { useEditor } from '../../model/store';
import type {
  AssociationsSource,
  CrmPropertiesSource,
  CrmSearchSource,
  DataSource,
  Extension,
  FetchSource,
  FunctionSource,
  HttpMethod,
} from '../../model/types';
import { useDialogs } from '../../shell/dialogs';
import { Button, Field, IconButton, NumberField, Select, Switch } from '../../ui';
import { objectTypeLabel, propertiesFor } from '../crmProperties';
import { ObjectTypeSelect } from '../ObjectTypeSelect';
import { isDateProperty, propertyOptions, usePortalProperties, type PortalProperties, type PortalProperty } from '../portal';
import { PropertyPicker } from '../PropertyPicker';

export { ObjectTypeSelect } from '../ObjectTypeSelect';

function update(ds: DataSource, patch: Partial<DataSource>) {
  useEditor.getState().updateDataSource(ds.id, patch);
}

/** Field hint saying where property suggestions come from. */
function propertiesHint(catalog: PortalProperties, fallback: string): string {
  const types = catalog.objectTypes.map((t) => objectTypeLabel(t).toLowerCase()).join(', ');
  if (catalog.fromPortal) return `Your HubSpot ${types} properties. Search by label or internal name.`;
  return fallback;
}

function FormattedSwitch({ ds }: { ds: CrmPropertiesSource | AssociationsSource | CrmSearchSource }) {
  return (
    <div className="ub-pn-stack ub-pn-stack--tight">
      <Switch checked={ds.formatted === true} onChange={(formatted) => update(ds, { formatted })} label="Formatted values" />
      <span className="ub-field__hint">Dates, currency and option labels as HubSpot displays them.</span>
    </div>
  );
}

function PageLength({ ds }: { ds: AssociationsSource | CrmSearchSource }) {
  const id = useId();
  return (
    <Field label="Page size" htmlFor={id} hint="Records per page (1–100).">
      <NumberField
        id={id}
        min={1}
        max={100}
        value={ds.pageLength}
        onChange={(n) => n !== undefined && update(ds, { pageLength: Math.max(1, Math.min(100, Math.round(n))) })}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// crmProperties
// ---------------------------------------------------------------------------

export function CrmPropertiesEditor({ ext, ds }: { ext: Extension; ds: CrmPropertiesSource }) {
  const objectTypes = ext.kind === 'card' ? ext.objectTypes : [];
  const types = useMemo(() => (objectTypes.length ? objectTypes : ['contacts']), [objectTypes]);
  const catalog = usePortalProperties(types);
  return (
    <>
      <Field
        label="Properties"
        hint={propertiesHint(
          catalog,
          objectTypes.length
            ? `Suggestions for ${objectTypes.join(', ')} records. Type any internal property name.`
            : 'Type internal property names, e.g. firstname.',
        )}
      >
        <PropertyPicker
          multiple
          aria-label="Properties"
          objectTypes={types}
          catalog={catalog}
          value={ds.properties}
          placeholder="Add a property…"
          onChange={(properties) => update(ds, { properties })}
        />
      </Field>
      <FormattedSwitch ds={ds} />
    </>
  );
}

// ---------------------------------------------------------------------------
// associations
// ---------------------------------------------------------------------------

export function AssociationsEditor({ ds }: { ds: AssociationsSource }) {
  const types = useMemo(() => [ds.toObjectType], [ds.toObjectType]);
  const catalog = usePortalProperties(types);
  return (
    <>
      <Field label="Associated object type">
        <ObjectTypeSelect
          label="Associated object type"
          value={ds.toObjectType}
          onChange={(toObjectType) => update(ds, { toObjectType })}
        />
      </Field>
      <Field label="Properties" hint={propertiesHint(catalog, 'Properties to load for each associated record.')}>
        <PropertyPicker
          multiple
          aria-label="Properties"
          objectTypes={types}
          catalog={catalog}
          value={ds.properties}
          placeholder="Add a property…"
          onChange={(properties) => update(ds, { properties })}
        />
      </Field>
      <PageLength ds={ds} />
      <FormattedSwitch ds={ds} />
    </>
  );
}

// ---------------------------------------------------------------------------
// crmSearch
// ---------------------------------------------------------------------------

export const SEARCH_OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'EQ', label: 'is equal to' },
  { value: 'NEQ', label: 'is not equal to' },
  { value: 'LT', label: 'is less than' },
  { value: 'LTE', label: 'is less than or equal to' },
  { value: 'GT', label: 'is greater than' },
  { value: 'GTE', label: 'is greater than or equal to' },
  { value: 'BETWEEN', label: 'is between' },
  { value: 'IN', label: 'is any of' },
  { value: 'NOT_IN', label: 'is none of' },
  { value: 'HAS_PROPERTY', label: 'is known' },
  { value: 'NOT_HAS_PROPERTY', label: 'is unknown' },
  { value: 'CONTAINS_TOKEN', label: 'contains word' },
  { value: 'NOT_CONTAINS_TOKEN', label: 'does not contain word' },
];

/** Operator labels that read naturally for dates. */
const DATE_OPERATOR_LABELS: Record<string, string> = {
  LT: 'is before',
  LTE: 'is on or before',
  GT: 'is after',
  GTE: 'is on or after',
};

function valuePlaceholder(operator: string): string {
  if (operator === 'BETWEEN') return 'low, high';
  if (operator === 'IN' || operator === 'NOT_IN') return 'a, b, c';
  if (operator === 'CONTAINS_TOKEN' || operator === 'NOT_CONTAINS_TOKEN') return 'word or *wildcard*';
  return 'Value or {{ expression }}';
}

const LIST_OPS = new Set(['IN', 'NOT_IN']);
const TEXT_OPS = new Set(['CONTAINS_TOKEN', 'NOT_CONTAINS_TOKEN']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

type SearchFilter = CrmSearchSource['filters'][number];

/**
 * The value of one search filter: the property's choices (a select, or checkboxes for "is any of")
 * for dropdown properties, date pickers for date properties, else text with {{ expressions }}.
 * "Type a value" switches to free text (e.g. an expression) at any time.
 */
export function FilterValueInput({
  ext,
  filter,
  index,
  property,
  onChange,
}: {
  ext: Extension;
  filter: SearchFilter;
  index: number;
  property: PortalProperty | undefined;
  onChange: (value: string) => void;
}) {
  const [typed, setTyped] = useState(false);
  const value = typeof filter.value === 'string' ? filter.value : String((filter.value as unknown) ?? '');
  const op = filter.operator;
  const label = `Filter ${index + 1} value`;
  const options = propertyOptions(property);
  const isExpression = value.includes('{{');
  const listOp = LIST_OPS.has(op);
  const selected = listOp ? splitList(value) : [];
  const canChoose = options.length > 0 && !TEXT_OPS.has(op) && (!listOp || selected.every((v) => options.some((o) => o.value === v)));
  const dateParts = op === 'BETWEEN' ? splitList(value) : value.trim() ? [value.trim()] : [];
  const canDate =
    isDateProperty(property) && !listOp && !TEXT_OPS.has(op) && dateParts.every((d) => DATE_RE.test(d.slice(0, 10)) && d.length <= 10);
  const mode: 'choice' | 'date' | 'text' = typed || isExpression ? 'text' : canChoose ? 'choice' : canDate ? 'date' : 'text';
  const switchable = (options.length > 0 && !TEXT_OPS.has(op)) || (isDateProperty(property) && !listOp && !TEXT_OPS.has(op));

  let editor;
  if (mode === 'choice' && listOp) {
    editor = (
      <div className="ub-pp-checks" role="group" aria-label={label}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label key={o.value} className="ub-pp-check">
              <input
                type="checkbox"
                checked={on}
                onChange={() => {
                  const next = on ? selected.filter((v) => v !== o.value) : options.map((x) => x.value).filter((v) => v === o.value || selected.includes(v));
                  onChange(next.join(', '));
                }}
              />
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    );
  } else if (mode === 'choice') {
    const inList = options.some((o) => o.value === value);
    editor = (
      <Select
        aria-label={label}
        value={value}
        placeholder="Choose a value…"
        options={[
          ...options.map((o) => ({ value: o.value, label: o.label || o.value })),
          ...(value && !inList ? [{ value, label: `${value} (not one of this property’s options)` }] : []),
        ]}
        onChange={onChange}
      />
    );
  } else if (mode === 'date' && op === 'BETWEEN') {
    const [low = '', high = ''] = dateParts;
    editor = (
      <div className="ub-pn-grid2" role="group" aria-label={label}>
        <input type="date" className="ub-input" aria-label={`${label} from`} value={low} onChange={(e) => onChange(`${e.target.value}, ${high}`)} />
        <input type="date" className="ub-input" aria-label={`${label} to`} value={high} onChange={(e) => onChange(`${low}, ${e.target.value}`)} />
      </div>
    );
  } else if (mode === 'date') {
    editor = <input type="date" className="ub-input" aria-label={label} value={dateParts[0] ?? ''} onChange={(e) => onChange(e.target.value)} />;
  } else {
    editor = <TemplateInput ext={ext} value={value} placeholder={valuePlaceholder(op)} aria-label={label} onChange={onChange} />;
  }

  return (
    <div className="ub-pn-stack ub-pn-stack--tight">
      {editor}
      {switchable && (
        <button
          type="button"
          className="ub-pn-link ub-pp-switch"
          onClick={() => {
            if (mode === 'text') {
              setTyped(false);
              if (isExpression) onChange('');
            } else setTyped(true);
          }}
        >
          {mode === 'text' ? (options.length > 0 ? 'Choose from the property’s options' : 'Pick a date') : 'Type a value or {{ expression }}'}
        </button>
      )}
    </div>
  );
}

export function CrmSearchEditor({ ext, ds }: { ext: Extension; ds: CrmSearchSource }) {
  const types = useMemo(() => [ds.objectType], [ds.objectType]);
  const catalog = usePortalProperties(types);
  const filters = ds.filters ?? [];
  const sorts = ds.sorts ?? [];
  const setFilters = (next: CrmSearchSource['filters']) => update(ds, { filters: next });
  const setSorts = (next: CrmSearchSource['sorts']) => update(ds, { sorts: next });
  const firstProperty =
    propertiesFor(ds.objectType)[0]?.name ?? catalog.properties.find((p) => !p.hidden && !p.readOnly)?.name ?? 'hs_object_id';
  return (
    <>
      <Field label="Object type">
        <ObjectTypeSelect label="Object type" value={ds.objectType} onChange={(objectType) => update(ds, { objectType })} />
      </Field>
      <Field label="Properties" hint={propertiesHint(catalog, 'Properties to load for each result.')}>
        <PropertyPicker
          multiple
          aria-label="Properties"
          objectTypes={types}
          catalog={catalog}
          value={ds.properties}
          placeholder="Add a property…"
          onChange={(properties) => update(ds, { properties })}
        />
      </Field>
      <Field label="Search text" hint="Optional free-text query across default searchable properties.">
        <TemplateInput
          ext={ext}
          value={ds.query ?? ''}
          placeholder="e.g. {{ searchTerm }}"
          aria-label="Search text"
          onChange={(query) => update(ds, { query })}
        />
      </Field>
      <div className="ub-pn-subhead">
        <span>Filters</span>
        <span className="ub-pn-muted">All must match</span>
      </div>
      {filters.length === 0 && <div className="ub-pn-muted">No filters — every record matches.</div>}
      {filters.map((f, i) => {
        const noValue = f.operator === 'HAS_PROPERTY' || f.operator === 'NOT_HAS_PROPERTY';
        const property = catalog.byName.get(f.propertyName);
        const dates = isDateProperty(property);
        const set = (patch: Partial<SearchFilter>) => setFilters(filters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="ub-pn-filter" role="group" aria-label={`Filter ${i + 1}`}>
            <div className="ub-pn-filter__row">
              <PropertyPicker
                aria-label={`Filter ${i + 1} property`}
                objectTypes={types}
                catalog={catalog}
                value={f.propertyName}
                placeholder="property"
                onChange={(propertyName) => {
                  // Another property: a value picked from the old one's options rarely fits.
                  const old = catalog.byName.get(f.propertyName);
                  const keep = !old || !propertyOptions(old).length || f.value.includes('{{');
                  set({ propertyName, ...(keep ? {} : { value: '' }) });
                }}
              />
              <IconButton label={`Remove filter ${i + 1}`} size="sm" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>
                <X size={13} aria-hidden />
              </IconButton>
            </div>
            <Select
              aria-label={`Filter ${i + 1} operator`}
              value={f.operator}
              options={SEARCH_OPERATORS.map((o) => (dates && DATE_OPERATOR_LABELS[o.value] ? { ...o, label: DATE_OPERATOR_LABELS[o.value] } : o))}
              onChange={(operator) => set({ operator, ...(operator === 'HAS_PROPERTY' || operator === 'NOT_HAS_PROPERTY' ? { value: '' } : {}) })}
            />
            {!noValue && <FilterValueInput ext={ext} filter={f} index={i} property={property} onChange={(value) => set({ value })} />}
          </div>
        );
      })}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={13} aria-hidden />}
          onClick={() => setFilters([...filters, { propertyName: firstProperty, operator: 'EQ', value: '' }])}
        >
          Add filter
        </Button>
      </div>
      <div className="ub-pn-subhead">
        <span>Sort by</span>
      </div>
      {sorts.map((s, i) => (
        <div key={i} className="ub-pn-filter__row" role="group" aria-label={`Sort ${i + 1}`}>
          <PropertyPicker
            aria-label={`Sort ${i + 1} property`}
            objectTypes={types}
            catalog={catalog}
            value={s.propertyName}
            placeholder="property"
            onChange={(propertyName) => setSorts(sorts.map((x, j) => (j === i ? { ...x, propertyName } : x)))}
          />
          <IconButton
            label={s.direction === 'ASCENDING' ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
            size="sm"
            onClick={() =>
              setSorts(sorts.map((x, j) => (j === i ? { ...x, direction: x.direction === 'ASCENDING' ? 'DESCENDING' : 'ASCENDING' } : x)))
            }
          >
            {s.direction === 'ASCENDING' ? <ArrowUp size={13} aria-hidden /> : <ArrowDown size={13} aria-hidden />}
          </IconButton>
          <IconButton label={`Remove sort ${i + 1}`} size="sm" onClick={() => setSorts(sorts.filter((_, j) => j !== i))}>
            <X size={13} aria-hidden />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={13} aria-hidden />}
          onClick={() => setSorts([...sorts, { propertyName: 'createdate', direction: 'DESCENDING' }])}
        >
          Add sort
        </Button>
      </div>
      <PageLength ds={ds} />
      <FormattedSwitch ds={ds} />
    </>
  );
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function FetchEditor({ ext, ds }: { ext: Extension; ds: FetchSource }) {
  const permitted = useEditor((s) => s.project.app.permittedUrls.fetch);
  const origin = staticOrigin(ds.url ?? '');
  const already = origin ? permitted.some((u) => u.replace(/\/+$/, '').toLowerCase() === origin.toLowerCase()) : false;
  const methodId = useId();
  return (
    <>
      <Field label="URL">
        <TemplateInput
          ext={ext}
          value={ds.url}
          placeholder="https://api.example.com/items?id={{ context.crm.objectId }}"
          aria-label="URL"
          onChange={(url) => update(ds, { url })}
        />
      </Field>
      <div className="ub-pn-note">
        {origin ? (
          already ? (
            <>
              <code>{origin}</code> is already a permitted fetch URL.
            </>
          ) : (
            <>
              HubSpot only allows calls to permitted URLs. Export adds <code>{origin}</code> to the app’s permitted fetch URLs
              automatically.
            </>
          )
        ) : ds.url?.trim() ? (
          <>
            The host isn’t fixed text, so add its origin under{' '}
            <button type="button" className="ub-pn-link" onClick={() => useDialogs.getState().open('appSettings', 'urls')}>
              App settings → Permitted URLs
            </button>
            . URLs must use https://.
          </>
        ) : (
          <>Enter an https:// URL. Use {'{{ }}'} to insert values, e.g. the record id.</>
        )}
      </div>
      <div className="ub-pn-grid2">
        <Field label="Method" htmlFor={methodId}>
          <Select
            id={methodId}
            value={ds.method}
            options={METHODS.map((m) => ({ value: m, label: m }))}
            onChange={(method) => update(ds, { method: method as HttpMethod })}
          />
        </Field>
        <div className="ub-pn-switch-cell">
          <Switch checked={ds.runOnMount} onChange={(runOnMount) => update(ds, { runOnMount })} label="Load on open" />
        </div>
      </div>
      {ds.method !== 'GET' && (
        <Field label="Body" hint="Expression producing the JSON body, e.g. { email: record.email }.">
          <ExpressionInput
            ext={ext}
            value={ds.body ?? ''}
            multiline
            placeholder="{ id: context.crm.objectId }"
            aria-label="Request body"
            onChange={(body) => update(ds, { body: body || undefined })}
          />
        </Field>
      )}
      <RequestOptions ext={ext} headers={ds.headers} timeout={ds.timeout} onChange={(patch) => update(ds, patch)} />
      {!ds.runOnMount && <div className="ub-pn-muted">Runs when an action uses “Run data source”. Until then the value is null.</div>}
    </>
  );
}

// ---------------------------------------------------------------------------
// function
// ---------------------------------------------------------------------------

export function FunctionEditor({ ext, ds }: { ext: Extension; ds: FunctionSource }) {
  const functions = useEditor((s) => s.project.functions);
  const fnId = useId();
  const exists = functions.some((f) => f.id === ds.functionId);
  return (
    <>
      <Field
        label="App function"
        htmlFor={fnId}
        error={!exists ? (functions.length ? 'Choose a function' : 'Create a function first') : undefined}
        actions={
          exists ? (
            <IconButton label="Edit function code" size="sm" onClick={() => useDialogs.getState().open('functions', ds.functionId)}>
              <SquarePen size={13} aria-hidden />
            </IconButton>
          ) : undefined
        }
      >
        <div className="ub-pn-row">
          <Select
            id={fnId}
            value={exists ? ds.functionId : ''}
            placeholder={functions.length ? 'Choose a function…' : 'No functions yet'}
            options={functions.map((f) => ({ value: f.id, label: f.uid }))}
            onChange={(functionId) => update(ds, { functionId })}
          />
          <Button
            size="sm"
            icon={<Plus size={13} aria-hidden />}
            onClick={() => {
              const fn = useEditor.getState().addFunction();
              update(ds, { functionId: fn.id });
              useDialogs.getState().open('functions', fn.id);
            }}
          >
            New
          </Button>
        </div>
      </Field>
      <Field label="Parameters" hint="Expression producing the parameters object, read as context.parameters in the function.">
        <ExpressionInput
          ext={ext}
          value={ds.parameters ?? ''}
          multiline
          placeholder="{ recordId: context.crm.objectId }"
          aria-label="Function parameters"
          onChange={(parameters) => update(ds, { parameters: parameters || undefined })}
        />
      </Field>
      {ext.kind === 'card' && (
        <Field label="Record properties to send" hint="Sent as context.propertiesToSend.">
          <PropertyPicker
            multiple
            aria-label="Record properties to send"
            objectTypes={ext.objectTypes}
            value={ds.propertiesToSend ?? []}
            placeholder="Add a property…"
            onChange={(propertiesToSend) => update(ds, { propertiesToSend })}
          />
        </Field>
      )}
      <Switch checked={ds.runOnMount} onChange={(runOnMount) => update(ds, { runOnMount })} label="Run when the card opens" />
      {!ds.runOnMount && <div className="ub-pn-muted">Runs when an action uses “Run data source”. Until then the value is null.</div>}
      <a
        className="ub-pn-link ub-pn-link--icon"
        href="https://developers.hubspot.com/docs/apps/developer-platform/add-features/serverless-functions/overview"
        target="_blank"
        rel="noreferrer"
      >
        App functions docs <ExternalLink size={11} aria-hidden />
      </a>
    </>
  );
}

export function DataSourceEditor({ ext, ds }: { ext: Extension; ds: DataSource }) {
  switch (ds.kind) {
    case 'crmProperties':
      return <CrmPropertiesEditor ext={ext} ds={ds} />;
    case 'associations':
      return <AssociationsEditor ds={ds} />;
    case 'crmSearch':
      return <CrmSearchEditor ext={ext} ds={ds} />;
    case 'fetch':
      return <FetchEditor ext={ext} ds={ds} />;
    case 'function':
      return <FunctionEditor ext={ext} ds={ds} />;
  }
}
