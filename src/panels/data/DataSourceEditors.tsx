/** Kind-specific editors for data sources (CRM properties, associations, search, fetch, function). */
import { useId, useMemo } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Plus, SquarePen, X } from 'lucide-react';
import { staticOrigin } from '../../codegen/requirements';
import { ExpressionInput, TemplateInput } from '../../inspector/controls';
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
import { CRM_OBJECT_TYPES } from '../../registry/constants';
import { useDialogs } from '../../shell/dialogs';
import { Button, Field, IconButton, NumberField, Select, Switch, TextInput } from '../../ui';
import { ChipInput, SuggestInput, type Suggestion } from '../common';
import { objectTypeKey, propertiesFor, propertySuggestions } from '../crmProperties';

const CUSTOM = '__custom__';

function toSuggestions(objectTypes: Array<string | undefined>): Suggestion[] {
  return propertySuggestions(objectTypes).map((p) => ({ value: p.name, detail: p.label }));
}

function propertyName(value: string): string | null {
  return /^[A-Za-z0-9_]+$/.test(value) ? null : 'Use the internal property name (letters, numbers and _)';
}

function update(ds: DataSource, patch: Partial<DataSource>) {
  useEditor.getState().updateDataSource(ds.id, patch);
}

// ---------------------------------------------------------------------------
// Object type select (standard types by id + custom)
// ---------------------------------------------------------------------------

export function ObjectTypeSelect({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const known = CRM_OBJECT_TYPES.find((t) => t.typeId === value || t.value === objectTypeKey(value));
  const selectValue = known ? known.typeId : CUSTOM;
  const customId = useId();
  return (
    <div className="ub-pn-stack">
      <Select
        aria-label={label}
        value={selectValue}
        options={[
          ...CRM_OBJECT_TYPES.map((t) => ({ value: t.typeId, label: `${t.label} (${t.typeId})` })),
          { value: CUSTOM, label: 'Custom object…' },
        ]}
        onChange={(v) => onChange(v === CUSTOM ? (known ? '' : value) : v)}
      />
      {selectValue === CUSTOM && (
        <Field htmlFor={customId} hint="Custom object type id (e.g. 2-1234567) or fully qualified name (p_my_object).">
          <TextInput id={customId} code value={value} placeholder="2-1234567" onChange={onChange} />
        </Field>
      )}
    </div>
  );
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
  const suggestions = useMemo(() => toSuggestions(objectTypes.length ? objectTypes : ['contacts']), [objectTypes]);
  return (
    <>
      <Field
        label="Properties"
        hint={
          objectTypes.length
            ? `Suggestions for ${objectTypes.join(', ')} records. Type any internal property name.`
            : 'Type internal property names, e.g. firstname.'
        }
      >
        <ChipInput
          aria-label="Properties"
          values={ds.properties}
          suggestions={suggestions}
          placeholder="Add a property…"
          validate={propertyName}
          describe={(v) => suggestions.find((s) => s.value === v)?.detail}
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
  const suggestions = useMemo(() => toSuggestions([ds.toObjectType]), [ds.toObjectType]);
  return (
    <>
      <Field label="Associated object type">
        <ObjectTypeSelect
          label="Associated object type"
          value={ds.toObjectType}
          onChange={(toObjectType) => update(ds, { toObjectType })}
        />
      </Field>
      <Field label="Properties" hint="Properties to load for each associated record.">
        <ChipInput
          aria-label="Properties"
          values={ds.properties}
          suggestions={suggestions}
          placeholder="Add a property…"
          validate={propertyName}
          describe={(v) => suggestions.find((s) => s.value === v)?.detail}
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

function valuePlaceholder(operator: string): string {
  if (operator === 'BETWEEN') return 'low, high';
  if (operator === 'IN' || operator === 'NOT_IN') return 'a, b, c';
  if (operator === 'CONTAINS_TOKEN' || operator === 'NOT_CONTAINS_TOKEN') return 'word or *wildcard*';
  return 'Value or {{ expression }}';
}

export function CrmSearchEditor({ ext, ds }: { ext: Extension; ds: CrmSearchSource }) {
  const suggestions = useMemo(() => toSuggestions([ds.objectType]), [ds.objectType]);
  const filters = ds.filters ?? [];
  const sorts = ds.sorts ?? [];
  const setFilters = (next: CrmSearchSource['filters']) => update(ds, { filters: next });
  const setSorts = (next: CrmSearchSource['sorts']) => update(ds, { sorts: next });
  const firstProperty = propertiesFor(ds.objectType)[0]?.name ?? 'hs_object_id';
  return (
    <>
      <Field label="Object type">
        <ObjectTypeSelect label="Object type" value={ds.objectType} onChange={(objectType) => update(ds, { objectType })} />
      </Field>
      <Field label="Properties" hint="Properties to load for each result.">
        <ChipInput
          aria-label="Properties"
          values={ds.properties}
          suggestions={suggestions}
          placeholder="Add a property…"
          validate={propertyName}
          describe={(v) => suggestions.find((s) => s.value === v)?.detail}
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
        const set = (patch: Partial<CrmSearchSource['filters'][number]>) =>
          setFilters(filters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="ub-pn-filter" role="group" aria-label={`Filter ${i + 1}`}>
            <div className="ub-pn-filter__row">
              <SuggestInput
                aria-label={`Filter ${i + 1} property`}
                value={f.propertyName}
                suggestions={suggestions}
                placeholder="property"
                onChange={(propertyName) => set({ propertyName })}
              />
              <IconButton label={`Remove filter ${i + 1}`} size="sm" onClick={() => setFilters(filters.filter((_, j) => j !== i))}>
                <X size={13} aria-hidden />
              </IconButton>
            </div>
            <Select
              aria-label={`Filter ${i + 1} operator`}
              value={f.operator}
              options={SEARCH_OPERATORS}
              onChange={(operator) => set({ operator, ...(operator === 'HAS_PROPERTY' || operator === 'NOT_HAS_PROPERTY' ? { value: '' } : {}) })}
            />
            {!noValue && (
              <TemplateInput
                ext={ext}
                value={f.value}
                placeholder={valuePlaceholder(f.operator)}
                aria-label={`Filter ${i + 1} value`}
                onChange={(value) => set({ value })}
              />
            )}
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
          <SuggestInput
            aria-label={`Sort ${i + 1} property`}
            value={s.propertyName}
            suggestions={suggestions}
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
  const suggestions = useMemo(() => toSuggestions(ext.kind === 'card' ? ext.objectTypes : []), [ext.kind, ext.objectTypes]);
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
          <ChipInput
            aria-label="Record properties to send"
            values={ds.propertiesToSend ?? []}
            suggestions={suggestions}
            placeholder="Add a property…"
            validate={propertyName}
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
