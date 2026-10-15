/**
 * Portal-aware CRM metadata for the pickers of the Data panel and the inspector.
 *
 * When a HubSpot account is connected (src/connect), property / object type / pipeline pickers use
 * the account's real schema: custom properties, labels, groups and dropdown options. Otherwise
 * (no connector, signed out, still loading, or the request failed) they fall back to the built-in
 * catalog of common properties (./crmProperties) so the builder stays fully usable offline.
 *
 * Pure helpers are exported for tests and for non-hook callers (e.g. "Generate UI").
 */
import { useMemo } from 'react';
import {
  findObjectTypeInfo,
  getConnectorClient,
  sameObjectType,
  useConnection,
  useLiveData,
  useObjectTypes,
  usePipelines,
  usePropertyCatalog,
  type CrmObjectTypeInfo,
  type CrmPipeline,
  type CrmPropertyDef,
  type CrmPropertyOption,
  type CrmRecordSummary,
  type PropertyCatalog,
} from '../connect';
import type { Extension } from '../model/types';
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { humanizeProperty, objectTypeKey, propertiesFor, type CrmPropertyInfo } from './crmProperties';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortalProperty {
  /** Internal name, e.g. `firstname`. */
  name: string;
  /** Label shown in HubSpot, e.g. `First name`. */
  label: string;
  /** HubSpot property type: string | number | date | datetime | enumeration | bool | phone_number … */
  type: string;
  fieldType?: string;
  /** Readable property group, e.g. `Contact information`. */
  group: string;
  description?: string;
  /** Dropdown / radio / checkbox choices (enumeration and bool properties). */
  options?: CrmPropertyOption[];
  /** Created in the account (not defined by HubSpot). */
  custom: boolean;
  hidden?: boolean;
  /** Calculated / system properties that can't be edited. */
  readOnly?: boolean;
  /** Object type the property belongs to (as given to the picker). */
  objectType: string;
  /** Where the definition came from. */
  source: 'portal' | 'builtin';
}

export interface PortalProperties {
  /** A HubSpot account is connected. */
  connected: boolean;
  /** At least one object type's properties came from the connected account. */
  fromPortal: boolean;
  loading: boolean;
  /** Plain-language problem loading the account's properties (suggestions fall back to built-ins). */
  error: string | null;
  /** De-duplicated by name (the first object type wins), in catalog order. */
  properties: PortalProperty[];
  byName: Map<string, PortalProperty>;
  /**
   * Names can be checked against the account: connected and every object type's properties
   * loaded. Only then is an unknown name reported as "Not found in your portal".
   */
  canVerify: boolean;
  /** The object types the suggestions cover (trimmed, unique, at most MAX_PICKER_OBJECT_TYPES). */
  objectTypes: string[];
}

/** Object types one picker merges (cards may list several; hooks need a fixed count). */
export const MAX_PICKER_OBJECT_TYPES = 4;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  contactinformation: 'Contact information',
  companyinformation: 'Company information',
  dealinformation: 'Deal information',
  ticketinformation: 'Ticket information',
  lineiteminformation: 'Line item information',
  productinformation: 'Product information',
  quoteinformation: 'Quote information',
  emailinformation: 'Email information',
  analyticsinformation: 'Web analytics history',
  conversioninformation: 'Conversion information',
  socialmediainformation: 'Social media information',
  social_media_information: 'Social media information',
  sales_properties: 'Sales properties',
  deal_activity: 'Deal activity',
  dealstages: 'Deal stages',
  facebook_ads_properties: 'Facebook Ads properties',
  salesforceinformation: 'Salesforce information',
};

/** Readable label of a HubSpot property group name (`contactinformation` → `Contact information`). */
export function groupLabel(groupName: string | undefined | null): string {
  const raw = (groupName ?? '').trim();
  if (!raw) return 'Other properties';
  const known = GROUP_LABELS[raw.toLowerCase()];
  if (known) return known;
  const spaced = raw.replace(/([a-z])information$/i, '$1 information').replace(/([a-z])properties$/i, '$1 properties');
  return humanizeProperty(spaced);
}

/** Built-in group per object type (the built-in catalog has no groups). */
function builtinGroup(objectType: string): string {
  const key = objectTypeKey(objectType);
  const std = CRM_OBJECT_TYPES.find((t) => t.value === key);
  if (!std) return 'Common properties';
  const singular = std.label.endsWith('ies') ? `${std.label.slice(0, -3)}y` : std.label.replace(/s$/, '');
  return `${singular} information`;
}

const BOOL_OPTIONS: CrmPropertyOption[] = [
  { label: 'Yes', value: 'true', displayOrder: 0 },
  { label: 'No', value: 'false', displayOrder: 1 },
];

export function fromPortalDef(def: CrmPropertyDef, objectType: string): PortalProperty {
  const options = Array.isArray(def.options) ? def.options.filter((o) => o && typeof o.value === 'string') : undefined;
  return {
    name: def.name,
    label: typeof def.label === 'string' && def.label.trim() ? def.label : humanizeProperty(def.name),
    type: typeof def.type === 'string' ? def.type : 'string',
    fieldType: def.fieldType,
    group: groupLabel(def.groupName),
    description: def.description || undefined,
    options: options && options.length ? options : undefined,
    custom: def.hubspotDefined === false,
    hidden: def.hidden || undefined,
    readOnly: def.readOnlyValue || def.calculated || undefined,
    objectType,
    source: 'portal',
  };
}

export function fromBuiltin(info: CrmPropertyInfo, objectType: string): PortalProperty {
  return {
    name: info.name,
    label: info.label,
    type: info.type,
    group: builtinGroup(objectType),
    custom: false,
    objectType,
    source: 'builtin',
  };
}

/** Trimmed, unique object types (first MAX_PICKER_OBJECT_TYPES). */
export function normalizeObjectTypes(objectTypes: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of objectTypes) {
    if (typeof t !== 'string') continue;
    const v = t.trim();
    if (!v || v.includes('{{')) continue;
    const key = objectTypeKey(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_PICKER_OBJECT_TYPES) break;
  }
  return out;
}

/** One object type's slice of the merged result. */
export interface CatalogSlice {
  objectType: string;
  /** The account's catalog for the type (null when not connected). */
  catalog: Pick<PropertyCatalog, 'connected' | 'loading' | 'error' | 'properties'> | null;
}

/**
 * Merges each object type's properties: the account's when loaded, else the built-in common
 * properties. Pure (the hook below feeds it).
 */
export function mergeProperties(slices: CatalogSlice[]): PortalProperties {
  const properties: PortalProperty[] = [];
  const byName = new Map<string, PortalProperty>();
  let connected = false;
  let fromPortal = false;
  let loading = false;
  let error: string | null = null;
  let verified = slices.length > 0;
  for (const { objectType, catalog } of slices) {
    if (catalog?.connected) connected = true;
    const usable = !!catalog?.connected && !catalog.loading && !catalog.error && catalog.properties.length > 0;
    if (catalog?.connected && catalog.loading) loading = true;
    if (catalog?.connected && catalog.error && !error) error = catalog.error;
    if (!usable) verified = false;
    const list = usable ? catalog!.properties.map((d) => fromPortalDef(d, objectType)) : propertiesFor(objectType).map((i) => fromBuiltin(i, objectType));
    if (usable) fromPortal = true;
    for (const p of list) {
      if (byName.has(p.name)) continue;
      byName.set(p.name, p);
      properties.push(p);
    }
  }
  return {
    connected,
    fromPortal,
    loading,
    error,
    properties,
    byName,
    canVerify: connected && verified,
    objectTypes: slices.map((s) => s.objectType),
  };
}

const TYPE_LABELS: Record<string, string> = {
  string: 'Text',
  number: 'Number',
  date: 'Date',
  datetime: 'Date and time',
  enumeration: 'Choice',
  bool: 'Yes / no',
  phone_number: 'Phone number',
  object_coordinates: 'Object reference',
  json: 'JSON',
};

/** Plain-language type of a property ("Choice", "Date", "Number" …). */
export function propertyTypeLabel(p: Pick<PortalProperty, 'type' | 'fieldType'>): string {
  if (p.type === 'enumeration' && p.fieldType === 'checkbox') return 'Multiple choice';
  if (p.type === 'string' && p.fieldType === 'textarea') return 'Long text';
  return TYPE_LABELS[p.type] ?? humanizeProperty(p.type || 'string');
}

export function isDateProperty(p: Pick<PortalProperty, 'type'> | undefined | null): boolean {
  return !!p && (p.type === 'date' || p.type === 'datetime');
}

export function isNumberProperty(p: Pick<PortalProperty, 'type'> | undefined | null): boolean {
  return !!p && p.type === 'number';
}

/** Visible choices of an enumeration / bool property (sorted by HubSpot's display order). */
export function propertyOptions(p: Pick<PortalProperty, 'type' | 'options'> | undefined | null): CrmPropertyOption[] {
  if (!p) return [];
  const list = (p.options ?? []).filter((o) => !o.hidden && typeof o.value === 'string');
  if (list.length === 0 && p.type === 'bool') return BOOL_OPTIONS;
  return [...list].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

/** Properties whose choices can be listed (enumeration with options, or yes / no). */
export function hasChoices(p: Pick<PortalProperty, 'type' | 'options'> | undefined | null): boolean {
  return propertyOptions(p).length > 0;
}

/**
 * Properties matching a search over label and internal name, best first: exact name / label,
 * then prefix, word start, then substring. An empty query keeps the catalog order.
 */
export function searchProperties(list: readonly PortalProperty[], query: string): PortalProperty[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  const scored: Array<{ p: PortalProperty; score: number; i: number }> = [];
  list.forEach((p, i) => {
    const name = p.name.toLowerCase();
    const label = p.label.toLowerCase();
    let score = -1;
    if (name === q || label === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (label.startsWith(q)) score = 75;
    else if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) score = 60;
    else if (name.split('_').some((w) => w.startsWith(q))) score = 55;
    else if (name.includes(q)) score = 40;
    else if (label.includes(q)) score = 35;
    else if (q.length >= 3 && name.replace(/_/g, '').includes(q.replace(/[_\s]/g, ''))) score = 20;
    if (score < 0) return;
    // Custom properties are what admins built themselves: show them first among equals.
    if (p.custom) score += 2;
    if (p.hidden) score -= 10;
    scored.push({ p, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.p);
}

export interface PropertyGroup {
  group: string;
  items: PortalProperty[];
}

/**
 * Groups properties by property group for the picker list: custom properties first within each
 * group, groups in the order they first appear (portal catalogs come sorted by group).
 */
export function groupProperties(list: readonly PortalProperty[]): PropertyGroup[] {
  const groups = new Map<string, PortalProperty[]>();
  for (const p of list) {
    const items = groups.get(p.group);
    if (items) items.push(p);
    else groups.set(p.group, [p]);
  }
  return [...groups.entries()].map(([group, items]) => ({
    group,
    items: [...items.filter((p) => p.custom), ...items.filter((p) => !p.custom)],
  }));
}

/** Edit distance (optimal string alignment) capped at `max` + 1. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The account property a name that isn't in the account was probably meant to be: a different
 * capitalisation, a label typed instead of the internal name, or a small typo. Null when unsure.
 */
export function closestProperty(name: string, list: readonly PortalProperty[]): PortalProperty | null {
  const typed = name.trim();
  if (!typed || list.length === 0) return null;
  const lower = typed.toLowerCase();
  const sameCase = list.find((p) => p.name.toLowerCase() === lower);
  if (sameCase) return sameCase;
  const byLabel = list.filter((p) => p.label.toLowerCase() === lower);
  if (byLabel.length === 1) return byLabel[0];
  if (lower.length < 4) return null;
  const max = lower.length >= 8 ? 2 : 1;
  let best: PortalProperty | null = null;
  let bestDistance = max + 1;
  let ties = 0;
  for (const p of list) {
    const d = distance(lower, p.name.toLowerCase(), max);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
      ties = 0;
    } else if (d === bestDistance && best) ties++;
  }
  return best && ties === 0 ? best : null;
}

/** Label of a property from a merged catalog, or the humanised name. */
export function labelFrom(props: Pick<PortalProperties, 'byName'>, name: string): string {
  return props.byName.get(name)?.label ?? humanizeProperty(name);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Properties for up to MAX_PICKER_OBJECT_TYPES object types: the connected account's catalog
 * (cached and shared between pickers), else the built-in suggestions.
 */
export function usePortalProperties(objectTypes: ReadonlyArray<string | null | undefined>): PortalProperties {
  const key = normalizeObjectTypes(objectTypes).join('\n');
  const types = useMemo(() => (key ? key.split('\n') : []), [key]);
  // A fixed number of hook calls (unused slots ask for nothing).
  const c0 = usePropertyCatalog(types[0] ?? null);
  const c1 = usePropertyCatalog(types[1] ?? null);
  const c2 = usePropertyCatalog(types[2] ?? null);
  const c3 = usePropertyCatalog(types[3] ?? null);
  return useMemo(() => {
    const catalogs = [c0, c1, c2, c3];
    return mergeProperties(types.map((objectType, i) => ({ objectType, catalog: catalogs[i] ?? null })));
  }, [types, c0, c1, c2, c3]);
}

export interface ObjectTypeOption {
  /** Object type id, e.g. `0-1` or `2-1234567`. */
  id: string;
  /** Name used in card object types and API paths, e.g. `contacts` or `p_projects`. */
  name: string;
  /** Plural label, e.g. `Contacts`, `Projects`. */
  label: string;
  custom: boolean;
}

/** Standard object types plus the connected account's custom objects (label + id + name). */
export function objectTypeOptions(portal: readonly CrmObjectTypeInfo[]): ObjectTypeOption[] {
  const out: ObjectTypeOption[] = CRM_OBJECT_TYPES.map((t) => ({ id: t.typeId, name: t.value, label: t.label, custom: false }));
  const seen = new Set(out.map((o) => o.id));
  const custom = portal
    .filter((t) => t && t.custom && typeof t.objectTypeId === 'string' && !seen.has(t.objectTypeId))
    .map((t) => ({ id: t.objectTypeId, name: t.objectType, label: t.pluralLabel || t.label || t.objectType, custom: true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...out, ...custom];
}

/** Finds an option by id or name (any spelling of a standard type). */
export function findObjectTypeOption(options: readonly ObjectTypeOption[], value: string | null | undefined): ObjectTypeOption | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const direct = options.find((o) => o.id.toLowerCase() === lower || o.name.toLowerCase() === lower);
  if (direct) return direct;
  const key = objectTypeKey(raw);
  return options.find((o) => o.name === key);
}

export function usePortalObjectTypes(): { connected: boolean; loading: boolean; error: string | null; options: ObjectTypeOption[]; customCount: number } {
  const r = useObjectTypes();
  return useMemo(() => {
    const options = objectTypeOptions(r.connected ? r.objectTypes : []);
    return { connected: r.connected, loading: r.loading, error: r.error, options, customCount: options.filter((o) => o.custom).length };
  }, [r.connected, r.loading, r.error, r.objectTypes]);
}

/** Pipelines of an object type in the connected account (empty when not connected). */
export function usePortalPipelines(objectType: string | null | undefined): { connected: boolean; loading: boolean; error: string | null; pipelines: CrmPipeline[] } {
  return usePipelines(objectType);
}

/** True while a HubSpot account is connected. */
export function useIsConnected(): boolean {
  return useConnection((s) => s.status === 'connected' && s.info.connected);
}

/** Stages of a pipeline in display order. */
export function pipelineStages(pipeline: CrmPipeline | undefined | null): CrmPipeline['stages'] {
  if (!pipeline || !Array.isArray(pipeline.stages)) return [];
  return [...pipeline.stages].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

/**
 * Account labels for property names already loaded by a picker (no request): used by "Generate
 * UI" so table headers and list labels read like HubSpot. Undefined when not connected / unknown.
 */
export function cachedPropertyLabel(name: string, objectTypes: ReadonlyArray<string | null | undefined>): string | undefined {
  const s = useConnection.getState();
  if (s.status !== 'connected' || !s.info.connected) return undefined;
  const client = getConnectorClient();
  for (const t of normalizeObjectTypes(objectTypes)) {
    let list: CrmPropertyDef[] | undefined;
    try {
      list = client.peek<CrmPropertyDef[]>('properties', t);
    } catch {
      list = undefined;
    }
    const hit = Array.isArray(list) ? list.find((p) => p && p.name === name) : undefined;
    if (hit && typeof hit.label === 'string' && hit.label.trim()) return hit.label;
  }
  return undefined;
}

/** Plural label of an object type from the connected account's cached list (custom objects). */
export function cachedObjectTypeLabel(objectType: string): string | undefined {
  const s = useConnection.getState();
  if (s.status !== 'connected' || !s.info.connected) return undefined;
  let known: CrmObjectTypeInfo[] | undefined;
  try {
    known = getConnectorClient().peek<CrmObjectTypeInfo[]>('objectTypes');
  } catch {
    known = undefined;
  }
  const info = Array.isArray(known) ? findObjectTypeInfo(objectType, known) : undefined;
  return info ? info.pluralLabel || info.label : undefined;
}

/** Label lookups for "Generate UI": the connected account's labels where they are loaded. */
export const PORTAL_LABELS = {
  propertyLabel: (name: string, objectTypes: string[]) => cachedPropertyLabel(name, objectTypes),
  objectTypeLabel: (objectType: string) => cachedObjectTypeLabel(objectType),
};

/** The connector client can read single records (feature check: older builds may lack it). */
export function canReadRecords(): boolean {
  try {
    return typeof getConnectorClient === 'function' && typeof getConnectorClient().getRecord === 'function';
  } catch {
    return false;
  }
}

/**
 * The sample record picked for a card's real-data preview, when it belongs to the connected
 * account and fits the card's object types (null otherwise). `available` is false when records
 * can't be read here at all.
 */
export function useSampleRecordForMock(ext: Pick<Extension, 'id' | 'kind' | 'objectTypes'>): {
  connected: boolean;
  available: boolean;
  record: CrmRecordSummary | null;
} {
  const connected = useIsConnected();
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const picked = useLiveData((s) => s.recordByExtension[ext.id] ?? null);
  const pickedPortal = useLiveData((s) => s.portalByExtension[ext.id]);
  const typesKey = ext.objectTypes.join(',');
  const record = useMemo(() => {
    if (!connected || ext.kind !== 'card' || !picked || portalId === null || pickedPortal !== portalId) return null;
    if (!/^\d{1,20}$/.test(picked.id)) return null;
    const types = typesKey ? typesKey.split(',') : [];
    if (types.length === 0) return picked;
    let known: CrmObjectTypeInfo[] | undefined;
    try {
      known = getConnectorClient().peek<CrmObjectTypeInfo[]>('objectTypes');
    } catch {
      known = undefined;
    }
    const fits = types.some((t) => sameObjectType(t, picked.objectTypeId || picked.objectType, known) || sameObjectType(t, picked.objectType, known));
    return fits ? picked : null;
  }, [connected, ext.kind, picked, portalId, pickedPortal, typesKey]);
  return { connected, available: ext.kind === 'card' && canReadRecords(), record };
}
