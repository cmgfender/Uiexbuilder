/**
 * Inspector editors that use the connected HubSpot account (via the shared pickers in
 * src/panels): CRM property lists and property names of CRM components, CRM object type ids,
 * "Import from HubSpot property…" for option lists, "Use stages from pipeline…" for step lists and
 * "Add a statistic" for CrmStatistics. Every editor still works without an account (built-in
 * suggestions, typing).
 */
import { useId, useMemo, useState } from 'react';
import { Plus, Workflow } from 'lucide-react';
import type { Extension, JsonValue, NodeId } from '../model/types';
import { ObjectTypeSelect } from '../panels/ObjectTypeSelect';
import {
  hasChoices,
  isDateProperty,
  isNumberProperty,
  pipelineStages,
  propertyOptions,
  useIsConnected,
  usePortalPipelines,
  usePortalProperties,
  type PortalProperty,
} from '../panels/portal';
import { PropertyPicker } from '../panels/PropertyPicker';
import { getComponent } from '../registry';
import type { PropDef } from '../registry/types';
import { Button, Field, Select, TextInput } from '../ui';
import { crmFieldObjectTypes, type CrmPropertyField } from './crmFields';

const acceptDates = (p: PortalProperty) => isDateProperty(p);
const acceptNumbers = (p: PortalProperty) => isNumberProperty(p);

/** Object types for a node's CRM property fields (its objectTypeId, else the card's types). */
export function useNodeObjectTypes(ext: Extension, nodeId: NodeId | null): string[] {
  const raw = nodeId ? ext.nodes[nodeId]?.props?.objectTypeId : undefined;
  const own = typeof raw === 'string' ? raw : '';
  const kind = ext.kind;
  const typesKey = ext.objectTypes.join(',');
  // Keyed on primitives: props / objectTypes are new objects after every edit.
  return useMemo(
    () => crmFieldObjectTypes({ props: own ? { objectTypeId: own } : {} }, { kind, objectTypes: typesKey ? typesKey.split(',') : [] }),
    [own, kind, typesKey],
  );
}

/** A CRM component's list of property names (chips with the account's properties). */
export function CrmPropertyListEditor({
  id,
  def,
  value,
  onChange,
  ext,
  nodeId,
  field,
}: {
  id: string;
  def: PropDef;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  ext: Extension;
  nodeId: NodeId | null;
  field: CrmPropertyField;
}) {
  const objectTypes = useNodeObjectTypes(ext, nodeId);
  const list = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return (
    <PropertyPicker
      multiple
      id={id}
      aria-label={def.label}
      objectTypes={objectTypes}
      value={list}
      max={field.max}
      accept={field.accept === 'date' ? acceptDates : field.accept === 'number' ? acceptNumbers : undefined}
      placeholder="Add a property…"
      onChange={(next) => onChange(next.length ? next : undefined)}
    />
  );
}

/** A CRM component's single property name (e.g. CrmSimpleDeadline's date properties). */
export function CrmPropertyNameEditor({
  id,
  def,
  value,
  onChange,
  ext,
  nodeId,
  field,
  required,
}: {
  id: string;
  def: PropDef;
  value: string;
  onChange: (value: JsonValue | undefined) => void;
  ext: Extension;
  nodeId: NodeId | null;
  field: CrmPropertyField;
  required: boolean;
}) {
  const objectTypes = useNodeObjectTypes(ext, nodeId);
  const placeholder = def.type.kind === 'string' ? def.type.placeholder : undefined;
  return (
    <PropertyPicker
      id={id}
      aria-label={def.label}
      objectTypes={objectTypes}
      value={value}
      placeholder={placeholder ?? 'property'}
      accept={field.accept === 'date' ? acceptDates : field.accept === 'number' ? acceptNumbers : undefined}
      onChange={(next) => onChange(next === '' && !required ? undefined : next)}
    />
  );
}

/** A CRM component's object type id: standard objects + the account's custom objects. */
export function CrmObjectTypeEditor({
  id,
  def,
  value,
  onChange,
  required,
}: {
  id: string;
  def: PropDef;
  value: string;
  onChange: (value: JsonValue | undefined) => void;
  required: boolean;
}) {
  return (
    <ObjectTypeSelect
      id={id}
      label={def.label}
      value={value}
      emptyLabel={required ? 'Choose an object…' : 'Not set — the current record'}
      onChange={(v) => onChange(v === '' && !required ? undefined : v)}
    />
  );
}

// ---------------------------------------------------------------------------
// Import options from a HubSpot property
// ---------------------------------------------------------------------------

export interface ImportedOption {
  label: string;
  value: string;
  description?: string;
}

/** The option list a property's choices become (hidden choices skipped, HubSpot's order). */
export function optionsFromProperty(p: PortalProperty | undefined, withDescriptions: boolean): ImportedOption[] {
  return propertyOptions(p).map((o) => ({
    label: o.label || o.value,
    value: o.value,
    ...(withDescriptions && o.description ? { description: o.description } : {}),
  }));
}

export function ImportOptionsPanel({
  objectTypes,
  withDescriptions,
  currentCount,
  onApply,
  onCancel,
}: {
  objectTypes: string[];
  withDescriptions: boolean;
  currentCount: number;
  onApply: (options: ImportedOption[], property: PortalProperty) => void;
  onCancel: () => void;
}) {
  const [objectType, setObjectType] = useState(objectTypes[0] ?? '0-1');
  const [name, setName] = useState('');
  const types = useMemo(() => [objectType], [objectType]);
  const catalog = usePortalProperties(types);
  const objectId = useId();
  const propertyId = useId();
  const property = catalog.byName.get(name);
  const options = optionsFromProperty(property, withDescriptions);
  const preview = options.slice(0, 6).map((o) => o.label);
  return (
    <div className="ub-pp-import" role="group" aria-label="Import options from a HubSpot property">
      <div className="ub-pp-import__title">Import options from a HubSpot property</div>
      <Field label="Object" htmlFor={objectId}>
        <ObjectTypeSelect id={objectId} label="Import from object" value={objectType} onChange={(v) => v && setObjectType(v)} />
      </Field>
      <Field label="Dropdown property" htmlFor={propertyId} hint="Properties with choices (dropdowns, radio buttons, checkboxes).">
        <PropertyPicker
          id={propertyId}
          aria-label="Property to import options from"
          objectTypes={types}
          catalog={catalog}
          accept={hasChoices}
          value={name}
          placeholder="Search properties…"
          onChange={setName}
        />
      </Field>
      {name && property && options.length > 0 && (
        <div className="ub-pp-import__preview" role="status">
          {options.length} option{options.length === 1 ? '' : 's'}: {preview.join(', ')}
          {options.length > preview.length ? ', …' : ''}
        </div>
      )}
      {name && (!property || options.length === 0) && !catalog.loading && (
        <div className="ub-field__hint ub-insp-warn" role="status">
          {property ? 'This property has no choices to import.' : 'Pick a property from the list.'}
        </div>
      )}
      <div className="ub-pp-import__actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!property || options.length === 0}
          onClick={() => property && onApply(options, property)}
        >
          {currentCount > 0 ? `Replace ${currentCount} option${currentCount === 1 ? '' : 's'}` : 'Add these options'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline stages → step names
// ---------------------------------------------------------------------------

export function PipelineStagesPanel({ onApply, onCancel }: { onApply: (labels: string[]) => void; onCancel: () => void }) {
  const [objectType, setObjectType] = useState('0-3');
  const [pipelineId, setPipelineId] = useState('');
  const { pipelines, loading, error } = usePortalPipelines(objectType);
  const objectId = useId();
  const pipelineSelectId = useId();
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  const stages = pipelineStages(pipeline);
  return (
    <div className="ub-pp-import" role="group" aria-label="Use stages from a pipeline">
      <div className="ub-pp-import__title">Use stages from a pipeline</div>
      <Field label="Object" htmlFor={objectId}>
        <ObjectTypeSelect
          id={objectId}
          label="Pipeline object"
          value={objectType}
          onChange={(v) => {
            if (!v) return;
            setObjectType(v);
            setPipelineId('');
          }}
        />
      </Field>
      {loading ? (
        <div className="ub-field__hint" role="status">
          Loading pipelines…
        </div>
      ) : error ? (
        <div className="ub-field__hint ub-insp-warn" role="status">
          {error}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="ub-field__hint" role="status">
          This object has no pipelines. Deals, tickets and some custom objects do.
        </div>
      ) : (
        <Field label="Pipeline" htmlFor={pipelineSelectId}>
          <Select
            id={pipelineSelectId}
            value={pipeline?.id ?? ''}
            options={pipelines.map((p) => ({ value: p.id, label: p.label }))}
            onChange={setPipelineId}
          />
        </Field>
      )}
      {stages.length > 0 && (
        <ol className="ub-pp-import__preview" aria-label="Stages">
          {stages.map((s) => (
            <li key={s.id}>{s.label}</li>
          ))}
        </ol>
      )}
      <div className="ub-pp-import__actions">
        <Button size="sm" variant="primary" disabled={stages.length === 0} onClick={() => onApply(stages.map((s) => s.label))}>
          Use {stages.length || ''} stage{stages.length === 1 ? '' : 's'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PipelineStagesButton({ onApply }: { onApply: (labels: string[]) => void }) {
  const connected = useIsConnected();
  const [open, setOpen] = useState(false);
  if (!connected) return null;
  if (open) {
    return (
      <PipelineStagesPanel
        onCancel={() => setOpen(false)}
        onApply={(labels) => {
          onApply(labels);
          setOpen(false);
        }}
      />
    );
  }
  return (
    <Button size="sm" variant="ghost" icon={<Workflow size={13} aria-hidden />} onClick={() => setOpen(true)} title="Fill the steps with a pipeline's stages from your HubSpot account">
      Use stages from pipeline…
    </Button>
  );
}

// ---------------------------------------------------------------------------
// CrmStatistics: add a statistic with a property picker
// ---------------------------------------------------------------------------

const STATISTIC_TYPES = [
  { value: 'SUM', label: 'Sum' },
  { value: 'AVG', label: 'Average' },
  { value: 'MIN', label: 'Minimum' },
  { value: 'MAX', label: 'Maximum' },
  { value: 'COUNT', label: 'Count of records' },
  { value: 'DISTINCT_APPROX', label: 'Count of distinct values' },
];

/** Whether a component's JSON prop is CrmStatistics' `statistics`. */
export function isStatisticsProp(nodeType: string | undefined, prop: PropDef): boolean {
  return nodeType === 'CrmStatistics' && prop.name === 'statistics' && getComponent(nodeType)?.importFrom === '@hubspot/ui-extensions/crm';
}

/** "Add a statistic": label, calculation and property → appended to the statistics array. */
export function AddStatisticPanel({
  ext,
  nodeId,
  value,
  onChange,
}: {
  ext: Extension;
  nodeId: NodeId | null;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
}) {
  const objectTypes = useNodeObjectTypes(ext, nodeId);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('SUM');
  const [property, setProperty] = useState('');
  const [label, setLabel] = useState('');
  const ids = { type: useId(), property: useId(), label: useId() };
  const numeric = type === 'SUM' || type === 'AVG' || type === 'MIN' || type === 'MAX';
  const list = Array.isArray(value) ? value : [];
  if (!open) {
    return (
      <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden />} onClick={() => setOpen(true)}>
        Add a statistic
      </Button>
    );
  }
  const typeLabel = STATISTIC_TYPES.find((t) => t.value === type)?.label ?? type;
  const add = () => {
    const name = property.trim() || 'hs_object_id';
    const item: Record<string, JsonValue> = { label: label.trim() || `${typeLabel} of ${name}`, statisticType: type, propertyName: name };
    onChange([...list, item]);
    setOpen(false);
    setProperty('');
    setLabel('');
  };
  return (
    <div className="ub-pp-import" role="group" aria-label="Add a statistic">
      <div className="ub-pp-import__title">Add a statistic</div>
      <Field label="Calculation" htmlFor={ids.type}>
        <Select id={ids.type} value={type} options={STATISTIC_TYPES} onChange={setType} />
      </Field>
      <Field label="Property" htmlFor={ids.property} hint={numeric ? 'A number property, e.g. amount.' : undefined}>
        <PropertyPicker
          id={ids.property}
          aria-label="Statistic property"
          objectTypes={objectTypes}
          accept={numeric ? acceptNumbers : undefined}
          value={property}
          placeholder={numeric ? 'amount' : 'hs_object_id'}
          onChange={setProperty}
        />
      </Field>
      <Field label="Label" htmlFor={ids.label}>
        <TextInput id={ids.label} value={label} placeholder={`${typeLabel} of ${property || '…'}`} onChange={setLabel} />
      </Field>
      <div className="ub-pp-import__actions">
        <Button size="sm" variant="primary" onClick={add}>
          Add statistic
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
