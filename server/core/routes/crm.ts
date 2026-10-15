/**
 * READ-ONLY CRM routes for the builder: object types, properties, pipelines, owners, the record
 * picker search, single records, associations and CRM search. Every handler validates its inputs
 * and only ever issues GET requests or read-only POSTs (search / batch read) to HubSpot.
 */
import {
  CONNECTOR_ROUTES,
  type AssociationResultDTO,
  type CrmObjectTypeInfo,
  type CrmOwner,
  type CrmPipeline,
  type CrmPropertyDef,
  type CrmRecord,
  type CrmRecordSummary,
  type CrmSearchRequestDTO,
  type CrmSearchResponseDTO,
} from '../../../src/connect/types';
import { HubSpotApiError, type HubSpotApi, type RequestContext, type Route, type SessionData } from '../types';
import { ConnectorError, badRequest, clampInt, json, readJsonBody } from '../http';
import { ObjectTypeResolver, STANDARD_OBJECT_TYPES, findStandardObjectType, schemaInfo, standardInfo, type ResolvedObjectType } from '../objectTypes';
import { formatProperties } from '../format';

export const MAX_PROPERTIES = 200;
const PROPERTY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const RECORD_ID = /^\d{1,20}$/;
export const SEARCH_OPERATORS = [
  'EQ',
  'NEQ',
  'LT',
  'LTE',
  'GT',
  'GTE',
  'BETWEEN',
  'IN',
  'NOT_IN',
  'HAS_PROPERTY',
  'NOT_HAS_PROPERTY',
  'CONTAINS_TOKEN',
  'NOT_CONTAINS_TOKEN',
] as const;

// ---------------------------------------------------------------- validation helpers

export function assertPropertyName(name: unknown): string {
  if (typeof name !== 'string' || !PROPERTY_NAME.test(name)) {
    throw badRequest(`"${String(name).slice(0, 60)}" isn't a valid property name.`);
  }
  return name;
}

/** Parse "a,b,c" (or repeated ?properties=) into a validated, de-duplicated list (≤ 200). */
export function parsePropertyList(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    for (const part of raw.split(',')) {
      const name = part.trim();
      if (!name) continue;
      assertPropertyName(name);
      if (!out.includes(name)) out.push(name);
    }
  }
  if (out.length > MAX_PROPERTIES) throw badRequest(`Ask for at most ${MAX_PROPERTIES} properties at a time.`);
  return out;
}

function propertiesParam(ctx: RequestContext): string[] {
  return parsePropertyList(ctx.url.searchParams.getAll('properties'));
}

function assertRecordId(id: string | undefined): string {
  if (!id || !RECORD_ID.test(id)) throw badRequest(`"${(id ?? '').slice(0, 30)}" isn't a valid record ID (record IDs are numbers).`);
  return id;
}

function truthy(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function pick(props: Record<string, string | null | undefined> | undefined, names: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const n of names) out[n] = props?.[n] ?? null;
  return out;
}

function normalizeProps(props: Record<string, unknown> | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = v === null || v === undefined ? null : String(v);
  return out;
}

// ---------------------------------------------------------------- HubSpot response shapes

interface HsPropertyOption {
  label?: string;
  value?: string;
  description?: string;
  displayOrder?: number;
  hidden?: boolean;
}

interface HsProperty {
  name: string;
  label?: string;
  type?: string;
  fieldType?: string;
  description?: string;
  groupName?: string;
  options?: HsPropertyOption[];
  hidden?: boolean;
  calculated?: boolean;
  hubspotDefined?: boolean;
  archived?: boolean;
  modificationMetadata?: { readOnlyValue?: boolean };
}

interface HsObject {
  id: string | number;
  properties?: Record<string, unknown>;
}

interface HsPipeline {
  id: string;
  label?: string;
  displayOrder?: number;
  archived?: boolean;
  stages?: Array<{ id: string; label?: string; displayOrder?: number; archived?: boolean; metadata?: Record<string, unknown> }>;
}

export function mapProperty(p: HsProperty): CrmPropertyDef {
  const def: CrmPropertyDef = {
    name: p.name,
    label: p.label || p.name,
    type: p.type || 'string',
    fieldType: p.fieldType || 'text',
  };
  if (p.description) def.description = p.description;
  if (p.groupName) def.groupName = p.groupName;
  if (Array.isArray(p.options) && p.options.length > 0) {
    def.options = p.options
      .filter((o) => o && typeof o.value === 'string')
      .map((o) => {
        const opt: NonNullable<CrmPropertyDef['options']>[number] = { label: o.label || String(o.value), value: String(o.value) };
        if (o.description) opt.description = o.description;
        if (typeof o.displayOrder === 'number') opt.displayOrder = o.displayOrder;
        if (o.hidden) opt.hidden = true;
        return opt;
      })
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }
  if (p.hidden) def.hidden = true;
  if (p.calculated) def.calculated = true;
  if (p.hubspotDefined) def.hubspotDefined = true;
  if (p.modificationMetadata?.readOnlyValue || p.calculated) def.readOnlyValue = true;
  return def;
}

export function mapPipelines(results: HsPipeline[]): CrmPipeline[] {
  return results
    .filter((p) => p && typeof p.id === 'string' && !p.archived)
    .map((p) => ({
      id: p.id,
      label: p.label || p.id,
      displayOrder: p.displayOrder ?? 0,
      stages: (p.stages ?? [])
        .filter((s) => s && typeof s.id === 'string' && !s.archived)
        .map((s) => {
          const stage: CrmPipeline['stages'][number] = { id: s.id, label: s.label || s.id, displayOrder: s.displayOrder ?? 0 };
          if (s.metadata && typeof s.metadata === 'object') {
            const md: Record<string, string> = {};
            for (const [k, v] of Object.entries(s.metadata)) if (v !== null && v !== undefined) md[k] = String(v);
            stage.metadata = md;
          }
          return stage;
        })
        .sort((a, b) => a.displayOrder - b.displayOrder),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------- request-scoped helpers

class CrmContext {
  readonly resolver: ObjectTypeResolver;
  private defs = new Map<string, Promise<Map<string, CrmPropertyDef>>>();
  private pipelines = new Map<string, Promise<CrmPipeline[]>>();

  constructor(
    readonly api: HubSpotApi,
    readonly session: SessionData,
  ) {
    this.resolver = new ObjectTypeResolver(api);
  }

  static async create(ctx: RequestContext): Promise<CrmContext> {
    const api = await ctx.hubspot();
    const session = await ctx.session.get();
    if (!session) throw new ConnectorError(401, 'not_connected', 'Connect HubSpot to see real data.');
    return new CrmContext(api, session);
  }

  async properties(t: ResolvedObjectType): Promise<CrmPropertyDef[]> {
    const res = await this.api.request<{ results?: HsProperty[] }>('GET', `/crm/v3/properties/${encodeURIComponent(t.apiPath)}`);
    return (res?.results ?? [])
      .filter((p) => p && typeof p.name === 'string' && !p.archived)
      .map(mapProperty)
      .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
  }

  propertyDefs(t: ResolvedObjectType): Promise<Map<string, CrmPropertyDef>> {
    let p = this.defs.get(t.apiPath);
    if (!p) {
      p = this.properties(t).then((list) => new Map(list.map((d) => [d.name, d])));
      this.defs.set(t.apiPath, p);
    }
    return p;
  }

  pipelinesFor(t: ResolvedObjectType): Promise<CrmPipeline[]> {
    let p = this.pipelines.get(t.apiPath);
    if (!p) {
      p = (async () => {
        const std = findStandardObjectType(t.objectType);
        if (std && !std.hasPipelines) return [];
        try {
          const res = await this.api.request<{ results?: HsPipeline[] }>('GET', `/crm/v3/pipelines/${encodeURIComponent(t.apiPath)}`);
          return mapPipelines(res?.results ?? []);
        } catch (err) {
          // Objects without pipelines answer 400/404.
          if (err instanceof HubSpotApiError && (err.code === 'not_found' || err.code === 'bad_request')) return [];
          throw err;
        }
      })();
      this.pipelines.set(t.apiPath, p);
    }
    return p;
  }

  recordUrl(t: ResolvedObjectType, id: string): string {
    return `https://${this.session.appHost}/contacts/${this.session.portalId}/record/${t.objectTypeId}/${id}`;
  }
}

// ---------------------------------------------------------------- record picker labels

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const NUMERIC_SECONDARY = new Set(['amount', 'price', 'hs_total_price', 'hs_price', 'quantity']);
const STAGE_PROPERTIES = new Set(['hs_pipeline_stage', 'dealstage']);

function prettySecondary(prop: string, value: string, stageLabels: Map<string, string> | null): string {
  if (STAGE_PROPERTIES.has(prop) && stageLabels?.has(value)) return stageLabels.get(value)!;
  if (NUMERIC_SECONDARY.has(prop) && value.trim() !== '' && Number.isFinite(Number(value))) return numberFormat.format(Number(value));
  if (/(_date|_time|timestamp|_start)$/.test(prop)) {
    const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (Number.isFinite(ms)) return dateFormat.format(new Date(ms));
  }
  return value;
}

export function summarize(
  t: ResolvedObjectType,
  obj: HsObject,
  url: string,
  stageLabels: Map<string, string> | null,
): CrmRecordSummary {
  const id = String(obj.id);
  const props = normalizeProps(obj.properties);
  let label = t.labelProperties
    .filter((p) => p !== 'hs_object_id')
    .map((p) => (props[p] ?? '').trim())
    .filter(Boolean)
    .join(' ');
  const secondaryProps = t.info.secondaryDisplayProperties;
  if (!label && t.objectType === 'contacts') label = (props.email ?? '').trim();
  if (!label) label = `${t.info.label} ${id}`;
  const summary: CrmRecordSummary = { id, objectType: t.objectType, objectTypeId: t.objectTypeId, label, url };
  for (const p of secondaryProps) {
    const v = (props[p] ?? '').trim();
    if (v && v !== label) {
      summary.secondary = prettySecondary(p, v, stageLabels);
      break;
    }
  }
  return summary;
}

// ---------------------------------------------------------------- search body validation

function primitive(v: unknown, what: string): string | number | boolean {
  if (typeof v === 'string') {
    if (v.length > 1000) throw badRequest(`${what} is too long.`);
    return v;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  throw badRequest(`${what} must be text, a number or true/false.`);
}

/** Validate a CrmSearchRequestDTO and build the HubSpot search body. */
export function buildSearchBody(input: unknown): { body: Record<string, unknown>; properties: string[]; formatted: boolean } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('The search request must be a JSON object.');
  const req = input as CrmSearchRequestDTO;
  const body: Record<string, unknown> = {};

  let properties: string[] = [];
  if (req.properties !== undefined) {
    if (!Array.isArray(req.properties)) throw badRequest('"properties" must be a list of property names.');
    properties = parsePropertyList(req.properties.map((p) => assertPropertyName(p)));
    body.properties = properties;
  }
  if (req.query !== undefined && req.query !== null && req.query !== '') {
    if (typeof req.query !== 'string' || req.query.length > 3000) throw badRequest('"query" must be text (at most 3000 characters).');
    body.query = req.query;
  }
  if (req.filterGroups !== undefined) {
    if (!Array.isArray(req.filterGroups)) throw badRequest('"filterGroups" must be a list.');
    if (req.filterGroups.length > 5) throw badRequest('HubSpot allows at most 5 filter groups.');
    let total = 0;
    body.filterGroups = req.filterGroups.map((g, gi) => {
      if (!g || !Array.isArray(g.filters)) throw badRequest(`Filter group ${gi + 1} needs a "filters" list.`);
      if (g.filters.length > 6) throw badRequest('HubSpot allows at most 6 filters per group.');
      total += g.filters.length;
      return {
        filters: g.filters.map((f, fi) => {
          const where = `Filter ${fi + 1} in group ${gi + 1}`;
          if (!f || typeof f !== 'object') throw badRequest(`${where} is not valid.`);
          const operator = typeof f.operator === 'string' ? f.operator.toUpperCase() : '';
          if (!(SEARCH_OPERATORS as readonly string[]).includes(operator)) {
            throw badRequest(`${where} uses an unknown operator "${String(f.operator).slice(0, 30)}".`);
          }
          const out: Record<string, unknown> = { propertyName: assertPropertyName(f.propertyName), operator };
          if (f.value !== undefined && f.value !== null) out.value = String(primitive(f.value, `${where} value`));
          if (f.highValue !== undefined && f.highValue !== null) out.highValue = String(primitive(f.highValue, `${where} high value`));
          if (f.values !== undefined && f.values !== null) {
            if (!Array.isArray(f.values) || f.values.length > 100) throw badRequest(`${where} "values" must be a list of at most 100 items.`);
            out.values = f.values.map((v) => String(primitive(v, `${where} value`)));
          }
          return out;
        }),
      };
    });
    if (total > 18) throw badRequest('HubSpot allows at most 18 filters in one search.');
  }
  if (req.sorts !== undefined) {
    if (!Array.isArray(req.sorts) || req.sorts.length > 5) throw badRequest('"sorts" must be a list (at most 5).');
    body.sorts = req.sorts.map((s) => {
      if (!s || typeof s !== 'object') throw badRequest('Each sort needs a propertyName and direction.');
      const direction = s.direction === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING';
      return { propertyName: assertPropertyName(s.propertyName), direction };
    });
  }
  body.limit = clampInt(req.pageLength === undefined ? undefined : String(req.pageLength), 1, 200, 10);
  if (req.after !== undefined && req.after !== null && req.after !== '') {
    if (typeof req.after !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(req.after)) throw badRequest('"after" is not a valid paging token.');
    body.after = req.after;
  }
  return { body, properties, formatted: req.formatted === true };
}

interface HsSearchResponse {
  total?: number;
  results?: HsObject[];
  paging?: { next?: { after?: string } };
}

// ---------------------------------------------------------------- routes

export function crmRoutes(): Route[] {
  const objectTypes: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.objectTypes,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const list: CrmObjectTypeInfo[] = STANDARD_OBJECT_TYPES.map(standardInfo);
      if (crm.session.scopes.includes('crm.schemas.custom.read')) {
        const schemas = await crm.resolver.loadSchemas();
        const custom = (schemas ?? []).map(schemaInfo).sort((a, b) => a.label.localeCompare(b.label));
        list.push(...custom);
      }
      return json(list);
    },
  };

  const properties: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.properties,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      return json(await crm.properties(t));
    },
  };

  const pipelines: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.pipelines,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      return json(await crm.pipelinesFor(t));
    },
  };

  const owners: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.owners,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const out: CrmOwner[] = [];
      let after: string | undefined;
      for (let page = 0; page < 5; page++) {
        const res = await crm.api.request<{
          results?: Array<{ id: string | number; email?: string; firstName?: string; lastName?: string; userId?: number; archived?: boolean }>;
          paging?: { next?: { after?: string } };
        }>('GET', '/crm/v3/owners', { query: { limit: 100, after } });
        for (const o of res?.results ?? []) {
          if (!o || o.archived) continue;
          const owner: CrmOwner = { id: String(o.id), email: o.email ?? '' };
          if (o.firstName) owner.firstName = o.firstName;
          if (o.lastName) owner.lastName = o.lastName;
          if (typeof o.userId === 'number') owner.userId = o.userId;
          out.push(owner);
        }
        after = res?.paging?.next?.after;
        if (!after) break;
      }
      return json(out);
    },
  };

  const searchRecords: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.searchRecords,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const q = (ctx.url.searchParams.get('q') ?? '').trim().slice(0, 200);
      const limit = clampInt(ctx.url.searchParams.get('limit'), 1, 50, 10);
      const props = [...new Set([...t.labelProperties, t.info.primaryDisplayProperty, ...t.info.secondaryDisplayProperties, ...(t.objectType === 'contacts' ? ['email'] : [])])];
      const body: Record<string, unknown> = { properties: props, limit };
      if (q) body.query = q;
      else body.sorts = [{ propertyName: t.objectType === 'contacts' ? 'lastmodifieddate' : 'hs_lastmodifieddate', direction: 'DESCENDING' }];

      const [res, byId] = await Promise.all([
        crm.api.request<HsSearchResponse>('POST', `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/search`, { body }),
        /^\d{1,20}$/.test(q)
          ? crm.api
              .request<HsObject>('GET', `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/${q}`, { query: { properties: props.join(',') } })
              .catch((err: unknown) => {
                if (err instanceof HubSpotApiError && err.code === 'not_found') return null;
                throw err;
              })
          : Promise.resolve(null),
      ]);
      const objects = [...(byId ? [byId] : []), ...(res?.results ?? []).filter((o) => !byId || String(o.id) !== String(byId.id))].slice(0, limit);

      let stageLabels: Map<string, string> | null = null;
      if (t.info.secondaryDisplayProperties.some((p) => STAGE_PROPERTIES.has(p)) && objects.length > 0) {
        try {
          const pls = await crm.pipelinesFor(t);
          stageLabels = new Map(pls.flatMap((p) => p.stages.map((s) => [s.id, s.label] as const)));
        } catch {
          stageLabels = null;
        }
      }
      return json(objects.map((o) => summarize(t, o, crm.recordUrl(t, String(o.id)), stageLabels)));
    },
  };

  const record: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.record,
    handler: async (ctx) => {
      const id = assertRecordId(ctx.params.id);
      const requested = propertiesParam(ctx);
      const formatted = truthy(ctx.url.searchParams.get('formatted'));
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const [obj, defs] = await Promise.all([
        crm.api.request<HsObject>('GET', `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/${id}`, {
          query: { properties: requested.length > 0 ? requested.join(',') : undefined },
        }),
        formatted ? crm.propertyDefs(t) : Promise.resolve(null),
      ]);
      let props = normalizeProps(obj?.properties);
      for (const name of requested) if (!(name in props)) props[name] = null;
      if (defs) props = formatProperties(props, defs);
      const body: CrmRecord = { id: String(obj?.id ?? id), objectType: t.objectType, objectTypeId: t.objectTypeId, properties: props };
      return json(body);
    },
  };

  const associations: Route = {
    method: 'GET',
    path: CONNECTOR_ROUTES.associations,
    handler: async (ctx) => {
      const id = assertRecordId(ctx.params.id);
      const requested = propertiesParam(ctx);
      const limit = clampInt(ctx.url.searchParams.get('limit') ?? ctx.url.searchParams.get('pageLength'), 1, 500, 100);
      const formatted = truthy(ctx.url.searchParams.get('formatted'));
      const crm = await CrmContext.create(ctx);
      const [from, to] = await Promise.all([crm.resolver.resolve(ctx.params.objectType), crm.resolver.resolve(ctx.params.toObjectType)]);
      const res = await crm.api.request<{
        results?: Array<{ toObjectId: number | string; associationTypes?: Array<{ category?: string; typeId?: number; label?: string | null }> }>;
      }>('GET', `/crm/v4/objects/${encodeURIComponent(from.apiPath)}/${id}/associations/${encodeURIComponent(to.apiPath)}`, { query: { limit } });
      const links = (res?.results ?? []).slice(0, limit);

      const propsById = new Map<string, Record<string, string | null>>();
      if (requested.length > 0 && links.length > 0) {
        const ids = [...new Set(links.map((l) => String(l.toObjectId)))];
        const [defs, ...batches] = await Promise.all([
          formatted ? crm.propertyDefs(to) : Promise.resolve(null),
          ...chunk(ids, 100).map((chunkIds) =>
            crm.api.request<{ results?: HsObject[] }>('POST', `/crm/v3/objects/${encodeURIComponent(to.apiPath)}/batch/read`, {
              body: { properties: requested, inputs: chunkIds.map((i) => ({ id: i })) },
            }),
          ),
        ]);
        for (const batch of batches) {
          for (const obj of batch?.results ?? []) {
            let props = pick(normalizeProps(obj.properties), requested);
            if (defs) props = formatProperties(props, defs);
            propsById.set(String(obj.id), props);
          }
        }
      }
      const out: AssociationResultDTO[] = links.map((l) => ({
        toObjectId: Number(l.toObjectId),
        associationTypes: (l.associationTypes ?? []).map((a) => ({ category: a.category ?? 'HUBSPOT_DEFINED', typeId: Number(a.typeId ?? 0), label: a.label ?? '' })),
        properties: requested.length > 0 ? (propsById.get(String(l.toObjectId)) ?? pick({}, requested)) : {},
      }));
      return json(out);
    },
  };

  const search: Route = {
    method: 'POST',
    path: CONNECTOR_ROUTES.search,
    handler: async (ctx) => {
      const input = await readJsonBody(ctx.request, 64 * 1024);
      const { body, formatted } = buildSearchBody(input);
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const [res, defs] = await Promise.all([
        crm.api.request<HsSearchResponse>('POST', `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/search`, { body }),
        formatted ? crm.propertyDefs(t) : Promise.resolve(null),
      ]);
      const after = res?.paging?.next?.after;
      const out: CrmSearchResponseDTO = {
        results: (res?.results ?? []).map((o) => {
          const props = normalizeProps(o.properties);
          return { objectId: Number(o.id), properties: defs ? formatProperties(props, defs) : props };
        }),
        total: typeof res?.total === 'number' ? res.total : (res?.results ?? []).length,
        hasMore: Boolean(after),
      };
      if (after) out.after = String(after);
      return json(out);
    },
  };

  // Order matters: the literal "/search" route must come before "/:id".
  return [objectTypes, properties, pipelines, owners, searchRecords, record, associations, search];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
