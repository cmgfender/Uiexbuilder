/**
 * Live HubSpot data for the preview runtime (see LiveDataAdapter in ./types).
 *
 * Pure helpers used by RuntimeProvider when `live` is set:
 *  - which data sources load from the portal (CRM hooks always; fetch sources when the connector
 *    can proxy hubspot.fetch; app functions keep their mock results)
 *  - the request each source makes, built from the current scope exactly like the generated hook
 *    config (see src/codegen/dataSources.ts), plus a signature so a source re-runs only when its
 *    request changes (hooks re-run when their inputs change)
 *  - which other sources a request reads (a first load waits for them, like generated code)
 *  - plain-language error descriptions (connector error codes kept for the console)
 */
import type {
  AssociationResultDTO,
  CrmSearchRequestDTO,
  CrmSearchResponseDTO,
  ProxyFetchResponse,
} from '../connect/types';
import { isPropertyName, tokenize } from '../model/jsTokens';
import { hasTemplate, singleExpression } from '../model/template';
import type { CrmSearchSource, DataSource, Extension, FetchSource } from '../model/types';
import { previewRequestToProxy, readProxyJson, RUNTIME_TIMING } from './actions';
import { evaluate, interpolate, resolveTemplateString, type Scope } from './expr';
import { isDeferredSource, objectTypeName } from './mockData';
import type { LiveDataAdapter } from './types';

/** Message of CRM record sources when no sample record is picked (cards need one). */
export const NO_SAMPLE_RECORD_MESSAGE = 'Pick a sample record to load real data.';
/** Message of CRM record sources on settings pages and app home (HubSpot gives them no record). */
export const NO_RECORD_CONTEXT_MESSAGE = 'This page is not shown on a CRM record, so record data is not available here.';

/** Default page length of useAssociations when a source has none. */
const DEFAULT_ASSOCIATIONS_PAGE_LENGTH = 10;

/** Key that changes whenever what the runtime loads live changes ('' = mock data). */
export function liveDataKey(live: LiveDataAdapter | null | undefined): string {
  if (!live) return '';
  return `${live.key}${live.proxyFetch ? '|proxy' : ''}`;
}

/** True when the source loads from the portal (or through the connector) instead of mock data. */
export function isLiveSource(ds: DataSource, live: LiveDataAdapter | null | undefined): boolean {
  if (!live) return false;
  switch (ds.kind) {
    case 'crmProperties':
    case 'associations':
    case 'crmSearch':
      return true;
    case 'fetch':
      return typeof live.proxyFetch === 'function';
    default:
      return false;
  }
}

/** `0-1` / `contacts` -> `contact`; used in console messages. */
function singularType(objectType: string): string {
  const name = objectTypeName(objectType);
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('s')) return name.slice(0, -1);
  return name;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? '' : String(value);
}

function stringList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    const s = asString(v).trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRM search request (mirrors codegen's useCrmSearch config)
// ---------------------------------------------------------------------------

const NO_VALUE_OPERATORS = new Set(['HAS_PROPERTY', 'NOT_HAS_PROPERTY']);
const LIST_OPERATORS = new Set(['IN', 'NOT_IN']);

type FilterValue = string | number | boolean;
type SearchFilter = NonNullable<CrmSearchRequestDTO['filterGroups']>[number]['filters'][number];

/** An expression of the request failed (the generated hook config would throw while rendering). */
export class LiveRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveRequestError';
  }
}

/**
 * The useCrmSearch request of a source, built against `scope` exactly like the generated code:
 * properties, the interpolated query, one filter group (BETWEEN `value`+`highValue`, IN / NOT_IN
 * `values`, HAS_PROPERTY / NOT_HAS_PROPERTY without a value), sorts, pageLength and `formatted`.
 * Throws LiveRequestError when an expression fails.
 */
export function buildSearchRequest(ds: CrmSearchSource, scope: Scope): CrmSearchRequestDTO {
  const failures: string[] = [];
  const onError = (code: string, error: string) => failures.push(`{{ ${code.trim()} }}: ${error}`);
  /** templateValue semantics: a single segment keeps the expression's raw value. */
  const value = (raw: string): FilterValue => resolveTemplateString(raw, scope, onError) as FilterValue;

  const request: CrmSearchRequestDTO = {};
  const properties = Array.isArray(ds.properties) ? ds.properties.map(asString) : [];
  if (properties.length) request.properties = properties;
  if (asString(ds.query).trim() !== '') request.query = interpolate(asString(ds.query), scope, onError);

  const filters = Array.isArray(ds.filters) ? ds.filters.filter((f) => f && typeof f === 'object') : [];
  if (filters.length) {
    request.filterGroups = [
      {
        filters: filters.map((f) => {
          const filter: SearchFilter = { propertyName: asString(f.propertyName), operator: asString(f.operator) };
          const operator = asString(f.operator).toUpperCase();
          const raw = asString(f.value);
          if (NO_VALUE_OPERATORS.has(operator)) return filter;
          if (LIST_OPERATORS.has(operator)) {
            // One `{{ expression }}`: its value is the list; otherwise comma-separated values.
            if (hasTemplate(raw) && singleExpression(raw) !== null) filter.values = value(raw) as unknown as FilterValue[];
            else {
              filter.values = raw
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
                .map(value);
            }
            return filter;
          }
          if (operator === 'BETWEEN' && !raw.includes('{{') && raw.includes(',')) {
            const [low, high] = raw.split(',').map((v) => v.trim());
            filter.value = low;
            filter.highValue = high ?? '';
            return filter;
          }
          filter.value = value(raw);
          return filter;
        }),
      },
    ];
  }

  const sorts = Array.isArray(ds.sorts) ? ds.sorts.filter((s) => s && typeof s === 'object') : [];
  if (sorts.length) {
    request.sorts = sorts.map((s) => ({
      propertyName: asString(s.propertyName),
      direction: s.direction === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING',
    }));
  }
  if (typeof ds.pageLength === 'number' && Number.isFinite(ds.pageLength)) request.pageLength = ds.pageLength;
  if (ds.formatted) request.formatted = true;
  if (failures.length) throw new LiveRequestError(`Search request failed — ${failures.join('; ')}`);
  return request;
}

// ---------------------------------------------------------------------------
// Request plans
// ---------------------------------------------------------------------------

export interface LiveResult {
  /** The value the source exposes (`properties`, `results`, the parsed response). */
  data: unknown;
  /** Shown after the request label in the console, e.g. " (5)" or " → 200". */
  summary: string;
}

/** A request a live source makes. `sig` changes whenever the request changes. */
export interface LiveRequestPlan {
  ok: true;
  sig: string;
  /** Console label, e.g. "GET contact properties", "POST deals search". */
  label: string;
  /** True when the request needs no round trip (e.g. no properties listed): nothing is logged. */
  local?: boolean;
  perform(live: LiveDataAdapter): Promise<LiveResult>;
}

/** A source that cannot make its request (no sample record, failing expression). */
export interface LiveRequestFailure {
  ok: false;
  sig: string;
  label: string;
  message: string;
  code: string;
}

function failure(label: string, code: string, message: string): LiveRequestFailure {
  return { ok: false, sig: JSON.stringify(['error', code, message]), label, code, message };
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The fetch request of a live (proxied) fetch source, like the generated loader builds it. */
export function buildFetchRequest(ds: FetchSource, scope: Scope): { url: string; method: string; headers: Record<string, string>; body: unknown; timeout: number } {
  const url = interpolate(asString(ds.url), scope);
  const method = asString(ds.method).toUpperCase() || 'GET';
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(ds.headers) ? ds.headers : []) {
    if (h && typeof h.key === 'string' && h.key.trim()) headers[h.key.trim()] = interpolate(asString(h.value), scope);
  }
  let body: unknown;
  if (method !== 'GET' && asString(ds.body).trim()) {
    const r = evaluate(asString(ds.body), scope);
    if (!r.ok) throw new LiveRequestError(`Request body failed — ${r.error}`);
    body = r.value;
  }
  const timeout = typeof ds.timeout === 'number' && ds.timeout > 0 ? ds.timeout : RUNTIME_TIMING.fetchTimeoutMs;
  return { url, method, headers, body, timeout };
}

/** Why a record source cannot load: a card without a sample record, or a page without records. */
function noRecord(label: string, extensionKind: Extension['kind'] | undefined): LiveRequestFailure {
  return extensionKind && extensionKind !== 'card'
    ? failure(label, 'no_record_context', NO_RECORD_CONTEXT_MESSAGE)
    : failure(label, 'no_sample_record', NO_SAMPLE_RECORD_MESSAGE);
}

/**
 * The request a live source makes right now (against `scope`), or why it cannot make one.
 * Only call for sources where isLiveSource() is true. `extensionKind` words the error of record
 * sources without a record (a card needs a sample record; settings / home pages have none).
 */
export function planLiveRequest(
  ds: DataSource,
  scope: Scope,
  live: LiveDataAdapter,
  extensionKind?: Extension['kind'],
): LiveRequestPlan | LiveRequestFailure {
  const crm = live.context.crm;
  switch (ds.kind) {
    case 'crmProperties': {
      const label = crm ? `GET ${singularType(crm.objectTypeId)} properties` : 'GET record properties';
      if (!crm) return noRecord(label, extensionKind);
      const properties = stringList(ds.properties);
      const formatted = !!ds.formatted;
      const sig = JSON.stringify(['properties', crm.objectTypeId, crm.objectId, properties, formatted]);
      if (properties.length === 0) {
        return { ok: true, sig, label, local: true, perform: async () => ({ data: {}, summary: ' (0)' }) };
      }
      return {
        ok: true,
        sig,
        label,
        perform: async (adapter) => {
          const values = await adapter.getRecordProperties(crm.objectTypeId, crm.objectId, properties, formatted);
          // useCrmProperties exposes exactly the requested properties (missing ones are null).
          const data: Record<string, string | null> = {};
          for (const p of properties) {
            const v = values && typeof values === 'object' ? (values as Record<string, unknown>)[p] : undefined;
            data[p] = v === undefined || v === null ? null : String(v);
          }
          return { data, summary: ` (${properties.length})` };
        },
      };
    }
    case 'associations': {
      const toObjectType = asString(ds.toObjectType);
      const label = `GET associated ${objectTypeName(toObjectType)}`;
      if (!crm) return noRecord(label, extensionKind);
      const request = {
        toObjectType,
        properties: stringList(ds.properties),
        pageLength:
          typeof ds.pageLength === 'number' && Number.isFinite(ds.pageLength) && ds.pageLength > 0
            ? Math.floor(ds.pageLength)
            : DEFAULT_ASSOCIATIONS_PAGE_LENGTH,
        formatted: !!ds.formatted,
      };
      return {
        ok: true,
        sig: JSON.stringify(['associations', crm.objectTypeId, crm.objectId, request]),
        label,
        perform: async (adapter) => {
          const results = arrayOf<AssociationResultDTO>(await adapter.getAssociations(crm.objectTypeId, crm.objectId, request));
          return { data: results, summary: ` (${results.length})` };
        },
      };
    }
    case 'crmSearch': {
      const objectType = asString(ds.objectType);
      const label = `POST ${objectTypeName(objectType)} search`;
      let request: CrmSearchRequestDTO;
      try {
        request = buildSearchRequest(ds, scope);
      } catch (e) {
        return failure(label, 'expression_error', e instanceof Error ? e.message : String(e));
      }
      return {
        ok: true,
        sig: JSON.stringify(['search', objectType, request]),
        label,
        perform: async (adapter) => {
          const response: Partial<CrmSearchResponseDTO> | null = await adapter.search(objectType, request);
          const results = arrayOf<CrmSearchResponseDTO['results'][number]>(response?.results);
          const total = typeof response?.total === 'number' ? response.total : results.length;
          return { data: results, summary: ` (${results.length}${total > results.length ? ` of ${total}` : ''})` };
        },
      };
    }
    case 'fetch': {
      let req: ReturnType<typeof buildFetchRequest>;
      try {
        req = buildFetchRequest(ds, scope);
      } catch (e) {
        return failure(`${asString(ds.method).toUpperCase() || 'GET'} ${asString(ds.url)}`, 'expression_error', e instanceof Error ? e.message : String(e));
      }
      const label = `${req.method} ${req.url}`;
      return {
        ok: true,
        sig: JSON.stringify(['fetch', req]),
        label,
        perform: async (adapter) => {
          if (!adapter.proxyFetch) throw new Error('Previewing requests through HubSpot is not available.');
          const res: ProxyFetchResponse = await adapter.proxyFetch(previewRequestToProxy(req.url, req));
          // Like the generated loader: a non-2xx status is an error, the body is parsed as JSON.
          const data = readProxyJson(res);
          return { data, summary: ` → ${res.status}` };
        },
      };
    }
    default:
      return failure('request', 'unsupported', `${(ds as { kind?: string }).kind ?? 'This'} data source has no live data.`);
  }
}

// ---------------------------------------------------------------------------
// Dependencies between sources
// ---------------------------------------------------------------------------

function templateCodes(value: unknown, out: string[]): void {
  for (const m of asString(value).matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
}

/** User code a source's request reads (templates of query / filters / URL / headers, body, parameters). */
function requestCodes(ds: DataSource): string[] {
  const out: string[] = [];
  if (ds.kind === 'crmSearch') {
    templateCodes(ds.query, out);
    (Array.isArray(ds.filters) ? ds.filters : []).forEach((f) => templateCodes(f?.value, out));
  } else if (ds.kind === 'fetch') {
    templateCodes(ds.url, out);
    (Array.isArray(ds.headers) ? ds.headers : []).forEach((h) => templateCodes(h?.value, out));
    if ((asString(ds.method).toUpperCase() || 'GET') !== 'GET') out.push(asString(ds.body));
  } else if (ds.kind === 'function') {
    out.push(asString(ds.parameters));
  }
  return out;
}

function identifiers(code: string, into: Set<string>): void {
  const tokens = tokenize(code);
  tokens.forEach((t, i) => {
    if (t.kind === 'ident' && !isPropertyName(tokens, i)) into.add(t.text);
  });
}

/**
 * Sources that load on open whose values `ds`'s request reads — directly or through computed
 * values. A first live load waits until they have loaded (no request with empty values).
 */
export function liveDependencies(ext: Pick<Extension, 'dataSources' | 'computed'>, ds: DataSource): DataSource[] {
  const ids = new Set<string>();
  for (const code of requestCodes(ds)) identifiers(code, ids);
  // Computed values the request reads: follow their expressions (each computed value once).
  const computed = new Map((Array.isArray(ext.computed) ? ext.computed : []).map((c) => [c.name, c]));
  const seen = new Set<string>();
  const queue = [...ids];
  while (queue.length) {
    const name = queue.pop()!;
    const c = computed.get(name);
    if (!c || seen.has(name)) continue;
    seen.add(name);
    const more = new Set<string>();
    identifiers(asString(c.expr), more);
    for (const id of more) {
      if (!ids.has(id)) {
        ids.add(id);
        queue.push(id);
      }
    }
  }
  return (ext.dataSources ?? []).filter(
    (other) => other.id !== ds.id && !isDeferredSource(other) && [other.name, `${other.name}Loading`, `${other.name}Error`].some((n) => ids.has(n)),
  );
}

/**
 * For every source, the sources it waits for before its first load: its dependencies, minus
 * those that (transitively) depend on it — a cycle loads without waiting.
 */
export function liveGates(ext: Pick<Extension, 'dataSources' | 'computed'>): Map<string, DataSource[]> {
  const direct = new Map<string, DataSource[]>();
  for (const ds of ext.dataSources ?? []) direct.set(ds.id, liveDependencies(ext, ds));
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const d of direct.get(id) ?? []) stack.push(d.id);
    }
    return false;
  };
  const out = new Map<string, DataSource[]>();
  for (const [id, deps] of direct) out.set(id, deps.filter((d) => !reaches(d.id, id)));
  return out;
}
